-- =============================================================
-- The analytics window, its target, and who may see either.
--
-- `npm run check:analytics` proves the shaping in TypeScript: what a
-- verdict sentence says, how a comparison window is trimmed, which
-- customers count as won business. None of that touches a database.
--
-- Four things can only be proved against one, and all four are here:
--
--   1. BOTH READERS ARE GATED, AND GATED ALIKE. `analytics_window`
--      and `analytics_targets_by_month` are SECURITY DEFINER, which
--      means each reads with row level security switched off and
--      whatever gate it carries is the only gate there is. The second
--      shipped without one, so it answered a caller who was nobody
--      while its sibling refused the same caller. Every role holds
--      `crm.view` today, so the gap was not a colleague reading a
--      colleague's figures: it was two functions over one table
--      disagreeing about who counts as somebody.
--   2. A TARGET IS SET BY AN ADMINISTRATOR AND NOBODY ELSE. An MD who
--      can see he is behind must not be able to move the line. That is
--      the whole reason `analytics.targets` is its own capability
--      rather than `crm.edit`.
--   3. THE UPSERT IS AN UPSERT. Setting March twice leaves one row for
--      March, and setting it to nought clears it rather than recording
--      a target of nothing. A division and the group are separate
--      lines, and one must not overwrite the other.
--   4. THE INDEX GOES ON A TABLE THAT ALREADY BREAKS IT. The live
--      database had two group targets for the same month, because
--      nothing had ever stopped a second one. `CREATE UNIQUE INDEX`
--      refused, the whole migration rolled back, and the only symptom
--      anybody saw was the NEXT file saying analytics_window does not
--      exist. Building on an empty table proved nothing about that.
--   5. THE COMPARISON WINDOW IS A DIFFERENT WINDOW. Both halves come
--      out of one pass over the invoices, and a mistake there reads as
--      "flat against last quarter" on every division at once, which is
--      the sort of wrong figure nobody questions.
--
-- Run with `npm run check:analytics-sql`.
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
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role',
                     CASE WHEN p_who IS NULL THEN 'anon' ELSE 'authenticated' END, TRUE);
END;
$fn$;

/* Did that call go through, or was it refused?
 *
 * Both readers refuse by raising, so a caller who is not allowed gets
 * an exception rather than an empty result. Asserting on a row count
 * would report a refusal and an honestly empty division identically,
 * and those are opposite outcomes. */
CREATE OR REPLACE FUNCTION pg_temp.window_allowed() RETURNS BOOLEAN
LANGUAGE plpgsql AS $fn$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM analytics_window(
    DATE '2026-04-01', DATE '2026-06-30', DATE '2026-01-01', DATE '2026-03-31');
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.targets_allowed() RETURNS BOOLEAN
LANGUAGE plpgsql AS $fn$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM analytics_targets_by_month(12);
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$fn$;

-- -------------------------------------------------------------
-- The people.
--
-- Ali administers, so Ali sets targets. Molly sells: she reads the hub
-- every morning and must never be able to move the line she is
-- measured against. Ray can only look.
--
-- Both Molly and Ray hold `crm.view`, because every role does, and
-- section 1 asserts that both of them get an answer. The account that
-- must be refused is nobody at all.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('ba000000-0000-0000-0000-000000000001', 'an.ali@example.test'),
  ('ba000000-0000-0000-0000-000000000002', 'an.molly@example.test'),
  ('ba000000-0000-0000-0000-000000000003', 'an.ray@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Ali'
  WHERE id = 'ba000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Molly'
  WHERE id = 'ba000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Ray'
  WHERE id = 'ba000000-0000-0000-0000-000000000003';

DO $$
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.must('fixture: a salesperson can read the CRM', command_may('crm.view'));
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.must('fixture: a viewer can read the CRM too', command_may('crm.view'));
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.must('fixture: but a viewer cannot set a target',
                       NOT command_may('analytics.targets'));
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.must('fixture: and neither can a salesperson',
                       NOT command_may('analytics.targets'));
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.must('fixture: an administrator can',
                       command_may('analytics.targets'));
  PERFORM pg_temp.act_as(NULL);
END $$;

-- =============================================================
-- 1. Both readers are gated, and gated the same way
--
-- The pair is asserted together deliberately. One carrying a gate and
-- the other not is exactly the state this migration was written in,
-- and either function read on its own would have looked correct.
-- =============================================================
DO $$
BEGIN
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.must('nobody at all is refused the window',
                       NOT pg_temp.window_allowed());
  PERFORM pg_temp.must('nobody at all is refused the targets',
                       NOT pg_temp.targets_allowed());

  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.must('a salesperson may read the window',
                       pg_temp.window_allowed());
  PERFORM pg_temp.must('a salesperson may read the targets',
                       pg_temp.targets_allowed());

  /* A viewer gets an answer from both. Said out loud so that nobody
     later reads the two refusals above as "analytics is for admins"
     and tightens the gate onto the people who need the hub most. */
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.must('a viewer may read the window',
                       pg_temp.window_allowed());
  PERFORM pg_temp.must('a viewer may read the targets',
                       pg_temp.targets_allowed());
END $$;

/* Said in SQL rather than in prose, because the sentence "both of them
   are SECURITY DEFINER, so both of them need their own gate" is only
   true while both of them still are. If somebody makes one of them
   SECURITY INVOKER the assertions above stop meaning what they say,
   and this is the line that notices. */
DO $$
DECLARE definers INTEGER;
BEGIN
  SELECT COUNT(*) INTO definers FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.proname IN ('analytics_window', 'analytics_targets_by_month');
  PERFORM pg_temp.must('both readers still bypass row level security, which is why they gate',
                       definers = 2);

  PERFORM pg_temp.must('the writer runs as the caller, so the table policy still applies',
    NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'analytics_set_target'));
END $$;

-- =============================================================
-- 2. A target is set by an administrator and nobody else
-- =============================================================
DO $$
DECLARE said JSONB;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000002');
  said := analytics_set_target(DATE '2026-03-01', NULL, 100000);
  PERFORM pg_temp.must('a salesperson cannot set a target',
                       (said->>'ok')::BOOLEAN IS FALSE);
  PERFORM pg_temp.must('and is told why, in a sentence',
                       said->>'why' LIKE '%administrator%');

  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000003');
  said := analytics_set_target(DATE '2026-03-01', NULL, 100000);
  PERFORM pg_temp.must('a viewer cannot set a target',
                       (said->>'ok')::BOOLEAN IS FALSE);

  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');
  said := analytics_set_target(DATE '2026-03-01', NULL, 100000);
  PERFORM pg_temp.must('an administrator can', (said->>'ok')::BOOLEAN);
END $$;

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM revenue_targets
   WHERE user_id IS NULL AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('the refused attempts wrote nothing, so there is one March row', n = 1);
END $$;

-- =============================================================
-- 3. The upsert is an upsert
-- =============================================================
DO $$
DECLARE said JSONB; n INTEGER; amount NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');

  said := analytics_set_target(DATE '2026-03-01', NULL, 250000);
  PERFORM pg_temp.must('setting March again is accepted', (said->>'ok')::BOOLEAN);

  SELECT COUNT(*), MAX(target_amount) INTO n, amount FROM revenue_targets
   WHERE user_id IS NULL AND division IS NULL AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('and replaces the figure rather than adding a second March', n = 1);
  PERFORM pg_temp.must('with the new figure, not the old one', amount = 250000);

  /* Any day in March is March. The screen sends the first of the month
     and the command bar sends whatever somebody typed, and those have
     to land on the same row. */
  said := analytics_set_target(DATE '2026-03-19', NULL, 260000);
  SELECT COUNT(*) INTO n FROM revenue_targets
   WHERE user_id IS NULL AND division IS NULL AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('the nineteenth of March is March', n = 1);

  /* A division and the group are separate lines. The unique index is
     NULLS NOT DISTINCT so that the group line cannot be entered twice,
     and this is the half of that rule which must still let a division
     through. */
  said := analytics_set_target(DATE '2026-03-01', 'trailer', 90000);
  PERFORM pg_temp.must('a division target is accepted', (said->>'ok')::BOOLEAN);
  SELECT COUNT(*) INTO n FROM revenue_targets
   WHERE user_id IS NULL AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('and sits beside the group line rather than replacing it', n = 2);

  SELECT target_amount INTO amount FROM revenue_targets
   WHERE user_id IS NULL AND division IS NULL AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('the group line is untouched by it', amount = 260000);

  said := analytics_set_target(DATE '2026-03-01', 'no-such-division', 1000);
  PERFORM pg_temp.must('a division nobody has heard of is refused',
                       (said->>'ok')::BOOLEAN IS FALSE);

  /* Nought clears. A target of nothing drawn as a notch at the origin
     is a target somebody has to explain, and "we have not set one" is
     the truthful reading of an empty box. */
  said := analytics_set_target(DATE '2026-03-01', 'trailer', 0);
  PERFORM pg_temp.must('nought is accepted', (said->>'ok')::BOOLEAN);
  SELECT COUNT(*) INTO n FROM revenue_targets
   WHERE user_id IS NULL AND division = 'trailer' AND period_month = DATE '2026-03-01';
  PERFORM pg_temp.must('and clears the line rather than recording a target of nothing', n = 0);
END $$;

-- =============================================================
-- 4. A table that already breaks the rule
--
-- The state the live database was actually in. Asserted rather than
-- described, because "it worked on the test copy" is what made this
-- ship: the test copy was empty, and an empty table satisfies every
-- uniqueness rule anybody can write.
-- =============================================================
DO $$
DECLARE kept NUMERIC; aside NUMERIC; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');

  /* Two group targets for one month, an older and a newer, plus a
     division target for the same month that must survive untouched. */
  DELETE FROM revenue_targets WHERE period_month = DATE '2026-08-01';
  DROP INDEX IF EXISTS revenue_targets_one_per_month;
  INSERT INTO revenue_targets (user_id, division, period_month, target_amount, created_at) VALUES
    (NULL, NULL,      DATE '2026-08-01', 180000, NOW() - INTERVAL '40 days'),
    (NULL, NULL,      DATE '2026-08-01', 240000, NOW() - INTERVAL '2 days'),
    (NULL, 'trailer', DATE '2026-08-01',  90000, NOW() - INTERVAL '5 days');

  SELECT COUNT(*) INTO n FROM revenue_targets WHERE period_month = DATE '2026-08-01';
  PERFORM pg_temp.must('fixture: three August rows, two of them the same group month', n = 3);
END $$;

/* The migration's own de-duplication, run again over the mess above.
   Copied from 100 rather than called, because a migration is not a
   function; if the two ever diverge this assertion is what says so. */
DO $$
DECLARE moved INTEGER := 0;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
             PARTITION BY COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::UUID),
                          COALESCE(division, '*group*'), period_month
             ORDER BY created_at DESC, id DESC) AS rn
      FROM revenue_targets
  ),
  older AS (SELECT id FROM ranked WHERE rn > 1),
  kept AS (
    INSERT INTO revenue_targets_superseded
      (id, user_id, period_month, target_amount, created_at, division)
    SELECT t.id, t.user_id, t.period_month, t.target_amount, t.created_at, t.division
      FROM revenue_targets t JOIN older o ON o.id = t.id
    RETURNING 1
  )
  DELETE FROM revenue_targets t USING older o WHERE t.id = o.id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  PERFORM pg_temp.must('exactly one row is set aside, not both and not the division line', moved = 1);
END $$;

DO $$
DECLARE kept NUMERIC; aside NUMERIC; n INTEGER;
BEGIN
  SELECT target_amount INTO kept FROM revenue_targets
   WHERE division IS NULL AND period_month = DATE '2026-08-01';
  PERFORM pg_temp.must('the newest August is the one kept', kept = 240000);

  SELECT target_amount INTO aside FROM revenue_targets_superseded
   WHERE division IS NULL AND period_month = DATE '2026-08-01';
  PERFORM pg_temp.must('and the older one is kept rather than destroyed', aside = 180000);

  SELECT target_amount INTO n FROM revenue_targets
   WHERE division = 'trailer' AND period_month = DATE '2026-08-01';
  PERFORM pg_temp.must('the division line for the same month is untouched', n = 90000);

  /* And now the index goes on, which is the whole point. */
  CREATE UNIQUE INDEX revenue_targets_one_per_month
    ON revenue_targets (
      COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::UUID),
      COALESCE(division, '*group*'), period_month);
  PERFORM pg_temp.must('the unique index builds once the duplicates are gone', TRUE);
END $$;

/* The rule holds afterwards: a second group target for that month is
   refused by the database rather than quietly counted twice. */
DO $$
DECLARE failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO revenue_targets (user_id, division, period_month, target_amount)
    VALUES (NULL, NULL, DATE '2026-08-01', 999);
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  PERFORM pg_temp.must('a second group target for that month is now refused', failed);
END $$;

/* And the writer still upserts, which the expression index broke once:
   ON CONFLICT can only infer an index from a column list, so naming
   the columns would have failed the first time an administrator set a
   target, a long way from the migration that caused it. */
DO $$
DECLARE said JSONB; n INTEGER; amount NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');
  said := analytics_set_target(DATE '2026-08-01', NULL, 300000);
  PERFORM pg_temp.must('setting that month again still goes through', (said->>'ok')::BOOLEAN);

  SELECT COUNT(*), MAX(target_amount) INTO n, amount FROM revenue_targets
   WHERE user_id IS NULL AND division IS NULL AND period_month = DATE '2026-08-01';
  PERFORM pg_temp.must('over the top of the row rather than beside it', n = 1);
  PERFORM pg_temp.must('with the new figure', amount = 300000);
END $$;

-- =============================================================
-- 5. The window and its comparison are different windows
--
-- Invoices in two quarters, deliberately unequal, so a function that
-- returned the same figures for both halves fails here rather than in
-- front of the MD.
-- =============================================================
DO $$
DECLARE inserted INTEGER;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');

  INSERT INTO protean_accounts (division, alpha, protean_name)
  VALUES ('stc', 'WINDOWTEST', 'Window Test Transport')
  ON CONFLICT DO NOTHING;

  /* Two in the window at 1000 each, one in the comparison at 400. If
     the two halves were ever read out of the same subquery the answer
     comes back 2000 against 2000, and the page reports a flat quarter
     on a business that has grown.

     Dated on `tax_point`, which is what the function reads. An invoice
     raised in June for work done in May belongs to May's revenue, and
     `imported_at` is when a spreadsheet was uploaded. */
  INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net)
  VALUES ('stc', 'AN-W-1', 'WINDOWTEST', DATE '2026-05-02', 1000),
         ('stc', 'AN-W-2', 'WINDOWTEST', DATE '2026-06-14', 1000),
         ('stc', 'AN-C-1', 'WINDOWTEST', DATE '2026-02-10',  400);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  PERFORM pg_temp.must('fixture: three invoices, two in the window and one before it', inserted = 3);
END $$;

DO $$
DECLARE now_rev NUMERIC; was_rev NUMERIC; rows INTEGER;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');

  SELECT COUNT(*) INTO rows FROM analytics_window(
    DATE '2026-04-01', DATE '2026-06-30', DATE '2026-01-01', DATE '2026-03-31');
  PERFORM pg_temp.must('every division comes back, including the ones with nothing in them',
                       rows = (SELECT COUNT(*) FROM divisions));

  SELECT revenue, was_revenue INTO now_rev, was_rev FROM analytics_window(
    DATE '2026-04-01', DATE '2026-06-30', DATE '2026-01-01', DATE '2026-03-31')
   WHERE division = 'stc';

  PERFORM pg_temp.must('the window totals only the invoices inside it', now_rev = 2000);
  PERFORM pg_temp.must('the comparison totals only the invoices inside itself', was_rev = 400);
  PERFORM pg_temp.must('so the two halves are genuinely different figures', now_rev <> was_rev);
END $$;

DO $$
DECLARE now_rev NUMERIC; was_rev NUMERIC;
BEGIN
  /* The boundaries are inclusive at both ends, which matters because
     the last day of a quarter is somebody's biggest invoicing day.
     Narrowed to the second of May, the second of May still counts. */
  SELECT revenue INTO now_rev FROM analytics_window(
    DATE '2026-05-02', DATE '2026-05-02', DATE '2026-01-01', DATE '2026-01-01')
   WHERE division = 'stc';
  PERFORM pg_temp.must('a one day window includes its own day', now_rev = 1000);

  SELECT was_revenue INTO was_rev FROM analytics_window(
    DATE '2026-05-02', DATE '2026-05-02', DATE '2026-02-10', DATE '2026-02-10')
   WHERE division = 'stc';
  PERFORM pg_temp.must('and so does a one day comparison', was_rev = 400);
END $$;

DO $$
DECLARE t NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('ba000000-0000-0000-0000-000000000001');
  PERFORM analytics_set_target(DATE '2026-04-01', 'stc', 30000);
  PERFORM analytics_set_target(DATE '2026-05-01', 'stc', 30000);
  PERFORM analytics_set_target(DATE '2026-06-01', 'stc', 30000);

  SELECT target INTO t FROM analytics_window(
    DATE '2026-04-01', DATE '2026-06-30', DATE '2026-01-01', DATE '2026-03-31')
   WHERE division = 'stc';
  PERFORM pg_temp.must('a quarter is measured against all three of its monthly targets', t = 90000);

  /* A window covering one month is measured against that month alone.
     Summing every target the table holds would tell an MD looking at
     May that he is a fifth of the way to a figure nobody set for May. */
  SELECT target INTO t FROM analytics_window(
    DATE '2026-05-01', DATE '2026-05-31', DATE '2026-04-01', DATE '2026-04-30')
   WHERE division = 'stc';
  PERFORM pg_temp.must('and one month against one month', t = 30000);
END $$;

ROLLBACK;
