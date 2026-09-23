-- =============================================================
-- 146. ONE WON, NOT TWO.
--
-- From the business:
--
--   when marking a sales tracker record as Won (just closed) it doesn't
--   seem to do much. Then we have a status for Customer, which means
--   won anyway. We only need 1 status, Won. This then assumes the
--   company is now a customer of ours so anywhere else in the app
--   tracking who our customers are will pick this up.
--
-- ---- What was actually wrong ----
--
-- There were two words for one event and the application treated them
-- as a sequence. `won` was the handshake and `customer` came later, and
-- EVERY FIGURE THAT MATTERED counted the second one:
--
--   sales_by_person       won value, deals won
--   personal_won_between  a rep's year against their target
--   division_pipeline     won this financial year
--   the exec dashboard    revenue year to date and month to date
--   the reports builder   "What closed"
--   the tracker's own     Won card, and which tab the row sat in
--
-- So a rep marked a deal Won and nothing moved anywhere, which is
-- exactly what was reported. `won` was also filed under the Working
-- tab, so the row did not even change place.
--
-- ---- What one status means ----
--
--   * `won` is the whole of it. A deal is won and that is the end state.
--   * Winning ANY deal sets the company's `relationship` to `existing`,
--     which is what the rest of the application reads to answer "are
--     they a customer of ours". That is the "picked up everywhere" half
--     of the instruction, and it now happens without anybody being
--     asked a question.
--   * A NEW enquiry against a company we have already won work from
--     starts as a lead, not as won. The next job is a job to win. Their
--     being a customer is carried by `relationship`, not by putting an
--     unearned win on somebody's tracker.
--
-- ---- NOTHING IS DELETED ----
--
-- Every row that said `customer` now says `won` and keeps everything
-- else it had: its value, its dates, its owner, its history. Part 1
-- counts them before and after so the move can be read back.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The rows.
--
-- The account trigger is stood down for the move. It derives an
-- account's status from its leads, and letting it run row by row
-- through a bulk update would have it recompute the same account once
-- per lead. It is put back immediately and every account is recomputed
-- once, below.
-- -------------------------------------------------------------
ALTER TABLE crm_leads DISABLE TRIGGER crm_leads_set_account_status;

UPDATE crm_leads    SET status = 'won' WHERE status = 'customer';
UPDATE crm_contacts SET status = 'won' WHERE status = 'customer';

/* Winning is what makes somebody a customer, so every company with a
   won deal is an existing account. This is the "anywhere else in the
   app tracking who our customers are will pick this up" half, applied
   to the history as well as to everything from here on. */
UPDATE crm_contacts c
   SET relationship = 'existing'
 WHERE COALESCE(c.relationship, 'prospect') <> 'existing'
   AND EXISTS (SELECT 1 FROM crm_leads l
                WHERE l.contact_id = c.id AND l.status = 'won');

ALTER TABLE crm_leads ENABLE TRIGGER crm_leads_set_account_status;

-- -------------------------------------------------------------
-- 2. Every live function that knew the old word.
--
-- Taken out of the running database and replaced with the same body
-- with the word changed, rather than rewritten from memory, so nothing
-- else about any of them moves. The list is everything whose source
-- mentioned 'customer' next to a status.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.command_duplicate_deal(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  origin RECORD;
  fresh  UUID;
  ids    UUID[] := ARRAY[]::UUID[];
  made   INTEGER := 0;
  wanted INTEGER;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  wanted := COALESCE(array_length(p_ids, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which deal to duplicate';
  END IF;

  FOR origin IN
    SELECT contact_id, type, status, what, requirement, new_or_used,
           estimated_value, action, next_action, notes, commission_rate
      FROM crm_leads WHERE id = ANY(p_ids)
  LOOP
    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status, what, requirement,
      new_or_used, estimated_value, action, next_action, notes,
      commission_rate, date_of_enquiry, last_activity_at
    ) VALUES (
      origin.contact_id, auth.uid(), auth.uid(), origin.type,
      -- A won deal duplicated is a new one being quoted, not a second win.
      CASE origin.status WHEN 'won' THEN 'quoted' ELSE origin.status END,
      origin.what, origin.requirement, origin.new_or_used,
      origin.estimated_value, origin.action, origin.next_action, origin.notes,
      origin.commission_rate, CURRENT_DATE, NOW()
    )
    RETURNING id INTO fresh;

    ids  := ids || fresh;
    made := made + 1;
  END LOOP;

  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to duplicate % deals but duplicated %; nothing has been changed',
      wanted, made;
  END IF;

  RETURN jsonb_build_object('made', made, 'ids', to_jsonb(ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_mark_sold(p_tracker_id uuid, p_rep_initials text, p_sale_price numeric DEFAULT NULL::numeric, p_profit numeric DEFAULT NULL::numeric, p_commission numeric DEFAULT NULL::numeric, p_dispatch_date date DEFAULT NULL::date, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    UPDATE crm_contacts SET status = 'won', relationship = 'existing'
     WHERE id = v_account AND status IS DISTINCT FROM 'won';
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
       AND status NOT IN ('won', 'lost');
    GET DIAGNOSTICS v_cascaded = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'trackerId',       p_tracker_id,
    'commission',      (sale -> 'deal' ->> 'commission')::NUMERIC,
    'stockTrailerId',  v_unit,
    'stockUpdated',    v_unit IS NOT NULL,
    'cascadedOthers',  v_cascaded);
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_sale_of(p_tracker uuid, p_rep_initials text, p_sale_price numeric DEFAULT NULL::numeric, p_profit numeric DEFAULT NULL::numeric, p_commission numeric DEFAULT NULL::numeric, p_dispatch_date date DEFAULT NULL::date, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
     AND l.status IS DISTINCT FROM 'won';

  RETURN jsonb_build_object(
    'ok',   TRUE,
    'id',   p_tracker,
    'label', COALESCE(v_customer, 'no customer named yet'),
    -- Exactly the columns the sale writes, under exactly their own
    -- names, so this object can be the update.
    'deal', jsonb_build_object(
      'id',            p_tracker,
      'status',        'won',
      'sale_price',    v_price,
      'profit',        v_profit,
      'commission',    v_commission,
      'order_date',    v_order_date,
      'dispatch_date', v_dispatch),
    'unit', v_unit,
    'cascades', v_cascades);
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_tracker_from_crm(p_contacts uuid[], p_side text DEFAULT 'trailer_sales'::text, p_what text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  owner   UUID;
  made    INTEGER := 0;
  wanted  INTEGER;
  first   UUID;
  kind    TEXT;
  account RECORD;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  owner := COALESCE(p_owner, auth.uid());

  -- Handing a lead to somebody who is not here is a typo, not a delegation.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = owner) THEN
    RAISE EXCEPTION 'there is nobody here to give that lead to';
  END IF;

  wanted := COALESCE(array_length(p_contacts, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which customers to put on the tracker';
  END IF;

  kind := COALESCE(NULLIF(btrim(p_side), ''), 'trailer_sales');
  IF kind NOT IN ('trailer_sales', 'maintenance', 'rental') THEN
    RAISE EXCEPTION '% is not a kind of work this business pitches for', kind;
  END IF;

  FOR account IN
    SELECT id, status FROM crm_contacts WHERE id = ANY(p_contacts)
  LOOP
    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status, what,
      date_of_enquiry, last_activity_at
    ) VALUES (
      account.id, owner, auth.uid(), kind,
      -- A lost account stays lost. Everything else is a fresh enquiry
      -- on this tracker, INCLUDING an account we have already won work
      -- from: the next job is one to win, not one already won, and
      -- their being a customer is carried by `relationship`.
      CASE account.status WHEN 'lost' THEN 'lost' ELSE 'lead' END,
      CASE WHEN kind = 'maintenance' THEN p_what ELSE NULL END,
      CURRENT_DATE, NOW()
    )
    RETURNING id INTO first;

    made := made + 1;
  END LOOP;

  -- Every customer, or none. One that is not there, or that row level
  -- security withholds, takes the whole call with it.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to put % customers on the tracker but put %; nothing has been changed',
      wanted, made;
  END IF;

  RETURN jsonb_build_object(
    'made', made,
    'rowId', first,
    'ownerId', owner,
    -- Kept so the older callers that read it still parse. A tracker is
    -- no longer a list, so there is no list to name.
    'listId', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_account_status_from_leads(p_contact uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT l.status
       FROM crm_leads l
      WHERE l.contact_id = p_contact
      ORDER BY CASE l.status
                 WHEN 'won'       THEN 5
                 WHEN 'quoted'    THEN 4
                 WHEN 'contacted' THEN 3
                 WHEN 'lead'      THEN 2
                 WHEN 'lost'      THEN 1
                 ELSE 0
               END DESC,
               l.updated_at DESC
      LIMIT 1),
    -- No leads at all is not a state a lead can put them in. They are a
    -- company somebody has entered and nobody has pitched to yet.
    'lead');
$function$;

CREATE OR REPLACE FUNCTION public.crm_account_follows_its_leads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  target UUID;
  state  TEXT;
BEGIN
  target := COALESCE(NEW.contact_id, OLD.contact_id);
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  state := crm_account_status_from_leads(target);

  UPDATE crm_contacts
     SET status = state,
         -- Winning work is what makes somebody an existing customer.
         -- It never goes back the other way: they traded with us once
         -- and a later lost quote does not undo that.
         relationship = CASE WHEN state = 'won' THEN 'existing'
                             ELSE COALESCE(relationship, 'prospect') END,
         last_activity_at = NOW()
   WHERE id = target
     AND (status IS DISTINCT FROM state
          -- AND the relationship on its own, which this used to miss.
          -- An account already sitting at the right status whose
          -- relationship still said prospect was never corrected,
          -- because the only test was on the status. Winning is what
          -- makes somebody a customer, so it is what has to write it.
          OR (state = 'won' AND COALESCE(relationship, 'prospect') <> 'existing'));

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.division_pipeline()
 RETURNS TABLE(division text, name text, leads integer, value numeric, won_this_year integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE fy DATE := financial_year_of(CURRENT_DATE);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The pipeline needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name,
         count(l.id) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INTEGER,
         COALESCE(SUM(l.estimated_value) FILTER (
           WHERE l.status IN ('lead', 'contacted', 'quoted')), 0)::NUMERIC,
         count(l.id) FILTER (
           WHERE l.status = 'won' AND l.updated_at >= fy)::INTEGER
    FROM divisions d
    LEFT JOIN crm_leads l ON l.type = CASE d.slug
                                        WHEN 'stc' THEN 'maintenance'
                                        WHEN 'trailer' THEN 'trailer_sales'
                                        ELSE 'rental' END
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY d.sort_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fleetsmart_contract_state(p_lead_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_lead_status
           WHEN 'won' THEN 'accepted'
           WHEN 'lost'     THEN 'declined'
         END;
$function$;

CREATE OR REPLACE FUNCTION public.fleetsmart_lead_state(p_contract_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_contract_status
           WHEN 'draft'    THEN 'contacted'
           WHEN 'sent'     THEN 'quoted'
           WHEN 'accepted' THEN 'won'
           WHEN 'declined' THEN 'lost'
           WHEN 'expired'  THEN 'lost'
           ELSE NULL
         END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_worth(p_status text, p_sale numeric, p_estimate numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_status = 'won' THEN COALESCE(p_sale, p_estimate)
    ELSE p_estimate
  END;
$function$;

CREATE OR REPLACE FUNCTION public.make_customer_for_trailer(p_name text, p_contact uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  name  TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  made  UUID;
  moved INTEGER := 0;
  bound INTEGER := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Making a customer needs permission to edit the CRM.';
  END IF;
  IF name IS NULL THEN
    RAISE EXCEPTION 'A customer needs a name.';
  END IF;

  SELECT id INTO made FROM crm_contacts
   WHERE lower(btrim(company_name)) = lower(name) AND deleted_at IS NULL
   LIMIT 1;

  IF made IS NULL THEN
    /* `source` and no owner column: exactly what migration 092 wrote.
       Only the account binding below is new. */
    INSERT INTO crm_contacts (company_name, source, status)
    VALUES (name, 'trailer_sales', 'won')
    RETURNING id INTO made;
  END IF;

  UPDATE stock_trailers SET contact_id = made
   WHERE contact_id IS NULL AND lower(btrim(customer)) = lower(name);
  GET DIAGNOSTICS moved = ROW_COUNT;

  /* The half that was missing. The money is on the invoice, and the
     invoice reaches a CRM record through its Protean account. */
  UPDATE protean_accounts SET contact_id = made
   WHERE contact_id IS NULL
     AND division = 'trailer'
     AND lower(btrim(protean_name)) = lower(name);
  GET DIAGNOSTICS bound = ROW_COUNT;

  PERFORM audit('update', 'crm_contacts', made, name,
                jsonb_build_object('from', 'trailer sales',
                                   'trailers_linked', moved,
                                   'accounts_linked', bound));

  RETURN made;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notification_sweep(p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  last  TIMESTAMPTZ;
  wrote INT := 0;
  r     RECORD;
BEGIN
  SELECT last_run_at INTO last FROM notification_sweeps WHERE id LIMIT 1 FOR UPDATE;
  IF NOT p_force AND last > NOW() - INTERVAL '5 minutes' THEN
    RETURN -1;
  END IF;

  UPDATE notification_sweeps SET last_run_at = NOW(), runs = runs + 1 WHERE id;

  -- ---- A meeting or a call starting within the hour ----
  --
  -- Expires when the thing starts, so an alert about something that
  -- has already begun is never in the list.
  FOR r IN
    SELECT e.id, e.title, e.start_at, e.end_at, i.user_id, e.contact_id
      FROM calendar_events e
      JOIN calendar_invites i ON i.event_id = e.id
     WHERE e.start_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
       AND COALESCE(e.all_day, FALSE) = FALSE
       AND i.status <> 'declined'
    UNION
    SELECT e.id, e.title, e.start_at, e.end_at, e.created_by, e.contact_id
      FROM calendar_events e
     WHERE e.start_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
       AND COALESCE(e.all_day, FALSE) = FALSE
       AND e.created_by IS NOT NULL
  LOOP
    IF notify(
      r.user_id,
      CASE WHEN r.title ILIKE '%call%' THEN 'call.soon' ELSE 'meeting.soon' END,
      r.title || ' starts at ' || to_char(r.start_at, 'HH24:MI'),
      concat_ws('. ',
        (SELECT company_name FROM crm_contacts WHERE id = r.contact_id),
        (SELECT CASE WHEN count(*) = 0 THEN NULL
                     ELSE count(*)::TEXT || ' others on it' END
           FROM calendar_invites WHERE event_id = r.id AND user_id <> r.user_id)),
      '/dashboard/calendar?event=' || r.id::TEXT,
      NULL, 'meeting', r.id,
      jsonb_build_object('startAt', r.start_at),
      NULL,
      'soon:' || r.id::TEXT || ':' || r.user_id::TEXT,
      NULL,
      r.start_at
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- A task reaching its date, and one that has gone past it ----
  --
  -- Once each, keyed on the day, so a task that sits overdue for a
  -- fortnight is one notification and not fourteen.
  FOR r IN
    SELECT t.id, t.title, t.due_at, t.assignee_id,
           (t.due_at < date_trunc('day', NOW())) AS late
      FROM tasks t
     WHERE t.assignee_id IS NOT NULL
       AND t.due_at IS NOT NULL
       AND t.due_at < date_trunc('day', NOW()) + INTERVAL '1 day'
       AND t.status NOT IN ('done', 'cancelled')
  LOOP
    IF notify(
      r.assignee_id,
      CASE WHEN r.late THEN 'task.overdue' ELSE 'task.due' END,
      r.title,
      CASE WHEN r.late
           THEN 'It was due ' || to_char(r.due_at, 'DD Mon') || '.'
           ELSE 'Due today.' END,
      '/dashboard/work?task=' || r.id::TEXT,
      NULL, 'task', r.id,
      jsonb_build_object('dueAt', r.due_at, 'allLink', '/dashboard/work'),
      CASE WHEN r.late THEN 'overdue' ELSE 'due-today' END,
      CASE WHEN r.late THEN 'overdue:' ELSE 'due:' END
        || r.id::TEXT || ':' || to_char(NOW(), 'YYYY-MM-DD')
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- An open prospect nobody has touched in six weeks ----
  --
  -- Keyed on the month, so it comes round again if it stays quiet
  -- rather than being said once and forgotten.
  FOR r IN
    SELECT l.id, l.company_name, l.owner_id, l.estimated_value,
           COALESCE(l.last_activity_at, l.updated_at) AS quiet_since
      FROM crm_leads l
     WHERE l.owner_id IS NOT NULL
       AND l.status IN ('lead', 'contacted', 'quoted')
       AND COALESCE(l.last_activity_at, l.updated_at) < NOW() - INTERVAL '6 weeks'
  LOOP
    IF notify(
      r.owner_id, 'crm.dormant',
      COALESCE(NULLIF(btrim(r.company_name), ''), 'A prospect') || ' has gone quiet',
      'Nothing logged since ' || to_char(r.quiet_since, 'DD Mon')
        || COALESCE('. Worth about ' || to_char(r.estimated_value, 'FM£999,999,999'), ''),
      '/dashboard/leads?lead=' || r.id::TEXT,
      NULL, 'lead', r.id,
      jsonb_build_object('quietSince', r.quiet_since, 'allLink', '/dashboard/leads'),
      'dormant',
      'dormant:' || r.id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- Monthly figures ----
  --
  -- Four fifths of the way, and there. Once each per person per month,
  -- and the company one is a team notification so it is not four
  -- people each being told the same number personally.
  FOR r IN
    SELECT t.user_id, t.target_amount,
           COALESCE(SUM(l.sale_price), 0) AS booked
      FROM revenue_targets t
      LEFT JOIN crm_leads l
        ON l.owner_id = t.user_id
       AND l.status = 'won'
       AND l.order_date >= date_trunc('month', NOW())
       AND l.order_date <  date_trunc('month', NOW()) + INTERVAL '1 month'
     WHERE t.user_id IS NOT NULL
       AND t.period_month = date_trunc('month', NOW())::DATE
       AND t.target_amount > 0
     GROUP BY t.user_id, t.target_amount
  LOOP
    IF r.booked >= r.target_amount THEN
      IF notify(
        r.user_id, 'sales.milestone_hit',
        'You are over your number for ' || to_char(NOW(), 'Month'),
        to_char(r.booked, 'FM£999,999,999') || ' against '
          || to_char(r.target_amount, 'FM£999,999,999') || '.',
        '/dashboard/analytics',
        NULL, 'target', NULL,
        jsonb_build_object('booked', r.booked, 'target', r.target_amount),
        NULL,
        'hit:' || r.user_id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
      ) IS NOT NULL THEN wrote := wrote + 1; END IF;

    ELSIF r.booked >= r.target_amount * 0.8 THEN
      IF notify(
        r.user_id, 'sales.milestone_close',
        to_char(r.target_amount - r.booked, 'FM£999,999,999') || ' short of your number',
        to_char(r.booked, 'FM£999,999,999') || ' of '
          || to_char(r.target_amount, 'FM£999,999,999') || ' with '
          || (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE
             - NOW()::DATE || ' days left in the month.',
        '/dashboard/analytics',
        NULL, 'target', NULL,
        jsonb_build_object('booked', r.booked, 'target', r.target_amount),
        NULL,
        'close:' || r.user_id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
      ) IS NOT NULL THEN wrote := wrote + 1; END IF;
    END IF;
  END LOOP;

  UPDATE notification_sweeps SET last_wrote = wrote WHERE id;
  RETURN wrote;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_lead_won()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE unit RECORD;
BEGIN
  IF NEW.status <> 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS NULL OR NEW.sale_price IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT stc_no, make, model, category, year
      INTO unit FROM stock_trailers WHERE id = NEW.stock_trailer_id;

    PERFORM notify(
      NEW.owner_id, 'sales.commission',
      'Confirm your commission on '
        || COALESCE(NULLIF(btrim(unit.stc_no), ''), NEW.company_name, 'the sale'),
      concat_ws('. ',
        NULLIF(btrim(concat_ws(' ', unit.year::TEXT, unit.make, unit.model, unit.category)), ''),
        'Sold for ' || to_char(NEW.sale_price, 'FM£999,999,999')
          || COALESCE(' to ' || NULLIF(btrim(NEW.company_name), ''), ''),
        CASE WHEN NEW.profit IS NOT NULL
             THEN 'Margin ' || to_char(NEW.profit, 'FM£999,999,999')
                  || COALESCE(' (' || to_char(NEW.profit_pct, 'FM990.0') || '%)', '') END,
        CASE WHEN NEW.commission IS NOT NULL
             THEN 'Your commission works out at ' || to_char(NEW.commission, 'FM£999,999,990.00')
             ELSE 'No commission has been worked out yet' END),
      '/dashboard/leads?lead=' || NEW.id::TEXT,
      NULL, 'lead', NEW.id,
      jsonb_build_object(
        'salePrice', NEW.sale_price, 'profit', NEW.profit,
        'commission', NEW.commission, 'commissionRate', NEW.commission_rate,
        'trailer', unit.stc_no, 'confirm', TRUE),
      NULL,
      'commission:' || NEW.id::TEXT
    );

    PERFORM notify_capability(
      NULL, 'team.trailer_sold',
      COALESCE(NULLIF(btrim(unit.stc_no), ''), 'A trailer') || ' is sold',
      person_label(NEW.owner_id) || ' sold it'
        || COALESCE(' to ' || NULLIF(btrim(NEW.company_name), ''), '')
        || ' for ' || to_char(NEW.sale_price, 'FM£999,999,999') || '.',
      '/dashboard/sales',
      NEW.owner_id, 'lead', NEW.id,
      jsonb_build_object('salePrice', NEW.sale_price, 'allLink', '/dashboard/sales'),
      'sold-today'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_trailer_sold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rep UUID;
BEGIN
  IF NEW.status <> 'sold' OR OLD.status = 'sold' THEN RETURN NEW; END IF;

  BEGIN
    -- A lead already covered this one, so saying it twice would be
    -- two notifications about one sale.
    IF EXISTS (SELECT 1 FROM crm_leads
                WHERE stock_trailer_id = NEW.id AND status = 'won') THEN
      RETURN NEW;
    END IF;

    rep := person_named(NEW.sales_rep);
    IF rep IS NULL THEN RETURN NEW; END IF;

    PERFORM notify(
      rep, 'sales.commission',
      'Confirm your commission on ' || COALESCE(NULLIF(btrim(NEW.stc_no), ''), 'the sale'),
      concat_ws('. ',
        NULLIF(btrim(concat_ws(' ', NEW.year::TEXT, NEW.make, NEW.model, NEW.category)), ''),
        CASE WHEN COALESCE(NEW.sales_price, NEW.sold_price) IS NOT NULL
             THEN 'Sold for ' || to_char(COALESCE(NEW.sales_price, NEW.sold_price), 'FM£999,999,999')
                  || COALESCE(' to ' || NULLIF(btrim(NEW.customer), ''), '') END,
        CASE WHEN NEW.profit IS NOT NULL
             THEN 'Margin ' || to_char(NEW.profit, 'FM£999,999,999') END,
        'Nothing is worked out yet: open it and put the commission on'),
      '/dashboard/sales?trailer=' || NEW.id::TEXT,
      current_actor(), 'trailer', NEW.id,
      jsonb_build_object('salePrice', COALESCE(NEW.sales_price, NEW.sold_price),
                         'profit', NEW.profit, 'trailer', NEW.stc_no, 'confirm', TRUE),
      NULL,
      'commission-trailer:' || NEW.id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.personal_fleetsmart_between(p_person uuid, p_from date, p_to date)
 RETURNS TABLE(value_won numeric, value_invoiced numeric, contracts integer, counted_on_tracker integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    SUM(f.won)      FILTER (WHERE NOT f.dup),
    SUM(f.billed)   FILTER (WHERE NOT f.dup),
    count(*)        FILTER (WHERE NOT f.dup)::INT,
    count(*)        FILTER (WHERE f.dup)::INT
  FROM (
    SELECT fleetsmart_worth(c.annual_total, c.term_months) AS won,
           (SELECT v.net FROM fleetsmart_invoices_for(c.id, p_to) v) AS billed,
           (c.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM crm_leads l
               WHERE l.id = c.lead_id AND l.status = 'won'
                 AND l.order_date IS NOT NULL)) AS dup
      FROM fleetsmart_contracts c
     WHERE c.owner_id = p_person
       AND c.status = 'accepted'
       AND c.decided_at IS NOT NULL
       AND c.decided_at::DATE >= p_from
       AND c.decided_at::DATE <= p_to
       AND personal_analytics_may_view(p_person)
  ) f;
$function$;

CREATE OR REPLACE FUNCTION public.personal_pipeline(p_person uuid, p_when date DEFAULT NULL::date)
 RETURNS TABLE(lead_type text, open_count integer, open_total numeric, won_count integer, won_total numeric, lost_count integer, lost_total numeric, unpriced integer, won_undated integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE fy_start DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
BEGIN
  /* The one rule, asked before a single figure is shaped. A request
     carrying somebody else's id gets no rows, not a zero. */
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    l.type,
    COUNT(*) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INT,
    /* SUM over an empty set is NULL, which is the answer wanted: no
       priced open deals is not the same as open deals worth nothing. */
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted')),

    /* Won, and IN THIS FINANCIAL YEAR. `order_date` is the agreed date:
       migration 007 stamps it when a deal is marked sold. A won deal
       with no date is not silently dropped into the year, it is counted
       in `won_undated` so the gap is visible. */
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
      WHERE lead_worth(l.status, l.sale_price, l.estimated_value) IS NULL)::INT,

    COUNT(*) FILTER (
      WHERE l.status = 'won' AND l.order_date IS NULL)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$function$;

CREATE OR REPLACE FUNCTION public.personal_won_between(p_person uuid, p_from date, p_to date)
 RETURNS TABLE(target_revenue numeric, trailer_revenue numeric, deals integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type <> 'trailer_sales'),
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type = 'trailer_sales'),
    COUNT(*)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
    AND l.status = 'won'
    AND l.order_date >= p_from
    AND l.order_date <= p_to
    /* The same one rule as everywhere else on this screen. Somebody
       else's portfolio answers nothing, rather than nought. */
    AND personal_analytics_may_view(p_person);
$function$;

CREATE OR REPLACE FUNCTION public.pipeline_by_stage()
 RETURNS TABLE(division text, name text, sort_order integer, stage text, stage_at integer, leads integer, value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The pipeline needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH stages(stage, stage_at) AS (
    VALUES ('lead', 1), ('contacted', 2), ('quoted', 3),
           ('won', 4), ('lost', 5)
  ),
  /* The lead type and the division slug are the same three things
     under two names. Mapped here rather than renamed in the data,
     because `crm_leads.type` is what the tracker tabs are built on. */
  mapped(kind, slug) AS (
    VALUES ('maintenance', 'stc'), ('trailer_sales', 'trailer'), ('rental', 'rental')
  )
  SELECT d.slug, d.name, d.sort_order, s.stage, s.stage_at,
         count(l.id)::INTEGER,
         COALESCE(SUM(l.estimated_value), 0)::NUMERIC
    FROM divisions d
    CROSS JOIN stages s
    JOIN mapped m ON m.slug = d.slug
    LEFT JOIN crm_leads l ON l.type = m.kind AND l.status = s.stage
   GROUP BY d.slug, d.name, d.sort_order, s.stage, s.stage_at
   ORDER BY d.sort_order, s.stage_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protean_allocate_invoicing_types()
 RETURNS TABLE(placed integer, customers_made integer, no_name integer, value numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      RECORD;
  who    UUID;
  n      INT;
  n_put  INT := 0;
  n_new  INT := 0;
  n_none INT := 0;
  total  NUMERIC := 0;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Allocating cash sales makes customer records, so it needs permission to create them.';
  END IF;

  FOR r IN
    SELECT i.division, i.alpha, BTRIM(i.site_name) AS site,
           count(*) AS n, SUM(i.net) AS net
      FROM protean_invoices i
      JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha AND a.is_invoicing_type
     WHERE i.contact_id IS NULL
     GROUP BY i.division, i.alpha, BTRIM(i.site_name)
  LOOP
    /* No name on the invoice at all. Nothing to allocate it to, and a
       guess would put somebody else's money on a customer. Counted and
       left, not invented. */
    IF r.site IS NULL OR r.site = '' THEN
      n_none := n_none + r.n;
      CONTINUE;
    END IF;

    SELECT c.id INTO who FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND lower(BTRIM(c.company_name)) = lower(r.site)
     ORDER BY c.created_at
     LIMIT 1;

    IF who IS NULL THEN
      INSERT INTO crm_contacts (company_name, source, status, relationship)
      VALUES (r.site, 'protean', 'won', 'existing')
      RETURNING id INTO who;
      n_new := n_new + 1;
    END IF;

    INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id, bound_by, bound_at)
    VALUES (r.division, r.alpha, r.site, who, auth.uid(), NOW())
    ON CONFLICT (division, alpha, site_name) DO UPDATE
      SET contact_id = EXCLUDED.contact_id, bound_at = NOW();

    UPDATE protean_invoices i SET contact_id = who
     WHERE i.division = r.division AND i.alpha = r.alpha
       AND BTRIM(i.site_name) = r.site AND i.contact_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;

    n_put := n_put + n;
    total := total + COALESCE(r.net, 0);
  END LOOP;

  RETURN QUERY SELECT n_put, n_new, n_none, ROUND(total, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.protean_make_customer(p_division text, p_alpha text, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE acc RECORD; made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;

  SELECT * INTO acc FROM protean_accounts
   WHERE division = p_division AND alpha = p_alpha;
  IF acc.alpha IS NULL THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;
  IF acc.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'That account is already a customer in the CRM.';
  END IF;

  clean := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), acc.protean_name);

  INSERT INTO crm_contacts (company_name, source, status, relationship)
  VALUES (clean, 'protean', 'won', 'existing')
  RETURNING id INTO made;

  PERFORM protean_bind(p_division, p_alpha, made);
  RETURN made;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protean_make_customer_for_work(p_division text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;
  clean := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF clean IS NULL THEN
    RAISE EXCEPTION 'That work has no customer name on it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs
                  WHERE division = p_division
                    AND lower(btrim(protean_name)) = lower(clean)
                    AND alpha IS NULL AND contact_id IS NULL AND still_open) THEN
    RAISE EXCEPTION 'No unplaced % work is under that name.', p_division;
  END IF;

  INSERT INTO crm_contacts (company_name, source, status, relationship)
  VALUES (clean, 'protean', 'won', 'existing')
  RETURNING id INTO made;

  PERFORM protean_place_open_work(p_division, clean, made);
  RETURN made;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_by_person(p_upto date DEFAULT NULL::date)
 RETURNS TABLE(person text, has_login boolean, trailers integer, trailer_value numeric, trailer_margin numeric, leads_open integer, pipeline_value numeric, leads_won integer, commission numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Sales by person needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH
  /* One row per person per source, keyed on the name lowercased and
     squeezed. Nothing fuzzier than that: see the header. */
  from_stock AS (
    SELECT lower(btrim(t.sales_rep))                   AS key,
           min(btrim(t.sales_rep))                     AS shown,
           count(*)::INTEGER                           AS trailers,
           COALESCE(SUM(t.sales_price), 0)::NUMERIC    AS value,
           COALESCE(SUM(t.profit), 0)::NUMERIC         AS margin
      FROM stock_trailers t
     WHERE t.status = 'sold'
       AND NULLIF(btrim(COALESCE(t.sales_rep, '')), '') IS NOT NULL
       AND sold_on(t) >= fy AND sold_on(t) <= upto
     GROUP BY 1
  ),
  from_leads AS (
    SELECT lower(btrim(COALESCE(p.full_name, p.email, l.rep_initials))) AS key,
           min(btrim(COALESCE(p.full_name, p.email, l.rep_initials)))   AS shown,
           count(*) FILTER (WHERE l.status NOT IN ('won', 'lost'))::INTEGER AS open,
           COALESCE(SUM(l.estimated_value)
                    FILTER (WHERE l.status NOT IN ('won', 'lost')), 0)::NUMERIC AS pipeline,
           count(*) FILTER (
             WHERE l.status = 'won'
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) >= fy
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) <= upto
           )::INTEGER AS won,
           COALESCE(SUM(l.commission) FILTER (
             WHERE l.status = 'won'
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) >= fy
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) <= upto
           ), 0)::NUMERIC AS commission
      FROM crm_leads l
      LEFT JOIN profiles p ON p.id = l.owner_id
     WHERE COALESCE(p.full_name, p.email, l.rep_initials) IS NOT NULL
     GROUP BY 1
  ),
  everyone AS (
    SELECT key FROM from_stock UNION SELECT key FROM from_leads
  )
  SELECT COALESCE(s.shown, d.shown),
         EXISTS (SELECT 1 FROM profiles pr
                  WHERE lower(btrim(COALESCE(pr.full_name, pr.email))) = e.key),
         COALESCE(s.trailers, 0),
         COALESCE(s.value, 0),
         COALESCE(s.margin, 0),
         COALESCE(d.open, 0),
         COALESCE(d.pipeline, 0),
         COALESCE(d.won, 0),
         COALESCE(d.commission, 0)
    FROM everyone e
    LEFT JOIN from_stock s ON s.key = e.key
    LEFT JOIN from_leads d ON d.key = e.key
   ORDER BY COALESCE(s.value, 0) DESC, COALESCE(d.pipeline, 0) DESC;
END;
$function$;

-- -------------------------------------------------------------
-- 3. Every account recomputed once, now the functions agree.
-- -------------------------------------------------------------
UPDATE crm_contacts c
   SET status = crm_account_status_from_leads(c.id)
 WHERE c.deleted_at IS NULL
   AND c.status IS DISTINCT FROM crm_account_status_from_leads(c.id);

-- -------------------------------------------------------------
-- 4. The two partial indexes whose predicate named the old word.
--
-- Both meant "still being worked". A won deal is finished, so it comes
-- out of the chase list the same way a lost one does. The predicate is
-- part of the index, so these have to be dropped and remade rather than
-- altered.
-- -------------------------------------------------------------
DROP INDEX IF EXISTS idx_leads_open;
CREATE INDEX IF NOT EXISTS idx_leads_open
  ON crm_leads (last_activity_at) WHERE status NOT IN ('won', 'lost');

/* And the one 042 added under a second name for the same predicate. */
DROP INDEX IF EXISTS idx_crm_leads_activity;

-- -------------------------------------------------------------
-- 5. AND THE WORD IS REFUSED FROM HERE ON.
--
-- This is the part that makes the rest of it stay true. A rule of the
-- form "we have agreed to stop writing customer" is kept by whoever
-- remembers it. A CHECK constraint is kept by the database.
--
-- It is tightened LAST, after every row has moved and every function
-- has been replaced, so anything still writing the old word fails
-- loudly and immediately rather than quietly putting a row somewhere
-- no screen counts.
-- -------------------------------------------------------------
ALTER TABLE crm_leads    DROP CONSTRAINT IF EXISTS crm_leads_status_check;
ALTER TABLE crm_leads    ADD  CONSTRAINT crm_leads_status_check
  CHECK (status IN ('lead', 'contacted', 'quoted', 'won', 'lost'));

ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_status_check;
ALTER TABLE crm_contacts ADD  CONSTRAINT crm_contacts_status_check
  CHECK (status IN ('lead', 'contacted', 'quoted', 'won', 'lost'));

COMMENT ON COLUMN crm_leads.status IS
  'lead, contacted, quoted, won or lost. Won is the end state: there is no '
  'separate customer status, because it was a second word for the same event '
  'and half the application counted one and half the other. Winning sets the '
  'company relationship to existing, which is what says they are a customer.';

DO $$
BEGIN
  RAISE NOTICE 'won is the only won: % lead(s) and % account(s) still say customer (want 0 and 0)',
    (SELECT count(*) FROM crm_leads    WHERE status = 'customer'),
    (SELECT count(*) FROM crm_contacts WHERE status = 'customer');
END $$;
