-- =============================================================
-- A view is a question. A layout is how the answer is drawn.
--
-- From the business, about the Work tab:
--
--   It's also extremely confusing to understand because some tabs just
--   look the same and carry the same data. I think we need to work on
--   the views. My Work and my board seem like the same thing just a
--   different view, then they both offer viewing options etc.
--
-- ---- They are the same thing ----
--
-- Two of the twelve views seeded by migration 056 are not questions.
-- They are another view drawn differently, and the toolbar above every
-- view already turns any of them into any of the six layouts:
--
--   My work     assignee is me, not done      as a list
--   My board    assignee is me                as a board
--
--   Team work   everything open, by assignee  as a board
--   Workload    everything open, by assignee  as a workload chart
--
-- Team work and Workload have byte for byte the same filter and the
-- same grouping. The only thing that separates them is the word in the
-- `layout` column, which is a chip on the toolbar.
--
-- ---- My board was also counting a different number ----
--
-- Worse than redundant. My board's filter has no status clause, so its
-- badge in the rail counts every task ever assigned to somebody,
-- finished ones included, while the board itself only draws the open
-- columns. Two rows, same work, and the second one says a bigger number
-- for reasons nothing on the screen explains.
--
-- ---- What replaces them ----
--
-- The layout somebody picks is now remembered on their machine, per
-- view, by `lib/ui/remember.ts`. Switching My work to a board is a
-- press that lasts, which is the whole thing My board existed to
-- provide. The workload chart is one chip away on Team work, and the
-- command bar reaches it directly at ?view=team-work&layout=workload.
--
-- ---- And the seed can no longer double itself ----
--
-- 056 ends its insert with ON CONFLICT DO NOTHING against a table whose
-- only unique constraint is a generated uuid, so that clause has never
-- caught anything. Applying 056 twice, which is exactly what a catch-up
-- bundle does, seeds twelve more views with the same names. The partial
-- unique index below is what makes that ON CONFLICT clause true, and it
-- is created after the duplicates are cleared so it can be created at
-- all.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Any duplicate system views, from 056 having been applied twice
--
-- The oldest of each name is kept, because it is the one anybody's
-- shares and habits already point at.
-- -------------------------------------------------------------
DELETE FROM task_views t
USING task_views keep
WHERE t.is_system
  AND keep.is_system
  AND keep.name = t.name
  AND (keep.created_at, keep.id) < (t.created_at, t.id);

-- -------------------------------------------------------------
-- 2. So it cannot happen again
--
-- Partial, because two people are perfectly entitled to a personal view
-- each called "Mine". It is the installation's own rail that must not
-- carry the same name twice.
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_views_system_name
  ON task_views (name) WHERE is_system;

-- -------------------------------------------------------------
-- 3. The two that are a layout rather than a question
--
-- Only where they are still the seeded row. Somebody who has taken My
-- board over and pointed it at something of their own has made it a
-- question, and it stays.
-- -------------------------------------------------------------
DELETE FROM task_views
WHERE is_system
  AND name = 'My board'
  AND filter = '{"all":[{"field":"assignee_id","op":"is","value":"@me"}]}'::jsonb;

DELETE FROM task_views
WHERE is_system
  AND name = 'Workload'
  AND filter = '{"all":[{"field":"status","op":"notIn","value":["done","cancelled"]}]}'::jsonb
  AND group_by = 'assignee';

-- -------------------------------------------------------------
-- 4. Ten rows, in three named groups
--
-- Twelve unlabelled rows in a rail is a list somebody reads once and
-- then navigates by memory, which is how two of them went unnoticed for
-- as long as they did. The section is stored in `options` rather than a
-- new column: it is a display switch, which is what that column is for,
-- and a view somebody builds inherits it the same way.
--
-- `yours`     work that is on you, or came from you
-- `attention` work that is late or stuck, whoever has it
-- `everyone`  the business as a whole
-- -------------------------------------------------------------
UPDATE task_views SET
  description = 'Assigned to you and not finished, soonest first.',
  options = options || '{"section":"yours"}'::jsonb,
  position = 10
WHERE is_system AND name = 'My work';

UPDATE task_views SET
  description = 'Reviews, approvals and handback requests that will not move until you look.',
  options = options || '{"section":"yours"}'::jsonb,
  position = 20
WHERE is_system AND name = 'Waiting for me';

UPDATE task_views SET
  description = 'What you have put on other people, and where it has got to.',
  options = options || '{"section":"yours"}'::jsonb,
  position = 30
WHERE is_system AND name = 'Assigned by me';

UPDATE task_views SET
  description = 'Finished in the last month, newest first.',
  options = options || '{"section":"yours"}'::jsonb,
  position = 40
WHERE is_system AND name = 'Recently completed';

UPDATE task_views SET
  description = 'Past its date and not finished, whoever it is on.',
  options = options || '{"section":"attention"}'::jsonb,
  position = 50
WHERE is_system AND name = 'Overdue';

UPDATE task_views SET
  description = 'Stuck, or waiting on somebody outside. Oldest first, because the longest stuck is the one nobody is looking at.',
  options = options || '{"section":"attention"}'::jsonb,
  position = 60
WHERE is_system AND name = 'Blocked';

UPDATE task_views SET
  description = 'Everything open across the business, by who is carrying it.',
  options = options || '{"section":"everyone"}'::jsonb,
  position = 70
WHERE is_system AND name = 'Team work';

UPDATE task_views SET
  description = 'Aimed at your department, including anything not yet placed on a person.',
  options = options || '{"section":"everyone"}'::jsonb,
  position = 80
WHERE is_system AND name = 'Department work';

UPDATE task_views SET
  description = 'Due in the next seven days, whoever it is on.',
  options = options || '{"section":"everyone"}'::jsonb,
  position = 90
WHERE is_system AND name = 'This week';

UPDATE task_views SET
  description = 'Every project and its milestones, against their dates.',
  options = options || '{"section":"everyone"}'::jsonb,
  position = 100
WHERE is_system AND name = 'Projects';

-- -------------------------------------------------------------
-- 5. Anything left without a section
--
-- A view built before this migration, or one somebody adds through the
-- builder, has no section and would otherwise fall out of the rail. It
-- goes under the person's own heading, which is where a view they made
-- belongs anyway.
-- -------------------------------------------------------------
UPDATE task_views
SET options = options || '{"section":"everyone"}'::jsonb
WHERE is_system
  AND NOT (options ? 'section');
