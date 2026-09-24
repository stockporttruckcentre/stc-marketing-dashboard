-- =============================================================
-- 163. A gap belongs to one figure.
--
-- From the business, reading the notice migration 162 wrote:
--
--   whats the open pipeline vs the real pipeline, why 2
--
-- There are not two. The notice said "70 deals carry no figure, so
-- Open pipeline above is lower than the real pipeline", which invents
-- a second number the app is supposed to know and is not showing. It
-- does not know one. Nobody knows what an unpriced deal is worth,
-- because nobody has typed a figure on it.
--
-- ---- And the 70 was the wrong number anyway ----
--
-- `unpriced` counts every deal with no worth, whatever its status. On
-- Dean's portfolio that is 34 leads, 6 contacted, 2 quoted, 20 lost
-- and 8 won. Only the first three, 42 of them, are inside the Open
-- pipeline figure at all. The 20 lost were never in it and the 8 won
-- never will be. So a notice about the open pipeline was quoting a
-- count that was two thirds about something else.
--
-- ---- One more thing the count was hiding ----
--
--   10 won deals have no order date
--    8 of those ten carry no figure either
--    2 carry the whole £45,950
--
-- "10 deals worth £46k" reads as ten jobs to go and find. It is two.
-- The other eight are worth nothing whatever anybody does with their
-- dates, and telling a rep to chase all ten wastes eight of them.
--
-- ---- So the figures are counted per figure ----
--
--   unpriced_open    open deals with no worth. These ARE inside the
--                    Open pipeline count and add nought to its total.
--                    No sheet filter: an imported row that is also a
--                    live opportunity, like Redbridge, has a real
--                    estimate and is genuinely in the pipeline.
--   unpriced_won     won deals with no worth, which add nought to
--                    Closed on the tracker. Sheet rows excluded, or
--                    all 131 would land here.
--   undated_priced   of the undated wins, how many carry a figure. The
--                    ones actually worth dating.
--
-- `unpriced` stays as it was. Removing a column from a returning
-- function breaks every caller that selects it, and `personal_overview`
-- still sums it.
-- =============================================================

DROP FUNCTION IF EXISTS public.personal_pipeline(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_pipeline(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(lead_type text, open_count integer, open_total numeric, won_count integer,
              won_total numeric, lost_count integer, lost_total numeric,
              unpriced integer, won_undated integer, off_a_sheet integer,
              won_total_own numeric, won_undated_worth numeric,
              unpriced_open integer, unpriced_won integer, undated_priced integer)
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

    /* Same rule as every other figure here: the sale price where there
       is one, the estimate where there is not. NULL only where a deal
       carries neither, because unknown is not nought. */
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won' AND l.order_date IS NULL),

    /* THE THREE THIS MIGRATION EXISTS FOR. See the banner. */
    COUNT(*) FILTER (
      WHERE l.status IN ('lead', 'contacted', 'quoted')
        AND lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won'
        AND lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    COUNT(*) FILTER (
      WHERE l.sheet_revenue IS NULL
        AND l.status = 'won' AND l.order_date IS NULL
        AND lead_worth(l.status, l.sale_price, l.estimated_value) IS NOT NULL)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$fn$;

COMMENT ON FUNCTION public.personal_pipeline(uuid, date) IS
  'One person''s deals by type. Each gap is counted against the one figure it '
  'moves: unpriced_open is inside Open pipeline, unpriced_won and won_undated '
  'are inside Closed on the tracker, and undated_priced is how many of the '
  'undated wins are worth dating. See migrations 162 and 163.';
