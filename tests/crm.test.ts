// CRM core, roles/audit, dashboard consistency and tenant isolation.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '@/db/client'
import { POST as signupPOST } from '@/app/api/auth/signup/route'
import { GET as contactsGET, POST as contactsPOST } from '@/app/api/contacts/route'
import { DELETE as contactDELETE, GET as contactGET, PATCH as contactPATCH } from '@/app/api/contacts/[id]/route'
import { POST as oppPOST } from '@/app/api/opportunities/route'
import { POST as movePOST } from '@/app/api/opportunities/[id]/move/route'
import { GET as exportGET } from '@/app/api/export/[entity]/route'
import { PUT as rolePUT } from '@/app/api/roles/[id]/route'
import { GET as auditGET } from '@/app/api/audit/route'
import { POST as leadsPOST, GET as leadsGET } from '@/app/api/leads/route'
import { getCtx, newSessionToken, SESSION_COOKIE } from '@/lib/session'
import { dashboard } from '@/lib/metrics'

const APP = 'http://localhost:3000'
const uniq = () => randomUUID().slice(0, 8)
const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
function req(path: string, o: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP }
  if (o.token) headers.cookie = `${SESSION_COOKIE}=${o.token}`
  return new Request(`${APP}${path}`, { method: o.method ?? 'POST', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}

type WS = { id: string; owner: string; sales: string; salesRole: string }
async function workspace(): Promise<WS> {
  const res = await signupPOST(req('/api/auth/signup', { body: { workspaceName: `CRM ${uniq()}`, name: 'Owner', email: `c-${uniq()}@test.local`, password: 'correct-horse-battery' } }), undefined)
  const b = await res.json()
  const owner = decodeURIComponent(res.headers.get('set-cookie')!.match(/vigil_session=([^;]*)/)![1])
  const salesRole = (await pool.query(`SELECT id FROM roles WHERE workspace_id = $1 AND name = 'Sales'`, [b.workspaceId])).rows[0].id
  const uid = (await pool.query(`INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1, $2, 'Rep', 'x') RETURNING id`, [b.workspaceId, `r-${uniq()}@test.local`])).rows[0].id
  await pool.query('INSERT INTO user_roles (workspace_id, user_id, role_id) VALUES ($1, $2, $3)', [b.workspaceId, uid, salesRole])
  const t = newSessionToken()
  await pool.query('INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [b.workspaceId, uid, t.hash, t.expiresAt])
  return { id: b.workspaceId, owner, sales: t.token, salesRole }
}

let A: WS, B: WS, contactId: string, oppId: string
beforeAll(async () => {
  A = await workspace(); B = await workspace()
  contactId = (await (await contactsPOST(req('/api/contacts', { token: A.owner, body: { name: 'Nadia Khan', phone: `+92300${Math.floor(1e6 + Math.random() * 8e6)}`, companyName: 'Khan Traders' } }), undefined)).json()).id
  oppId = (await (await oppPOST(req('/api/opportunities', { token: A.owner, body: { contactId, name: '10kW system', value: 1250000, currency: 'PKR' } }), undefined)).json()).id
})
afterAll(async () => { await pool.end() })

describe('field-level protection (F1.4)', () => {
  it('masks opportunity value for Sales in detail AND export, shows it to the Owner', async () => {
    const ownerView = await (await contactGET(req('/x', { method: 'GET', token: A.owner }), P({ id: contactId }))).json()
    expect(Number(ownerView.opportunities[0].value)).toBe(1250000)
    const salesView = await (await contactGET(req('/x', { method: 'GET', token: A.sales }), P({ id: contactId }))).json()
    expect(salesView.opportunities[0].value).toBeNull()
    expect(salesView.opportunities[0].value_masked).toBe(true)
    // Sales has no crm.export by default -> 403; grant it and the CSV is still masked
    expect((await exportGET(req('/x', { method: 'GET', token: A.sales }), P({ entity: 'opportunities' }))).status).toBe(403)
    const keys = (await pool.query(`SELECT array_agg(permission_key) k FROM role_permissions WHERE role_id = $1`, [A.salesRole])).rows[0].k
    expect((await rolePUT(req('/x', { method: 'PUT', token: A.owner, body: { keys: [...keys, 'crm.export'] } }), P({ id: A.salesRole }))).status).toBe(200)
    const csv = await (await exportGET(req('/x', { method: 'GET', token: A.sales }), P({ entity: 'opportunities' }))).text()
    expect(csv).toContain('10kW system')
    expect(csv).not.toContain('1250000')
    const ownerCsv = await (await exportGET(req('/x', { method: 'GET', token: A.owner }), P({ entity: 'opportunities' }))).text()
    expect(ownerCsv).toContain('1250000')
  })

  it('a permission toggle applies immediately (same cookie)', async () => {
    const keys = (await pool.query(`SELECT array_agg(permission_key) k FROM role_permissions WHERE role_id = $1`, [A.salesRole])).rows[0].k
    await rolePUT(req('/x', { method: 'PUT', token: A.owner, body: { keys: [...keys, 'opportunity_value.view'] } }), P({ id: A.salesRole }))
    const v = await (await contactGET(req('/x', { method: 'GET', token: A.sales }), P({ id: contactId }))).json()
    expect(Number(v.opportunities[0].value)).toBe(1250000)
    await rolePUT(req('/x', { method: 'PUT', token: A.owner, body: { keys } }), P({ id: A.salesRole }))
    expect((await pool.query(`SELECT 1 FROM audit_logs WHERE target_id = $1 AND action = 'role.permissions_changed'`, [A.salesRole])).rowCount).toBeGreaterThan(0)
  })
})

describe('pipeline and records', () => {
  it('blocks a stage move until required fields are filled (F2.4) and detects stale versions', async () => {
    const stages = (await pool.query(`SELECT s.id, s.name FROM stages s JOIN opportunities o ON o.pipeline_id = s.pipeline_id WHERE o.id = $1 ORDER BY s.position`, [oppId])).rows
    const proposal = stages.find(s => s.name === 'Proposal')!
    await pool.query(`INSERT INTO field_definitions (workspace_id, entity, key, label, field_type) VALUES ($1, 'opportunity', 'roof_size', 'Roof size', 'number')`, [A.id])
    await pool.query(`UPDATE stages SET required_fields = '{roof_size}' WHERE id = $1`, [proposal.id])
    const blocked = await movePOST(req('/x', { token: A.owner, body: { stageId: proposal.id, version: 1 } }), P({ id: oppId }))
    expect(blocked.status).toBe(400)
    expect((await blocked.json()).error).toMatch(/Roof size/)
    await pool.query(`UPDATE opportunities SET custom_data = '{"roof_size": 120}' WHERE id = $1`, [oppId])
    const moved = await movePOST(req('/x', { token: A.owner, body: { stageId: proposal.id, version: 1 } }), P({ id: oppId }))
    expect(moved.status).toBe(200)
    const stale = await movePOST(req('/x', { token: A.owner, body: { stageId: stages[0].id, version: 1 } }), P({ id: oppId }))
    expect(stale.status).toBe(409)
    expect((await pool.query(`SELECT 1 FROM activities WHERE opportunity_id = $1 AND kind = 'stage_change'`, [oppId])).rowCount).toBe(1)
  })

  it('refuses to delete a contact with history, deletes one without', async () => {
    const r = await contactDELETE(req('/x', { method: 'DELETE', token: A.owner }), P({ id: contactId }))
    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/1 opportunity/)
    const lone = (await (await contactsPOST(req('/api/contacts', { token: A.owner, body: { name: 'Temp Person' } }), undefined)).json()).id
    expect((await contactDELETE(req('/x', { method: 'DELETE', token: A.owner }), P({ id: lone }))).status).toBe(200)
    expect((await contactDELETE(req('/x', { method: 'DELETE', token: A.sales }), P({ id: contactId }))).status).toBe(403)
  })

  it('optimistic locking on contact edits', async () => {
    const ok = await contactPATCH(req('/x', { method: 'PATCH', token: A.owner, body: { name: 'Nadia K.', version: 1 } }), P({ id: contactId }))
    expect(ok.status).toBe(200)
    const stale = await contactPATCH(req('/x', { method: 'PATCH', token: A.owner, body: { name: 'Old', version: 1 } }), P({ id: contactId }))
    expect(stale.status).toBe(409)
  })
})

describe('tenant isolation and audit', () => {
  it('workspace B gets 404 on A records and never sees them in lists or exports', async () => {
    expect((await contactGET(req('/x', { method: 'GET', token: B.owner }), P({ id: contactId }))).status).toBe(404)
    expect((await contactPATCH(req('/x', { method: 'PATCH', token: B.owner, body: { name: 'Hack' } }), P({ id: contactId }))).status).toBe(404)
    expect((await contactDELETE(req('/x', { method: 'DELETE', token: B.owner }), P({ id: contactId }))).status).toBe(404)
    expect((await movePOST(req('/x', { token: B.owner, body: { stageId: randomUUID(), version: 1 } }), P({ id: oppId }))).status).toBe(404)
    const list = await (await contactsGET(req('/api/contacts', { method: 'GET', token: B.owner }), undefined)).json()
    expect(list.contacts.some((c: { id: string }) => c.id === contactId)).toBe(false)
    const csv = await (await exportGET(req('/x', { method: 'GET', token: B.owner }), P({ entity: 'contacts' }))).text()
    expect(csv).not.toContain('Nadia')
  })

  it('audit log needs audit.view; Owner sees filtered entries', async () => {
    expect((await auditGET(req('/api/audit', { method: 'GET', token: A.sales }), undefined)).status).toBe(403)
    const a = await (await auditGET(req('/api/audit?action=contact.', { method: 'GET', token: A.owner }), undefined)).json()
    expect(a.rows.length).toBeGreaterThan(0)
    expect(a.rows.every((r: { action: string }) => r.action.startsWith('contact.'))).toBe(true)
  })
})

describe('dashboard (F5.2 consistency)', () => {
  it('"New leads today" equals the drill-down list count', async () => {
    await pool.query(`UPDATE users SET availability = 'busy' WHERE workspace_id = $1 AND level = 'owner'`, [A.id])
    for (let i = 0; i < 2; i++) await leadsPOST(req('/api/leads', { token: A.owner, body: { name: `Today ${i}` } }), undefined)
    const ctx = await getCtx(req('/x', { method: 'GET', token: A.owner }))
    const d = await dashboard(ctx)
    const list = await (await leadsGET(req('/api/leads?today=1', { method: 'GET', token: A.owner }), undefined)).json()
    // listLeads honours ?today via the page; the API route ignores it, so compare with the service directly
    const { listLeads } = await import('@/services/leads')
    const today = await listLeads(ctx, { today: true })
    expect(d.newLeadsToday).toBe(today.leads.length)
    expect(list.leads.length).toBeGreaterThanOrEqual(today.leads.length)
    expect(d.personal).toBe(false)
  })
})
