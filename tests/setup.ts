import { testDatabaseUrl } from './test-db'

process.env.DATABASE_URL = testDatabaseUrl()
process.env.APP_URL = 'http://localhost:3000'
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
