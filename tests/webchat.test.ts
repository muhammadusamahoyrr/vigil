// First-party Vigil Web Chat: customer flow, idempotency, isolation, agent inbox,
// in-app notifications, realtime privacy and rollback.
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '@/db/client'
import { POST as signupPOST } from '@/app/api/auth/signup/route'
import { GET as chatGET, POST as chatPOST } from '@/app/chat/[slug]/messages/route'
import { GET as convGET } from '@/app/api/inbox/[id]/route'
import { POST as replyPOST } from '@/app/api/inbox/[id]/reply/route'
import { POST as ackPOST } from '@/app/api/leads/[id]/acknowledge/route'
import { newSessionToken, SESSION_COOKIE } from '@/lib/session'

const APP = 'http://localhost:3000'
const uniq = () => randomUUID().slice(0, 8)
const key = () => randomUUID().replace(/-/g, '')
const phoneNo = () => `+92345${Math.floor(1e6 + Math.random() * 8e6)}`
const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

type WS = { id: string; slug: string; owner: string; members: Record<string, { id: string; token: string }> }

function agentReq(path: string, o: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP }
  if (o.token) headers.cookie = `${SESSION_COOKIE}=${o.token}`
  return new Request(`${APP}${path}`, { method: o.method ?? 'POST', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}

async function customer(slug: string, body: Record<string, unknown> | null, chatToken?: string | null, ip = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': ip }
  if (chatToken) headers.cookie = `vigil_chat=${chatToken}`
  const req = new Request(`${APP}/chat/${slug}/messages`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const res = body ? await chatPOST(req, P({ slug })) : await chatGET(req, P({ slug }))
  const set = res.headers.get('set-cookie') ?? ''
  return { status: res.status, data: await res.json(), token: (set.match(/vigil_chat=([^;]+)/) ?? [])[1] ?? null, cookie: set }
}

async function workspace(): Promise<WS> {
  const res = await signupPOST(agentReq('/api/auth/signup', { body: { workspaceName: `Chat ${uniq()}`, name: 'Owner', email: `w-${uniq()}@test.local`, password: 'correct-horse-battery' } }), undefined)
  const b = await res.json()
  const owner = decodeURIComponent(res.headers.get('set-cookie')!.match(/vigil_session=([^;]*)/)![1])
  await pool.query(`UPDATE users SET availability = 'busy' WHERE id = $1`, [b.userId])
  const members: WS['members'] = {}
  for (const n of ['ali', 'sara']) {
    const id = (await pool.query(`INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`, [b.workspaceId, `${n}-${uniq()}@test.local`, n])).rows[0].id
    await pool.query(`INSERT INTO user_roles (workspace_id, user_id, role_id) SELECT $1, $2, id FROM roles WHERE workspace_id = $1 AND name = 'Sales'`, [b.workspaceId, id])
    const t = newSessionToken()
    await pool.query('INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [b.workspaceId, id, t.hash, t.expiresAt])
    members[n] = { id, token: t.token }
  }
  const slug = (await pool.query('SELECT slug FROM workspaces WHERE id = $1', [b.workspaceId])).rows[0].slug
  return { id: b.workspaceId, slug, owner, members }
}

const counts = async (ws: string, phone: string) => (await pool.query(
  `SELECT (SELECT count(*)::int FROM contacts WHERE workspace_id = $1 AND phone = $2) AS contacts,
          (SELECT count(*)::int FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.workspace_id = $1 AND c.phone = $2) AS leads,
          (SELECT count(*)::int FROM conversations v JOIN contacts c ON c.id = v.contact_id WHERE v.workspace_id = $1 AND c.phone = $2) AS conversations,
          (SELECT count(*)::int FROM messages m JOIN conversations v ON v.id = m.conversation_id JOIN contacts c ON c.id = v.contact_id
            WHERE m.workspace_id = $1 AND c.phone = $2) AS messages`, [ws, phone])).rows[0]

const convOf = async (ws: string, phone: string) => (await pool.query(
  `SELECT v.id, v.lead_id, a.user_id AS owner FROM conversations v JOIN contacts c ON c.id = v.contact_id
     LEFT JOIN lead_assignments a ON a.lead_id = v.lead_id AND a.closed_at IS NULL
    WHERE v.workspace_id = $1 AND c.phone = $2 ORDER BY v.created_at LIMIT 1`, [ws, phone])).rows[0]

let A: WS, B: WS
beforeAll(async () => { A = await workspace(); B = await workspace() })
afterAll(async () => { await pool.end() })

describe('customer web chat', () => {
  it('1+10. first message creates one contact, conversation, lead, assignment and an in-app notification', async () => {
    const phone = phoneNo()
    const r = await customer(A.slug, { idempotencyKey: key(), name: 'Asad Ali', phone, message: 'Need a 5kW quote' })
    expect(r.status).toBe(201)
    expect(r.token).toBeTruthy()
    expect(r.cookie).toMatch(/HttpOnly/i)
    expect(r.cookie).toMatch(new RegExp(`Path=/chat/${A.slug}`))
    expect(await counts(A.id, phone)).toEqual({ contacts: 1, leads: 1, conversations: 1, messages: 1 })
    const c = await convOf(A.id, phone)
    expect([A.members.ali.id, A.members.sara.id]).toContain(c.owner)
    expect((await pool.query(`SELECT source FROM leads WHERE id = $1`, [c.lead_id])).rows[0].source).toBe('chat')
    const n = await pool.query(`SELECT kind, conversation_id FROM notifications WHERE lead_id = $1 AND user_id = $2`, [c.lead_id, c.owner])
    expect(n.rows).toEqual([{ kind: 'lead.assigned', conversation_id: c.id }])
    // raw token is never stored
    const stored = await pool.query(`SELECT 1 FROM conversations WHERE encode(customer_token_hash, 'escape') LIKE '%' || $1 || '%'`, [r.token])
    expect(stored.rowCount).toBe(0)
  })

  it('2. a repeated idempotency key returns the original result and creates nothing new', async () => {
    const phone = phoneNo(), k = key()
    const body = { idempotencyKey: k, name: 'Dup Test', phone, message: 'Hello' }
    expect((await customer(A.slug, body)).status).toBe(201)
    const again = await customer(A.slug, body)
    expect(again.status).toBe(200)
    expect(again.data.duplicate).toBe(true)
    expect(await counts(A.id, phone)).toEqual({ contacts: 1, leads: 1, conversations: 1, messages: 1 })
  })

  it('3. two simultaneous first messages create one lead (same key, and different keys for the same phone)', async () => {
    const phone = phoneNo(), k = key()
    const body = { idempotencyKey: k, name: 'Race Test', phone, message: 'Hi' }
    const results = await Promise.all([customer(A.slug, body), customer(A.slug, body), customer(A.slug, body)])
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(await counts(A.id, phone)).toEqual({ contacts: 1, leads: 1, conversations: 1, messages: 1 })

    const phone2 = phoneNo()
    await Promise.all([customer(A.slug, { idempotencyKey: key(), name: 'Two Tabs', phone: phone2, message: 'a' }),
                       customer(A.slug, { idempotencyKey: key(), name: 'Two Tabs', phone: phone2, message: 'b' })])
    const c2 = await counts(A.id, phone2)
    expect(c2.leads).toBe(1)
    expect(c2.contacts).toBe(1)
  })

  it('4. later messages append to the conversation, create no lead, and notify the owner', async () => {
    const phone = phoneNo()
    const first = await customer(A.slug, { idempotencyKey: key(), name: 'Follow Up', phone, message: 'First' })
    const second = await customer(A.slug, { idempotencyKey: key(), message: 'Second' }, first.token)
    expect(second.status).toBe(200)
    expect(second.token).toBeNull() // no new cookie for an existing conversation
    expect(await counts(A.id, phone)).toEqual({ contacts: 1, leads: 1, conversations: 1, messages: 2 })
    const c = await convOf(A.id, phone)
    expect((await pool.query(`SELECT 1 FROM notifications WHERE conversation_id = $1 AND kind = 'message.new' AND user_id = $2`, [c.id, c.owner])).rowCount).toBe(1)
    const view = await customer(A.slug, null, first.token)
    expect(view.data.conversation.messages.map((m: { body: string }) => m.body)).toEqual(['First', 'Second'])
    expect(JSON.stringify(view.data)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/) // no database ids reach the customer
  })

  it('5+6. a token cannot open another conversation or another workspace', async () => {
    const r = await customer(A.slug, { idempotencyKey: key(), name: 'Private', phone: phoneNo(), message: 'secret plan' })
    expect((await customer(A.slug, null, 'not-a-real-token')).data.conversation).toBeNull()
    expect((await customer(B.slug, null, r.token)).data.conversation).toBeNull()
    // a forged cookie plus a message is treated as a brand-new customer, never attached to someone else
    const forged = await customer(A.slug, { idempotencyKey: key(), message: 'let me in' }, 'forged-token-value')
    expect(forged.status).toBe(400)
    expect((await customer('no-such-workspace', null)).status).toBe(404)
  })

  it('a visitor typing an existing phone number learns nothing stored in the CRM', async () => {
    const phone = phoneNo()
    await customer(A.slug, { idempotencyKey: key(), name: 'Real Customer Name', phone, email: 'real@example.com', message: 'first' })
    const intruder = await customer(A.slug, { idempotencyKey: key(), name: 'Somebody Else', phone, message: 'who am I?' })
    expect(intruder.status).toBe(201)
    const view = await customer(A.slug, null, intruder.token)
    const json = JSON.stringify(view)
    expect(json).not.toContain('Real Customer Name')
    expect(json).not.toContain('real@example.com')
    expect(json).not.toContain('first') // the other session's messages stay private
    expect(view.data.conversation.messages).toHaveLength(1)
  })

  it('13. a failure mid-transaction leaves no contact, conversation, lead or message', async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_chat() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT name FROM contacts WHERE id = NEW.contact_id) = 'Rollback Chat' THEN RAISE EXCEPTION 'controlled failure'; END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS test_fail_chat_t ON leads;
      CREATE TRIGGER test_fail_chat_t BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION test_fail_chat();`)
    try {
      const phone = phoneNo(), k = key()
      const r = await customer(A.slug, { idempotencyKey: k, name: 'Rollback Chat', phone, message: 'boom' })
      expect(r.status).toBe(500)
      expect(r.data.error).not.toMatch(/controlled/)
      expect(await counts(A.id, phone)).toEqual({ contacts: 0, leads: 0, conversations: 0, messages: 0 })
      expect((await pool.query('SELECT 1 FROM messages WHERE client_key = $1', [k])).rowCount).toBe(0)
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_fail_chat_t ON leads; DROP FUNCTION IF EXISTS test_fail_chat()')
    }
  })
})

describe('agent inbox', () => {
  it('7. a non-owner agent and another workspace get 404; 8. the owner acknowledges; 9. the reply reaches the customer', async () => {
    const phone = phoneNo()
    const cust = await customer(A.slug, { idempotencyKey: key(), name: 'Inbox Flow', phone, message: 'Is anyone there?' })
    const c = await convOf(A.id, phone)
    const owner = Object.values(A.members).find(m => m.id === c.owner)!
    const other = Object.values(A.members).find(m => m.id !== c.owner)!

    expect((await convGET(agentReq('/x', { method: 'GET', token: other.token }), P({ id: c.id }))).status).toBe(404)
    expect((await replyPOST(agentReq('/x', { token: other.token, body: { body: 'hijack' } }), P({ id: c.id }))).status).toBe(404)
    expect((await convGET(agentReq('/x', { method: 'GET', token: B.owner }), P({ id: c.id }))).status).toBe(404)
    expect((await replyPOST(agentReq('/x', { token: B.owner, body: { body: 'cross tenant' } }), P({ id: c.id }))).status).toBe(404)

    const view = await (await convGET(agentReq('/x', { method: 'GET', token: owner.token }), P({ id: c.id }))).json()
    expect(view.messages).toHaveLength(1)

    const ack = await ackPOST(agentReq('/x', { token: owner.token }), P({ id: c.lead_id }))
    expect((await ack.json()).acknowledged).toBe(true)

    const reply = await replyPOST(agentReq('/x', { token: owner.token, body: { body: 'Yes! Ali here, sending your quote.' } }), P({ id: c.id }))
    expect(reply.status).toBe(201)
    const seen = await customer(A.slug, null, cust.token)
    const last = seen.data.conversation.messages.at(-1)
    expect(last).toMatchObject({ from: 'agent', body: 'Yes! Ali here, sending your quote.', agent: owner === A.members.ali ? 'ali' : 'sara' })
    expect((await pool.query(`SELECT 1 FROM activities WHERE lead_id = $1 AND kind = 'message' AND actor_id = $2`, [c.lead_id, owner.id])).rowCount).toBe(1)
    expect((await pool.query(`SELECT 1 FROM audit_logs WHERE target_id = $1 AND action = 'conversation.replied'`, [c.id])).rowCount).toBe(1)
  })

  it('11. a missed acknowledgement escalates and notifies both the new owner and the one who missed it', async () => {
    const phone = phoneNo()
    await customer(A.slug, { idempotencyKey: key(), name: 'Ignored Lead', phone, message: 'Hello?' })
    const c = await convOf(A.id, phone)
    // make the deadline pass: tests may disable the guard trigger in their own setup only (CLAUDE.md)
    await pool.query('ALTER TABLE lead_assignments DISABLE TRIGGER lead_assignments_guard_t')
    try {
      await pool.query(`UPDATE lead_assignments SET assigned_at = now() - interval '2 minutes', deadline_at = now() - interval '1 minute'
                         WHERE lead_id = $1 AND closed_at IS NULL`, [c.lead_id])
    } finally {
      await pool.query('ALTER TABLE lead_assignments ENABLE TRIGGER lead_assignments_guard_t')
    }
    const a = (await pool.query('SELECT id FROM lead_assignments WHERE lead_id = $1 AND closed_at IS NULL', [c.lead_id])).rows[0]
    expect((await pool.query('SELECT sweep_one($1) AS r', [a.id])).rows[0].r).toBe('escalated')
    const now = await convOf(A.id, phone)
    expect(now.owner).not.toBe(c.owner)
    const n = await pool.query('SELECT user_id, kind FROM notifications WHERE lead_id = $1 ORDER BY created_at', [c.lead_id])
    expect(n.rows).toEqual(expect.arrayContaining([
      { user_id: c.owner, kind: 'lead.missed' },
      { user_id: now.owner, kind: 'lead.escalated' },
    ]))
  })
})

describe('realtime privacy', () => {
  it('12. NOTIFY payloads carry IDs only, never names, phones, emails or message text', async () => {
    const listener = new Client({ connectionString: process.env.DATABASE_URL })
    await listener.connect()
    const payloads: string[] = []
    listener.on('notification', n => payloads.push(n.payload ?? ''))
    await listener.query('LISTEN workspace_events')
    const phone = phoneNo()
    await customer(A.slug, { idempotencyKey: key(), name: 'Very Private Person', phone, email: 'private@example.com', message: 'my secret address is 12 Mall Road' })
    await new Promise(r => setTimeout(r, 400))
    await listener.end()
    expect(payloads.length).toBeGreaterThan(3)
    for (const p of payloads) {
      expect(Object.keys(JSON.parse(p)).sort()).toEqual(['conversation_id', 'id', 'lead_id', 'op', 'table', 'ws'])
      expect(p).not.toMatch(/Very Private|private@example|Mall Road/)
      expect(p).not.toContain(phone)
    }
  })
})
