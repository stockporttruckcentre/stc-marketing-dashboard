-- =============================================================
-- 079. What a customer has spent, on the customer.
--
-- From the business:
--
--   ensure this updates CRM records too with an open jobs section,
--   revnue last year vs this year, jobs invoiced total this financial
--   year etc. The data is there so it should be interconnected
--
-- The data has been there since 075. Until now the only screen that
-- read it was the revenue screen, which means somebody looking at
-- Dawson had to go and find Dawson somewhere else to see what Dawson
-- spends. This is the join.
--
-- ---- One call, not five ----
--
-- `protean_spend`, `protean_open_work` and `protean_accounts_of` all
-- exist and all still work. A drawer opening five round trips draws in
-- five stages though, and a figure that lands after the one next to it
-- gets read as the one next to it. So the headline is one row from one
-- call, and the three detail functions are for when somebody opens the
-- detail.
--
-- ---- The financial year ----
--
-- "This financial year" is a real question with a company specific
-- answer, and guessing it would put a wrong figure on a customer record
-- with nothing to say it was a guess. April is the usual answer for a
-- UK company and usual is not a fact.
--
-- So it is a setting, on the single row of `tenant_settings`, and it
-- defaults to January. January is not a claim that the year starts in
-- January: it is the one value that makes the financial figure and the
-- calendar figure agree, so an unconfigured installation shows the same
-- number twice rather than a second number nobody has checked.
--
-- Change the month and every screen follows. Nothing reads a hardcoded
-- one.
--
-- ---- Last year means the same point last year ----
--
-- For the reason in 075 and 076. This year is only complete to today,
-- so measured against a whole previous year every customer in the book
-- reads as a collapse. On the real export the difference is £474,727 up
-- against £1.88m down, on identical rows.
-- =============================================================

-- -------------------------------------------------------------
-- 1. When the year starts.
-- -------------------------------------------------------------
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS financial_year_start_month SMALLINT NOT NULL DEFAULT 1
    CHECK (financial_year_start_month BETWEEN 1 AND 12);

COMMENT ON COLUMN tenant_settings.financial_year_start_month IS
  'The month the financial year begins, 1 to 12. Defaults to January so '
  'that an unconfigured installation shows the calendar year twice rather '
  'than an unchecked second figure.';

/**
 * The financial year containing a date, as its first day.
 *
 * A year starting in April means 1 April 2026 to 31 March 2027, and a
 * date in February 2027 belongs to the year that began in April 2026.
 * That is the whole of the arithmetic and it is the part that is easy
 * to get one out.
 */
CREATE OR REPLACE FUNCTION financial_year_of(p_when DATE)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT make_date(
    EXTRACT(YEAR FROM p_when)::INTEGER
      - CASE WHEN EXTRACT(MONTH FROM p_when)::INTEGER < COALESCE(
                    (SELECT financial_year_start_month FROM tenant_settings LIMIT 1), 1)
             THEN 1 ELSE 0 END,
    COALESCE((SELECT financial_year_start_month FROM tenant_settings LIMIT 1), 1),
    1);
$fn$;

GRANT EXECUTE ON FUNCTION financial_year_of(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 2. Everything the customer record shows, in one row.
--
-- Returns a row even for a customer with no Protean account at all, so
-- the drawer can say "nothing billed" rather than having to tell an
-- empty result apart from a failed one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_customer(p_contact UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  accounts        INTEGER,
  this_year       NUMERIC,
  last_year       NUMERIC,
  change          NUMERIC,
  /* The financial year to date, and the day it began, so the screen can
     label the figure with the period rather than the word. */
  financial_year  NUMERIC,
  fy_started      DATE,
  lifetime        NUMERIC,
  invoices        INTEGER,
  first_billed    DATE,
  last_billed     DATE,
  open_jobs       INTEGER,
  open_value      NUMERIC,
  oldest_open     DATE,
  group_id        UUID,
  group_name      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE    := COALESCE(p_upto, CURRENT_DATE);
  y    INTEGER := EXTRACT(YEAR FROM upto)::INTEGER;
  cut  DATE    := (upto - INTERVAL '1 year')::DATE;
  fy   DATE    := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::INTEGER FROM protean_accounts a
      WHERE a.contact_id = p_contact AND NOT a.ignored),
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (
       WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (
       WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0))::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC,
    fy,
    COALESCE(SUM(i.net), 0)::NUMERIC,
    count(i.invoice_no)::INTEGER,
    min(i.tax_point),
    max(i.tax_point),
    (SELECT count(*)::INTEGER FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT min(j.logged_on) FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
    (SELECT g.name FROM crm_contacts c
       JOIN customer_groups g ON g.id = c.group_id
      WHERE c.id = p_contact)
  FROM protean_accounts a
  LEFT JOIN protean_invoices i ON i.alpha = a.alpha
 WHERE a.contact_id = p_contact AND NOT a.ignored;

  /* A customer with no Protean account at all still gets a row, so the
     record can say "nothing billed" rather than the drawer having to
     tell an empty result apart from one that failed. */
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, fy,
                        0::NUMERIC, 0, NULL::DATE, NULL::DATE, 0, 0::NUMERIC, NULL::DATE,
                        (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
                        (SELECT g.name FROM crm_contacts c
                           JOIN customer_groups g ON g.id = c.group_id
                          WHERE c.id = p_contact);
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_customer(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 3. Every year they have billed, for the small chart.
--
-- `protean_spend` already answers this and is unchanged. Named here so
-- the record and the revenue screen are visibly reading the same thing.
-- -------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protean_customer') THEN
    RAISE EXCEPTION 'a customer record still cannot say what the customer spends';
  END IF;
  RAISE NOTICE 'ok  a customer record can show its spend, its financial year and its open work';
END $$;
