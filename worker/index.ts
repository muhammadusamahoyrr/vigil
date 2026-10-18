// Vigil worker: three polling loops. Deadlines live in PostgreSQL (deadline_at),
// so nothing is lost if this process stops; on restart the first poll finds
// every assignment that fell due meanwhile. The intervals only decide WHEN to
// look, never a business outcome (CLAUDE.md).
//
// Each SQL call is its own transaction (never a shared BEGIN ... COMMIT), so it
// takes and releases exactly one workspace advisory lock.
import './env' // must stay first: loads .env.local before the pool is created
import { pool } from '../src/db/client'
import { sendOutbox } from './outbox'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let stopping = false

async function loop(name: string, everyMs: number, fn: () => Promise<void>) {
  while (!stopping) {
    try { await fn() } catch (e) { console.error(`[${name}]`, (e as Error).message) }
    await sleep(everyMs)
  }
}

// 1. escalation sweeper, every 2s
loop('sweeper', 2000, async () => {
  const { rows } = await pool.query<{ id: string }>('SELECT * FROM due_assignment_ids(25) AS id')
  for (const r of rows) {
    const { rows: res } = await pool.query<{ r: string }>('SELECT sweep_one($1) AS r', [r.id])
    if (res[0].r !== 'skipped') console.log(`[sweeper] ${r.id}: ${res[0].r}`)
  }
})

// 2. orphan guard, every 10s
loop('orphans', 10_000, async () => {
  const { rows } = await pool.query<{ id: string }>('SELECT * FROM orphan_lead_ids() AS id')
  for (const r of rows) {
    const { rows: res } = await pool.query<{ a: string | null }>("SELECT assign_new_lead($1, 'lead.recovered') AS a", [r.id])
    if (res[0].a) console.log(`[orphans] lead ${r.id} recovered`)
  }
})

// 3. outbox sender (Slack alerts), every 2s
loop('outbox', 2000, sendOutbox)

console.log('[vigil-worker] running: sweeper 2s, orphan guard 10s, outbox 2s')

async function shutdown(signal: string) {
  console.log(`[vigil-worker] ${signal}, stopping`)
  stopping = true
  await pool.end().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
