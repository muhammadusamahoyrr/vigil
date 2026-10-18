// Demo data (Step 15). Run once against an empty-ish database:
//   npm run seed
// Creates two workspaces through the same services the app uses (signup bootstrap,
// lead intake via the lead engine). Safe to re-run: it stops if the demo owner exists.
// Optional env: SEED_PASSWORD (default below), SLACK_BOT_TOKEN (connects Slack),
// SEED_SLACK_EMAIL (links Ali's alerts to that Slack account).
import './seed-env'
import { pool } from '../src/db/client'
import { encrypt } from '../src/lib/crypto'
import { systemCtx, type Ctx } from '../src/lib/session'
import { signup } from '../src/services/auth'
import { createLead } from '../src/services/leads'
import { addMember } from '../src/services/team'
import { authTest, lookupUserByEmail } from '../src/providers/slack'

const PASSWORD = process.env.SEED_PASSWORD || 'VigilDemo2026!'
const OWNER_EMAIL = 'ayesha@lahoresolar.demo'

const ownerCtx = (workspaceId: string, userId: string): Ctx =>
  ({ workspaceId, userId, level: 'owner', permissions: ['*'], isSystem: false })

async function main() {
  const exists = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [OWNER_EMAIL])
  if (exists.rowCount) { console.log(`Demo data already present (${OWNER_EMAIL}). Nothing to do.`); return }

  // ---- Workspace 1: Lahore Solar Solutions
  const s = await signup({ workspaceName: 'Lahore Solar Solutions', name: 'Ayesha Khan', email: OWNER_EMAIL, password: PASSWORD })
  const ws = s.workspaceId
  const owner = ownerCtx(ws, s.userId)
  const role = async (name: string) =>
    (await pool.query('SELECT id FROM roles WHERE workspace_id = $1 AND name = $2', [ws, name])).rows[0].id as string
  const sales = await role('Sales'), manager = await role('Manager')

  const people = [
    { name: 'Hamza Raza', email: 'hamza@lahoresolar.demo', level: 'admin' as const, roleId: undefined },
    { name: 'Fatima Noor', email: 'fatima@lahoresolar.demo', level: 'user' as const, roleId: manager },
    { name: 'Ali Hassan', email: 'ali@lahoresolar.demo', level: 'user' as const, roleId: sales },
    { name: 'Sara Malik', email: 'sara@lahoresolar.demo', level: 'user' as const, roleId: sales },
    { name: 'Bilal Iqbal', email: 'bilal@lahoresolar.demo', level: 'user' as const, roleId: sales },
  ]
  const ids: Record<string, string> = {}
  for (const p of people) ids[p.name.split(' ')[0]] = (await addMember(owner, { ...p, password: PASSWORD })).userId

  // Owner and Admin watch; sales people and the manager take leads
  await pool.query(`UPDATE users SET availability = 'busy' WHERE id = ANY($1)`, [[s.userId, ids.Hamza, ids.Fatima]])
  await pool.query(
    `UPDATE assignment_rules SET ack_window_seconds = 20, max_open_leads = 5, idle_seconds = 300,
            escalation_levels = $2, backup_user_id = $3, manager_role_id = $4
      WHERE workspace_id = $1`,
    [ws, JSON.stringify([{ type: 'next_available', seconds: 20 }, { type: 'backup', seconds: 20 }, { type: 'manager', seconds: 20 }]),
     ids.Bilal, manager])

  // Slack (optional)
  const token = process.env.SLACK_BOT_TOKEN?.trim()
  if (token?.startsWith('xoxb-')) {
    const { team } = await authTest(token)
    await pool.query(
      `INSERT INTO integration_connections (workspace_id, provider, status, credentials, external_account_ref, last_ok_at)
       VALUES ($1, 'slack', 'connected', $2, $3, now())`, [ws, encrypt(token), team])
    console.log(`Slack connected (workspace "${team}")`)
    const slackEmail = process.env.SEED_SLACK_EMAIL?.trim().toLowerCase()
    if (slackEmail) {
      const slackId = await lookupUserByEmail(token, slackEmail)
      await pool.query('UPDATE users SET slack_email = $2, slack_user_id = $3 WHERE id = $1', [ids.Ali, slackEmail, slackId])
      console.log(`Ali's alerts go to Slack account ${slackEmail}`)
    }
  } else {
    console.log('SLACK_BOT_TOKEN not set: connect Slack later in Integrations')
  }

  // A few leads through the real engine (they start their countdown now)
  const sys = systemCtx(ws)
  const leads = [
    { name: 'Usman Tariq', phone: '+923001112233', message: '5kW rooftop system for a house in DHA' },
    { name: 'Hira Sheikh', phone: '+923214445566', message: 'Net metering and battery backup' },
    { name: 'Kamran Butt', phone: '+923337778899', message: 'Solar for a small factory, 30kW' },
  ]
  const created = []
  for (const l of leads) created.push(await createLead(sys, l, 'form'))
  // one lead already acknowledged by its owner
  const first = (await pool.query('SELECT user_id FROM lead_assignments WHERE id = $1', [created[0].assignmentId])).rows[0]
  if (first) await pool.query(`SELECT record_lead_action($1, $2, 'human', 'call_log')`, [created[0].leadId, first.user_id])

  // ---- Workspace 2: Other Co (proves isolation)
  const o = await signup({ workspaceName: 'Other Co', name: 'Omar Farooq', email: 'omar@otherco.demo', password: PASSWORD })
  await addMember(ownerCtx(o.workspaceId, o.userId), { name: 'Zara Ahmed', email: 'zara@otherco.demo', password: PASSWORD, level: 'user', roleId: undefined })
  await createLead(systemCtx(o.workspaceId), { name: 'Other Co Customer', phone: '+923009990000' }, 'manual')

  const form = (await pool.query('SELECT public_form_token FROM workspaces WHERE id = $1', [ws])).rows[0].public_form_token
  console.log(`
Demo data ready. Password for every account: ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : PASSWORD}
  Lahore Solar Solutions
    Owner    ayesha@lahoresolar.demo
    Admin    hamza@lahoresolar.demo
    Manager  fatima@lahoresolar.demo   (Manager role)
    Sales    ali@lahoresolar.demo, sara@lahoresolar.demo, bilal@lahoresolar.demo (Bilal = backup)
    Rules    20s window: next available -> backup (Bilal) -> manager role
    Web form ${process.env.APP_URL ?? ''}/f/${form}
  Other Co (isolation demo)
    Owner    omar@otherco.demo
`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exitCode = 1 })
  .finally(() => pool.end())
