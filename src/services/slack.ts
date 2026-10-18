// Slack connection per workspace and per-user Slack routing (I4.3).
import 'server-only'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import { audit } from '@/lib/audit'
import { decrypt, encrypt, mask } from '@/lib/crypto'
import type { Ctx } from '@/lib/ctx'
import { ApiError } from '@/lib/errors'
import { requirePermission } from '@/lib/rbac'
import { authTest, lookupUserByEmail, ProviderError } from '@/providers/slack'

export const connectSlackSchema = z.object({
  botToken: z.string().trim().regex(/^xoxb-[A-Za-z0-9-]{20,}$/, 'Paste the Bot User OAuth Token (starts with xoxb-).'),
})

async function logEvent(ctx: Ctx, eventType: string, status: 'succeeded' | 'failed', error?: string) {
  await scoped(ctx).query(
    `INSERT INTO integration_events (workspace_id, provider, direction, event_type, status, error)
     VALUES ($1, 'slack', 'out', $2, $3, $4)`, [eventType, status, error ?? null])
}

export async function connectSlack(ctx: Ctx, botToken: string) {
  requirePermission(ctx, 'integrations.manage')
  let team: string
  try {
    team = (await authTest(botToken)).team
    await logEvent(ctx, 'auth.test', 'succeeded')
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : 'Could not reach Slack.'
    await logEvent(ctx, 'auth.test', 'failed', msg)
    throw new ApiError(400, msg)
  }
  return scoped(ctx).tx(async tx => {
    const before = await tx.maybeOne(
      `SELECT status, external_account_ref FROM integration_connections
        WHERE workspace_id = $1 AND provider = 'slack' AND user_id IS NULL`)
    await tx.query(
      `INSERT INTO integration_connections (workspace_id, provider, status, credentials, external_account_ref, last_ok_at)
       VALUES ($1, 'slack', 'connected', $2, $3, now())
       ON CONFLICT (workspace_id, provider) WHERE user_id IS NULL
       DO UPDATE SET credentials = EXCLUDED.credentials, status = 'connected', external_account_ref = EXCLUDED.external_account_ref,
                     last_ok_at = now(), last_error = NULL, last_error_at = NULL, updated_at = now()`,
      [encrypt(botToken), team])
    // never audit the token itself
    await audit(tx.raw, { ctx, action: before ? 'integration.changed' : 'integration.connected', targetType: 'integration',
                          before, after: { provider: 'slack', status: 'connected', team } })
    return { team }
  })
}

/** The workspace's Slack bot token, decrypted on the server only. */
export async function slackToken(ctx: Ctx): Promise<string | null> {
  const row = await scoped(ctx).maybeOne<{ credentials: Buffer }>(
    `SELECT credentials FROM integration_connections WHERE workspace_id = $1 AND provider = 'slack' AND user_id IS NULL`)
  return row ? decrypt(row.credentials) : null
}

export async function slackStatus(ctx: Ctx) {
  requirePermission(ctx, 'crm.view')
  const db = scoped(ctx)
  const conn = await db.maybeOne<{ status: string; external_account_ref: string; last_ok_at: Date | null; last_error: string | null; credentials: Buffer }>(
    `SELECT status, external_account_ref, last_ok_at, last_error, credentials FROM integration_connections
      WHERE workspace_id = $1 AND provider = 'slack' AND user_id IS NULL`)
  const failed = await db.many(
    `SELECT o.id, o.last_error, o.attempts, o.created_at, u.name AS recipient
       FROM outbox o LEFT JOIN users u ON u.id = (o.payload ->> 'user_id')::uuid
      WHERE o.workspace_id = $1 AND o.status = 'failed' AND o.kind = 'notify'
      ORDER BY o.created_at DESC LIMIT 20`)
  const events = await db.many(
    `SELECT event_type, status, error, created_at FROM integration_events
      WHERE workspace_id = $1 AND provider = 'slack' ORDER BY created_at DESC LIMIT 20`)
  return {
    connected: conn?.status === 'connected',
    status: conn?.status ?? 'not_connected',
    team: conn?.external_account_ref ?? null,
    lastOkAt: conn?.last_ok_at ?? null,
    lastError: conn?.last_error ?? null,
    maskedToken: conn ? mask(decrypt(conn.credentials)) : null,
    failed,
    events,
  }
}

export const slackEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter the email of your Slack account.').max(254),
})

export async function setMySlackEmail(ctx: Ctx, email: string) {
  const token = await slackToken(ctx)
  if (!token) throw new ApiError(409, 'Slack is not connected yet. Ask an Admin to connect it in Integrations.')
  let slackUserId: string
  try {
    slackUserId = await lookupUserByEmail(token, email)
    await logEvent(ctx, 'users.lookupByEmail', 'succeeded')
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : 'Could not reach Slack.'
    await logEvent(ctx, 'users.lookupByEmail', 'failed', msg)
    throw new ApiError(400, e instanceof ProviderError && e.code === 'users_not_found'
      ? 'No account with this email in our Slack workspace. Join the Slack workspace first, then try again.'
      : msg)
  }
  await scoped(ctx).tx(async tx => {
    await tx.query('UPDATE users SET slack_email = $3, slack_user_id = $4 WHERE workspace_id = $1 AND id = $2',
      [ctx.userId, email, slackUserId])
    await audit(tx.raw, { ctx, action: 'user.slack_linked', targetType: 'user', targetId: ctx.userId, after: { slack_email: email } })
  })
  return { linked: true }
}

export async function mySlack(ctx: Ctx) {
  return scoped(ctx).one<{ slack_email: string | null; slack_user_id: string | null }>(
    'SELECT slack_email, slack_user_id FROM users WHERE workspace_id = $1 AND id = $2', [ctx.userId])
}
