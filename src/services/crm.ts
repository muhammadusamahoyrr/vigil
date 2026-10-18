// Contacts, companies, opportunities, pipeline moves and CSV export (Step 4, core).
// Every response with opportunities goes through serialize() (list, detail AND export).
import 'server-only'
import { z } from 'zod'
import { scoped, type Scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { requirePermission, serializeOpportunities } from '@/lib/rbac'

const uuid = z.string().uuid()
const PAGE = 50
const notFound = (what: string) => new ApiError(404, `${what} not found.`)

export async function listContacts(ctx: Ctx, opts: { q?: string; page?: number }) {
  requirePermission(ctx, 'crm.view')
  const page = Math.max(1, opts.page ?? 1)
  const rows = await scoped(ctx).many(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at, co.name AS company_name,
            (SELECT count(*)::int FROM opportunities o WHERE o.contact_id = c.id) AS opportunities,
            (SELECT u.name FROM leads l JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
               JOIN users u ON u.id = a.user_id WHERE l.contact_id = c.id ORDER BY l.created_at DESC LIMIT 1) AS assigned_to
       FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
      WHERE c.workspace_id = $1
        AND ($2::text IS NULL OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%' OR c.email ILIKE '%' || $2 || '%')
      ORDER BY c.created_at DESC LIMIT ${PAGE + 1} OFFSET $3`,
    [opts.q?.trim() || null, (page - 1) * PAGE])
  return { contacts: rows.slice(0, PAGE), hasMore: rows.length > PAGE, page }
}

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  phone: z.string().trim().transform(v => v.replace(/[\s\-()]/g, '')).refine(v => v === '' || /^\+?[0-9]{7,15}$/.test(v), 'Enter 7 to 15 digits, e.g. +923001234567.').optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional().or(z.literal('')),
  companyName: z.string().trim().max(120).optional(),
  version: z.number().int().optional(),
})

async function companyId(tx: Scoped, name?: string) {
  if (!name) return null
  const found = await tx.maybeOne<{ id: string }>('SELECT id FROM companies WHERE workspace_id = $1 AND lower(name) = lower($2) LIMIT 1', [name])
  if (found) return found.id
  return (await tx.one<{ id: string }>('INSERT INTO companies (workspace_id, name) VALUES ($1, $2) RETURNING id', [name])).id
}

export async function createContact(ctx: Ctx, input: z.infer<typeof contactSchema>) {
  requirePermission(ctx, 'crm.create')
  try {
    return await scoped(ctx).tx(async tx => {
      const cid = await companyId(tx, input.companyName)
      const c = await tx.one<{ id: string }>(
        'INSERT INTO contacts (workspace_id, name, phone, email, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [input.name, input.phone || null, input.email || null, cid])
      await tx.query(`INSERT INTO activities (workspace_id, contact_id, actor_id, kind, body) VALUES ($1, $2, $3, 'created', 'Contact created')`, [c.id, ctx.userId])
      await audit(tx.raw, { ctx, action: 'contact.created', targetType: 'contact', targetId: c.id, after: input })
      return { id: c.id }
    })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'A contact with this phone number already exists.', { phone: 'Already used.' })
    throw e
  }
}

export async function updateContact(ctx: Ctx, id: string, input: z.infer<typeof contactSchema>) {
  requirePermission(ctx, 'crm.edit')
  if (!uuid.safeParse(id).success) throw notFound('Contact')
  return scoped(ctx).tx(async tx => {
    const before = await tx.maybeOne('SELECT name, phone, email, company_id, version FROM contacts WHERE workspace_id = $1 AND id = $2', [id])
    if (!before) throw notFound('Contact')
    const cid = await companyId(tx, input.companyName)
    const r = await tx.query(
      `UPDATE contacts SET name = $3, phone = $4, email = $5, company_id = $6, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND version = $7`,
      [id, input.name, input.phone || null, input.email || null, cid, input.version ?? before.version])
    if (r.rowCount === 0) throw new ApiError(409, 'Someone else changed this contact. Reload and try again.')
    await tx.query(`INSERT INTO activities (workspace_id, contact_id, actor_id, kind, body) VALUES ($1, $2, $3, 'field_edit', 'Contact details edited')`, [id, ctx.userId])
    await audit(tx.raw, { ctx, action: 'contact.updated', targetType: 'contact', targetId: id, before, after: input })
    return { ok: true }
  })
}

export async function deleteContact(ctx: Ctx, id: string) {
  requirePermission(ctx, 'crm.delete')
  if (!uuid.safeParse(id).success) throw notFound('Contact')
  const db = scoped(ctx)
  const blockers = await db.maybeOne<{ leads: number; opps: number; conv: number; pay: number; appt: number }>(
    `SELECT (SELECT count(*)::int FROM leads WHERE contact_id = c.id) AS leads,
            (SELECT count(*)::int FROM opportunities WHERE contact_id = c.id) AS opps,
            (SELECT count(*)::int FROM conversations WHERE contact_id = c.id) AS conv,
            (SELECT count(*)::int FROM payments WHERE contact_id = c.id) AS pay,
            (SELECT count(*)::int FROM appointments WHERE contact_id = c.id) AS appt
       FROM contacts c WHERE c.workspace_id = $1 AND c.id = $2`, [id])
  if (!blockers) throw notFound('Contact')
  const parts = [['lead', blockers.leads], ['opportunity', blockers.opps], ['conversation', blockers.conv], ['payment', blockers.pay], ['appointment', blockers.appt]]
    .filter(([, n]) => Number(n) > 0).map(([w, n]) => `${n} ${w}${Number(n) > 1 ? 's' : ''}`)
  if (parts.length) throw new ApiError(409, `This contact has history (${parts.join(', ')}) and cannot be deleted.`)
  return db.tx(async tx => {
    const before = await tx.one('SELECT name, phone, email FROM contacts WHERE workspace_id = $1 AND id = $2', [id])
    await tx.query('DELETE FROM contacts WHERE workspace_id = $1 AND id = $2', [id])
    await audit(tx.raw, { ctx, action: 'contact.deleted', targetType: 'contact', targetId: id, before })
    return { ok: true }
  })
}

/** F2.8: everything about one customer on one page. */
export async function getContact(ctx: Ctx, id: string) {
  requirePermission(ctx, 'crm.view')
  if (!uuid.safeParse(id).success) throw notFound('Contact')
  const db = scoped(ctx)
  const contact = await db.maybeOne(
    `SELECT c.*, co.name AS company_name FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
      WHERE c.workspace_id = $1 AND c.id = $2`, [id])
  if (!contact) throw notFound('Contact')
  const opportunities = serializeOpportunities(ctx, await db.many(
    `SELECT o.id, o.name, o.value, o.currency, o.payment_status, o.version, o.created_at, s.name AS stage_name,
            p.name AS pipeline_name, u.name AS owner_name
       FROM opportunities o JOIN stages s ON s.id = o.stage_id JOIN pipelines p ON p.id = o.pipeline_id
       LEFT JOIN users u ON u.id = o.owner_id
      WHERE o.workspace_id = $1 AND o.contact_id = $2 ORDER BY o.created_at DESC`, [id]))
  const leads = await db.many(
    `SELECT l.id, l.source, l.status, l.created_at, u.name AS owner_name, a.acknowledged_at
       FROM leads l LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
       LEFT JOIN users u ON u.id = a.user_id
      WHERE l.workspace_id = $1 AND l.contact_id = $2 ORDER BY l.created_at DESC`, [id])
  const conversations = await db.many(
    `SELECT cv.id, cv.channel, cv.last_message_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id) AS messages
       FROM conversations cv WHERE cv.workspace_id = $1 AND cv.contact_id = $2`, [id])
  const payments = await db.many(
    `SELECT p.id, p.amount, p.currency, p.status, p.provider_ref, p.created_at, u.name AS requested_by
       FROM payments p JOIN users u ON u.id = p.requested_by WHERE p.workspace_id = $1 AND p.contact_id = $2
      ORDER BY p.created_at DESC`, [id])
  const appointments = await db.many(
    `SELECT a.id, a.title, a.starts_at_utc, a.ends_at_utc, a.timezone, a.status, u.name AS employee
       FROM appointments a JOIN users u ON u.id = a.user_id WHERE a.workspace_id = $1 AND a.contact_id = $2
      ORDER BY a.starts_at_utc DESC`, [id])
  const activities = await db.many(
    `SELECT act.id, act.kind, act.body, act.created_at, u.name AS actor_name
       FROM activities act LEFT JOIN users u ON u.id = act.actor_id
      WHERE act.workspace_id = $1 AND act.contact_id = $2 ORDER BY act.created_at DESC LIMIT 100`, [id])
  return { contact, opportunities, leads, conversations, payments, appointments, activities }
}

// ---------- opportunities and pipeline ----------

export async function pipelines(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  const db = scoped(ctx)
  const ps = await db.many<{ id: string; name: string }>('SELECT id, name FROM pipelines WHERE workspace_id = $1 ORDER BY position, name')
  const stages = await db.many<{ id: string; pipeline_id: string; name: string; position: number; is_won: boolean; is_lost: boolean; required_fields: string[] }>(
    'SELECT id, pipeline_id, name, position, is_won, is_lost, required_fields FROM stages WHERE workspace_id = $1 ORDER BY position')
  return ps.map(p => ({ ...p, stages: stages.filter(s => s.pipeline_id === p.id) }))
}

export const opportunitySchema = z.object({
  contactId: uuid,
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  value: z.coerce.number().min(0, 'Value cannot be negative.').max(1e12),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. PKR.').default('PKR'),
  pipelineId: uuid.optional(),
})

export async function createOpportunity(ctx: Ctx, input: z.infer<typeof opportunitySchema>) {
  requirePermission(ctx, 'crm.create')
  return scoped(ctx).tx(async tx => {
    const contact = await tx.maybeOne('SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2', [input.contactId])
    if (!contact) throw notFound('Contact')
    const stage = await tx.maybeOne<{ id: string; pipeline_id: string }>(
      `SELECT s.id, s.pipeline_id FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE s.workspace_id = $1 AND ($2::uuid IS NULL OR p.id = $2) ORDER BY p.position, s.position LIMIT 1`, [input.pipelineId ?? null])
    if (!stage) throw new ApiError(400, 'Create a pipeline with at least one stage first.')
    const o = await tx.one<{ id: string }>(
      `INSERT INTO opportunities (workspace_id, contact_id, pipeline_id, stage_id, name, value, currency, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.contactId, stage.pipeline_id, stage.id, input.name, input.value, input.currency, ctx.userId])
    await tx.query(`INSERT INTO activities (workspace_id, contact_id, opportunity_id, actor_id, kind, body) VALUES ($1, $2, $3, $4, 'created', $5)`,
      [input.contactId, o.id, ctx.userId, `Opportunity "${input.name}" created`])
    await audit(tx.raw, { ctx, action: 'opportunity.created', targetType: 'opportunity', targetId: o.id, after: input })
    return { id: o.id }
  })
}

export async function board(ctx: Ctx, pipelineId?: string) {
  requirePermission(ctx, 'crm.view')
  const ps = await pipelines(ctx)
  const p = ps.find(x => x.id === pipelineId) ?? ps[0]
  if (!p) return { pipelines: ps, pipeline: null, opportunities: [] }
  const opps = serializeOpportunities(ctx, await scoped(ctx).many(
    `SELECT o.id, o.name, o.value, o.currency, o.stage_id, o.version, o.custom_data, o.payment_status,
            c.name AS contact_name, c.id AS contact_id, u.name AS owner_name
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id LEFT JOIN users u ON u.id = o.owner_id
      WHERE o.workspace_id = $1 AND o.pipeline_id = $2 ORDER BY o.created_at DESC LIMIT 500`, [p.id]))
  return { pipelines: ps, pipeline: p, opportunities: opps }
}

export const moveSchema = z.object({ stageId: uuid, version: z.number().int() })

/** F2.4: entering a stage with required fields is blocked until they are filled. */
export async function moveOpportunity(ctx: Ctx, oppId: string, stageId: string, version: number) {
  requirePermission(ctx, 'crm.edit')
  if (!uuid.safeParse(oppId).success) throw notFound('Opportunity')
  const db = scoped(ctx)
  return db.tx(async tx => {
    const o = await tx.maybeOne<{ id: string; pipeline_id: string; stage_id: string; contact_id: string; custom_data: Record<string, unknown>; name: string }>(
      'SELECT id, pipeline_id, stage_id, contact_id, custom_data, name FROM opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [oppId])
    if (!o) throw notFound('Opportunity')
    const to = await tx.maybeOne<{ id: string; name: string; required_fields: string[]; pipeline_id: string }>(
      'SELECT id, name, required_fields, pipeline_id FROM stages WHERE workspace_id = $1 AND id = $2', [stageId])
    if (!to || to.pipeline_id !== o.pipeline_id) throw new ApiError(400, 'That stage belongs to another pipeline.')
    const missing = to.required_fields.filter(k => {
      const v = o.custom_data?.[k]
      return v === undefined || v === null || v === ''
    })
    if (missing.length) {
      const labels = await tx.many<{ key: string; label: string }>(
        'SELECT key, label FROM field_definitions WHERE workspace_id = $1 AND key = ANY($2::text[])', [missing])
      const names = missing.map(k => labels.find(l => l.key === k)?.label ?? k)
      throw new ApiError(400, `Fill these fields before moving to "${to.name}": ${names.join(', ')}.`)
    }
    const from = await tx.one<{ name: string }>('SELECT name FROM stages WHERE workspace_id = $1 AND id = $2', [o.stage_id])
    const r = await tx.query(
      `UPDATE opportunities SET stage_id = $3, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND version = $4`, [oppId, stageId, version])
    if (r.rowCount === 0) throw new ApiError(409, 'Someone else changed this opportunity. Reload and try again.')
    await tx.query(`INSERT INTO activities (workspace_id, contact_id, opportunity_id, actor_id, kind, body) VALUES ($1, $2, $3, $4, 'stage_change', $5)`,
      [o.contact_id, oppId, ctx.userId, `"${o.name}" moved from ${from.name} to ${to.name}`])
    await audit(tx.raw, { ctx, action: 'opportunity.stage_changed', targetType: 'opportunity', targetId: oppId,
                          before: { stage: from.name }, after: { stage: to.name } })
    // a human stage move counts as action on the contact's open lead (CLAUDE.md)
    const lead = await tx.maybeOne<{ id: string }>(`SELECT id FROM leads WHERE workspace_id = $1 AND contact_id = $2 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [o.contact_id])
    if (lead) await tx.raw.query(`SELECT record_lead_action($1, $2, 'human', 'stage_change')`, [lead.id, ctx.userId])
    return { ok: true }
  })
}

// ---------- CSV export (same serialize() as list and detail) ----------

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  // neutralise spreadsheet formulas and quote everything
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export async function exportCsv(ctx: Ctx, entity: string) {
  requirePermission(ctx, 'crm.export')
  const db = scoped(ctx)
  let rows: Record<string, unknown>[]
  if (entity === 'contacts') {
    rows = await db.many(
      `SELECT c.name, c.phone, c.email, co.name AS company, c.created_at FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id WHERE c.workspace_id = $1 ORDER BY c.created_at`)
  } else if (entity === 'opportunities') {
    rows = serializeOpportunities(ctx, await db.many(
      `SELECT o.name, c.name AS contact, s.name AS stage, o.value, o.currency, o.payment_status, o.created_at
         FROM opportunities o JOIN contacts c ON c.id = o.contact_id JOIN stages s ON s.id = o.stage_id
        WHERE o.workspace_id = $1 ORDER BY o.created_at`))
  } else {
    throw new ApiError(404, 'Unknown export.')
  }
  const cols = rows.length ? Object.keys(rows[0]) : ['empty']
  return [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n')
}
