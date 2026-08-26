-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 053_work_workflow.sql. This repository already had a 053 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- What can happen to a piece of work, and who may make it happen.
--
-- Migration 051 holds the shape. This holds the rules, as functions,
-- for the same reason migration 055 does it for content: "may I move
-- this to done" has several parts, and a policy's USING clause is the
-- wrong place to keep a rule that has to look at the task, the actor,
-- the capability and the state it is coming from.
--
-- Every write that has a rule goes through here. The UPDATE policy on
-- `tasks` covers ordinary field edits; status, assignment, due dates and
-- release requests do not, and the guard below is what stops a caller
-- reaching around these functions with a plain PATCH.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The status column is closed to direct writes
--
-- Without this, `PATCH /tasks?id=eq.X {"status":"done"}` finishes
-- anybody's work, skipping review, the approver and the history. The
-- same hole existed in content and is closed the same way: a trigger
-- that refuses unless the transition function opened the gate.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_status_is_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.work_transition', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION
      'status is moved by work_start, work_block, work_submit, work_complete and the rest, not by writing the column';
  END IF;

  IF (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
      OR NEW.assignee_kind IS DISTINCT FROM OLD.assignee_kind
      OR NEW.assignee_dept_id IS DISTINCT FROM OLD.assignee_dept_id
      OR NEW.assignee_team_id IS DISTINCT FROM OLD.assignee_team_id)
     AND COALESCE(current_setting('app.work_transition', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION 'who has a task is changed by work_assign, so the person losing it is told';
  END IF;

  IF NEW.due_at IS DISTINCT FROM OLD.due_at
     AND COALESCE(current_setting('app.work_transition', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION 'a due date is moved by work_set_due, which needs work.setDue and records what it was';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_task_status_closed ON tasks;
CREATE TRIGGER trg_task_status_closed BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_status_is_closed();

CREATE OR REPLACE FUNCTION work_gate_open() RETURNS VOID
LANGUAGE SQL AS $fn$ SELECT set_config('app.work_transition', 'on', TRUE) $fn$;
CREATE OR REPLACE FUNCTION work_gate_shut() RETURNS VOID
LANGUAGE SQL AS $fn$ SELECT set_config('app.work_transition', '', TRUE) $fn$;
REVOKE ALL ON FUNCTION work_gate_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION work_gate_shut() FROM PUBLIC;

-- -------------------------------------------------------------
-- 2. Which moves are legal
--
-- A table rather than a CASE, so the Work screen can read it and grey
-- out the moves that are not available instead of offering one that
-- then refuses. Rule 11 of CLAUDE.md: nothing you cannot do is ever
-- offered.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_transitions (
  from_status  task_status NOT NULL,
  to_status    task_status NOT NULL,
  -- What it takes. NULL means anybody who can edit the task.
  capability   TEXT,
  -- Whether only the person holding the task may do it. Starting work
  -- is yours to do; cancelling it is not.
  assignee_only BOOLEAN NOT NULL DEFAULT FALSE,
  label        TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO task_transitions (from_status, to_status, capability, assignee_only, label) VALUES
  ('backlog','ready',            NULL, FALSE, 'Mark ready'),
  ('backlog','in_progress',      NULL, FALSE, 'Start'),
  ('backlog','cancelled',        'work.edit', FALSE, 'Cancel'),
  ('ready','in_progress',        NULL, FALSE, 'Start'),
  ('ready','backlog',            NULL, FALSE, 'Send back to backlog'),
  ('ready','cancelled',          'work.edit', FALSE, 'Cancel'),
  ('in_progress','blocked',      NULL, FALSE, 'Blocked'),
  ('in_progress','waiting_external', NULL, FALSE, 'Waiting on somebody outside'),
  ('in_progress','in_review',    NULL, FALSE, 'Send for review'),
  ('in_progress','done',         NULL, FALSE, 'Done'),
  ('in_progress','ready',        NULL, FALSE, 'Stop'),
  ('in_progress','cancelled',    'work.edit', FALSE, 'Cancel'),
  ('blocked','in_progress',      NULL, FALSE, 'Unblocked'),
  ('blocked','cancelled',        'work.edit', FALSE, 'Cancel'),
  ('waiting_external','in_progress', NULL, FALSE, 'They came back'),
  ('waiting_external','cancelled','work.edit', FALSE, 'Cancel'),
  ('in_review','done',           'work.review', FALSE, 'Accept'),
  ('in_review','in_progress',    'work.review', FALSE, 'Send back'),
  ('in_review','cancelled',      'work.edit', FALSE, 'Cancel'),
  /* Reopening finished work is deliberately narrow. Anything else and
     the completed_at on a task means nothing. */
  ('done','in_progress',         'work.editAny', FALSE, 'Reopen'),
  ('cancelled','backlog',        'work.editAny', FALSE, 'Reinstate')
ON CONFLICT (from_status, to_status) DO UPDATE
  SET capability = EXCLUDED.capability,
      assignee_only = EXCLUDED.assignee_only,
      label = EXCLUDED.label;

ALTER TABLE task_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_transitions_read ON task_transitions;
CREATE POLICY task_transitions_read ON task_transitions
  FOR SELECT USING (current_actor() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON task_transitions FROM authenticated, anon;
GRANT SELECT ON task_transitions TO authenticated;

-- -------------------------------------------------------------
-- 3. The shared half of every move
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_transition(
  p_task   UUID,
  p_to     task_status,
  p_note   TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t      tasks;
  rule   task_transitions;
  actor  UUID := current_actor();
  blockers INT;
BEGIN
  IF COALESCE(current_setting('app.work_flow', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION 'work_transition is the shared half of work_start, work_complete and the rest. Call one of those.';
  END IF;

  SELECT * INTO t FROM tasks WHERE id = p_task AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such task'; END IF;

  IF NOT can_reach_task(t.id, t.assignee_id, t.assignee_dept_id, t.created_by,
                        t.delegated_by, t.reviewer_id, t.approver_id,
                        t.classification::TEXT, t.is_sensitive) THEN
    RAISE EXCEPTION 'no such task';
  END IF;

  IF t.status = p_to THEN RETURN t; END IF;

  SELECT * INTO rule FROM task_transitions
   WHERE from_status = t.status AND to_status = p_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a task cannot go from % to %', t.status, p_to;
  END IF;

  IF rule.capability IS NOT NULL AND NOT command_may(rule.capability) THEN
    RAISE EXCEPTION 'that needs %', rule.capability;
  END IF;
  IF rule.capability IS NULL AND NOT command_may('work.edit') THEN
    RAISE EXCEPTION 'that needs work.edit';
  END IF;
  IF rule.assignee_only AND t.assignee_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'only the person holding this can do that';
  END IF;

  /* A dependency that means something. Starting work that something
     else is still blocking is the commonest way a plan quietly stops
     being true, so it is refused rather than warned about. */
  IF p_to IN ('in_progress', 'done') THEN
    SELECT COUNT(*) INTO blockers
      FROM task_links l JOIN tasks b ON b.id = l.from_task
     WHERE l.to_task = p_task AND l.kind = 'blocks'
       AND b.status NOT IN ('done','cancelled') AND b.deleted_at IS NULL;
    IF blockers > 0 THEN
      RAISE EXCEPTION '% task(s) still have to finish first', blockers;
    END IF;
  END IF;

  IF p_to = 'blocked' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'say what it is blocked on, or nobody can unblock it';
  END IF;
  IF p_to = 'cancelled' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'say why it was cancelled';
  END IF;

  PERFORM work_gate_open();
  UPDATE tasks SET
    status           = p_to,
    blocked_reason   = CASE WHEN p_to = 'blocked' THEN p_reason
                            WHEN p_to IN ('in_progress','done') THEN NULL
                            ELSE blocked_reason END,
    waiting_on       = CASE WHEN p_to = 'waiting_external' THEN p_reason
                            WHEN p_to = 'in_progress' THEN NULL
                            ELSE waiting_on END,
    cancelled_reason = CASE WHEN p_to = 'cancelled' THEN p_reason ELSE cancelled_reason END
  WHERE id = p_task
  RETURNING * INTO t;
  PERFORM work_gate_shut();

  INSERT INTO task_field_history (task_id, actor_id, field, was, now_is, note)
  VALUES (p_task, actor, 'status', rule.from_status::TEXT, p_to::TEXT, COALESCE(p_note, p_reason));

  PERFORM log_activity(
    CASE p_to WHEN 'done' THEN 'completed' WHEN 'blocked' THEN 'blocked'
              WHEN 'cancelled' THEN 'cancelled' WHEN 'in_review' THEN 'submitted'
              ELSE 'moved' END,
    'task', p_task,
    format('%s %s', t.ref, lower(rule.label)),
    t.title, NULL, NULL, NULL,
    jsonb_build_object('from', rule.from_status, 'to', p_to, 'reason', p_reason),
    t.classification::TEXT, t.is_sensitive, FALSE);

  PERFORM audit('update', 'tasks', p_task, NULL,
                jsonb_build_object('status', rule.from_status),
                jsonb_build_object('status', p_to));
  RETURN t;
END;
$fn$;

CREATE OR REPLACE FUNCTION work_flow_open() RETURNS VOID
LANGUAGE SQL AS $fn$ SELECT set_config('app.work_flow', 'on', TRUE) $fn$;
CREATE OR REPLACE FUNCTION work_flow_shut() RETURNS VOID
LANGUAGE SQL AS $fn$ SELECT set_config('app.work_flow', '', TRUE) $fn$;
REVOKE ALL ON FUNCTION work_flow_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION work_flow_shut() FROM PUBLIC;

-- The named moves. Each one opens the gate, does the shared half, and
-- shuts it, so `work_transition` cannot be called from outside.
CREATE OR REPLACE FUNCTION work_move(p_task UUID, p_to TEXT, p_reason TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r tasks;
BEGIN
  PERFORM work_flow_open();
  r := work_transition(p_task, p_to::task_status, p_note, p_reason);
  PERFORM work_flow_shut();
  RETURN r;
END;
$fn$;
REVOKE ALL ON FUNCTION work_move(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_move(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. Assigning, and being told
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_assign(
  p_task UUID,
  p_kind TEXT,
  p_user UUID DEFAULT NULL,
  p_dept UUID DEFAULT NULL,
  p_team UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t     tasks;
  actor UUID := current_actor();
  was   TEXT;
  now_t TEXT;
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such task'; END IF;
  IF NOT can_reach_task(t.id, t.assignee_id, t.assignee_dept_id, t.created_by,
                        t.delegated_by, t.reviewer_id, t.approver_id,
                        t.classification::TEXT, t.is_sensitive) THEN
    RAISE EXCEPTION 'no such task';
  END IF;

  /* Picking something up yourself is not the same as putting it on
     somebody else, and it should not need the same permission. */
  IF p_kind = 'person' AND p_user = actor THEN
    IF NOT command_may('work.edit') THEN RAISE EXCEPTION 'that needs work.edit'; END IF;
  ELSIF p_kind = 'person' THEN
    IF NOT command_may('work.assignOthers') THEN
      RAISE EXCEPTION 'that needs work.assignOthers';
    END IF;
  ELSIF p_kind IN ('department','team') THEN
    IF NOT command_may('work.assignDepartment') THEN
      RAISE EXCEPTION 'that needs work.assignDepartment';
    END IF;
  ELSIF p_kind = 'unassigned' THEN
    IF NOT command_may('work.reassign') AND t.assignee_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'that needs work.reassign';
    END IF;
  ELSE
    RAISE EXCEPTION 'assign to a person, a department, a team, or nobody';
  END IF;

  /* Taking work off somebody who already has it is its own permission,
     because it is the move people notice. */
  IF t.assignee_id IS NOT NULL AND t.assignee_id <> actor
     AND (p_kind <> 'person' OR p_user IS DISTINCT FROM t.assignee_id)
     AND NOT command_may('work.reassign') THEN
    RAISE EXCEPTION 'taking a task off somebody needs work.reassign';
  END IF;

  was := COALESCE(
    (SELECT full_name FROM profiles WHERE id = t.assignee_id),
    (SELECT name FROM departments WHERE id = t.assignee_dept_id),
    'nobody');

  PERFORM work_gate_open();
  UPDATE tasks SET
    assignee_kind    = p_kind::assignee_kind,
    assignee_id      = CASE WHEN p_kind = 'person'     THEN p_user ELSE NULL END,
    assignee_dept_id = CASE WHEN p_kind = 'department' THEN p_dept ELSE NULL END,
    assignee_team_id = CASE WHEN p_kind = 'team'       THEN p_team ELSE NULL END,
    /* Whoever put it on somebody else is the delegator, and is who a
       release request goes to. Assigning to yourself does not make you
       your own delegator. */
    delegated_by     = CASE WHEN p_kind = 'person' AND p_user IS DISTINCT FROM actor
                            THEN actor ELSE NULL END,
    delegated_at     = CASE WHEN p_kind = 'person' AND p_user IS DISTINCT FROM actor
                            THEN NOW() ELSE NULL END
  WHERE id = p_task
  RETURNING * INTO t;
  PERFORM work_gate_shut();

  now_t := COALESCE(
    (SELECT full_name FROM profiles WHERE id = t.assignee_id),
    (SELECT name FROM departments WHERE id = t.assignee_dept_id),
    'nobody');

  INSERT INTO task_field_history (task_id, actor_id, field, was, now_is, note)
  VALUES (p_task, actor, 'assignee', was, now_t, p_note);

  PERFORM log_activity('assigned', 'task', p_task,
    format('%s went to %s', t.ref, now_t), t.title,
    NULL, NULL, NULL,
    jsonb_build_object('from', was, 'to', now_t),
    t.classification::TEXT, t.is_sensitive, FALSE);

  PERFORM audit('update', 'tasks', p_task, NULL,
                jsonb_build_object('assignee', was),
                jsonb_build_object('assignee', now_t));
  RETURN t;
END;
$fn$;
REVOKE ALL ON FUNCTION work_assign(UUID, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_assign(UUID, TEXT, UUID, UUID, UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 5. Moving a date
--
-- Its own function and its own capability, because a deadline somebody
-- committed to is not an ordinary field. The original is kept, so
-- "this has moved four times" is answerable.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_set_due(p_task UUID, p_due TIMESTAMPTZ, p_note TEXT DEFAULT NULL)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE t tasks; was TIMESTAMPTZ;
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such task'; END IF;
  IF NOT can_reach_task(t.id, t.assignee_id, t.assignee_dept_id, t.created_by,
                        t.delegated_by, t.reviewer_id, t.approver_id,
                        t.classification::TEXT, t.is_sensitive) THEN
    RAISE EXCEPTION 'no such task';
  END IF;

  /* Setting a date on work nobody delegated to you is editing. Moving
     one that somebody above you set is not, and needs saying yes to. */
  IF t.delegated_by IS NOT NULL AND t.delegated_by <> current_actor()
     AND NOT command_may('work.setDue') THEN
    RAISE EXCEPTION 'this date was set by somebody else. Ask for an extension instead, or you need work.setDue';
  END IF;
  IF NOT command_may('work.edit') THEN RAISE EXCEPTION 'that needs work.edit'; END IF;

  was := t.due_at;
  PERFORM work_gate_open();
  UPDATE tasks SET due_at = p_due WHERE id = p_task RETURNING * INTO t;
  PERFORM work_gate_shut();

  INSERT INTO task_field_history (task_id, actor_id, field, was, now_is, note)
  VALUES (p_task, current_actor(), 'due_at', was::TEXT, p_due::TEXT, p_note);
  PERFORM audit('update', 'tasks', p_task, NULL,
                jsonb_build_object('due_at', was), jsonb_build_object('due_at', p_due));
  RETURN t;
END;
$fn$;
REVOKE ALL ON FUNCTION work_set_due(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_set_due(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 6. Asking to be let off
--
-- The thing that makes this a delegation system rather than a list.
--
-- Somebody handed work they cannot do has three honest options: do it
-- badly, do nothing, or say so. Only the third is useful, and it only
-- happens if saying so is a supported action with an addressee and an
-- answer rather than a message in a chat somebody has to remember.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_request_release(
  p_task    UUID,
  p_ask     TEXT,
  p_reason  TEXT,
  p_to_user UUID DEFAULT NULL,
  p_to_dept UUID DEFAULT NULL,
  p_to_team UUID DEFAULT NULL,
  p_due     TIMESTAMPTZ DEFAULT NULL
)
RETURNS task_delegation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t   tasks;
  req task_delegation_requests;
  who UUID;
BEGIN
  IF NOT command_may('work.requestRelease') THEN
    RAISE EXCEPTION 'that needs work.requestRelease';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'say why. A request with no reason cannot be answered.';
  END IF;

  SELECT * INTO t FROM tasks WHERE id = p_task AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such task'; END IF;

  IF t.assignee_id IS DISTINCT FROM current_actor()
     AND NOT (t.assignee_dept_id IS NOT NULL AND t.assignee_dept_id = actor_department()) THEN
    RAISE EXCEPTION 'this is not yours to hand back';
  END IF;

  IF t.status IN ('done','cancelled') THEN
    RAISE EXCEPTION 'that task is already finished';
  END IF;

  /* Whoever put it on you answers. If nobody did, whoever raised it
     does, and if that is nobody then anybody who can override. */
  who := COALESCE(t.delegated_by, t.created_by);

  IF EXISTS (SELECT 1 FROM task_delegation_requests r
              WHERE r.task_id = p_task AND r.asked_by = current_actor() AND r.state = 'open') THEN
    RAISE EXCEPTION 'you already have an open request on this task';
  END IF;

  INSERT INTO task_delegation_requests
    (task_id, asked_by, asked_of, ask, reason,
     suggest_kind, suggest_user, suggest_dept, suggest_team, suggest_due)
  VALUES
    (p_task, current_actor(), who, p_ask::delegation_ask, btrim(p_reason),
     CASE WHEN p_to_user IS NOT NULL THEN 'person'::assignee_kind
          WHEN p_to_dept IS NOT NULL THEN 'department'::assignee_kind
          WHEN p_to_team IS NOT NULL THEN 'team'::assignee_kind END,
     p_to_user, p_to_dept, p_to_team, p_due)
  RETURNING * INTO req;

  PERFORM log_activity('requested', 'task', p_task,
    format('%s: asked to %s', t.ref, p_ask), t.title,
    NULL, NULL, NULL,
    jsonb_build_object('ask', p_ask, 'reason', p_reason, 'asked_of', who),
    t.classification::TEXT, t.is_sensitive, FALSE);

  PERFORM audit('create', 'task_delegation_requests', req.id, NULL, NULL,
                jsonb_build_object('task', p_task, 'ask', p_ask));
  RETURN req;
END;
$fn$;
REVOKE ALL ON FUNCTION work_request_release(UUID, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_request_release(UUID, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- -------------------------------------------------------------
-- 7. Answering one
--
-- Granting APPLIES the outcome in the same transaction. A request
-- marked granted while the work still sits on the same person with the
-- same date is the failure this whole mechanism exists to prevent.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_decide_release(
  p_request UUID,
  p_grant   BOOLEAN,
  p_note    TEXT DEFAULT NULL
)
RETURNS task_delegation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  req task_delegation_requests;
  t   tasks;
BEGIN
  SELECT * INTO req FROM task_delegation_requests WHERE id = p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such request'; END IF;
  IF req.state <> 'open' THEN
    RAISE EXCEPTION 'that request was already %', req.state;
  END IF;

  IF req.asked_of IS DISTINCT FROM current_actor()
     AND NOT command_may('work.forceRelease') THEN
    RAISE EXCEPTION 'this was asked of somebody else. Overriding them needs work.forceRelease.';
  END IF;
  IF req.asked_of = current_actor() AND NOT command_may('work.decideRelease') THEN
    RAISE EXCEPTION 'that needs work.decideRelease';
  END IF;

  SELECT * INTO t FROM tasks WHERE id = req.task_id;

  IF p_grant THEN
    IF req.ask = 'cancel' THEN
      PERFORM work_flow_open();
      PERFORM work_transition(req.task_id, 'cancelled'::task_status, p_note,
                              format('released: %s', req.reason));
      PERFORM work_flow_shut();

    ELSIF req.ask = 'reassign' THEN
      /* Where it goes. A suggestion if one was made, and back to the
         person who delegated it if not, because unassigning it would
         leave it nowhere and it would simply rot. */
      IF req.suggest_kind = 'person' THEN
        PERFORM work_assign(req.task_id, 'person', req.suggest_user, NULL, NULL, p_note);
      ELSIF req.suggest_kind = 'department' THEN
        PERFORM work_assign(req.task_id, 'department', NULL, req.suggest_dept, NULL, p_note);
      ELSIF req.suggest_kind = 'team' THEN
        PERFORM work_assign(req.task_id, 'team', NULL, NULL, req.suggest_team, p_note);
      ELSE
        PERFORM work_assign(req.task_id, 'person', COALESCE(req.asked_of, t.created_by),
                            NULL, NULL, 'handed back');
      END IF;

    ELSIF req.ask = 'extend' THEN
      IF req.suggest_due IS NULL THEN
        RAISE EXCEPTION 'that request did not name a new date';
      END IF;
      PERFORM work_set_due(req.task_id, req.suggest_due, p_note);

    ELSIF req.ask = 'declassify' THEN
      IF NOT command_may('compliance.sensitive') THEN
        RAISE EXCEPTION 'lifting a sensitivity flag needs compliance.sensitive';
      END IF;
      UPDATE tasks SET classification = 'internal' WHERE id = req.task_id;
    END IF;
  END IF;

  UPDATE task_delegation_requests SET
    state         = CASE WHEN p_grant THEN 'granted' ELSE 'refused' END::delegation_state,
    decided_by    = current_actor(),
    decided_at    = NOW(),
    decision_note = p_note
  WHERE id = p_request
  RETURNING * INTO req;

  PERFORM log_activity(CASE WHEN p_grant THEN 'approved' ELSE 'rejected' END,
    'task', req.task_id,
    format('%s: request to %s was %s', t.ref, req.ask,
           CASE WHEN p_grant THEN 'granted' ELSE 'refused' END),
    t.title, NULL, NULL, NULL,
    jsonb_build_object('ask', req.ask, 'note', p_note),
    t.classification::TEXT, t.is_sensitive, FALSE);

  PERFORM audit('update', 'task_delegation_requests', p_request, NULL,
                jsonb_build_object('state', 'open'),
                jsonb_build_object('state', req.state));
  RETURN req;
END;
$fn$;
REVOKE ALL ON FUNCTION work_decide_release(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_decide_release(UUID, BOOLEAN, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 8. Undoing a batch
--
-- Scope 57. Fifteen tasks from one misattributed transcript are fifteen
-- problems, and reversing them one at a time is how half get left.
--
-- The rule that matters: work somebody has already touched is NOT
-- reversed, and is named in the result. Being told everything was undone
-- when it was not is worse than not being able to undo it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_rollback_batch(p_batch UUID, p_note TEXT DEFAULT NULL)
RETURNS TABLE (cancelled INT, kept INT, kept_refs TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  b        task_batches;
  keep     UUID[] := '{}';
  keep_ref TEXT[] := '{}';
  gone     INT := 0;
  r        RECORD;
BEGIN
  IF NOT command_may('work.rollback') THEN
    RAISE EXCEPTION 'that needs work.rollback';
  END IF;

  SELECT * INTO b FROM task_batches WHERE id = p_batch;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such batch'; END IF;
  IF b.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'that batch was already rolled back on %', b.rolled_back_at::DATE;
  END IF;
  /* Scope 57: by whoever approved it, or by an administrator. */
  IF b.created_by IS DISTINCT FROM current_actor() AND NOT command_may('work.forceRelease') THEN
    RAISE EXCEPTION 'only whoever created this batch, or an administrator, can reverse it';
  END IF;

  FOR r IN
    SELECT t.id, t.ref, t.status, t.started_at,
           EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = t.id) AS commented
      FROM tasks t
     WHERE t.batch_id = p_batch AND t.deleted_at IS NULL
  LOOP
    /* Started, commented on, or already finished. Somebody has put work
       into it and reversing it would throw that away. */
    IF r.started_at IS NOT NULL OR r.commented
       OR r.status IN ('in_progress','in_review','done','blocked','waiting_external') THEN
      keep     := keep     || r.id;
      keep_ref := keep_ref || r.ref;
      CONTINUE;
    END IF;

    PERFORM work_flow_open();
    PERFORM work_transition(r.id, 'cancelled'::task_status, p_note,
                            format('batch %s reversed', b.label));
    PERFORM work_flow_shut();
    gone := gone + 1;
  END LOOP;

  UPDATE task_batches SET
    rolled_back_at = NOW(),
    rolled_back_by = current_actor(),
    kept_task_ids  = keep
  WHERE id = p_batch;

  /* Scope 57: the rollback is itself an audited event. It reverses
     work, it does not erase the record that the work existed. */
  PERFORM audit('update', 'task_batches', p_batch, NULL,
                jsonb_build_object('rolled_back', FALSE),
                jsonb_build_object('rolled_back', TRUE, 'cancelled', gone, 'kept', keep_ref));

  RETURN QUERY SELECT gone, COALESCE(array_length(keep, 1), 0), keep_ref;
END;
$fn$;
REVOKE ALL ON FUNCTION work_rollback_batch(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_rollback_batch(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 9. Work that repeats
--
-- Called by a scheduled job. Idempotent by date: running it twice in
-- one day produces one task, because `last_spawned_on` is checked and
-- set in the same statement.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_next_occurrence(p_rule task_recurrences, p_from DATE)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE d DATE := p_from;
BEGIN
  CASE p_rule.cadence
    WHEN 'daily' THEN
      d := p_from + (p_rule.interval_n || ' days')::INTERVAL;
    WHEN 'weekdays' THEN
      d := p_from + INTERVAL '1 day';
      WHILE EXTRACT(DOW FROM d) IN (0, 6) LOOP d := d + INTERVAL '1 day'; END LOOP;
    WHEN 'weekly' THEN
      IF array_length(p_rule.weekdays, 1) IS NULL THEN
        d := p_from + (p_rule.interval_n * 7 || ' days')::INTERVAL;
      ELSE
        /* The next listed day of the week. Walks a fortnight at most,
           which is enough for any weekly rule and terminates whatever
           the array holds. */
        d := p_from + INTERVAL '1 day';
        WHILE NOT (EXTRACT(DOW FROM d)::INT = ANY (p_rule.weekdays))
              AND d < p_from + INTERVAL '15 days' LOOP
          d := d + INTERVAL '1 day';
        END LOOP;
      END IF;
    WHEN 'monthly' THEN
      d := (date_trunc('month', p_from) + (p_rule.interval_n || ' months')::INTERVAL)::DATE
           + (COALESCE(p_rule.day_of_month, 1) - 1);
  END CASE;
  RETURN d;
END;
$fn$;

CREATE OR REPLACE FUNCTION work_spawn_due(p_on DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (rule_id UUID, task_id UUID, skipped TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rule task_recurrences;
  new_id UUID;
  tpl JSONB;
BEGIN
  FOR rule IN
    SELECT * FROM task_recurrences
     WHERE paused_at IS NULL
       AND starts_on <= p_on
       AND (ends_on IS NULL OR ends_on >= p_on)
       AND (last_spawned_on IS NULL OR last_spawned_on < p_on)
       AND (next_due_on IS NULL OR next_due_on <= p_on)
  LOOP
    tpl := rule.template;

    /* Do not stack copies. A weekly task nobody did should be one
       overdue task, not eight identical ones. */
    IF rule.skip_if_open AND EXISTS (
      SELECT 1 FROM tasks t
       WHERE t.recurrence_id = rule.id
         AND t.status NOT IN ('done','cancelled')
         AND t.deleted_at IS NULL
    ) THEN
      UPDATE task_recurrences SET
        last_spawned_on = p_on,
        next_due_on = work_next_occurrence(rule, p_on)
      WHERE id = rule.id;
      RETURN QUERY SELECT rule.id, NULL::UUID, 'the last one is still open'::TEXT;
      CONTINUE;
    END IF;

    INSERT INTO tasks (
      title, description, project_id, department_id,
      assignee_kind, assignee_id, assignee_dept_id,
      priority, due_at, estimate_minutes,
      source, recurrence_id, created_by, owning_entity_id
    ) VALUES (
      rule.title,
      tpl->>'description',
      NULLIF(tpl->>'project_id','')::UUID,
      NULLIF(tpl->>'department_id','')::UUID,
      COALESCE(NULLIF(tpl->>'assignee_kind',''), 'unassigned')::assignee_kind,
      NULLIF(tpl->>'assignee_id','')::UUID,
      NULLIF(tpl->>'assignee_dept_id','')::UUID,
      COALESCE(NULLIF(tpl->>'priority',''), 'p2')::task_priority,
      (p_on + rule.at_time)::TIMESTAMPTZ,
      NULLIF(tpl->>'estimate_minutes','')::INT,
      'recurrence', rule.id, rule.created_by,
      NULLIF(tpl->>'owning_entity_id','')::UUID
    )
    RETURNING id INTO new_id;

    UPDATE task_recurrences SET
      last_spawned_on = p_on,
      next_due_on = work_next_occurrence(rule, p_on)
    WHERE id = rule.id;

    RETURN QUERY SELECT rule.id, new_id, NULL::TEXT;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION work_spawn_due(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_spawn_due(DATE) TO service_role;

-- -------------------------------------------------------------
-- 10. Dragging a card
--
-- A move between board columns that mean different statuses IS the
-- transition, with the transition's own permission. Between two columns
-- that mean the same status it is only reordering. The board never
-- decides which; it says where the card landed and this works it out.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_move_card(
  p_task     UUID,
  p_to       TEXT,
  p_position DOUBLE PRECISION,
  p_reason   TEXT DEFAULT NULL
)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE t tasks;
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such task'; END IF;

  IF t.status::TEXT IS DISTINCT FROM p_to THEN
    t := work_move(p_task, p_to, p_reason, NULL);
  END IF;

  PERFORM work_gate_open();
  UPDATE tasks SET board_position = p_position WHERE id = p_task RETURNING * INTO t;
  PERFORM work_gate_shut();
  RETURN t;
END;
$fn$;
REVOKE ALL ON FUNCTION work_move_card(UUID, TEXT, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_move_card(UUID, TEXT, DOUBLE PRECISION, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 11. What a person can do to a task right now
--
-- Read by the screen so it offers only the moves that will work.
-- CLAUDE.md rule 11: nothing you cannot do is ever offered, because an
-- action that appears and then refuses teaches people the tool is
-- unreliable.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_available_moves(p_task UUID)
RETURNS TABLE (to_status TEXT, label TEXT, needs_reason BOOLEAN, blocked_by INT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    tr.to_status::TEXT,
    tr.label,
    tr.to_status IN ('blocked','cancelled'),
    (SELECT COUNT(*)::INT FROM task_links l JOIN tasks b ON b.id = l.from_task
      WHERE l.to_task = p_task AND l.kind = 'blocks'
        AND b.status NOT IN ('done','cancelled') AND b.deleted_at IS NULL)
  FROM tasks t
  JOIN task_transitions tr ON tr.from_status = t.status
  WHERE t.id = p_task
    AND t.deleted_at IS NULL
    AND (tr.capability IS NULL OR command_may(tr.capability))
    AND (tr.capability IS NOT NULL OR command_may('work.edit'))
    AND (NOT tr.assignee_only OR t.assignee_id = current_actor())
  ORDER BY tr.label
$fn$;
REVOKE ALL ON FUNCTION work_available_moves(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work_available_moves(UUID) TO authenticated;
