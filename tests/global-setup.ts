import { execFileSync } from 'node:child_process'
import { testDatabaseUrl } from './test-db'

// Apply sql/*.sql to the test database once per run (migrate skips applied files).
export default function setup() {
  const url = testDatabaseUrl()
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
