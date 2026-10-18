-- =============================================================================
-- Vigil lead engine. The application only CALLS these functions; it never
-- reimplements assignment, acknowledgement, escalation or recovery.
--
-- Concurrency model
--   * Every state-changing function first takes ONE transaction-scoped advisory
--     lock for the lead's workspace (vigil_lock_workspace). All assignment
--     decisions inside a workspace are therefore serialized: workload counts,
--     round-robin order and "is this still due?" checks cannot race.
--   * The lock is released at commit. Callers run each function call as its own
--     transaction (the worker never wraps several calls in one BEGIN ... COMMIT),
--     so a call holds exactly one lock and one bad lead cannot roll back others.
--   * lead_assignments_one_open (unique index) is the final guard: even a bug
--     cannot give a lead two open assignments.
--
-- Side effects of every new assignment (vigil_open_assignment), in the same transaction:
--   lead_assignments row, users.last_assigned_at (round robin), one outbox 'notify'
--   row (unique per assignment), one activities row (kind 'assignment'), one audit row.
--   The application must NOT enqueue assignment notifications or write assignment
--   activities itself.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers (prefixed vigil_, not called by the application)
-- -----------------------------------------------------------------------------

CREATE FUNCTION vigil_lock_workspace(p_workspace uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtext('vigil.workspace'), hashtext(p_workspace::text));
$$;

-- Pick the next eligible user, or NULL.
--   Eligible = same workspace, not deactivated, availability 'available',
--              open assignments below assignment_rules.max_open_leads.
--   p_type:    'next_available' (anyone eligible), 'backup' (assignment_rules.backup_user_id),
--              'manager' (members of assignment_rules.manager_role_id).
--   p_exclude_previous: skip users who already held this lead (escalation round robin).
--   p_exclude_user:     always skipped (the current owner).
-- Order = round robin: least recently assigned first, then oldest account, then id.
-- Must be called while holding the workspace lock.
CREATE FUNCTION vigil_pick_assignee(
  p_workspace uuid, p_lead uuid, p_type text, p_exclude_previous boolean, p_exclude_user uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  r assignment_rules%ROWTYPE;
  v_user uuid;
BEGIN
  SELECT * INTO r FROM assignment_rules WHERE workspace_id = p_workspace;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_rules missing for workspace %', p_workspace;
  END IF;
  IF p_type NOT IN ('next_available', 'backup', 'manager') THEN
    RAISE EXCEPTION 'unknown escalation level type %', p_type;
  END IF;

  SELECT u.id INTO v_user
    FROM users u
   WHERE u.workspace_id = p_workspace
     AND u.deactivated_at IS NULL
     AND u.availability = 'available'
     AND u.id IS DISTINCT FROM p_exclude_user
     AND (SELECT count(*) FROM lead_assignments la
           WHERE la.user_id = u.id AND la.closed_at IS NULL) < r.max_open_leads
     AND (NOT p_exclude_previous OR NOT EXISTS (
           SELECT 1 FROM lead_assignments p WHERE p.lead_id = p_lead AND p.user_id = u.id))
     AND (p_type = 'next_available'
          OR (p_type = 'backup'  AND u.id = r.backup_user_id)
          OR (p_type = 'manager' AND EXISTS (
                SELECT 1 FROM user_roles ur
                 WHERE ur.user_id = u.id AND ur.role_id = r.manager_role_id)))
   ORDER BY u.last_assigned_at NULLS FIRST, u.created_at, u.id
   LIMIT 1;

  RETURN v_user;
END $$;

-- Create one open assignment plus its notify, activity and audit rows.
-- Caller holds the workspace lock and has closed any previous open assignment.
CREATE FUNCTION vigil_open_assignment(
  p_lead uuid, p_user uuid, p_level int, p_reason text, p_seconds int, p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  l leads%ROWTYPE;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO l FROM leads WHERE id = p_lead;

  INSERT INTO lead_assignments (workspace_id, lead_id, user_id, level, reason, assigned_by, assigned_at, deadline_at)
  VALUES (l.workspace_id, p_lead, p_user, p_level, p_reason, p_actor, v_now,
          v_now + make_interval(secs => p_seconds))
  RETURNING id INTO v_id;

  UPDATE users SET last_assigned_at = v_now WHERE id = p_user;

  INSERT INTO outbox (workspace_id, kind, assignment_id, payload)
  VALUES (l.workspace_id, 'notify', v_id, jsonb_build_object(
            'user_id', p_user, 'lead_id', p_lead, 'assignment_id', v_id,
            'reason', p_reason, 'level', p_level));

  INSERT INTO activities (workspace_id, contact_id, opportunity_id, lead_id, actor_id, kind, data)
  VALUES (l.workspace_id, l.contact_id, l.opportunity_id, p_lead, p_actor, 'assignment',
          jsonb_build_object('assignment_id', v_id, 'user_id', p_user,
                             'reason', p_reason, 'level', p_level));

  INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
  VALUES (l.workspace_id, p_actor, p_reason, 'lead', p_lead, NULL,
          jsonb_build_object('assignment_id', v_id, 'user_id', p_user, 'level', p_level,
                             'deadline_at', v_now + make_interval(secs => p_seconds)));
  RETURN v_id;
END $$;

-- Close an open assignment with an outcome and audit it.
CREATE FUNCTION vigil_close_assignment(p_assignment uuid, p_outcome text, p_actor uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  a lead_assignments%ROWTYPE;
BEGIN
  UPDATE lead_assignments SET closed_at = clock_timestamp(), outcome = p_outcome
   WHERE id = p_assignment AND closed_at IS NULL
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment % is not open', p_assignment;
  END IF;
  INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
  VALUES (a.workspace_id, p_actor, 'assignment.closed', 'lead', a.lead_id,
          jsonb_build_object('assignment_id', a.id, 'user_id', a.user_id,
                             'acknowledged_at', a.acknowledged_at),
          jsonb_build_object('outcome', p_outcome, 'closed_at', a.closed_at));
END $$;

-- -----------------------------------------------------------------------------
-- assign_new_lead(lead_id [, reason])
--   Call in the SAME transaction that inserts the lead, and from the orphan guard
--   with reason 'lead.recovered'. Idempotent: if the lead already has an open
--   assignment, returns it and changes nothing. Returns NULL when the lead is
--   not open or nobody is eligible (the lead stays an orphan and the orphan
--   guard retries every 10s; recovery_queue shows it as 'no_owner').
-- -----------------------------------------------------------------------------
CREATE FUNCTION assign_new_lead(p_lead uuid, p_reason text DEFAULT 'lead.assigned') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  l leads%ROWTYPE;
  r assignment_rules%ROWTYPE;
  v_existing uuid;
  v_user uuid;
BEGIN
  IF p_reason NOT IN ('lead.assigned', 'lead.recovered') THEN
    RAISE EXCEPTION 'assign_new_lead reason must be lead.assigned or lead.recovered, got %', p_reason;
  END IF;

  SELECT * INTO l FROM leads WHERE id = p_lead;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead % not found', p_lead;
  END IF;
  PERFORM vigil_lock_workspace(l.workspace_id);
  SELECT * INTO l FROM leads WHERE id = p_lead FOR UPDATE;
  IF l.status <> 'open' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing FROM lead_assignments WHERE lead_id = p_lead AND closed_at IS NULL;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO r FROM assignment_rules WHERE workspace_id = l.workspace_id;
  -- Recovery does not exclude previous holders (the lead may return to them).
  v_user := vigil_pick_assignee(l.workspace_id, p_lead, 'next_available', false, NULL);
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN vigil_open_assignment(p_lead, v_user, 0, p_reason, r.ack_window_seconds, NULL);
END $$;

-- -----------------------------------------------------------------------------
-- record_lead_action(lead, user, actor_type, reason)
--   Call after ANY action on a lead. reason: button note message call_log
--   stage_change appointment.
--   'human': resets the idle clock (leads.last_human_action_at); if the user is
--            the current owner and has not acknowledged, sets acknowledged_at.
--            Acknowledgement never closes the assignment.
--   'system': validated, changes nothing (never acknowledges, never resets idle).
--   Returns true when this call acknowledged the lead.
-- -----------------------------------------------------------------------------
CREATE FUNCTION record_lead_action(p_lead uuid, p_user uuid, p_actor_type text, p_reason text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  l leads%ROWTYPE;
  a lead_assignments%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_type NOT IN ('human', 'system') THEN
    RAISE EXCEPTION 'actor_type must be human or system, got %', p_actor_type;
  END IF;
  IF p_reason NOT IN ('button', 'note', 'message', 'call_log', 'stage_change', 'appointment') THEN
    RAISE EXCEPTION 'invalid lead action reason %', p_reason;
  END IF;

  SELECT * INTO l FROM leads WHERE id = p_lead;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead % not found', p_lead;
  END IF;
  IF p_actor_type = 'system' THEN
    RETURN false;
  END IF;
  IF p_user IS NULL OR NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_user AND workspace_id = l.workspace_id) THEN
    RAISE EXCEPTION 'user % does not belong to the lead''s workspace', p_user;
  END IF;

  PERFORM vigil_lock_workspace(l.workspace_id);
  UPDATE leads SET last_human_action_at = v_now WHERE id = p_lead;

  SELECT * INTO a FROM lead_assignments
   WHERE lead_id = p_lead AND closed_at IS NULL FOR UPDATE;
  IF FOUND AND a.user_id = p_user AND a.acknowledged_at IS NULL THEN
    UPDATE lead_assignments SET acknowledged_at = v_now WHERE id = a.id;
    INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
    VALUES (l.workspace_id, p_user, 'lead.acknowledged', 'lead', p_lead,
            jsonb_build_object('assignment_id', a.id, 'acknowledged_at', NULL),
            jsonb_build_object('assignment_id', a.id, 'acknowledged_at', v_now, 'via', p_reason));
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- -----------------------------------------------------------------------------
-- change_availability(user, status, actor)
--   The only way availability changes. actor NULL = system.
--   On leave / Offline: every UNacknowledged open lead of the user moves now to
--   the next eligible person (outcome 'owner_unavailable'). If nobody is
--   eligible the user keeps it (never orphaned); it shows in recovery_queue as
--   'owner_unavailable' and still escalates at its deadline.
--   Acknowledged leads stay with the user and show as 'owner_unavailable'.
--   Returns the number of leads moved.
-- -----------------------------------------------------------------------------
CREATE FUNCTION change_availability(p_user uuid, p_status text, p_actor uuid) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  u users%ROWTYPE;
  r assignment_rules%ROWTYPE;
  a lead_assignments%ROWTYPE;
  v_old text;
  v_target uuid;
  v_moved int := 0;
BEGIN
  IF p_status NOT IN ('available', 'busy', 'on_leave', 'offline') THEN
    RAISE EXCEPTION 'invalid availability %', p_status;
  END IF;
  SELECT * INTO u FROM users WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user;
  END IF;
  IF p_actor IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_actor AND workspace_id = u.workspace_id) THEN
    RAISE EXCEPTION 'actor % does not belong to the user''s workspace', p_actor;
  END IF;

  PERFORM vigil_lock_workspace(u.workspace_id);
  SELECT * INTO u FROM users WHERE id = p_user FOR UPDATE;
  v_old := u.availability;
  IF v_old = p_status THEN
    RETURN 0;
  END IF;

  UPDATE users SET availability = p_status WHERE id = p_user;
  INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
  VALUES (u.workspace_id, p_actor, 'user.availability_changed', 'user', p_user,
          jsonb_build_object('availability', v_old), jsonb_build_object('availability', p_status));

  IF p_status IN ('on_leave', 'offline') THEN
    SELECT * INTO r FROM assignment_rules WHERE workspace_id = u.workspace_id;
    FOR a IN
      SELECT * FROM lead_assignments
       WHERE user_id = p_user AND closed_at IS NULL AND acknowledged_at IS NULL
       ORDER BY assigned_at, id
       FOR UPDATE
    LOOP
      v_target := vigil_pick_assignee(u.workspace_id, a.lead_id, 'next_available', false, p_user);
      IF v_target IS NOT NULL THEN
        PERFORM vigil_close_assignment(a.id, 'owner_unavailable', p_actor);
        PERFORM vigil_open_assignment(a.lead_id, v_target, a.level, 'lead.owner_unavailable',
                                      r.ack_window_seconds, p_actor);
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN v_moved;
END $$;

-- -----------------------------------------------------------------------------
-- reassign_manually(lead, to_user, actor)
--   Manager reassignment (the app checks leads.reassign). Closes the current
--   assignment with 'reassigned' (acknowledged_at unchanged) and opens exactly
--   one new assignment for to_user with a fresh acknowledgement window.
--   to_user must be active and Available (F3.3); the workload limit is NOT
--   applied, because this is a deliberate manager decision.
--   Returns the new assignment id.
-- -----------------------------------------------------------------------------
CREATE FUNCTION reassign_manually(p_lead uuid, p_to uuid, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  l leads%ROWTYPE;
  r assignment_rules%ROWTYPE;
  a lead_assignments%ROWTYPE;
  t users%ROWTYPE;
BEGIN
  SELECT * INTO l FROM leads WHERE id = p_lead;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead % not found', p_lead;
  END IF;
  PERFORM vigil_lock_workspace(l.workspace_id);
  SELECT * INTO l FROM leads WHERE id = p_lead FOR UPDATE;
  IF l.status <> 'open' THEN
    RAISE EXCEPTION 'lead % is not open', p_lead;
  END IF;

  SELECT * INTO t FROM users WHERE id = p_to AND workspace_id = l.workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % does not belong to the lead''s workspace', p_to;
  END IF;
  IF t.deactivated_at IS NOT NULL OR t.availability <> 'available' THEN
    RAISE EXCEPTION 'user % is not available to receive leads', p_to;
  END IF;
  IF p_actor IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_actor AND workspace_id = l.workspace_id) THEN
    RAISE EXCEPTION 'actor % does not belong to the lead''s workspace', p_actor;
  END IF;

  SELECT * INTO a FROM lead_assignments WHERE lead_id = p_lead AND closed_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF a.user_id = p_to THEN
      RAISE EXCEPTION 'lead % is already assigned to user %', p_lead, p_to;
    END IF;
    PERFORM vigil_close_assignment(a.id, 'reassigned', p_actor);
  END IF;

  SELECT * INTO r FROM assignment_rules WHERE workspace_id = l.workspace_id;
  RETURN vigil_open_assignment(p_lead, p_to, COALESCE(a.level, 0), 'lead.reassigned',
                               r.ack_window_seconds, p_actor);
END $$;

-- -----------------------------------------------------------------------------
-- due_assignment_ids(limit)  -- worker loop 1, then sweep_one(id) per id
--   Open, unacknowledged assignments whose deadline (or retry time) has passed.
--   Deadlines live in the table, so rows that fell due while the worker was down
--   are found on the first poll after restart.
-- -----------------------------------------------------------------------------
CREATE FUNCTION due_assignment_ids(p_limit int) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM lead_assignments
   WHERE closed_at IS NULL
     AND acknowledged_at IS NULL
     AND COALESCE(retry_at, deadline_at) <= now()
   ORDER BY COALESCE(retry_at, deadline_at), id
   LIMIT p_limit;
$$;

-- -----------------------------------------------------------------------------
-- sweep_one(assignment_id)
--   Escalate one overdue assignment. Safe to call concurrently for the same id:
--   both calls serialize on the workspace lock and the second one re-reads the
--   row, finds it closed (or no longer due) and returns 'skipped'.
--   Escalating from level k uses escalation_levels[k] (the last level repeats).
--   next_available skips everyone who already held the lead; backup and manager
--   skip only the current owner. If nobody is eligible, the current owner keeps
--   the lead and retry_at = now + retry_seconds.
--   Returns 'escalated' | 'deferred' | 'completed' | 'skipped'.
-- -----------------------------------------------------------------------------
CREATE FUNCTION sweep_one(p_assignment uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  a lead_assignments%ROWTYPE;
  l leads%ROWTYPE;
  r assignment_rules%ROWTYPE;
  v_ws uuid;
  v_levels int;
  v_level jsonb;
  v_type text;
  v_seconds int;
  v_target uuid;
  v_new uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM lead_assignments WHERE id = p_assignment;
  IF NOT FOUND THEN
    RETURN 'skipped';
  END IF;
  PERFORM vigil_lock_workspace(v_ws);

  SELECT * INTO a FROM lead_assignments WHERE id = p_assignment FOR UPDATE;
  IF a.closed_at IS NOT NULL OR a.acknowledged_at IS NOT NULL
     OR COALESCE(a.retry_at, a.deadline_at) > now() THEN
    RETURN 'skipped';
  END IF;

  SELECT * INTO l FROM leads WHERE id = a.lead_id FOR UPDATE;
  IF l.status <> 'open' THEN
    PERFORM vigil_close_assignment(a.id, 'completed', NULL);
    RETURN 'completed';
  END IF;

  SELECT * INTO r FROM assignment_rules WHERE workspace_id = v_ws;
  v_levels := jsonb_array_length(r.escalation_levels);

  IF v_levels > 0 THEN
    v_level   := r.escalation_levels -> LEAST(a.level, v_levels - 1);
    v_type    := v_level ->> 'type';
    v_seconds := (v_level ->> 'seconds')::int;
    IF v_seconds IS NULL OR v_seconds <= 0 THEN
      RAISE EXCEPTION 'escalation level % has invalid seconds', LEAST(a.level, v_levels - 1);
    END IF;
    v_target := vigil_pick_assignee(v_ws, a.lead_id, v_type, v_type = 'next_available', a.user_id);
  END IF;

  IF v_target IS NULL THEN
    UPDATE lead_assignments
       SET retry_at = clock_timestamp() + make_interval(secs => r.retry_seconds)
     WHERE id = a.id;
    -- audit only the first deferral, so a lead waiting for hours does not flood the log
    IF a.retry_at IS NULL THEN
      INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
      VALUES (v_ws, NULL, 'lead.escalation_deferred', 'lead', a.lead_id,
              jsonb_build_object('assignment_id', a.id, 'user_id', a.user_id, 'level', a.level),
              jsonb_build_object('reason', 'no eligible user', 'level_type', v_type,
                                 'retry_seconds', r.retry_seconds));
    END IF;
    RETURN 'deferred';
  END IF;

  PERFORM vigil_close_assignment(a.id, 'escalated', NULL);
  v_new := vigil_open_assignment(a.lead_id, v_target, a.level + 1, 'lead.escalated', v_seconds, NULL);
  RETURN 'escalated';
END $$;

-- -----------------------------------------------------------------------------
-- orphan_lead_ids()  -- worker loop 2, then assign_new_lead(id, 'lead.recovered')
--   Open leads with no open assignment (e.g. nobody was eligible at intake).
-- -----------------------------------------------------------------------------
CREATE FUNCTION orphan_lead_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT l.id FROM leads l
   WHERE l.status = 'open'
     AND NOT EXISTS (SELECT 1 FROM lead_assignments a
                      WHERE a.lead_id = l.id AND a.closed_at IS NULL)
   ORDER BY l.created_at, l.id;
$$;

-- -----------------------------------------------------------------------------
-- recovery_queue: one row per open lead needing attention, with every reason.
--   overdue            open assignment unacknowledged past deadline_at
--   escalated_twice    the lead has escalated two or more times
--   idle               no human action for assignment_rules.idle_seconds
--   owner_unavailable  current owner is On leave, Offline or deactivated
--   no_owner           open lead without an open assignment
-- Always filter by workspace_id. Never recompute these reasons in TypeScript.
-- -----------------------------------------------------------------------------
CREATE VIEW recovery_queue AS
WITH base AS (
  SELECT l.workspace_id,
         l.id                    AS lead_id,
         l.contact_id,
         l.source,
         l.created_at            AS lead_created_at,
         l.last_human_action_at,
         a.id                    AS assignment_id,
         a.user_id               AS owner_id,
         a.level,
         a.assigned_at,
         a.deadline_at,
         a.acknowledged_at,
         a.retry_at,
         u.availability          AS owner_availability,
         u.deactivated_at        AS owner_deactivated_at,
         (SELECT count(*) FROM lead_assignments e
           WHERE e.lead_id = l.id AND e.outcome = 'escalated')::int AS escalation_count,
         r.idle_seconds
    FROM leads l
    JOIN assignment_rules r ON r.workspace_id = l.workspace_id
    LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
    LEFT JOIN users u ON u.id = a.user_id
   WHERE l.status = 'open'
), reasons AS (
  SELECT b.*,
         array_remove(ARRAY[
           CASE WHEN b.assignment_id IS NOT NULL AND b.acknowledged_at IS NULL
                     AND b.deadline_at < now() THEN 'overdue' END,
           CASE WHEN b.escalation_count >= 2 THEN 'escalated_twice' END,
           CASE WHEN COALESCE(b.last_human_action_at, b.lead_created_at)
                     < now() - make_interval(secs => b.idle_seconds) THEN 'idle' END,
           CASE WHEN b.assignment_id IS NOT NULL
                     AND (b.owner_availability IN ('on_leave', 'offline')
                          OR b.owner_deactivated_at IS NOT NULL) THEN 'owner_unavailable' END,
           CASE WHEN b.assignment_id IS NULL THEN 'no_owner' END
         ], NULL) AS reasons
    FROM base b
)
SELECT workspace_id, lead_id, contact_id, source, lead_created_at, last_human_action_at,
       assignment_id, owner_id, level, assigned_at, deadline_at, acknowledged_at, retry_at,
       owner_availability, escalation_count, reasons
  FROM reasons
 WHERE cardinality(reasons) > 0;

-- -----------------------------------------------------------------------------
-- lead_first_response: time from a lead's FIRST assignment to its FIRST
-- acknowledgement (button or recorded human action by the owner).
--   first_assignee_id: who got the lead first.
--   responder_id:      who acknowledged first (personal "own response time").
--   time_to_first_response is NULL until the lead is acknowledged.
-- Dashboard: AVG(time_to_first_response) per workspace, or per responder_id.
-- -----------------------------------------------------------------------------
CREATE VIEW lead_first_response AS
SELECT l.workspace_id,
       l.id AS lead_id,
       l.created_at AS lead_created_at,
       fa.assigned_at AS first_assigned_at,
       fa.user_id     AS first_assignee_id,
       ack.acknowledged_at AS first_acknowledged_at,
       ack.user_id         AS responder_id,
       ack.acknowledged_at - fa.assigned_at AS time_to_first_response
  FROM leads l
  JOIN LATERAL (
    SELECT a.assigned_at, a.user_id FROM lead_assignments a
     WHERE a.lead_id = l.id ORDER BY a.assigned_at, a.id LIMIT 1
  ) fa ON true
  LEFT JOIN LATERAL (
    SELECT a.acknowledged_at, a.user_id FROM lead_assignments a
     WHERE a.lead_id = l.id AND a.acknowledged_at IS NOT NULL
     ORDER BY a.acknowledged_at, a.id LIMIT 1
  ) ack ON true;

-- -----------------------------------------------------------------------------
-- Realtime signals (Q11)
--   Changes to these tables send pg_notify('workspace_events', payload).
--   Payload is IDs only, never customer data or secrets:
--     {"ws": <workspace_id>, "table": <table>, "op": "insert"|"update"|"delete", "id": <row id>,
--      "lead_id": <lead id or null>}
--   NOTIFY is transactional: it is delivered only on COMMIT, never on ROLLBACK.
--   GET /api/stream LISTENs on workspace_events and forwards events whose ws
--   matches the caller's workspace; the browser then refetches.
-- -----------------------------------------------------------------------------
CREATE FUNCTION vigil_notify_workspace() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
BEGIN
  -- DELETE has no NEW row: report the deleted row's ids from OLD
  rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  PERFORM pg_notify('workspace_events', json_build_object(
    'ws',      rec ->> 'workspace_id',
    'table',   TG_TABLE_NAME,
    'op',      lower(TG_OP),
    'id',      rec ->> 'id',
    'lead_id', rec ->> 'lead_id'
  )::text);
  RETURN NULL;
END $$;

-- new leads, status changes
CREATE TRIGGER leads_notify_t AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- assignment, acknowledgement, escalation, reassignment
CREATE TRIGGER lead_assignments_notify_t AFTER INSERT OR UPDATE ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- opportunities: created, edited, moved between stages, deleted (pipeline board)
CREATE TRIGGER opportunities_notify_t AFTER INSERT OR UPDATE OR DELETE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- inbound messages and delivery status
CREATE TRIGGER messages_notify_t AFTER INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- payment requested / paid / refunded
CREATE TRIGGER payments_notify_t AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- booked / rescheduled / cancelled
CREATE TRIGGER appointments_notify_t AFTER INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
-- availability changes (dashboard tile, team list)
CREATE TRIGGER users_availability_notify_t AFTER UPDATE OF availability ON users
  FOR EACH ROW WHEN (OLD.availability IS DISTINCT FROM NEW.availability)
  EXECUTE FUNCTION vigil_notify_workspace();
-- failed alerts become visible to Admins
CREATE TRIGGER outbox_failed_notify_t AFTER UPDATE OF status ON outbox
  FOR EACH ROW WHEN (NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed')
  EXECUTE FUNCTION vigil_notify_workspace();
-- integration status changes (Integrations page)
CREATE TRIGGER integration_connections_notify_t AFTER INSERT OR UPDATE OF status ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION vigil_notify_workspace();
