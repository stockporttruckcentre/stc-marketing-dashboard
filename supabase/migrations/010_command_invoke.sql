-- =============================================================
-- Performing a business operation over a set, atomically.
--
-- `command_mark_sold` sells one deal and has done since the sales
-- tracker was wired up. What did not exist was a way to sell the set a
-- sentence names: "mark all the in stock curtainsiders as sold" is one
-- instruction about six units, and issuing six calls from application
-- code is six transactions, any of which can fail after the ones before
-- it have committed. Somebody who agreed to six sales and got four is
-- left working out which two, on a tracker where every one of them
-- raises a commission line.
--
-- So this is the same shape as `command_apply`: one function, one
-- transaction, every subject or none of them.
--
-- IT DOES NOT REIMPLEMENT THE SALE.
--
-- It loops and calls `command_mark_sold`, which is the operation. Two
-- implementations of a sale is how one of them stops cascading to the
-- other reps chasing the unit, and that is exactly the bug the single
-- function was written to remove.
--
-- SECURITY INVOKER, like everything else here. Row level security still
-- decides which deals the caller can touch, and a deal they cannot
-- update makes the whole call raise rather than being skipped.
-- =============================================================

CREATE OR REPLACE FUNCTION command_mark_sold_many(
  p_tracker_ids   UUID[],
  p_rep_initials  TEXT,
  p_sale_price    NUMERIC DEFAULT NULL,
  p_dispatch_date DATE    DEFAULT NULL,
  p_today         DATE    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  tracker  UUID;
  outcome  JSONB;
  results  JSONB := '[]'::JSONB;
  today    DATE := COALESCE(p_today, CURRENT_DATE);
BEGIN
  IF p_tracker_ids IS NULL OR array_length(p_tracker_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no deal was named';
  END IF;

  -- A duplicate would sell the same deal twice in one call, which is
  -- two commission lines on one sale.
  IF (SELECT COUNT(DISTINCT t) FROM unnest(p_tracker_ids) AS t)
     <> array_length(p_tracker_ids, 1) THEN
    RAISE EXCEPTION 'the same deal was named more than once';
  END IF;

  FOREACH tracker IN ARRAY p_tracker_ids
  LOOP
    -- Anything this raises takes the whole call with it, which is the
    -- point: the sale that failed and the five that had already been
    -- written are one instruction.
    SELECT command_mark_sold(
      tracker, p_rep_initials, p_sale_price, NULL, NULL, p_dispatch_date, today
    ) INTO outcome;
    results := results || jsonb_build_array(outcome);
  END LOOP;

  RETURN results;
END;
$$;

REVOKE ALL ON FUNCTION command_mark_sold_many(UUID[], TEXT, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_mark_sold_many(UUID[], TEXT, NUMERIC, DATE, DATE) TO authenticated;
