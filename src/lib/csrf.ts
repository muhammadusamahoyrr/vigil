// CSRF: state-changing requests must come from our own origin (APP_URL).
// Webhooks are exempt because they are verified by provider signatures.
import 'server-only'
import { ApiError } from './errors'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function appOrigin(): string {
  const raw = process.env.APP_URL
  if (!raw) throw new Error('APP_URL is not set')
  return new URL(raw).origin
}

export function assertSameOrigin(req: Request) {
  if (!MUTATING.has(req.method.toUpperCase())) return
  if (new URL(req.url).pathname.startsWith('/api/webhooks/')) return

  const origin = req.headers.get('origin')
  let ok = false
  if (origin) {
    try { ok = new URL(origin).origin === appOrigin() } catch { ok = false }
  }
  if (!ok) throw new ApiError(403, 'Request blocked: it did not come from this application.')
}
