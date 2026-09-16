-- =============================================================
-- 121. The company target, worked out from what was invoiced.
--
-- From the business:
--
--   find the amount we invoiced in total last year across all divisions
--   on the revenue tab. Won leads would convert to an invoice after
--   which then goes through revenue so it should look at revenue. Add
--   20%. That's the company target
--
-- ---- "On the revenue tab" is taken literally ----
--
-- `division_revenue` already answers this. It has a `last_year_full`
-- column, which is the WHOLE of the previous financial year per
-- division, as against `last_year`, which is the same point last year
-- for the year on year comparison. Summing `last_year_full` across the
-- three divisions is the figure on that screen and not a second
-- definition of it, which matters: a company target worked out a
-- slightly different way from the revenue it is measured against would
-- be wrong by an amount nobody could ever find.
--
-- That also means it carries the revenue tab's own conventions, which
-- are worth stating plainly because they are not all invoices:
--
--   STC and Rentals   invoice net, by tax point, out of Protean
--   Trailer Sales     the sale price of stock dispatched in the year
--
-- Trailer Sales does not invoice through Protean, so the revenue screen
-- has always taken it from the stock list. The target follows the
-- screen rather than inventing a fourth way to count.
--
-- ---- The figure is stored, not computed live ----
--
-- A target that recalculated itself would move every time an old
-- invoice was amended, and a target that moves is not a target. So this
-- works it out once, writes the number, and writes down how it got
-- there. Run it again and it works it out again, deliberately.
-- =============================================================

-- -------------------------------------------------------------
-- What it WOULD be. Writes nothing.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS company_target_from_last_year(NUMERIC, DATE);
CREATE OR REPLACE FUNCTION company_target_from_last_year(
  p_uplift NUMERIC DEFAULT 0.20,
  p_when   DATE DEFAULT NULL
)
RETURNS TABLE (
  financial_year   DATE,
  last_year_from   DATE,
  last_year_to     DATE,
  invoiced         NUMERIC,
  uplift_pct       NUMERIC,
  target           NUMERIC,
  divisions_counted INT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  fy    DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
  total NUMERIC;
  n     INT;
BEGIN
  /* SECURITY INVOKER on purpose: `division_revenue` asks whether the
     person calling may see company revenue, and that question should
     be asked of them rather than answered on their behalf. */
  SELECT COALESCE(SUM(d.last_year_full), 0), COUNT(*)
    INTO total, n
    FROM division_revenue(COALESCE(p_when, CURRENT_DATE)) d;

  RETURN QUERY SELECT
    fy,
    (fy - INTERVAL '1 year')::DATE,
    (fy - INTERVAL '1 day')::DATE,
    ROUND(total, 2),
    ROUND(p_uplift * 100, 2),
    ROUND(total * (1 + p_uplift), 2),
    n;
END;
$fn$;

REVOKE ALL ON FUNCTION company_target_from_last_year(NUMERIC, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_target_from_last_year(NUMERIC, DATE) TO authenticated;

-- -------------------------------------------------------------
-- And setting it.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS set_company_target_from_last_year(NUMERIC, DATE);
CREATE OR REPLACE FUNCTION set_company_target_from_last_year(
  p_uplift NUMERIC DEFAULT 0.20,
  p_when   DATE DEFAULT NULL
)
RETURNS TABLE (
  financial_year DATE,
  invoiced       NUMERIC,
  uplift_pct     NUMERIC,
  target         NUMERIC,
  note           TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  r RECORD;
  said TEXT;
BEGIN
  IF NOT command_may('analytics.targets') THEN
    RAISE EXCEPTION
      'Setting the company target is a permission you do not have. Ask an administrator.';
  END IF;

  SELECT * INTO r FROM company_target_from_last_year(p_uplift, p_when);

  IF r.invoiced IS NULL OR r.invoiced = 0 THEN
    RAISE EXCEPTION
      'Last year comes to nothing across % division(s), so there is nothing to add % per cent '
      'to. That is a reason to look at the revenue screen, not a reason to set a target of '
      'nought.', r.divisions_counted, ROUND(p_uplift * 100);
  END IF;

  said := format(
    'Worked out from the revenue screen: %s invoiced across %s divisions between %s and %s, '
    'plus %s per cent.',
    to_char(r.invoiced, 'FM999,999,999.00'), r.divisions_counted,
    to_char(r.last_year_from, 'DD Mon YYYY'), to_char(r.last_year_to, 'DD Mon YYYY'),
    ROUND(p_uplift * 100));

  INSERT INTO performance_targets (scope, person_id, financial_year, target, note, set_by)
  VALUES ('company', NULL, r.financial_year, r.target, said, current_actor())
  ON CONFLICT (financial_year) WHERE scope = 'company'
  DO UPDATE SET target = EXCLUDED.target,
                note   = EXCLUDED.note,
                set_by = EXCLUDED.set_by,
                set_at = NOW();

  RETURN QUERY SELECT r.financial_year, r.invoiced, r.uplift_pct, r.target, said;
END;
$fn$;

REVOKE ALL ON FUNCTION set_company_target_from_last_year(NUMERIC, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_company_target_from_last_year(NUMERIC, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the company target can be worked out from last year: run set_company_target_from_last_year()';
END $$;
