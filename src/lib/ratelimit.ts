// Small in-memory fixed-window limiter (per process). Enough for the public
// form's "5 submissions per minute per IP" on a single web instance.
const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const h = hits.get(key)
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    return true
  }
  h.count += 1
  return h.count <= limit
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}
