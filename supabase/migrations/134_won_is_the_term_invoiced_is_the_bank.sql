-- =============================================================
-- 134. Value won is the term. Value invoiced is what is in the bank.
--
-- From the business, deciding what 133 left open:
--
--   contract is term value not annual. It needs 2 cards, value won and
--   value invoiced. value won is the term. value invoiced is what we
--   have actually billed as per the direct debit from the revenue tab
--   imports. This is what shows against dean's actual figure, money
--   that's in the bank from the contract.
--
-- So two figures, and only one of them is his actual figure:
--
--   VALUE WON       annual_total * term_months / 12. The whole
--                   commitment, the moment the customer accepts.
--   VALUE INVOICED  real invoices out of the uploads, which is money
--                   received. THIS is what counts towards the target.
--
-- 133 put the annual value into `target_revenue`. That was my
-- assumption and it was wrong on both counts: wrong figure, and won
-- work is not what the target measures. This corrects it.
--
-- ---- HOW AN FS+ INVOICE IS RECOGNISED, AND ITS ONE LIMIT ----
--
-- The uploads carry no FleetSmart+ marker. The only link between a
-- contract and an invoice that exists in this database is the
-- customer, so value invoiced is:
--
--   invoices for the contract's customer, dated on or after the
--   contract starts, up to the date asked about
--
-- WHICH MEANS AD HOC WORK FOR THE SAME CUSTOMER IS IN IT. That is
-- stated on the screen rather than hidden, and `contract_only` is
-- FALSE on every row to say so. When the business says how an FS+
-- invoice is told apart on the export, a nominal code, a reference, a
-- job type, it goes in `fleetsmart_invoices_for` and nowhere else,
-- and every figure narrows with it.
-- =============================================================

-- -------------------------------------------------------------
-- Value won. The term, not the year.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_worth(p_annual NUMERIC, p_term INT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  /* The whole commitment. The business: "value won is the term". */
  SELECT ROUND(p_annual * (COALESCE(p_term, 12)::NUMERIC / 12.0), 2);
$fn$;

COMMENT ON FUNCTION fleetsmart_worth(NUMERIC, INT) IS
  'What an accepted FleetSmart+ contract is worth: the whole term. Value won, '
  'which is reported beside the target and is not the figure measured against it.';

-- -------------------------------------------------------------
-- What has actually been billed against a contract.
--
-- Separate function so the definition lives in one place and narrows
-- in one place the day the export tells us which invoice is which.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS fleetsmart_invoices_for(UUID, DATE);
CREATE OR REPLACE FUNCTION fleetsmart_invoices_for(p_contract UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (net NUMERIC, invoices INT, contract_only BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(SUM(i.net), 0)::NUMERIC,
         count(*)::INT,
         /* FALSE until the export can tell an FS+ invoice from other
            work for the same customer. Said out loud, not assumed. */
         FALSE
    FROM fleetsmart_contracts f
    LEFT JOIN protean_invoices i
      ON invoice_customer(i.contact_id,
           (SELECT a.contact_id FROM protean_accounts a
             WHERE a.division = i.division AND a.alpha = i.alpha AND NOT a.ignored)
         ) = f.account_id
     AND i.tax_point >= COALESCE(f.starts_on, f.decided_at::DATE, '1900-01-01')
     AND i.tax_point <= COALESCE(p_upto, CURRENT_DATE)
   WHERE f.id = p_contract;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_invoices_for(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_invoices_for(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- One person's FleetSmart+, both figures.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_fleetsmart_between(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION personal_fleetsmart_between(
  p_person UUID, p_from DATE, p_to DATE
)
RETURNS TABLE (
  value_won      NUMERIC,
  value_invoiced NUMERIC,
  contracts      INT,
  counted_on_tracker INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    SUM(f.won)      FILTER (WHERE NOT f.dup),
    SUM(f.billed)   FILTER (WHERE NOT f.dup),
    count(*)        FILTER (WHERE NOT f.dup)::INT,
    count(*)        FILTER (WHERE f.dup)::INT
  FROM (
    SELECT fleetsmart_worth(c.annual_total, c.term_months) AS won,
           (SELECT v.net FROM fleetsmart_invoices_for(c.id, p_to) v) AS billed,
           (c.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM crm_leads l
               WHERE l.id = c.lead_id AND l.status IN ('won','customer')
                 AND l.order_date IS NOT NULL)) AS dup
      FROM fleetsmart_contracts c
     WHERE c.owner_id = p_person
       AND c.status = 'accepted'
       AND c.decided_at IS NOT NULL
       AND c.decided_at::DATE >= p_from
       AND c.decided_at::DATE <= p_to
       AND personal_analytics_may_view(p_person)
  ) f;
$fn$;

REVOKE ALL ON FUNCTION personal_fleetsmart_between(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_fleetsmart_between(UUID, DATE, DATE) TO authenticated;

-- -------------------------------------------------------------
-- The headline. Value invoiced is the one that counts.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_overview(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_overview(p_person UUID, p_when DATE DEFAULT NULL)
RETURNS TABLE (
  person_id UUID, full_name TEXT, financial_year DATE,
  fy_target NUMERIC, target_revenue NUMERIC, trailer_revenue NUMERIC,
  open_pipeline NUMERIC, open_deals INT, won_deals INT, lost_deals INT,
  customers INT, unpriced INT, won_undated INT,
  achieved NUMERIC, to_go NUMERIC,
  won_to_date NUMERIC, last_year_won NUMERIC,
  won_change NUMERIC, won_change_pct NUMERIC,
  tracker_revenue NUMERIC,
  fs_value_won NUMERIC, fs_value_invoiced NUMERIC, fs_contracts INT,
  fs_contract_only BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto   DATE := COALESCE(p_when, CURRENT_DATE);
  fy     DATE := financial_year_of(upto);
  fy0    DATE := (fy - INTERVAL '1 year')::DATE;
  cut    DATE := (upto - INTERVAL '1 year')::DATE;
  fy_end DATE := (fy + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
  target NUMERIC; trk NUMERIC; trl NUMERIC; tgt NUMERIC;
  fs RECORD; nowv NUMERIC; wasw NUMERIC; fsn NUMERIC; fsw NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN RETURN; END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO trk, trl FROM personal_pipeline(p_person, p_when) p;

  SELECT * INTO fs FROM personal_fleetsmart_between(p_person, fy, fy_end);

  /* MONEY IN THE BANK IS WHAT COUNTS. The business: "value invoiced
     [...] is what shows against dean's actual figure". Value won sits
     beside it and is never added in. */
  tgt := CASE WHEN trk IS NULL AND fs.value_invoiced IS NULL THEN NULL
              ELSE COALESCE(trk, 0) + COALESCE(fs.value_invoiced, 0) END;

  SELECT w.target_revenue INTO nowv FROM personal_won_between(p_person, fy, upto) w;
  SELECT w.target_revenue INTO wasw FROM personal_won_between(p_person, fy0, cut) w;
  SELECT f.value_invoiced INTO fsn FROM personal_fleetsmart_between(p_person, fy, upto) f;
  SELECT f.value_invoiced INTO fsw FROM personal_fleetsmart_between(p_person, fy0, cut) f;
  nowv := CASE WHEN nowv IS NULL AND fsn IS NULL THEN NULL
               ELSE COALESCE(nowv, 0) + COALESCE(fsn, 0) END;
  wasw := CASE WHEN wasw IS NULL AND fsw IS NULL THEN NULL
               ELSE COALESCE(wasw, 0) + COALESCE(fsw, 0) END;

  RETURN QUERY SELECT
    p_person,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = p_person),
    fy, target, tgt, trl,
    (SELECT SUM(x.open_total) FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.open_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.lost_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COUNT(DISTINCT l.contact_id)::INT FROM crm_leads l
      WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL),
    (SELECT COALESCE(SUM(x.unpriced),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated),0)::INT FROM personal_pipeline(p_person, p_when) x),
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt,0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL ELSE ROUND(target - COALESCE(tgt,0), 2) END,
    nowv, wasw,
    CASE WHEN wasw IS NULL THEN NULL ELSE ROUND(COALESCE(nowv,0) - wasw, 2) END,
    CASE WHEN COALESCE(wasw,0) > 0
         THEN ROUND(((COALESCE(nowv,0) - wasw) / wasw) * 100, 1) ELSE NULL END,
    trk,
    fs.value_won, fs.value_invoiced, COALESCE(fs.contracts, 0),
    FALSE;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'value won is the term, value invoiced is the money, and only the money counts';
END $$;
