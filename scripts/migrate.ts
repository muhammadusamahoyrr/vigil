// Applies sql/*.sql in name order (001_schema.sql, then 002_lead_engine.sql),
// skipping files already recorded in schema_migrations. Each file runs in its
// own transaction; an advisory lock stops two deploys migrating at once.
// A file that changed after it was applied is an error, never silently re-run.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file) } catch { /* file is optional */ }
}

const SQL_DIR = join(process.cwd(), 'sql')
const LOCK_KEY = 727001 // arbitrary constant: "vigil migrations"

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`)
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations')
    const applied = new Map<string, string>(rows.map(r => [r.filename, r.checksum]))

    const files = readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = readFileSync(join(SQL_DIR, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const prev = applied.get(file)
      if (prev === checksum) { console.log(`skip    ${file}`); continue }
      if (prev) throw new Error(`${file} changed after it was applied; add a new migration file instead`)

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum])
        await client.query('COMMIT')
        console.log(`applied ${file}`)
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`${file} failed: ${(e as Error).message}`)
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    await client.end()
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
