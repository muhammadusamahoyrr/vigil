-- =============================================================================
-- 003: First-party Vigil Web Chat + in-app notifications.
--
-- Replaces external customer messaging (Twilio WhatsApp, not configurable from
-- Pakistan) with a public web chat at /chat/<workspace slug>, allowed under the
-- organizers' alternative-technology announcement. Existing Twilio/Slack schema
-- stays untouched and optional.
--
-- Adds: workspaces.slug, channel 'web', lead source 'chat', a hashed customer
-- token per web conversation, per-request idempotency keys on messages, read
-- markers, a notifications table filled by triggers on lead_assignments, and
-- conversation ids in realtime payloads (still IDs only, never PII).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workspace slug: the public chat URL never exposes the workspace UUID
-- -----------------------------------------------------------------------------
CREATE FUNCTION vigil_slugify(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(trim(both '-' FROM regexp_replace(lower(t), '[^a-z0-9]+', '-', 'g')), 60), ''), 'workspace')
$$;

ALTER TABLE workspaces ADD COLUMN slug text;

WITH s AS (
  SELECT id, vigil_slugify(name) AS base,
         row_number() OVER (PARTITION BY vigil_slugify(name) ORDER BY created_at, id) AS n
    FROM workspaces
)
UPDATE workspaces w SET slug = CASE WHEN s.n = 1 THEN s.base ELSE s.base || '-' || s.n END
  FROM s WHERE s.id = w.id;

-- New workspaces get a slug from their name; a short random suffix resolves clashes.
CREATE FUNCTION workspaces_set_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text := vigil_slugify(NEW.name);
  candidate text := base;
BEGIN
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;
  WHILE EXISTS (SELECT 1 FROM workspaces WHERE slug = candidate) LOOP
    candidate := base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END $$;

CREATE TRIGGER workspaces_set_slug_t BEFORE INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION workspaces_set_slug();

ALTER TABLE workspaces
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT workspaces_slug_unique UNIQUE (slug),
  ADD CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80);

-- -----------------------------------------------------------------------------
-- Lead source and conversation channel
-- -----------------------------------------------------------------------------
ALTER TABLE leads DROP CONSTRAINT leads_source_check,
  ADD CONSTRAINT leads_source_check CHECK (source IN ('manual', 'form', 'message', 'chat'));

ALTER TABLE conversations DROP CONSTRAINT conversations_channel_check,
  ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('whatsapp', 'sms', 'web'));

-- Provider channels keep one conversation per contact and channel. Web chat has one
-- conversation per browser session (token): a second browser that types the same
-- phone number must NOT be able to read an existing conversation's history.
ALTER TABLE conversations DROP CONSTRAINT conversations_workspace_id_contact_id_channel_key;
CREATE UNIQUE INDEX conversations_provider_unique
  ON conversations (workspace_id, contact_id, channel) WHERE channel <> 'web';

ALTER TABLE conversations
  ADD COLUMN lead_id uuid,
  -- sha256 of the customer's random chat token; the raw token lives only in an HttpOnly cookie
  ADD COLUMN customer_token_hash bytea UNIQUE,
  ADD COLUMN agent_read_at timestamptz,     -- inbound messages after this are unread for agents
  ADD COLUMN customer_read_at timestamptz,  -- outbound messages after this are unread for the customer
  ADD CONSTRAINT conversations_web_token CHECK ((channel = 'web') = (customer_token_hash IS NOT NULL)),
  ADD CONSTRAINT conversations_lead_fk FOREIGN KEY (workspace_id, lead_id)
    REFERENCES leads (workspace_id, id) ON DELETE RESTRICT;
CREATE INDEX conversations_lead_idx ON conversations (lead_id);

-- -----------------------------------------------------------------------------
-- Idempotency: the browser sends a random key per message; a repeat returns the original
-- -----------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN client_key text CHECK (client_key ~ '^[A-Za-z0-9_-]{8,100}$');
CREATE UNIQUE INDEX messages_client_key_unique ON messages (workspace_id, client_key) WHERE client_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- In-app notifications (first-party; Slack stays optional)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  user_id         uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN (
                    'lead.assigned', 'lead.escalated', 'lead.reassigned', 'lead.owner_unavailable',
                    'lead.recovered', 'lead.missed', 'message.new')),
  lead_id         uuid,
  conversation_id uuid,
  title           text NOT NULL,
  body            text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id)         REFERENCES users         (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, lead_id)         REFERENCES leads         (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Every new owner is told in-app (first assignment, escalation, reassignment,
-- owner-unavailable move, recovery), and an owner who missed the window is told
-- the lead escalated away. Runs inside the lead engine's own transaction.
CREATE FUNCTION lead_assignments_notifications() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_contact text;
  v_conversation uuid;
BEGIN
  SELECT c.name INTO v_contact FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.id = NEW.lead_id;
  SELECT id INTO v_conversation FROM conversations WHERE lead_id = NEW.lead_id ORDER BY created_at DESC LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (workspace_id, user_id, kind, lead_id, conversation_id, title, body)
    VALUES (NEW.workspace_id, NEW.user_id, NEW.reason, NEW.lead_id, v_conversation,
            CASE NEW.reason
              WHEN 'lead.assigned'          THEN 'New lead assigned to you'
              WHEN 'lead.escalated'         THEN 'Lead escalated to you: the previous owner missed the window'
              WHEN 'lead.reassigned'        THEN 'Lead reassigned to you by a manager'
              WHEN 'lead.owner_unavailable' THEN 'Lead moved to you: the owner is unavailable'
              WHEN 'lead.recovered'         THEN 'Unowned lead recovered and assigned to you'
            END,
            v_contact);
  ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.outcome = 'escalated' THEN
    INSERT INTO notifications (workspace_id, user_id, kind, lead_id, conversation_id, title, body)
    VALUES (NEW.workspace_id, OLD.user_id, 'lead.missed', NEW.lead_id, v_conversation,
            'Missed: you did not acknowledge in time, the lead escalated', v_contact);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER lead_assignments_notifications_t
  AFTER INSERT OR UPDATE OF closed_at ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION lead_assignments_notifications();

-- -----------------------------------------------------------------------------
-- Realtime: payloads gain conversation_id (still IDs only) so the anonymous
-- customer stream can tell which events concern its own conversation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vigil_notify_workspace() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
BEGIN
  rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  PERFORM pg_notify('workspace_events', json_build_object(
    'ws',              rec ->> 'workspace_id',
    'table',           TG_TABLE_NAME,
    'op',              lower(TG_OP),
    'id',              rec ->> 'id',
    'lead_id',         rec ->> 'lead_id',
    'conversation_id', CASE WHEN TG_TABLE_NAME = 'conversations' THEN rec ->> 'id' ELSE rec ->> 'conversation_id' END
  )::text);
  RETURN NULL;
END $$;

CREATE TRIGGER conversations_notify_t AFTER INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
CREATE TRIGGER notifications_notify_t AFTER INSERT OR UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
