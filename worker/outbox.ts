// Outbox sender (worker loop 3). At-least-once delivery with backoff.
// Picks due rows with FOR UPDATE SKIP LOCKED, so two workers never send the same row.
import type { PoolClient } from 'pg'
import { pool } from '../src/db/client'
import { decrypt } from '../src/lib/crypto'
import { lookupUserByEmail, postDirectMessage, ProviderError } from '../src/providers/slack'

const BACKOFF_SECONDS = [2, 8, 30, 120]
const MAX_ATTEMPTS = 5

type OutboxRow = {
  id: string; workspace_id: string; kind: 'notify' | 'message'; payload: Record<string, string>
  assignment_id: string | null; attempts: number
}

const REASONS: Record<string, string> = {
  'lead.assigned': 'New lead assigned to you',
  'lead.escalated': 'Escalated to you: the previous owner did not acknowledge in time',
  'lead.reassigned': 'Reassigned to you by a manager',
  'lead.owner_unavailable': 'Moved to you: the previous owner went on leave or offline',
  'lead.recovered': 'Recovered lead with no owner, now assigned to you',
}
const SOURCES: Record<string, string> = { manual: 'manual entry', form: 'web form', message: 'WhatsApp message' }

async function logEvent(c: PoolClient, row: OutboxRow, status: 'succeeded' | 'failed', reference: string | null, error: string | null) {
  await c.query(
    `INSERT INTO integration_events (workspace_id, provider, direction, event_type, status, reference, error)
     VALUES ($1, 'slack', 'out', 'chat.postMessage', $2, $3, $4)`,
    [row.workspace_id, status, reference, error])
}

async function sendNotify(c: PoolClient, row: OutboxRow): Promise<string> {
  const conn = await c.query<{ id: string; credentials: Buffer }>(
    `SELECT id, credentials FROM integration_connections
      WHERE workspace_id = $1 AND provider = 'slack' AND user_id IS NULL AND status <> 'not_connected'`,
    [row.workspace_id])
  if (!conn.rows[0]) throw new ProviderError('Slack is not connected for this workspace.', false)
  const token = decrypt(conn.rows[0].credentials)

  const { rows } = await c.query(
    `SELECT u.id AS user_id, u.name AS user_name, u.slack_user_id, u.slack_email,
            l.id AS lead_id, l.source, ct.name AS contact_name, a.reason, a.deadline_at
       FROM lead_assignments a
       JOIN users u ON u.id = a.user_id AND u.workspace_id = a.workspace_id
       JOIN leads l ON l.id = a.lead_id AND l.workspace_id = a.workspace_id
       JOIN contacts ct ON ct.id = l.contact_id
      WHERE a.id = $1 AND a.workspace_id = $2`,
    [row.assignment_id, row.workspace_id])
  const d = rows[0]
  if (!d) throw new ProviderError('The assignment for this alert no longer exists.', false)

  let slackUserId: string | null = d.slack_user_id
  if (!slackUserId) {
    if (!d.slack_email) throw new ProviderError(`${d.user_name} has not set their Slack email in Profile.`, false)
    slackUserId = await lookupUserByEmail(token, d.slack_email)
    await c.query('UPDATE users SET slack_user_id = $1 WHERE id = $2 AND workspace_id = $3', [slackUserId, d.user_id, row.workspace_id])
  }

  const seconds = Math.max(0, Math.round((new Date(d.deadline_at).getTime() - Date.now()) / 1000))
  const text = [
    `*${REASONS[d.reason] ?? 'Lead assigned to you'}*`,
    `Lead: *${d.contact_name}*  ·  Source: ${SOURCES[d.source] ?? d.source}`,
    `Acknowledge within ${seconds}s or it escalates.`,
    `${process.env.APP_URL ?? ''}/leads/${d.lead_id}`,
  ].join('\n')
  const ts = await postDirectMessage(token, slackUserId, text)
  await c.query(`UPDATE integration_connections SET last_ok_at = now(), status = 'connected' WHERE id = $1`, [conn.rows[0].id])
  return ts
}

async function handle(c: PoolClient, row: OutboxRow): Promise<string> {
  if (row.kind === 'notify') return sendNotify(c, row)
  throw new ProviderError('Customer message sending arrives with the Twilio integration (Step 7).', false)
}

export async function sendOutbox() {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const { rows } = await c.query<OutboxRow>(
      `SELECT id, workspace_id, kind, payload, assignment_id, attempts FROM outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at LIMIT 10
        FOR UPDATE SKIP LOCKED`)
    for (const row of rows) {
      try {
        const ref = await handle(c, row)
        await c.query(`UPDATE outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [row.id])
        await logEvent(c, row, 'succeeded', ref, null)
      } catch (e) {
        const temporary = e instanceof ProviderError ? e.temporary : true
        const message = e instanceof Error ? e.message : 'Unknown error'
        const attempts = row.attempts + 1
        if (!temporary || attempts >= MAX_ATTEMPTS) {
          await c.query(`UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`, [row.id, attempts, message])
          if (e instanceof ProviderError && ['invalid_auth', 'token_revoked', 'account_inactive'].includes(e.code ?? '')) {
            await c.query(`UPDATE integration_connections SET status = 'error', last_error = $2, last_error_at = now()
                            WHERE workspace_id = $1 AND provider = 'slack' AND user_id IS NULL`, [row.workspace_id, message])
          }
        } else {
          const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)]
          await c.query(`UPDATE outbox SET attempts = $2, last_error = $3, next_attempt_at = now() + make_interval(secs => $4) WHERE id = $1`,
            [row.id, attempts, message, delay])
        }
        await logEvent(c, row, 'failed', null, message)
        console.error(`[outbox] ${row.kind} ${row.id} attempt ${attempts}: ${message}`)
      }
    }
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
