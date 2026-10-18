// PRE-CONTEXT DATABASE ACCESS (CLAUDE.md, "Pre-context lookups").
// The only queries allowed before a workspace is known:
//   1. create the workspace inside the signup transaction
//   2. find a login identity by globally unique normalized email (row-locked)
//   3. resolve a session by sha256 token hash
//   4. delete that session
//   5. resolve a workspace by its public form token (/f/[token])
// Everything after the workspace is known goes through scoped helpers.
// Do not add general-purpose queries here.
import 'server-only'
import { pool } from './client'
import { bindScoped, type Scoped } from './scoped'
import type { Ctx } from '@/lib/ctx'

export type LoginIdentity = {
  id: string
  workspace_id: string
  password_hash: string
  level: Ctx['level']
  failed_logins: number
  locked_until: Date | null
  deactivated_at: Date | null
}

export type SessionRow = {
  session_id: string
  workspace_id: string
  user_id: string
  level: Ctx['level']
  expires_at: Date
  deactivated_at: Date | null
}

const ownerCtx = (workspaceId: string, userId: string | null): Ctx => ({
  workspaceId, userId, level: 'owner', permissions: [], isSystem: false,
})

async function inTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * (1) Signup: insert the workspace, then run fn with helpers scoped to the
 * workspace id PostgreSQL returned, all in ONE transaction.
 */
export function signupTransaction<T>(
  workspaceName: string,
  fn: (tx: Scoped, workspaceId: string) => Promise<T>,
): Promise<T> {
  return inTransaction(async client => {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [workspaceName],
    )
    const workspaceId = rows[0].id
    return fn(bindScoped(ownerCtx(workspaceId, null), client), workspaceId)
  })
}

/**
 * (2) Login: lock the user row for this email (serializes the failed-login
 * counter), then run fn with helpers scoped to that user's workspace.
 */
export function loginTransaction<T>(
  email: string,
  fn: (identity: LoginIdentity | null, tx: Scoped | null) => Promise<T>,
): Promise<T> {
  return inTransaction(async client => {
    const { rows } = await client.query<LoginIdentity>(
      `SELECT id, workspace_id, password_hash, level, failed_logins, locked_until, deactivated_at
         FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
      [email],
    )
    const identity = rows[0] ?? null
    const tx = identity ? bindScoped(ownerCtx(identity.workspace_id, identity.id), client) : null
    return fn(identity, tx)
  })
}

/** (3) Resolve a session by token hash, with its user's level and status. */
export async function findSessionByHash(tokenHash: Buffer): Promise<SessionRow | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT s.id AS session_id, s.workspace_id, s.user_id, s.expires_at, u.level, u.deactivated_at
       FROM sessions s JOIN users u ON u.id = s.user_id AND u.workspace_id = s.workspace_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

/** (4) Delete the session with this token hash (logout, or expired/invalid cleanup). */
export async function deleteSessionByHash(tokenHash: Buffer): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
}

/** (6) Public web chat /chat/[slug]: resolve the workspace from its public slug. */
export async function findWorkspaceBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null
  const { rows } = await pool.query<{ id: string; name: string; slug: string }>(
    'SELECT id, name, slug FROM workspaces WHERE slug = $1', [slug])
  return rows[0] ?? null
}

/** (5) Public web form /f/[token]: resolve the workspace from its unguessable form token. */
export async function findWorkspaceByFormToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null
  const { rows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces WHERE public_form_token = $1', [token])
  return rows[0] ?? null
}
