# BUILD GUIDE: step by step, with prompts

How to use: do **one step at a time**. Copy the prompt into your AI tool (it must have `CLAUDE.md` and `sql/` in the repo). Run the **Check it works** test. Commit. Next step.
Every prompt starts with: *"Follow CLAUDE.md."* Keep that.

Suggested split for 4 people: **A** steps 2-3, **B** step 4 + 12, **C** steps 5-6 (strongest person), **D** steps 7-11. Everyone does step 0-1 together.

---

## Step 0: Setup and deploy (hour 0, everyone)

Do by hand:
```bash
npx create-next-app@latest ubm --ts --tailwind --app --src-dir
cd ubm && npx shadcn@latest init
npm i pg zod @node-rs/argon2 twilio stripe googleapis
npm i -D tsx @types/pg vitest
```
Railway: new project -> add **PostgreSQL** -> add **web** service (this repo) -> add **worker** service (same repo, start command `npm run worker`). Both services share `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`.
Generate secrets: `openssl rand -base64 32` (use for `SESSION_SECRET` and `ENCRYPTION_KEY`).

`package.json` scripts: `"worker": "tsx worker/index.ts"`, `"migrate": "tsx scripts/migrate.ts"`, `"seed": "tsx scripts/seed.ts"`, `"test": "vitest run"`, `"check": "tsc --noEmit"`.

**Check it works:** the default Next.js page opens on your public Railway URL.

---

## Step 1: Database and helpers

**Prompt**
> Follow CLAUDE.md. Create `scripts/migrate.ts` that connects with `DATABASE_URL` and runs `sql/001_schema.sql` then `sql/002_lead_engine.sql`, skipping files already applied (keep a `schema_migrations` table). Create `src/db/client.ts` exporting a `pg` Pool. Create `src/db/scoped.ts` exporting `scoped(ctx)` which returns helpers (`query`, `one`, `tx(fn)`) and an `assertWorkspace` approach so every query includes `workspace_id = ctx.workspaceId`. Create `src/lib/audit.ts` with `audit(client, {ctx, action, targetType, targetId, before, after})` that inserts into `audit_logs` using the caller's transaction client. Create `src/lib/crypto.ts` with `encrypt(text)` and `decrypt(buf)` using AES-256-GCM, a fresh 12-byte nonce each time, stored as `nonce || tag || ciphertext`, key from `ENCRYPTION_KEY`.

**Check it works:** `npm run migrate` succeeds on Railway's database. In a SQL console: `DELETE FROM audit_logs;` fails with "audit_logs is immutable".

---

## Step 2: Auth, sessions, workspaces (F1.1, Q1)

**Prompt**
> Follow CLAUDE.md. Build auth. `POST /api/auth/signup` (zod: workspace name, name, email, password min 10 chars) creates in ONE transaction: workspace, Owner user (`level='owner'`), default roles ("Manager" with crm.view/create/edit, leads.reassign, conversations.view/send, payments.create, appointments.manage; "Sales" with crm.view/create/edit, conversations.view/send, appointments.manage), a default pipeline "Sales" with stages New, Contacted, Proposal, Won (is_won), Lost (is_lost), and an `assignment_rules` row (defaults). Hash with `@node-rs/argon2`. `POST /api/auth/login`: after 5 failed attempts lock for 15 minutes (`failed_logins`, `locked_until`); on success create a session (random 32-byte token in an httpOnly Secure SameSite=Lax cookie, store sha256 in `sessions`, 7 days). `POST /api/auth/logout` deletes the session. Create `src/lib/session.ts` with `getCtx(req)` and `systemCtx(workspaceId)` exactly as defined in CLAUDE.md (section Ctx): `getCtx` returns the full `Ctx` (`isSystem: false`; permissions = union of the user's roles; owner and admin get all) or throws 401. Add `src/lib/csrf.ts` that rejects POST/PUT/PATCH/DELETE (except `/api/webhooks/*`) when `Origin` does not equal `APP_URL`. Build simple login and signup pages with loading and error states.

**Check it works:** sign up -> you are logged in -> refresh -> still logged in -> log out -> `/dashboard` redirects to login. Wrong password 5 times -> locked message.

---

## Step 3: Roles, permissions, invites, audit page (F1.2-F1.5, F4)

**Prompt**
> Follow CLAUDE.md. Create `src/lib/permissions.ts` with the exact permission keys listed in CLAUDE.md (section Permissions). (`getCtx` and `systemCtx` already exist in `src/lib/session.ts` from Step 2; reuse them.) Create `src/lib/rbac.ts` with `requirePermission(ctx, key)` (throws 403) and `serialize(ctx, entity, rows)` which removes `value` from opportunities when ctx lacks `opportunity_value.view`. Build Settings > Team: Owner/Admin can invite by email (`invitations`, one-time token, store only its sha256, expires in 7 days, show the invite link on screen), assign level (admin/user) and roles, deactivate users (set `deactivated_at`, delete their sessions). An Admin cannot modify the Owner. Build Settings > Roles: create roles and toggle permissions live. Build `/accept-invite/[token]`. Build Settings > Audit: requires `audit.view`, filter by action, user, date, paginated, read-only (no edit/delete endpoints exist). Write audit rows for role/permission changes, invites, level changes, deactivation.

**Check it works:** as a User with no roles, `curl` a protected API with their cookie -> **403**. Toggle a permission in the UI -> it takes effect immediately. Audit page shows the changes.

---

## Step 4: CRM (F2)

Split into small prompts, one at a time.

**4a Contacts, companies, opportunities**
> Follow CLAUDE.md. Build contacts, companies and opportunities with services and API routes: list (pagination 50, search by name using `ILIKE`), detail, create, update with optimistic locking (`version`, 409 on conflict), delete (catch FK error 23503 and return a friendly message; deleting a contact that has leads, conversations, payments or appointments is refused with a message naming what blocks it). A contact belongs to a company and has many opportunities. Contact detail page shows related opportunities. Every response passes through `serialize()` (value masked without `opportunity_value.view`). Every route calls `requirePermission`. Every change writes an audit row and an `activities` row.

**Check:** two users, one without `opportunity_value.view`: value is hidden in the list and the detail page.

**4b Pipeline and board**
> Follow CLAUDE.md. Build the pipeline board: columns are stages, cards are opportunities, drag a card to move it (and a list view with a "move to stage" dropdown). Moving into a stage checks `stages.required_fields` and returns a clear message listing the missing fields instead of moving. Settings > Pipelines (permission `config.manage`): add, rename, reorder (update positions in one transaction; the constraint is deferrable), delete stages. Deleting a stage that has opportunities shows a dialog: "Move these N opportunities first" with a stage picker. Moving a stage by a human calls `record_lead_action` for the contact's open lead with reason `stage_change` (if any) and writes an `activities` row. Every stage add/rename/reorder/delete and every opportunity move writes an audit row with before and after.

**Check:** drag into a stage with a missing required field -> blocked with a message. Delete a stage with deals -> move dialog.

**4c Custom fields**
> Follow CLAUDE.md. Build Settings > Fields (`config.manage`): create fields (text, number, date, dropdown with options, checkbox) for contacts or opportunities, optionally for one pipeline only (`pipeline_id`). Forms and detail pages render fields from `field_definitions` and store values in `custom_data`. Server-side validation builds a zod schema from `field_definitions`. Two pipelines show different custom field sets. Creating, editing or deleting a field writes an audit row with before and after. Deleting a field asks for confirmation and removes its key from `custom_data` on every record in the same transaction. Editing a custom field value writes an `activities` row (field edit).

**Check:** add a dropdown field -> it appears on the form immediately without a deploy.

**4d Filters, saved lists, tags, activity**
> Follow CLAUDE.md. Add filtering to contacts and opportunities: combine at least three criteria (custom field, tag, stage, owner, created date) on the server with parameterised SQL. Save a filter as a list (`saved_views`); opening a saved list re-runs the filter so it updates as records match. Add tags (`tags`, `entity_tags`). Contact and opportunity pages show a time-ordered activity history (`activities`) with who and when, and the contact page also shows conversations, payments, appointments, assigned employee.

**Check:** save a list, add a matching record, open the list -> it appears.

---

## Step 5: Lead engine (F3, the most important step)

Read `sql/002_lead_engine.sql` first. Do **not** rewrite it. The app only calls it.

**5a Intake**
> Follow CLAUDE.md. Build lead intake. `services/leads.ts` `createLead(ctx, {contact, source})`: in ONE transaction insert/find the contact (match by phone within the workspace), insert the lead, then `SELECT assign_new_lead($1)`. Sources: manual entry (button on Leads page), public web form at `/f/[token]` (look up the workspace by `workspaces.public_form_token`, rate limit 5/min/IP, honeypot field, zod validation, no login), and inbound message (step 7). Each lead stores its source label. Build the Leads list and lead detail pages: owner, status, a live countdown to `deadline_at` for the current assignment, and an Acknowledge button that calls `SELECT record_lead_action($lead,$user,'human','button')`. Make sure the first owner is notified (CLAUDE.md, Lead engine: check what `002_lead_engine.sql` already enqueues to the outbox; add the first-assignment `notify` row only if it doesn't). The contact page shows the lead's assignment history: if the SQL functions don't write `activities` rows for assignments, read it from `lead_assignments` instead. Do not change the SQL.

**Check:** create three leads (form, manual, later WhatsApp) -> each has a different source label and exactly one owner.

**5b Availability and assignment rules**
> Follow CLAUDE.md. Add an availability dropdown (Available, Busy, On leave, Offline) in the header for the user, and in Settings > Team for Admins. It must call `SELECT change_availability($user,$status,$actor)` and nothing else. Show the exact availability policy text from CLAUDE.md (section Availability policy) next to it, word for word. Build Settings > Assignment rules (`assignment_rules.manage`): max open leads, acknowledgement window seconds, escalation levels (add/remove levels; each has type next_available/backup/manager and seconds), backup user, manager role, idle seconds. Audit every change.

**Check:** set a user Busy -> new leads skip them. Set the owner of an unacknowledged lead to On leave -> it moves at once.

**5c Worker**
Create `worker/index.ts` yourself or ask the AI. This is the correct logic:
```ts
import { pool } from '../src/db/client'
import { sendOutbox } from './outbox'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function loop(name: string, everyMs: number, fn: () => Promise<void>) {
  for (;;) {
    try { await fn() } catch (e) { console.error(name, e) }
    await sleep(everyMs)
  }
}

// escalation sweeper: each id is its own short transaction
loop('sweeper', 2000, async () => {
  const { rows } = await pool.query('SELECT * FROM due_assignment_ids(25) AS id')
  for (const r of rows) await pool.query('SELECT sweep_one($1)', [r.id])
})

// orphan guard
loop('orphans', 10000, async () => {
  const { rows } = await pool.query('SELECT * FROM orphan_lead_ids() AS id')
  for (const r of rows) await pool.query("SELECT assign_new_lead($1, 'lead.recovered')", [r.id])
})

loop('outbox', 2000, sendOutbox)
```
(Polling in the worker is fine. The ban in CLAUDE.md is on timers that *decide business outcomes* in memory. Deadlines live in the database.)

**Check:** with `ack_window_seconds=20`, create a lead and do nothing: it moves level by level every 20s, and the audit log shows `lead.escalated` entries. Stop the worker for a minute, start it: the escalation still happens.

**5d Recovery queue**
> Follow CLAUDE.md. Build `/recovery` reading the `recovery_queue` view joined to leads and contacts, scoped to the workspace, with the `reasons` column shown for each row and a "Reassign" action (permission `leads.reassign`) that calls `SELECT reassign_manually($lead,$to,$actor)`. Managers and above see everyone; users see only their own leads.

**Check:** an overdue lead, a twice-escalated lead and a lead whose owner is On leave all appear, each with its reason.

---

## Step 6: Realtime (Q11)

**Prompt**
> Follow CLAUDE.md. Build `GET /api/stream` as Server-Sent Events. Use a dedicated `pg` client that runs `LISTEN workspace_events`, parse the JSON payload, and forward only events whose `ws` equals the caller's workspace. Send headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and a heartbeat comment every 25 seconds. Create a `useLiveRefresh()` hook that refetches the current page data when an event arrives and when the connection reconnects. Use it on Leads, Recovery, Conversations and Dashboard.

**Check:** two browsers: create a lead in one, it appears in the other with no refresh.

---

## Step 7: Messaging, Twilio (I1)

**Prompt 7a: connect and receive**
> Follow CLAUDE.md. Build Settings > Integrations (permission `integrations.manage`) with a Twilio card: fields Account SID, Auth Token, WhatsApp number; save encrypted into `integration_connections` (generate `webhook_token`, set `external_account_ref` to the number, status connected). Show the workspace its own webhook URLs `{APP_URL}/api/webhooks/twilio/<token>` and `.../status`, plus the limit text "The WhatsApp sandbox only reaches phones that have sent the join phrase to the sandbox number." Never show secrets in full (mask all but last 4). Audit connect/change/remove. Build `POST /api/webhooks/twilio/[token]` following the webhook rules in CLAUDE.md exactly: raw body, token lookup, verify `X-Twilio-Signature` with that workspace's auth token over `APP_URL + path` plus sorted form params, `security_events` on failure, `ON CONFLICT DO NOTHING RETURNING` using `MessageSid` as `external_event_id`. Then: match contact by phone, else create contact and a lead (source `message`) and call `assign_new_lead`; find or create the conversation; insert the inbound message and an `activities` row.

**Prompt 7b: send, status, failure**
> Follow CLAUDE.md. Build the Conversations page (permission `conversations.view`) showing the assigned employee and messages with delivery status. Sending (permission `conversations.send`): refuse if `contacts.opted_out` and show why; in one transaction insert a `queued` message, an `activities` row and an outbox row for it (see CLAUDE.md, Outbox). Add a message handler to `worker/outbox.ts` (create the file with a `kind` dispatcher if it doesn't exist yet) that sends through `src/providers/twilio.ts`, stores `provider_ref` and writes an outbound `integration_events` row. Temporary errors retry with the outbox backoff; permanent errors (for example a phone that never joined the sandbox) set `delivery_status='failed'` with a plain `failed_reason` at once. Failed messages stay visible with a Retry button that queues them again. Sending a message calls `record_lead_action(..., 'message')`. Build `POST /api/webhooks/twilio/[token]/status` (same rules, `external_event_id = MessageSid:MessageStatus`) updating sent/delivered/failed.

**Check:** a real phone joins the sandbox and messages it -> contact + lead + conversation appear live. Reply from the platform -> phone receives it. Replay the same webhook 5 times -> still one message. Forge a request with a wrong signature -> 400 and a row in `security_events`, nothing else. Message a phone that did not join -> failed with reason + Retry.

---

## Step 8: Payments, Stripe (I2)

**Prompt**
> Follow CLAUDE.md. Add a Stripe card in Integrations (secret key + webhook signing secret, encrypted; generate `webhook_token`; show the URL `{APP_URL}/api/webhooks/stripe/<token>`). On an opportunity page (permission `payments.create`): "Request payment" with amount and currency creates a Stripe Checkout Session through `src/providers/stripe.ts`, inserts a `payments` row (`pending`, `provider_ref` = session id, requested_by), sets opportunity `payment_status='pending'`, writes an `activities` row and an outbound `integration_events` row (temporary Stripe errors retry per CLAUDE.md, Providers), and lets the employee copy or send the link (via WhatsApp using step 7). Build `POST /api/webhooks/stripe/[token]`: raw body (`await req.text()`), verify with that workspace's signing secret, `ON CONFLICT DO NOTHING RETURNING` with the Stripe event id, then handle `checkout.session.completed` (paid, set `paid_at`, opportunity `payment_status='paid'`), `checkout.session.expired` (expired), `payment_intent.payment_failed` (failed), `charge.refunded` (set `refunded_amount`, `refunded_at`, status refunded). Every status change writes an `activities` row on the contact and opportunity. Compare amount and currency to the stored row before accepting. Payment status NEVER changes from the browser success page. Payment page shows opportunity, contact, employee who requested it and the provider reference. Never store or log card data.

**Check:** pay with test card `4242 4242 4242 4242` -> payment becomes paid on screen with no refresh. Refund in the Stripe dashboard -> reflected. Replay the event -> one payment, no double count.

---

## Step 9: Slack alerts and outbox (F3.9, I4)

(Telegram was replaced by Slack: Telegram is unreliable in Pakistan, and I4 allows Slack.)

**Prompt**
> Follow CLAUDE.md. Implement the `notify` handler in `worker/outbox.ts` `sendOutbox()` (keep the `kind` dispatcher). Alerts go out for the first assignment and for every escalation (the lead engine enqueues them). In a transaction select up to 10 `outbox` rows where `status='pending' AND next_attempt_at <= now()` with `FOR UPDATE SKIP LOCKED`; for `kind='notify'` look up the recipient (`payload.user_id`), decrypt the workspace's Slack bot token from `integration_connections` (provider `slack`), and send a DM through `src/providers/slack.ts` `chat.postMessage` to `users.slack_user_id` (resolve it from `users.slack_email` with `users.lookupByEmail` if missing). The message names the lead, source, reason and a link `{APP_URL}/leads/<id>`. Record each attempt as an outbound `integration_events` row; on success mark `sent`; a permanent error (invalid token, user not in the Slack workspace) marks `failed` at once; on a temporary failure attempts+1 and `next_attempt_at` = now + 2s/8s/30s/120s; after 5 failures mark `failed` with `last_error`. Add a Slack card in Integrations (bot token, verified with `auth.test`, stored encrypted, masked). Add Profile > "Slack email": the user enters the email of their Slack account; it is resolved with `users.lookupByEmail` and stored as `slack_user_id`. Show failed alerts to Admins. Support `NOTIFY_PROVIDER=resend` with `src/providers/resend.ts` and `users.notify_email` as the swap.

**Check:** escalate a lead -> the new owner's phone (Slack app) gets a DM within a minute with the lead's name, source, reason and a working link. Break the bot token -> escalation still happens, the failure shows to Admins.

---

## Step 10: Calendar, Google (I3)

**Prompt**
> Follow CLAUDE.md. Build Google OAuth: `GET /api/oauth/google/start` redirects to Google's consent screen for the Calendar scope with `access_type=offline`, `prompt=consent`, and a signed `state`; `GET /api/oauth/google/callback` verifies state, exchanges the code, and stores the encrypted tokens in `integration_connections` (provider google, `user_id` = the employee). A Disconnect button removes it. Access tokens refresh automatically in `src/providers/google.ts`; on 401 or `invalid_grant` set `status='needs_reconnect'`. Booking (permission `appointments.manage`) from an opportunity or contact: employee picker (an employee with no connected calendar cannot be booked, and the screen says why), time picker with timezone. Booking follows the Google booking flow in CLAUDE.md exactly: free/busy from Google (no transaction open), check local `appointments`, create the Google event, then insert the `appointments` row with its audit and `activities` rows in one transaction (`appt_no_overlap` is the final guard). If the insert fails, delete the Google event and show the reason. Never hold a transaction or advisory lock while calling Google. Every Google call writes an outbound `integration_events` row. Reschedule and cancel update the Google event and write an activity row. Booking calls `record_lead_action(..., 'appointment')`. Admins see each employee's calendar connection status.

**Check:** book -> event appears in the real Google Calendar and on the customer page. Double-book the same slot from two tabs -> the second is rejected. Revoke access in your Google account -> the platform shows "needs reconnect".

---

## Step 11: Integrations page (I5)

**Prompt**
> Follow CLAUDE.md. Finish Settings > Integrations: one card per provider with status (not connected / connected / error / needs reconnect), `last_ok_at`, recent errors, the "what it can and cannot do" text, and a list of recent `integration_events` (time, direction, status, reference, error) for the sync history. Failed outbox alerts are listed with a Retry button. Only users with `integrations.manage` can connect, change or remove; every change is audited. Secrets are masked. Retry for temporary provider errors uses backoff; permanent errors show a plain explanation.

**Check:** break Slack (bad token) -> leads, CRM and payments keep working (I5.8).

---

## Step 12: Dashboard (F5)

**Prompt**
> Follow CLAUDE.md. Build `src/lib/metrics.ts` with one function per figure (definitions are in the Dashboard definitions table in CLAUDE.md) and a `/dashboard` page using them. Users see personal figures (own leads, own response time); Owner and Admin see company-wide. Open pipeline value is hidden without `opportunity_value.view`. At least three tiles link to the filtered list they count (for example recovery queue, new leads today, escalations). Users can show/hide tiles (`user_preferences.hidden_tiles`) and the choice is remembered. Payments received uses collected revenue only, for the current month. Add a Projected revenue figure next to it (definition in CLAUDE.md), so collected and projected are clearly different numbers.

**Check:** click a tile -> the list count equals the tile number. Hide a tile, reload -> still hidden.

---

## Step 13: Security and polish pass

**Prompt**
> Follow CLAUDE.md. Review the whole codebase against CLAUDE.md. Check: every API route calls `getCtx` and `requirePermission`; no route imports `pg` or `db/client`; every query is workspace-scoped; CSV export at `/api/export/[entity]` (permission `crm.export`) uses the same `serialize()` as the list; all input is zod-validated; no `dangerouslySetInnerHTML`; CSRF Origin check active; security headers set in `next.config.js` (X-Frame-Options DENY, nosniff, Referrer-Policy, a CSP); every screen has loading/error/success states and works at 375px width with no horizontal scroll; keyboard focus visible; every input has a label; status is never shown by colour alone; text contrast meets WCAG AA (4.5:1); every outbound provider call writes `integration_events`; every F2.7 change writes `activities`. List every problem found, then fix them one by one.

**Check:** cross-workspace test: as workspace A, request every entity by a workspace B id (list, detail, update, delete, export) -> all 404. Open the app on a phone.

---

## Step 14: Six automated tests (`vitest`)

**Prompt**
> Follow CLAUDE.md. Write six vitest tests against a test database (apply `sql/001_schema.sql` and `sql/002_lead_engine.sql` to it first). IMPORTANT: `deadline_at` cannot be updated (a trigger forbids it), so create overdue assignments by INSERTing the row with a `deadline_at` in the past, or disable `lead_assignments_guard_t` inside the test setup only. (1) no-double-escalation: one overdue unacknowledged assignment, run `sweep_one` for it from two concurrent connections, assert exactly one new assignment row and one `escalated` outcome. (2) acknowledged-no-churn: acknowledge a lead with `record_lead_action(...,'human','note')`, then run `sweep_one` on its id and the orphan loop (`orphan_lead_ids` + `assign_new_lead(id,'lead.recovered')`) ten times; assert the assignee is unchanged and no new assignment rows exist. (3) restart-resilience: assignment with a deadline 1 second away, wait 3 seconds with no worker running, then call `due_assignment_ids` and `sweep_one`; assert it escalated. (4) workload-limit: `max_open_leads=1`, call `assign_new_lead` for two leads at the same instant; assert two different assignees and nobody over the limit. (5) tenant-isolation: as a user of workspace A, request every entity type with workspace B ids (list, detail, update, delete, export); assert all 404. (6) duplicate-webhooks: replay the same Twilio and Stripe payloads five times each; assert one message, one payment, one lead.

**Check it works:** `npm test` is green.

---

## Step 15: Seed data and demo

**Prompt**
> Follow CLAUDE.md. Write `scripts/seed.ts` creating two workspaces. Workspace "Demo Realty": Owner, Admin, Manager (role), and three Users, with passwords listed in the README; a pipeline with stages; 30 contacts with companies and a few custom fields; 15 opportunities; a few leads in different states (acknowledged, overdue, escalated twice); a Manager role set as `manager_role_id`; a backup user in `assignment_rules`; 20s window. Copy the `.env` provider keys into this workspace's encrypted connections. Workspace "Other Co" with a little data, to prove isolation. Write a `README.md` with setup steps, demo logins, and the deployed URL.

**Demo rehearsal checklist (do it three times):**
1. Judge joins the WhatsApp sandbox and messages the number: live lead, live conversation, assigned owner.
2. Nobody acknowledges: lead walks the chain, a Slack DM buzzes the presenter's phone.
3. Kill the worker mid-countdown, restart: escalation still fires.
4. Forged webhook: 400 and a `security_events` row.
5. Same record, two roles, list vs detail vs CSV: value masked everywhere.
6. Test payment: dashboard updates without refresh.
7. Book an appointment, then try to double-book.
8. Open the audit log, then try `DELETE` in a SQL console.
9. Break Slack: everything else keeps working.
10. Open the app on a phone.

---

## Cut list (only if time runs out, in this order)

1. Extra dashboard tiles beyond the required ones.
2. Retry backoff fine tuning (keep the failed state and a manual Retry button).
3. Resend email fallback.

**Do not cut:** F2.3 (per-pipeline fields), F2.6 (saved lists), F5.5 (show/hide tiles). They are cheap marks. And never cut the lead engine, webhook signatures, workspace isolation, audit log, field masking.
