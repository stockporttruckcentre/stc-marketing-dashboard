-- =============================================================
-- 092. A trailer customer is a customer.
--
-- From the business, on the Analytics screen:
--
--   "8 of these are on an account with no CRM record, so they are in
--   this column and on nobody's customer page. They are waiting under
--   Revenue, Accounts." but nothing is under accounts so this is broken
--   hardcoded code.
--
--   Unsure why trailer sales isn't on reconciliation tab - you've put
--   that it doesn't get included but why. You mentioned named customers
--   but not 1 single record on the trailer sales tab RE customers
--   should exist if they don't already have a CRM record.
--
-- Both right, and they are the same fault seen from two sides.
--
-- ---- What I claimed, and why it was wrong ----
--
-- Migration 090 said: "Trailer sales are not here: a trailer is sold to
-- a named customer or it is not sold." That sentence is about the
-- SPREADSHEET, not about the CRM. `stock_trailers.customer` is free
-- text typed by whoever closed the deal. It is always filled in and it
-- is very often not a company anybody has made a record for, and when
-- it is spelled differently from the CRM's version it does not link.
--
-- So a trailer sale sits in exactly the same state as an unplaced
-- Protean account: real revenue, on no customer's page. Leaving it off
-- the reconciliation meant the one screen whose whole job is naming
-- that gap was silent about a third of the company.
--
-- ---- And the alert pointed nowhere ----
--
-- Revenue, Accounts is the Protean moderation queue. Trailer customers
-- have never been in it and never will be: they do not come from
-- Protean and have no account code. The alert sent somebody to an empty
-- screen and told them their work was waiting there.
--
-- What is needed instead is the thing the business asked for outright:
-- make the record. `trailer_customers_waiting` is the queue, and
-- `make_customer_for_trailer` is the button.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Reconciliation counts all three divisions.
--
-- The return type gains nothing and loses nothing; what changes is that
-- the trailer row exists. Dropped first because the body changes and
-- this file has to be safe to run twice.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS division_reconciliation(DATE);

CREATE OR REPLACE FUNCTION division_reconciliation(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division       TEXT,
  name           TEXT,
  sort_order     INTEGER,
  billed         NUMERIC,
  on_customers   NUMERIC,
  unattributed   NUMERIC,
  unattributed_n INTEGER,
  set_aside      NUMERIC,
  set_aside_n    INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reconciling revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  /* The two that come out of Protean. */
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NOT NULL AND NOT a.ignored), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NULL AND NOT a.ignored), 0)::NUMERIC,
         count(DISTINCT a.alpha) FILTER (
           WHERE a.contact_id IS NULL AND NOT a.ignored)::INTEGER,
         COALESCE(SUM(i.net) FILTER (WHERE a.ignored), 0)::NUMERIC,
         count(DISTINCT a.alpha) FILTER (WHERE a.ignored)::INTEGER
    FROM divisions d
    LEFT JOIN protean_invoices i
      ON i.division = d.slug AND i.tax_point >= fy AND i.tax_point <= upto
    LEFT JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   WHERE d.slug IN ('stc', 'rental')
   GROUP BY d.slug, d.name, d.sort_order

  UNION ALL

  /* And the one that comes out of the stock list.

     The gap is counted by CUSTOMER NAME rather than by trailer,
     because "eight accounts have no record" is a job somebody can do
     and "eleven trailers have no record" is the same job counted in
     the wrong unit: two trailers sold to one haulier are one record to
     make.

     Nothing is set aside here. Protean has Cash Sale and the group's
     own leasing company sitting in its ledger; the stock list has no
     equivalent, and reporting nought is honest rather than a gap. */
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(t.sales_price), 0)::NUMERIC,
         COALESCE(SUM(t.sales_price) FILTER (WHERE t.contact_id IS NOT NULL), 0)::NUMERIC,
         COALESCE(SUM(t.sales_price) FILTER (WHERE t.contact_id IS NULL), 0)::NUMERIC,
         count(DISTINCT lower(btrim(t.customer))) FILTER (
           WHERE t.contact_id IS NULL
             AND NULLIF(btrim(COALESCE(t.customer, '')), '') IS NOT NULL)::INTEGER,
         0::NUMERIC,
         0::INTEGER
    FROM divisions d
    LEFT JOIN stock_trailers t
      ON d.slug = 'trailer' AND t.status = 'sold'
     AND sold_on(t) >= fy AND sold_on(t) <= upto
   WHERE d.slug = 'trailer'
   GROUP BY d.slug, d.name, d.sort_order

   ORDER BY 3;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_reconciliation(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 2. The trailer customers with nobody behind them.
--
-- The equivalent of `protean_to_moderate`, for the division that has
-- never had one. One row per name, however many trailers they bought.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION trailer_customers_waiting(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  customer   TEXT,
  trailers   INTEGER,
  value      NUMERIC,
  last_sold  DATE,
  /* A CRM record whose name is close enough to be worth a look but not
     close enough to link on. Never applied automatically: the exact
     rule in `link_trailer_sales` is what stops one haulier's purchase
     landing on another haulier's record, and this only suggests. */
  looks_like UUID,
  looks_like_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Trailer customers need access to the CRM.';
  END IF;

  RETURN QUERY
  WITH waiting AS (
    SELECT btrim(t.customer) AS customer,
           count(*)::INTEGER AS trailers,
           COALESCE(SUM(t.sales_price), 0)::NUMERIC AS value,
           max(sold_on(t)) AS last_sold
      FROM stock_trailers t
     WHERE t.status = 'sold'
       AND t.contact_id IS NULL
       AND NULLIF(btrim(COALESCE(t.customer, '')), '') IS NOT NULL
       AND sold_on(t) >= fy AND sold_on(t) <= upto
     GROUP BY btrim(t.customer)
  )
  SELECT w.customer, w.trailers, w.value, w.last_sold, c.id, c.company_name
    FROM waiting w
    LEFT JOIN LATERAL (
      /* Case and punctuation aside, and nothing cleverer. A near miss
         offered as a suggestion is a person's decision; a near miss
         applied is a figure in a board meeting nobody can explain. */
      SELECT x.id, x.company_name FROM crm_contacts x
       WHERE regexp_replace(lower(x.company_name), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(w.customer),      '[^a-z0-9]', '', 'g')
       LIMIT 1
    ) c ON TRUE
   ORDER BY w.value DESC, w.customer;
END;
$fn$;

GRANT EXECUTE ON FUNCTION trailer_customers_waiting(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 3. Make the record, and link every trailer to it.
--
-- From the business: "customers should exist if they don't already
-- have a CRM record".
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION make_customer_for_trailer(
  p_name TEXT, p_contact UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  name  TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  made  UUID;
  moved INTEGER;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Creating a customer needs permission to edit the CRM.';
  END IF;
  IF name IS NULL THEN
    RAISE EXCEPTION 'A customer needs a name.';
  END IF;

  IF p_contact IS NOT NULL THEN
    /* Binding to a record that already exists, which is the answer when
       the suggestion above was right. */
    SELECT id INTO made FROM crm_contacts WHERE id = p_contact;
    IF made IS NULL THEN
      RAISE EXCEPTION 'That customer record is not there.';
    END IF;
  ELSE
    /* An exact match first, so pressing this twice does not make a
       second Dawson. */
    SELECT id INTO made FROM crm_contacts
     WHERE lower(btrim(company_name)) = lower(name) LIMIT 1;

    IF made IS NULL THEN
      INSERT INTO crm_contacts (company_name, source, status)
      VALUES (name, 'trailer_sales', 'customer')
      RETURNING id INTO made;
    END IF;
  END IF;

  /* Every sold trailer carrying that name, whatever year it was in.
     The reconciliation only counts this year, and a customer record
     that covers this year's trailer and not last year's would make the
     record itself wrong. */
  UPDATE stock_trailers t
     SET contact_id = made
   WHERE t.contact_id IS NULL
     AND lower(btrim(t.customer)) = lower(name);
  GET DIAGNOSTICS moved = ROW_COUNT;

  PERFORM audit('update', 'crm_contacts', made, name,
                jsonb_build_object('from', 'trailer sales', 'trailers_linked', moved));

  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION make_customer_for_trailer(TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
/* The catalogue, not the functions themselves. Every read here checks
   `command_may('crm.view')` and a migration runs with nobody signed in,
   so calling one to prove it landed fails on permission rather than on
   anything being wrong. That the trailer row now comes back is asserted
   by `npm run check:finance`, where there is an actor to be. */
DO $$
DECLARE missing TEXT;
BEGIN
  FOREACH missing IN ARRAY ARRAY[
    'division_reconciliation', 'trailer_customers_waiting', 'make_customer_for_trailer'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = missing
    ) THEN
      RAISE EXCEPTION '092 did not land: % is not there', missing;
    END IF;
  END LOOP;
END $$;
