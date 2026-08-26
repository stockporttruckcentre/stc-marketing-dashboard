-- =============================================================
-- Work: delegation, the status column, and the company split.
--
-- Three claims are made by migrations 056 to 058, and each is the kind
-- that is easy to believe and expensive to be wrong about:
--
--   1. A task's status, assignee and due date cannot be written
--      directly. If they can, then approval, review and the whole
--      delegation loop are one PATCH away from being skipped, exactly
--      as `social_posts.status` was before migration 055.
--
--   2. Granting a release request APPLIES it. A request marked granted
--      while the work still sits on the same person is the failure the
--      mechanism exists to prevent, and it would look like success.
--
--   3. STC staff can task STC Sales and Leasing staff and the work
--      stays visible to them, while confidential work does NOT cross
--      the company line to people who are not on it.
--
-- Run with `npm run check:work`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- ---- the cast ----
INSERT INTO auth.users (id, email) VALUES
  ('dd000000-0000-0000-0000-000000000001', 'wk.director@example.test'),
  ('dd000000-0000-0000-0000-000000000002', 'wk.fitter@example.test'),
  ('dd000000-0000-0000-0000-000000000003', 'wk.other@example.test'),
  ('dd000000-0000-0000-0000-000000000004', 'wk.admin@example.test')
ON CONFLICT DO NOTHING;

-- A director at STC, a fitter at STC Sales and Leasing, a third person
-- on neither side of this task, and an administrator.
UPDATE profiles SET role = 'admin',  role_template_id = NULL
 WHERE id IN ('dd000000-0000-0000-0000-000000000001',
              'dd000000-0000-0000-0000-000000000004');
UPDATE profiles SET role = 'sales',  role_template_id = NULL
 WHERE id IN ('dd000000-0000-0000-0000-000000000002',
              'dd000000-0000-0000-0000-000000000003');

INSERT INTO profile_entities (user_id, entity_id, is_primary)
SELECT 'dd000000-0000-0000-0000-000000000001', id, TRUE FROM entities WHERE code = 'stc'
ON CONFLICT (user_id, entity_id) DO UPDATE SET is_primary = TRUE;
INSERT INTO profile_entities (user_id, entity_id, is_primary)
SELECT 'dd000000-0000-0000-0000-000000000002', id, TRUE FROM entities WHERE code = 'stcsl'
ON CONFLICT (user_id, entity_id) DO UPDATE SET is_primary = TRUE;
INSERT INTO profile_entities (user_id, entity_id, is_primary)
SELECT 'dd000000-0000-0000-0000-000000000003', id, TRUE FROM entities WHERE code = 'stcsl'
ON CONFLICT (user_id, entity_id) DO UPDATE SET is_primary = TRUE;

/* Becoming somebody, properly.

   Setting the JWT claim alone is not enough and the difference is the
   whole check. psql connects as the owner, and an owner BYPASSES row
   level security, so every visibility assertion below would pass by
   reading rows the policies were refusing. `SET LOCAL ROLE` is what
   makes this a real session.

   `check:capabilities` learned this the hard way: its first run passed
   while asserting refusals it was in fact performing. */
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  SET LOCAL ROLE authenticated;
END;
$fn$;

/* Back to the owner, for fixture rows the policies would refuse and
   which are not what is being tested. */
CREATE OR REPLACE FUNCTION pg_temp.as_owner() RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  RESET ROLE;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_claim TEXT, p_true BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT p_true THEN RAISE EXCEPTION 'FAILED: %', p_claim; END IF;
END;
$fn$;

-- =============================================================
-- 1. The columns that matter are closed
-- =============================================================
DO $$
DECLARE
  t   UUID;
  hit BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');

  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id, status)
  VALUES ('Prepare the fleet pricing pack', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002', 'backlog')
  RETURNING id INTO t;

  PERFORM pg_temp.ok('a task gets a reference', (SELECT ref FROM tasks WHERE id = t) IS NOT NULL);

  /* The whole point. Without the trigger this succeeds and every
     review and approval step in the product is decoration. */
  hit := FALSE;
  BEGIN
    UPDATE tasks SET status = 'done' WHERE id = t;
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('the status column refuses a direct write', hit);

  hit := FALSE;
  BEGIN
    UPDATE tasks SET assignee_id = 'dd000000-0000-0000-0000-000000000003' WHERE id = t;
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('the assignee column refuses a direct write', hit);

  hit := FALSE;
  BEGIN
    UPDATE tasks SET due_at = NOW() + INTERVAL '30 days' WHERE id = t;
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('the due date refuses a direct write', hit);

  /* And the shared half cannot be called on its own, or the gate is
     a formality. */
  hit := FALSE;
  BEGIN
    PERFORM work_transition(t, 'done'::task_status, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('work_transition refuses to be called directly', hit);

  -- An ordinary field is still editable, or the table would be useless.
  UPDATE tasks SET description = 'Q3 filing, with counsel' WHERE id = t;
  PERFORM pg_temp.ok('an ordinary field still edits',
    (SELECT description FROM tasks WHERE id = t) = 'Q3 filing, with counsel');
END $$;

-- =============================================================
-- 2. Only the legal moves, and only with the right capability
-- =============================================================
DO $$
DECLARE t UUID; hit BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id)
  VALUES ('Draft the depot storage agreement', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002')
  RETURNING id INTO t;

  /* Backlog to done is not a move anybody has. Skipping the middle is
     how a board stops describing what happened. */
  hit := FALSE;
  BEGIN
    PERFORM work_move(t, 'done', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('backlog cannot jump straight to done', hit);

  PERFORM work_move(t, 'in_progress', NULL, NULL);
  PERFORM pg_temp.ok('starting work sets started_at',
    (SELECT started_at FROM tasks WHERE id = t) IS NOT NULL);

  -- Blocking without saying why is refused, because a blocked task
  -- nobody can unblock is worse than an open one.
  hit := FALSE;
  BEGIN
    PERFORM work_move(t, 'blocked', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('blocking without a reason is refused', hit);

  PERFORM work_move(t, 'blocked', 'waiting on counsel', NULL);
  PERFORM pg_temp.ok('blocking records when it got stuck',
    (SELECT blocked_since FROM tasks WHERE id = t) IS NOT NULL);

  PERFORM work_move(t, 'in_progress', NULL, NULL);
  PERFORM pg_temp.ok('unblocking clears the stuck time',
    (SELECT blocked_since FROM tasks WHERE id = t) IS NULL);

  PERFORM work_move(t, 'done', NULL, NULL);
  PERFORM pg_temp.ok('finishing stamps completed_at',
    (SELECT completed_at FROM tasks WHERE id = t) IS NOT NULL);

  /* History, not just state. Four moves landed: the two that were
     refused wrote nothing, which is the other half of the claim. */
  PERFORM pg_temp.ok('every move that happened is in the history, and no move that did not',
    (SELECT array_agg(now_is ORDER BY id) FROM task_field_history
      WHERE task_id = t AND field = 'status')
      = ARRAY['in_progress','blocked','in_progress','done']);
END $$;

-- =============================================================
-- 3. A dependency that means something
-- =============================================================
DO $$
DECLARE a UUID; b UUID; hit BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by) VALUES ('Sign the MSA', 'dd000000-0000-0000-0000-000000000001') RETURNING id INTO a;
  INSERT INTO tasks (title, created_by) VALUES ('Start integration', 'dd000000-0000-0000-0000-000000000001') RETURNING id INTO b;

  INSERT INTO task_links (from_task, to_task, kind, created_by)
  VALUES (a, b, 'blocks', 'dd000000-0000-0000-0000-000000000001');

  hit := FALSE;
  BEGIN
    PERFORM work_move(b, 'in_progress', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('work cannot start while something still blocks it', hit);

  -- A loop would mean neither could ever start.
  hit := FALSE;
  BEGIN
    INSERT INTO task_links (from_task, to_task, kind, created_by)
    VALUES (b, a, 'blocks', 'dd000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a dependency loop is refused', hit);

  PERFORM work_move(a, 'in_progress', NULL, NULL);
  PERFORM work_move(a, 'done', NULL, NULL);
  PERFORM work_move(b, 'in_progress', NULL, NULL);
  PERFORM pg_temp.ok('once the blocker is done the work can start',
    (SELECT status FROM tasks WHERE id = b) = 'in_progress');
END $$;

-- =============================================================
-- 4. Delegation that can be answered
--
-- The claim this whole feature rests on, and the one that would fail
-- silently: a request marked granted while the work has not moved
-- looks exactly like success.
-- =============================================================
DO $$
DECLARE t UUID; r UUID; hit BOOLEAN;
BEGIN
  -- The director puts work on the fitter.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id, due_at)
  VALUES ('Ship the bridge audit fixes', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002', NOW() + INTERVAL '3 days')
  RETURNING id INTO t;

  PERFORM work_assign(t, 'person', 'dd000000-0000-0000-0000-000000000002', NULL, NULL, NULL);
  PERFORM pg_temp.ok('assigning to somebody else records who delegated it',
    (SELECT delegated_by FROM tasks WHERE id = t) = 'dd000000-0000-0000-0000-000000000001');

  -- Somebody who does not hold it cannot hand it back.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  hit := FALSE;
  BEGIN
    PERFORM work_request_release(t, 'cancel', 'not mine', NULL, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('somebody who does not hold the task cannot hand it back', hit);

  -- The fitter asks to pass it on. A reason is required.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  hit := FALSE;
  BEGIN
    PERFORM work_request_release(t, 'reassign', '   ', NULL, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a request with no reason is refused', hit);

  SELECT id INTO r FROM work_request_release(
    t, 'reassign', 'I am on the testnet relaunch until the 20th',
    'dd000000-0000-0000-0000-000000000003', NULL, NULL, NULL);
  PERFORM pg_temp.ok('the request goes to whoever delegated it',
    (SELECT asked_of FROM task_delegation_requests WHERE id = r)
      = 'dd000000-0000-0000-0000-000000000001');

  -- One open request at a time, or a task collects duplicates nobody reads.
  hit := FALSE;
  BEGIN
    PERFORM work_request_release(t, 'cancel', 'still cannot', NULL, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a second open request on the same task is refused', hit);

  -- The person it was asked of cannot be anybody. The fitter cannot
  -- grant their own request.
  hit := FALSE;
  BEGIN
    PERFORM work_decide_release(r, TRUE, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('you cannot grant your own release request', hit);

  -- The director grants it, and the WORK MOVES.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  PERFORM work_decide_release(r, TRUE, 'fair enough');

  PERFORM pg_temp.ok('the request is marked granted',
    (SELECT state FROM task_delegation_requests WHERE id = r) = 'granted');
  /* The assertion that matters. Everything above could pass with the
     task untouched, and it would read as working. */
  PERFORM pg_temp.ok('and the task actually moved to the suggested person',
    (SELECT assignee_id FROM tasks WHERE id = t) = 'dd000000-0000-0000-0000-000000000003');

  -- Answering it twice is refused.
  hit := FALSE;
  BEGIN
    PERFORM work_decide_release(r, FALSE, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a decided request cannot be decided again', hit);
END $$;

-- A refused request leaves the work exactly where it was.
DO $$
DECLARE t UUID; r UUID;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id)
  VALUES ('Reconcile the treasury report', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002')
  RETURNING id INTO t;
  PERFORM work_assign(t, 'person', 'dd000000-0000-0000-0000-000000000002', NULL, NULL, NULL);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT id INTO r FROM work_request_release(t, 'cancel', 'too busy', NULL, NULL, NULL, NULL);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  PERFORM work_decide_release(r, FALSE, 'it has to happen this week');

  PERFORM pg_temp.ok('a refusal leaves the work where it was',
    (SELECT assignee_id FROM tasks WHERE id = t) = 'dd000000-0000-0000-0000-000000000002'
    AND (SELECT status FROM tasks WHERE id = t) NOT IN ('cancelled', 'done'));
END $$;

-- Granting an extension moves the date, and keeps what it was.
DO $$
DECLARE t UUID; r UUID; want TIMESTAMPTZ := NOW() + INTERVAL '21 days';
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id, due_at)
  VALUES ('Publish the post-quantum brief', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002', NOW() + INTERVAL '2 days')
  RETURNING id INTO t;
  PERFORM work_assign(t, 'person', 'dd000000-0000-0000-0000-000000000002', NULL, NULL, NULL);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT id INTO r FROM work_request_release(t, 'extend', 'counsel review takes three weeks',
                                             NULL, NULL, NULL, want);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  PERFORM work_decide_release(r, TRUE, NULL);

  PERFORM pg_temp.ok('granting an extension moves the date',
    (SELECT date_trunc('minute', due_at) FROM tasks WHERE id = t) = date_trunc('minute', want));
  PERFORM pg_temp.ok('and the date it was first given is kept',
    (SELECT original_due_at FROM tasks WHERE id = t) IS NOT NULL
    AND (SELECT original_due_at FROM tasks WHERE id = t) < want);
END $$;

-- =============================================================
-- 5. The company split
--
-- STC staff task STC Sales and Leasing staff, and the work stays
-- visible to them. That is the case the split exists for, and the one a
-- naive entity filter breaks.
-- =============================================================
DO $$
DECLARE t UUID; seen INT;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id, classification)
  VALUES ('Sign off the leasing rate card', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002', 'confidential')
  RETURNING id INTO t;

  PERFORM pg_temp.ok('a new task is stamped with its creator''s company',
    (SELECT owning_entity_id FROM tasks WHERE id = t)
      = (SELECT id FROM entities WHERE code = 'stc'));

  -- The fitter it was given to can see it, though the task belongs to
  -- the other company and is confidential.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO seen FROM tasks WHERE id = t;
  PERFORM pg_temp.ok('somebody at the other company sees confidential work assigned to them', seen = 1);

  -- Their colleague at the same company, who is not on it, does not.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  SELECT count(*) INTO seen FROM tasks WHERE id = t;
  PERFORM pg_temp.ok('a colleague who is not on it does not see it', seen = 0);
END $$;

-- Commercially sensitive work is the inside of the barrier, and being
-- named on the task is not a way in.
DO $$
DECLARE t UUID; seen INT;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000004');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id, is_sensitive, classification)
  VALUES ('Agree the Fleet Smart Plus margin floor', 'dd000000-0000-0000-0000-000000000004',
          'person', 'dd000000-0000-0000-0000-000000000002', TRUE, 'confidential')
  RETURNING id INTO t;

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO seen FROM tasks WHERE id = t;
  PERFORM pg_temp.ok(
    'being assigned sensitive work is not a way inside the barrier', seen = 0);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000004');
  SELECT count(*) INTO seen FROM tasks WHERE id = t;
  PERFORM pg_temp.ok('somebody with compliance.sensitive sees it', seen = 1);
END $$;

-- =============================================================
-- 6. Reversing a batch
--
-- Scope 57. Work somebody has already touched is kept and named.
-- =============================================================
DO $$
DECLARE b UUID; untouched UUID; started UUID; res RECORD; hit BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO task_batches (label, source, created_by)
  VALUES ('Call with Meridian, 12 Sept', 'transcript', 'dd000000-0000-0000-0000-000000000001')
  RETURNING id INTO b;

  INSERT INTO tasks (title, created_by, batch_id, source)
  VALUES ('Send the storage quote', 'dd000000-0000-0000-0000-000000000001', b, 'transcript')
  RETURNING id INTO untouched;
  INSERT INTO tasks (title, created_by, batch_id, source, assignee_kind, assignee_id)
  VALUES ('Book the follow up', 'dd000000-0000-0000-0000-000000000001', b, 'transcript',
          'person', 'dd000000-0000-0000-0000-000000000001')
  RETURNING id INTO started;

  -- Somebody starts one of them.
  PERFORM work_move(started, 'in_progress', NULL, NULL);

  SELECT * INTO res FROM work_rollback_batch(b, 'transcript misattributed');

  PERFORM pg_temp.ok('the untouched task was reversed',
    (SELECT status FROM tasks WHERE id = untouched) = 'cancelled');
  PERFORM pg_temp.ok('the started task was left alone',
    (SELECT status FROM tasks WHERE id = started) = 'in_progress');
  PERFORM pg_temp.ok('and it is named in the result, not silently skipped',
    res.kept = 1 AND array_length(res.kept_refs, 1) = 1);
  PERFORM pg_temp.ok('one task was cancelled', res.cancelled = 1);

  -- Reversing twice is refused rather than quietly doing nothing.
  hit := FALSE;
  BEGIN
    PERFORM work_rollback_batch(b, NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a batch cannot be reversed twice', hit);
END $$;

-- =============================================================
-- 7. Saved views are rows, and the built in ones are among them
-- =============================================================
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO n FROM task_views WHERE is_system;
  PERFORM pg_temp.ok('the views that ship are rows anybody can read', n >= 12);

  PERFORM pg_temp.ok('every one of them has a filter and a layout',
    NOT EXISTS (SELECT 1 FROM task_views WHERE filter IS NULL OR layout IS NULL));

  -- A system view has no owner, which is what stops somebody deleting
  -- the navigation out from under everybody else.
  PERFORM pg_temp.ok('a system view belongs to nobody',
    NOT EXISTS (SELECT 1 FROM task_views WHERE is_system AND owner_id IS NOT NULL));
END $$;

-- =============================================================
-- 8. The write paths the screen actually uses
--
-- Sections 1 to 7 prove the workflow. This proves the doors into it:
-- raising work, giving it to somebody, moving a date, editing the
-- ordinary fields, saying something about it, and keeping a view.
--
-- Each of these has a route in app/api/work, and each route is a thin
-- wrapper. What decides the answer is here, so this is where it is
-- worth asserting: a route can be rewritten, and the rule should not
-- move when it is.
-- =============================================================
DO $$
DECLARE
  mine UUID; theirs UUID; hit BOOLEAN; t tasks; v UUID; c UUID;
  sl_id UUID; stc_id UUID; eng UUID;
BEGIN
  SELECT id INTO sl_id FROM entities WHERE code = 'stcsl';
  SELECT id INTO stc_id   FROM entities WHERE code = 'stc';
  SELECT id INTO eng FROM departments ORDER BY name LIMIT 1;

  -- ---- raising work for yourself ----
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id)
  VALUES ('Read the new MOT paperwork', 'dd000000-0000-0000-0000-000000000002',
          'person', 'dd000000-0000-0000-0000-000000000002')
  RETURNING id INTO mine;
  PERFORM pg_temp.ok('anybody with work.create can raise their own work', mine IS NOT NULL);

  -- The ref comes from a trigger. A screen that guessed at one would be
  -- guessing at the thing people quote to each other.
  PERFORM pg_temp.ok('it is given a reference nobody had to supply',
    (SELECT ref FROM tasks WHERE id = mine) IS NOT NULL);

  -- And a company, stamped from who raised it.
  PERFORM pg_temp.ok('and the company it belongs to, without being asked',
    (SELECT owning_entity_id FROM tasks WHERE id = mine) = sl_id);

  -- ---- raising work FOR SOMEBODY ELSE, without the permission ----
  hit := FALSE;
  BEGIN
    INSERT INTO tasks (title, created_by, assignee_kind, assignee_id)
    VALUES ('Somebody else can do this', 'dd000000-0000-0000-0000-000000000002',
            'person', 'dd000000-0000-0000-0000-000000000003');
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('a sales user cannot put work on a colleague', hit);

  -- ---- nor on a department ----
  hit := FALSE;
  BEGIN
    INSERT INTO tasks (title, created_by, assignee_kind, assignee_dept_id)
    VALUES ('The workshop can pick this up', 'dd000000-0000-0000-0000-000000000002',
            'department', eng);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('nor on a whole department', hit);

  -- ---- the director can do both ----
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO tasks (title, created_by, assignee_kind, assignee_id,
                     delegated_by, delegated_at, due_at)
  VALUES ('Sign the fleet pricing pack', 'dd000000-0000-0000-0000-000000000001',
          'person', 'dd000000-0000-0000-0000-000000000002',
          'dd000000-0000-0000-0000-000000000001', NOW(), NOW() + INTERVAL '7 days')
  RETURNING id INTO theirs;
  PERFORM pg_temp.ok('a director can put work on somebody at the other company',
    theirs IS NOT NULL);

  -- ---- editing the ordinary fields ----
  UPDATE tasks SET priority = 'p0', description = 'Counsel has the redline.'
   WHERE id = theirs;
  PERFORM pg_temp.ok('priority and detail are ordinary columns and write directly',
    (SELECT priority FROM tasks WHERE id = theirs) = 'p0');

  -- ---- but not the gated ones, even for a director ----
  hit := FALSE;
  BEGIN
    UPDATE tasks SET assignee_id = 'dd000000-0000-0000-0000-000000000003' WHERE id = theirs;
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('the assignee column still refuses a direct write', hit);

  -- ---- giving it to somebody, through the function ----
  t := work_assign(theirs, 'person', 'dd000000-0000-0000-0000-000000000003', NULL, NULL, 'swapping');
  PERFORM pg_temp.ok('work_assign is the way through, and it moves the work',
    t.assignee_id = 'dd000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok('and it is written down',
    EXISTS (SELECT 1 FROM task_field_history
             WHERE task_id = theirs AND field = 'assignee'));

  -- ---- assigning to a department ----
  t := work_assign(theirs, 'department', NULL, eng, NULL, NULL);
  PERFORM pg_temp.ok('a department can hold work with nobody on it yet',
    t.assignee_kind = 'department' AND t.assignee_dept_id = eng
    AND t.assignee_id IS NULL);

  -- ---- moving a date ----
  t := work_set_due(theirs, NOW() + INTERVAL '21 days', 'counsel needs longer');
  PERFORM pg_temp.ok('the delegator can move their own date',
    t.due_at > NOW() + INTERVAL '20 days');

  -- The first date is kept, so "this has moved twice" is answerable.
  PERFORM pg_temp.ok('and the date it was first given is still there',
    (SELECT original_due_at FROM tasks WHERE id = theirs) IS NOT NULL);

  -- ---- the person it was given to cannot move it ----
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  hit := FALSE;
  BEGIN
    PERFORM work_set_due(theirs, NOW() + INTERVAL '60 days', NULL);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('somebody given the work cannot move the date themselves', hit);

  -- ---- saying something about it ----
  -- The director raised it and delegated it, so they can reach it
  -- whatever it is currently assigned to.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO task_comments (task_id, author_id, body)
  VALUES (theirs, 'dd000000-0000-0000-0000-000000000001', 'Counsel came back Thursday.')
  RETURNING id INTO c;
  PERFORM pg_temp.ok('somebody who can reach the work can say something about it',
    c IS NOT NULL);

  /* ---- and somebody who cannot reach it, cannot ----

     This is the assertion worth having. The work has just been moved
     off this person onto a department they are not in, so they are no
     longer involved. A comment must not be the hole that keeps the
     record readable. */
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000004');
  UPDATE tasks SET classification = 'restricted' WHERE id = theirs;

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok('somebody the work was taken off cannot read it any more',
    NOT EXISTS (SELECT 1 FROM tasks WHERE id = theirs));
  PERFORM pg_temp.ok('and a comment is never more visible than the work it is on',
    NOT EXISTS (SELECT 1 FROM task_comments WHERE id = c));
  hit := FALSE;
  BEGIN
    INSERT INTO task_comments (task_id, author_id, body)
    VALUES (theirs, 'dd000000-0000-0000-0000-000000000003', 'Still here though.');
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('nor can they write one onto work they cannot see', hit);

  -- ---- keeping a view ----
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  INSERT INTO task_views (name, owner_id, is_system, layout, group_by, sort, filter, fields, position)
  VALUES ('Everything on me this week', 'dd000000-0000-0000-0000-000000000002', FALSE,
          'board', 'status',
          '[{"field":"due_at","dir":"asc"}]'::JSONB,
          '{"all":[{"field":"assignee","op":"is","value":"@me"}]}'::JSONB,
          '{}'::JSONB, 900)
  RETURNING id INTO v;
  PERFORM pg_temp.ok('anybody with work.views can keep one of their own', v IS NOT NULL);

  -- Their own view, not everybody's.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok('and it is theirs alone until they share it',
    NOT EXISTS (SELECT 1 FROM task_views WHERE id = v));

  -- ---- a view cannot be smuggled in as a system one ----
  hit := FALSE;
  BEGIN
    INSERT INTO task_views (name, owner_id, is_system, layout, group_by, sort, filter, fields, position)
    VALUES ('Mine, but for everybody', NULL, TRUE, 'list', 'status',
            '[]'::JSONB, '{"all":[]}'::JSONB, '{}'::JSONB, 910);
  EXCEPTION WHEN OTHERS THEN hit := TRUE;
  END;
  PERFORM pg_temp.ok('putting one in the rail for everybody is a separate permission', hit);
END $$;

ROLLBACK;
