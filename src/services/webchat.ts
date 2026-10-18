// First-party Vigil Web Chat (customer side). Replaces Twilio WhatsApp, which
// cannot be configured from Pakistan (organizers allowed alternatives).
// The customer is anonymous: the workspace comes from the public slug (looked up
// in the DB), the conversation ONLY from a random token whose sha256 is stored.
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { findWorkspaceBySlug } from '@/db/auth'
import { scoped, type Scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import { ApiError } from '@/lib/errors'
import { systemCtx } from '@/lib/session'

export const CHAT_COOKIE = 'vigil_chat'
export const CHAT_COOKIE_DAYS = 30
export const chatCookiePath = (slug: string) => `/chat/${slug}`

export const hashChatToken = (token: string) => createHash('sha256').update(token).digest()

const phone = z.string().trim().transform(v => v.replace(/[\s\-()]/g, ''))
  .refine(v => v === '' || /^\+?[0-9]{7,15}$/.test(v), 'Enter a phone number with 7 to 15 digits, e.g. +923001234567.')

export const customerMessageSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Invalid request key.'),
  message: z.string().trim().min(1, 'Write a message.').max(2000, 'Messages can be at most 2000 characters.'),
  name: z.string().trim().max(120).optional(),
  phone: phone.optional(),
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.').optional().or(z.literal('')),
})

export async function resolveChatWorkspace(slug: string) {
  const ws = await findWorkspaceBySlug(slug)
  if (!ws) throw new ApiError(404, 'This chat does not exist.')
  return ws
}

/**
 * One customer message. First message of a session (no valid token): creates or
 * matches the contact, creates the conversation, stores the message, creates the
 * lead (or reuses the contact's open lead) and runs assign_new_lead, all in ONE
 * transaction. Later messages append and notify the current owner in-app.
 * The idempotency key makes retries and double clicks return the original result.
 */
export async function sendCustomerMessage(slug: string, token: string | null, input: z.infer<typeof customerMessageSchema>) {
  const ws = await resolveChatWorkspace(slug)
  const ctx = systemCtx(ws.id)
  const tokenHash = token ? hashChatToken(token) : null

  return scoped(ctx).tx(async tx => {
    // serialize requests carrying the same key, so the duplicate check below is exact
    await tx.raw.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['vigil.chat', `${ws.id}:${input.idempotencyKey}`])
    const dup = await tx.maybeOne('SELECT 1 FROM messages WHERE workspace_id = $1 AND client_key = $2', [input.idempotencyKey])
    if (dup) return { duplicate: true, token: null as string | null, created: false }

    let conv = tokenHash
      ? await tx.maybeOne<{ id: string; contact_id: string; lead_id: string | null }>(
          `SELECT id, contact_id, lead_id FROM conversations
            WHERE workspace_id = $1 AND channel = 'web' AND customer_token_hash = $2 FOR UPDATE`, [tokenHash])
      : null
    let newToken: string | null = null

    if (!conv) {
      const name = input.name?.trim() ?? ''
      const fields: Record<string, string> = {}
      if (name.length < 2) fields.name = 'Tell us your name (at least 2 characters).'
      if (!input.phone && !input.email) fields.phone = 'Leave a phone number or an email so we can reach you.'
      if (Object.keys(fields).length) throw new ApiError(400, 'Please fill in your details.', fields)

      const contact = input.phone
        ? await tx.one<{ id: string; created: boolean }>(
            `INSERT INTO contacts (workspace_id, name, phone, email) VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, phone) WHERE phone IS NOT NULL DO UPDATE SET updated_at = now()
             RETURNING id, (xmax = 0) AS created`, [name, input.phone, input.email || null])
        : (await tx.maybeOne<{ id: string; created: boolean }>(
            'SELECT id, false AS created FROM contacts WHERE workspace_id = $1 AND lower(email) = $2 ORDER BY created_at LIMIT 1', [input.email]))
          ?? await tx.one<{ id: string; created: boolean }>(
            'INSERT INTO contacts (workspace_id, name, email) VALUES ($1, $2, $3) RETURNING id, true AS created', [name, input.email])
      // one open lead per contact, even when two browsers start chatting at once
      await tx.one('SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [contact.id])
      if (contact.created) {
        await tx.query(`INSERT INTO activities (workspace_id, contact_id, kind, body) VALUES ($1, $2, 'created', 'Contact created from web chat')`, [contact.id])
      }

      let lead = await tx.maybeOne<{ id: string }>(
        `SELECT id FROM leads WHERE workspace_id = $1 AND contact_id = $2 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [contact.id])
      const newLead = !lead
      if (!lead) {
        lead = await tx.one<{ id: string }>(`INSERT INTO leads (workspace_id, contact_id, source) VALUES ($1, $2, 'chat') RETURNING id`, [contact.id])
        await tx.query(`INSERT INTO activities (workspace_id, contact_id, lead_id, kind, body, data) VALUES ($1, $2, $3, 'created', 'New web chat lead', '{"source":"chat"}')`,
          [contact.id, lead.id])
        await audit(tx.raw, { ctx, action: 'lead.created', targetType: 'lead', targetId: lead.id, after: { source: 'chat', contact_id: contact.id } })
      }

      const raw = randomBytes(32).toString('base64url')
      conv = await tx.one<{ id: string; contact_id: string; lead_id: string | null }>(
        `INSERT INTO conversations (workspace_id, contact_id, channel, lead_id, customer_token_hash, last_message_at, customer_read_at)
         VALUES ($1, $2, 'web', $3, $4, now(), now()) RETURNING id, contact_id, lead_id`, [contact.id, lead.id, hashChatToken(raw)])
      newToken = raw
      await tx.query(
        `INSERT INTO messages (workspace_id, conversation_id, direction, body, delivery_status, client_key)
         VALUES ($1, $2, 'in', $3, 'received', $4)`, [conv.id, input.message, input.idempotencyKey])
      await tx.query(`INSERT INTO activities (workspace_id, contact_id, lead_id, kind, body) VALUES ($1, $2, $3, 'message', $4)`,
        [contact.id, lead.id, `Web chat: ${input.message.slice(0, 200)}`])
      // conversation exists before assignment, so the owner's notification links to it
      if (newLead) await tx.raw.query('SELECT assign_new_lead($1)', [lead.id])
      else await notifyOwner(tx, lead.id, conv.id)
      return { duplicate: false, token: newToken, created: true }
    }

    await tx.query(
      `INSERT INTO messages (workspace_id, conversation_id, direction, body, delivery_status, client_key)
       VALUES ($1, $2, 'in', $3, 'received', $4)`, [conv.id, input.message, input.idempotencyKey])
    await tx.query('UPDATE conversations SET last_message_at = now() WHERE workspace_id = $1 AND id = $2', [conv.id])
    await tx.query(`INSERT INTO activities (workspace_id, contact_id, lead_id, kind, body) VALUES ($1, $2, $3, 'message', $4)`,
      [conv.contact_id, conv.lead_id, `Web chat: ${input.message.slice(0, 200)}`])
    if (conv.lead_id) await notifyOwner(tx, conv.lead_id, conv.id)
    return { duplicate: false, token: null, created: false }
  })
}

async function notifyOwner(tx: Scoped, leadId: string, conversationId: string) {
  await tx.query(
    `INSERT INTO notifications (workspace_id, user_id, kind, lead_id, conversation_id, title, body)
     SELECT $1, a.user_id, 'message.new', $2, $3, 'New customer message', c.name
       FROM lead_assignments a JOIN leads l ON l.id = a.lead_id JOIN contacts c ON c.id = l.contact_id
      WHERE a.workspace_id = $1 AND a.lead_id = $2 AND a.closed_at IS NULL`, [leadId, conversationId])
}

/** The customer's own conversation (by cookie token) or null. Marks agent replies as seen. */
export async function getCustomerConversation(slug: string, token: string | null) {
  const ws = await resolveChatWorkspace(slug)
  if (!token) return { business: ws.name, conversation: null }
  const db = scoped(systemCtx(ws.id))
  const conv = await db.maybeOne<{ id: string; contact_name: string }>(
    `SELECT cv.id, c.name AS contact_name FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
      WHERE cv.workspace_id = $1 AND cv.channel = 'web' AND cv.customer_token_hash = $2`, [hashChatToken(token)])
  if (!conv) return { business: ws.name, conversation: null }
  const messages = await db.many<{ direction: 'in' | 'out'; body: string; created_at: Date; agent: string | null }>(
    `SELECT m.direction, m.body, m.created_at, split_part(u.name, ' ', 1) AS agent
       FROM messages m LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.workspace_id = $1 AND m.conversation_id = $2 ORDER BY m.created_at, m.id`, [conv.id])
  await db.query('UPDATE conversations SET customer_read_at = now() WHERE workspace_id = $1 AND id = $2', [conv.id])
  // no database ids leave the server: the customer only needs text, side and time
  return {
    business: ws.name,
    conversation: {
      customerName: conv.contact_name,
      messages: messages.map(m => ({ from: m.direction === 'in' ? 'customer' as const : 'agent' as const, body: m.body, at: m.created_at.toISOString(), agent: m.agent })),
    },
  }
}

/** Conversation id for the customer's stream (server-side only, never sent to the browser). */
export async function customerConversationId(slug: string, token: string | null): Promise<{ workspaceId: string; conversationId: string } | null> {
  if (!token) return null
  const ws = await resolveChatWorkspace(slug)
  const conv = await scoped(systemCtx(ws.id)).maybeOne<{ id: string }>(
    `SELECT id FROM conversations WHERE workspace_id = $1 AND channel = 'web' AND customer_token_hash = $2`, [hashChatToken(token)])
  return conv ? { workspaceId: ws.id, conversationId: conv.id } : null
}
