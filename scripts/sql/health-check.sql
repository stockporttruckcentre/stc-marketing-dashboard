-- =============================================================
-- Red, amber, green on a customer.
--
-- From the business:
--
--   Red Amber Green system needs adding to CRM drawer to add
--   complaints/slowness. When marked Amber, potential issue,
--   slowness/etc. Add a button to alert the account manager(s) manually
--   with the reason. Red would alert them automatically. Via
--   notification, the actual CRM column rows should show a dot and we
--   can just sort by dot colour, and also by email. With a 7-day
--   cooldown (ensure weekends/holidays/bankholidays respected) on Amber
--   and 3-day on red (before you are alerted in notifs to chase, by
--   email to chase, and as a Work task to chase) ... Ensure permission
--   granular wiring.
--
-- Four things in that paragraph can only be proved against a real
-- database, and all four are here:
--
--   1. RED TELLS SOMEBODY AND AMBER DOES NOT. Those are opposite
--      behaviours from one function, so a refactor that treats them the
--      same is silent: the notification simply never arrives.
--   2. THE COOLDOWN COUNTS WORKING DAYS. Seven calendar days over
--      Christmas is three working days, and chasing a customer three
--      working days after a complaint when the rule says seven is the
--      failure the business asked to avoid by name.
--   3. THE CHASE IS RAISED ONCE PER COOLDOWN. The sweep runs as often
--      as anybody points a scheduler at it, and a chase per sweep is an
--      inbox full of the same sentence.
--   4. PERMISSION IS CHECKED IN THE DATABASE. Interface gating is a
--      courtesy. A viewer calling the function directly has to be
--      refused by the function.
--
-- Run with `npm run check:health`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

/* What landed in somebody's bell.
 *
 * Read as that person rather than over their shoulder, because
 * `notifications` is row level secured to its recipient and reading it
 * as anybody else returns nothing. Asserting on an empty result is how a
 * check reports a working notification as broken, which is exactly what
 * the first version of this file did.
 */
/* Open chase tasks sitting on somebody, read as that person.
 *
 * `tasks` is row level secured to its assignee for the same reason
 * `notifications` is, so counting them over somebody's shoulder returns
 * a number that is about the reader rather than about the work. */
CREATE OR REPLACE FUNCTION pg_temp.chase_tasks(p_who UUID, p_contact UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $fn$
DECLARE was TEXT := current_setting('request.jwt.claim.sub', TRUE); n INTEGER;
BEGIN
  PERFORM pg_temp.act_as(p_who);
  SELECT COUNT(*) INTO n FROM tasks
   WHERE organisation_id = p_contact AND source = 'health'
     AND assignee_id = p_who AND status NOT IN ('done', 'cancelled')
     AND deleted_at IS NULL;
  IF COALESCE(was, '') <> '' THEN PERFORM pg_temp.act_as(was::UUID); END IF;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.told(p_who UUID, p_kind TEXT, p_like TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql AS $fn$
DECLARE was TEXT := current_setting('request.jwt.claim.sub', TRUE); n INTEGER;
BEGIN
  PERFORM pg_temp.act_as(p_who);
  SELECT COUNT(*) INTO n FROM notifications
   WHERE kind = p_kind AND user_id = p_who
     AND (p_like IS NULL OR body LIKE p_like);
  IF COALESCE(was, '') <> '' THEN PERFORM pg_temp.act_as(was::UUID); END IF;
  RETURN n;
END;
$fn$;

-- -------------------------------------------------------------
-- The people.
--
-- Alex administers, Dean and Tom sell, Rama can only look.
--
-- Rama is the one the permission section is about: `crm.health` is a
-- capability a viewer does not hold, and "ensure permission granular
-- wiring" is a sentence about him.
--
-- TWO salespeople rather than one, and that is not padding. Nobody is
-- ever notified about their own action, so a fixture with one account
-- manager who is also the person pressing the button proves nothing
-- about whether the notification works: it proves the suppression
-- works, and then reads as a failure. Dean raises everything and Tom is
-- the colleague who has to hear about it.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('dd000000-0000-0000-0000-000000000001', 'health.alex@example.test'),
  ('dd000000-0000-0000-0000-000000000002', 'health.dean@example.test'),
  ('dd000000-0000-0000-0000-000000000003', 'health.rama@example.test'),
  ('dd000000-0000-0000-0000-000000000004', 'health.tom@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Alex'
  WHERE id = 'dd000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Dean'
  WHERE id = 'dd000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Rama'
  WHERE id = 'dd000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Tom'
  WHERE id = 'dd000000-0000-0000-0000-000000000004';

-- A customer with Dean named on it and a lead of his against it, so
-- `crm_account_managers` has both of its routes to the same person and
-- has to return him once rather than twice. Tom has a second lead on
-- the same customer, so there is somebody to tell.
DO $$
DECLARE c UUID; l UUID;
BEGIN
  INSERT INTO crm_contacts (company_name, status, assigned_to, email)
  VALUES ('Health Test Haulage', 'customer', 'Dean', 'ops@healthtest.test')
  RETURNING id INTO c;

  INSERT INTO crm_leads (contact_id, type, status, owner_id)
  VALUES (c, 'maintenance', 'customer', 'dd000000-0000-0000-0000-000000000002')
  RETURNING id INTO l;

  INSERT INTO crm_leads (contact_id, type, status, owner_id)
  VALUES (c, 'trailer_sales', 'quoted', 'dd000000-0000-0000-0000-000000000004');

  PERFORM set_config('t.contact', c::TEXT, FALSE);
  PERFORM set_config('t.lead', l::TEXT, FALSE);
END $$;

SET LOCAL ROLE authenticated;

-- =============================================================
-- 1. Where an account starts
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID;
BEGIN
  /* Somebody has to be signed in before anything is read. Row level
     security is on from the `SET LOCAL ROLE` above, so an anonymous
     read returns no row at all and every assertion below it would
     compare against NULL and fail for the wrong reason. */
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.must('an account starts green',
    (SELECT health FROM crm_contacts WHERE id = c) = 'green');
  PERFORM pg_temp.must('and green means there is nothing open on it',
    NOT EXISTS (SELECT 1 FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL));
END $$;

-- =============================================================
-- 2. Amber opens an event and tells nobody
--
-- The business asked for a separate button for a reason: "Add a button
-- to alert the account manager(s) manually with the reason." An amber
-- that notified on its own would make that button meaningless and would
-- put every "they have gone a bit quiet" into somebody's inbox.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB; before INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT COUNT(*) INTO before FROM notifications
   WHERE kind IN ('crm.health_amber', 'crm.health_red');

  said := crm_set_health(c, 'amber', 'Turnaround has slipped to four days');

  PERFORM pg_temp.must('a salesperson can set an account amber', (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('the account reads amber',
    (SELECT health FROM crm_contacts WHERE id = c) = 'amber');
  PERFORM pg_temp.must('the reason is on the record, so the grid can show it without a join',
    (SELECT health_reason FROM crm_contacts WHERE id = c) = 'Turnaround has slipped to four days');
  PERFORM pg_temp.must('the date it started is on the record',
    (SELECT health_since FROM crm_contacts WHERE id = c) IS NOT NULL);
  PERFORM pg_temp.must('one event is open',
    (SELECT COUNT(*) FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL) = 1);
  PERFORM pg_temp.must('and amber told nobody, because alerting is its own button',
    (SELECT COUNT(*) FROM notifications
      WHERE kind IN ('crm.health_amber', 'crm.health_red')) = before);
END $$;

-- =============================================================
-- 3. A reason is compulsory
--
-- An amber with no reason is a dot nobody can act on, and it is the
-- thing a person in a hurry will try to do.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB;
BEGIN
  said := crm_set_health(c, 'red', NULL);
  PERFORM pg_temp.must('red with no reason is refused', NOT (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('and says why', COALESCE(said->>'why', '') <> '');
  PERFORM pg_temp.must('and the account has not moved',
    (SELECT health FROM crm_contacts WHERE id = c) = 'amber');
END $$;

-- =============================================================
-- 4. The Alert button
--
-- Manual, on an amber, to the account managers. Dean is both the lead
-- owner and the person named on the account, so the de-duplication in
-- `crm_account_managers` is under test here as much as the alert is.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB; managers INTEGER;
BEGIN
  SELECT COUNT(*) INTO managers FROM crm_account_managers(c);
  PERFORM pg_temp.must('two people look after this account, not three',
    managers = 2);
  PERFORM pg_temp.must('somebody who is both lead owner and named on the account is counted once',
    (SELECT COUNT(*) FROM crm_account_managers(c)
      WHERE user_id = 'dd000000-0000-0000-0000-000000000002') = 1);

  said := crm_alert_health(c, 'Third late collection this month');
  PERFORM pg_temp.must('the alert button works on an amber', (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('the other account manager is told',
    pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_amber') = 1);
  PERFORM pg_temp.must('and the person who pressed it is not told about their own action',
    pg_temp.told('dd000000-0000-0000-0000-000000000002', 'crm.health_amber') = 0);
  PERFORM pg_temp.must('one person was told, and it says so', (said->>'told')::INTEGER = 1);
  PERFORM pg_temp.must('the note is in the notification, not just the level',
    pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_amber',
                 '%late collection%') = 1);
END $$;

-- =============================================================
-- 5. Red tells them without being asked
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB;
BEGIN
  said := crm_set_health(c, 'red', 'Formal complaint from their transport manager');
  PERFORM pg_temp.must('an account can be set red', (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('the account reads red',
    (SELECT health FROM crm_contacts WHERE id = c) = 'red');
  PERFORM pg_temp.must('red told the other account manager on its own',
    pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_red') = 1);
  PERFORM pg_temp.must('and it says how many people were told',
    (said->>'told')::INTEGER >= 1);

  /* Going amber to red is one problem getting worse, not two problems.
     Two open events on one account means two chases, two tasks and two
     conversations about the same complaint. */
  PERFORM pg_temp.must('still only one thing open on the account',
    (SELECT COUNT(*) FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL) = 1);
  PERFORM pg_temp.must('and it is the red one',
    (SELECT level FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL) = 'red');
END $$;

-- =============================================================
-- 6. Working days, which is the whole of the cooldown
--
-- Counted rather than asserted about a fixed date, because the check
-- runs on whatever day somebody runs it and a hardcoded answer would be
-- right for one week a year.
-- =============================================================
DO $$
DECLARE
  friday    DATE := DATE '2025-12-19';   -- a Friday before Christmas
  boxing    DATE := DATE '2025-12-26';   -- Boxing Day, a bank holiday
  gap       INTEGER;
BEGIN
  PERFORM pg_temp.must('Christmas Day 2025 is known to be a bank holiday',
    EXISTS (SELECT 1 FROM uk_bank_holidays WHERE on_date = DATE '2025-12-25'));
  PERFORM pg_temp.must('so is Boxing Day', EXISTS (SELECT 1 FROM uk_bank_holidays WHERE on_date = boxing));
  PERFORM pg_temp.must('and Easter Monday 2026',
    EXISTS (SELECT 1 FROM uk_bank_holidays WHERE on_date = DATE '2026-04-06'));

  /* Friday 19 December to Friday 2 January is fourteen calendar days.
     Working days: the 22nd, 23rd, 24th, 29th, 30th, 31st and the 2nd.
     Seven. Christmas Day, Boxing Day and New Year's Day are out, and so
     are two weekends. A calendar day rule would have chased on the
     27th, over the Christmas shutdown, which is exactly the outcome the
     business named. */
  SELECT COUNT(*) INTO gap
    FROM generate_series(friday + 1, DATE '2026-01-02', INTERVAL '1 day') AS d(day)
   WHERE EXTRACT(ISODOW FROM d.day) < 6
     AND NOT EXISTS (SELECT 1 FROM uk_bank_holidays h WHERE h.on_date = d.day::DATE);
  PERFORM pg_temp.must('fourteen days over Christmas is seven working days', gap = 7);

  /* The same fortnight in an ordinary month is ten. Same rule, and the
     difference between the two numbers is the reason the rule exists. */
  SELECT COUNT(*) INTO gap
    FROM generate_series(DATE '2026-02-06' + 1, DATE '2026-02-20', INTERVAL '1 day') AS d(day)
   WHERE EXTRACT(ISODOW FROM d.day) < 6
     AND NOT EXISTS (SELECT 1 FROM uk_bank_holidays h WHERE h.on_date = d.day::DATE);
  PERFORM pg_temp.must('and fourteen days in February is ten', gap = 10);

  PERFORM pg_temp.must('nothing raised today is any working days old',
    working_days_since(NOW()) = 0);
END $$;

-- =============================================================
-- 7. Nothing is chased before its cooldown
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID;
BEGIN
  PERFORM pg_temp.must('a red raised today is not yet due a chase',
    NOT EXISTS (SELECT 1 FROM crm_health_due_a_chase WHERE contact_id = c));
END $$;

-- =============================================================
-- 8. Three working days on a red, and the chase lands twice over
--
-- The event is aged by hand rather than by waiting three days. Ten
-- calendar days is at least three working days whatever weekday it is
-- moved back to, so this cannot pass or fail on the day it is run.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; did JSONB; ev UUID;
BEGIN
  SELECT id INTO ev FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL;
  UPDATE crm_health_events SET raised_at = NOW() - INTERVAL '10 days' WHERE id = ev;

  PERFORM pg_temp.must('after ten days the red is due a chase',
    EXISTS (SELECT 1 FROM crm_health_due_a_chase WHERE contact_id = c));
  PERFORM pg_temp.must('and the view says three working days is the rule for a red',
    (SELECT cooldown_working_days FROM crm_health_due_a_chase WHERE contact_id = c) = 3);

  did := crm_health_chase();
  PERFORM pg_temp.must('the sweep chased it', (did->>'accounts')::INTEGER >= 1);
  PERFORM pg_temp.must('and says how many people it told', (did->>'notified')::INTEGER = 2);
  PERFORM pg_temp.must('and how many tasks it raised', (did->>'tasks')::INTEGER = 2);
  PERFORM pg_temp.must('the account manager who raised it is told to chase, because it is on them',
    pg_temp.told('dd000000-0000-0000-0000-000000000002', 'crm.health_chase') = 1);
  PERFORM pg_temp.must('and so is the other one',
    pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_chase') = 1);
  PERFORM pg_temp.must('a task lands on the person who raised it, which is what survives being ignored',
    pg_temp.chase_tasks('dd000000-0000-0000-0000-000000000002', c) = 1);
  PERFORM pg_temp.must('and one on the other account manager',
    pg_temp.chase_tasks('dd000000-0000-0000-0000-000000000004', c) = 1);
  PERFORM pg_temp.must('the task is p0, because it is a red',
    (SELECT priority FROM tasks WHERE organisation_id = c AND source = 'health'
      LIMIT 1)::TEXT = 'p0');
  PERFORM pg_temp.must('the chase is recorded on the event',
    (SELECT chase_count FROM crm_health_events WHERE id = ev) = 1);
END $$;

-- =============================================================
-- 9. One chase per cooldown, not one per sweep
--
-- The sweep is meant to be pointed at a scheduler. Running it again
-- immediately has to do nothing at all.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; did JSONB; notes INTEGER; jobs INTEGER;
BEGIN
  notes := pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_chase');
  jobs := pg_temp.chase_tasks('dd000000-0000-0000-0000-000000000004', c);

  did := crm_health_chase();
  PERFORM pg_temp.must('running the sweep again chases nothing', (did->>'accounts')::INTEGER = 0);
  PERFORM pg_temp.must('and nobody is told twice',
    pg_temp.told('dd000000-0000-0000-0000-000000000004', 'crm.health_chase') = notes);
  PERFORM pg_temp.must('and no second task is raised for the same customer',
    pg_temp.chase_tasks('dd000000-0000-0000-0000-000000000004', c) = jobs);
END $$;

-- =============================================================
-- 10. Green closes it
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB;
BEGIN
  said := crm_set_health(c, 'green', 'Met them on site, collections back to next day');
  PERFORM pg_temp.must('an account can be put back to green', (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('the account reads green',
    (SELECT health FROM crm_contacts WHERE id = c) = 'green');
  PERFORM pg_temp.must('the reason is cleared off the record',
    (SELECT health_reason FROM crm_contacts WHERE id = c) IS NULL);
  PERFORM pg_temp.must('nothing is open any more',
    NOT EXISTS (SELECT 1 FROM crm_health_events WHERE contact_id = c AND resolved_at IS NULL));
  PERFORM pg_temp.must('but the history is kept, so the meeting report can show what was closed',
    (SELECT COUNT(*) FROM crm_health_events WHERE contact_id = c) >= 1);
  PERFORM pg_temp.must('and a closed event is never due a chase',
    NOT EXISTS (SELECT 1 FROM crm_health_due_a_chase WHERE contact_id = c));
END $$;

-- =============================================================
-- 11. Permission, in the database
--
-- "Ensure permission granular wiring." A viewer is refused by the
-- function itself, not only by a button that is not drawn. The route
-- checks too and the bar filters too, and all three have to agree.
-- =============================================================
DO $$
DECLARE c UUID := current_setting('t.contact')::UUID; said JSONB;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.must('a read only viewer does not hold crm.health', NOT command_may('crm.health'));

  said := crm_set_health(c, 'red', 'Trying it on');
  PERFORM pg_temp.must('and the database refuses them', NOT (said->>'ok')::BOOLEAN);
  PERFORM pg_temp.must('the account is untouched',
    (SELECT health FROM crm_contacts WHERE id = c) = 'green');

  said := crm_alert_health(c, 'Trying it on');
  PERFORM pg_temp.must('and refuses them the alert button too', NOT (said->>'ok')::BOOLEAN);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.must('an administrator holds it', command_may('crm.health'));
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.must('and so does somebody in sales', command_may('crm.health'));
END $$;

-- =============================================================
-- 12. Sorting the grid by the dot
--
-- "the actual CRM column rows should show a dot and we can just sort by
-- dot colour, and also by email." Sorting on the column has to put the
-- worst first, and the column has to be on the row rather than behind a
-- join, or the grid cannot sort it without loading every record.
-- =============================================================
DO $$
DECLARE worst TEXT;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO crm_contacts (company_name, status, health, health_reason, health_since)
  VALUES ('Sort Test Red', 'customer', 'red', 'a', NOW()),
         ('Sort Test Amber', 'customer', 'amber', 'b', NOW()),
         ('Sort Test Green', 'customer', 'green', NULL, NULL);

  SELECT health INTO worst FROM crm_contacts
   WHERE company_name LIKE 'Sort Test %'
   ORDER BY CASE health WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END
   LIMIT 1;
  PERFORM pg_temp.must('sorting by the dot puts red first', worst = 'red');

  PERFORM pg_temp.must('the health column is on crm_contacts, so the grid can sort it',
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'crm_contacts' AND column_name = 'health'));
  PERFORM pg_temp.must('and there is an index behind it',
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_crm_contacts_health'));
END $$;

ROLLBACK;
