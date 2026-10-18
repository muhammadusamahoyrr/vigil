// Sessions and Ctx (CLAUDE.md, Ctx). getCtx and systemCtx live here and nowhere else.
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { deleteSessionByHash, findSessionByHash } from '@/db/auth'
import { scoped } from '@/db/scoped'
import type { Ctx } from './ctx'
import { ApiError, unauthorized } from './errors'

export type { Ctx }

export const SESSION_COOKIE = 'vigil_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 32 random bytes for the cookie; only the sha256 is ever stored. */
export function newSessionToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) }
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production', // plain http only in local development
    expires: expiresAt,
    maxAge: Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)),
  }
}

export function clearedCookieOptions() {
  return { ...sessionCookieOptions(new Date(0)), maxAge: 0 }
}

function tokenFromHeader(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** The raw session token from a route request, or from next/headers in server components. */
export async function readSessionToken(req?: Request): Promise<string | null> {
  if (req) return tokenFromHeader(req.headers.get('cookie'))
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null
}

/** Ctx from the session cookie; throws 401 for missing, unknown, expired or deactivated sessions. */
export async function getCtx(req?: Request): Promise<Ctx> {
  const token = await readSessionToken(req)
  if (!token) throw unauthorized()

  const hash = hashToken(token)
  const s = await findSessionByHash(hash)
  if (!s) throw unauthorized('Your session has ended. Please log in again.')
  if (s.expires_at.getTime() <= Date.now() || s.deactivated_at) {
    await deleteSessionByHash(hash)
    throw unauthorized('Your session has ended. Please log in again.')
  }

  // Permissions are read on every request, so role changes apply immediately.
  const partial: Ctx = { workspaceId: s.workspace_id, userId: s.user_id, level: s.level, permissions: [], isSystem: false }
  const db = scoped(partial)
  const rows = s.level === 'owner' || s.level === 'admin'
    ? await db.many<{ key: string }>(
        `SELECT key FROM permissions
          WHERE EXISTS (SELECT 1 FROM users WHERE workspace_id = $1 AND id = $2)
          ORDER BY key`, [s.user_id])
    : await db.many<{ key: string }>(
        `SELECT DISTINCT rp.permission_key AS key
           FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.workspace_id = $1 AND ur.user_id = $2
          ORDER BY 1`, [s.user_id])

  return { ...partial, permissions: rows.map(r => r.key) }
}

/** Ctx or null, for pages that redirect instead of returning 401. */
export async function getCtxOrNull(req?: Request): Promise<Ctx | null> {
  try {
    return await getCtx(req)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

/**
 * For the worker and verified webhooks ONLY, after the workspace id was read
 * from the database (a verified URL token or a row the worker just read).
 * Never build it from user input, a payload or a query string.
 */
export function systemCtx(workspaceId: string): Ctx {
  return { workspaceId, userId: null, level: 'owner', permissions: ['*'], isSystem: true }
}
