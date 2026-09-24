-- =============================================================
-- 158. A figure off a sheet is not a deal somebody won, and a signed
--      FleetSmart+ contract is.
--
-- From the business, about Dean's portfolio:
--
--   We need to fix these alerts [...] as dean thinks he's got figures
--   missing.
--
-- Four warnings were on that screen. This migration is about the two
-- that were the application's fault rather than the data's.
--
-- =============================================================
-- WARNING THREE AND FOUR: "146 won deals have no order date, so they
-- are in no financial year and count towards no target"
-- =============================================================
--
-- That sentence was true and it was frightening and it was about
-- nothing. 134 of those 146 rows carry a sale price, £2,730,831.18 of
-- it, and not one of them is a deal. Every one says so in its own note:
--
--   Active maintenance account. The sheet says: Customer.
--   2025 FY revenue £508,830.31. Alpha code ROYALMAI.
--
-- `sale_price` on those rows is LAST YEAR'S REVENUE for that customer,
-- off the maintenance sheet, written there by the tracker importer
-- whose dictionary claims a column headed "invoice value" as a sale
-- price. The business caught the same fault once before:
--
--   That reads like dean's won 2.9m in revenue alone, he's not, it's
--   close to 100x less than that.
--
-- That time the fix was to stop the tracker counting a won row with no
-- order date. It worked, and it left this: a screen telling a rep that
-- 146 deals are missing from his target, when putting a date on any of
-- them would add last year's turnover to this year's figures.
--
-- ---- Why this is mechanical and not a judgement ----
--
-- The note states the figure. So the rows are found by comparing the
-- number in the note with the number in the column, and only a row
-- where THEY ARE EQUAL is touched. Measured before writing this:
--
--   138  rows whose note states an FY revenue
--   131  of those carry a sale price
--   131  where the sale price equals the note EXACTLY
--     0  where they disagree
--     0  that already have an order date
--     1  owner
--
-- Two of them are NEGATIVE, a credit note rather than a year's work:
-- "2025 FY revenue £-167.90". The first pass missed both because the
-- pattern did not allow a minus after the pound sign, and they are the
-- clearest possible proof that these rows are not deals: nobody wins a
-- deal worth minus a hundred pounds.
--
-- Nothing is deleted and nothing is guessed. The figure moves to a
-- column that says what it is, and `sale_price` is left empty because
-- nobody sold anything.
--
-- =============================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
-- =============================================================
--
-- The same screen warns that five records are "an insurer or other
-- payer rather than a customer": Allianz Claims, Control Expert C/O
-- Zurich, Oak Tyres, Protector Insurance and Solus Accident Repair.
-- That warning is right, and the obvious fix is wrong.
--
-- Marking every record whose name matches an `is_invoicing_type`
-- Protean account was tried and produced 39, among them Davies Turner,
-- Booker, Culina, Dawson Group, Montgomery, OCU Plant and Markovitz.
-- Those are real customers with real work against them, and calling
-- them payers would have taken some of this business's largest accounts
-- off every portfolio in the app.
--
-- `is_invoicing_type` marks two different things and cannot tell them
-- apart: a genuine conduit like Allianz, and a customer whose invoices
-- carry a site name and get split per site. Every one of the 38 is
-- unbound and every one has two or more distinct sites, so nothing in
-- the account data separates them.
--
-- The existing warning is narrower and it is correct: it fires only
-- where the record has NO money of its own AND its name matches an
-- invoicing type, which is why it found five and not thirty-nine. That
-- test stays exactly as it is until somebody says which of the 38 are
-- conduits, because it is a question about the business and not about
-- the data.

-- -------------------------------------------------------------
-- 1. What the sheet said, in a column that says so.
-- -------------------------------------------------------------
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sheet_revenue NUMERIC;

COMMENT ON COLUMN crm_leads.sheet_revenue IS
  'What a customer spent with the group in a past year, as stated on the sheet this '
  'row was imported from. It is NOT a deal, it has no order date and it must never '
  'reach a target. It arrived in sale_price because the tracker importer reads a '
  'column headed "invoice value" as a sale price. See migration 158.';

-- -------------------------------------------------------------
-- 2. Move it, and only where the row proves its own case.
-- -------------------------------------------------------------
DO $move$
DECLARE moved INT; money NUMERIC;
BEGIN
  WITH said AS (
    SELECT l.id, l.sale_price,
           (regexp_replace(m[1], '[^0-9\-]', '', 'g'))::NUMERIC / 100 AS stated
      FROM crm_leads l
      CROSS JOIN LATERAL regexp_match(l.notes, 'FY revenue £(-?[0-9,]+\.[0-9]{2})') AS m
     WHERE l.notes LIKE '%The sheet says:%'
       AND l.sale_price IS NOT NULL
       AND l.order_date IS NULL
       AND l.sheet_revenue IS NULL
  ), doit AS (
    UPDATE crm_leads l
       SET sheet_revenue = l.sale_price, sale_price = NULL, updated_at = NOW()
      FROM said s
     WHERE l.id = s.id AND s.stated = l.sale_price
     RETURNING l.sheet_revenue
  )
  SELECT count(*), COALESCE(ROUND(SUM(sheet_revenue), 2), 0) INTO moved, money FROM doit;

  RAISE NOTICE 'moved % sheet figures worth % out of sale_price', moved, money;
END $move$;

-- -------------------------------------------------------------
-- 3. The pipeline stops counting sheet rows as deals.
--
-- A sheet row has no figure of its own, so before this it would have
-- become `unpriced` the moment its sale price moved. It is not an
-- unpriced deal. It is not a deal.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.personal_pipeline(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_pipeline(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(lead_type text, open_count integer, open_total numeric, won_count integer,
              won_total numeric, lost_count integer, lost_total numeric,
              unpriced integer, won_undated integer, off_a_sheet integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE fy_start DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    l.type,
    COUNT(*) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INT,
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted')),

    COUNT(*) FILTER (
      WHERE l.status = 'won'
        AND l.order_date >= fy_start
        AND l.order_date < fy_start + INTERVAL '1 year')::INT,
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) FILTER (
      WHERE l.status = 'won'
        AND l.order_date >= fy_start
        AND l.order_date < fy_start + INTERVAL '1 year'),

    COUNT(*) FILTER (WHERE l.status = 'lost')::INT,
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.status = 'lost'),

    /* A row off a sheet is not a deal anybody has failed to price. */
    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    /* Nor is it a win anybody has failed to date. */
    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won' AND l.order_date IS NULL)::INT,

    COUNT(*) FILTER (WHERE l.sheet_revenue IS NOT NULL)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$fn$;

-- =============================================================
-- 4. ACCEPTING A FLEETSMART+ CONTRACT NOW DATES ITS DEAL
--
-- From the business:
--
--   This is also not showing any of the FS+ I have onboarded over the
--   last couple of weeks mate.
--
--   All Fleetsmart+ contracts auto-create their own tracker entry so
--   they certainly should be there.
--
-- Both true. Every contract does have its tracker entry, and four
-- accepted ones worth £38,254.52 were sitting on one person's tracker
-- reading "won" with a sale price against them. The Maintenance and STC
-- row still said "Won this year: Not known".
--
-- `fleetsmart_moves_its_lead` sets the status and moves the money from
-- `estimated_value` to `sale_price`, and NEVER SETS `order_date`. Every
-- screen in this application that counts won work requires one, because
-- of the fault migration 134 fixed: an imported spend figure has no
-- order date, a deal somebody won on a day does. So a signed contract
-- fell through the same gate built to keep sheet figures out.
--
-- The contract already knows the day. `decided_at` is the day the
-- customer answered, which is what an order date IS.
--
-- COALESCE keeps a date somebody typed by hand: this fills a gap, it
-- does not overrule anybody.
--
-- ---- Why this is the fix and not a change to the panel ----
--
-- `personal_fleetsmart_between` already refuses to count a contract
-- whose lead is won AND DATED, which is how migration 133 stops
-- FleetSmart+ being added twice. That guard has been reading FALSE for
-- every contract ever accepted, because no lead ever got a date. Give
-- the lead its date and the tracker counts it, the guard fires, and the
-- two screens agree. Adding FleetSmart+ to the panel separately would
-- have papered over that and risked counting it twice.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fleetsmart_moves_its_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  words JSONB;
  state TEXT;
BEGIN
  IF fleetsmart_syncing() THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.annual_total IS NOT DISTINCT FROM OLD.annual_total
     AND NEW.asset_count IS NOT DISTINCT FROM OLD.asset_count
     AND NEW.plan IS NOT DISTINCT FROM OLD.plan
     AND NEW.term_months IS NOT DISTINCT FROM OLD.term_months THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('stc.fleetsmart_sync', 'on', true);

  words := fleetsmart_lead_words(NEW);
  state := fleetsmart_lead_state(NEW.status);

  UPDATE crm_leads SET
    status = COALESCE(state, status),
    requirement = words ->> 'requirement',
    notes = words ->> 'notes',
    estimated_value = CASE WHEN NEW.status = 'accepted'
                           THEN NULL ELSE NULLIF(NEW.annual_total, 0) END,
    sale_price = CASE WHEN NEW.status = 'accepted'
                      THEN NULLIF(NEW.annual_total, 0) ELSE NULL END,
    order_date = CASE WHEN NEW.status = 'accepted'
                      THEN COALESCE(order_date, NEW.decided_at::DATE, CURRENT_DATE)
                      ELSE order_date END,
    last_activity_at = NOW()
  WHERE id = NEW.lead_id;

  PERFORM set_config('stc.fleetsmart_sync', '', true);
  RETURN NEW;
END;
$fn$;

-- -------------------------------------------------------------
-- 5. And the ones already accepted, which have been invisible since
--    the day they were signed.
-- -------------------------------------------------------------
DO $backfill$
DECLARE dated INT; money NUMERIC;
BEGIN
  WITH doit AS (
    UPDATE crm_leads l
       SET order_date = c.decided_at::DATE, last_activity_at = NOW()
      FROM fleetsmart_contracts c
     WHERE c.lead_id = l.id
       AND c.status = 'accepted'
       AND c.decided_at IS NOT NULL
       AND l.status = 'won'
       AND l.order_date IS NULL
     RETURNING l.sale_price
  )
  SELECT count(*), COALESCE(ROUND(SUM(sale_price), 2), 0) INTO dated, money FROM doit;

  RAISE NOTICE 'dated % accepted FleetSmart+ deals worth %', dated, money;
END $backfill$;

DO $$ BEGIN
  RAISE NOTICE 'a sheet figure is not a deal, and a signed contract now has the day it was signed on it';
END $$;
