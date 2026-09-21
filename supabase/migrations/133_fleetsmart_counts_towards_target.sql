-- =============================================================
-- 133. An accepted FleetSmart+ contract is that person's sale.
--
-- From the business:
--
--   If dean wins a FS+ contract, that's his sale, his deal, his target
--   updated, he'll earn commission.
--
-- Nothing read `fleetsmart_contracts` anywhere on the revenue side. An
-- accepted contract reached no target, no portfolio and no figure, and
-- a salesperson whose year was FleetSmart+ work read as having done
-- nothing.
--
-- ---- WHICH FIGURE, AND WHEN. Both stated, neither guessed ----
--
-- WHEN: `decided_at`, the moment it was accepted, placed into the
-- financial year that date falls in. That is the only date on the row
-- that means "this became a sale".
--
-- WHICH: `annual_total`, the contract's yearly value.
--
-- THE ANNUAL VALUE IS AN ASSUMPTION AND IT IS WRITTEN HERE SO IT CAN
-- BE CHANGED IN ONE PLACE. A target is a financial year figure, and a
-- 36 month contract counted whole would put three years of income into
-- one year's target. If the business wants the full term instead, it
-- is `annual_total * term_months / 12.0` in `fleetsmart_worth` below
-- and nowhere else.
--
-- ---- NOTHING IS COUNTED TWICE ----
--
-- A contract can make a tracker lead, `made_its_lead`, and that lead
-- can be marked won. Counting both would double a salesperson's year.
-- So a contract carrying a `lead_id` whose lead is already won is NOT
-- counted here: the tracker has it. Only contracts the tracker does
-- not know about are added.
-- =============================================================

-- -------------------------------------------------------------
-- What one accepted contract is worth to a financial year.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_worth(p_annual NUMERIC, p_term INT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  /* The yearly value. See the banner above before changing this: it is
     the one place the decision lives. */
  SELECT p_annual;
$fn$;

COMMENT ON FUNCTION fleetsmart_worth(NUMERIC, INT) IS
  'What an accepted FleetSmart+ contract contributes to a financial year target. '
  'The annual value. The single place that decision is written.';

-- -------------------------------------------------------------
-- One person's accepted FleetSmart+ work between two dates.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_fleetsmart_between(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION personal_fleetsmart_between(
  p_person UUID, p_from DATE, p_to DATE
)
RETURNS TABLE (value NUMERIC, contracts INT, counted_on_tracker INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    SUM(fleetsmart_worth(f.annual_total, f.term_months)) FILTER (WHERE NOT dup),
    count(*) FILTER (WHERE NOT dup)::INT,
    count(*) FILTER (WHERE dup)::INT
  FROM (
    SELECT f.annual_total, f.term_months,
           /* Already in the tracker's won figure through its lead. */
           (f.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM crm_leads l
               WHERE l.id = f.lead_id
                 AND l.status IN ('won', 'customer')
                 AND l.order_date IS NOT NULL)) AS dup
      FROM fleetsmart_contracts f
     WHERE f.owner_id = p_person
       AND f.status = 'accepted'
       AND f.decided_at IS NOT NULL
       AND f.decided_at::DATE >= p_from
       AND f.decided_at::DATE <= p_to
       AND personal_analytics_may_view(p_person)
  ) f;
$fn$;

REVOKE ALL ON FUNCTION personal_fleetsmart_between(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_fleetsmart_between(UUID, DATE, DATE) TO authenticated;

-- -------------------------------------------------------------
-- The headline, with FleetSmart+ in the target figure.
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
  won_change_pct   NUMERIC,
  tracker_revenue  NUMERIC,
  fleetsmart_value NUMERIC,
  fleetsmart_n     INT
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
  fy_end  DATE := (fy + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
  target  NUMERIC;
  trk_rev NUMERIC;
  trl_rev NUMERIC;
  fs_val  NUMERIC;
  fs_n    INT;
  tgt_rev NUMERIC;
  now_won NUMERIC;
  was_won NUMERIC;
  fs_now  NUMERIC;
  fs_was  NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO trk_rev, trl_rev
    FROM personal_pipeline(p_person, p_when) p;

  /* FleetSmart+ accepted anywhere in this financial year, matching
     how `target_revenue` reads the whole year rather than to date. */
  SELECT f.value, f.contracts INTO fs_val, fs_n
    FROM personal_fleetsmart_between(p_person, fy, fy_end) f;

  /* The target figure is now the tracker AND FleetSmart+. Trailer
     sales stays out of it, as the scope has always said. */
  tgt_rev := CASE WHEN trk_rev IS NULL AND fs_val IS NULL THEN NULL
                  ELSE COALESCE(trk_rev, 0) + COALESCE(fs_val, 0) END;

  SELECT w.target_revenue INTO now_won FROM personal_won_between(p_person, fy,  upto) w;
  SELECT w.target_revenue INTO was_won FROM personal_won_between(p_person, fy0, cut)  w;
  SELECT f.value INTO fs_now FROM personal_fleetsmart_between(p_person, fy,  upto) f;
  SELECT f.value INTO fs_was FROM personal_fleetsmart_between(p_person, fy0, cut)  f;

  now_won := CASE WHEN now_won IS NULL AND fs_now IS NULL THEN NULL
                  ELSE COALESCE(now_won, 0) + COALESCE(fs_now, 0) END;
  was_won := CASE WHEN was_won IS NULL AND fs_was IS NULL THEN NULL
                  ELSE COALESCE(was_won, 0) + COALESCE(fs_was, 0) END;

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
    CASE WHEN was_won IS NULL THEN NULL
         ELSE ROUND(COALESCE(now_won, 0) - was_won, 2) END,
    CASE WHEN COALESCE(was_won, 0) > 0
         THEN ROUND(((COALESCE(now_won, 0) - was_won) / was_won) * 100, 1)
         ELSE NULL END,
    /* The two halves, named, so the screen can show what the target
       figure is made of rather than one number nobody can check. */
    trk_rev,
    fs_val,
    COALESCE(fs_n, 0);
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'an accepted FleetSmart+ contract now counts towards its owner''s target';
END $$;
