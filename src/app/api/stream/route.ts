import { listenWorkspace } from '@/db/listen'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Server-Sent Events: forwards this workspace's database events (IDs only).
// The browser refetches its page data on each event and on every reconnect.
export const GET = route(async req => {
  const ctx = await getCtx(req)
  const enc = new TextEncoder()
  let stop: (() => Promise<void>) | null = null
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)) } catch { /* closed */ } }
      const close = () => {
        clearInterval(heartbeat)
        void stop?.()
        try { controller.close() } catch { /* already closed */ }
      }
      send('retry: 3000\n: connected\n\n')
      stop = await listenWorkspace(
        ctx.workspaceId,
        e => send(`data: ${JSON.stringify({ table: e.table, op: e.op, id: e.id, lead_id: e.lead_id })}\n\n`),
        close,
      )
      heartbeat = setInterval(() => send(': ping\n\n'), 25_000)
      req.signal.addEventListener('abort', close)
    },
    cancel() {
      clearInterval(heartbeat)
      void stop?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
})
