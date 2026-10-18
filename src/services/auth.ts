// Signup, login, logout and "me". Routes parse input and call these.
import 'server-only'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import { deleteSessionByHash, loginTransaction, signupTransaction } from '@/db/auth'
import { scoped, type Scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { hashToken, newSessionToken } from '@/lib/session'

const ARGON2ID = 2 // Algorithm.Argon2id (const enum cannot be imported under isolatedModules)
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15

const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.')
const password = z.string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password must be at most 200 characters.')

export const signupSchema = z.object({
  workspaceName: z.string().trim().min(2, 'Workspace name must be at least 2 characters.').max(80, 'Workspace name is too long.'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80, 'Name is too long.'),
  email,
  password,
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(200),
})

// Default roles created for every workspace (docs/02_BUILD_GUIDE.md, Step 2).
export const DEFAULT_ROLES: Record<string, string[]> = {
  Manager: ['crm.view', 'crm.create', 'crm.edit', 'leads.reassign', 'conversations.view',
            'conversations.send', 'payments.create', 'appointments.manage'],
  Sales:   ['crm.view', 'crm.create', 'crm.edit', 'conversations.view', 'conversations.send',
            'appointments.manage'],
}

const DEFAULT_STAGES = [
  { name: 'New', isWon: false, isLost: false },
  { name: 'Contacted', isWon: false, isLost: false },
  { name: 'Proposal', isWon: false, isLost: false },
  { name: 'Won', isWon: true, isLost: false },
  { name: 'Lost', isWon: false, isLost: true },
]

export type SessionResult = { token: string; expiresAt: Date; userId: string; workspaceId: string }

async function createSession(tx: Scoped, userId: string) {
  const s = newSessionToken()
  await tx.query(
    'INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, s.hash, s.expiresAt],
  )
  return s
}

export async function signup(input: z.infer<typeof signupSchema>): Promise<SessionResult> {
  const passwordHash = await hash(input.password, { algorithm: ARGON2ID })
  try {
    return await signupTransaction(input.workspaceName, async (tx, workspaceId) => {
      const owner = await tx.one<{ id: string }>(
        `INSERT INTO users (workspace_id, email, name, password_hash, level)
         VALUES ($1, $2, $3, $4, 'owner') RETURNING id`,
        [input.email, input.name, passwordHash],
      )
      const ctx: Ctx = { workspaceId, userId: owner.id, level: 'owner', permissions: [], isSystem: false }
      await audit(tx.raw, { ctx, action: 'workspace.created', targetType: 'workspace', targetId: workspaceId,
                            after: { name: input.workspaceName } })
      await audit(tx.raw, { ctx, action: 'user.created', targetType: 'user', targetId: owner.id,
                            after: { email: input.email, name: input.name, level: 'owner' } })

      for (const [roleName, keys] of Object.entries(DEFAULT_ROLES)) {
        const role = await tx.one<{ id: string }>(
          'INSERT INTO roles (workspace_id, name) VALUES ($1, $2) RETURNING id', [roleName])
        await tx.query(
          `INSERT INTO role_permissions (role_id, permission_key)
           SELECT r.id, k FROM roles r, unnest($3::text[]) AS k
            WHERE r.workspace_id = $1 AND r.id = $2`,
          [role.id, keys])
        await audit(tx.raw, { ctx, action: 'role.created', targetType: 'role', targetId: role.id,
                              after: { name: roleName, permissions: keys } })
      }

      const pipeline = await tx.one<{ id: string }>(
        'INSERT INTO pipelines (workspace_id, name) VALUES ($1, $2) RETURNING id', ['Sales'])
      for (const [position, st] of DEFAULT_STAGES.entries()) {
        await tx.query(
          `INSERT INTO stages (workspace_id, pipeline_id, name, position, is_won, is_lost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [pipeline.id, st.name, position, st.isWon, st.isLost])
      }
      await audit(tx.raw, { ctx, action: 'pipeline.created', targetType: 'pipeline', targetId: pipeline.id,
                            after: { name: 'Sales', stages: DEFAULT_STAGES.map(s => s.name) } })

      const rules = await tx.one(
        'INSERT INTO assignment_rules (workspace_id) VALUES ($1) RETURNING *', [])
      await audit(tx.raw, { ctx, action: 'assignment_rules.created', targetType: 'assignment_rules',
                            targetId: workspaceId, after: rules })

      const s = await createSession(tx, owner.id)
      return { token: s.token, expiresAt: s.expiresAt, userId: owner.id, workspaceId }
    })
  } catch (e) {
    const pg = e as { code?: string; constraint?: string }
    if (pg.code === '23505' && pg.constraint === 'users_email_unique') {
      throw new ApiError(409, 'An account with this email already exists. Log in instead.', { email: 'Already registered.' })
    }
    throw e
  }
}

// Verified against for unknown emails so both paths spend similar time.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hash('vigil-timing-equalizer-not-a-password', { algorithm: ARGON2ID }))

const INVALID = 'Email or password is incorrect.'
const LOCKED = `Too many failed attempts. This account is locked for ${LOCK_MINUTES} minutes.`

/**
 * Lockout rule: each wrong password increments failed_logins. The 5th
 * consecutive failure sets locked_until = now + 15 minutes and returns 423.
 * While locked, every attempt (even the right password) returns 423. After the
 * lock expires the count starts again from zero. Success resets both fields.
 */
export async function login(input: z.infer<typeof loginSchema>): Promise<SessionResult> {
  const result = await loginTransaction(input.email, async (user, tx) => {
    if (!user || !tx || user.deactivated_at) {
      await verify(await getDummyHash(), input.password).catch(() => false)
      return { kind: 'invalid' as const }
    }
    const now = Date.now()
    const lockActive = user.locked_until && user.locked_until.getTime() > now
    if (lockActive) return { kind: 'locked' as const }

    const ok = await verify(user.password_hash, input.password).catch(() => false)
    if (!ok) {
      const previous = user.locked_until ? 0 : user.failed_logins // an expired lock starts a fresh count
      const failed = previous + 1
      const lockNow = failed >= MAX_FAILED_LOGINS
      await tx.query(
        `UPDATE users SET failed_logins = $3, locked_until = $4 WHERE workspace_id = $1 AND id = $2`,
        [user.id, failed, lockNow ? new Date(now + LOCK_MINUTES * 60_000) : null])
      if (lockNow) {
        await tx.query(
          `INSERT INTO security_events (workspace_id, kind, path, detail) VALUES ($1, 'login_locked', '/api/auth/login', $2)`,
          [`user ${user.id} locked after ${failed} failed logins`])
        return { kind: 'locked' as const }
      }
      return { kind: 'invalid' as const }
    }

    await tx.query(
      `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE workspace_id = $1 AND id = $2`, [user.id])
    const s = await createSession(tx, user.id)
    return { kind: 'ok' as const, session: { token: s.token, expiresAt: s.expiresAt, userId: user.id, workspaceId: user.workspace_id } }
  })

  if (result.kind === 'locked') throw new ApiError(423, LOCKED)
  if (result.kind === 'invalid') throw new ApiError(401, INVALID)
  return result.session
}

/** Idempotent: deleting a missing session is fine. */
export async function logout(token: string | null) {
  if (token) await deleteSessionByHash(hashToken(token))
}

export async function getMe(ctx: Ctx) {
  const db = scoped(ctx)
  const row = await db.one<{ name: string; email: string; workspace_name: string; availability: string }>(
    `SELECT u.name, u.email, u.availability, w.name AS workspace_name
       FROM users u JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.workspace_id = $1 AND u.id = $2`,
    [ctx.userId])
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    workspaceName: row.workspace_name,
    name: row.name,
    email: row.email,
    level: ctx.level,
    availability: row.availability,
    permissions: ctx.permissions,
  }
}
