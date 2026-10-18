// The single pg Pool. Only src/db/**, src/services/** and worker/** import this;
// route files never do (CLAUDE.md, Layers).
import { Pool } from 'pg'

const globalForPool = globalThis as unknown as { vigilPool?: Pool }

function createPool() {
  // No throw here: `next build` imports route modules without a database. A missing
  // DATABASE_URL surfaces on the first query instead.
  if (!process.env.DATABASE_URL) console.warn('[db] DATABASE_URL is not set')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
  // an idle client erroring (e.g. DB restart) must not crash the process
  pool.on('error', e => console.error('pg pool error', e.message))
  return pool
}

// reuse one pool across Next.js dev hot reloads
export const pool: Pool = globalForPool.vigilPool ?? (globalForPool.vigilPool = createPool())
