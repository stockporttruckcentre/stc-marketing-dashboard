-- =============================================================
-- 119. One person's portfolio, in figures.
--
-- From the agreed development scope, Task 2, and from the business on
-- where the target figure comes from:
--
--   the 600k target thing will come from pipeline on the tracker
--
-- So the tracker is the source, and the tracker already has the one
-- thing this needed: `crm_leads.owner_id` is a real column pointing at
-- a real profile. A person's portfolio is the deals they own and the
-- customers those deals are against. No name matching anywhere, and no
-- new ownership relationship invented: the scope said to introduce one
-- only if a canonical relationship was still missing, and it is not.
--
-- ---- The rules this does NOT restate ----
--
-- Which statuses are open, which are won, and what a deal is worth are
-- decided in `lib/crm/lead-value.ts` and asserted by `check:value`:
--
--   open   lead, contacted, quoted
--   won    won, customer
--   lost   neither, and never pipeline
--   worth  sale_price where a won deal has one, estimated_value otherwise
--
-- The same four rules are written once more here because this is SQL
-- and that is TypeScript, and `check:personal-portfolio` asserts the two
-- agree on the same rows rather than trusting that they do.
--
-- ---- Unknown is not zero ----
--
-- A deal with no figure on it is counted in `unpriced` and added to
-- nothing. A portfolio whose every deal is unpriced reports a total of
-- NULL, not 0, because those are different sentences.
-- =============================================================

-- -------------------------------------------------------------
-- What one deal is worth, so the three functions below cannot drift.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION lead_worth(p_status TEXT, p_sale NUMERIC, p_estimate NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_status IN ('won', 'customer') THEN COALESCE(p_sale, p_estimate)
    ELSE p_estimate
  END;
$fn$;

COMMENT ON FUNCTION lead_worth(TEXT, NUMERIC, NUMERIC) IS
  'What a tracker deal is worth. The same rule as valueOf() in lib/crm/lead-value.ts, '
  'which check:personal-portfolio asserts against this one.';

-- -------------------------------------------------------------
-- The pipeline and the revenue, split by what the deal is for.
--
-- `lead_type` is the tracker's own: trailer_sales, maintenance, rental.
-- Returned per type rather than netted, because the scope needs Trailer
-- Sales visible AND kept out of the target figure, and a caller cannot
-- take it back out of a total it never saw the parts of.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_pipeline(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_pipeline(p_person UUID, p_when DATE DEFAULT NULL)
RETURNS TABLE (
  lead_type    TEXT,
  open_count   INT,
  open_total   NUMERIC,
  won_count    INT,
  won_total    NUMERIC,
  lost_count   INT,
  lost_total   NUMERIC,
  unpriced     INT,
  won_undated  INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE fy_start DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
BEGIN
  /* The one rule, asked before a single figure is shaped. A request
     carrying somebody else's id gets no rows, not a zero. */
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    l.type,
    COUNT(*) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INT,
    /* SUM over an empty set is NULL, which is the answer wanted: no
       priced open deals is not the same as open deals worth nothing. */
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted')),

    /* Won, and IN THIS FINANCIAL YEAR. `order_date` is the agreed date:
       migration 007 stamps it when a deal is marked sold. A won deal
       with no date is not silently dropped into the year, it is counted
       in `won_undated` so the gap is visible. */
    COUNT(*) FILTER (
      WHERE l.status IN ('won', 'customer')
        AND l.order_date >= fy_start
        AND l.order_date < fy_start + INTERVAL '1 year')::INT,
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) FILTER (
      WHERE l.status IN ('won', 'customer')
        AND l.order_date >= fy_start
        AND l.order_date < fy_start + INTERVAL '1 year'),

    COUNT(*) FILTER (WHERE l.status = 'lost')::INT,
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.status = 'lost'),

    COUNT(*) FILTER (
      WHERE lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    COUNT(*) FILTER (
      WHERE l.status IN ('won', 'customer') AND l.order_date IS NULL)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_pipeline(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_pipeline(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- The headline: target, what counts towards it, and what does not.
--
-- From the scope:
--
--   For the personal target progress figure, direct Trailer Sales
--   revenue must not inflate the main portfolio target figure. The
--   business wants Trailer Sales visible, but separately.
--
-- So `target_revenue` excludes `trailer_sales` and `trailer_revenue`
-- carries it, and the two are never added together here. Whether they
-- are added together anywhere else is then a visible decision on a
-- screen rather than a hidden one in a sum.
--
--   Unknown figures must be null/not known, never zero.
--
-- Every figure below is NULL where there is nothing to say. `achieved`
-- is NULL when there is no target, because a percentage of nothing is
-- not nought, and dividing by it would be worse.
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
  to_go            NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fy      DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
  target  NUMERIC;
  tgt_rev NUMERIC;
  trl_rev NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO tgt_rev, trl_rev
    FROM personal_pipeline(p_person, p_when) p;

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
    /* Customers they hold a deal against, whatever its state. An
       existing customer with a new open deal counts once. */
    (SELECT COUNT(DISTINCT l.contact_id)::INT
       FROM crm_leads l WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL),
    (SELECT COALESCE(SUM(x.unpriced), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    /* No target, no percentage. Not nought per cent. */
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt_rev, 0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL
         ELSE ROUND(target - COALESCE(tgt_rev, 0), 2) END;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'a portfolio is the deals somebody owns, by id, not by name'; END $$;

-- -------------------------------------------------------------
-- Who in this person's portfolio is spending more, and who less.
--
-- From the scope:
--
--   These lists must change when the selected person changes. They must
--   not accidentally continue showing company-wide movers.
--
-- Which is the same fault migration 102 fixed for divisions, and it is
-- fixed the same way: the portfolio narrows the set BEFORE the ranking
-- and the LIMIT. Ranking first and filtering after would give the
-- company's biggest movers that happen to be in this portfolio, which is
-- a different question with a plausible looking answer.
--
-- The portfolio is the customers this person owns a tracker deal
-- against. `crm_leads.owner_id` is a real column pointing at a real
-- profile, so no name is matched anywhere in here.
--
-- The comparison is the same one the Analytics page uses: this
-- financial year to the same point, against the year before to the same
-- point. `customer_movement` is where that shape comes from and this
-- does not invent a second one.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_movers(UUID, DATE, INTEGER);
CREATE OR REPLACE FUNCTION personal_movers(
  p_person UUID,
  p_upto   DATE DEFAULT NULL,
  p_limit  INTEGER DEFAULT 20
)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  change_pct   NUMERIC,
  divisions    TEXT
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
     WHERE l.owner_id = p_person
       AND l.contact_id IS NOT NULL
  ),
  per_customer AS (
    SELECT a.contact_id,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS then_,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs
      FROM protean_accounts a
      JOIN protean_invoices i
        ON i.division = a.division AND i.alpha = a.alpha
      JOIN divisions d ON d.slug = a.division
      JOIN mine m ON m.contact_id = a.contact_id
     WHERE a.contact_id IS NOT NULL
       AND NOT a.ignored
     GROUP BY a.contact_id
  )
  SELECT p.contact_id, c.company_name, p.now_, p.then_,
         (p.now_ - p.then_)::NUMERIC,
         /* Null rather than infinity where there was nothing to grow
            from, the same as the company panel. */
         CASE WHEN p.then_ > 0
              THEN round(((p.now_ - p.then_) / p.then_) * 100, 1)
              ELSE NULL END,
         p.divs
    FROM per_customer p
    JOIN crm_contacts c ON c.id = p.contact_id AND c.deleted_at IS NULL
   WHERE p.now_ <> p.then_
   ORDER BY abs(p.now_ - p.then_) DESC
   LIMIT GREATEST(1, p_limit);
END;
$fn$;

REVOKE ALL ON FUNCTION personal_movers(UUID, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_movers(UUID, DATE, INTEGER) TO authenticated;
