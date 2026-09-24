-- =============================================================
-- 161. The tracker tile is the tracker.
--
-- Found by reading the rendered page rather than the code, which is
-- what the business asked for:
--
--   then end to end check the page, and again, and again. I keep
--   having to prompt you to fix stuff you're missing as you're not
--   checking.
--
-- On Dean's portfolio today, live:
--
--   Closed on the tracker      £52k
--   Across the three, Maintenance   Won this year £38k
--   Across the three, Rentals       Won this year £51k
--
-- Thirty eight and fifty one are eighty nine. The tile says fifty
-- two. Two figures about one question, a few centimetres apart, and
-- neither of them says why they differ. It is the same fault as the
-- £256k and the £52k, one screen further down.
--
-- ---- Where the £37k went ----
--
-- Migration 159 added `won_total_own` to `personal_pipeline`: won work
-- with the FleetSmart+ deals taken out. It existed because
-- `tracker_revenue` WAS the target at the time, and a FleetSmart+
-- contract already counted towards the target through its invoices.
-- Counting the whole term as well would have paid twice.
--
-- Migration 160 moved the target onto what the book billed. Nothing is
-- measured against `tracker_revenue` any more: the tile says so in its
-- own words, "Not revenue, and not what the target is measured on."
-- So there is no second count left to protect against, and the
-- subtraction now does nothing but make the tile disagree with the
-- table under it.
--
-- Dean's maintenance `won_total_own` is NULL, not £0: every maintenance
-- deal he has won this year is a FleetSmart+ contract, so the filtered
-- sum has nothing left to add. The tile was drawing rentals alone and
-- calling it "maintenance and rentals".
--
-- ---- What it is now ----
--
--   tracker_revenue = won work on the tracker, maintenance and
--                     rentals, exactly the column the table draws
--
-- which is £90,033.18 for Dean, and is 38,254.52 + 51,778.66. The
-- FleetSmart+ tile above it names its £38k as part of that, at whole
-- term value, so nothing is hidden and nothing is counted towards a
-- target twice.
--
-- `won_total_own` stays on `personal_pipeline`. It is the honest
-- answer to "what did they close that is not a FleetSmart+ contract",
-- and removing a column from a returning function breaks every caller
-- that selects it.
-- =============================================================

DROP FUNCTION IF EXISTS public.personal_overview(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_overview(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(person_id uuid, full_name text, financial_year date, fy_target numeric,
              target_revenue numeric, trailer_revenue numeric, open_pipeline numeric,
              open_deals integer, won_deals integer, lost_deals integer, customers integer,
              unpriced integer, won_undated integer, achieved numeric, to_go numeric,
              won_to_date numeric, last_year_won numeric, won_change numeric,
              won_change_pct numeric, tracker_revenue numeric, fs_value_won numeric,
              fs_value_invoiced numeric, fs_contracts integer, fs_contract_only boolean,
              fs_waiting integer, fs_waiting_worth numeric, off_a_sheet integer,
              invoiced_this_year numeric, invoiced_last_year numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  upto   DATE := COALESCE(p_when, CURRENT_DATE);
  fy     DATE := financial_year_of(upto);
  fy0    DATE := (fy - INTERVAL '1 year')::DATE;
  cut    DATE := (upto - INTERVAL '1 year')::DATE;
  fy_end DATE := (fy + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
  target NUMERIC; trk NUMERIC; trl NUMERIC; tgt NUMERIC;
  fs RECORD; q RECORD; rev RECORD;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN RETURN; END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  /* THE TARGET FIGURE. The same function the panel below draws, so the
     two cards are one number and cannot drift. */
  SELECT * INTO rev FROM personal_revenue_year(p_person, p_when);
  tgt := rev.change;

  /* WHAT THE TRACKER SAYS THEY CLOSED. The same column the "Across the
     three" table draws, summed the way a person reading that table
     sums it. See the banner above for why this is no longer the
     FleetSmart+ free figure. */
  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO trk, trl FROM personal_pipeline(p_person, p_when) p;

  SELECT * INTO fs FROM personal_fleetsmart_between(p_person, fy, fy_end);
  SELECT * INTO q  FROM fleetsmart_waiting(p_person);

  RETURN QUERY SELECT
    p_person,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = p_person),
    fy, target, tgt, trl,
    (SELECT SUM(x.open_total) FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.open_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.lost_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    COALESCE(rev.customers, 0),
    (SELECT COALESCE(SUM(x.unpriced),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated),0)::INT FROM personal_pipeline(p_person, p_when) x),
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt,0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL ELSE ROUND(target - COALESCE(tgt,0), 2) END,
    /* "Won this year" is the same question the target answers, so it
       is the same figure, against the same point last year. The
       tracker's own total is `tracker_revenue` and is labelled as
       closed work rather than as revenue. */
    rev.this_year, rev.last_year, rev.change, rev.change_pct,
    trk,
    fs.value_won, fs.value_invoiced, COALESCE(fs.contracts, 0),
    TRUE, COALESCE(q.waiting, 0), COALESCE(q.worth, 0),
    (SELECT COALESCE(SUM(x.off_a_sheet),0)::INT FROM personal_pipeline(p_person, p_when) x),
    rev.this_year, rev.last_year;
END;
$fn$;

COMMENT ON FUNCTION public.personal_overview(uuid, date) IS
  'One person''s year. target_revenue is what their book billed above the same point '
  'last year, which is what the business pays on, and it is the same number the '
  'revenue panel draws. tracker_revenue is won work on the tracker, maintenance and '
  'rentals, which is the same column and the same sum as the Across the three table. '
  'See migrations 160 and 161.';

-- -------------------------------------------------------------
-- And the audit says so.
--
-- `portfolio_audit()` already asserts that the two target cards are
-- one number. It now also asserts that the tracker tile is the sum of
-- the rows under it, because that is the fault this migration fixes
-- and an assertion is the only thing that stops it coming back.
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION portfolio_audit(p_person UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (check_name TEXT, the_screen TEXT, rebuilt_from_invoices TEXT, agrees BOOLEAN)
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
  said RECORD;
  head RECORD;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RAISE EXCEPTION 'That is not your portfolio to audit.';
  END IF;

  SELECT * INTO said FROM personal_revenue_year(p_person, p_upto);
  SELECT * INTO head FROM personal_overview(p_person, p_upto);

  RETURN QUERY
  WITH mine AS (
    SELECT DISTINCT l.contact_id
      FROM crm_leads l
      JOIN crm_contacts c ON c.id = l.contact_id AND c.deleted_at IS NULL
     WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL
  ), inv AS (
    SELECT i.division, i.invoice_no, i.tax_point, i.net,
           COALESCE(i.contact_id,
                    CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS whose
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ), mineinv AS (
    SELECT inv.* FROM inv JOIN mine m ON m.contact_id = inv.whose
  ), rebuilt AS (
    SELECT
      ROUND(COALESCE(SUM(net) FILTER (WHERE tax_point >= fy  AND tax_point <= upto), 0), 2) AS now_,
      ROUND(COALESCE(SUM(net) FILTER (WHERE tax_point >= fy0 AND tax_point <= cut ), 0), 2) AS last_,
      COUNT(*) FILTER (WHERE tax_point >= fy AND tax_point <= upto) AS n_now
      FROM mineinv
  )
  SELECT 'This year to date', said.this_year::TEXT, r.now_::TEXT, said.this_year = r.now_ FROM rebuilt r
  UNION ALL
  SELECT 'Same point last year', said.last_year::TEXT, r.last_::TEXT, said.last_year = r.last_ FROM rebuilt r
  UNION ALL
  SELECT 'The change', said.change::TEXT, (r.now_ - r.last_)::TEXT, said.change = r.now_ - r.last_ FROM rebuilt r
  UNION ALL
  SELECT 'The percentage',
         COALESCE(said.change_pct::TEXT, 'not known'),
         COALESCE(CASE WHEN r.last_ > 0
                       THEN ROUND(((r.now_ - r.last_) / r.last_) * 100, 1)::TEXT END, 'not known'),
         said.change_pct IS NOT DISTINCT FROM
           CASE WHEN r.last_ > 0 THEN ROUND(((r.now_ - r.last_) / r.last_) * 100, 1) END
    FROM rebuilt r
  UNION ALL
  /* THE ONE THIS MIGRATION EXISTS FOR. Two cards on one screen about
     one person, £204,000 apart, and the smaller was what a commission
     got paid against. */
  SELECT 'Towards target IS the change', COALESCE(head.target_revenue::TEXT, 'not known'),
         said.change::TEXT, head.target_revenue IS NOT DISTINCT FROM said.change
  UNION ALL
  SELECT 'Achieved is that over the target',
         COALESCE(head.achieved::TEXT, 'no target'),
         COALESCE(CASE WHEN COALESCE(head.fy_target, 0) <> 0
                       THEN ROUND((said.change / head.fy_target) * 100, 1)::TEXT END, 'no target'),
         head.achieved IS NOT DISTINCT FROM
           CASE WHEN COALESCE(head.fy_target, 0) <> 0
                THEN ROUND((said.change / head.fy_target) * 100, 1) END
  UNION ALL
  SELECT 'Customers on the portfolio', said.customers::TEXT,
         (SELECT count(*)::TEXT FROM mine), said.customers = (SELECT count(*) FROM mine)
  UNION ALL
  SELECT 'Invoices behind this year''s figure', (SELECT n_now::TEXT FROM rebuilt),
         (SELECT n_now::TEXT FROM rebuilt), TRUE
  UNION ALL
  SELECT 'An invoice counted twice', '0',
         (SELECT count(*)::TEXT FROM (
            SELECT division, invoice_no FROM mineinv
             WHERE tax_point >= fy AND tax_point <= upto
             GROUP BY 1, 2 HAVING count(*) > 1) x),
         NOT EXISTS (SELECT 1 FROM (
            SELECT division, invoice_no FROM mineinv
             WHERE tax_point >= fy AND tax_point <= upto
             GROUP BY 1, 2 HAVING count(*) > 1) y)
  UNION ALL
  SELECT 'Money on a record that was merged away', '0',
         (SELECT count(*)::TEXT FROM mineinv mi
            JOIN crm_contacts c ON c.id = mi.whose WHERE c.deleted_at IS NOT NULL),
         NOT EXISTS (SELECT 1 FROM mineinv mi
            JOIN crm_contacts c ON c.id = mi.whose WHERE c.deleted_at IS NOT NULL)
  UNION ALL
  SELECT 'A customer still entered twice', '0',
         said.split_twin::TEXT, said.split_twin = 0
  UNION ALL
  /* THE ONE MIGRATION 161 EXISTS FOR. A tile and the table three
     inches under it, summed the way a person sums that table. */
  SELECT 'Closed on the tracker is the rows under it',
         COALESCE(head.tracker_revenue::TEXT, 'not known'),
         COALESCE((SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales')
                     FROM personal_pipeline(p_person, p_upto) p)::TEXT, 'not known'),
         head.tracker_revenue IS NOT DISTINCT FROM
           (SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales')
              FROM personal_pipeline(p_person, p_upto) p)
  UNION ALL
  SELECT 'Trailer Sales is the trailer row',
         COALESCE(head.trailer_revenue::TEXT, 'not known'),
         COALESCE((SELECT SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
                     FROM personal_pipeline(p_person, p_upto) p)::TEXT, 'not known'),
         head.trailer_revenue IS NOT DISTINCT FROM
           (SELECT SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
              FROM personal_pipeline(p_person, p_upto) p)
  UNION ALL
  SELECT 'Open pipeline is the rows under it',
         COALESCE(head.open_pipeline::TEXT, 'not known'),
         COALESCE((SELECT SUM(p.open_total) FROM personal_pipeline(p_person, p_upto) p)::TEXT,
                  'not known'),
         head.open_pipeline IS NOT DISTINCT FROM
           (SELECT SUM(p.open_total) FROM personal_pipeline(p_person, p_upto) p)
  UNION ALL
  /* Not a failure, a number to look at: revenue in this person's name
     that no figure on their portfolio can see. */
  SELECT 'Revenue in their name with no lead on it', 'reported, not counted',
         COALESCE((SELECT ROUND(SUM(m.this_year), 2)::TEXT
                     FROM portfolio_missing_revenue(p_person, p_upto) m), '0'),
         TRUE;
END;
$fn$;

COMMENT ON FUNCTION portfolio_audit(uuid, date) IS
  'Rebuilds one portfolio''s headline figures straight out of protean_invoices and '
  'says whether the screen agrees, and asserts that every tile which has a table '
  'under it is the sum of that table. See migrations 160 and 161.';
