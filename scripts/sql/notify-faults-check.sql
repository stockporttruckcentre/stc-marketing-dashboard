-- =============================================================
-- A sweep that cannot roll itself back, and a count that cannot
-- inflate.
--
-- From the audit:
--
--   The monthly target branch for someone at 80-99% of target
--   attempts an invalid interval-to-date cast. If that branch is
--   reached, its exception rolls back the sweep, including earlier
--   reminder writes. The bell catches the error and keeps opening,
--   concealing the failure.
--
--   Notification grouping happens before duplicate prevention.
--   Repeated sweeps within the grouping window can count the same
--   unread task again, making one task become "2 tasks", then
--   "3 tasks".
--
-- Run with `npm run check:notify-faults`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  who UUID := 'b0b00000-0000-0000-0000-000000000001';
  a UUID; b UUID; c UUID; n INT; days INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (who, 'nf@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (who, 'nf@stc.example', 'Nora Notify', 'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id=who;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', who::TEXT, TRUE);

  DELETE FROM notifications WHERE user_id = who;

  -- ---------------------------------------------------------
  -- 1. THE CAST. The exact expression the sweep builds, which used to
  --    raise "cannot cast type interval to date" and take the whole
  --    sweep down with it.
  -- ---------------------------------------------------------
  SELECT (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE - NOW()::DATE INTO days;
  IF days IS NULL OR days < 0 OR days > 31 THEN
    RAISE EXCEPTION 'days left in the month came out as %', days;
  END IF;

  -- And the shape that was there before must still be refused, or this
  -- check would pass on a database where nothing was fixed.
  BEGIN
    EXECUTE 'SELECT (date_trunc(''month'', NOW()) + INTERVAL ''1 month'' - NOW())::DATE';
    RAISE EXCEPTION 'casting an interval to a date succeeded, so this check proves nothing';
  EXCEPTION WHEN cannot_coerce OR datatype_mismatch THEN NULL;
  END;

  -- ---------------------------------------------------------
  -- 2. A SWEEP RUNS WITHOUT TAKING ITSELF DOWN.
  -- ---------------------------------------------------------
  PERFORM notification_sweep(TRUE);
  PERFORM notification_sweep(TRUE);

  -- ---------------------------------------------------------
  -- 3. THE COUNT. The same notification, same group key, same dedupe
  --    key, sent three times inside the bundle window, is ONE thing
  --    saying one, because nobody gained a task.
  -- ---------------------------------------------------------
  a := notify(who, 'crm.lead_assigned', 'A task needs you', 'Ring Dawson',
              '/dashboard/work', NULL, 'task', NULL, '{}'::JSONB,
              'tasks:' || who::TEXT, 'task-reminder-probe');
  b := notify(who, 'crm.lead_assigned', 'A task needs you', 'Ring Dawson',
              '/dashboard/work', NULL, 'task', NULL, '{}'::JSONB,
              'tasks:' || who::TEXT, 'task-reminder-probe');
  c := notify(who, 'crm.lead_assigned', 'A task needs you', 'Ring Dawson',
              '/dashboard/work', NULL, 'task', NULL, '{}'::JSONB,
              'tasks:' || who::TEXT, 'task-reminder-probe');

  IF a IS NULL THEN RAISE EXCEPTION 'the first notification was not written at all'; END IF;
  IF b IS DISTINCT FROM a OR c IS DISTINCT FROM a THEN
    RAISE EXCEPTION 'the same dedupe key produced more than one notification';
  END IF;

  SELECT item_count INTO n FROM notifications WHERE id = a;
  IF n <> 1 THEN
    RAISE EXCEPTION 'one lead assignment is being counted as %, which is the inflation', n;
  END IF;

  SELECT count(*) INTO n FROM notifications
   WHERE user_id = who AND dedupe_key = 'task-reminder-probe';
  IF n <> 1 THEN RAISE EXCEPTION '% rows for one dedupe key', n; END IF;

  -- ---------------------------------------------------------
  -- 4. AND BUNCHING STILL WORKS. Two DIFFERENT things under one group
  --    key are still one notification saying two, or the fix above
  --    would have been a cure worse than the illness.
  -- ---------------------------------------------------------
  a := notify(who, 'crm.lead_assigned', 'Ring Booker', NULL,
              '/dashboard/work', NULL, 'task', NULL, '{}'::JSONB,
              'bundle:' || who::TEXT, 'probe-one');
  b := notify(who, 'crm.lead_assigned', 'Ring Dawson', NULL,
              '/dashboard/work', NULL, 'task', NULL, '{}'::JSONB,
              'bundle:' || who::TEXT, 'probe-two');
  IF b IS DISTINCT FROM a THEN
    RAISE EXCEPTION 'two different things under one group key no longer bunch';
  END IF;
  SELECT item_count INTO n FROM notifications WHERE id = a;
  IF n <> 2 THEN
    RAISE EXCEPTION 'the bunch says % and should say 2', n;
  END IF;

  RAISE NOTICE 'notify: the sweep survives, a repeat counts once, and two things still bunch';
END $check$;

ROLLBACK;
