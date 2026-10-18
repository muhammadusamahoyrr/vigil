import { listenWorkspace } from '@/db/listen'
import { route } from '@/lib/api'
import { ApiError } from '@/lib/errors'
import { clientIp, rateLimit } from '@/lib/ratelimit'
import { CHAT_COOKIE, customerConversationId } from '@/services/webchat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type P = { params: Promise<{ slug: string }> }

// Anonymous customer stream: only "something changed in YOUR conversation" pings.
// The browser then refetches through the cookie-protected GET. No ids or text are sent.
export const GET = route<P>(async (req, { params }) => {
  if (!rateLimit(`chat-stream:${clientIp(req)}`, 10, 60_000)) throw new ApiError(429, 'Too many connections.')
  const { slug } = await params
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${CHAT_COOKIE}=([^;]+)`))
  const own = await customerConversationId(slug, m ? decodeURIComponent(m[1]) : null)
  if (!own) throw new ApiError(404, 'No conversation yet.')

  const enc = new TextEncoder()
  let stop: (() => Promise<void>) | null = null
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)) } catch { /* closed */ } }
      const close = () => { clearInterval(heartbeat); void stop?.(); try { controller.close() } catch { /* closed */ } }
      send('retry: 3000\n: connected\n\n')
      stop = await listenWorkspace(own.workspaceId, e => {
        if (e.conversation_id === own.conversationId && (e.table === 'messages' || e.table === 'conversations')) send('data: changed\n\n')
      }, close)
      heartbeat = setInterval(() => send(': ping\n\n'), 25_000)
      req.signal.addEventListener('abort', close)
    },
    cancel() { clearInterval(heartbeat); void stop?.() },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' },
  })
})
