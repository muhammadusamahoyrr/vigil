# CHEATSHEET: ye ek page khula rakho

*(Ye aap ke liye reference hai. AI ko paste mat karo. AI ke liye sirf `CLAUDE.md` hai.)*

## Kaunsi file kab

| File | Kis liye | AI ko dena hai? |
|---|---|---|
| `CLAUDE.md` (repo root) | rules, permission keys, Ctx, dashboard definitions, worker loops | haan, har turn automatically |
| `sql/001_schema.sql` | saare tables | repo mein rakho, AI padhta hai |
| `sql/002_lead_engine.sql` | lead engine functions | repo mein rakho, AI padhta hai |
| `docs/02_BUILD_GUIDE.md` | step-by-step prompts | **ek step at a time**, poori file kabhi nahi |
| `docs/01_ARCHITECTURE.md` | insaano ke liye reference (**abhi likhi nahi gayi**) | nahi (zaroori cheezein CLAUDE.md mein hain) |
| `docs/03_TRACEABILITY.md` | judges ke liye: har requirement → code → test → demo | nahi. Draft ready hai; `TBD` wale DB rules SQL aane ke baad bharo, baqi build ke saath update karo |
| ye file | aap ke liye | nahi |

**Rule:** `CLAUDE.md` apne aap jata hai. Aap sirf **ek build step ka prompt** paste karte ho. Poori architecture paste karne se AI confuse hota hai.

---

## WhatsApp ki jagah Vigil Web Chat

| Problem statement | Vigil mein | Kyun |
|---|---|---|
| Twilio WhatsApp customer messaging (I1) | **First-party Vigil Web Chat** `/chat/<workspace-slug>` | Twilio aur Meta Pakistan se configure nahi hote; organizers ne alternative technology allow ki hai |
| Telegram/Slack escalation alert (I4) | **In-app notifications** (Slack optional, token ho to DM bhi) | Core demo kisi third-party account ke baghair chale |

Judges ko saaf batao: WhatsApp integration **nahi** hai; web chat uska first-party alternative hai. Signature/idempotency jaisa kaam yahan idempotency key + hashed cookie token se hota hai.

**Limitations:** customer ko browser tab khula rakhna parta hai (push notification nahi), chat sirf usi browser mein dobara khulti hai jis ke paas cookie hai, aur ek IP se 20 messages/minute ki limit hai.

### Local demo (koi account ya token nahi chahiye)
```bash
docker start vigil-sqltest            # ya koi bhi local Postgres 15+
npm run migrate
DEMO_MODE=true npm run seed           # 60s windows, demo logins print hote hain
npm run build && npm run start        # http://localhost:3000
npm run worker                        # doosre terminal mein: escalation + recovery
```
- Agent: http://localhost:3000/login → `ali@lahoresolar.demo` / `VigilDemo2026!`
- Customer (incognito): http://localhost:3000/chat/lahore-solar-solutions

### Do browser ka test (5 minute)
1. Normal browser: Owner `ayesha@lahoresolar.demo` login, **Inbox** kholo. Doosre tab mein Sara aur Ali (incognito ya doosra browser profile).
2. Incognito: `/chat/lahore-solar-solutions` → naam, phone, message → Send.
3. Agent screen bina refresh: Inbox mein naya chat, **Notifications (1)**, countdown chal raha.
4. Owner (jis ko lead mili) Acknowledge dabaye, phir reply likhe → customer ki screen par foran reply.
5. Doosra customer chat shuru karo aur ignore karo → countdown khatam → worker escalate karta hai → naye owner ko "Lead escalated to you", purane ko "Missed" notification.
6. `/recovery` aur lead ka **Ownership chain**, phir `/audit`.
7. Worker band karo, deadline guzarne do, worker chalao → escalation phir bhi hoti hai.

### Railway par
Variables (web aur worker dono): `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=production`, `DEMO_MODE=true` (sirf demo ke liye). `SLACK_BOT_TOKEN` optional. Migrate deploy se pehle khud chalta hai; seed ek dafa: `DATABASE_URL=<public url> APP_URL=<domain> DEMO_MODE=true npm run seed`.

## Pitch (ek line)

> **Vigil is a lead-loss prevention system: every lead always has one accountable owner, every missed response automatically escalates, and the complete chain is provable.**

CRM, payments aur calendar supporting features hain. Asal cheez accountability engine hai.

## Pehle ye vertical slice poora karo

**Web chat message → lead → assignment → countdown → escalation → in-app notification (+ Slack if connected) → recovery queue → audit log.**

Ye real services ke saath, worker restart ke baad bhi, duplicate webhooks ke saath bhi chal jaye, phir baqi CRM. Person C (step 5) isi par pehle din se lage.

---

## Roz ka kaam (loop)

1. Build guide ka **ek** step kholo, prompt copy karo, AI ko do.
2. App chalao, step ka **"Check it works"** karo.
3. Chal gaya: `git commit`. Nahi chala: exact error AI ko paste karo, sirf wahi fix karwao.
4. 30 minute se zyada phanse? Ruko aur team lead ko batao.

---

## SQL functions: app sirf ye call karta hai

| Function | Kab |
|---|---|
| `assign_new_lead(lead_id)` | lead insert ke baad, **usi transaction mein** |
| `assign_new_lead(lead_id, 'lead.recovered')` | orphan guard loop |
| `record_lead_action(lead, user, 'human'\|'system', reason)` | kisi bhi action ke baad |
| `change_availability(user, status, actor)` | availability badalne par, aur kahin se nahi |
| `reassign_manually(lead, to_user, actor)` | manager reassign |
| `due_assignment_ids(n)` + `sweep_one(id)` | worker loop 1 (sweeper) |
| `orphan_lead_ids()` | worker loop 2 (orphan guard) |
| view `recovery_queue` | `/recovery` page |
| view `lead_first_response` | time-to-first-response metric |

`reason` sirf: `button` · `note` · `message` · `call_log` · `stage_change` · `appointment`

## Worker mein teen loops

| # | Loop | Har kitni der | Kya karta hai |
|---|---|---|---|
| 1 | sweeper | 2s | overdue unacknowledged leads escalate |
| 2 | orphan guard | 10s | bina owner wali leads ko owner dena |
| 3 | outbox | 2s | Slack DM alerts (optional; Slack na ho to row `failed` ho jati hai, in-app notification phir bhi milti hai), retry |

(Telegram Pakistan mein nahi chalta, is liye Slack. Link poller ki zaroorat nahi: user Profile mein apna Slack email daalta hai.)

Har call apni alag transaction. **Kabhi shared `BEGIN ... COMMIT` nahi.**

---

## Ownership model: poore project ki buniyad

| Column | Matlab |
|---|---|
| `closed_at IS NULL` | **banda abhi lead ka owner hai.** Ownership ka sirf yahi test hai. |
| `acknowledged_at` | owner ne jawab diya. Clock rukta hai. Ownership khatam nahi hoti. |
| `closed_at` + `outcome` | ownership khatam, aur kyun. Hamesha saath set hote hain. |

| Event | acknowledged_at | closed_at | outcome |
|---|---|---|---|
| Assign hua | null | null | null |
| Owner ne acknowledge kiya | now | **null** | **null** |
| Window khatam, escalate | null | now | `escalated` |
| Manager ne reassign kiya | unchanged | now | `reassigned` |
| Owner On leave / Offline (unacknowledged lead) | null | now | `owner_unavailable` |
| Lead won / lost / closed | unchanged | now | `completed` |

Kabhi `outcome = 'acknowledged'` mat likho. Wo acknowledged lead ko "bina owner" bana deta hai aur lead baar baar reassign hoti hai.

Escalation chain: next available (round robin, jis ke paas pehle ye lead nahi thi) → backup → manager. Levels aur seconds `assignment_rules.escalation_levels` se aate hain. Koi eligible na mile to **purana owner lead rakhta hai**, recovery queue mein dikhti hai, aur 60 second baad dobara koshish hoti hai.

---

## Ctx: kaun kaam kar raha hai

| Jagah | Kya use karein |
|---|---|
| Browser request | `getCtx(req)` (session cookie se, warna 401) |
| Worker | `systemCtx(workspaceId)` |
| Webhook (signature verify ke baad) | `systemCtx(workspaceId)` (workspace URL token se) |

`systemCtx` ka `userId` null hota hai, audit mein `actor_id = NULL`. Workspace id kabhi payload, body ya query se nahi aati.

---

## Permission keys (bilkul yahi)

```
crm.view  crm.create  crm.edit  crm.delete  crm.export
opportunity_value.view      conversations.view   conversations.send
leads.reassign              payments.create      appointments.manage
assignment_rules.manage     config.manage        integrations.manage
audit.view                  users.manage
```
Levels: `owner` > `admin` > `user`. Manager ek **role** hai, chautha level nahi.

---

## Jo cheezein sabse zyada tootengi

| Cheez | Galat | Sahi |
|---|---|---|
| Worker loop | `BEGIN` ... saare `sweep_one` ... `COMMIT` | har `sweep_one` apni query, apni transaction |
| Stripe webhook | parsed JSON se verify | `await req.text()` ka raw body |
| Webhook ka order | pehle verify, phir workspace | pehle URL token se workspace, phir us ke secret se verify |
| Twilio signature | `req.url` par | `APP_URL + path` par |
| Duplicate event | unique violation catch karke continue | `ON CONFLICT DO NOTHING RETURNING` |
| Rejected webhook | `integration_events` mein log | `security_events` mein, aur kuch nahi |
| CSV export | apna alag query | wahi `serialize()` jo list/detail use karti hai |
| Cross-workspace | 403 | **404** |
| Dashboard number | component mein calculate | `lib/metrics.ts` |
| Deadline | `setTimeout` | `deadline_at` + worker |
| Payment status | success page se badalna | sirf verified Stripe webhook se |
| Credentials | `.env` se hamesha | DB mein encrypted, per workspace (`.env` sirf demo seed) |
| Google booking | transaction/advisory lock khol kar Google call | pehle free/busy → Google event → phir insert (`appt_no_overlap` guard) → fail ho to Google event delete |
| Outbound provider call | sirf webhooks log karna | har outbound call bhi `integration_events` mein |
| Revenue tiles | collected aur projected mila dena | do alag numbers: collected (is mahine, webhook se) aur projected |
| Notification | sirf escalation par | pehli assignment par bhi |

---

## Chhoti baatein jo pata honi chahiyen

- `deadline_at` aur baqi identity columns update nahi ho sakte (trigger). Test mein overdue row **insert** karo purani deadline ke saath, ya sirf test setup mein `lead_assignments_guard_t` disable karo.
- `one_owner_per_workspace` index: Owner badalne se pehle purane Owner ko demote karna parega. UI mein handle karo.
- Orphan guard purane assignees ko exclude nahi karta, to recovered lead usi bande ko ja sakti hai jisse escalate hui thi. Recovery ke liye ye theek hai.
- `recovery_queue` live view hai, column nahi. Idle detection ke liye alag loop nahi chahiye.
- `appt_no_overlap` constraint double-booking database level par rokta hai, to I3.4 ko cut list mein mat daalo.
- Google app testing status mein hai: approval nahi chahiye, sirf test users add karo (sab team members).

---

## Chhe automated tests (`vitest`, step 14)

1. **no-double-escalation:** ek overdue assignment, do `sweep_one` ek saath → ek hi naya assignment
2. **acknowledged-no-churn:** acknowledge karo, phir `sweep_one`, orphan loop 10 baar chalao → assignee wahi, koi naya row nahi
3. **restart-resilience:** deadline guzarne do bina worker ke, phir chalao → escalation hoti hai
4. **workload-limit:** `max_open_leads = 1`, do assignments ek saath → do alag log
5. **tenant-isolation:** workspace A se B ke ids: list, detail, update, delete, export → sab 404
6. **duplicate-webhooks:** wahi Twilio aur Stripe payload paanch baar → ek message, ek payment, ek lead

Manual (demo rehearsal par): galat signature pe koi state change nahi; field masking list/detail/CSV teeno mein same; do concurrent Google bookings mein doosri reject; Slack token tod kar escalation phir bhi hoti hai; opted-out contact ko message block.

---

## Demo ke paanch moments (inhi par marks hain)

1. Judge apne phone se WhatsApp bhejta hai → lead screen par live, contact auto-create
2. Countdown chal raha hai → **worker process kill karo aur restart karo** → escalation phir bhi hoti hai, Slack DM aata hai
3. `/recovery` kholo (har row ka reason). Audit log kholo (poori ownership chain)
4. DevTools se doosre workspace ka ID hit karo → 404. SQL console se `DELETE FROM audit_logs` → database mana kar deta hai
5. Stripe test card → dashboard par collected revenue update, projected revenue alag tile mein

Point 2 aur 4 differentiator hain. Koi doosri team server restart kar ke nahi dikhayegi.

### Demo se pehle (intro ke dauran)
- Judge ko **WhatsApp sandbox join phrase** bhejo.
- Slack alert presenter (dost) ke phone par aayega: dost Slack workspace join kare, aur demo user ki Profile mein dost ka Slack email ho.
- `ack_window_seconds = 20`, seed data real lagne wala ("Lahore Solar Solutions"), do workspaces (doosra isolation dikhane ke liye).
- Worker kill karne ka tareeka pehle se rehearse karo (Railway mein worker service restart).

---

**Kabhi mat kato:** lead engine · webhook signature checks · workspace isolation · audit log · field masking
**Cheap marks, mat kato:** F2.3 per-pipeline fields · F2.6 saved lists · F5.5 show/hide tiles
