// Agent inbox for web chat conversations, plus in-app notifications.
// Visibility: Owner/Admin/leads.reassign see every conversation; others only
// conversations whose lead they currently own. Anything else is a 404.
import 'server-only'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { hasPermission, requirePermission, seesAllLeads } from '@/lib/rbac'

const uuid = z.string().uuid()

export async function listConversations(ctx: Ctx) {
  requirePermission(ctx, 'conversations.view')
  const all = seesAllLeads(ctx)
  return scoped(ctx).many(
    `SELECT cv.id, cv.channel, cv.last_message_at, c.name AS contact_name, l.id AS lead_id, l.status AS lead_status,
            a.user_id AS owner_id, u.name AS owner_name, a.acknowledged_at, a.deadline_at, a.level, a.reason,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'in'
               AND m.created_at > COALESCE(cv.agent_read_at, '-infinity')) AS unread,
            (SELECT left(m.body, 80) FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM conversations cv
       JOIN contacts c ON c.id = cv.contact_id
       LEFT JOIN leads l ON l.id = cv.lead_id
       LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
       LEFT JOIN users u ON u.id = a.user_id
      WHERE cv.workspace_id = $1 AND ($2::boolean OR a.user_id = $3)
      ORDER BY cv.last_message_at DESC NULLS LAST
      LIMIT 100`, [all, ctx.userId])
}

export async function unreadConversations(ctx: Ctx): Promise<number> {
  if (!hasPermission(ctx, 'conversations.view')) return 0
  const r = await scoped(ctx).one<{ n: number }>(
    `SELECT count(*)::int AS n FROM conversations cv
       LEFT JOIN lead_assignments a ON a.lead_id = cv.lead_id AND a.closed_at IS NULL
      WHERE cv.workspace_id = $1 AND ($2::boolean OR a.user_id = $3)
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'in'
                     AND m.created_at > COALESCE(cv.agent_read_at, '-infinity'))`, [seesAllLeads(ctx), ctx.userId])
  return r.n
}

async function visibleConversation(ctx: Ctx, id: string) {
  requirePermission(ctx, 'conversations.view')
  if (!uuid.safeParse(id).success) throw new ApiError(404, 'Conversation not found.')
  const cv = await scoped(ctx).maybeOne(
    `SELECT cv.id, cv.channel, cv.contact_id, cv.customer_read_at, c.name AS contact_name, c.phone, c.email,
            l.id AS lead_id, l.status AS lead_status, l.source,
            a.id AS assignment_id, a.user_id AS owner_id, u.name AS owner_name, a.acknowledged_at, a.deadline_at, a.level, a.reason, a.retry_at
       FROM conversations cv
       JOIN contacts c ON c.id = cv.contact_id
       LEFT JOIN leads l ON l.id = cv.lead_id
       LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
       LEFT JOIN users u ON u.id = a.user_id
      WHERE cv.workspace_id = $1 AND cv.id = $2`, [id])
  if (!cv || (!seesAllLeads(ctx) && cv.owner_id !== ctx.userId)) throw new ApiError(404, 'Conversation not found.')
  return cv
}

export async function getConversation(ctx: Ctx, id: string) {
  const cv = await visibleConversation(ctx, id)
  const db = scoped(ctx)
  const messages = await db.many(
    `SELECT m.id, m.direction, m.body, m.created_at, m.delivery_status, u.name AS sent_by_name
       FROM messages m LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.workspace_id = $1 AND m.conversation_id = $2 ORDER BY m.created_at, m.id`, [id])
  const escalations = cv.lead_id ? (await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead_assignments WHERE workspace_id = $1 AND lead_id = $2 AND outcome = 'escalated'`, [cv.lead_id])).n : 0
  // the owner (or an unowned conversation's viewer) reading it clears the unread count
  if (cv.owner_id === ctx.userId || !cv.owner_id) {
    await db.query('UPDATE conversations SET agent_read_at = now() WHERE workspace_id = $1 AND id = $2', [id])
    await db.query(`UPDATE notifications SET read_at = now() WHERE workspace_id = $1 AND user_id = $2 AND conversation_id = $3 AND read_at IS NULL`, [ctx.userId, id])
  }
  return { conversation: cv, messages, escalations }
}

export const replySchema = z.object({ body: z.string().trim().min(1, 'Write a reply first.').max(2000, 'Replies can be at most 2000 characters.') })

/** First-party reply: stored and shown to the customer in realtime. No external provider. */
export async function replyToConversation(ctx: Ctx, id: string, body: string) {
  const cv = await visibleConversation(ctx, id)
  requirePermission(ctx, 'conversations.send')
  if (cv.channel !== 'web') throw new ApiError(409, 'Replies on this channel need the Twilio integration, which is not configured.')
  return scoped(ctx).tx(async tx => {
    const m = await tx.one<{ id: string }>(
      `INSERT INTO messages (workspace_id, conversation_id, direction, body, delivery_status, sent_by)
       VALUES ($1, $2, 'out', $3, 'sent', $4) RETURNING id`, [id, body, ctx.userId])
    await tx.query('UPDATE conversations SET last_message_at = now(), agent_read_at = now() WHERE workspace_id = $1 AND id = $2', [id])
    await tx.query(`INSERT INTO activities (workspace_id, contact_id, lead_id, actor_id, kind, body) VALUES ($1, $2, $3, $4, 'message', $5)`,
      [cv.contact_id, cv.lead_id, ctx.userId, `Reply: ${body.slice(0, 200)}`])
    await audit(tx.raw, { ctx, action: 'conversation.replied', targetType: 'conversation', targetId: id, after: { message_id: m.id } })
    // a reply is a recorded human action: it acknowledges the lead when the owner sends it
    let acknowledged = false
    if (cv.lead_id && cv.lead_status === 'open') {
      const r = await tx.raw.query<{ ok: boolean }>(`SELECT record_lead_action($1, $2, 'human', 'message') AS ok`, [cv.lead_id, ctx.userId])
      acknowledged = r.rows[0].ok
    }
    return { messageId: m.id, acknowledged }
  })
}

// ---------- notifications ----------

export async function listNotifications(ctx: Ctx) {
  return scoped(ctx).many(
    `SELECT id, kind, title, body, lead_id, conversation_id, read_at, created_at FROM notifications
      WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100`, [ctx.userId])
}

export async function unreadNotifications(ctx: Ctx): Promise<number> {
  return (await scoped(ctx).one<{ n: number }>(
    'SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL', [ctx.userId])).n
}

export const markReadSchema = z.object({ ids: z.array(uuid).max(200).optional(), all: z.boolean().optional() })

export async function markNotificationsRead(ctx: Ctx, input: z.infer<typeof markReadSchema>) {
  const r = await scoped(ctx).query(
    `UPDATE notifications SET read_at = now()
      WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL AND ($3::boolean OR id = ANY($4::uuid[]))`,
    [ctx.userId, !!input.all, input.ids ?? []])
  return { marked: r.rowCount }
}
