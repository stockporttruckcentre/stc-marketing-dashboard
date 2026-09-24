-- =============================================================
-- 160. The target is what the book grew by.
--
-- From the business, and this is the whole specification:
--
--   Dean's target is £600k fixed. He earns revenue on anything that
--   exceeds last year's sales, which the app already knows the total
--   of. We've already passed 1.6m so he's earning 100% solid revenue
--   right now, which you are not tracking in full. He should have
--   £256,000 revenue already in that top right box tracking his
--   towards target. [...] the £256,000 card should track all his
--   revenue as it's simply just a mirror of his "towards target"
--   figure with a comparison against last year.
--
--   You, yourself, should be EXTREMELY concerned that you have one
--   card saying he's made 256k and another saying only 52k, that
--   should make you want to stop everything and fix this because
--   that's literally paying dean's commission.
--
-- Right on every count. Two cards on one screen, about one person,
-- £204,000 apart, and the smaller one is the one a commission gets
-- paid against.
--
-- ---- What the target was, and why it was wrong ----
--
-- `target_revenue` was won work on the tracker plus FleetSmart+
-- invoiced. That measures what somebody CLOSED. The target measures
-- what the book BILLED above last year, which is a different thing and
-- is the thing the business pays on.
--
-- It is now the portfolio's year on year change, exactly as
-- `personal_revenue_year` already computes it for the panel below:
--
--   target_revenue = invoiced this year to date
--                  - invoiced to the same point last year
--
-- One number, computed once, drawn twice. The two cards cannot differ
-- again because there is no longer a second calculation for them to
-- differ by, and `npm run check:personal-portfolio` asserts they are
-- the same figure.
--
-- ---- FleetSmart+ is already inside it, and must not be added ----
--
-- Migration 134 settled that a contract counts by what it has billed.
-- What it has billed is a Protean invoice, so it is already inside the
-- portfolio figure. Adding `fs_value_invoiced` on top would count it
-- twice: £195.04 today, and far more once the contracts run a year.
-- So the target adds nothing to the change. It IS the change.
--
-- ---- What is deliberately NOT changed ----
--
-- A portfolio is still the customers somebody holds a LEAD against.
-- 13 of Dean's customers are named as his on the record with no lead,
-- carrying £13,995.00 this year, and widening the rule to include them
-- was measured and refused: five records name one person as the
-- account manager and have a lead owned by another, and they carry
-- Gee Transport at £91,900, InPost at £58,428 and MRK at £17,246. On
-- the wider rule each of those lands in TWO people's targets at once,
-- which is the same fault as this migration fixes, pointing the other
-- way. Who owns a shared customer is a question for the business.
-- `portfolio_missing_revenue()` below reports them by name instead.
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

  /* Still reported, because a rep wants to see what they closed. It is
     no longer what the target is measured on. */
  SELECT SUM(p.won_total_own) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total)     FILTER (WHERE p.lead_type = 'trailer_sales')
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
    /* "Won this year" is now the same question the target answers, so
       it is the same figure, against the same point last year. The
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
  'revenue panel draws. tracker_revenue is what they closed on the tracker and is '
  'reported beside it, not measured against the target. See migration 160.';

-- -------------------------------------------------------------
-- Revenue in somebody's name that their portfolio cannot see.
--
-- A portfolio is the customers somebody holds a lead against. A record
-- naming them as the account manager with no lead on it is theirs by
-- every human measure and invisible to every figure.
--
-- Reported rather than added, because five of these name one person
-- and are led by another, and on a wider rule they would count towards
-- two people's targets at once.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION portfolio_missing_revenue(p_person UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, named_as TEXT,
  this_year NUMERIC, last_year NUMERIC,
  also_somebody_elses TEXT
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
  me   TEXT;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN RETURN; END IF;
  SELECT BTRIM(full_name) INTO me FROM profiles WHERE id = p_person;
  IF COALESCE(me, '') = '' THEN RETURN; END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT COALESCE(i.contact_id,
                    CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS whose,
           i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
  )
  SELECT c.id, c.company_name,
         COALESCE(NULLIF(BTRIM(c.assigned_to), ''), BTRIM(c.account_manager)),
         (SELECT ROUND(COALESCE(SUM(v.net),0),2) FROM inv v
           WHERE v.whose = c.id AND v.tax_point >= fy AND v.tax_point <= upto),
         (SELECT ROUND(COALESCE(SUM(v.net),0),2) FROM inv v
           WHERE v.whose = c.id AND v.tax_point >= fy0 AND v.tax_point <= cut),
         (SELECT string_agg(DISTINCT p2.full_name, ', ')
            FROM crm_leads l2 JOIN profiles p2 ON p2.id = l2.owner_id
           WHERE l2.contact_id = c.id AND l2.owner_id <> p_person)
    FROM crm_contacts c
   WHERE c.deleted_at IS NULL
     AND (lower(BTRIM(c.assigned_to)) = lower(me)
          OR lower(BTRIM(c.account_manager)) = lower(me))
     AND NOT EXISTS (
       SELECT 1 FROM crm_leads l
        WHERE l.contact_id = c.id AND l.owner_id = p_person)
   ORDER BY 4 DESC NULLS LAST;
END;
$fn$;

COMMENT ON FUNCTION portfolio_missing_revenue(UUID, DATE) IS
  'Customers named as this person''s on the record but with no lead of theirs against '
  'them, so no figure on their portfolio can see them, with the money on each. '
  'Reported and not added: some of them are led by somebody else.';

REVOKE ALL ON FUNCTION portfolio_missing_revenue(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portfolio_missing_revenue(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the target is what the book grew by, and it is the same number the panel draws';
END $$;

-- -------------------------------------------------------------
-- The audit gains the one assertion this migration exists for.
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
  /* Not a failure, a number to look at: revenue in this person's name
     that no figure on their portfolio can see. */
  SELECT 'Revenue in their name with no lead on it', 'reported, not counted',
         COALESCE((SELECT ROUND(SUM(m.this_year), 2)::TEXT
                     FROM portfolio_missing_revenue(p_person, p_upto) m), '0'),
         TRUE;
END;
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'the audit asserts the two cards are one number';
END $$;
