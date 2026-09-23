-- =============================================================
-- A bundle remembers what it swallowed.
--
-- From the business, with three screenshots an hour apart:
--
--   2 tasks are past their date [...] 3 tasks are past their date [...]
--   4 tasks are past their date
--   notifs need looking at, same ones duplicating over and over.
--
-- Run with `npm run check:notify-bundle`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  who UUID := 'bb551111-0000-0000-0000-000000000001';
  t1 UUID; t2 UUID; t3 UUID;
  n INT; said TEXT; card UUID;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (who, 'nb@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (who, 'nb@stc.example', 'Nora Notice', 'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM notifications WHERE user_id = who;

  -- Three tasks, all overdue, all on one person.
  INSERT INTO tasks (title, status, assignee_kind, assignee_id, created_by, due_at)
  VALUES ('Follow up Peak Platforms Ltd', 'ready', 'person', who, who, NOW() - INTERVAL '5 days')
  RETURNING id INTO t1;
  INSERT INTO tasks (title, status, assignee_kind, assignee_id, created_by, due_at)
  VALUES ('Follow up Gee Transport PFA', 'ready', 'person', who, who, NOW() - INTERVAL '2 days')
  RETURNING id INTO t2;
  INSERT INTO tasks (title, status, assignee_kind, assignee_id, created_by, due_at)
  VALUES ('Follow up Global Remould', 'ready', 'person', who, who, NOW() - INTERVAL '1 day')
  RETURNING id INTO t3;

  -- ---------------------------------------------------------
  -- 1. THE FIRST SWEEP SAYS IT ONCE, AS ONE CARD OF THREE.
  -- ---------------------------------------------------------
  PERFORM notification_sweep(TRUE);

  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND kind = 'task.overdue';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the first sweep wrote % cards, wanted 1', n;
  END IF;

  SELECT title, id INTO said, card FROM notifications
   WHERE user_id = who AND kind = 'task.overdue';
  IF said <> '3 tasks are past their date' THEN
    RAISE EXCEPTION 'the card reads "%", not "3 tasks are past their date"', said;
  END IF;

  -- And it remembers all three, not just the one whose key is in the
  -- column. This is the line the whole fault turns on.
  /* COALESCE, not a bare comparison. Without a `dedupe_keys` list the
     length is NULL, `NULL <> 3` is NULL, and the IF falls straight
     through: the assertion would have passed against the very fault it
     is here to catch. */
  SELECT COALESCE(jsonb_array_length(payload -> 'dedupe_keys'), 0) INTO n
    FROM notifications WHERE id = card;
  IF n <> 3 THEN
    RAISE EXCEPTION 'the card remembers % of the three tasks it swallowed', n;
  END IF;

  -- ---------------------------------------------------------
  -- 2. SWEEPING AGAIN SAYS NOTHING.
  -- ---------------------------------------------------------
  PERFORM notification_sweep(TRUE);
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND kind = 'task.overdue';
  IF n <> 1 THEN
    RAISE EXCEPTION 'a second sweep made % cards about the same three tasks', n;
  END IF;

  -- ---------------------------------------------------------
  -- 3. AND READING IT DOES NOT START IT OFF AGAIN.
  --
  --    This is exactly what was reported: seven cards in one day,
  --    reading 8, 7, 6, 89, 4, 3 and 2, all about the same handful.
  --    Every one of them was sent after the last was read.
  -- ---------------------------------------------------------
  UPDATE notifications SET read_at = NOW() WHERE id = card;

  PERFORM notification_sweep(TRUE);
  PERFORM notification_sweep(TRUE);
  PERFORM notification_sweep(TRUE);

  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND kind = 'task.overdue';
  IF n <> 1 THEN
    RAISE EXCEPTION 'reading the card brought it back: % cards about the same three tasks', n;
  END IF;

  -- ---------------------------------------------------------
  -- 4. A GENUINELY NEW OVERDUE TASK IS STILL SAID.
  --
  --    The fix must not turn into silence. One card was read, so a
  --    fourth task gets a card of its own rather than joining it.
  -- ---------------------------------------------------------
  INSERT INTO tasks (title, status, assignee_kind, assignee_id, created_by, due_at)
  VALUES ('Follow up somebody new', 'ready', 'person', who, who, NOW() - INTERVAL '3 days');

  PERFORM notification_sweep(TRUE);
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND kind = 'task.overdue';
  IF n <> 2 THEN
    RAISE EXCEPTION 'a new overdue task produced % cards, wanted a second one', n;
  END IF;

  -- ---------------------------------------------------------
  -- 5. AND A TASK WHOSE DATE MOVES OUT STOPS BEING MENTIONED.
  --
  --    The fix must not turn into permanent silence. A card is only
  --    withheld because the thing behind it has already been said, so
  --    a task that is no longer overdue produces nothing at all.
  -- ---------------------------------------------------------
  /* The column is guarded: a due date moves through `work_set_due`,
     which asks for the capability and records what it was. The trigger
     is stood down for the fixture rather than the rule being argued
     with, because the rule is right. */
  ALTER TABLE tasks DISABLE TRIGGER USER;
  UPDATE tasks SET due_at = NOW() + INTERVAL '30 days' WHERE assignee_id = who;
  ALTER TABLE tasks ENABLE TRIGGER USER;
  DELETE FROM notifications WHERE user_id = who;
  PERFORM notification_sweep(TRUE);
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND kind IN ('task.overdue', 'task.due');
  IF n <> 0 THEN
    RAISE EXCEPTION 'a task due in a month was called overdue';
  END IF;

  RAISE NOTICE 'a bundle remembers every task it swallowed, so reading it does not bring it back';
END $check$;

ROLLBACK;
