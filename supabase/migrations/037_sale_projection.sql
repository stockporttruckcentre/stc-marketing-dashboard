-- =============================================================
-- 037. What a sale will leave behind, worked out before it happens.
--
-- "Mark these sold and export the result" is one instruction and the
-- runtime could not carry it out. The reason was honest: a sale writes
-- a commission computed from a rate the command layer cannot see, and
-- the registry declared those columns unpredictable, so a file built
-- from them would have held the values the rows had a moment BEFORE the
-- sale. The command refused rather than exporting yesterday.
--
-- Refusing is safe and it is not the answer. `command_mark_sold` is
-- code we own, so the right fix is to make its result knowable.
--
-- ONE CALCULATION, TWO CALLERS.
--
-- `command_sale_of` is the arithmetic and nothing else. It reads the
-- deal and the unit, works out the profit, the rate, the commission and
-- the dates, and returns the rows exactly as they will be. It writes
-- nothing and it is the only place any of that is decided.
--
--   command_mark_sold      writes exactly what it returns
--   command_project_sale   shows exactly what it returns
--
-- The preview and the sale therefore cannot disagree, which is the
-- property that was missing. Not "the preview approximates the sale":
-- the preview is the sale's own answer, asked without the writes.
--
-- HOW THE WRITE STAYS EXACTLY THE PROJECTION.
--
-- `jsonb_populate_record` against the target table's own row type, the
-- same trick `command_apply` uses. The projected object IS the update:
-- a column cannot be written with a value the projection did not name,
-- because there is no second expression to write one from.
--
-- WHAT STOPS IT GOING STALE.
--
-- Nothing here. The projection goes into the programme hash, so a deal
-- whose profit moved between the preview and the confirmation produces
-- a different projection, a different hash, and a fresh preview instead
-- of a write. That check lives in the command runtime, where every
-- other drift check lives.
-- =============================================================

-- -------------------------------------------------------------
-- The arithmetic, on its own
-- -------------------------------------------------------------
--
-- STABLE, not VOLATILE: it reads and never writes, so PostgreSQL may
-- run it in a read only transaction and the preview path can call it
-- without any possibility of an effect.
CREATE OR REPLACE FUNCTION command_sale_of(
  p_tracker       UUID,
  p_rep_initials  TEXT,
  p_sale_price    NUMERIC DEFAULT NULL,
  p_profit        NUMERIC DEFAULT NULL,
  p_commission    NUMERIC DEFAULT NULL,
  p_dispatch_date DATE    DEFAULT NULL,
  p_today         DATE    DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  deal         crm_contacts%ROWTYPE;
  v_price      NUMERIC;
  v_profit     NUMERIC;
  v_rate       NUMERIC;
  v_commission NUMERIC;
  v_order_date DATE;
  v_dispatch   DATE;
  v_unit_disp  DATE;
  v_unit       JSONB := NULL;
  v_cascades   JSONB;
BEGIN
  SELECT * INTO deal FROM crm_contacts WHERE id = p_tracker;
  IF NOT FOUND THEN
    -- Not an exception. The projection is also what the preview reads,
    -- and a preview that raises cannot say which of six deals is the
    -- problem.
    RETURN jsonb_build_object('ok', FALSE, 'id', p_tracker, 'why', 'that deal is not there');
  END IF;

  v_price      := COALESCE(p_sale_price, deal.sale_price);
  v_profit     := COALESCE(p_profit, deal.profit);
  v_rate       := COALESCE(deal.commission_rate, 0.10);
  v_commission := COALESCE(p_commission,
                           CASE WHEN v_profit IS NULL THEN NULL
                                ELSE ROUND(v_profit * v_rate, 2) END);
  v_order_date := COALESCE(deal.order_date, p_today);
  v_dispatch   := COALESCE(p_dispatch_date, deal.dispatch_date);

  IF deal.stock_trailer_id IS NOT NULL THEN
    SELECT COALESCE(p_dispatch_date, t.dispatch_date) INTO v_unit_disp
      FROM stock_trailers t WHERE t.id = deal.stock_trailer_id;

    -- A deal linked to a unit the caller cannot see is a sale that
    -- cannot be completed, and saying so here means the preview says it
    -- rather than the transaction discovering it.
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', FALSE, 'id', p_tracker,
        'why', 'the stock unit on that deal is not there');
    END IF;

    v_unit := jsonb_build_object(
      'id',            deal.stock_trailer_id,
      'status',        'sold',
      'customer',      deal.company_name,
      'sales_rep',     p_rep_initials,
      'sales_price',   v_price,
      'profit',        v_profit,
      'order_date',    v_order_date,
      'dispatch_date', v_unit_disp);
  END IF;

  -- First to sell wins, and everybody else chasing the unit sees it as
  -- gone. Zero of them is normal and is not a problem.
  SELECT COALESCE(jsonb_agg(c.id), '[]'::JSONB) INTO v_cascades
    FROM crm_contacts c
   WHERE deal.stock_trailer_id IS NOT NULL
     AND c.stock_trailer_id = deal.stock_trailer_id
     AND c.id <> p_tracker
     AND c.status IS DISTINCT FROM 'customer';

  RETURN jsonb_build_object(
    'ok',   TRUE,
    'id',   p_tracker,
    'label', deal.company_name,
    -- Exactly the columns the sale writes, under exactly their own
    -- names, so this object can be the update.
    'deal', jsonb_build_object(
      'id',            p_tracker,
      'status',        'customer',
      'sale_price',    v_price,
      'profit',        v_profit,
      'commission',    v_commission,
      'order_date',    v_order_date,
      'dispatch_date', v_dispatch),
    'unit', v_unit,
    'cascades', v_cascades);
END;
$$;

REVOKE ALL ON FUNCTION command_sale_of(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_sale_of(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) TO authenticated;


-- -------------------------------------------------------------
-- The sale, writing exactly what the projection says
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Every
-- guarantee migration 007 made still holds: one transaction, the deal
-- and the unit together, exactly one row each, and the cascade onto
-- everybody else chasing the unit. What has moved is where the numbers
-- come from.
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
  sale       JSONB;
  v_affected INTEGER := 0;
  v_cascaded INTEGER := 0;
  v_unit     UUID;
BEGIN
  sale := command_sale_of(
    p_tracker_id, p_rep_initials, p_sale_price, p_profit, p_commission,
    p_dispatch_date, p_today);

  IF NOT (sale ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION '%', sale ->> 'why';
  END IF;

  -- The projected row IS the update. Typed population against the
  -- table's own row type, so nothing is cast by hand and no column can
  -- take a value the projection did not name.
  UPDATE crm_contacts AS t SET
    (status, sale_price, profit, commission, order_date, dispatch_date) =
    (SELECT status, sale_price, profit, commission, order_date, dispatch_date
       FROM jsonb_populate_record(NULL::crm_contacts, sale -> 'deal'))
  WHERE t.id = p_tracker_id;

  -- The deal was found a moment ago, so an update affecting nothing
  -- means row level security allows reading it and not writing it.
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  IF sale -> 'unit' IS NOT NULL AND jsonb_typeof(sale -> 'unit') = 'object' THEN
    v_unit := (sale -> 'unit' ->> 'id')::UUID;

    UPDATE stock_trailers AS t SET
      (status, customer, sales_rep, sales_price, profit, order_date, dispatch_date) =
      (SELECT status, customer, sales_rep, sales_price, profit, order_date, dispatch_date
         FROM jsonb_populate_record(NULL::stock_trailers, sale -> 'unit'))
    WHERE t.id = v_unit;

    -- The unit is part of the sale, not an optional extra.
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      RAISE EXCEPTION 'the stock unit could not be updated; nothing has been changed';
    END IF;

    UPDATE crm_contacts SET status = 'customer'
    WHERE stock_trailer_id = v_unit
      AND id <> p_tracker_id
      AND status IS DISTINCT FROM 'customer';
    GET DIAGNOSTICS v_cascaded = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'trackerId',       p_tracker_id,
    'commission',      (sale -> 'deal' ->> 'commission')::NUMERIC,
    'stockTrailerId',  v_unit,
    'stockUpdated',    v_unit IS NOT NULL,
    'cascadedOthers',  v_cascaded);
END;
$$;

REVOKE ALL ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) TO authenticated;


-- -------------------------------------------------------------
-- The same answer, for a set, with nothing written
-- -------------------------------------------------------------
--
-- What the preview calls. The shape is deliberately the shape the
-- command runtime already understands for a change: a table, a row and
-- the columns it will hold. That is what lets the predictive reader
-- answer "what will be in there afterwards" for a sale exactly as it
-- does for a field write, instead of declaring the columns unknowable.
CREATE OR REPLACE FUNCTION command_project_sale(
  p_tracker_ids   UUID[],
  p_rep_initials  TEXT,
  p_sale_price    NUMERIC DEFAULT NULL,
  p_dispatch_date DATE    DEFAULT NULL,
  p_today         DATE    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  tracker  UUID;
  sale     JSONB;
  rows     JSONB := '[]'::JSONB;
  refused  JSONB := '[]'::JSONB;
  cascade  JSONB;
  was      JSONB;
  today    DATE := COALESCE(p_today, CURRENT_DATE);
BEGIN
  IF p_tracker_ids IS NULL OR array_length(p_tracker_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'no deal was named');
  END IF;

  IF (SELECT COUNT(DISTINCT t) FROM unnest(p_tracker_ids) AS t)
     <> array_length(p_tracker_ids, 1) THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'the same deal was named more than once');
  END IF;

  FOREACH tracker IN ARRAY p_tracker_ids
  LOOP
    sale := command_sale_of(
      tracker, p_rep_initials, p_sale_price, NULL, NULL, p_dispatch_date, today);

    IF NOT (sale ->> 'ok')::BOOLEAN THEN
      refused := refused || jsonb_build_array(sale);
      CONTINUE;
    END IF;

    -- WHAT THOSE COLUMNS HOLD NOW.
    --
    -- The preview shows a change, not a destination, and "before" has
    -- to be the same columns read off the same row rather than whatever
    -- the caller happened to have. Read here, beside the projection, so
    -- the two halves of one line come from one read of one row.
    SELECT jsonb_object_agg(k, to_jsonb(c.*) -> k) INTO was
      FROM crm_contacts c, LATERAL jsonb_object_keys((sale -> 'deal') - 'id') AS k
     WHERE c.id = tracker;

    rows := rows || jsonb_build_array(jsonb_build_object(
      'table', 'crm_contacts',
      'id',    sale -> 'deal' ->> 'id',
      'label', sale ->> 'label',
      'was',   COALESCE(was, '{}'::JSONB),
      'set',   (sale -> 'deal') - 'id'));

    IF jsonb_typeof(sale -> 'unit') = 'object' THEN
      SELECT jsonb_object_agg(k, to_jsonb(t.*) -> k) INTO was
        FROM stock_trailers t, LATERAL jsonb_object_keys((sale -> 'unit') - 'id') AS k
       WHERE t.id = (sale -> 'unit' ->> 'id')::UUID;

      rows := rows || jsonb_build_array(jsonb_build_object(
        'table', 'stock_trailers',
        'id',    sale -> 'unit' ->> 'id',
        'label', COALESCE((SELECT t.stc_no FROM stock_trailers t
                            WHERE t.id = (sale -> 'unit' ->> 'id')::UUID), 'the stock unit'),
        'was',   COALESCE(was, '{}'::JSONB),
        'set',   (sale -> 'unit') - 'id'));
    END IF;

    -- Everybody else chasing that unit. One column, and it is the
    -- whole of what happens to them.
    FOR cascade IN SELECT * FROM jsonb_array_elements(sale -> 'cascades')
    LOOP
      rows := rows || jsonb_build_array(jsonb_build_object(
        'table', 'crm_contacts',
        'id',    cascade #>> '{}',
        'label', COALESCE((SELECT c.company_name FROM crm_contacts c
                            WHERE c.id = (cascade #>> '{}')::UUID), 'another deal'),
        'was',   jsonb_build_object('status',
                   (SELECT c.status FROM crm_contacts c
                     WHERE c.id = (cascade #>> '{}')::UUID)),
        'set',   jsonb_build_object('status', 'customer')));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(refused) = 0,
    'rows', rows,
    'refused', refused);
END;
$$;

REVOKE ALL ON FUNCTION command_project_sale(UUID[], TEXT, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_project_sale(UUID[], TEXT, NUMERIC, DATE, DATE) TO authenticated;
