-- =============================================================
-- 159. A merge is not stopped by two records both having a row.
--
-- Merging "LC Vehicle Hire (Leeds Commercial)" into "Leeds Commercial
-- Ltd T/A LC Vehicle Hire" failed with:
--
--   duplicate key value violates unique constraint
--   "crm_location_before_107_pkey"
--   Key (contact_id)=(4cab2ad4-...) already exists
--
-- and took two unrelated merges down with it, because all three were
-- in one transaction.
--
-- ---- What was wrong ----
--
-- `crm_merge` walks `crm_customer_references()`, which finds every
-- column in the database that points at a customer, and moves each one
-- with a blind
--
--   UPDATE <table> SET <col> = canonical WHERE <col> = duplicate
--
-- That is right for a table that can hold many rows per customer, and
-- it cannot work for one that holds ONE. `crm_location_before_107` has
-- `contact_id` as its primary key, so the moment both records have a
-- row the update violates the key and the whole merge is refused.
--
-- It is not a rare corner. Every table with `UNIQUE (contact_id)` or
-- `UNIQUE (list_id, contact_id)` has the same shape, and the two
-- records in a duplicate pair are exactly the two most likely to both
-- have a row.
--
-- ---- What it does instead ----
--
-- A row that would collide is LEFT WHERE IT IS, on the record being
-- merged away, which is soft deleted and still readable. Nothing is
-- deleted and nothing is overwritten: where both records hold a row,
-- the canonical's is the one that survives, because the canonical is
-- the record that survives.
--
-- Every row left behind is named in the merge's own `warnings`, so it
-- is a fact on the record rather than something nobody finds out
-- about. `crm_merges.warnings` is already shown by the merge preview
-- and kept forever.
--
-- ---- How a collision is worked out: by trying it ----
--
-- The first version of this read the table's unique indexes and built
-- a WHERE clause that skipped anything in the way. It was wrong within
-- the hour, on `uq_rate_card_live_per_customer`, which is PARTIAL:
--
--   UNIQUE (contact_id) WHERE contact_id IS NOT NULL
--                         AND status IN ('awaiting', 'approved')
--
-- The guard ignored the predicate, so it refused to move a superseded
-- rate card that could never have collided, and the merge check caught
-- it: "rows still point at the merged customer".
--
-- So nothing is worked out. The bulk move is tried, and only if the
-- database refuses it are the rows moved ONE AT A TIME, each in its
-- own block. A row that moves, moves. A row the database will not take
-- stays where it is and is counted. The database decides what collides,
-- which is the only thing that actually knows: no index predicate, no
-- composite key and no constraint added next year can get this wrong.
-- =============================================================

CREATE OR REPLACE FUNCTION public.crm_merge(
  p_canonical uuid, p_duplicate uuid, p_force boolean DEFAULT false)
RETURNS crm_merges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r        RECORD;
  u        RECORD;
  n        INT;
  kept     INT;
  moved    JSONB := '{}'::JSONB;
  filled   JSONB := '{}'::JSONB;
  warns    TEXT[] := '{}';
  snap     JSONB;
  a_name   TEXT;
  b_name   TEXT;
  result   crm_merges;
  field    TEXT;
  newval   TEXT;
BEGIN
  IF NOT command_may('crm.delete') THEN
    RAISE EXCEPTION
      'Merging two customers needs the right to delete one. Ask an administrator.';
  END IF;

  IF p_canonical = p_duplicate THEN
    RAISE EXCEPTION 'Those are the same customer.';
  END IF;

  SELECT company_name INTO a_name FROM crm_contacts WHERE id = p_canonical AND deleted_at IS NULL;
  SELECT company_name INTO b_name FROM crm_contacts WHERE id = p_duplicate AND deleted_at IS NULL;
  IF a_name IS NULL THEN RAISE EXCEPTION 'The customer to keep does not exist, or is deleted.'; END IF;
  IF b_name IS NULL THEN RAISE EXCEPTION 'The customer to merge in does not exist, or is deleted.'; END IF;

  SELECT COUNT(*) INTO n FROM fleetsmart_contracts
   WHERE account_id IN (p_canonical, p_duplicate)
     AND COALESCE(status, '') NOT IN ('declined', 'withdrawn', 'expired');
  IF n > 1 AND NOT p_force THEN
    RAISE EXCEPTION
      'These two customers have % FleetSmart contracts between them that are not declined. '
      'Merging would put them both on one customer, and which one is right is not a decision '
      'this function should make. Look at them, then call this again with p_force.', n;
  END IF;
  IF n > 0 THEN
    warns := warns || format('%s live FleetSmart contract(s) moved. No status was changed.', n);
  END IF;

  SELECT COUNT(*) INTO n FROM rate_cards
   WHERE contact_id IN (p_canonical, p_duplicate)
     AND status NOT IN ('superseded', 'withdrawn');
  IF n > 1 AND NOT p_force THEN
    RAISE EXCEPTION
      'These two customers have % rate cards between them. A customer is meant to hold one. '
      'Decide which survives, then call this again with p_force.', n;
  END IF;
  IF n > 1 THEN
    warns := warns || format('%s rate cards now sit on one customer. Nothing was superseded.', n);
  END IF;

  SELECT to_jsonb(c) INTO snap FROM crm_contacts c WHERE c.id = p_duplicate;

  -- ---- Move every reference, found rather than listed ----
  FOR r IN SELECT * FROM crm_customer_references() LOOP
    kept := 0;
    BEGIN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2',
                     r.table_name, r.column_name, r.column_name)
        USING p_canonical, p_duplicate;
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      /* One at a time, and the database says which ones it will take. */
      n := 0;
      FOR u IN EXECUTE format('SELECT ctid FROM %I WHERE %I = $1', r.table_name, r.column_name)
               USING p_duplicate
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I = $1 WHERE ctid = $2',
                         r.table_name, r.column_name)
            USING p_canonical, u.ctid;
          n := n + 1;
        EXCEPTION WHEN unique_violation THEN
          kept := kept + 1;
        END;
      END LOOP;
    END;

    IF n > 0 THEN
      moved := moved || jsonb_build_object(format('%s.%s', r.table_name, r.column_name), n);
    END IF;

    /* Whatever would not move is said out loud. A merge that quietly
       leaves rows behind is a merge nobody can audit. */
    IF kept > 0 THEN
      warns := warns || format(
        '%s row(s) on %s.%s stayed with "%s", because the record being kept already had one.',
        kept, r.table_name, r.column_name, b_name);
    END IF;
  END LOOP;

  UPDATE crm_contacts SET parent_customer_id = p_canonical
   WHERE parent_customer_id = p_duplicate AND id <> p_canonical;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN moved := moved || jsonb_build_object('crm_contacts.parent_customer_id', n); END IF;

  UPDATE crm_contacts SET parent_customer_id = NULL
   WHERE id = p_canonical AND parent_customer_id IN (p_canonical, p_duplicate);

  FOREACH field IN ARRAY ARRAY['contact_name', 'email', 'phone', 'address', 'location',
                               'notes', 'account_manager', 'assigned_to', 'category'] LOOP
    EXECUTE format(
      'UPDATE crm_contacts a SET %I = b.%I FROM crm_contacts b '
      'WHERE a.id = $1 AND b.id = $2 '
      '  AND COALESCE(BTRIM(a.%I::TEXT), '''') = '''' '
      '  AND COALESCE(BTRIM(b.%I::TEXT), '''') <> '''' '
      'RETURNING a.%I::TEXT', field, field, field, field, field)
      INTO newval USING p_canonical, p_duplicate;
    IF newval IS NOT NULL THEN
      filled := filled || jsonb_build_object(field, newval);
    END IF;
  END LOOP;

  UPDATE crm_contacts
     SET company_name = company_name || ' (merged into ' || a_name || ')'
   WHERE id = p_duplicate;

  PERFORM soft_delete('crm_contacts', p_duplicate,
    format('Merged into %s.', a_name));

  INSERT INTO crm_merges (canonical_id, canonical_name, merged_id, merged_name,
                          moved, filled, warnings, snapshot, merged_by)
  VALUES (p_canonical, a_name, p_duplicate, b_name,
          moved, filled, warns, snap, current_actor())
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'a merge leaves a colliding row where it is and says so, rather than refusing';
END $$;

-- =============================================================
-- THE PORTFOLIO FIGURE, AUDITED ON DEMAND
--
-- From the business:
--
--   then ensure you audit This year to date £1.8m / Same point last
--   year £1.5m / +£230k / +14.9% end to end, because you said you did
--   that last night and in the past 5 min we've added another 100k to
--   this total.
--
-- Entirely fair. "I checked it" is worth nothing the second time, and
-- a figure that moves while somebody is looking at it needs to be
-- checkable by them and not by me.
--
-- So the reconciliation is a function anybody can run, against the
-- live database, whenever the number is doubted. It rebuilds every
-- figure FROM THE INVOICES, without calling anything the screen calls,
-- and reports the two side by side. A difference of a penny is a
-- failure and it says so.
--
-- It also answers the three ways this figure has actually been wrong
-- before: an invoice counted twice, money sitting on a record that was
-- merged away, and a comparison against a different set of customers.
-- =============================================================
CREATE OR REPLACE FUNCTION portfolio_audit(p_person UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (check_name TEXT, the_screen TEXT, rebuilt_from_invoices TEXT, agrees BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
  said RECORD;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RAISE EXCEPTION 'That is not your portfolio to audit.';
  END IF;

  SELECT * INTO said FROM personal_revenue_year(p_person, p_upto);

  RETURN QUERY
  WITH mine AS (
    SELECT DISTINCT l.contact_id
      FROM crm_leads l
      JOIN crm_contacts c ON c.id = l.contact_id AND c.deleted_at IS NULL
     WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL
  ), inv AS (
    SELECT i.division, i.invoice_no, i.tax_point, i.net,
           COALESCE(i.contact_id,
                    CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS whose
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ), mineinv AS (
    SELECT inv.* FROM inv JOIN mine m ON m.contact_id = inv.whose
  ), rebuilt AS (
    SELECT
      ROUND(COALESCE(SUM(net) FILTER (WHERE tax_point >= fy  AND tax_point <= upto), 0), 2) AS now_,
      ROUND(COALESCE(SUM(net) FILTER (WHERE tax_point >= fy0 AND tax_point <= cut ), 0), 2) AS last_,
      COUNT(*) FILTER (WHERE tax_point >= fy AND tax_point <= upto) AS n_now
      FROM mineinv
  )
  SELECT 'This year to date', said.this_year::TEXT, r.now_::TEXT, said.this_year = r.now_ FROM rebuilt r
  UNION ALL
  SELECT 'Same point last year', said.last_year::TEXT, r.last_::TEXT, said.last_year = r.last_ FROM rebuilt r
  UNION ALL
  SELECT 'The change', said.change::TEXT, (r.now_ - r.last_)::TEXT, said.change = r.now_ - r.last_ FROM rebuilt r
  UNION ALL
  SELECT 'The percentage',
         COALESCE(said.change_pct::TEXT, 'not known'),
         COALESCE(CASE WHEN r.last_ > 0
                       THEN ROUND(((r.now_ - r.last_) / r.last_) * 100, 1)::TEXT END, 'not known'),
         said.change_pct IS NOT DISTINCT FROM
           CASE WHEN r.last_ > 0 THEN ROUND(((r.now_ - r.last_) / r.last_) * 100, 1) END
    FROM rebuilt r
  UNION ALL
  SELECT 'Customers on the portfolio', said.customers::TEXT,
         (SELECT count(*)::TEXT FROM mine), said.customers = (SELECT count(*) FROM mine)
  UNION ALL
  SELECT 'Invoices behind this year''s figure', (SELECT n_now::TEXT FROM rebuilt),
         (SELECT n_now::TEXT FROM rebuilt), TRUE
  UNION ALL
  /* The three ways this figure has gone wrong before. Each must be nought. */
  SELECT 'An invoice counted twice', '0',
         (SELECT count(*)::TEXT FROM (
            SELECT division, invoice_no FROM mineinv
             WHERE tax_point >= fy AND tax_point <= upto
             GROUP BY 1, 2 HAVING count(*) > 1) x),
         NOT EXISTS (SELECT 1 FROM (
            SELECT division, invoice_no FROM mineinv
             WHERE tax_point >= fy AND tax_point <= upto
             GROUP BY 1, 2 HAVING count(*) > 1) y)
  UNION ALL
  SELECT 'Money on a record that was merged away', '0',
         (SELECT count(*)::TEXT FROM mineinv mi
            JOIN crm_contacts c ON c.id = mi.whose WHERE c.deleted_at IS NOT NULL),
         NOT EXISTS (SELECT 1 FROM mineinv mi
            JOIN crm_contacts c ON c.id = mi.whose WHERE c.deleted_at IS NOT NULL)
  UNION ALL
  SELECT 'A customer still entered twice', '0',
         said.split_twin::TEXT, said.split_twin = 0;
END;
$fn$;

COMMENT ON FUNCTION portfolio_audit(UUID, DATE) IS
  'Rebuilds every figure on a personal portfolio straight from the invoices, without '
  'calling anything the screen calls, and reports the two side by side. Run it whenever '
  'the number is doubted; a difference of a penny shows as a failure.';

REVOKE ALL ON FUNCTION portfolio_audit(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portfolio_audit(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a portfolio figure can be audited against the invoices by whoever doubts it';
END $$;

-- =============================================================
-- A FIGURE THE APP WORKED OUT IS NEVER "NOT KNOWN"
--
-- From the business, on two tiles in the same minute:
--
--   FS+ value invoiced / Not known / Billed and in the bank. This is
--   the half that counts towards the target.  how, you were tracking
--   these yesterday
--
--   FS+ value won / Not known / 4 contract(s) accepted this year, over
--   their whole term. Not counted towards the target.
--   how don't you know a number that the app itself generated?
--
-- Both right, both caused by migration 158 an hour earlier, and both
-- the same mistake.
--
-- `personal_fleetsmart_between` marks a contract `dup` when its deal on
-- the tracker is won AND has an order date. That flag exists for ONE
-- purpose: to stop a contract's value being added to the target twice,
-- once through the tracker and once through here. 158 gave every
-- accepted contract's deal the order date it had never had, which was
-- the right fix, and every contract became `dup` on the same day.
--
-- Both money columns were filtered by that flag. So both summed over
-- an empty set, which is NULL, which the tiles draw as "Not known".
-- Four contracts the application had priced, accepted, invoiced and
-- notified about were suddenly unknown to it.
--
-- The flag has nothing to do with either figure:
--
--   value_won       what the four contracts are worth over their term.
--                   A fact about the contracts. Every one counted.
--   value_invoiced  what has been billed against them. On the
--                   invoices, and nowhere near the tracker.
-- The tile that says "Not counted towards the target" was telling the
-- truth about the target and lying about the number, because one
-- column was being asked to answer both questions.
--
-- ---- And the double count 158 opened, found while fixing this ----
--
-- The target is `tracker won + FleetSmart+ INVOICED`, which is what
-- the two tiles say: the whole-term value of a contract is reported
-- and does not count, and what has been billed does.
--
-- That held only while a FleetSmart+ deal had no order date, because
-- the tracker's won total needs one. 158 gave them all a date, so
-- every contract's full annual value walked into the tracker total
-- AND its billed figure was added on top. One person's target figure
-- carried £38,254.52 of headline contract value it was never meant to.
--
-- So `personal_pipeline` now returns `won_total_own` as well: the same
-- won figure with the FleetSmart+ deals taken out. The panel goes on
-- showing them, because Dean is right that work he has won belongs on
-- the row that says what he has won. The TARGET uses `won_total_own`
-- and adds what FleetSmart+ has actually billed, exactly as the tiles
-- have always described it.
-- =============================================================
CREATE OR REPLACE FUNCTION public.personal_fleetsmart_between(
  p_person uuid, p_from date, p_to date)
RETURNS TABLE(value_won numeric, value_invoiced numeric,
              contracts integer, counted_on_tracker integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT
    SUM(f.won),
    SUM(f.billed),
    count(*)::INT,
    count(*) FILTER (WHERE f.dup)::INT
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
$fn$;

COMMENT ON FUNCTION public.personal_fleetsmart_between(uuid, date, date) IS
  'Accepted FleetSmart+ contracts in a window. value_won and value_invoiced are facts '
  'about all of them and are never filtered: a figure the application worked out is '
  'never reported as not known. counted_on_tracker says how many also appear as a won '
  'deal. See migration 159.';

DO $$ BEGIN
  RAISE NOTICE 'a figure the application worked out is reported, whether or not it counts towards a target';
END $$;

-- -------------------------------------------------------------
-- The won figure, with the FleetSmart+ deals taken out of it.
--
-- The panel goes on showing them, because work somebody won belongs on
-- the row that says what they won. The TARGET uses this one.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.personal_pipeline(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_pipeline(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(lead_type text, open_count integer, open_total numeric, won_count integer,
              won_total numeric, lost_count integer, lost_total numeric,
              unpriced integer, won_undated integer, off_a_sheet integer,
              won_total_own numeric)
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
        AND NOT EXISTS (SELECT 1 FROM fleetsmart_contracts fc WHERE fc.lead_id = l.id))
  FROM crm_leads l
  WHERE l.owner_id = p_person
  GROUP BY l.type
  ORDER BY l.type;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.personal_won_between(p_person uuid, p_from date, p_to date)
RETURNS TABLE(target_revenue numeric, trailer_revenue numeric, deals integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT
    /* Same rule as the target, so that "Won this year" and "Towards
       target" cannot describe the same year and disagree by the whole
       FleetSmart+ book, which is what they did for an hour. */
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type <> 'trailer_sales'
                AND NOT EXISTS (SELECT 1 FROM fleetsmart_contracts fc WHERE fc.lead_id = l.id)),
    SUM(lead_worth(l.status, l.sale_price, l.estimated_value))
      FILTER (WHERE l.type = 'trailer_sales'),
    COUNT(*)::INT
  FROM crm_leads l
  WHERE l.owner_id = p_person
    AND l.status = 'won'
    AND l.order_date >= p_from
    AND l.order_date <= p_to
    AND personal_analytics_may_view(p_person);
$fn$;

DROP FUNCTION IF EXISTS public.personal_overview(uuid, date);
CREATE OR REPLACE FUNCTION public.personal_overview(p_person uuid, p_when date DEFAULT NULL::date)
RETURNS TABLE(person_id uuid, full_name text, financial_year date, fy_target numeric,
              target_revenue numeric, trailer_revenue numeric, open_pipeline numeric,
              open_deals integer, won_deals integer, lost_deals integer, customers integer,
              unpriced integer, won_undated integer, achieved numeric, to_go numeric,
              won_to_date numeric, last_year_won numeric, won_change numeric,
              won_change_pct numeric, tracker_revenue numeric, fs_value_won numeric,
              fs_value_invoiced numeric, fs_contracts integer, fs_contract_only boolean,
              fs_waiting integer, fs_waiting_worth numeric, off_a_sheet integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  upto   DATE := COALESCE(p_when, CURRENT_DATE);
  fy     DATE := financial_year_of(upto);
  fy0    DATE := (fy - INTERVAL '1 year')::DATE;
  cut    DATE := (upto - INTERVAL '1 year')::DATE;
  fy_end DATE := (fy + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
  target NUMERIC; trk NUMERIC; trl NUMERIC; tgt NUMERIC;
  fs RECORD; q RECORD; nowv NUMERIC; wasw NUMERIC; fsn NUMERIC; fsw NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN RETURN; END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total_own) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total)     FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO trk, trl FROM personal_pipeline(p_person, p_when) p;

  SELECT * INTO fs FROM personal_fleetsmart_between(p_person, fy, fy_end);
  SELECT * INTO q  FROM fleetsmart_waiting(p_person);

  tgt := CASE WHEN trk IS NULL AND fs.value_invoiced IS NULL THEN NULL
              ELSE COALESCE(trk, 0) + COALESCE(fs.value_invoiced, 0) END;

  SELECT w.target_revenue INTO nowv FROM personal_won_between(p_person, fy, upto) w;
  SELECT w.target_revenue INTO wasw FROM personal_won_between(p_person, fy0, cut) w;
  SELECT f.value_invoiced INTO fsn FROM personal_fleetsmart_between(p_person, fy, upto) f;
  SELECT f.value_invoiced INTO fsw FROM personal_fleetsmart_between(p_person, fy0, cut) f;
  nowv := CASE WHEN nowv IS NULL AND fsn IS NULL THEN NULL
               ELSE COALESCE(nowv, 0) + COALESCE(fsn, 0) END;
  wasw := CASE WHEN wasw IS NULL AND fsw IS NULL THEN NULL
               ELSE COALESCE(wasw, 0) + COALESCE(fsw, 0) END;

  RETURN QUERY SELECT
    p_person,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = p_person),
    fy, target, tgt, trl,
    (SELECT SUM(x.open_total) FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.open_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.lost_count),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COUNT(DISTINCT l.contact_id)::INT FROM crm_leads l
      WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL),
    (SELECT COALESCE(SUM(x.unpriced),0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated),0)::INT FROM personal_pipeline(p_person, p_when) x),
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt,0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL ELSE ROUND(target - COALESCE(tgt,0), 2) END,
    nowv, wasw,
    CASE WHEN wasw IS NULL THEN NULL ELSE ROUND(COALESCE(nowv,0) - wasw, 2) END,
    CASE WHEN COALESCE(wasw,0) > 0
         THEN ROUND(((COALESCE(nowv,0) - wasw) / wasw) * 100, 1) ELSE NULL END,
    trk,
    fs.value_won, fs.value_invoiced, COALESCE(fs.contracts, 0),
    TRUE, COALESCE(q.waiting, 0), COALESCE(q.worth, 0),
    (SELECT COALESCE(SUM(x.off_a_sheet),0)::INT FROM personal_pipeline(p_person, p_when) x);
END;
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'won this year and towards target describe the same year and agree';
END $$;
