// Lead intake, views and actions. Assignment, acknowledgement, escalation and
// reassignment are done ONLY by the SQL functions in sql/002_lead_engine.sql.
import 'server-only'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { requirePermission, seesAllLeads } from '@/lib/rbac'

const PAGE_SIZE = 50

const phone = z.string().trim()
  .transform(v => v.replace(/[\s\-()]/g, ''))
  .refine(v => /^\+?[0-9]{7,15}$/.test(v), 'Enter a phone number with 7 to 15 digits, e.g. +923001234567.')

export const createLeadSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254).optional()
    .or(z.literal('').transform(() => undefined)),
  message: z.string().trim().max(2000).optional(),
})

export type LeadSource = 'manual' | 'form' | 'message'

/** Insert/find the contact (matched by phone), insert the lead, assign it: ONE transaction. */
export async function createLead(ctx: Ctx, input: z.infer<typeof createLeadSchema>, source: LeadSource) {
  requirePermission(ctx, 'crm.create')
  const actor = ctx.isSystem ? null : ctx.userId
  return scoped(ctx).tx(async tx => {
    const contact = input.phone
      ? await tx.one<{ id: string; created: boolean }>(
          `INSERT INTO contacts (workspace_id, name, phone, email) VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, phone) WHERE phone IS NOT NULL
           DO UPDATE SET updated_at = now()
           RETURNING id, (xmax = 0) AS created`,
          [input.name, input.phone, input.email ?? null])
      : await tx.one<{ id: string; created: boolean }>(
          `INSERT INTO contacts (workspace_id, name, email) VALUES ($1, $2, $3) RETURNING id, true AS created`,
          [input.name, input.email ?? null])

    const lead = await tx.one<{ id: string }>(
      `INSERT INTO leads (workspace_id, contact_id, source) VALUES ($1, $2, $3) RETURNING id`,
      [contact.id, source])

    if (contact.created) {
      await tx.query(
        `INSERT INTO activities (workspace_id, contact_id, actor_id, kind, body) VALUES ($1, $2, $3, 'created', $4)`,
        [contact.id, actor, `Contact created from ${source} lead`])
    }
    await tx.query(
      `INSERT INTO activities (workspace_id, contact_id, lead_id, actor_id, kind, body, data)
       VALUES ($1, $2, $3, $4, 'created', $5, $6)`,
      [contact.id, lead.id, actor, input.message || `New ${source} lead`, JSON.stringify({ source })])
    await audit(tx.raw, { ctx, action: 'lead.created', targetType: 'lead', targetId: lead.id,
                          after: { source, contact_id: contact.id } })

    // same transaction, as CLAUDE.md requires; the SQL also enqueues the owner's alert
    const { rows } = await tx.raw.query<{ id: string | null }>('SELECT assign_new_lead($1) AS id', [lead.id])
    return { leadId: lead.id, contactId: contact.id, assignmentId: rows[0].id }
  })
}

export async function listLeads(ctx: Ctx, opts: { mine?: boolean; status?: string; page?: number; today?: boolean }) {
  requirePermission(ctx, 'crm.view')
  const onlyMine = opts.mine || !seesAllLeads(ctx)
  const page = Math.max(1, opts.page ?? 1)
  const rows = await scoped(ctx).many(
    `SELECT l.id, l.source, l.status, l.created_at, c.name AS contact_name, c.phone,
            a.id AS assignment_id, a.user_id AS owner_id, u.name AS owner_name,
            a.deadline_at, a.acknowledged_at, a.level,
            (SELECT count(*)::int FROM lead_assignments e WHERE e.lead_id = l.id AND e.outcome = 'escalated') AS escalations
       FROM leads l
       JOIN contacts c ON c.id = l.contact_id AND c.workspace_id = l.workspace_id
       LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
       LEFT JOIN users u ON u.id = a.user_id
       JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.workspace_id = $1
        AND ($2::uuid IS NULL OR a.user_id = $2)
        AND ($3::text IS NULL OR l.status = $3)
        -- same "today" as the dashboard tile (local midnight in the workspace timezone)
        AND (NOT $5::boolean OR l.created_at >= (date_trunc('day', now() AT TIME ZONE w.timezone) AT TIME ZONE w.timezone))
      ORDER BY l.created_at DESC
      LIMIT ${PAGE_SIZE + 1} OFFSET $4`,
    [onlyMine ? ctx.userId : null, opts.status ?? null, (page - 1) * PAGE_SIZE, !!opts.today])
  return { leads: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE, onlyMine, canSeeAll: seesAllLeads(ctx) }
}

export async function getLead(ctx: Ctx, leadId: string) {
  requirePermission(ctx, 'crm.view')
  if (!z.string().uuid().safeParse(leadId).success) throw new ApiError(404, 'Lead not found.')
  const db = scoped(ctx)
  const lead = await db.maybeOne(
    `SELECT l.id, l.source, l.status, l.created_at, l.last_human_action_at, l.contact_id,
            c.name AS contact_name, c.phone, c.email, c.opted_out,
            a.id AS assignment_id, a.user_id AS owner_id, u.name AS owner_name, u.availability AS owner_availability,
            a.deadline_at, a.acknowledged_at, a.level, a.assigned_at
       FROM leads l
       JOIN contacts c ON c.id = l.contact_id AND c.workspace_id = l.workspace_id
       LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
       LEFT JOIN users u ON u.id = a.user_id
      WHERE l.workspace_id = $1 AND l.id = $2`, [leadId])
  // another workspace's lead, or (for a plain user) someone else's lead: 404, not 403
  if (!lead || (!seesAllLeads(ctx) && lead.owner_id !== ctx.userId)) throw new ApiError(404, 'Lead not found.')

  const history = await db.many(
    `SELECT a.id, a.user_id, u.name AS user_name, a.level, a.reason, a.assigned_at, a.deadline_at,
            a.acknowledged_at, a.closed_at, a.outcome, a.retry_at
       FROM lead_assignments a JOIN users u ON u.id = a.user_id
      WHERE a.workspace_id = $1 AND a.lead_id = $2
      ORDER BY a.assigned_at, a.id`, [leadId])
  const activities = await db.many(
    `SELECT act.id, act.kind, act.body, act.data, act.created_at, u.name AS actor_name
       FROM activities act LEFT JOIN users u ON u.id = act.actor_id
      WHERE act.workspace_id = $1 AND (act.lead_id = $2 OR (act.contact_id = $3 AND act.lead_id IS NULL))
      ORDER BY act.created_at DESC LIMIT 100`, [leadId, lead.contact_id])
  const conversation = await db.maybeOne<{ id: string }>(
    'SELECT id FROM conversations WHERE workspace_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 1', [leadId])
  return { lead, history, activities, conversationId: conversation?.id ?? null }
}

export async function acknowledgeLead(ctx: Ctx, leadId: string) {
  const { lead } = await getLead(ctx, leadId)
  if (lead.owner_id !== ctx.userId) throw new ApiError(409, 'Only the current owner can acknowledge this lead.')
  if (lead.acknowledged_at) return { acknowledged: false, alreadyAcknowledged: true }
  const { rows } = await scoped(ctx).raw.query<{ ok: boolean }>(
    `SELECT record_lead_action($1, $2, 'human', 'button') AS ok`, [leadId, ctx.userId])
  return { acknowledged: rows[0].ok, alreadyAcknowledged: false }
}

export const noteSchema = z.object({ body: z.string().trim().min(1, 'Write a note first.').max(4000) })

/** A note is a recorded human action: it acknowledges the lead if the owner writes it. */
export async function addLeadNote(ctx: Ctx, leadId: string, body: string) {
  const { lead } = await getLead(ctx, leadId)
  return scoped(ctx).tx(async tx => {
    await tx.query(
      `INSERT INTO activities (workspace_id, contact_id, lead_id, actor_id, kind, body) VALUES ($1, $2, $3, $4, 'note', $5)`,
      [lead.contact_id, leadId, ctx.userId, body])
    const { rows } = await tx.raw.query<{ ok: boolean }>(
      `SELECT record_lead_action($1, $2, 'human', 'note') AS ok`, [leadId, ctx.userId])
    return { acknowledged: rows[0].ok }
  })
}

export const reassignSchema = z.object({ toUserId: z.string().uuid('Choose a person.') })

const ENGINE_MESSAGES: [RegExp, string][] = [
  [/not available to receive leads/, 'That person is not Available right now. Pick someone who is Available.'],
  [/already assigned to user/, 'The lead is already assigned to that person.'],
  [/is not open/, 'This lead is closed.'],
  [/does not belong/, 'That person is not in this workspace.'],
]

export async function reassignLead(ctx: Ctx, leadId: string, toUserId: string) {
  requirePermission(ctx, 'leads.reassign')
  await getLead(ctx, leadId)
  try {
    const { rows } = await scoped(ctx).raw.query<{ id: string }>(
      'SELECT reassign_manually($1, $2, $3) AS id', [leadId, toUserId, ctx.userId])
    return { assignmentId: rows[0].id }
  } catch (e) {
    const pg = e as { code?: string; message?: string }
    if (pg.code === 'P0001') {
      const hit = ENGINE_MESSAGES.find(([re]) => re.test(pg.message ?? ''))
      throw new ApiError(409, hit ? hit[1] : 'Could not reassign this lead.')
    }
    throw e
  }
}

export async function listRecovery(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  const onlyMine = !seesAllLeads(ctx)
  return scoped(ctx).many(
    `SELECT q.lead_id, q.reasons, q.escalation_count, q.deadline_at, q.acknowledged_at, q.source,
            q.lead_created_at, q.owner_id, q.owner_availability, c.name AS contact_name, u.name AS owner_name
       FROM recovery_queue q
       JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN users u ON u.id = q.owner_id
      WHERE q.workspace_id = $1 AND ($2::uuid IS NULL OR q.owner_id = $2)
      ORDER BY q.lead_created_at
      LIMIT 200`, [onlyMine ? ctx.userId : null])
}
