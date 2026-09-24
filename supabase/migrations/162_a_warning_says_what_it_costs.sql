-- =============================================================
-- 162. A warning says what it costs.
--
-- From the business:
--
--   what about all the other comments I told you to look at earlier
--   and find out why it's alerting him? [...] He thinks these are
--   lost earnings because it's saying things are or are not included
--   or are being worked out differently
--
-- Three notices on the personal portfolio, all of them accurate, none
-- of them saying the one thing the person reading wants to know: is
-- any of this my money.
--
-- ---- What each one is actually worth, on Dean's live portfolio ----
--
--   70 deals carry no figure          the Open pipeline tile is lower
--                                     than the real pipeline. No other
--                                     figure uses them.
--
--   10 won deals have no order date   worth £45,950, and that is real.
--                                     It is missing from Closed on the
--                                     tracker until somebody dates
--                                     them.
--
--   131 rows off an imported sheet    past spend, not deals, counted
--                                     nowhere. Correct.
--
--   5 payers on the portfolio         `payer_on_book` only counts
--                                     records with NO Protean account
--                                     and NO invoices, so every one of
--                                     them is worth exactly nought in
--                                     both years, by construction.
--
-- And the target has been what the book was invoiced since migration
-- 160, so nothing on the tracker can reach it in either direction.
-- None of the four is a penny off anybody's target or commission. One
-- of them, the £45,950, is missing from a figure that is reported
-- beside it, and a rep should be told that plainly rather than left to
-- work it out from a count.
--
-- ---- I had this wrong until the database said otherwise ----
--
-- All ten of those deals have a NULL sale_price, and the first reading
-- of that was "they carry no price, so dating them adds nothing".
-- `lead_worth` falls back to `estimated_value` for a won deal, so they
-- carry £45,950 between them. The count on the screen could never have
-- shown that either way, which is the whole reason for the column
-- below.
--
-- ---- What this migration adds ----
--
-- `personal_pipeline` returns `won_undated_worth`: what the undated
-- wins are worth by the same `lead_worth` rule every other figure on
-- the page uses, which is the sale price where there is one and the
-- estimate where there is not. The notice then names the amount, so a
-- rep reads "worth £46k, date them and they land in Closed on the
-- tracker" instead of a bare count they can only assume the worst
-- about.
--
-- `won_undated_worth` is deliberately NOT added to any total. It is
-- what is missing FROM a total, which is a different thing, and adding
-- it would be inventing an order date nobody entered.
-- =============================================================

DROP FUNCTION IF EXISTS public.personal_pipeline(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_pipeline(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(lead_type text, open_count integer, open_total numeric, won_count integer,
              won_total numeric, lost_count integer, lost_total numeric,
              unpriced integer, won_undated integer, off_a_sheet integer,
              won_total_own numeric, won_undated_worth numeric)
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

    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won' AND l.order_date IS NULL)::INT,

    COUNT(*) FILTER (WHERE l.sheet_revenue IS NOT NULL)::INT,

    SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) FILTER (
      WHERE l.status = 'won'
        AND l.order_date >= fy_start
        AND l.order_date < fy_start + INTERVAL '1 year'
        AND NOT EXISTS (SELECT 1 FROM fleetsmart_contracts fc WHERE fc.lead_id = l.id)),

    /* What the undated wins would be worth if somebody dated them.
       Same rule as every other figure here: the sale price where
       there is one, the estimate where there is not. NULL only where a
       deal carries neither, because unknown is not nought. */
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won' AND l.order_date IS NULL)
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$fn$;

COMMENT ON FUNCTION public.personal_pipeline(uuid, date) IS
  'One person''s deals by type. won_undated_worth is what the undated wins would '
  'add if somebody dated them, and is in no total because it is what is missing '
  'from one. See migration 162.';
