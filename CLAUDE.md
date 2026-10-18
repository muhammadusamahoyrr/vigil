# CLAUDE.md: rules for the AI writing code in this repo

`sql/001_schema.sql` and `sql/002_lead_engine.sql` are the **only** source of truth for the database. Read them before writing code. Never invent a table, column, function or permission key. If one is missing, stop and say so.

## Stack (fixed)
Next.js 15 App Router · TypeScript non-strict · PostgreSQL via `pg` (**no ORM**) · Tailwind + shadcn/ui · `zod` · `@node-rs/argon2`

## Layers
```
src/app/**        pages + thin API routes (parse, call a service, return JSON)
src/services/**   business logic (call SQL functions, run transactions)
src/db/**         pool + scoped(); request queries go through scoped()
src/providers/**  the ONLY place twilio/stripe/googleapis are imported
src/lib/**        session, auth, permissions, rbac, audit, crypto, csrf, ratelimit, metrics
worker/**         separate process: sweeper, orphan guard, outbox
```
Route files never import `pg` or `src/db/client`. They call `services/*`.

## Ctx: who is acting (one type, two ways to get it)
```ts
type Ctx = {
  workspaceId: string
  userId: string | null        // null = system
  level: 'owner' | 'admin' | 'user'
  permissions: string[]        // system: ['*']
  isSystem: boolean
}
getCtx(req): Promise<Ctx>                 // from the session cookie; throws 401
systemCtx(workspaceId: string): Ctx       // { userId: null, level: 'owner', permissions: ['*'], isSystem: true }
```
- Both live in `src/lib/session.ts` and nowhere else.
- **Requests** use `getCtx`. **Worker and webhook handlers** use `systemCtx(workspaceId)`.
- `systemCtx` is allowed only after the workspace was resolved from the **database** (a verified URL token, or a row the worker just read). Never build it from user input, a payload, or a query string.
- `requirePermission` passes for `isSystem`. `audit()` writes `actor_id = NULL` when `ctx.isSystem`. Do not invent a "system user" row.
- `scoped(ctx)` is for request and service code: it adds `workspace_id = ctx.workspaceId` to every query.
- The worker may call `pool.query` directly **only** to run the SQL functions in `002_lead_engine.sql` with ids it just read from the database. Nothing else in the worker touches tables directly.
- `scoped()` convention: `$1` is always `ctx.workspaceId` (added automatically); your params start at `$2`. SQL must contain `workspace_id = $1`, or be `INSERT INTO t (workspace_id, ...) VALUES ($1, ...)`.
- **Pre-context lookups (the only exception):** `src/db/auth.ts` may query before a `Ctx` exists, for exactly (1) inserting the workspace in the signup transaction, (2) finding a login identity by globally unique email, (3) resolving a session by sha256 token hash, (4) deleting that session, (5) resolving a workspace by its `public_form_token` for `/f/[token]` (then `systemCtx`). Right after, everything uses scoped helpers bound to the workspace id PostgreSQL returned. Never add other queries there.

## Permissions (use exactly these keys, never invent new ones)
```
crm.view  crm.create  crm.edit  crm.delete  crm.export
opportunity_value.view          conversations.view     conversations.send
leads.reassign                  payments.create        appointments.manage
assignment_rules.manage         config.manage          integrations.manage
audit.view                      users.manage
```
- `config.manage` = pipelines, stages and custom fields. `opportunity_value.view` = see opportunity value (lists, detail, export).
- Levels: `owner` > `admin` > `user`. Owner and Admin have every permission. An Admin cannot modify the Owner. A `user` has only what their **roles** grant. "Manager" is a role (a named set of permissions), never a fourth level.

## Security (never break)
1. `workspace_id` comes from `Ctx`. Never from body, params or query.
2. In webhooks it comes from the **URL token** → `integration_connections`. Never from the payload.
3. Every route: `getCtx` → `requirePermission(ctx, key)` → zod validate → call a service. Hiding a button is not security.
4. Another workspace's record returns **404**, not 403.
5. Anything containing contacts, opportunities or leads goes through `lib/rbac.ts` `serialize()`: **list, detail AND CSV export**. `opportunities.value` is masked without `opportunity_value.view`.
6. argon2id for passwords. Session = random token in an httpOnly, Secure, SameSite=Lax cookie; store only its sha256.
7. State-changing routes (not webhooks) check `Origin` equals `APP_URL`.
8. 5 failed logins lock the account 15 minutes. Public form `/f/[token]`: 5 submissions per minute per IP plus a honeypot field.
9. Provider credentials: AES-256-GCM via `lib/crypto.ts`, fresh 12-byte nonce, stored as `nonce || tag || ciphertext`. Never plain text, never logged, never sent to the browser, never shown in full.
10. Card numbers are never stored or logged. Payment happens on Stripe's hosted page.
11. Set security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a CSP. No `dangerouslySetInnerHTML`.

## Data
- IDs are UUIDs generated by the database. No auto-increment.
- Every state change writes an `audit_logs` row **in the same transaction** (`lib/audit.ts`).
- Edits use optimistic locking: `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2`. 0 rows → 409.
- FK error `23503` → catch it and return a friendly message ("move these deals first").
- Users are deactivated (`deactivated_at`) and their sessions deleted. Never delete a user.
- Deleting a contact that still has leads, conversations, payments or appointments is refused with a message naming what blocks it. Never cascade-delete customer history.
- Deleting a custom field removes its key from `custom_data` on every record in the same transaction, with an audit row holding the field definition as `before`.
- Every item F2.7 lists (note, stage change, assignment, field edit, message, payment, appointment) writes an `activities` row in the same transaction as the change.
- Never use `setTimeout`/`setInterval` to decide a business outcome. Deadlines live in `deadline_at`; the worker polls. (A short delay between provider retries is not a business outcome and is allowed.)

## Lead engine: call the functions, never reimplement
- A lead is owned while its assignment has `closed_at IS NULL`. That is the only ownership test anywhere.
- Acknowledge sets `acknowledged_at` only. It never closes an assignment. Never write `outcome = 'acknowledged'`.
- Create a lead: insert the lead, then `SELECT assign_new_lead($1)` in the **same transaction**.
- Every new owner is notified (F3.4 and F3.9): the first assignment **and** every escalation produce an outbox `notify` row for the new owner. Check what `002_lead_engine.sql` already enqueues; never enqueue twice. If it only enqueues on escalation, `createLead` inserts the first-assignment `notify` row in its own transaction, using the same payload shape the SQL uses.
- After any action on a lead (button, note, message, call log, stage change, appointment): `SELECT record_lead_action($lead, $user, 'human', $reason)`. Valid reasons: `button note message call_log stage_change appointment`. System actions pass `'system'` and never acknowledge or reset the idle clock.
- Availability changes only through `SELECT change_availability($user, $status, $actor)`.
- Manual reassign only through `SELECT reassign_manually($lead, $to, $actor)`.
- The recovery page reads the `recovery_queue` view. Never recompute its reasons in TypeScript.
- Escalation levels come from `assignment_rules.escalation_levels`. Never hardcode level counts or timings.
- `deadline_at` and the other identity columns of `lead_assignments` cannot be updated (a trigger forbids it).

### Availability policy (show this exact text in the UI next to the availability control)
> When you are set to On leave or Offline, your unacknowledged leads move to the next eligible person immediately. Leads you already acknowledged stay with you and appear in the Recovery queue as "owner unavailable" so a manager can reassign them.

### Worker: three loops, each call its own transaction
```ts
// 1. sweeper, every 2s
const { rows } = await pool.query('SELECT * FROM due_assignment_ids(25) AS id')
for (const r of rows) await pool.query('SELECT sweep_one($1)', [r.id])

// 2. orphan guard, every 10s
const o = await pool.query('SELECT * FROM orphan_lead_ids() AS id')
for (const r of o.rows) await pool.query("SELECT assign_new_lead($1, 'lead.recovered')", [r.id])

// 3. outbox sender, every 2s   (see Outbox)
// (no link poller: Slack routing resolves users.slack_email -> slack_user_id with users.lookupByEmail)
```
**Never wrap these calls in a shared `BEGIN ... COMMIT`.** Each call must be its own transaction so it takes and releases exactly one workspace advisory lock. Batching holds several locks at once (deadlocks) and lets one bad lead roll back the whole batch. Wrap each loop body in try/catch and log, so one error never stops the loop.

## Webhooks (Twilio and Stripe, identical)
1. Read the **raw body** first (`await req.text()`). Stripe cannot verify without it.
2. Find the connection by the URL token. Unknown token → 404 + a `security_events` row.
3. Verify the signature with **that workspace's** secret. Twilio signs `APP_URL + path`, not `req.url`.
   Failure → `security_events` only (with the workspace id if the token matched), return 400. Do not parse. Do not touch any tenant table. Never store the payload.
4. One transaction: `INSERT INTO integration_events ... ON CONFLICT (workspace_id, provider, external_event_id) DO NOTHING RETURNING id`.
   **No row returned = duplicate = commit and return 200 with no side effects.** A raw unique violation would abort the transaction.
5. Apply the change using `systemCtx(workspaceId)`, write audit, mark the event `processed`, commit, 200.
6. Twilio status callbacks use `external_event_id = MessageSid || ':' || MessageStatus`.
7. Payment status changes only from a verified Stripe webhook, never from the browser success page. Match amount and currency to the stored row.

## Outbox
The sender picks rows `FOR UPDATE SKIP LOCKED`, sends, marks `sent`. On error: `attempts + 1`, backoff 2s / 8s / 30s / 120s, then `failed` after 5, visible to Admins. Delivery is **at-least-once**: never claim exactly-once in UI text or the README. Provider calls never happen inside a lead-engine transaction; they go through the outbox.
- `worker/outbox.ts` dispatches by `kind`: `notify` (Slack DM alert, or email when NOTIFY_PROVIDER=resend) and outbound customer messages (Twilio). Use the kind values `001_schema.sql` allows; if it has no kind for messages, stop and say so.
- A **permanent** error (bad credentials, recipient not joined to the sandbox, opted out, invalid number) marks the row `failed` at once with a plain reason. Only **temporary** errors (network, timeout, 429, 5xx) back off and retry.

## Providers and integration events
- Each `src/providers/*` module classifies every error as `temporary` or `permanent` and returns a plain-language message the UI can show (I5.5).
- Synchronous provider calls made during a request (Stripe Checkout creation, Google free/busy and events, token refresh) retry temporary errors up to 3 times at 0.5s / 1s / 2s, then show the error with a Retry button.
- **Every outbound provider call** writes an `integration_events` row (direction out, status, provider reference, error), not only inbound webhooks (I5.4). On success also update the connection's `last_ok_at`.
- One provider failing never blocks another or the core app (I5.8). Wrap provider calls; never let their errors escape into lead-engine code.

## Google booking (no DB lock around external calls)
1. Read busy times from Google free/busy (no transaction open).
2. Check local `appointments` for an overlap; reject with a clear message.
3. Create the Google event.
4. Insert the `appointments` row (`starts_at_utc`, `ends_at_utc`, IANA `timezone`) in one transaction with its audit and activity rows. The `appt_no_overlap` constraint is the final guard against double-booking.
5. If the insert fails for any reason (overlap or otherwise), delete the Google event (compensating action) and show the reason.
Never hold a transaction or advisory lock open while calling Google.

## Dashboard definitions (one meaning everywhere; all numbers come from `lib/metrics.ts`)
| Figure | Definition |
|---|---|
| New leads today | leads created since local midnight |
| Open pipeline value | sum of `value` of opportunities not in a won/lost stage, grouped by stage; only with `opportunity_value.view` |
| Avg time to first response | average of `lead_first_response.time_to_first_response` |
| Recovery queue items | rows in `recovery_queue` |
| Escalations (24h) | assignments with `outcome='escalated'` closed in the last 24h (manual reassigns counted separately) |
| Employee availability | users per status |
| Upcoming appointments | confirmed appointments starting in the future |
| Payments received this month | collected revenue only: `SUM(amount - refunded_amount)` where status in (`paid`,`refunded`) and `paid_at` since the start of the current month (workspace timezone) |
| Projected revenue | value of opportunities not in a won/lost stage **plus** payment requests not yet paid (`pending`); shown next to collected revenue, never added to it; only with `opportunity_value.view` |

Users see personal figures (own leads, own response time). Owner and Admin see company-wide. Each tile drills into the matching filtered list.

## UI
- Every action shows loading, success and error states. Errors say what went wrong and what to do.
- Every screen works on a phone: no horizontal scroll, no hidden controls. Keyboard-reachable buttons, labelled inputs, colour is never the only signal, text contrast at least WCAG AA (4.5:1).
- Lists paginate at 50 with server-side search and filter.
- SSE responses set `Cache-Control: no-cache` and `X-Accel-Buffering: no`. On reconnect the client refetches.
- Integration pages state their limits (for example: the WhatsApp sandbox only reaches phones that sent the join phrase; Google is in testing mode).

## Tests
- Use `vitest` against a test database. Set up overdue assignments by **inserting** the row with a past `deadline_at`, or by disabling `lead_assignments_guard_t` inside the test setup only. Never `UPDATE deadline_at` in a test without that.
- The six required tests are listed in `docs/CHEATSHEET.md`.

## How to work
- One small vertical slice at a time: database → service → route → UI. List the files you changed.
- Do not refactor files you were not asked to touch.
- If a rule here conflicts with the request, stop and say so.
- Stuck on one tool problem for 30 minutes? Stop and use the fallback.
