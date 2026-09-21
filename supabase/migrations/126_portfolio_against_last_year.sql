-- =============================================================
-- 126. A portfolio against last year, and against its target.
--
-- From the business:
--
--   Dean's now asking you to check his portfolio on analytics. It needs
--   to show what it's up compared to last year and go against his
--   yearly target.
--
-- The target half was already built in 118 and 119: `fy_target`,
-- `target_revenue`, `achieved` and `to_go` are on the screen and Dean's
-- number is in `performance_targets`. Nothing here changes any of them,
-- deliberately, because a figure the MD has already read is not moved
-- by a request to add a second one beside it.
--
-- The year on year half was not built. The screen carried a per
-- customer comparison in the gainers and fallers lists and no total,
-- and those lists are ranked and capped, so adding them up would not
-- have been the portfolio anyway.
--
-- ---- There are two "last year" figures, and they are different ----
--
-- A portfolio has two money bases on this screen already, and a single
-- unlabelled "up on last year" would be a guess about which one was
-- meant. So both are answered and both say what they are:
--
--   WON WORK      the tracker, `crm_leads`, by order date. This is the
--                 basis the target is measured on, so it is the one
--                 that belongs beside the target tiles.
--
--   INVOICED      `protean_invoices`, through the Protean accounts
--                 bound to this portfolio's customers. This is the
--                 money that actually came in, the same basis the
--                 gainers and fallers lists use, and the same basis
--                 the company Analytics screen uses.
--
-- Both compare this financial year to `upto` against the year before to
-- the same point, which is the comparison `division_revenue` already
-- makes. Neither invents a second shape for it.
--
-- ---- Unknown is still not zero ----
--
-- A portfolio customer with no Protean account bound to it has no
-- invoiced figure, and that is not nought. `not_bound` counts them so
-- the screen can say so rather than quietly reporting a smaller number.
-- =============================================================

-- -------------------------------------------------------------
-- Won work between two dates, split the way the target needs it.
--
-- One definition, called four times, so this year and last year cannot
-- drift apart. The status and worth rules are `lead_worth` and the same
-- two status lists migration 119 uses, not a third copy of them.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_won_between(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION personal_won_between(
  p_person UUID,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  target_revenue  NUMERIC,
  trailer_revenue NUMERIC,
  deals           INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type <> 'trailer_sales'),
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type = 'trailer_sales'),
    COUNT(*)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
    AND l.status IN ('won', 'customer')
    AND l.order_date >= p_from
    AND l.order_date <= p_to
    /* The same one rule as everywhere else on this screen. Somebody
       else's portfolio answers nothing, rather than nought. */
    AND personal_analytics_may_view(p_person);
$fn$;

REVOKE ALL ON FUNCTION personal_won_between(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_won_between(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION personal_won_between(UUID, DATE, DATE) IS
  'Won tracker work owned by one person between two order dates, with trailer '
  'sales kept separate. The single definition behind the year on year figures.';

-- -------------------------------------------------------------
-- The portfolio's invoiced revenue, this year against last.
--
-- The portfolio is the customers this person owns a tracker deal
-- against, by `owner_id`, which is the same definition `personal_movers`
-- uses. No name is matched anywhere.
--
-- This is the TOTAL. `personal_movers` ranks and caps and drops anybody
-- who has not moved, which is right for a list of movers and wrong for
-- a total, so the two are separate functions over the same set.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_revenue_year(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_revenue_year(
  p_person UUID,
  p_upto   DATE DEFAULT NULL
)
RETURNS TABLE (
  year_from    DATE,
  year_to      DATE,
  last_from    DATE,
  last_to      DATE,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  change_pct   NUMERIC,
  customers    INT,
  with_revenue INT,
  not_bound    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT DISTINCT l.contact_id
      FROM crm_leads l
      JOIN crm_contacts c ON c.id = l.contact_id AND c.deleted_at IS NULL
     WHERE l.owner_id = p_person
       AND l.contact_id IS NOT NULL
  ),
  per_customer AS (
    SELECT m.contact_id,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS then_,
           /* Bound to at least one Protean account that is not set
              aside. Without one there is no invoiced figure to have,
              which is a different thing from having one of nought. */
           bool_or(a.alpha IS NOT NULL) AS bound
      FROM mine m
      LEFT JOIN protean_accounts a
        ON a.contact_id = m.contact_id AND NOT a.ignored
      LEFT JOIN protean_invoices i
        ON i.division = a.division AND i.alpha = a.alpha
     GROUP BY m.contact_id
  )
  SELECT
    fy, upto, fy0, cut,
    ROUND(COALESCE(SUM(p.now_), 0), 2),
    ROUND(COALESCE(SUM(p.last_), 0), 2),
    ROUND(COALESCE(SUM(p.now_), 0) - COALESCE(SUM(p.last_), 0), 2),
    /* Null rather than infinity where there was nothing to grow from,
       the same as every other movement figure in this product. */
    CASE WHEN COALESCE(SUM(p.last_), 0) > 0
         THEN ROUND(((SUM(p.now_) - SUM(p.last_)) / SUM(p.last_)) * 100, 1)
         ELSE NULL END,
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE p.now_ <> 0 OR p.last_ <> 0)::INT,
    COUNT(*) FILTER (WHERE NOT p.bound)::INT
  FROM (SELECT contact_id, now_, then_ AS last_, bound FROM per_customer) p;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_revenue_year(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_revenue_year(UUID, DATE) TO authenticated;

COMMENT ON FUNCTION personal_revenue_year(UUID, DATE) IS
  'What one portfolio invoiced this financial year to a date, against the same '
  'point the year before. The total behind the gainers and fallers lists.';

-- -------------------------------------------------------------
-- The headline, with last year beside the target.
--
-- Every existing column keeps its name, its meaning and its value.
-- Four are added:
--
--   won_to_date     won work excluding trailer sales, dated into this
--                   financial year UP TO the as at date
--   last_year_won   the same, the year before, to the same point
--   won_change      the difference
--   won_change_pct  and it as a percentage, null where last year was nought
--
-- `target_revenue` is left exactly as it was: the whole financial year,
-- which is what a target is measured against. `won_to_date` is capped
-- at the as at date, which is what a fair comparison needs. They differ
-- only where a won deal carries an order date later in the year than
-- the date being asked about, and the screen names both figures rather
-- than pretending there is one.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_overview(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_overview(p_person UUID, p_when DATE DEFAULT NULL)
RETURNS TABLE (
  person_id        UUID,
  full_name        TEXT,
  financial_year   DATE,
  fy_target        NUMERIC,
  target_revenue   NUMERIC,
  trailer_revenue  NUMERIC,
  open_pipeline    NUMERIC,
  open_deals       INT,
  won_deals        INT,
  lost_deals       INT,
  customers        INT,
  unpriced         INT,
  won_undated      INT,
  achieved         NUMERIC,
  to_go            NUMERIC,
  won_to_date      NUMERIC,
  last_year_won    NUMERIC,
  won_change       NUMERIC,
  won_change_pct   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto    DATE := COALESCE(p_when, CURRENT_DATE);
  fy      DATE := financial_year_of(upto);
  fy0     DATE := (fy - INTERVAL '1 year')::DATE;
  cut     DATE := (upto - INTERVAL '1 year')::DATE;
  target  NUMERIC;
  tgt_rev NUMERIC;
  trl_rev NUMERIC;
  now_won NUMERIC;
  was_won NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO tgt_rev, trl_rev
    FROM personal_pipeline(p_person, p_when) p;

  SELECT w.target_revenue INTO now_won FROM personal_won_between(p_person, fy,  upto) w;
  SELECT w.target_revenue INTO was_won FROM personal_won_between(p_person, fy0, cut)  w;

  RETURN QUERY
  SELECT
    p_person,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = p_person),
    fy,
    target,
    tgt_rev,
    trl_rev,
    (SELECT SUM(x.open_total) FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.open_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.lost_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COUNT(DISTINCT l.contact_id)::INT
       FROM crm_leads l WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL),
    (SELECT COALESCE(SUM(x.unpriced), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt_rev, 0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL
         ELSE ROUND(target - COALESCE(tgt_rev, 0), 2) END,
    now_won,
    was_won,
    /* Nothing this year and nothing last year is no movement, not an
       unknown one. Nothing either side at all stays unknown. */
    CASE WHEN now_won IS NULL AND was_won IS NULL THEN NULL
         ELSE ROUND(COALESCE(now_won, 0) - COALESCE(was_won, 0), 2) END,
    CASE WHEN COALESCE(was_won, 0) > 0
         THEN ROUND(((COALESCE(now_won, 0) - was_won) / was_won) * 100, 1)
         ELSE NULL END;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a portfolio now reads against last year as well as against its target';
END $$;
