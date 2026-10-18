// Realtime: a dedicated connection LISTENing on workspace_events, forwarding
// only events of one workspace. Used by GET /api/stream (SSE).
import 'server-only'
import { Client } from 'pg'

export type WorkspaceEvent = { ws: string; table: string; op: string; id: string; lead_id: string | null; conversation_id?: string | null }

export async function listenWorkspace(
  workspaceId: string,
  onEvent: (e: WorkspaceEvent) => void,
  onError: () => void,
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  client.on('error', onError)
  client.on('notification', n => {
    try {
      const e = JSON.parse(n.payload ?? '{}') as WorkspaceEvent
      if (e.ws === workspaceId) onEvent(e)
    } catch { /* ignore malformed payloads */ }
  })
  await client.connect()
  await client.query('LISTEN workspace_events')
  return async () => { await client.end().catch(() => {}) }
}
