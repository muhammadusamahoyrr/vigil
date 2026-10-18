// Tests only ever touch TEST_DATABASE_URL, which must be a local disposable database.
for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file) } catch { /* optional */ }
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)')
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`Refusing to test against non-local database host ${host}`)
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL')
  return url
}
