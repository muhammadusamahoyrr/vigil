// Lead vertical slice: intake -> assignment -> acknowledge -> reassign, permissions,
// tenant isolation, public form, availability, and the outbox when Slack is missing.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '@/db/client'
import { POST as signupPOST } from '@/app/api/auth/signup/route'
import { GET as leadsGET, POST as leadsPOST } from '@/app/api/leads/route'
import { GET as leadGET } from '@/app/api/leads/[id]/route'
import { POST as ackPOST } from '@/app/api/leads/[id]/acknowledge/route'
import { POST as notePOST } from '@/app/api/leads/[id]/notes/route'
import { POST as reassignPOST } from '@/app/api/leads/[id]/reassign/route'
import { POST as availabilityPOST } from '@/app/api/users/[id]/availability/route'
import { POST as formPOST } from '@/app/api/public/forms/[token]/route'
import { SESSION_COOKIE, newSessionToken } from '@/lib/session'
import { sendOutbox } from '../worker/outbox'

const APP = 'http://localhost:3000'
const uniq = () => randomUUID().slice(0, 8)
const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

function req(path: string, opts: { method?: string; body?: unknown; token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP }
  if (opts.token) headers.cookie = `${SESSION_COOKIE}=${opts.token}`
  if (opts.ip) headers['x-forwarded-for'] = opts.ip
  return new Request(`${APP}${path}`, { method: opts.method ?? 'POST', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
}

type WS = { id: string; ownerToken: string; ownerId: string; members: Record<string, { id: string; token: string }> }

async function sessionFor(ws: string, user: string) {
  const t = newSessionToken()
  await pool.query('INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [ws, user, t.hash, t.expiresAt])
  return t.token
}

/** Signup + members with roles. The Owner is set Busy so leads go to the members. */
async function workspace(): Promise<WS> {
  const res = await signupPOST(req('/api/auth/signup', {
    body: { workspaceName: `Leads ${uniq()}`, name: 'Owner', email: `o-${uniq()}@test.local`, password: 'correct-horse-battery' },
  }), undefined)
  const body = await res.json()
  const ownerToken = decodeURIComponent(res.headers.get('set-cookie')!.match(/vigil_session=([^;]*)/)![1])
  const ws = body.workspaceId as string
  await pool.query(`UPDATE users SET availability = 'busy' WHERE id = $1`, [body.userId])
  await pool.query(`UPDATE assignment_rules SET ack_window_seconds = 20 WHERE workspace_id = $1`, [ws])
  const members: WS['members'] = {}
  for (const [name, role] of [['ali', 'Sales'], ['sara', 'Sales'], ['manager', 'Manager']] as const) {
    const id = (await pool.query(
      `INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
      [ws, `${name}-${uniq()}@test.local`, name])).rows[0].id
    await pool.query(`INSERT INTO user_roles (workspace_id, user_id, role_id) SELECT $1, $2, id FROM roles WHERE workspace_id = $1 AND name = $3`, [ws, id, role])
    members[name] = { id, token: await sessionFor(ws, id) }
  }
  await pool.query(`UPDATE users SET availability = 'busy' WHERE id = $1`, [members.manager.id])
  return { id: ws, ownerToken, ownerId: body.userId, members }
}

let A: WS, B: WS
beforeAll(async () => { A = await workspace(); B = await workspace() })
afterAll(async () => { await pool.end() })

async function newLead(ws: WS, token = ws.ownerToken) {
  const r = await leadsPOST(req('/api/leads', { token, body: { name: `Customer ${uniq()}`, phone: `+92300${Math.floor(1e6 + Math.random() * 8e6)}` } }), undefined)
  expect(r.status).toBe(201)
  return r.json() as Promise<{ leadId: string; assignmentId: string | null; contactId: string }>
}

describe('lead slice', () => {
  it('manual lead is assigned to exactly one Available member, with alert queued and activity written', async () => {
    const lead = await newLead(A)
    expect(lead.assignmentId).toBeTruthy()
    const a = (await pool.query('SELECT user_id FROM lead_assignments WHERE lead_id = $1 AND closed_at IS NULL', [lead.leadId])).rows
    expect(a).toHaveLength(1)
    expect([A.members.ali.id, A.members.sara.id]).toContain(a[0].user_id)
    expect((await pool.query(`SELECT 1 FROM outbox WHERE assignment_id = $1 AND kind = 'notify'`, [lead.assignmentId])).rowCount).toBe(1)
    expect((await pool.query(`SELECT 1 FROM leads WHERE id = $1 AND source = 'manual'`, [lead.leadId])).rowCount).toBe(1)
    expect((await pool.query(`SELECT 1 FROM audit_logs WHERE target_id = $1 AND action = 'lead.created'`, [lead.leadId])).rowCount).toBe(1)
  })

  it('same phone twice reuses the contact', async () => {
    const phone = `+92311${Math.floor(1e6 + Math.random() * 8e6)}`
    const one = await (await leadsPOST(req('/api/leads', { token: A.ownerToken, body: { name: 'Repeat', phone } }), undefined)).json()
    const two = await (await leadsPOST(req('/api/leads', { token: A.ownerToken, body: { name: 'Repeat', phone } }), undefined)).json()
    expect(one.contactId).toBe(two.contactId)
    expect(one.leadId).not.toBe(two.leadId)
  })

  it('only the owner acknowledges; acknowledgement keeps ownership', async () => {
    const lead = await newLead(A)
    const ownerId = (await pool.query('SELECT user_id FROM lead_assignments WHERE id = $1', [lead.assignmentId])).rows[0].user_id
    const owner = Object.values(A.members).find(m => m.id === ownerId)!
    const other = Object.values(A.members).find(m => m.id !== ownerId && m !== A.members.manager)!
    // a Sales user who is not the owner cannot even see it
    expect((await ackPOST(req('/x', { token: other.token }), P({ id: lead.leadId }))).status).toBe(404)
    const ok = await ackPOST(req('/x', { token: owner.token }), P({ id: lead.leadId }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).acknowledged).toBe(true)
    const row = (await pool.query('SELECT acknowledged_at, closed_at FROM lead_assignments WHERE id = $1', [lead.assignmentId])).rows[0]
    expect(row.acknowledged_at).not.toBeNull()
    expect(row.closed_at).toBeNull()
  })

  it('a note by the owner acknowledges too', async () => {
    const lead = await newLead(A)
    const ownerId = (await pool.query('SELECT user_id FROM lead_assignments WHERE id = $1', [lead.assignmentId])).rows[0].user_id
    const owner = Object.values(A.members).find(m => m.id === ownerId)!
    const r = await notePOST(req('/x', { token: owner.token, body: { body: 'Called, interested' } }), P({ id: lead.leadId }))
    expect((await r.json()).acknowledged).toBe(true)
  })

  it('reassign needs leads.reassign (Sales gets 403, Manager succeeds)', async () => {
    const lead = await newLead(A)
    const ownerId = (await pool.query('SELECT user_id FROM lead_assignments WHERE id = $1', [lead.assignmentId])).rows[0].user_id
    const owner = Object.values(A.members).find(m => m.id === ownerId)!
    const target = ownerId === A.members.ali.id ? A.members.sara : A.members.ali
    expect((await reassignPOST(req('/x', { token: owner.token, body: { toUserId: target.id } }), P({ id: lead.leadId }))).status).toBe(403)
    const r = await reassignPOST(req('/x', { token: A.members.manager.token, body: { toUserId: target.id } }), P({ id: lead.leadId }))
    expect(r.status).toBe(200)
    const open = (await pool.query('SELECT user_id FROM lead_assignments WHERE lead_id = $1 AND closed_at IS NULL', [lead.leadId])).rows
    expect(open).toEqual([{ user_id: target.id }])
    // reassigning to someone not Available is refused with a clear message
    const busy = await reassignPOST(req('/x', { token: A.members.manager.token, body: { toUserId: A.members.manager.id } }), P({ id: lead.leadId }))
    expect(busy.status).toBe(409)
    expect((await busy.json()).error).toMatch(/not Available/)
  })

  it('another workspace cannot read or act on a lead (404)', async () => {
    const lead = await newLead(A)
    expect((await leadGET(req('/x', { method: 'GET', token: B.ownerToken }), P({ id: lead.leadId }))).status).toBe(404)
    expect((await ackPOST(req('/x', { token: B.ownerToken }), P({ id: lead.leadId }))).status).toBe(404)
    expect((await reassignPOST(req('/x', { token: B.ownerToken, body: { toUserId: B.members.ali.id } }), P({ id: lead.leadId }))).status).toBe(404)
    const list = await (await leadsGET(req('/api/leads', { method: 'GET', token: B.ownerToken }), undefined)).json()
    expect(list.leads.find((l: { id: string }) => l.id === lead.leadId)).toBeUndefined()
  })

  it('setting the owner On leave moves an unacknowledged lead immediately', async () => {
    const lead = await newLead(A)
    const ownerId = (await pool.query('SELECT user_id FROM lead_assignments WHERE id = $1', [lead.assignmentId])).rows[0].user_id
    const owner = Object.values(A.members).find(m => m.id === ownerId)!
    const r = await availabilityPOST(req('/x', { token: owner.token, body: { status: 'on_leave' } }), P({ id: ownerId }))
    expect((await r.json()).moved).toBeGreaterThanOrEqual(1)
    const now = (await pool.query('SELECT user_id FROM lead_assignments WHERE lead_id = $1 AND closed_at IS NULL', [lead.leadId])).rows[0].user_id
    expect(now).not.toBe(ownerId)
    // a Sales user cannot change someone else's availability
    const other = Object.values(A.members).find(m => m.id !== ownerId && m !== A.members.manager)!
    expect((await availabilityPOST(req('/x', { token: other.token, body: { status: 'busy' } }), P({ id: ownerId }))).status).toBe(403)
    await availabilityPOST(req('/x', { token: owner.token, body: { status: 'available' } }), P({ id: ownerId }))
  })

  it('public form creates a form lead; honeypot stores nothing; 6th submission per minute is limited', async () => {
    const token = (await pool.query('SELECT public_form_token FROM workspaces WHERE id = $1', [A.id])).rows[0].public_form_token
    const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
    const phone = `+92322${Math.floor(1e6 + Math.random() * 8e6)}`
    const ok = await formPOST(req('/f', { ip, body: { name: 'Web Visitor', phone } }), P({ token }))
    expect(ok.status).toBe(201)
    expect((await pool.query(`SELECT 1 FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.phone = $1 AND l.source = 'form' AND l.workspace_id = $2`, [phone, A.id])).rowCount).toBe(1)
    const botPhone = `+92333${Math.floor(1e6 + Math.random() * 8e6)}`
    const bot = await formPOST(req('/f', { ip, body: { name: 'Bot', phone: botPhone, website: 'spam.example' } }), P({ token }))
    expect(bot.status).toBe(200)
    expect((await pool.query('SELECT 1 FROM contacts WHERE phone = $1', [botPhone])).rowCount).toBe(0)
    for (let i = 0; i < 3; i++) await formPOST(req('/f', { ip, body: { name: 'Again', phone } }), P({ token }))
    expect((await formPOST(req('/f', { ip, body: { name: 'Again', phone } }), P({ token }))).status).toBe(429)
    expect((await formPOST(req('/f', { ip: '10.9.9.9', body: { name: 'X', phone } }), P({ token: 'f'.repeat(32) }))).status).toBe(404)
  })

  it('without a Slack connection the alert fails permanently but the lead is still owned', async () => {
    const lead = await newLead(B)
    for (let i = 0; i < 20; i++) {
      await sendOutbox()
      const s = (await pool.query('SELECT status FROM outbox WHERE assignment_id = $1', [lead.assignmentId])).rows[0].status
      if (s !== 'pending') break
    }
    const o = (await pool.query('SELECT status, last_error FROM outbox WHERE assignment_id = $1', [lead.assignmentId])).rows[0]
    expect(o.status).toBe('failed')
    expect(o.last_error).toMatch(/Slack is not connected/)
    expect((await pool.query('SELECT 1 FROM lead_assignments WHERE lead_id = $1 AND closed_at IS NULL', [lead.leadId])).rowCount).toBe(1)
    expect((await pool.query(`SELECT 1 FROM integration_events WHERE workspace_id = $1 AND provider = 'slack' AND direction = 'out' AND status = 'failed'`, [B.id])).rowCount).toBeGreaterThan(0)
  })
})
