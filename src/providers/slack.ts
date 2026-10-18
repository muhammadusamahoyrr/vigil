// Slack Web API. The ONLY place that talks to Slack. Errors are classified as
// temporary (retry with backoff) or permanent (fail now, show the reason).

export class ProviderError extends Error {
  constructor(message: string, public temporary: boolean, public code?: string) {
    super(message)
  }
}

const PERMANENT: Record<string, string> = {
  invalid_auth: 'The Slack bot token is invalid. Reconnect Slack in Integrations.',
  not_authed: 'No Slack bot token was sent. Reconnect Slack in Integrations.',
  token_revoked: 'The Slack bot token was revoked. Reconnect Slack in Integrations.',
  account_inactive: 'The Slack app was uninstalled. Reinstall it and reconnect.',
  missing_scope: 'The Slack app is missing a permission (needs chat:write, users:read, users:read.email).',
  users_not_found: 'No Slack account with this email in the connected Slack workspace.',
  user_not_found: 'That Slack user does not exist in the connected workspace.',
  channel_not_found: 'Slack could not open a direct message with this user.',
  cannot_dm_bot: 'Cannot send a direct message to a bot.',
}

async function call(token: string, method: string, body: Record<string, unknown>) {
  let res: Response
  try {
    res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ProviderError('Slack is unreachable right now. Will retry.', true, 'network')
  }
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderError(`Slack is busy (HTTP ${res.status}). Will retry.`, true, `http_${res.status}`)
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }))
  if (!data.ok) {
    const code = String(data.error ?? 'unknown_error')
    if (code === 'ratelimited') throw new ProviderError('Slack rate limit. Will retry.', true, code)
    const temporary = ['internal_error', 'fatal_error', 'service_unavailable', 'request_timeout'].includes(code)
    throw new ProviderError(PERMANENT[code] ?? `Slack refused the request (${code}).`, temporary, code)
  }
  return data
}

export async function authTest(token: string): Promise<{ team: string; botUser: string }> {
  const d = await call(token, 'auth.test', {})
  return { team: d.team, botUser: d.user }
}

export async function lookupUserByEmail(token: string, email: string): Promise<string> {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new ProviderError('Slack is unreachable right now.', true, 'network') })
  if (res.status === 429 || res.status >= 500) throw new ProviderError(`Slack is busy (HTTP ${res.status}).`, true)
  const d = await res.json()
  if (!d.ok) throw new ProviderError(PERMANENT[d.error] ?? `Slack refused the lookup (${d.error}).`, false, d.error)
  return d.user.id as string
}

/** Direct message: posting to a user id delivers it in the app's Messages tab. Returns the message ts. */
export async function postDirectMessage(token: string, slackUserId: string, text: string): Promise<string> {
  const d = await call(token, 'chat.postMessage', { channel: slackUserId, text, unfurl_links: false })
  return d.ts as string
}
