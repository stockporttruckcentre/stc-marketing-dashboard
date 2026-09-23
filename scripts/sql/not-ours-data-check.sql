-- =============================================================
-- Nothing in the DATA belongs to somebody else either.
--
-- From the business, with a screenshot of a scheduled post:
--
--   why does the app still say this, you put 6 agents on finding all
--   traces of Frame and removing it then confirmed it was done. Did you
--   never commit it?
--
-- It was committed. `npm run check:not-ours` reads 783 files and finds
-- nothing. The screen was drawing `social_posts.lint_findings`, written
-- by the removed code before it went, and a check that reads the
-- repository cannot see the database.
--
-- So this is the other half, and it sweeps EVERY column rather than the
-- ones somebody thinks to look at. The first sweep done by hand covered
-- text and varchar and skipped jsonb, which is exactly where the thing
-- was.
--
-- Run with `npm run check:not-ours-data`.
--
-- AGAINST A REAL DATABASE: the same sweep is in
-- `scripts/sql/not-ours-data-probe.sql`, which reads and writes
-- nothing, for pasting into the Supabase SQL editor.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.not_ours_in_the_data()
RETURNS TABLE (tbl TEXT, colname TEXT, hits BIGINT)
LANGUAGE plpgsql AS $fn$
DECLARE r RECORD; n BIGINT;
BEGIN
  FOR r IN
    SELECT col.table_name AS t, col.column_name AS c
      FROM information_schema.columns col
      JOIN information_schema.tables tab
        ON tab.table_name = col.table_name AND tab.table_schema = col.table_schema
     WHERE col.table_schema = 'public'
       AND tab.table_type = 'BASE TABLE'
       /* Every shape a sentence can be stored in. `jsonb` is in this
          list because leaving it out is the whole reason this file
          exists, and ARRAY is here because a text[] holds sentences
          too. */
       AND col.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
       /* The rows deliberately kept as evidence of what was removed.
          They are a record of the fault, not the fault. */
       AND col.table_name NOT LIKE '%_before_removal'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I::TEXT ~* $q$american spelling$q$'
      ' OR %I::TEXT ~ $q$\mFrame\M$q$'
      ' OR %I::TEXT ~* $q$\mpaw.?chain\M$q$'
      ' OR %I::TEXT ~ $q$\mOTCID\M$q$'
      ' OR %I::TEXT ~* $q$\mpredecessor chain\M$q$',
      r.t, r.c, r.c, r.c, r.c, r.c) INTO n;
    IF n > 0 THEN tbl := r.t; colname := r.c; hits := n; RETURN NEXT; END IF;
  END LOOP;
END;
$fn$;

DO $check$
DECLARE post UUID; n INT; where_ TEXT;
  author UUID := 'ee991111-0000-0000-0000-000000000001';
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (author, 'no@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (author, 'no@stc.example', 'Nobody', 'marketer', TRUE)
  ON CONFLICT (id) DO NOTHING;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  -- ---------------------------------------------------------
  -- 1. THE SWEEP FINDS IT WHERE IT ACTUALLY WAS.
  --
  --    Seeded on purpose, in a jsonb column, because a sweep that
  --    cannot find the thing that was really there is a sweep that
  --    passes for the wrong reason.
  -- ---------------------------------------------------------
  INSERT INTO social_posts (content, scheduled_date, status, lint_severity, lint_findings, created_by)
  VALUES ('Your O-Licence commits you to maintenance arrangements.', CURRENT_DATE,
          'scheduled', 'advisory',
          '[{"rule":"us-spelling-11","match":"Licence","replacement":"license",
             "message":"US English. STC and Frame use American spelling throughout.",
             "severity":"advisory"}]'::JSONB,
          author)
  RETURNING id INTO post;

  SELECT count(*) INTO n FROM pg_temp.not_ours_in_the_data()
   WHERE tbl = 'social_posts' AND colname = 'lint_findings';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the sweep did not find another company''s words in a jsonb column';
  END IF;

  -- ---------------------------------------------------------
  -- 2. AND CLEARING THE VERDICT CLEARS IT.
  --
  --    The post itself survives. Its words, its channels and its
  --    schedule were never the problem.
  -- ---------------------------------------------------------
  UPDATE social_posts
     SET lint_findings = NULL, lint_severity = NULL,
         lint_hash = NULL, lint_checked_at = NULL
   WHERE id = post;

  IF NOT EXISTS (SELECT 1 FROM social_posts WHERE id = post) THEN
    RAISE EXCEPTION 'clearing the verdict took the post with it';
  END IF;

  SELECT string_agg(tbl || '.' || colname || '=' || hits, '  ')
    INTO where_ FROM pg_temp.not_ours_in_the_data();
  IF where_ IS NOT NULL THEN
    RAISE EXCEPTION 'another company''s words are still in the data: %', where_;
  END IF;

  RAISE NOTICE 'the data sweep reads every column shape, jsonb included, and the verdicts are gone';
END $check$;

ROLLBACK;
