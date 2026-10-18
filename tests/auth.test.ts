// Step 2 auth: signup, sessions, lockout, getCtx permissions, CSRF.
// Runs against TEST_DATABASE_URL only. Every test uses fresh unique emails; rows
// stay in the disposable database because audit_logs is immutable by design.
import { randomUUID } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { afterAll, describe, expect, it } from 'vitest'
import { pool } from '@/db/client'
import { POST as signupPOST } from '@/app/api/auth/signup/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import { GET as meGET } from '@/app/api/auth/me/route'
import { getCtx, hashToken, newSessionToken, SESSION_COOKIE, systemCtx } from '@/lib/session'
import { assertSameOrigin } from '@/lib/csrf'
import { DEFAULT_ROLES } from '@/services/auth'

const APP = 'http://localhost:3000'
const PASSWORD = 'correct-horse-battery'
const uniq = () => randomUUID().slice(0, 8)

function req(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.origin !== null) headers.origin = opts.origin ?? APP
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`
  return new Request(`${APP}${path}`, {
    method: opts.method ?? 'POST', headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

function cookieFrom(res: Response): { token: string; raw: string } {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = raw.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))
  return { token: m ? decodeURIComponent(m[1]) : '', raw }
}

async function signupUser(overrides: Partial<{ email: string; workspaceName: string }> = {}) {
  const email = overrides.email ?? `owner-${uniq()}@test.local`
  const res = await signupPOST(req('/api/auth/signup', {
    body: { workspaceName: overrides.workspaceName ?? `WS ${uniq()}`, name: 'Owner Person', email, password: PASSWORD },
  }), undefined)
  return { res, email, body: await res.clone().json(), ...cookieFrom(res) }
}

const login = (email: string, password: string) =>
  loginPOST(req('/api/auth/login', { body: { email, password } }), undefined)

afterAll(async () => { await pool.end() })

describe('signup', () => {
  it('creates the whole workspace bootstrap atomically and logs the owner in', async () => {
    const s = await signupUser()
    expect(s.res.status).toBe(201)
    const ws = s.body.workspaceId

    const owner = await pool.query('SELECT level, password_hash FROM users WHERE id = $1 AND workspace_id = $2', [s.body.userId, ws])
    expect(owner.rows[0].level).toBe('owner')
    expect(owner.rows[0].password_hash).toMatch(/^\$argon2id\$/)

    const roles = await pool.query(
      `SELECT r.name, array_agg(rp.permission_key ORDER BY rp.permission_key) AS keys
         FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.workspace_id = $1 GROUP BY r.name`, [ws])
    const byName = Object.fromEntries(roles.rows.map(r => [r.name, r.keys]))
    expect(Object.keys(byName).sort()).toEqual(['Manager', 'Sales'])
    expect(byName.Manager).toEqual([...DEFAULT_ROLES.Manager].sort())
    expect(byName.Sales).toEqual([...DEFAULT_ROLES.Sales].sort())

    const stages = await pool.query(
      `SELECT s.name, s.is_won, s.is_lost FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.workspace_id = $1 AND p.name = 'Sales' ORDER BY s.position`, [ws])
    expect(stages.rows.map(r => r.name)).toEqual(['New', 'Contacted', 'Proposal', 'Won', 'Lost'])
    expect(stages.rows[3].is_won).toBe(true)
    expect(stages.rows[4].is_lost).toBe(true)

    expect((await pool.query('SELECT 1 FROM assignment_rules WHERE workspace_id = $1', [ws])).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM sessions WHERE workspace_id = $1', [ws])).rowCount).toBe(1)
    const audits = await pool.query('SELECT action FROM audit_logs WHERE workspace_id = $1 AND actor_id = $2', [ws, s.body.userId])
    expect(audits.rows.map(r => r.action)).toEqual(expect.arrayContaining(
      ['workspace.created', 'user.created', 'role.created', 'pipeline.created', 'assignment_rules.created']))
  })

  it('sets a secure-shaped cookie and the session survives a "refresh" (/me)', async () => {
    const s = await signupUser()
    expect(s.raw).toMatch(/HttpOnly/i)
    expect(s.raw).toMatch(/SameSite=lax/i)
    expect(s.raw).toMatch(/Path=\//)
    expect(Number(s.raw.match(/Max-Age=(\d+)/i)?.[1])).toBeGreaterThan(604_790) // 7 days
    expect(s.raw).not.toMatch(/;\s*Secure/i) // NODE_ENV=test: plain http allowed outside production
    const me = await meGET(req('/api/auth/me', { method: 'GET', cookie: s.token }), undefined)
    expect(me.status).toBe(200)
    const body = await me.json()
    expect(body.email).toBe(s.email)
    expect(body).not.toHaveProperty('password_hash')
  })

  it('stores only the sha256 of the session token', async () => {
    const s = await signupUser()
    const rows = await pool.query('SELECT token_hash FROM sessions WHERE user_id = $1', [s.body.userId])
    expect(Buffer.compare(rows.rows[0].token_hash, hashToken(s.token))).toBe(0)
    const raw = await pool.query(`SELECT 1 FROM sessions WHERE encode(token_hash, 'escape') LIKE '%' || $1 || '%'`, [s.token])
    expect(raw.rowCount).toBe(0)
  })

  it('rejects a duplicate email (case and spaces normalized) with 409', async () => {
    const s = await signupUser()
    const dup = await signupPOST(req('/api/auth/signup', {
      body: { workspaceName: 'Another', name: 'Someone', email: `  ${s.email.toUpperCase()} `, password: PASSWORD },
    }), undefined)
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toMatch(/already exists/)
  })

  it('validates input with field errors (400)', async () => {
    const res = await signupPOST(req('/api/auth/signup', {
      body: { workspaceName: 'X', name: 'Y', email: 'not-an-email', password: 'short' },
    }), undefined)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(Object.keys(body.fields).sort()).toEqual(['email', 'name', 'password', 'workspaceName'])
  })

  it('rolls back everything when a bootstrap step fails', async () => {
    const name = `Rollback ${uniq()}`
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_rules() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT name FROM workspaces WHERE id = NEW.workspace_id) LIKE 'Rollback %' THEN
          RAISE EXCEPTION 'controlled bootstrap failure';
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS test_fail_rules_t ON assignment_rules;
      CREATE TRIGGER test_fail_rules_t BEFORE INSERT ON assignment_rules FOR EACH ROW EXECUTE FUNCTION test_fail_rules();`)
    try {
      const email = `rollback-${uniq()}@test.local`
      const s = await signupUser({ email, workspaceName: name })
      expect(s.res.status).toBe(500)
      expect(s.body.error).not.toMatch(/controlled|assignment_rules/) // internal error not leaked
      expect((await pool.query('SELECT 1 FROM workspaces WHERE name = $1', [name])).rowCount).toBe(0)
      expect((await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount).toBe(0)
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_fail_rules_t ON assignment_rules; DROP FUNCTION IF EXISTS test_fail_rules()')
    }
  })
})

describe('login and lockout', () => {
  it('counts failures, locks on the 5th, rejects the right password while locked, recovers after expiry', async () => {
    const s = await signupUser()
    for (let i = 1; i <= 4; i++) {
      const r = await login(s.email, 'wrong-password!')
      expect(r.status).toBe(401)
      expect((await r.json()).error).toBe('Email or password is incorrect.')
      const u = await pool.query('SELECT failed_logins, locked_until FROM users WHERE id = $1', [s.body.userId])
      expect(u.rows[0].failed_logins).toBe(i)
      expect(u.rows[0].locked_until).toBeNull()
    }
    const fifth = await login(s.email, 'wrong-password!')
    expect(fifth.status).toBe(423) // the 5th failure activates the lock
    const locked = await pool.query('SELECT failed_logins, locked_until FROM users WHERE id = $1', [s.body.userId])
    expect(locked.rows[0].failed_logins).toBe(5)
    const minutes = (locked.rows[0].locked_until.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(14)
    expect(minutes).toBeLessThanOrEqual(15)

    const during = await login(s.email, PASSWORD)
    expect(during.status).toBe(423)
    expect(cookieFrom(during).token).toBe('')

    // controlled expiry (fixture manipulation of the test row only)
    await pool.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [s.body.userId])
    const after = await login(s.email, PASSWORD)
    expect(after.status).toBe(200)
    expect(cookieFrom(after).token).not.toBe('')
    const reset = await pool.query('SELECT failed_logins, locked_until FROM users WHERE id = $1', [s.body.userId])
    expect(reset.rows[0]).toEqual({ failed_logins: 0, locked_until: null })
    expect((await pool.query('SELECT 1 FROM security_events WHERE kind = $1 AND detail LIKE $2',
      ['login_locked', `%${s.body.userId}%`])).rowCount).toBe(1)
  })

  it('creates a fresh session on every login', async () => {
    const s = await signupUser()
    const a = cookieFrom(await login(s.email, PASSWORD)).token
    const b = cookieFrom(await login(s.email, PASSWORD)).token
    expect(a).not.toBe(b)
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [s.body.userId])).rowCount).toBe(3)
  })

  it('gives the same generic 401 for an unknown email', async () => {
    const r = await login(`nobody-${uniq()}@test.local`, PASSWORD)
    expect(r.status).toBe(401)
    expect((await r.json()).error).toBe('Email or password is incorrect.')
  })

  it('logout deletes only that session, clears the cookie and is idempotent', async () => {
    const s = await signupUser()
    const other = cookieFrom(await login(s.email, PASSWORD)).token
    const out = await logoutPOST(req('/api/auth/logout', { cookie: s.token }), undefined)
    expect(out.status).toBe(200)
    expect(cookieFrom(out).raw).toMatch(/Max-Age=0/)
    expect((await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [hashToken(s.token)])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [hashToken(other)])).rowCount).toBe(1)
    const again = await logoutPOST(req('/api/auth/logout', { cookie: s.token }), undefined)
    expect(again.status).toBe(200)
    const me = await meGET(req('/api/auth/me', { method: 'GET', cookie: s.token }), undefined)
    expect(me.status).toBe(401)
  })
})

describe('getCtx', () => {
  it('rejects missing, unknown and expired sessions with 401', async () => {
    expect((await meGET(req('/api/auth/me', { method: 'GET' }), undefined)).status).toBe(401)
    expect((await meGET(req('/api/auth/me', { method: 'GET', cookie: 'not-a-real-token' }), undefined)).status).toBe(401)

    const s = await signupUser()
    const t = newSessionToken()
    await pool.query(`INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() - interval '1 minute')`,
      [s.body.workspaceId, s.body.userId, t.hash])
    expect((await meGET(req('/api/auth/me', { method: 'GET', cookie: t.token }), undefined)).status).toBe(401)
    expect((await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [t.hash])).rowCount).toBe(0) // cleaned up
  })

  it('rejects a deactivated user with 401', async () => {
    const s = await signupUser()
    await pool.query('UPDATE users SET deactivated_at = now() WHERE id = $1', [s.body.userId])
    expect((await meGET(req('/api/auth/me', { method: 'GET', cookie: s.token }), undefined)).status).toBe(401)
  })

  it('gives the Owner every permission key', async () => {
    const s = await signupUser()
    const ctx = await getCtx(req('/api/auth/me', { method: 'GET', cookie: s.token }))
    const all = (await pool.query('SELECT key FROM permissions ORDER BY key')).rows.map(r => r.key)
    expect(ctx).toMatchObject({ workspaceId: s.body.workspaceId, userId: s.body.userId, level: 'owner', isSystem: false })
    expect(ctx.permissions).toEqual(all)
  })

  it('gives a User the union of their roles, and role changes apply without a new cookie', async () => {
    const s = await signupUser()
    const ws = s.body.workspaceId
    const user = (await pool.query(
      `INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1, $2, 'Sales Rep', $3) RETURNING id`,
      [ws, `rep-${uniq()}@test.local`, await hash(PASSWORD)])).rows[0].id
    const role = async (name: string) => (await pool.query('SELECT id FROM roles WHERE workspace_id = $1 AND name = $2', [ws, name])).rows[0].id
    const t = newSessionToken()
    await pool.query('INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [ws, user, t.hash, t.expiresAt])
    const ctxOf = () => getCtx(req('/api/auth/me', { method: 'GET', cookie: t.token }))

    expect((await ctxOf()).permissions).toEqual([])
    await pool.query('INSERT INTO user_roles (workspace_id, user_id, role_id) VALUES ($1, $2, $3)', [ws, user, await role('Sales')])
    expect((await ctxOf()).permissions).toEqual([...DEFAULT_ROLES.Sales].sort())
    await pool.query('INSERT INTO user_roles (workspace_id, user_id, role_id) VALUES ($1, $2, $3)', [ws, user, await role('Manager')])
    const union = [...new Set([...DEFAULT_ROLES.Sales, ...DEFAULT_ROLES.Manager])].sort()
    expect((await ctxOf()).permissions).toEqual(union)
    expect((await ctxOf()).level).toBe('user')
  })

  it('systemCtx has the exact documented shape', () => {
    expect(systemCtx('w1')).toEqual({ workspaceId: 'w1', userId: null, level: 'owner', permissions: ['*'], isSystem: true })
  })
})

describe('CSRF origin check', () => {
  it('rejects missing and wrong Origin on mutating requests, accepts APP_URL', async () => {
    const body = { email: 'x@test.local', password: 'whatever' }
    expect((await loginPOST(req('/api/auth/login', { body, origin: null }), undefined)).status).toBe(403)
    expect((await loginPOST(req('/api/auth/login', { body, origin: 'https://evil.example' }), undefined)).status).toBe(403)
    expect((await loginPOST(req('/api/auth/login', { body, origin: 'http://localhost:3000.evil.example' }), undefined)).status).toBe(403)
    expect((await loginPOST(req('/api/auth/login', { body, origin: APP }), undefined)).status).toBe(401) // passed CSRF, failed auth
    expect((await signupPOST(req('/api/auth/signup', { body, origin: 'https://evil.example' }), undefined)).status).toBe(403)
    expect((await logoutPOST(req('/api/auth/logout', { origin: null }), undefined)).status).toBe(403)
  })

  it('exempts webhooks and safe methods', () => {
    expect(() => assertSameOrigin(req('/api/webhooks/twilio/abc', { origin: null }))).not.toThrow()
    expect(() => assertSameOrigin(req('/api/auth/me', { method: 'GET', origin: null }))).not.toThrow()
  })
})
