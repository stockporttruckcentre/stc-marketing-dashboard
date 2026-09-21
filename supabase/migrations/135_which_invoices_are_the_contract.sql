-- =============================================================
-- 135. Which invoices are the contract. Asked, not guessed.
--
-- From the business:
--
--   you already know what the month FS+ charge will be against an
--   accepted contract, you need a checker that listens to invoices at
--   the same value for the same customer and it can ask me if the
--   invoice is contractual or not. It could come from any of the 3
--   divisions but 75% of the time it'll be STC
--
-- 134 had to count every invoice for the customer from the contract
-- start, ad hoc work included, because the export carries no
-- FleetSmart+ marker. This replaces that guess with an answer.
--
-- ---- How it works ----
--
--   The contract knows `monthly_total`. Any invoice for that contract's
--   customer, IN ANY DIVISION, whose net matches it becomes a
--   candidate. A person answers yes or no. The answer is written down
--   and never asked again.
--
--   STC first in the queue, because the business says three quarters
--   of them are STC and the quickest queue is the one already in the
--   likeliest order.
--
-- ---- Nothing counts until somebody says so ----
--
-- `value invoiced` is now the sum of invoices ANSWERED YES. Not
-- candidates, not near misses. An unanswered candidate contributes
-- nothing, because "we think this might be contractual" is not money
-- in the bank and must never be shown as though it were.
--
-- That means the figure starts at nought and climbs as the queue is
-- worked, which is the honest shape: it is a figure somebody has
-- stood behind, invoice by invoice.
-- =============================================================

-- -------------------------------------------------------------
-- The answer, remembered.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleetsmart_invoice_links (
  contract_id    UUID NOT NULL REFERENCES fleetsmart_contracts(id) ON DELETE CASCADE,
  division       TEXT NOT NULL REFERENCES divisions(slug),
  invoice_no     TEXT NOT NULL,
  is_contractual BOOLEAN NOT NULL,
  decided_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_id, division, invoice_no)
);

COMMENT ON TABLE fleetsmart_invoice_links IS
  'Whether one invoice is part of one FleetSmart+ contract. Answered by a person, '
  'once, and never asked again. Only TRUE rows count towards value invoiced.';

CREATE INDEX IF NOT EXISTS idx_fs_links_invoice
  ON fleetsmart_invoice_links (division, invoice_no);

ALTER TABLE fleetsmart_invoice_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fs_links_read" ON fleetsmart_invoice_links;
CREATE POLICY "fs_links_read" ON fleetsmart_invoice_links
  FOR SELECT USING (command_may('crm.view'));
GRANT SELECT ON fleetsmart_invoice_links TO authenticated;

-- -------------------------------------------------------------
-- The queue. Invoices that look like this contract's monthly charge.
--
-- Any division. STC first, because three in four are.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS fleetsmart_candidates(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION fleetsmart_candidates(
  p_owner     UUID DEFAULT NULL,
  p_tolerance NUMERIC DEFAULT 0.01
)
RETURNS TABLE (
  contract_id   UUID,
  ref           TEXT,
  customer_name TEXT,
  account_id    UUID,
  owner_id      UUID,
  monthly_total NUMERIC,
  division      TEXT,
  division_name TEXT,
  invoice_no    TEXT,
  tax_point     DATE,
  net           NUMERIC,
  exact         BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading the FleetSmart+ invoice queue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT f.id, f.ref, f.customer_name, f.account_id, f.owner_id, f.monthly_total,
         i.division, d.name, i.invoice_no, i.tax_point, i.net,
         (i.net = f.monthly_total)
    FROM fleetsmart_contracts f
    JOIN protean_invoices i
      ON invoice_customer(i.contact_id,
           (SELECT a.contact_id FROM protean_accounts a
             WHERE a.division = i.division AND a.alpha = i.alpha AND NOT a.ignored)
         ) = f.account_id
    JOIN divisions d ON d.slug = i.division
   WHERE f.status = 'accepted'
     AND f.account_id IS NOT NULL
     AND f.monthly_total > 0
     AND (p_owner IS NULL OR f.owner_id = p_owner)
     AND i.tax_point >= COALESCE(f.starts_on, f.decided_at::DATE, '1900-01-01')
     AND abs(i.net - f.monthly_total) <= GREATEST(COALESCE(p_tolerance, 0.01), 0)
     /* Already answered, either way. Asked once. */
     AND NOT EXISTS (
       SELECT 1 FROM fleetsmart_invoice_links k
        WHERE k.contract_id = f.id AND k.division = i.division
          AND k.invoice_no = i.invoice_no)
   /* Three in four are STC, so STC is at the top of the queue. */
   ORDER BY (i.division = 'stc') DESC, i.tax_point DESC, f.ref;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_candidates(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_candidates(UUID, NUMERIC) TO authenticated;

-- -------------------------------------------------------------
-- Answering one.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS fleetsmart_answer_invoice(UUID, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION fleetsmart_answer_invoice(
  p_contract UUID, p_division TEXT, p_invoice TEXT, p_contractual BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying whether an invoice is contractual needs permission to edit the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fleetsmart_contracts WHERE id = p_contract) THEN
    RAISE EXCEPTION 'There is no contract with that reference.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_invoices
                  WHERE division = p_division AND invoice_no = p_invoice) THEN
    RAISE EXCEPTION 'There is no % invoice %.', p_division, p_invoice;
  END IF;

  INSERT INTO fleetsmart_invoice_links
    (contract_id, division, invoice_no, is_contractual, decided_by, decided_at)
  VALUES (p_contract, p_division, p_invoice, p_contractual, auth.uid(), NOW())
  ON CONFLICT (contract_id, division, invoice_no) DO UPDATE
    SET is_contractual = EXCLUDED.is_contractual,
        decided_by = EXCLUDED.decided_by, decided_at = NOW();
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_answer_invoice(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_answer_invoice(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- Answering every outstanding one on a contract the same way.
--
-- A direct debit is the same figure every month, so once somebody has
-- said yes to one of them, saying it twelve more times is a chore
-- rather than a decision. Still a person pressing it, still written
-- down per invoice.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS fleetsmart_answer_all(UUID, BOOLEAN, NUMERIC);
CREATE OR REPLACE FUNCTION fleetsmart_answer_all(
  p_contract UUID, p_contractual BOOLEAN, p_tolerance NUMERIC DEFAULT 0.01
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying whether an invoice is contractual needs permission to edit the CRM.';
  END IF;

  INSERT INTO fleetsmart_invoice_links
    (contract_id, division, invoice_no, is_contractual, decided_by, decided_at)
  SELECT c.contract_id, c.division, c.invoice_no, p_contractual, auth.uid(), NOW()
    FROM fleetsmart_candidates(NULL, p_tolerance) c
   WHERE c.contract_id = p_contract
  ON CONFLICT (contract_id, division, invoice_no) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_answer_all(UUID, BOOLEAN, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_answer_all(UUID, BOOLEAN, NUMERIC) TO authenticated;

-- -------------------------------------------------------------
-- Value invoiced. ANSWERED YES ONLY.
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
         /* TRUE now: every penny in here was confirmed by a person. */
         TRUE
    FROM fleetsmart_invoice_links k
    JOIN protean_invoices i
      ON i.division = k.division AND i.invoice_no = k.invoice_no
   WHERE k.contract_id = p_contract
     AND k.is_contractual
     AND i.tax_point <= COALESCE(p_upto, CURRENT_DATE);
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_invoices_for(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_invoices_for(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- And how many are still waiting to be answered, so the screen can
-- say the figure is not finished rather than look finished.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS fleetsmart_waiting(UUID);
CREATE OR REPLACE FUNCTION fleetsmart_waiting(p_owner UUID DEFAULT NULL)
RETURNS TABLE (waiting INT, worth NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT count(*)::INT, COALESCE(SUM(c.net), 0)::NUMERIC
    FROM fleetsmart_candidates(p_owner, 0.01) c;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_waiting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_waiting(UUID) TO authenticated;

-- -------------------------------------------------------------
-- The headline, telling the truth about what it is made of.
--
-- 134 returned fs_contract_only FALSE because value invoiced was every
-- invoice for the customer. It is now only the answered ones, so it is
-- TRUE, and `fs_waiting` says how many are still unanswered. A figure
-- with a queue behind it says so rather than looking finished.
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
  fs_contract_only BOOLEAN, fs_waiting INT, fs_waiting_worth NUMERIC
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
  fs RECORD; q RECORD; nowv NUMERIC; wasw NUMERIC; fsn NUMERIC; fsw NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN RETURN; END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO trk, trl FROM personal_pipeline(p_person, p_when) p;

  SELECT * INTO fs FROM personal_fleetsmart_between(p_person, fy, fy_end);
  SELECT * INTO q  FROM fleetsmart_waiting(p_person);

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
    TRUE, COALESCE(q.waiting, 0), COALESCE(q.worth, 0);
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'an invoice counts towards a contract only once somebody has said it does';
END $$;
