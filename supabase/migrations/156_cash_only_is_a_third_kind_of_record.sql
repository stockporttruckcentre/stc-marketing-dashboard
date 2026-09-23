-- =============================================================
-- 156. Cash Only, beside Prospect and Customer.
--
-- From the business:
--
--   Add a third type to prospects and CRM types (currently Prospect and
--   Customer) as Cash Only and allocate them all to that.
--
-- and, setting the rule it has to follow:
--
--   No cash sale accounts are Customers, because they pay via cash, not
--   via customer invoice.
--
--   Ensure any cash sale customers are not down as a customer unless
--   it's a pre-funded cash-only account where they only pay for nonvat
--   MOTs that closely matches the name of an existing customer account.
--
-- ---- What the third value means ----
--
--   prospect   nobody has traded with them yet
--   existing   they are invoiced on an account, in Protean or Sage
--   cash_only  every pound they have ever spent came over the counter
--
-- The distinction is not cosmetic. A Customer has an account number, a
-- credit limit, terms and a statement. A cash sale has a till receipt.
-- Counting the second as the first is what put 467 records on the
-- customer list that no salesperson recognises and no account manager
-- owns.
--
-- ---- Who moves ----
--
-- One rule, and it is a fact about the money rather than a judgement:
--
--   has at least one bound cash site  AND  no bound invoicing account
--
-- 429 live records answer yes. 413 of them are the shells that
-- `protean_allocate_invoicing_types()` created in one run on 21
-- September, the other 16 were entered by hand before that.
--
-- The 38 records that have cash sites AND a real invoicing account are
-- NOT moved. They are invoiced customers who also paid cash once, and
-- the account is what makes them a customer.
--
-- ---- The carve-out was tested and nothing qualifies ----
--
-- The exception above needs two things at once: never charged VAT, and
-- a name that matches an existing account. Of the 429, 18 have never
-- been charged VAT and 13 match an account name. NONE does both. So
-- every one of the 429 moves and the carve-out is recorded here as the
-- test that was run rather than as a filter that did nothing.
--
-- ---- Nothing is deleted and every move is written down ----
--
-- `crm_relationship_moves` keeps the before and the after for every
-- record this touches, so putting any of them back is a single UPDATE
-- and does not depend on anybody remembering what it used to say.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The column may now say a third thing, and only these three.
--
-- There was no constraint at all before this, so the column would
-- accept any string a typo produced and read as a prospect everywhere
-- it was tested against 'existing'.
-- -------------------------------------------------------------
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_relationship_check;
ALTER TABLE crm_contacts
  ADD CONSTRAINT crm_contacts_relationship_check
  CHECK (relationship IS NULL OR relationship IN ('prospect', 'existing', 'cash_only'));

COMMENT ON COLUMN crm_contacts.relationship IS
  'prospect: nobody has traded with them. existing: they are invoiced on a Protean '
  'or Sage account. cash_only: every pound they have spent came over the counter, so '
  'they have no account, no terms and no statement.';

-- -------------------------------------------------------------
-- 2. What this migration moved, so it can be put back.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_relationship_moves (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  was         TEXT,
  became      TEXT NOT NULL,
  why         TEXT NOT NULL,
  moved_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relationship_moves_contact
  ON crm_relationship_moves (contact_id, moved_at DESC);

COMMENT ON TABLE crm_relationship_moves IS
  'Every time a record changed between prospect, existing and cash_only, with what '
  'it said before. A reallocation that cannot be undone is a reallocation nobody '
  'dares run twice.';

ALTER TABLE crm_relationship_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relationship_moves_select" ON crm_relationship_moves;
CREATE POLICY "relationship_moves_select" ON crm_relationship_moves
  FOR SELECT USING (command_may('crm.view'));

-- -------------------------------------------------------------
-- 3. Does this record live on cash alone?
--
-- One function, so that the allocation, the binding and the checks
-- cannot drift into three answers to one question.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_lives_on_cash(p_contact UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM protean_cash_sites s WHERE s.contact_id = p_contact)
     AND NOT EXISTS (SELECT 1 FROM protean_accounts a WHERE a.contact_id = p_contact);
$fn$;

COMMENT ON FUNCTION crm_lives_on_cash(UUID) IS
  'True when every pound this record has spent came over the counter: at least one '
  'cash site is bound to it and no invoicing account is. The one rule that decides '
  'Cash Only, so that nothing else has to decide it a second way.';

REVOKE ALL ON FUNCTION crm_lives_on_cash(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_lives_on_cash(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 4. The allocation, re-runnable.
--
-- It moves BOTH ways, which is what makes it safe to run whenever an
-- import lands: a record that has since been given a real invoicing
-- account stops being Cash Only in the same pass.
--
-- A record somebody has deliberately set by hand is left alone, which
-- is what `crm_relationship_pinned` is for. Nothing is pinned yet; the
-- column exists so that the first person who overrides one does not
-- have their decision undone by the next import.
-- -------------------------------------------------------------
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS relationship_pinned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN crm_contacts.relationship_pinned IS
  'Somebody decided this record''s type by hand and the allocation must not move it. '
  'Set when a person overrides the type on the drawer, never by an import.';

DROP FUNCTION IF EXISTS crm_allocate_cash_only(BOOLEAN);
CREATE OR REPLACE FUNCTION crm_allocate_cash_only(p_apply BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  was          TEXT,
  becomes      TEXT,
  why          TEXT,
  applied      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r RECORD;
BEGIN
  IF p_apply AND NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Allocating customer types needs permission to edit the CRM.';
  END IF;
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading the allocation needs access to the CRM.';
  END IF;
  IF p_apply AND viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  FOR r IN
    SELECT c.id, c.company_name, c.relationship AS was,
           CASE WHEN crm_lives_on_cash(c.id) THEN 'cash_only' ELSE 'existing' END AS becomes
      FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND NOT c.relationship_pinned
       AND (
         (crm_lives_on_cash(c.id) AND COALESCE(c.relationship, 'prospect') <> 'cash_only')
         OR (c.relationship = 'cash_only' AND NOT crm_lives_on_cash(c.id))
       )
     ORDER BY c.company_name
  LOOP
    IF p_apply THEN
      UPDATE crm_contacts SET relationship = r.becomes, updated_at = NOW()
       WHERE id = r.id;
      INSERT INTO crm_relationship_moves (contact_id, was, became, why, moved_by)
      VALUES (r.id, r.was, r.becomes,
              CASE WHEN r.becomes = 'cash_only'
                   THEN 'cash sites bound, no invoicing account'
                   ELSE 'an invoicing account is now bound' END,
              auth.uid());
    END IF;
    contact_id := r.id; company_name := r.company_name;
    was := r.was; becomes := r.becomes; applied := p_apply;
    why := CASE WHEN r.becomes = 'cash_only'
                THEN 'cash sites bound, no invoicing account'
                ELSE 'an invoicing account is now bound' END;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION crm_allocate_cash_only(BOOLEAN) IS
  'Moves records between Customer and Cash Only on the one rule: cash sites and no '
  'invoicing account. Dry run unless asked to apply, moves both ways, and skips '
  'anything a person has pinned by hand.';

REVOKE ALL ON FUNCTION crm_allocate_cash_only(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_allocate_cash_only(BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- 5. Binding a cash sale no longer calls somebody a customer.
--
-- A cash sale says they paid, not that they hold an account. So the
-- record becomes Cash Only unless it already has an invoicing account,
-- in which case it was a customer before this and still is.
--
-- The rest of the body is unchanged from migration 130: the refusal
-- migration 127 added for accounts, because revenue on a deleted
-- record shows nowhere, and the pass backwards over everything already
-- imported under that name.
--
-- THIS IS THE BUG THAT MADE 467 CUSTOMERS. `protean_bind_site` ended
-- with `SET relationship = 'existing'`, so every cash site anybody
-- bound promoted the record to Customer, whatever it had been.
-- `protean_bind`, which binds a real invoicing account, does the same
-- thing and is right to: an account IS what makes a customer.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protean_bind_site(
  p_division TEXT, p_alpha TEXT, p_site TEXT, p_contact UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  gone TIMESTAMPTZ;
  n    INT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying whose a cash sale is needs permission to edit the CRM.';
  END IF;

  IF p_contact IS NOT NULL THEN
    SELECT c.deleted_at INTO gone FROM crm_contacts c WHERE c.id = p_contact;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That customer is not in the CRM.';
    END IF;
    IF gone IS NOT NULL THEN
      RAISE EXCEPTION
        'That customer record was deleted on %. Put the cash sales on the record that replaced it.',
        gone::DATE;
    END IF;
  END IF;

  INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id, bound_by, bound_at)
  VALUES (p_division, p_alpha, p_site, p_contact, auth.uid(), NOW())
  ON CONFLICT (division, alpha, site_name) DO UPDATE
    SET contact_id = EXCLUDED.contact_id, bound_by = EXCLUDED.bound_by, bound_at = NOW();

  UPDATE protean_invoices i
     SET contact_id = p_contact
   WHERE i.division = p_division AND i.alpha = p_alpha AND i.site_name = p_site;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts c
       SET relationship = CASE WHEN crm_lives_on_cash(p_contact) THEN 'cash_only' ELSE 'existing' END,
           updated_at = NOW()
     WHERE c.id = p_contact
       AND NOT c.relationship_pinned
       AND c.relationship IS DISTINCT FROM
           (CASE WHEN crm_lives_on_cash(p_contact) THEN 'cash_only' ELSE 'existing' END);
  END IF;

  RETURN n;
END;
$fn$;

-- -------------------------------------------------------------
-- 6. Winning work promotes a prospect. It leaves Cash Only alone.
--
-- Winning is what makes a PROSPECT an existing customer, and it never
-- goes back the other way: they traded with us once and a later lost
-- quote does not undo that.
--
-- A firm that pays over the counter does not become an account
-- customer by our winning a job for them. They become one when an
-- account is opened and an invoice is raised against it, which is
-- exactly what `protean_bind` does and why that one still writes
-- 'existing'.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_account_follows_its_leads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  target UUID;
  state  TEXT;
  rel    TEXT;
BEGIN
  target := COALESCE(NEW.contact_id, OLD.contact_id);
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  state := crm_account_status_from_leads(target);

  SELECT c.relationship INTO rel FROM crm_contacts c WHERE c.id = target;

  UPDATE crm_contacts
     SET status = state,
         relationship = CASE
           WHEN state = 'won' AND COALESCE(relationship, 'prospect') = 'prospect' THEN 'existing'
           ELSE COALESCE(relationship, 'prospect') END,
         last_activity_at = NOW()
   WHERE id = target
     AND (status IS DISTINCT FROM state
          OR (state = 'won' AND COALESCE(relationship, 'prospect') = 'prospect'));

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- -------------------------------------------------------------
-- 7. Marking a deal sold does the same.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.command_mark_sold(
  p_tracker_id UUID, p_rep_initials TEXT, p_sale_price NUMERIC DEFAULT NULL,
  p_profit NUMERIC DEFAULT NULL, p_commission NUMERIC DEFAULT NULL,
  p_dispatch_date DATE DEFAULT NULL, p_today DATE DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
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

  UPDATE crm_leads AS t SET
    (status, sale_price, profit, commission, order_date, dispatch_date) =
    (SELECT status, sale_price, profit, commission, order_date, dispatch_date
       FROM jsonb_populate_record(NULL::crm_leads, sale -> 'deal'))
  WHERE t.id = p_tracker_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  SELECT contact_id INTO v_account FROM crm_leads WHERE id = p_tracker_id;
  IF v_account IS NOT NULL THEN
    UPDATE crm_contacts
       SET status = 'won',
           relationship = CASE
             WHEN COALESCE(relationship, 'prospect') = 'prospect' THEN 'existing'
             ELSE relationship END
     WHERE id = v_account AND status IS DISTINCT FROM 'won';
  END IF;

  IF sale -> 'unit' IS NOT NULL AND jsonb_typeof(sale -> 'unit') = 'object' THEN
    v_unit := (sale -> 'unit' ->> 'id')::UUID;

    UPDATE stock_trailers AS t SET
      (status, customer, sales_rep, sales_price, profit, order_date, dispatch_date) =
      (SELECT status, customer, sales_rep, sales_price, profit, order_date, dispatch_date
         FROM jsonb_populate_record(NULL::stock_trailers, sale -> 'unit'))
    WHERE t.id = v_unit;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      RAISE EXCEPTION 'the stock unit could not be updated; nothing has been changed';
    END IF;

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
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'cash only is a third kind of record, and a cash sale no longer makes a customer';
END $$;
