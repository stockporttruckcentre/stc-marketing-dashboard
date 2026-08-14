-- =============================================================
-- Applying a command's changes, all of them or none of them.
--
-- The command bar previews what it is about to change and then asks.
-- Somebody who says yes to eleven rows has said yes to eleven rows, and
-- an executor issuing several PostgREST updates gives them a different
-- promise: several transactions, any of which can fail after the ones
-- before it have committed. A command that reports failure having
-- already changed six records is worse than one that fails, because the
-- person now has to work out which six.
--
-- So every change from a confirmed command goes through one call to
-- this function. One function is one transaction: it commits entirely
-- or it raises and leaves nothing behind. Undoing partial work with
-- compensating updates from application code is not an alternative,
-- because those updates can fail too.
--
-- THE ALLOWLIST IS THE SECOND HALF.
--
-- This builds UPDATE statements from names in a payload, so it must
-- never be able to name a table or column the command bar was not meant
-- to write. `command_writable_columns` is that boundary, and it is
-- generated from the canonical registry by
-- `npm run gen:writable-columns` rather than typed here, so it cannot
-- quietly disagree with what the application believes it may write.
-- `npm run check:writable-columns` fails if the two differ.
--
-- SECURITY INVOKER, deliberately. Row level security still applies:
-- this widens nothing, it only makes a set of writes atomic. A row the
-- caller could not update on their own is a row this cannot update
-- either, and the update simply affects nothing.
-- =============================================================

-- -------------------------------------------------------------
-- 1. What a command may write
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS command_writable_columns (
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

ALTER TABLE command_writable_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "command_writable_read" ON command_writable_columns;
-- Readable so a check can compare it with the registry. Nobody writes
-- it from the application: it is replaced wholesale by the generator.
CREATE POLICY "command_writable_read" ON command_writable_columns
  FOR SELECT USING (auth.role() = 'authenticated');

-- -------------------------------------------------------------
-- 2. The transaction
-- -------------------------------------------------------------
--
-- p_changes is a JSON array, one object per row:
--
--   [{ "table": "stock_trailers",
--      "id": "0000-...",
--      "set": { "retail_price": 24995 } }, ...]
--
-- Returns how many rows were changed, which will always equal how many
-- were requested: every change must affect exactly one row, and one
-- that does not raises and rolls the whole call back. A row RLS
-- withholds and a row somebody has deleted both look like an UPDATE
-- affecting nothing, which Postgres does not consider an error, so this
-- is the only place that difference can still be acted on.
CREATE OR REPLACE FUNCTION command_apply(p_changes JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  change      JSONB;
  target      TEXT;
  row_id      TEXT;
  assignments JSONB;
  col         TEXT;
  columns     TEXT[];
  touched     INTEGER := 0;
  affected    INTEGER;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'command_apply expects an array of changes';
  END IF;

  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    target      := change ->> 'table';
    row_id      := change ->> 'id';
    assignments := change -> 'set';

    IF target IS NULL OR row_id IS NULL OR assignments IS NULL
       OR jsonb_typeof(assignments) <> 'object' THEN
      RAISE EXCEPTION 'a change must name a table, an id and the columns to set';
    END IF;

    columns := ARRAY(SELECT jsonb_object_keys(assignments));
    IF array_length(columns, 1) IS NULL THEN
      RAISE EXCEPTION 'a change to % must set something', target;
    END IF;

    -- Every column, checked against the allowlist BEFORE it appears in
    -- any statement. One unknown column refuses the WHOLE command,
    -- because a command that writes most of what it meant to is the
    -- thing this function exists to prevent.
    FOREACH col IN ARRAY columns
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM command_writable_columns w
        WHERE w.table_name = target AND w.column_name = col
      ) THEN
        RAISE EXCEPTION 'the command bar may not write %.%', target, col;
      END IF;
    END LOOP;

    -- `jsonb_populate_record` turns the payload into a row of the
    -- table's own type, so every value is cast by the column that will
    -- hold it and nothing from the payload is ever concatenated into
    -- SQL. Identifiers come from the allowlist, values come from a bind
    -- parameter, and the two never meet.
    EXECUTE format(
      'UPDATE %1$I AS t SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::%1$I, $1)) WHERE t.id = $2::UUID',
      target,
      (SELECT string_agg(format('%I', c), ', ' ORDER BY c) FROM unnest(columns) AS c)
    )
    USING assignments, row_id;

    -- EXACTLY ONE ROW, OR NOTHING HAPPENS AT ALL.
    --
    -- An UPDATE that matches nothing is not an error in Postgres, so
    -- without this the function would sail past a row RLS withheld or a
    -- row somebody deleted, and every other change would commit. The
    -- caller comparing counts afterwards is too late: the transaction
    -- has already ended. Raising here is what makes the preview's
    -- promise true, because it is the only point at which the whole
    -- thing can still be undone.
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION
        'expected to change exactly one row of % but changed %; nothing has been changed',
        target, affected;
    END IF;
    touched := touched + affected;
  END LOOP;

  RETURN touched;
END;
$$;

REVOKE ALL ON FUNCTION command_apply(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_apply(JSONB) TO authenticated;

-- -------------------------------------------------------------
-- 3. Marking a deal sold, atomically
-- -------------------------------------------------------------
--
-- Three writes that have to happen together: the tracker row, the stock
-- unit, and every other rep's row on the same unit. The application
-- version of this had an explicit partial path, where the tracker
-- updated and the stock update then failed and said so. That leaves a
-- deal marked won against a unit still showing as available, which is
-- exactly the state the sale is supposed to remove.
--
-- The commission arithmetic stays here rather than in the caller so
-- that the figure and the writes cannot disagree.
CREATE OR REPLACE FUNCTION command_mark_sold(
  p_tracker_id    UUID,
  p_rep_initials  TEXT,
  p_sale_price    NUMERIC DEFAULT NULL,
  p_profit        NUMERIC DEFAULT NULL,
  p_commission    NUMERIC DEFAULT NULL,
  p_dispatch_date DATE    DEFAULT NULL,
  p_today         DATE    DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  deal        crm_contacts%ROWTYPE;
  v_profit    NUMERIC;
  v_rate      NUMERIC;
  v_commission NUMERIC;
  v_order_date DATE;
  v_stock_updated BOOLEAN := FALSE;
  v_cascaded  INTEGER := 0;
  v_affected  INTEGER := 0;
BEGIN
  SELECT * INTO deal FROM crm_contacts WHERE id = p_tracker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that deal is not there';
  END IF;

  v_profit     := COALESCE(p_profit, deal.profit);
  v_rate       := COALESCE(deal.commission_rate, 0.10);
  v_commission := COALESCE(p_commission,
                           CASE WHEN v_profit IS NULL THEN NULL
                                ELSE ROUND(v_profit * v_rate, 2) END);
  v_order_date := COALESCE(deal.order_date, p_today);

  UPDATE crm_contacts SET
    status        = 'customer',
    sale_price    = COALESCE(p_sale_price, deal.sale_price),
    profit        = v_profit,
    commission    = v_commission,
    order_date    = v_order_date,
    dispatch_date = COALESCE(p_dispatch_date, deal.dispatch_date)
  WHERE id = p_tracker_id;

  -- The deal was found a moment ago, so an update affecting nothing
  -- means RLS allows reading it and not writing it. Carrying on would
  -- flip the stock unit to sold with no sale recorded against anybody.
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  IF deal.stock_trailer_id IS NOT NULL THEN
    UPDATE stock_trailers SET
      status        = 'sold',
      customer      = deal.company_name,
      sales_rep     = p_rep_initials,
      sales_price   = COALESCE(p_sale_price, deal.sale_price),
      profit        = v_profit,
      order_date    = v_order_date,
      dispatch_date = COALESCE(p_dispatch_date, dispatch_date)
    WHERE id = deal.stock_trailer_id;

    -- The unit is part of the sale, not an optional extra. A deal
    -- linked to a trailer that did not change leaves the deal won and
    -- the trailer still showing as available, which is the state this
    -- whole operation exists to remove.
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      RAISE EXCEPTION
        'the stock unit could not be updated; nothing has been changed';
    END IF;
    v_stock_updated := TRUE;

    -- First to sell wins. Everybody else chasing the unit sees it as
    -- gone, and keeps an empty commission, because they did not sell it.
    -- Zero here is fine and often right: there may be nobody else
    -- chasing this unit. This is the one count that is not required to
    -- be one.
    UPDATE crm_contacts SET status = 'customer'
    WHERE stock_trailer_id = deal.stock_trailer_id
      AND id <> p_tracker_id
      AND status IS DISTINCT FROM 'customer';
    GET DIAGNOSTICS v_cascaded = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'trackerId',       p_tracker_id,
    'commission',      v_commission,
    'stockTrailerId',  deal.stock_trailer_id,
    'stockUpdated',    v_stock_updated,
    'cascadedOthers',  v_cascaded
  );
END;
$$;

REVOKE ALL ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) TO authenticated;
