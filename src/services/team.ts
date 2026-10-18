// Team members, availability and assignment rules.
import 'server-only'
import { hash } from '@node-rs/argon2'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { hasPermission, requirePermission } from '@/lib/rbac'

export const AVAILABILITY = ['available', 'busy', 'on_leave', 'offline'] as const

export async function listTeam(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  return scoped(ctx).many(
    `SELECT u.id, u.name, u.email, u.level, u.availability, u.deactivated_at,
            u.slack_user_id IS NOT NULL AS slack_linked,
            (SELECT count(*)::int FROM lead_assignments a WHERE a.user_id = u.id AND a.closed_at IS NULL) AS open_leads,
            COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id), '{}') AS roles
       FROM users u
      WHERE u.workspace_id = $1
      ORDER BY u.deactivated_at NULLS FIRST, u.name`)
}

export async function listRoles(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  return scoped(ctx).many<{ id: string; name: string }>(
    'SELECT id, name FROM roles WHERE workspace_id = $1 ORDER BY name')
}

export const availabilitySchema = z.object({ status: z.enum(AVAILABILITY) })

/** Only through change_availability (CLAUDE.md). Self always; others need users.manage; only the Owner changes the Owner. */
export async function setAvailability(ctx: Ctx, userId: string, status: (typeof AVAILABILITY)[number]) {
  if (!z.string().uuid().safeParse(userId).success) throw new ApiError(404, 'User not found.')
  const db = scoped(ctx)
  const target = await db.maybeOne<{ level: string }>('SELECT level FROM users WHERE workspace_id = $1 AND id = $2', [userId])
  if (!target) throw new ApiError(404, 'User not found.')
  if (userId !== ctx.userId) {
    requirePermission(ctx, 'users.manage')
    if (target.level === 'owner' && ctx.level !== 'owner') throw new ApiError(403, 'An Admin cannot change the Owner.')
  }
  const { rows } = await db.raw.query<{ moved: number }>(
    'SELECT change_availability($1, $2, $3) AS moved', [userId, status, ctx.isSystem ? null : ctx.userId])
  return { moved: rows[0].moved }
}

export const addMemberSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(10, 'Temporary password must be at least 10 characters.').max(200),
  level: z.enum(['admin', 'user']),
  roleId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
})

/** Quick team setup for the demo (invites come in Step 3): the member logs in with the temporary password. */
export async function addMember(ctx: Ctx, input: z.infer<typeof addMemberSchema>) {
  requirePermission(ctx, 'users.manage')
  const passwordHash = await hash(input.password, { algorithm: 2 })
  try {
    return await scoped(ctx).tx(async tx => {
      const u = await tx.one<{ id: string }>(
        `INSERT INTO users (workspace_id, email, name, password_hash, level) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.email, input.name, passwordHash, input.level])
      if (input.roleId) {
        await tx.one('SELECT id FROM roles WHERE workspace_id = $1 AND id = $2', [input.roleId])
        await tx.query('INSERT INTO user_roles (workspace_id, user_id, role_id) VALUES ($1, $2, $3)', [u.id, input.roleId])
      }
      await audit(tx.raw, { ctx, action: 'user.created', targetType: 'user', targetId: u.id,
                            after: { email: input.email, name: input.name, level: input.level, role_id: input.roleId ?? null } })
      return { userId: u.id }
    })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'Someone already uses this email.', { email: 'Already registered.' })
    throw e
  }
}

const level = z.object({ type: z.enum(['next_available', 'backup', 'manager']), seconds: z.number().int().min(5).max(86_400) })
export const rulesSchema = z.object({
  ackWindowSeconds: z.number().int().min(5, 'At least 5 seconds.').max(86_400),
  maxOpenLeads: z.number().int().min(1).max(1000),
  idleSeconds: z.number().int().min(10).max(30 * 86_400),
  escalationLevels: z.array(level).min(1, 'Add at least one escalation level.').max(10),
  backupUserId: z.string().uuid().nullable(),
  managerRoleId: z.string().uuid().nullable(),
})

export async function getRules(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  return scoped(ctx).one(
    `SELECT ack_window_seconds, max_open_leads, idle_seconds, escalation_levels, backup_user_id,
            manager_role_id, retry_seconds, version
       FROM assignment_rules WHERE workspace_id = $1`)
}

export async function updateRules(ctx: Ctx, input: z.infer<typeof rulesSchema>) {
  requirePermission(ctx, 'assignment_rules.manage')
  return scoped(ctx).tx(async tx => {
    const before = await tx.one('SELECT * FROM assignment_rules WHERE workspace_id = $1 FOR UPDATE')
    const after = await tx.one(
      `UPDATE assignment_rules
          SET ack_window_seconds = $2, max_open_leads = $3, idle_seconds = $4, escalation_levels = $5,
              backup_user_id = $6, manager_role_id = $7, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 RETURNING *`,
      [input.ackWindowSeconds, input.maxOpenLeads, input.idleSeconds, JSON.stringify(input.escalationLevels),
       input.backupUserId, input.managerRoleId])
    await audit(tx.raw, { ctx, action: 'assignment_rules.updated', targetType: 'assignment_rules',
                          targetId: ctx.workspaceId, before, after })
    return after
  }).catch(e => {
    if ((e as { code?: string }).code === '23503') throw new ApiError(400, 'The backup user or manager role is not in this workspace.')
    throw e
  })
}

export const canManageRules = (ctx: Ctx) => hasPermission(ctx, 'assignment_rules.manage')
