-- =============================================================================
-- Vigil schema. Source of truth for every table, column and constraint.
-- Requires PostgreSQL 15+ (ON DELETE SET NULL (column) and UNIQUE NULLS NOT DISTINCT).
--
-- Conventions
--   * Every tenant table has workspace_id and UNIQUE (workspace_id, id).
--     Child tables reference parents with composite keys (workspace_id, parent_id),
--     so the database itself refuses a row that links records of two workspaces.
--   * IDs are UUIDs from gen_random_uuid(). Timestamps are timestamptz.
--   * Workspaces and users are never deleted (users are deactivated), so FKs to
--     them are RESTRICT. Customer history (leads, messages, payments, appointments)
--     blocks deleting its contact: RESTRICT, never CASCADE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- needed by appt_no_overlap (uuid = with range &&)

-- -----------------------------------------------------------------------------
-- Workspaces and authentication
-- -----------------------------------------------------------------------------

CREATE TABLE workspaces (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  -- token in the public web form URL /f/[token]; resolves the workspace without login
  public_form_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  timezone          text NOT NULL DEFAULT 'UTC',  -- IANA name; used for "today" / "this month" metrics
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  email                text NOT NULL CHECK (position('@' IN email) > 1),
  name                 text NOT NULL CHECK (length(trim(name)) > 0),
  password_hash        text NOT NULL,  -- argon2id encoded string
  level                text NOT NULL DEFAULT 'user' CHECK (level IN ('owner', 'admin', 'user')),
  availability         text NOT NULL DEFAULT 'available'
                       CHECK (availability IN ('available', 'busy', 'on_leave', 'offline')),
  failed_logins        int  NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until         timestamptz,
  deactivated_at       timestamptz,  -- users are deactivated, never deleted
  -- round-robin state: the eligible user assigned least recently goes first
  last_assigned_at     timestamptz,
  slack_email          text,  -- the user's Slack account email (I4.3, per-user alert routing)
  slack_user_id        text,  -- resolved from slack_email with users.lookupByEmail; alerts are DMs to it
  notify_email         text,         -- email fallback destination (NOTIFY_PROVIDER=resend)
  version              int  NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
-- Login is by email + password with no workspace picker, so an email must
-- identify exactly one account across the platform.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
-- Exactly one Owner per workspace. To transfer ownership, demote the old Owner first.
CREATE UNIQUE INDEX one_owner_per_workspace ON users (workspace_id) WHERE level = 'owner';

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid  NOT NULL,
  user_id      uuid  NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,  -- sha256 of the cookie token; the token itself is never stored
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);

-- The fixed permission keys (CLAUDE.md, Permissions). Never add keys elsewhere.
CREATE TABLE permissions (
  key text PRIMARY KEY
);
INSERT INTO permissions (key) VALUES
  ('crm.view'), ('crm.create'), ('crm.edit'), ('crm.delete'), ('crm.export'),
  ('opportunity_value.view'), ('conversations.view'), ('conversations.send'),
  ('leads.reassign'), ('payments.create'), ('appointments.manage'),
  ('assignment_rules.manage'), ('config.manage'), ('integrations.manage'),
  ('audit.view'), ('users.manage');

CREATE TABLE role_permissions (
  role_id        uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions (key) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  role_id      uuid NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid  NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  email        text  NOT NULL CHECK (position('@' IN email) > 1),
  level        text  NOT NULL DEFAULT 'user' CHECK (level IN ('admin', 'user')),
  -- roles granted on acceptance; the accept service checks each id belongs to this workspace
  role_ids     uuid[] NOT NULL DEFAULT '{}',
  token_hash   bytea NOT NULL UNIQUE,  -- sha256 of the one-time invite token
  invited_by   uuid  NOT NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, invited_by) REFERENCES users (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX invitations_workspace_idx ON invitations (workspace_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- CRM configuration
-- -----------------------------------------------------------------------------

CREATE TABLE pipelines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  position     int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);

CREATE TABLE stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  pipeline_id     uuid NOT NULL,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  position        int  NOT NULL,
  is_won          boolean NOT NULL DEFAULT false,
  is_lost         boolean NOT NULL DEFAULT false,
  -- field_definitions.key values that must be filled before an opportunity enters this stage
  required_fields text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (is_won AND is_lost)),
  UNIQUE (workspace_id, id),
  UNIQUE (pipeline_id, id),
  -- deferrable so a reorder can swap positions inside one transaction
  CONSTRAINT stages_position_unique UNIQUE (pipeline_id, position) DEFERRABLE INITIALLY DEFERRED,
  -- deleting a pipeline deletes its stages; a stage that still has opportunities blocks it (23503)
  FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE field_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  entity       text NOT NULL CHECK (entity IN ('contact', 'opportunity')),
  pipeline_id  uuid,  -- NULL = every pipeline; set = only opportunities in that pipeline (F2.3)
  key          text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),  -- key inside custom_data
  label        text NOT NULL CHECK (length(trim(label)) > 0),
  field_type   text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox')),
  options      jsonb,  -- dropdown choices as a JSON array of strings
  position     int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (field_type <> 'dropdown' OR jsonb_typeof(options) = 'array'),
  CHECK (pipeline_id IS NULL OR entity = 'opportunity'),
  UNIQUE NULLS NOT DISTINCT (workspace_id, entity, pipeline_id, key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- CRM records
-- -----------------------------------------------------------------------------

CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  domain       text,
  version      int  NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX companies_list_idx ON companies (workspace_id, created_at DESC);

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  company_id   uuid,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  phone        text,  -- E.164, e.g. +923001234567; used to match inbound messages
  email        text,
  opted_out    boolean NOT NULL DEFAULT false,  -- true blocks outbound messages (I1.9)
  opted_out_at timestamptz,
  custom_data  jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_data) = 'object'),
  version      int  NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  -- deleting a company keeps its contacts and clears the link
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id) ON DELETE SET NULL (company_id)
);
-- one contact per phone per workspace: concurrent inbound messages cannot create two contacts
CREATE UNIQUE INDEX contacts_phone_unique ON contacts (workspace_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX contacts_list_idx ON contacts (workspace_id, created_at DESC);
CREATE INDEX contacts_company_idx ON contacts (company_id);

CREATE TABLE opportunities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  contact_id     uuid NOT NULL,
  pipeline_id    uuid NOT NULL,
  stage_id       uuid NOT NULL,
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  value          numeric(14, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),  -- masked without opportunity_value.view
  currency       char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  owner_id       uuid,
  payment_status text NOT NULL DEFAULT 'none'
                 CHECK (payment_status IN ('none', 'pending', 'paid', 'failed', 'expired', 'refunded')),
  custom_data    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_data) = 'object'),
  version        int  NOT NULL DEFAULT 1,  -- optimistic locking: UPDATE ... WHERE version = $n
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, contact_id)  REFERENCES contacts  (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id) ON DELETE RESTRICT,
  -- the stage must belong to the opportunity's pipeline; a stage with deals cannot be deleted
  FOREIGN KEY (pipeline_id, stage_id)     REFERENCES stages    (pipeline_id, id)  ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_id)    REFERENCES users     (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX opportunities_list_idx ON opportunities (workspace_id, created_at DESC);
CREATE INDEX opportunities_stage_idx ON opportunities (stage_id);
CREATE INDEX opportunities_contact_idx ON opportunities (contact_id);

CREATE TABLE tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX tags_name_unique ON tags (workspace_id, lower(name));

-- One column per taggable entity (exactly one set) so every row has a real FK
-- and disappears with its entity: no orphaned tags.
CREATE TABLE entity_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  tag_id         uuid NOT NULL,
  contact_id     uuid,
  opportunity_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(contact_id, opportunity_id) = 1),
  FOREIGN KEY (workspace_id, tag_id)         REFERENCES tags          (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX entity_tags_contact_unique ON entity_tags (tag_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX entity_tags_opportunity_unique ON entity_tags (tag_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX entity_tags_contact_idx ON entity_tags (contact_id);
CREATE INDEX entity_tags_opportunity_idx ON entity_tags (opportunity_id);

CREATE TABLE saved_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid  NOT NULL,
  user_id      uuid  NOT NULL,
  entity       text  NOT NULL CHECK (entity IN ('contact', 'opportunity')),
  name         text  NOT NULL CHECK (length(trim(name)) > 0),
  -- the filter definition, re-run on every open so the list stays live (F2.6)
  filters      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filters) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX saved_views_user_idx ON saved_views (user_id);

-- -----------------------------------------------------------------------------
-- Lead protection
-- -----------------------------------------------------------------------------

CREATE TABLE leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  contact_id           uuid NOT NULL,
  opportunity_id       uuid,
  source               text NOT NULL CHECK (source IN ('manual', 'form', 'message')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'closed')),
  -- last human action (record_lead_action 'human'); drives the idle recovery reason
  last_human_action_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  CHECK ((status = 'open') = (closed_at IS NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE SET NULL (opportunity_id)
);
CREATE INDEX leads_list_idx ON leads (workspace_id, created_at DESC);
CREATE INDEX leads_open_idx ON leads (workspace_id) WHERE status = 'open';
CREATE INDEX leads_contact_idx ON leads (contact_id);

CREATE TABLE assignment_rules (
  workspace_id       uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE RESTRICT,
  max_open_leads     int  NOT NULL DEFAULT 10  CHECK (max_open_leads > 0),
  ack_window_seconds int  NOT NULL DEFAULT 300 CHECK (ack_window_seconds > 0),
  -- Ordered chain. Escalating from assignment level k uses element k
  -- (the last element repeats once the chain is exhausted).
  -- Each element: {"type": "next_available" | "backup" | "manager", "seconds": <int > 0>}
  escalation_levels  jsonb NOT NULL DEFAULT
    '[{"type":"next_available","seconds":300},{"type":"backup","seconds":300},{"type":"manager","seconds":300}]'
    CHECK (jsonb_typeof(escalation_levels) = 'array'),
  backup_user_id     uuid,
  manager_role_id    uuid,
  idle_seconds       int  NOT NULL DEFAULT 3600 CHECK (idle_seconds > 0),
  -- when no eligible person exists, the current owner keeps the lead and the sweeper retries after this
  retry_seconds      int  NOT NULL DEFAULT 60 CHECK (retry_seconds > 0),
  version            int  NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, backup_user_id)  REFERENCES users (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, manager_role_id) REFERENCES roles (workspace_id, id) ON DELETE SET NULL (manager_role_id)
);

-- Ownership model (the only ownership test anywhere): a lead is owned by the
-- user of its assignment with closed_at IS NULL.
--   assigned          -> acknowledged_at NULL, closed_at NULL, outcome NULL
--   acknowledged      -> acknowledged_at set,  closed_at NULL, outcome NULL  (still owned)
--   ownership ended   -> closed_at and outcome set together
-- There is deliberately no 'acknowledged' outcome.
CREATE TABLE lead_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  lead_id         uuid NOT NULL,
  user_id         uuid NOT NULL,
  level           int  NOT NULL DEFAULT 0 CHECK (level >= 0),  -- 0 = first assignment, +1 per escalation
  reason          text NOT NULL CHECK (reason IN (
                    'lead.assigned', 'lead.recovered', 'lead.escalated',
                    'lead.reassigned', 'lead.owner_unavailable')),
  assigned_by     uuid,  -- human actor for manual reassignment; NULL = system
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  deadline_at     timestamptz NOT NULL,  -- acknowledgement deadline; immutable (guard trigger)
  acknowledged_at timestamptz,
  retry_at        timestamptz,  -- set when escalation found nobody eligible; sweeper retries then
  closed_at       timestamptz,
  outcome         text CHECK (outcome IN ('escalated', 'reassigned', 'owner_unavailable', 'completed')),
  CHECK ((closed_at IS NULL) = (outcome IS NULL)),
  CHECK (deadline_at > assigned_at),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, lead_id)     REFERENCES leads (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, user_id)     REFERENCES users (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, assigned_by) REFERENCES users (workspace_id, id) ON DELETE RESTRICT
);
-- A lead can never have two open assignments (F3.8), whatever the application does.
CREATE UNIQUE INDEX lead_assignments_one_open ON lead_assignments (lead_id) WHERE closed_at IS NULL;
-- workload counts and "my open leads"
CREATE INDEX lead_assignments_user_open_idx ON lead_assignments (user_id) WHERE closed_at IS NULL;
-- sweeper polling: open, unacknowledged, by effective due time
CREATE INDEX lead_assignments_due_idx ON lead_assignments ((COALESCE(retry_at, deadline_at)))
  WHERE closed_at IS NULL AND acknowledged_at IS NULL;
CREATE INDEX lead_assignments_lead_idx ON lead_assignments (lead_id, assigned_at);

-- Guard: identity and timing columns are write-once. acknowledged_at, closed_at
-- and outcome may go from NULL to a value exactly once; rows are never deleted.
-- Tests that need an overdue row INSERT it with a past deadline_at, or disable
-- this trigger inside their own setup only.
CREATE FUNCTION lead_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lead_assignments rows cannot be deleted (ownership history)';
  END IF;
  IF NEW.id           IS DISTINCT FROM OLD.id
  OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  OR NEW.lead_id      IS DISTINCT FROM OLD.lead_id
  OR NEW.user_id      IS DISTINCT FROM OLD.user_id
  OR NEW.level        IS DISTINCT FROM OLD.level
  OR NEW.reason       IS DISTINCT FROM OLD.reason
  OR NEW.assigned_by  IS DISTINCT FROM OLD.assigned_by
  OR NEW.assigned_at  IS DISTINCT FROM OLD.assigned_at
  OR NEW.deadline_at  IS DISTINCT FROM OLD.deadline_at THEN
    RAISE EXCEPTION 'lead_assignments identity and deadline columns are immutable';
  END IF;
  IF OLD.closed_at IS NOT NULL AND (
       NEW.closed_at       IS DISTINCT FROM OLD.closed_at
    OR NEW.outcome         IS DISTINCT FROM OLD.outcome
    OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
    OR NEW.retry_at        IS DISTINCT FROM OLD.retry_at) THEN
    RAISE EXCEPTION 'closed lead_assignments rows are immutable';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    RAISE EXCEPTION 'acknowledged_at can be set only once';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lead_assignments_guard_t
  BEFORE UPDATE OR DELETE ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION lead_assignments_guard();

-- When a lead is won, lost or closed, its open assignment ends with outcome 'completed'.
CREATE FUNCTION leads_complete_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lead_assignments
     SET closed_at = now(), outcome = 'completed'
   WHERE lead_id = NEW.id AND closed_at IS NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER leads_complete_assignment_t
  AFTER UPDATE OF status ON leads
  FOR EACH ROW WHEN (OLD.status = 'open' AND NEW.status <> 'open')
  EXECUTE FUNCTION leads_complete_assignment();

-- -----------------------------------------------------------------------------
-- Conversations and messaging
-- -----------------------------------------------------------------------------

-- All messages with one contact on one channel. The assigned employee is not
-- stored here: it is the owner of the contact's open lead (one source of truth).
CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  contact_id      uuid NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  opportunity_id  uuid,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, contact_id, channel),
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE SET NULL (opportunity_id)
);
CREATE INDEX conversations_list_idx ON conversations (workspace_id, last_message_at DESC NULLS LAST);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('in', 'out')),
  body            text NOT NULL,
  sent_by         uuid,  -- employee who sent an outbound message
  -- Twilio states; 'undelivered' is shown as failed. Inbound messages are 'received'.
  delivery_status text NOT NULL CHECK (delivery_status IN (
                    'received', 'queued', 'sending', 'sent', 'delivered', 'read', 'undelivered', 'failed')),
  failed_reason   text,
  provider_ref    text,  -- Twilio MessageSid
  retry_count     int  NOT NULL DEFAULT 0 CHECK (retry_count >= 0),  -- manual Retry presses
  created_at      timestamptz NOT NULL DEFAULT now(),
  status_updated_at timestamptz,
  CHECK (direction = 'out' OR delivery_status = 'received'),
  CHECK (delivery_status NOT IN ('failed', 'undelivered') OR failed_reason IS NOT NULL),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, sent_by)         REFERENCES users         (workspace_id, id) ON DELETE RESTRICT
);
-- second guard against duplicate provider messages, after integration_events idempotency
CREATE UNIQUE INDEX messages_provider_ref_unique ON messages (workspace_id, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- Payments (card data is never stored: payment happens on Stripe's hosted page)
-- -----------------------------------------------------------------------------

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  opportunity_id       uuid NOT NULL,
  contact_id           uuid NOT NULL,
  requested_by         uuid NOT NULL,
  amount               numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency             char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- pending = requested, not paid (projected). paid/refunded = confirmed by a verified webhook (collected).
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded')),
  provider             text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_ref         text NOT NULL,  -- Checkout Session id
  provider_payment_ref text,           -- PaymentIntent id, matches failure and refund events
  checkout_url         text,
  paid_at              timestamptz,
  refunded_amount      numeric(14, 2) NOT NULL DEFAULT 0,
  refunded_at          timestamptz,
  failed_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  CHECK (status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL),
  CHECK (status <> 'refunded' OR refunded_at IS NOT NULL),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, provider_ref),
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, requested_by)   REFERENCES users         (workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX payments_intent_unique ON payments (workspace_id, provider_payment_ref) WHERE provider_payment_ref IS NOT NULL;
CREATE INDEX payments_list_idx ON payments (workspace_id, created_at DESC);
CREATE INDEX payments_paid_idx ON payments (workspace_id, paid_at) WHERE status IN ('paid', 'refunded');

-- -----------------------------------------------------------------------------
-- Calendar
-- -----------------------------------------------------------------------------

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  user_id         uuid NOT NULL,  -- the employee whose calendar holds the event
  contact_id      uuid NOT NULL,
  opportunity_id  uuid,
  title           text NOT NULL CHECK (length(trim(title)) > 0),
  starts_at_utc   timestamptz NOT NULL,
  ends_at_utc     timestamptz NOT NULL,
  timezone        text NOT NULL,  -- IANA zone the booking was made in, e.g. Asia/Karachi
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  google_event_id text,
  created_by      uuid NOT NULL,
  cancelled_at    timestamptz,
  version         int  NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at_utc > starts_at_utc),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id)        REFERENCES users         (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE SET NULL (opportunity_id),
  FOREIGN KEY (workspace_id, created_by)     REFERENCES users         (workspace_id, id) ON DELETE RESTRICT,
  -- Final guard against double-booking: two confirmed appointments of one
  -- employee can never overlap, even when two bookings race.
  CONSTRAINT appt_no_overlap EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at_utc, ends_at_utc, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX appointments_contact_idx ON appointments (contact_id);
CREATE INDEX appointments_upcoming_idx ON appointments (workspace_id, starts_at_utc) WHERE status = 'confirmed';

-- -----------------------------------------------------------------------------
-- Integrations and reliability
-- -----------------------------------------------------------------------------

CREATE TABLE integration_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  provider             text NOT NULL CHECK (provider IN ('twilio', 'stripe', 'google', 'slack', 'resend')),
  user_id              uuid,  -- set only for per-employee connections (Google Calendar)
  status               text NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('not_connected', 'connected', 'error', 'needs_reconnect')),
  -- AES-256-GCM: nonce(12) || tag(16) || ciphertext, from lib/crypto.ts. Never plaintext.
  credentials          bytea NOT NULL CHECK (octet_length(credentials) > 28),
  -- token in the webhook URL; resolves the workspace before signature verification
  webhook_token        text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  external_account_ref text,  -- e.g. the WhatsApp number or Google account email
  last_ok_at           timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((provider = 'google') = (user_id IS NOT NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX integration_connections_workspace_unique
  ON integration_connections (workspace_id, provider) WHERE user_id IS NULL;
CREATE UNIQUE INDEX integration_connections_user_unique
  ON integration_connections (workspace_id, provider, user_id) WHERE user_id IS NOT NULL;

-- Synchronization history: every inbound webhook and every outbound provider call.
CREATE TABLE integration_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  connection_id     uuid,
  provider          text NOT NULL CHECK (provider IN ('twilio', 'stripe', 'google', 'slack', 'resend')),
  direction         text NOT NULL CHECK (direction IN ('in', 'out')),
  event_type        text NOT NULL,  -- e.g. message.inbound, checkout.session.completed, events.insert
  -- provider's event id (Twilio MessageSid or MessageSid:MessageStatus, Stripe event id);
  -- usually NULL for outbound calls
  external_event_id text,
  status            text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processed', 'succeeded', 'failed')),
  reference         text,  -- related record or provider reference shown in the history
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  -- Webhook idempotency: INSERT ... ON CONFLICT (workspace_id, provider, external_event_id)
  -- DO NOTHING RETURNING id. No row returned = duplicate delivery.
  CONSTRAINT integration_events_idempotency UNIQUE (workspace_id, provider, external_event_id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES integration_connections (workspace_id, id) ON DELETE SET NULL (connection_id)
);
CREATE INDEX integration_events_history_idx ON integration_events (workspace_id, provider, created_at DESC);

-- Rejected requests (unknown webhook token, bad signature). The payload is never stored.
CREATE TABLE security_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces (id) ON DELETE RESTRICT,  -- set when the URL token matched
  kind         text NOT NULL CHECK (kind IN (
                 'unknown_webhook_token', 'invalid_signature', 'login_locked', 'rate_limited', 'csrf_rejected')),
  provider     text,
  path         text,
  ip           inet,
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_idx ON security_events (workspace_id, created_at DESC);

-- Outbox: provider calls that must survive restarts and retry (at-least-once).
-- kind values:
--   'notify'  - alert an employee about a lead (Slack DM, or email when NOTIFY_PROVIDER=resend).
--               payload: {"user_id", "lead_id", "assignment_id", "reason", "level"}.
--               Inserted by the lead engine for every new assignment; assignment_id is unique
--               per notify row, so one assignment can never alert twice.
--   'message' - send an outbound customer message through Twilio. message_id points at the
--               queued messages row; payload may carry extra send options ({} by default).
-- The sender selects pending rows with FOR UPDATE SKIP LOCKED.
CREATE TABLE outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid  NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  kind            text  NOT NULL CHECK (kind IN ('notify', 'message')),
  payload         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  assignment_id   uuid,
  message_id      uuid,
  status          text  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        int   NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'notify')  = (assignment_id IS NOT NULL)),
  CHECK ((kind = 'message') = (message_id IS NOT NULL)),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  FOREIGN KEY (workspace_id, assignment_id) REFERENCES lead_assignments (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, message_id)    REFERENCES messages         (workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX outbox_notify_once ON outbox (assignment_id) WHERE kind = 'notify';
CREATE INDEX outbox_pending_idx ON outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX outbox_failed_idx ON outbox (workspace_id, created_at DESC) WHERE status = 'failed';

-- -----------------------------------------------------------------------------
-- Activities, audit and preferences
-- -----------------------------------------------------------------------------

-- Customer-facing timeline (F2.7). Attached to a contact, opportunity and/or lead.
CREATE TABLE activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  contact_id     uuid,
  opportunity_id uuid,
  lead_id        uuid,
  actor_id       uuid,  -- NULL = system
  kind           text NOT NULL CHECK (kind IN (
                   'note', 'call_log', 'stage_change', 'assignment', 'field_edit',
                   'message', 'payment', 'appointment', 'created', 'updated')),
  body           text,
  data           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(contact_id, opportunity_id, lead_id) >= 1),
  -- timeline entries go with their record when a record without history is deleted
  FOREIGN KEY (workspace_id, contact_id)     REFERENCES contacts      (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, lead_id)        REFERENCES leads         (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, actor_id)       REFERENCES users         (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX activities_contact_idx ON activities (contact_id, created_at DESC);
CREATE INDEX activities_opportunity_idx ON activities (opportunity_id, created_at DESC);
CREATE INDEX activities_lead_idx ON activities (lead_id, created_at DESC);

CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  actor_id     uuid,  -- NULL = system (worker, webhook, lead engine)
  action       text NOT NULL,  -- e.g. lead.assigned, lead.escalated, role.updated
  target_type  text NOT NULL,
  target_id    uuid,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES users (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_logs_list_idx ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_id, created_at);

-- Tamper resistance (F4.3): audit rows can be inserted, never updated, deleted or truncated.
CREATE FUNCTION audit_logs_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable';
END $$;

CREATE TRIGGER audit_logs_immutable_t
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_change();

CREATE TRIGGER audit_logs_no_truncate_t
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_change();

CREATE TABLE user_preferences (
  user_id      uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  hidden_tiles text[] NOT NULL DEFAULT '{}',  -- dashboard tiles the user hid (F5.5)
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
