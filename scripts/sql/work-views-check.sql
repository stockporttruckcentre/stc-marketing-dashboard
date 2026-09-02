-- =============================================================
-- Every view in the Work rail answers a question no other one answers.
--
-- From the business:
--
--   It's also extremely confusing to understand because some tabs just
--   look the same and carry the same data. I think we need to work on
--   the views. My Work and my board seem like the same thing just a
--   different view, then they both offer viewing options etc.
--
-- ---- The rule, not the count ----
--
-- The obvious check here is "there are ten views and here are their
-- names". That check passes for as long as nobody adds a view, which is
-- to say it never catches anything and then goes off the day somebody
-- adds a good one. It also would not have caught the fault it was
-- written for: twelve views was never the problem.
--
-- The rule is what the seed got wrong:
--
--   TWO VIEWS THAT DIFFER ONLY IN THEIR LAYOUT ARE ONE VIEW.
--
-- Same filter, same grouping, different layout is not a second
-- question. It is the same rows drawn another way, which every view on
-- the screen already offers through six chips on its own toolbar. A row
-- in the rail costs somebody a decision every time they look at it, and
-- that one is a decision with no answer.
--
-- Both original offenders fail this, so the check is proven against the
-- defect rather than written to agree with the fix:
--
--   Team work  {status notIn done,cancelled}  by assignee  board
--   Workload   {status notIn done,cancelled}  by assignee  workload
--
-- ---- And the counting fault underneath it ----
--
-- My board was worse than redundant. Its filter had no status clause,
-- so its badge counted finished work while its board drew only the open
-- columns: two rows, the same work, and the second saying a bigger
-- number for a reason nothing on the screen explained. Section 3 is
-- what stops a view like that coming back.
--
-- Run with `npm run check:work-views`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.say(p TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$ BEGIN RAISE NOTICE '%', p; END $fn$;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

-- -------------------------------------------------------------
-- 1. No two shipped views are the same question in another shape
-- -------------------------------------------------------------
DO $$
DECLARE clash TEXT;
BEGIN
  SELECT string_agg(format('%s and %s', a.name, b.name), '; ')
    INTO clash
  FROM task_views a
  JOIN task_views b
    ON b.is_system AND a.id < b.id
   AND b.filter = a.filter
   AND b.group_by = a.group_by
  WHERE a.is_system;

  PERFORM pg_temp.must(
    'no two shipped views share a filter and a grouping and differ only in layout',
    clash IS NULL);
  IF clash IS NOT NULL THEN RAISE NOTICE '      %', clash; END IF;
END $$;

-- -------------------------------------------------------------
-- 2. The two that did are gone, and Team work is not
--
-- Named, because they are the specific rows the business pointed at.
-- Rule 1 above is what keeps the next pair out; this is what proves
-- this pair went.
-- -------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.must('My board is no longer a row of its own',
    NOT EXISTS (SELECT 1 FROM task_views WHERE is_system AND name = 'My board'));
  PERFORM pg_temp.must('Workload is no longer a row of its own',
    NOT EXISTS (SELECT 1 FROM task_views WHERE is_system AND name = 'Workload'));
  PERFORM pg_temp.must('My work is still there',
    EXISTS (SELECT 1 FROM task_views WHERE is_system AND name = 'My work'));
  PERFORM pg_temp.must('Team work is still there, which is where the workload chart now lives',
    EXISTS (SELECT 1 FROM task_views
             WHERE is_system AND name = 'Team work' AND group_by = 'assignee'));
END $$;

-- -------------------------------------------------------------
-- 3. A badge never counts rows the layout will not draw
--
-- The specific fault My board had, and the reason it was worse than
-- redundant rather than merely redundant.
--
-- A board grouped by status draws one column per status, and it draws
-- the OPEN ones only unless `options.showDone` says otherwise. Its
-- badge in the rail, though, counts every row the filter lets through.
-- My board's filter had no status clause at all, so the rail said
-- twenty three and the board showed seven, with nothing on the screen
-- accounting for the other sixteen. Two rows for the same work, and the
-- second one saying a bigger number for no visible reason.
--
-- Deliberately narrow. A calendar showing a task that was finished on
-- Tuesday is right, and a table of blocked work needs no clause about
-- finished work because nothing blocked is finished. This is about the
-- one layout that hides rows it was handed.
-- -------------------------------------------------------------
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO bad
  FROM task_views
  WHERE is_system
    AND layout = 'board'
    AND group_by = 'status'
    AND COALESCE((options->>'showDone')::BOOLEAN, FALSE) IS NOT TRUE
    AND filter::TEXT NOT LIKE '%done%';

  PERFORM pg_temp.must(
    'no board of statuses counts finished work it then declines to draw',
    bad IS NULL);
  IF bad IS NOT NULL THEN RAISE NOTICE '      counts what it will not draw: %', bad; END IF;
END $$;

-- The rule, proven against the row it was written for. My board is put
-- back exactly as 056 seeded it, and section 3 has to object.
DO $$
DECLARE caught BOOLEAN;
BEGIN
  INSERT INTO task_views (name, description, icon, is_system, layout, group_by,
                          sort, filter, fields, options, position)
  VALUES ('My board', 'The same work as a board, so it can be dragged.', 'columns',
          TRUE, 'board', 'status',
          '[{"field":"board_position","dir":"asc"}]'::jsonb,
          '{"all":[{"field":"assignee_id","op":"is","value":"@me"}]}'::jsonb,
          '["title","priority","due_at","labels"]'::jsonb,
          '{"cardSize":"comfortable"}'::jsonb, 20);

  SELECT EXISTS (
    SELECT 1 FROM task_views
    WHERE is_system AND layout = 'board' AND group_by = 'status'
      AND COALESCE((options->>'showDone')::BOOLEAN, FALSE) IS NOT TRUE
      AND filter::TEXT NOT LIKE '%done%'
  ) INTO caught;

  DELETE FROM task_views WHERE is_system AND name = 'My board';
  PERFORM pg_temp.must('and that rule objects to My board, put back as it was seeded', caught);
END $$;

-- -------------------------------------------------------------
-- 4. Every shipped view is under one of the rail's three headings
--
-- The rail draws `yours`, `attention` and `everyone` and nothing else.
-- A view carrying a fourth word would be counted in the rail's own
-- fallback and quietly land under Everyone, which is a view in the
-- wrong place rather than a view that is missing, and therefore the
-- kind of fault nobody reports.
-- -------------------------------------------------------------
DO $$
DECLARE stray TEXT;
BEGIN
  SELECT string_agg(format('%s (%s)', name, COALESCE(options->>'section', 'none')), ', ')
    INTO stray
  FROM task_views
  WHERE is_system
    AND COALESCE(options->>'section', '') NOT IN ('yours', 'attention', 'everyone');

  PERFORM pg_temp.must('every shipped view is under one of the three headings', stray IS NULL);
  IF stray IS NOT NULL THEN RAISE NOTICE '      %', stray; END IF;

  PERFORM pg_temp.must('all three headings have something under them',
    (SELECT COUNT(DISTINCT options->>'section') FROM task_views WHERE is_system) = 3);
END $$;

-- -------------------------------------------------------------
-- 5. Two views cannot share a name
--
-- 056 ends its seed with ON CONFLICT DO NOTHING against a table whose
-- only unique constraint was a generated uuid, so that clause had never
-- caught anything and applying 056 twice seeded every view again. A
-- catch-up bundle applies every migration, twice being the whole point
-- of it, so this was one paste away from a rail with two of everything.
-- -------------------------------------------------------------
DO $$
DECLARE dupes TEXT;
BEGIN
  PERFORM pg_temp.must('the shipped views have a unique name index',
    EXISTS (SELECT 1 FROM pg_indexes
             WHERE tablename = 'task_views' AND indexname = 'idx_task_views_system_name'));

  SELECT string_agg(name, ', ') INTO dupes
  FROM (SELECT name FROM task_views WHERE is_system GROUP BY name HAVING COUNT(*) > 1) d;
  PERFORM pg_temp.must('and no name is used twice', dupes IS NULL);
  IF dupes IS NOT NULL THEN RAISE NOTICE '      %', dupes; END IF;
END $$;

-- -------------------------------------------------------------
-- 6. The seed, applied again, changes nothing
--
-- Proven rather than asserted: 056's insert is replayed here and the
-- count has to be the same on the other side of it.
-- -------------------------------------------------------------
DO $$
DECLARE before_n INT; after_n INT;
BEGIN
  SELECT COUNT(*) INTO before_n FROM task_views WHERE is_system;

  INSERT INTO task_views (name, description, icon, is_system, layout, group_by,
                          sort, filter, fields, options, position)
  VALUES ('My work', 'A second one', 'user', TRUE, 'list', 'due',
          '[]'::jsonb, '{"all":[]}'::jsonb, '[]'::jsonb, '{}'::jsonb, 10)
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*) INTO after_n FROM task_views WHERE is_system;
  PERFORM pg_temp.must('re-seeding a shipped view is a no-op rather than a second row',
    before_n = after_n);
END $$;

ROLLBACK;
