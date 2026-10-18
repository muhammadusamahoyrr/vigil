// Roles, permissions, user level/roles, deactivation, audit log (Step 3).
import 'server-only'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { hasPermission, requirePermission } from '@/lib/rbac'

const uuid = z.string().uuid()

export async function listRolesWithPermissions(ctx: Ctx) {
  requirePermission(ctx, 'users.manage')
  const roles = await scoped(ctx).many<{ id: string; name: string; keys: string[]; members: number }>(
    `SELECT r.id, r.name,
            COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS keys,
            (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS members
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.workspace_id = $1
      GROUP BY r.id ORDER BY r.name`)
  return { roles, keys: PERMISSION_KEYS }
}

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters.').max(60),
  keys: z.array(z.enum(PERMISSION_KEYS)).default([]),
})

export async function createRole(ctx: Ctx, input: z.infer<typeof roleSchema>) {
  requirePermission(ctx, 'users.manage')
  try {
    return await scoped(ctx).tx(async tx => {
      const r = await tx.one<{ id: string }>('INSERT INTO roles (workspace_id, name) VALUES ($1, $2) RETURNING id', [input.name])
      await tx.query(
        `INSERT INTO role_permissions (role_id, permission_key)
         SELECT r.id, k FROM roles r, unnest($3::text[]) k WHERE r.workspace_id = $1 AND r.id = $2`, [r.id, input.keys])
      await audit(tx.raw, { ctx, action: 'role.created', targetType: 'role', targetId: r.id, after: input })
      return { id: r.id }
    })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'A role with this name already exists.', { name: 'Already exists.' })
    throw e
  }
}

export const rolePermissionsSchema = z.object({ keys: z.array(z.enum(PERMISSION_KEYS)) })

/** Takes effect on the next request of every member: getCtx re-reads permissions each time. */
export async function setRolePermissions(ctx: Ctx, roleId: string, keys: string[]) {
  requirePermission(ctx, 'users.manage')
  if (!uuid.safeParse(roleId).success) throw new ApiError(404, 'Role not found.')
  return scoped(ctx).tx(async tx => {
    // lock the role row first (serializes concurrent toggles), then read its current keys
    const locked = await tx.maybeOne<{ name: string }>('SELECT name FROM roles WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [roleId])
    if (!locked) throw new ApiError(404, 'Role not found.')
    const role = await tx.one<{ name: string; keys: string[] }>(
      `SELECT r.name, COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS keys
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.workspace_id = $1 AND r.id = $2 GROUP BY r.id`, [roleId])
    await tx.query(
      `DELETE FROM role_permissions rp USING roles r
        WHERE r.id = rp.role_id AND r.workspace_id = $1 AND r.id = $2 AND NOT (rp.permission_key = ANY($3::text[]))`, [roleId, keys])
    await tx.query(
      `INSERT INTO role_permissions (role_id, permission_key)
       SELECT r.id, k FROM roles r, unnest($3::text[]) k WHERE r.workspace_id = $1 AND r.id = $2
       ON CONFLICT DO NOTHING`, [roleId, keys])
    await audit(tx.raw, { ctx, action: 'role.permissions_changed', targetType: 'role', targetId: roleId,
                          before: { name: role.name, permissions: role.keys }, after: { name: role.name, permissions: [...keys].sort() } })
    return { ok: true }
  })
}

export const userUpdateSchema = z.object({
  level: z.enum(['admin', 'user']).optional(),
  roleIds: z.array(uuid).optional(),
})

async function loadTarget(ctx: Ctx, userId: string) {
  if (!uuid.safeParse(userId).success) throw new ApiError(404, 'User not found.')
  const t = await scoped(ctx).maybeOne<{ id: string; level: string; deactivated_at: Date | null }>(
    'SELECT id, level, deactivated_at FROM users WHERE workspace_id = $1 AND id = $2', [userId])
  if (!t) throw new ApiError(404, 'User not found.')
  if (t.level === 'owner') throw new ApiError(403, 'The Owner cannot be changed here.')
  // a User who manages users through a role must not act on Admins (they hold every permission)
  if (t.level === 'admin' && ctx.level === 'user') throw new ApiError(403, 'Only the Owner or an Admin can change an Admin.')
  if (t.id === ctx.userId) throw new ApiError(403, 'You cannot change your own level or roles.')
  return t
}

export async function updateUser(ctx: Ctx, userId: string, input: z.infer<typeof userUpdateSchema>) {
  requirePermission(ctx, 'users.manage')
  const target = await loadTarget(ctx, userId)
  // levels decide the permission ceiling: only Owner/Admin may change them (no self-made Admins)
  if (input.level && input.level !== target.level && ctx.level === 'user') {
    throw new ApiError(403, 'Only the Owner or an Admin can change levels.')
  }
  return scoped(ctx).tx(async tx => {
    const before = await tx.one(
      `SELECT u.level, COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id WHERE u.workspace_id = $1 AND u.id = $2 GROUP BY u.id`, [userId])
    if (input.level && input.level !== target.level) {
      await tx.query('UPDATE users SET level = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2', [userId, input.level])
    }
    if (input.roleIds) {
      const valid = await tx.many<{ id: string }>('SELECT id FROM roles WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [input.roleIds])
      if (valid.length !== new Set(input.roleIds).size) throw new ApiError(400, 'One of the roles is not in this workspace.')
      await tx.query('DELETE FROM user_roles WHERE workspace_id = $1 AND user_id = $2', [userId])
      for (const r of valid) await tx.query('INSERT INTO user_roles (workspace_id, user_id, role_id) VALUES ($1, $2, $3)', [userId, r.id])
    }
    await audit(tx.raw, { ctx, action: 'user.updated', targetType: 'user', targetId: userId, before,
                          after: { level: input.level ?? before.level, role_ids: input.roleIds ?? before.role_ids } })
    return { ok: true }
  })
}

/** Deactivate: move unacknowledged leads away (Offline), mark deactivated, end sessions. Never delete. */
export async function deactivateUser(ctx: Ctx, userId: string) {
  requirePermission(ctx, 'users.manage')
  const t = await loadTarget(ctx, userId)
  if (t.deactivated_at) return { ok: true }
  const db = scoped(ctx)
  await db.raw.query(`SELECT change_availability($1, 'offline', $2)`, [userId, ctx.userId])
  return db.tx(async tx => {
    await tx.query('UPDATE users SET deactivated_at = now() WHERE workspace_id = $1 AND id = $2', [userId])
    await tx.query('DELETE FROM sessions WHERE workspace_id = $1 AND user_id = $2', [userId])
    await audit(tx.raw, { ctx, action: 'user.deactivated', targetType: 'user', targetId: userId, after: { deactivated: true } })
    return { ok: true }
  })
}

export async function listAudit(ctx: Ctx, f: { action?: string; userId?: string; from?: string; to?: string; page?: number }) {
  requirePermission(ctx, 'audit.view')
  const page = Math.max(1, f.page ?? 1)
  const db = scoped(ctx)
  const rows = await db.many(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.before, a.after, a.created_at, u.name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.workspace_id = $1
        AND ($2::text IS NULL OR a.action ILIKE $2 || '%')
        AND ($3::uuid IS NULL OR a.actor_id = $3)
        AND ($4::date IS NULL OR a.created_at >= $4::date)
        AND ($5::date IS NULL OR a.created_at < $5::date + 1)
      ORDER BY a.created_at DESC, a.id
      LIMIT 51 OFFSET $6`,
    [f.action || null, f.userId && uuid.safeParse(f.userId).success ? f.userId : null, f.from || null, f.to || null, (page - 1) * 50])
  const actions = await db.many<{ action: string }>('SELECT DISTINCT action FROM audit_logs WHERE workspace_id = $1 ORDER BY 1')
  // F1.4 applies to the audit log too: hide opportunity values from viewers without the permission
  const canSeeValue = hasPermission(ctx, 'opportunity_value.view')
  const mask = (v: unknown) =>
    v && typeof v === 'object' && 'value' in v ? { ...(v as Record<string, unknown>), value: null, value_masked: true } : v
  const safe = rows.slice(0, 50).map(r =>
    canSeeValue || r.target_type !== 'opportunity' ? r : { ...r, before: mask(r.before), after: mask(r.after) })
  return { rows: safe, hasMore: rows.length > 50, page, actions: actions.map(a => a.action) }
}
