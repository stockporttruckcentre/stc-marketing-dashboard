-- =============================================================
-- 042. The sale, the proposal and stock to tracker, onto leads.
--
-- Migration 040 moved the pitch off the company. These are the four
-- functions that still wrote a pitch onto `crm_contacts`, so until they
-- move, marking a deal sold would set a COMPANY to 'customer' and write
-- a sale price onto the account book.
--
-- `command_mark_sold_many` needs no change: it names deals and hands
-- each to `command_mark_sold`, so it follows.
--
-- ONE THING GETS BETTER RATHER THAN JUST MOVING.
--
-- `command_send_from_stock` used to invent a company. Putting STC14320
-- on your tracker created a `crm_contacts` row called "Lead STC14320",
-- which was tolerable while tracker rows lived on a private list and is
-- not now: the CRM would gain a phantom account per unit. A unit on your
-- tracker before anybody has agreed to buy it is a lead with no customer
-- named, which is what it always was, and naming the customer later is
-- filling in a column rather than merging two records.
-- =============================================================

-- -------------------------------------------------------------
-- 1. What a sale would do, read off the lead
-- -------------------------------------------------------------
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
  deal         crm_leads%ROWTYPE;
  v_customer   TEXT;
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
  SELECT * INTO deal FROM crm_leads WHERE id = p_tracker;
  IF NOT FOUND THEN
    -- Not an exception. The projection is also what the preview reads,
    -- and a preview that raises cannot say which of six deals is the
    -- problem.
    RETURN jsonb_build_object('ok', FALSE, 'id', p_tracker, 'why', 'that deal is not there');
  END IF;

  -- Who the stock unit gets stamped with. A lead raised from stock has
  -- no customer until somebody agrees to buy, and selling one of those
  -- without naming the buyer would put an empty customer on the unit.
  SELECT company_name INTO v_customer FROM crm_contacts WHERE id = deal.contact_id;
  IF deal.stock_trailer_id IS NOT NULL AND v_customer IS NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE, 'id', p_tracker,
      'why', 'that deal has no customer on it yet, so the unit cannot be marked sold to anybody');
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
      'customer',      v_customer,
      'sales_rep',     p_rep_initials,
      'sales_price',   v_price,
      'profit',        v_profit,
      'order_date',    v_order_date,
      'dispatch_date', v_unit_disp);
  END IF;

  -- First to sell wins, and everybody else chasing the unit sees it as
  -- gone. Zero of them is normal and is not a problem. Other people's
  -- leads now, rather than other copies of the customer.
  SELECT COALESCE(jsonb_agg(l.id), '[]'::JSONB) INTO v_cascades
    FROM crm_leads l
   WHERE deal.stock_trailer_id IS NOT NULL
     AND l.stock_trailer_id = deal.stock_trailer_id
     AND l.id <> p_tracker
     AND l.status IS DISTINCT FROM 'customer';

  RETURN jsonb_build_object(
    'ok',   TRUE,
    'id',   p_tracker,
    'label', COALESCE(v_customer, 'no customer named yet'),
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

-- -------------------------------------------------------------
-- 2. Carrying it out
-- -------------------------------------------------------------
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
  v_account  UUID;
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
  UPDATE crm_leads AS t SET
    (status, sale_price, profit, commission, order_date, dispatch_date) =
    (SELECT status, sale_price, profit, commission, order_date, dispatch_date
       FROM jsonb_populate_record(NULL::crm_leads, sale -> 'deal'))
  WHERE t.id = p_tracker_id;

  -- The deal was found a moment ago, so an update affecting nothing
  -- means row level security allows reading it and not writing it.
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  -- Winning the work makes them a customer of the business, not just a
  -- closed line on one person's tracker. The account says so now, which
  -- is the thing the CRM was never able to say while a won deal and the
  -- company were separate rows.
  SELECT contact_id INTO v_account FROM crm_leads WHERE id = p_tracker_id;
  IF v_account IS NOT NULL THEN
    UPDATE crm_contacts SET status = 'customer', relationship = 'existing'
     WHERE id = v_account AND status IS DISTINCT FROM 'customer';
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

    -- Everybody else chasing that unit is chasing something that has gone.
    UPDATE crm_leads SET status = 'lost'
     WHERE stock_trailer_id = v_unit
       AND id <> p_tracker_id
       AND status NOT IN ('customer', 'lost');
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

-- -------------------------------------------------------------
-- 3. The preview reads the lead's own before values
-- -------------------------------------------------------------
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
    -- the two halves of one line come from one read of one row. Off the
    -- lead now, because that is where a deal's columns live.
    SELECT jsonb_object_agg(k, to_jsonb(l.*) -> k) INTO was
      FROM crm_leads l, LATERAL jsonb_object_keys((sale -> 'deal') - 'id') AS k
     WHERE l.id = tracker;

    rows := rows || jsonb_build_array(jsonb_build_object(
      'table', 'crm_leads',
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
    -- whole of what happens to them. They lose the deal rather than
    -- winning it, which is what 'customer' used to read as.
    FOR cascade IN SELECT * FROM jsonb_array_elements(sale -> 'cascades')
    LOOP
      rows := rows || jsonb_build_array(jsonb_build_object(
        'table', 'crm_leads',
        'id',    cascade #>> '{}',
        'label', COALESCE((SELECT a.company_name
                             FROM crm_leads c
                             LEFT JOIN crm_contacts a ON a.id = c.contact_id
                            WHERE c.id = (cascade #>> '{}')::UUID), 'another deal'),
        'was',   jsonb_build_object('status',
                   (SELECT c.status FROM crm_leads c
                     WHERE c.id = (cascade #>> '{}')::UUID)),
        'set',   jsonb_build_object('status', 'lost')));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(refused) = 0,
    'rows', rows,
    'refused', refused);
END;
$$;

-- -------------------------------------------------------------
-- 4. A proposal is a lead against the account
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_raise_proposal(
  p_contacts UUID[],
  p_kind     TEXT,
  p_owner    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  kind    TEXT;
  person  RECORD;
  made    INTEGER := 0;
  wanted  INTEGER;
  first   UUID;
  owner   UUID;
BEGIN
  IF NOT command_may('crm.proposal') THEN
    RAISE EXCEPTION 'you do not have crm.proposal';
  END IF;

  owner := COALESCE(p_owner, auth.uid());
  IF owner IS DISTINCT FROM auth.uid() AND NOT command_may('crm.proposalForOthers') THEN
    RAISE EXCEPTION 'you do not have crm.proposalForOthers';
  END IF;

  -- Rental has its own tab now, so a rental proposal stops being filed
  -- under trailer sales. Refurb still has no tool of its own and rides
  -- with maintenance, which is what the screen says it does.
  kind := CASE COALESCE(p_kind, 'trailer_sales')
    WHEN 'trailer_sales' THEN 'trailer_sales'
    WHEN 'rental'        THEN 'rental'
    WHEN 'maintenance'   THEN 'maintenance'
    WHEN 'refurb'        THEN 'maintenance'
    ELSE NULL
  END;
  IF kind IS NULL THEN
    RAISE EXCEPTION 'there is no proposal type called %', p_kind;
  END IF;

  wanted := COALESCE(array_length(p_contacts, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said who the proposal is for';
  END IF;

  FOR person IN
    SELECT id, relationship FROM crm_contacts WHERE id = ANY(p_contacts)
  LOOP
    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status,
      requirement, date_of_enquiry, last_activity_at
    ) VALUES (
      person.id, owner, auth.uid(), kind, 'quoted',
      replace(COALESCE(p_kind, 'trailer_sales'), '_', ' '),
      CURRENT_DATE, NOW()
    )
    RETURNING id INTO first;

    -- The prospect versus existing split the meeting asked for is
    -- carried on the account, where it describes the relationship, and
    -- an account with no answer yet is a prospect.
    UPDATE crm_contacts SET relationship = 'prospect'
     WHERE id = person.id AND relationship IS NULL;

    made := made + 1;
  END LOOP;

  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to raise % proposals but raised %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('listId', NULL, 'made', made, 'kind', p_kind, 'rowId', first);
END;
$$;

-- -------------------------------------------------------------
-- 5. A unit on your tracker, with nobody buying it yet
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_send_from_stock(
  p_trailers UUID[],
  p_owner    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  unit    RECORD;
  made    INTEGER := 0;
  wanted  INTEGER;
  first   UUID;
  owner   UUID;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  -- Your own tracker, or nobody's. There is no delegated form of this
  -- operation in the application, so there is not one here either.
  owner := COALESCE(p_owner, auth.uid());
  IF owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION
      'stock goes on your own tracker; there is no operation for sending it to somebody else''s';
  END IF;

  wanted := COALESCE(array_length(p_trailers, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which units to send';
  END IF;

  FOR unit IN
    SELECT id, stc_no, chassis_number, year, make, model, description
      FROM stock_trailers WHERE id = ANY(p_trailers)
  LOOP
    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status,
      what, requirement, stock_trailer_id, date_of_enquiry, last_activity_at
    ) VALUES (
      -- No customer. This is a unit somebody is trying to sell, not a
      -- pitch to anybody yet, and inventing a company to hold it is how
      -- the CRM used to grow accounts nobody had ever spoken to.
      NULL, owner, auth.uid(), 'trailer_sales', 'lead',
      COALESCE(unit.stc_no, unit.chassis_number, 'Trailer'),
      NULLIF(concat_ws(' ', unit.year, unit.make, unit.model, unit.description), ''),
      unit.id, CURRENT_DATE, NOW()
    )
    RETURNING id INTO first;

    made := made + 1;
  END LOOP;

  -- Every unit, or none. A unit that is not there, or that row level
  -- security withholds, takes the whole call with it.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to send % units to the tracker but sent %; nothing has been changed',
      wanted, made;
  END IF;

  RETURN jsonb_build_object('listId', NULL, 'made', made, 'trackerRowId', first);
END;
$$;

REVOKE ALL ON FUNCTION command_sale_of(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_sale_of(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_mark_sold(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION command_project_sale(UUID[], TEXT, NUMERIC, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_project_sale(UUID[], TEXT, NUMERIC, DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION command_send_from_stock(UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_send_from_stock(UUID[], UUID) TO authenticated;
