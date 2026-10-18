# TRACEABILITY: every requirement → where it is built → how it is proven

**Status: draft.** `TBD` in the DB rule column means the rule depends on `sql/001_schema.sql` or `sql/002_lead_engine.sql`, which are not in the repo yet. Fill those cells from the SQL; never write a rule the SQL does not contain. Names marked *(verify)* are mentioned in our docs but must be confirmed against the SQL.

Fill the **Code** column with real file paths as each step lands, and tick **Status** when its check passes on the deployed app.

**Legend**
- **Step**: section of `docs/02_BUILD_GUIDE.md`.
- **Test**: T1–T6 are the automated `vitest` tests (Step 14). *Manual* means the step's "Check it works".
- **Demo**: R1–R10 are the demo rehearsal checklist items (Step 15).

---

## F1. Accounts, roles and permissions

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| F1.1 | Sign up, log in, log out, persistent sessions | 2 | `/api/auth/{signup,login,logout,me}`, `src/services/auth.ts`, `src/lib/session.ts`, `/signup`, `/login`, `/dashboard` | `sessions.token_hash bytea UNIQUE` (sha256 only), 7-day `expires_at` | `tests/auth.test.ts` (signup bootstrap, refresh via /me, logout, expired/invalid 401); manual curl flow | — | ☑ |
| F1.2 | Owner / Admin / User levels | 2 (bootstrap), 3 | Signup makes the first user Owner (`src/services/auth.ts`); Settings > Team and `src/lib/rbac.ts` in Step 3 | `one_owner_per_workspace`, `users.level` check | `tests/auth.test.ts` (Owner created, Owner gets all keys); Step 3: Admin cannot modify Owner | — | ☐ (bootstrap done, Step 3 pending) |
| F1.3 | Configurable permissions | 3 | Settings > Roles, `src/lib/permissions.ts` | TBD | Manual: toggle permission → effect immediate | — | ☐ |
| F1.4 | Opportunity value masked (list, detail, export) | 3, 4a, 13 | `serialize()` in `src/lib/rbac.ts`, `/api/export/[entity]` | — (enforced in app) | Manual: two roles compared | R5 | ☐ |
| F1.5 | Server-side enforcement | 3, 13 | `requirePermission` on every route | — | Manual: `curl` without permission → 403 | — | ☐ |
| F1.6 | Workspace isolation | 1, 13 | `scoped(ctx)`, 404 on foreign ids | TBD (workspace-qualified keys) | **T5** | Demo moment 4 | ☐ |

## F2. Customizable CRM

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| F2.1 | Contacts, companies, opportunities + relations | 4a | contacts/companies/opportunities services + pages | TBD (FKs) | Manual | — | ☐ |
| F2.2 | Custom fields from the UI | 4c | Settings > Fields, zod schema from `field_definitions` | TBD | Manual: new dropdown appears without deploy | — | ☐ |
| F2.3 | Different fields per pipeline | 4c | `field_definitions.pipeline_id` | TBD | Manual: two pipelines, two field sets | — | ☐ |
| F2.4 | Stage required fields | 4b | stage move service | TBD (`stages.required_fields`) | Manual: blocked with message | — | ☐ |
| F2.5 | Customizable pipeline, safe stage delete | 4b | Settings > Pipelines, board + list | Deferrable position constraint *(verify)*; FK 23503 → move dialog | Manual | — | ☐ |
| F2.6 | Filters (3+ criteria) and live saved lists | 4d | filter service, `saved_views` | TBD | Manual: save list, add matching record | — | ☐ |
| F2.7 | Activity history | 4a–4d, 5a, 7, 8, 10 | `activities` rows on every listed change | TBD | Manual | R3 | ☐ |
| F2.8 | Complete customer view | 4d | contact page | — | Manual | R1 | ☐ |

## F3. Lead capture, assignment, acknowledgement, escalation

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| F3.1 | Leads from web form, message, manual | 5a, 7a | `createLead`, `/f/[token]`, Twilio webhook | `assign_new_lead` in same transaction | Manual: three source labels | R1 | ☐ |
| F3.2 | Employee availability | 5b | header dropdown, Settings > Team | `change_availability` *(verify)* | Manual | — | ☐ |
| F3.3 | Round robin + max open leads | 5b | Settings > Assignment rules | TBD (`assignment_rules`) | **T4** | — | ☐ |
| F3.4 | Ack window, notification, visible countdown | 5a, 9 | lead detail countdown, outbox `notify` | `deadline_at` immutable via `lead_assignments_guard_t` *(verify)* | Manual | R2 | ☐ |
| F3.5 | Configurable escalation chain | 5b, 5c | worker sweeper loop | `due_assignment_ids` + `sweep_one`, `assignment_rules.escalation_levels` *(verify)* | **T3** | R2, R3 | ☐ |
| F3.6 | Reassign on absence; acknowledged-lead policy shown | 5b | availability control + policy text | `change_availability` *(verify)* | Manual | — | ☐ |
| F3.7 | Recovery queue with reasons | 5d | `/recovery` | `recovery_queue` view *(verify)* | Manual: three reasons shown | Demo moment 3 | ☐ |
| F3.8 | One owner at a time, no double escalation | 5c | worker: one transaction per call | TBD (one-open-assignment rule, advisory lock in `sweep_one`) | **T1**, **T2** | R3 | ☐ |
| F3.9 | External alert on escalation | 9, chat | In-app: `/notifications`, header count; optional Slack DM via `worker/outbox.ts` | `lead_assignments_notifications_t` (new owner + `lead.missed`), `outbox_notify_once` | `tests/webchat.test.ts` W10, W11; Slack-missing test in `tests/leads.test.ts` | step 5 | ☑ (in-app; Slack optional) |

## F4. Audit history

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| F4.1 | Important actions recorded with before/after | all | `src/lib/audit.ts`, same transaction | TBD | Manual | R8 | ☐ |
| F4.2 | Only `audit.view`, filterable | 3 | Settings > Audit | — | Manual | — | ☐ |
| F4.3 | Tamper resistance | 1, 3 | no edit/delete endpoints | `audit_logs` immutable ("audit_logs is immutable") *(verify)* | Manual: `DELETE FROM audit_logs` fails | R8 | ☐ |

## F5. Operational dashboard

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| F5.1 | Required figures | 12 | `src/lib/metrics.ts`, `/dashboard` | `lead_first_response` view *(verify)* | Manual | R6 | ☐ |
| F5.2 | Consistent definitions | 12 | CLAUDE.md dashboard table, one function per figure | — | Manual: tile count = list count | — | ☐ |
| F5.3 | Drill-down (3+ tiles) | 12 | tile links to filtered lists | — | Manual | — | ☐ |
| F5.4 | Role-aware figures | 12 | personal vs company-wide | — | Manual | — | ☐ |
| F5.5 | Show/hide tiles remembered | 12 | `user_preferences.hidden_tiles` | TBD | Manual: hide, reload | — | ☐ |

## I1. Messaging: first-party Vigil Web Chat (alternative to Twilio WhatsApp)

Twilio WhatsApp → **Vigil Web Chat** `/chat/<slug>`, allowed under the organizers' alternative-technology announcement (Twilio/Meta cannot be configured from Pakistan). No WhatsApp integration is claimed. Test file: `tests/webchat.test.ts` (W1–W13).

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| I1.1 | Receive messages | chat | `/chat/[slug]` page, `POST /chat/[slug]/messages`, `src/services/webchat.ts` | `003_web_chat.sql`: channel `web`, lead source `chat` | W1 | Two-browser step 2–3 | ☑ |
| I1.2 | Request authenticity | chat | random 32-byte token in HttpOnly cookie, sha256 lookup; workspace only from slug; Origin check; rate limit | `conversations.customer_token_hash UNIQUE`, `conversations_web_token` | W5/6 (forged/other-workspace token) | — | ☑ (alternative to signatures) |
| I1.3 | Send messages | chat | Inbox reply `POST /api/inbox/[id]/reply` | outbound `messages` row | W9 | step 4 | ☑ |
| I1.4 | Delivery status | chat | first-party: stored = delivered; "customer last viewed" from `customer_read_at` | `conversations.customer_read_at` | W9 | step 4 | ☑ (no provider states) |
| I1.5 | Contact matching / new contact + lead | chat | match by phone or email in the workspace | `contacts_phone_unique`, contact row lock | W1, W3 | step 2 | ☑ |
| I1.6 | Conversation ownership and visibility | chat | `/inbox`: own leads only; Owner/Admin/leads.reassign all; else 404 | — | W7 | step 3 | ☑ |
| I1.7 | Failure visible, retry | chat | customer: error + same idempotency key on resend; agent: error message | — | W13 | — | ☑ |
| I1.8 | No duplicates | chat | browser idempotency key + advisory lock | `messages_client_key_unique` | W2, W3 | — | ☑ |
| I1.9 | Opt-out blocks sending | 7 | applies to provider channels; web chat replies go only to the customer's own session | `contacts.opted_out` | — | — | ☐ (provider channel) |

## I2. Payments (Stripe test mode)

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| I2.1 | Create payment request | 8 | "Request payment" on opportunity | TBD | Manual | R6 | ☐ |
| I2.2 | Webhook confirms, live update | 8, 6 | `/api/webhooks/stripe/[token]`, SSE | — | Manual: test card, no refresh | R6 | ☐ |
| I2.3 | Signature verified before any change | 8 | raw body verify | — | Manual | — | ☐ |
| I2.4 | Idempotent | 8 | `ON CONFLICT DO NOTHING RETURNING` | TBD | **T6** | — | ☐ |
| I2.5 | Expired / failed / refunded | 8 | event handlers | TBD | Manual: refund in dashboard | — | ☐ |
| I2.6 | Collected vs projected | 12 | Payments received + Projected revenue tiles | — | Manual | Demo moment 5 | ☐ |
| I2.7 | Traceability of each payment | 8 | payment page | TBD | Manual | — | ☐ |
| I2.8 | No card data | 8 | hosted Checkout only | — | Code review (Step 13) | — | ☐ |

## I3. Calendar (Google OAuth)

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| I3.1 | Connect with consent, disconnect | 10 | `/api/oauth/google/*` | TBD | Manual | — | ☐ |
| I3.2 | Token refresh, server-only, needs reconnect | 10 | `src/providers/google.ts` | TBD | Manual: revoke access | — | ☐ |
| I3.3 | Create appointments | 10 | booking flow (CLAUDE.md, Google booking) | TBD | Manual | R7 | ☐ |
| I3.4 | Avoid conflicts | 10 | free/busy + local check | `appt_no_overlap` *(verify)* | Manual: two tabs, same slot | R7 | ☐ |
| I3.5 | Time zones | 10 | UTC storage + IANA timezone | TBD | Manual | — | ☐ |
| I3.6 | Reschedule / cancel | 10 | updates Google event + activity | — | Manual | — | ☐ |
| I3.7 | Connection status; unconnected cannot be booked | 10 | Admin view, employee picker | — | Manual | — | ☐ |

## I4. Notifications (Slack)

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| I4.1 | Delivery within the minute | 9 | outbox loop every 2s | — | Manual | R2 | ☐ |
| I4.2 | Lead name, source, reason, link | 9 | message template | — | Manual | R2 | ☐ |
| I4.3 | Per-user routing | 9 | Profile > Slack email, `users.lookupByEmail` | `users.slack_email`, `users.slack_user_id` | Manual | — | ☐ |
| I4.4 | Failure recorded, retried, visible to Admins | 9, 11 | outbox backoff, Integrations page | TBD (`outbox.attempts`, `last_error`) | Manual: bad bot token | R9 | ☐ |

## I5. Shared integration requirements

| ID | Requirement | Step | Code / API / UI | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| I5.1 | Central integrations page | 11 | Settings > Integrations | TBD (`integration_connections.status`, `last_ok_at`) | Manual | — | ☐ |
| I5.2 | Per-workspace credentials | 7–10 | webhook URL token → connection | TBD | **T5** | — | ☐ |
| I5.3 | Secret handling | 7–11 | `src/lib/crypto.ts`, masked UI | — | Code review (Step 13) | — | ☐ |
| I5.4 | Sync history (inbound and outbound) | 7–11 | `integration_events` for every call | TBD | Manual | — | ☐ |
| I5.5 | Retry temporary, explain permanent | 7–11 | provider error classification, outbox backoff | — | Manual | — | ☐ |
| I5.6 | Stated limits | 7, 11 | limit text on each card | — | Manual | — | ☐ |
| I5.7 | Permission + audit | 7–11 | `integrations.manage`, audit rows | — | Manual | — | ☐ |
| I5.8 | Failure isolation | 9, 11 | provider calls wrapped, via outbox | — | Manual: bad Slack token | R9 | ☐ |

## Q. Quality requirements

| ID | Area | Step | How | DB rule | Test | Demo | Status |
|---|---|---|---|---|---|---|---|
| Q1 | Authentication security | 2 | argon2id (`@node-rs/argon2`), 7-day sessions, logout deletes session, 5th failure locks 15 min (row lock), generic 401, dummy verify for unknown email | `users.failed_logins`, `locked_until`, `security_events` kind `login_locked` | `tests/auth.test.ts` (lockout sequence, lock expiry, fresh session per login); manual curl: 401×4 then 423 | — | ☑ |
| Q2 | Authorization | 2 (session), 3, 13 | `getCtx` resolves workspace from the hashed session only, permissions re-read per request; `requirePermission` in Step 3; 404 cross-tenant | `scoped()` guard (`workspace_id = $1`), composite FKs | `tests/auth.test.ts` (role union, change without new cookie, deactivated 401); **T5** later | Demo moment 4 | ☐ (session part done) |
| Q3 | Input safety | 2, 13 | zod on auth routes, parameterised SQL, CSRF Origin check in `route()` (`src/lib/csrf.ts`, webhooks exempt), no `dangerouslySetInnerHTML`; CSP in Step 13 | — | `tests/auth.test.ts` (missing/wrong/look-alike Origin → 403, exact APP_URL accepted, field errors 400) | — | ☐ (auth part done) |
| Q4 | Data integrity | 4a–4c | optimistic locking (409), FK 23503 handling, safe deletes | TBD (`version` columns, FKs) | Manual | — | ☐ |
| Q5 | Concurrency and timing | 5c, 7, 8 | DB deadlines, one transaction per worker call, idempotent webhooks | TBD | **T1, T2, T3, T4, T6** | R3 | ☐ |
| Q6 | Persistence | all | PostgreSQL, per-workspace config | — | **T3** | R3 | ☐ |
| Q7 | Responsive | 13 | 375px, no horizontal scroll | — | Manual: phone | R10 | ☐ |
| Q8 | Accessibility | 13 | keyboard, labels, not colour alone, AA contrast | — | Manual | — | ☐ |
| Q9 | Performance | 4a, 4d | pagination 50, server-side search/filter | TBD (indexes) | Manual | — | ☐ |
| Q10 | Feedback and errors | all | loading / success / error states | — | Manual | — | ☐ |
| Q11 | Real-time | 6 | SSE `/api/stream`, `LISTEN workspace_events` | `vigil_notify_workspace()` + `*_notify_t` triggers on leads, lead_assignments, opportunities (incl. delete), messages, payments, appointments, users.availability, outbox failures, integration_connections; IDs-only payload, delivered on commit only | Manual: two browsers | R1, R6 | ☐ |
| Q12 | Consistent data | 12 | all figures from `src/lib/metrics.ts` | — | Manual | — | ☐ |
| Q13 | Config and secrets | 0, 15 | env vars, encrypted DB credentials, README, seed | — | Manual: fresh setup from README | — | ☐ |
| Q14 | Maintainable structure | all | layers in CLAUDE.md (app / services / db / providers / lib) | — | Code review (Step 13) | — | ☐ |
