-- =============================================================
-- 100. Analytics needs a target, and a window it can choose.
--
-- From the business, commissioning the rebuild of the Analytics hub:
--
--   it doesn't offer enough insight to an accounts department of what
--   they need to see at a glance in the morning, or spend 30 minutes
--   delving in to ... I need to be able to quickly view analytics for
--   certain divisions or contracts or people and get very granular
--   without it being overwhelming to our non-techy MD ... Any place in
--   this app that has anything to do with £££ - analytics must track it.
--
-- Almost all of that is a screen. Two things are not, and they are here.
--
-- ---- 1. A number has to be measured against something ----
--
-- Every device in the design shows a figure beside what it is measured
-- against, and one of the three comparisons the design offers is a
-- TARGET. `revenue_targets` has existed since migration 001 and is one
-- row per person per month with no division on it, so it can express
-- "Dean should bill £40k in March" and cannot express "trailer sales
-- should bill £700k in March", which is the only version the MD asked
-- for.
--
-- Adding a division rather than making a second table, because two
-- tables of targets is how the group total stops being the sum of the
-- divisions.
--
-- ---- 2. The window has to be arbitrary ----
--
-- `division_revenue` answers for the financial year and
-- `division_by_month` answers per calendar month. The control bar in
-- the design offers month, quarter, year and a custom range, with a
-- comparison window beside it, and neither existing function can be
-- asked for "the 1st to the 9th of September against the 1st to the 9th
-- of August".
--
-- So one function that takes two windows and answers for both at once.
-- Both windows in one call rather than two, because a comparison
-- assembled from two round trips can straddle an import: the first call
-- reads the figures before this morning's Protean load and the second
-- reads them after, and the page then prints a change that never
-- happened.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Targets, per division as well as per person
--
-- `division IS NULL` keeps meaning what it has always meant on this
-- table for `user_id`: the whole group. A row with both null is the
-- group target for that month, which is what the KPI band reads.
-- -------------------------------------------------------------
ALTER TABLE revenue_targets ADD COLUMN IF NOT EXISTS division TEXT
  REFERENCES divisions(slug) ON DELETE CASCADE;

/* The old unique key was (user_id, period_month), which now allows one
   row per person per month TOTAL rather than one per person per
   division. Replaced rather than added to, and NULLS NOT DISTINCT so
   that two group targets for the same month collide instead of
   silently both counting. */
ALTER TABLE revenue_targets DROP CONSTRAINT IF EXISTS revenue_targets_user_id_period_month_key;
DROP INDEX IF EXISTS revenue_targets_one_per_month;
CREATE UNIQUE INDEX IF NOT EXISTS revenue_targets_one_per_month
  ON revenue_targets (user_id, division, period_month) NULLS NOT DISTINCT;

COMMENT ON COLUMN revenue_targets.division IS
  'Division slug, or NULL for the whole group. NULL user_id and NULL division is the group figure.';

-- -------------------------------------------------------------
-- 2. What a division billed between two dates
--
-- One row per division, both windows, and the target alongside. The
-- three divisions do not share a source: STC and rentals are invoices
-- in Protean, trailer sales is units off the stock list, and the whole
-- point of this function is that a caller never has to know that.
--
-- SECURITY DEFINER with an explicit capability check, matching
-- `division_revenue`: the Protean tables are not readable row by row by
-- a rep, and an aggregate over them is a different question from a list
-- of invoices.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_window(
  p_from         DATE,
  p_to           DATE,
  p_compare_from DATE,
  p_compare_to   DATE
)
RETURNS TABLE (
  division     TEXT,
  name         TEXT,
  sort_order   INTEGER,
  -- This window
  revenue      NUMERIC,
  deals        INTEGER,
  customers    INTEGER,
  -- Trailer sales is the only division that records a cost, so margin
  -- is null elsewhere. Null means "we do not know", never "nothing".
  margin       NUMERIC,
  -- The comparison window, same three figures
  was_revenue  NUMERIC,
  was_deals    INTEGER,
  was_customers INTEGER,
  -- What was promised for the months this window covers
  target       NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Analytics needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH
  /* Protean, both windows in one pass over the table. A second pass
     would double the work on the largest table in the database for a
     figure that is one CASE away. */
  billed AS (
    SELECT i.division AS d,
           SUM(i.net) FILTER (WHERE i.tax_point BETWEEN p_from AND p_to)                 AS rev,
           COUNT(*)   FILTER (WHERE i.tax_point BETWEEN p_from AND p_to)                 AS n,
           COUNT(DISTINCT i.alpha) FILTER (WHERE i.tax_point BETWEEN p_from AND p_to)    AS cust,
           SUM(i.net) FILTER (WHERE i.tax_point BETWEEN p_compare_from AND p_compare_to) AS was_rev,
           COUNT(*)   FILTER (WHERE i.tax_point BETWEEN p_compare_from AND p_compare_to) AS was_n,
           COUNT(DISTINCT i.alpha) FILTER (WHERE i.tax_point BETWEEN p_compare_from AND p_compare_to) AS was_cust
      FROM protean_invoices i
     GROUP BY i.division
  ),
  /* Trailer sales. A unit counts on the day it was ordered, which is
     the day the money was agreed. `dispatch_date` would move a sale
     into the month the trailer left the yard, and that is a logistics
     question rather than a revenue one. */
  sold AS (
    SELECT SUM(t.sales_price) FILTER (WHERE t.order_date BETWEEN p_from AND p_to)                 AS rev,
           COUNT(*)           FILTER (WHERE t.order_date BETWEEN p_from AND p_to)                 AS n,
           COUNT(DISTINCT t.customer) FILTER (WHERE t.order_date BETWEEN p_from AND p_to)         AS cust,
           SUM(t.profit)      FILTER (WHERE t.order_date BETWEEN p_from AND p_to)                 AS gp,
           SUM(t.sales_price) FILTER (WHERE t.order_date BETWEEN p_compare_from AND p_compare_to) AS was_rev,
           COUNT(*)           FILTER (WHERE t.order_date BETWEEN p_compare_from AND p_compare_to) AS was_n,
           COUNT(DISTINCT t.customer) FILTER (WHERE t.order_date BETWEEN p_compare_from AND p_compare_to) AS was_cust
      FROM stock_trailers t
     WHERE t.order_date IS NOT NULL
  ),
  /* Every month the window touches, so a quarter picks up three
     targets and a fortnight inside one month picks up that one. A
     window overlapping half a month takes the whole month's target,
     which overstates the target rather than the achievement: the safe
     direction to be wrong in when the number is "are we behind". */
  promised AS (
    SELECT t.division AS d, SUM(t.target_amount) AS amount
      FROM revenue_targets t
     WHERE t.user_id IS NULL
       AND t.period_month >= DATE_TRUNC('month', p_from)::DATE
       AND t.period_month <= DATE_TRUNC('month', p_to)::DATE
     GROUP BY t.division
  )
  SELECT d.slug,
         d.name,
         d.sort_order,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.rev, 0)  ELSE COALESCE(b.rev, 0)  END,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.n, 0)::INTEGER ELSE COALESCE(b.n, 0)::INTEGER END,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.cust, 0)::INTEGER ELSE COALESCE(b.cust, 0)::INTEGER END,
         CASE WHEN d.slug = 'trailer' THEN s.gp ELSE NULL END,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.was_rev, 0) ELSE COALESCE(b.was_rev, 0) END,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.was_n, 0)::INTEGER ELSE COALESCE(b.was_n, 0)::INTEGER END,
         CASE WHEN d.slug = 'trailer' THEN COALESCE(s.was_cust, 0)::INTEGER ELSE COALESCE(b.was_cust, 0)::INTEGER END,
         p.amount
    FROM divisions d
    LEFT JOIN billed   b ON b.d = d.slug AND d.slug <> 'trailer'
    LEFT JOIN sold     s ON d.slug = 'trailer'
    LEFT JOIN promised p ON p.d = d.slug
   ORDER BY d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION analytics_window(DATE, DATE, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION analytics_window(DATE, DATE, DATE, DATE) IS
  'Revenue, deals, customers and target per division for a window and its comparison, in one pass.';

-- -------------------------------------------------------------
-- 3. Month by month, arbitrary length, all three divisions
--
-- `division_by_month` already exists and answers this, and it takes a
-- month count rather than two dates. Kept as it is and reused: a second
-- function answering the same question is how the trend chart and the
-- scorecards start disagreeing about what August was.
--
-- What is added here is the group target per month, so the trend chart
-- can draw the notch the design asks for on every bar rather than only
-- on the current one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_targets_by_month(p_months INTEGER DEFAULT 24)
RETURNS TABLE (
  month    DATE,
  division TEXT,
  target   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  /* The same gate `analytics_window` has, and for the same reason.

     SECURITY DEFINER means this function reads `revenue_targets` with
     row level security switched off, so whatever gate it carries is
     the only gate there is. Written without one it answered anybody
     who could reach it: no session, no profile, no capability. Its
     sibling refuses all three, and a pair of functions reading the
     same table under different rules is a gap somebody eventually
     finds.

     All four roles hold `crm.view` today, so this is not about keeping
     a colleague out. It is about the function refusing a caller who is
     nobody, which is what the rest of this schema does. */
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Analytics needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT t.period_month, t.division, t.target_amount
    FROM revenue_targets t
   WHERE t.user_id IS NULL
     AND t.period_month >= (DATE_TRUNC('month', CURRENT_DATE) - (p_months || ' months')::INTERVAL)::DATE
   ORDER BY t.period_month, t.division;
END;
$fn$;

GRANT EXECUTE ON FUNCTION analytics_targets_by_month(INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- 4. Setting a target
--
-- A function rather than an INSERT from the browser, for the reason
-- every other operation here is one: the screen needs to upsert, and an
-- upsert typed in a client is an upsert somebody writes differently the
-- second time.
--
-- Administrators only, matching the policy that has been on this table
-- since 001. A target is what the business is judged against.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_set_target(
  p_month    DATE,
  p_division TEXT,
  p_amount   NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  m DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
  IF current_role_safe() <> 'admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'Only an administrator sets a target.');
  END IF;
  IF p_division IS NOT NULL AND NOT EXISTS (SELECT 1 FROM divisions WHERE slug = p_division) THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'There is no such division.');
  END IF;

  /* Zero removes it rather than storing a target of nothing. A target
     of zero and no target at all read identically on a chart, and only
     one of them is a statement somebody made. */
  IF COALESCE(p_amount, 0) <= 0 THEN
    DELETE FROM revenue_targets
     WHERE user_id IS NULL AND division IS NOT DISTINCT FROM p_division AND period_month = m;
    RETURN jsonb_build_object('ok', TRUE, 'cleared', TRUE);
  END IF;

  INSERT INTO revenue_targets (user_id, division, period_month, target_amount)
  VALUES (NULL, p_division, m, p_amount)
  ON CONFLICT (user_id, division, period_month) DO UPDATE
    SET target_amount = EXCLUDED.target_amount;

  RETURN jsonb_build_object('ok', TRUE, 'month', m, 'division', p_division, 'amount', p_amount);
END;
$fn$;

GRANT EXECUTE ON FUNCTION analytics_set_target(DATE, TEXT, NUMERIC) TO authenticated;

-- -------------------------------------------------------------
-- 5. The capability
--
-- Reading the hub is `crm.view`, which every screen that shows money
-- already asks for. Setting a target is its own, because the people who
-- read a target and the person who sets one are different people, and
-- an MD who can see he is behind should not be able to move the line.
-- -------------------------------------------------------------
INSERT INTO capability_catalog
  (key, label, description, area, feature, danger, requires, scoped, position)
VALUES
  ('analytics.targets', 'Set revenue targets',
   'Change what a division or the group is measured against on the Analytics hub.',
   'CRM', 'Analytics', 'sensitive'::capability_danger, '{}'::TEXT[], FALSE, 340)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description,
  area = EXCLUDED.area, feature = EXCLUDED.feature, position = EXCLUDED.position;

INSERT INTO command_capability_roles (capability, role)
VALUES ('analytics.targets', 'admin')
ON CONFLICT DO NOTHING;

/* Administrators only, which is the whole point of it being its own
   capability. Compliance and member read the hub and do not move the
   line they are measured against. */
INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT rt.id, 'analytics.targets', 'company'
  FROM role_templates rt
 WHERE rt.slug = 'administrator'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- -------------------------------------------------------------
-- Said out loud, so a migration that matched nothing is not mistaken
-- for one that worked.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'revenue_targets' AND column_name = 'division') THEN
    RAISE EXCEPTION '100 did not land: revenue_targets has no division column';
  END IF;
  RAISE NOTICE 'analytics: targets carry a division, and the window function is in';
END $$;
