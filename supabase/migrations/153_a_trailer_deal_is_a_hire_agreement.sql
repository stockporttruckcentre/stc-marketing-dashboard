-- =============================================================
-- 153. A trailer deal carries the hire it actually is.
--
-- From the business, listing what a trailer deal's drawer has to hold
-- so an order form can be generated off it:
--
--   Date the equipment went on hire & estimated Off hire date; Term
--   length; Rate £; Service cycle; Option to add a 3rd party Vendor if
--   customer is out of STC coverage; All info regarding contact,
--   location etc; What maintenance rate is set with that vendor;
--   Equipment on hire - STC number; NET/NET / R&M / Full R&M + Tyres as
--   a drop down box; add in 1 price, set quantity, have a button that
--   allows you to set that same price across all trailers on your list
--   (or choose specific ones to apply it to).
--
-- ---- Where each of those lives ----
--
-- Eight of them describe the AGREEMENT and belong on the deal: the two
-- dates, the term, the rate, the service cycle, the cover level, the
-- vendor and the rate agreed with that vendor.
--
-- Two of them describe a UNIT and belong on the line: the STC number,
-- which `crm_lead_trailers` already carries through `stock_trailers`,
-- and the price, which is what the "same price across all trailers"
-- button writes.
--
-- ---- Why the vendor is a table and not four columns on the deal ----
--
-- "Option to add a 3rd party Vendor if customer is out of STC coverage"
-- plus "All info regarding contact, location etc" is a company with an
-- address and a person on the end of a phone. The same garage covers
-- more than one customer, so typing their postcode onto every deal
-- would mean correcting it in eleven places when they move.
--
-- The rate is on BOTH, deliberately and not by accident: the vendor has
-- the rate they normally charge, and the deal has the rate agreed for
-- this job, which is the one that goes on the order form. A deal that
-- has not set its own falls back to theirs, and the function below says
-- which of the two it used.
--
-- NOTHING IS DELETED. Every column here is new and nullable.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The third party vendor.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS third_party_vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  postcode      TEXT,
  /* What they charge us as a rule. The deal's own rate wins where it
     is set, because that is the figure that was agreed for the job. */
  maintenance_rate NUMERIC,
  covers        TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  delete_reason TEXT
);

COMMENT ON TABLE third_party_vendors IS
  'A garage or service provider outside STC coverage, used where a customer''s '
  'equipment sits somewhere we do not reach. One row per vendor, reused across '
  'deals, so an address is corrected once.';
COMMENT ON COLUMN third_party_vendors.covers IS
  'Where they cover, in their own words. Free text on purpose: a postcode list '
  'that is wrong is worse than a sentence that is right.';

CREATE INDEX IF NOT EXISTS idx_vendors_live
  ON third_party_vendors (lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE third_party_vendors ENABLE ROW LEVEL SECURITY;

/* Anybody who may read the CRM may read the vendor list, because a
   vendor on a deal with no name beside it is a deal nobody can read. */
DROP POLICY IF EXISTS "vendors_select" ON third_party_vendors;
CREATE POLICY "vendors_select" ON third_party_vendors
  FOR SELECT USING (command_may('crm.view'));

DROP POLICY IF EXISTS "vendors_write" ON third_party_vendors;
CREATE POLICY "vendors_write" ON third_party_vendors
  FOR ALL USING (NOT viewing_as_somebody() AND command_may('crm.edit'))
  WITH CHECK (NOT viewing_as_somebody() AND command_may('crm.edit'));

DROP TRIGGER IF EXISTS third_party_vendors_touch ON third_party_vendors;
CREATE TRIGGER third_party_vendors_touch
  BEFORE UPDATE ON third_party_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------------
-- 2. The agreement, on the deal.
-- -------------------------------------------------------------
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS on_hire_date       DATE;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS off_hire_estimate  DATE;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS term_months        INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS hire_rate          NUMERIC;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS service_cycle      TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS maintenance_cover  TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS vendor_id          UUID
  REFERENCES third_party_vendors(id) ON DELETE SET NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS vendor_rate        NUMERIC;

/* The three the business named, in their words, as the stored values.
   A deal that has not been asked the question is NULL rather than one
   of the three, because "nobody has said yet" is not the same answer as
   "net net". */
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_maintenance_cover_check;
ALTER TABLE crm_leads ADD  CONSTRAINT crm_leads_maintenance_cover_check
  CHECK (maintenance_cover IS NULL
         OR maintenance_cover IN ('net_net', 'rm', 'full_rm_tyres'));

/* An off hire estimate before the on hire date is a typo, and it would
   make every term on every report negative. */
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_hire_dates_check;
ALTER TABLE crm_leads ADD  CONSTRAINT crm_leads_hire_dates_check
  CHECK (on_hire_date IS NULL OR off_hire_estimate IS NULL
         OR off_hire_estimate >= on_hire_date);

ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_term_months_check;
ALTER TABLE crm_leads ADD  CONSTRAINT crm_leads_term_months_check
  CHECK (term_months IS NULL OR (term_months > 0 AND term_months <= 600));

COMMENT ON COLUMN crm_leads.on_hire_date IS
  'The date the equipment actually went on hire. Not the order date, which is '
  'when the deal was agreed: the two are often weeks apart.';
COMMENT ON COLUMN crm_leads.maintenance_cover IS
  'net_net, rm or full_rm_tyres. NULL means nobody has been asked yet, which is '
  'a different answer from net net.';
COMMENT ON COLUMN crm_leads.vendor_rate IS
  'The maintenance rate agreed with the vendor FOR THIS DEAL. Falls back to the '
  'vendor''s own rate where it is not set, and the order form says which it used.';

-- -------------------------------------------------------------
-- 3. The price, on the line.
--
-- `quantity` is on the line rather than the deal because "add in 1
-- price, set quantity" is a price for n of something, and two lines on
-- one deal can be two counts at two prices.
-- -------------------------------------------------------------
ALTER TABLE crm_lead_trailers ADD COLUMN IF NOT EXISTS rate     NUMERIC;
ALTER TABLE crm_lead_trailers ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE crm_lead_trailers DROP CONSTRAINT IF EXISTS crm_lead_trailers_quantity_check;
ALTER TABLE crm_lead_trailers ADD  CONSTRAINT crm_lead_trailers_quantity_check
  CHECK (quantity > 0 AND quantity <= 999);

COMMENT ON COLUMN crm_lead_trailers.rate IS
  'The agreed price for this unit on this deal. Written one at a time, or across '
  'the whole list by lead_price_across.';

-- -------------------------------------------------------------
-- 4. The rate that actually applies, in one place.
--
-- The deal's own, or the vendor's, and which of the two. Every screen
-- and the order form read this rather than each deciding the fallback,
-- because two copies of a fallback rule is how they disagree.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS lead_vendor_rate(UUID);
CREATE OR REPLACE FUNCTION lead_vendor_rate(p_lead UUID)
RETURNS TABLE (rate NUMERIC, source TEXT, vendor_id UUID, vendor_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(l.vendor_rate, v.maintenance_rate),
         CASE WHEN l.vendor_rate IS NOT NULL THEN 'deal'
              WHEN v.maintenance_rate IS NOT NULL THEN 'vendor'
              ELSE 'none' END,
         v.id, v.name
    FROM crm_leads l
    LEFT JOIN third_party_vendors v ON v.id = l.vendor_id AND v.deleted_at IS NULL
   WHERE l.id = p_lead AND command_may('crm.view');
$fn$;

REVOKE ALL ON FUNCTION lead_vendor_rate(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead_vendor_rate(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. One price across the list.
--
--   add in 1 price, set quantity, have a button that allows you to set
--   that same price across all trailers on your list (or choose
--   specific ones to apply it to)
--
-- Three things this does not do, each on purpose:
--
--   It does not write on a dry run, so the screen can show what is
--   about to change with the value before and the value after. The same
--   rule the command bar works to: nothing is edited on the first press.
--
--   It does not silently skip a unit it cannot write. `p_only` naming a
--   unit that is not on this deal takes the whole call with it, because
--   a button that reports "3 updated" out of 4 asked for is a button
--   somebody stops reading.
--
--   It does not touch `quantity` when none is given. Applying a price
--   across the list is about the price; resetting every count to one on
--   the way past would be a second, unasked-for edit.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS lead_price_across(UUID, NUMERIC, INTEGER, UUID[], BOOLEAN);
CREATE OR REPLACE FUNCTION lead_price_across(
  p_lead     UUID,
  p_rate     NUMERIC,
  p_quantity INTEGER DEFAULT NULL,
  p_only     UUID[]  DEFAULT NULL,
  p_dry_run  BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  stock_trailer_id UUID,
  stc_no           TEXT,
  rate_before      NUMERIC,
  rate_after       NUMERIC,
  quantity_before  INTEGER,
  quantity_after   INTEGER,
  changed          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE asked INT; found INT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Pricing a deal needs permission to edit the CRM.';
  END IF;
  IF NOT p_dry_run AND viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 THEN
    RAISE EXCEPTION 'A price is a number, and it is not negative.';
  END IF;
  IF p_quantity IS NOT NULL AND (p_quantity < 1 OR p_quantity > 999) THEN
    RAISE EXCEPTION 'A quantity is between 1 and 999.';
  END IF;

  /* The lead has to be one this person may change. The table's own
     policy says who that is, so it is asked rather than restated. */
  IF NOT EXISTS (
    SELECT 1 FROM crm_leads l
     WHERE l.id = p_lead
       AND (l.owner_id = auth.uid()
            OR auth.uid() = ANY (l.shared_with)
            OR l.created_by = auth.uid()
            OR command_may('crm.viewOthers'))
  ) THEN
    RAISE EXCEPTION 'That deal is not yours to price.';
  END IF;

  /* Every unit named, or none of them. */
  IF p_only IS NOT NULL THEN
    asked := COALESCE(array_length(p_only, 1), 0);
    SELECT count(*) INTO found FROM crm_lead_trailers t
     WHERE t.lead_id = p_lead AND t.stock_trailer_id = ANY (p_only);
    IF asked = 0 THEN
      RAISE EXCEPTION 'Nothing said which trailers to price.';
    END IF;
    IF found <> asked THEN
      RAISE EXCEPTION
        'Asked to price % trailers and % of them are on this deal; nothing has been changed.',
        asked, found;
    END IF;
  END IF;

  IF NOT p_dry_run THEN
    UPDATE crm_lead_trailers t
       SET rate = p_rate,
           quantity = COALESCE(p_quantity, t.quantity)
     WHERE t.lead_id = p_lead
       AND (p_only IS NULL OR t.stock_trailer_id = ANY (p_only));

    UPDATE crm_leads SET last_activity_at = NOW() WHERE id = p_lead;

    PERFORM audit('update', 'crm_leads', p_lead,
                  (SELECT company_name FROM crm_leads WHERE id = p_lead),
                  NULL,
                  jsonb_build_object('priced_across', TRUE, 'rate', p_rate,
                                     'quantity', p_quantity,
                                     'only', to_jsonb(p_only)));
  END IF;

  RETURN QUERY
  SELECT t.stock_trailer_id, s.stc_no,
         CASE WHEN p_dry_run THEN t.rate ELSE NULL END,
         p_rate,
         CASE WHEN p_dry_run THEN t.quantity ELSE NULL END,
         COALESCE(p_quantity, t.quantity),
         (t.rate IS DISTINCT FROM p_rate
          OR (p_quantity IS NOT NULL AND t.quantity IS DISTINCT FROM p_quantity))
    FROM crm_lead_trailers t
    LEFT JOIN stock_trailers s ON s.id = t.stock_trailer_id
   WHERE t.lead_id = p_lead
     AND (p_only IS NULL OR t.stock_trailer_id = ANY (p_only))
   ORDER BY t.position;
END;
$fn$;

REVOKE ALL ON FUNCTION lead_price_across(UUID, NUMERIC, INTEGER, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead_price_across(UUID, NUMERIC, INTEGER, UUID[], BOOLEAN) TO authenticated;

COMMENT ON FUNCTION lead_price_across(UUID, NUMERIC, INTEGER, UUID[], BOOLEAN) IS
  'Sets one price across every trailer on a deal, or the ones named. Dry run by '
  'default, returning the value before and the value after for each, so the '
  'screen can show what is about to happen before anything is written.';

-- -------------------------------------------------------------
-- 6. Adding a vendor, from the drawer, in one call.
--
-- Returns the row so the picker can select what it has just made
-- without asking for the list again.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS vendor_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT);
CREATE OR REPLACE FUNCTION vendor_save(
  p_id UUID, p_name TEXT, p_contact_name TEXT, p_phone TEXT, p_email TEXT,
  p_line1 TEXT, p_line2 TEXT, p_city TEXT, p_postcode TEXT,
  p_rate NUMERIC, p_covers TEXT, p_notes TEXT
)
RETURNS third_party_vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE made third_party_vendors; clean TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Adding a vendor needs permission to edit the CRM.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  clean := NULLIF(BTRIM(COALESCE(p_name, '')), '');
  IF clean IS NULL THEN
    RAISE EXCEPTION 'A vendor needs a name.';
  END IF;
  IF p_rate IS NOT NULL AND p_rate < 0 THEN
    RAISE EXCEPTION 'A rate is not negative.';
  END IF;

  IF p_id IS NULL THEN
    /* The same name twice is somebody adding a vendor that is already
       there, so they get the one that exists rather than a second copy
       the next person has to choose between.

       AND IT IS RETURNED UNCHANGED. Adding "Aberdeen Commercials" a
       second time, with the boxes empty because the person is halfway
       through typing, used to fall into the UPDATE below and blank the
       phone number, the address and the rate somebody agreed. Finding a
       record is not the same act as editing one: editing passes the id,
       which is what the Edit button does. */
    SELECT * INTO made FROM third_party_vendors
     WHERE deleted_at IS NULL AND lower(BTRIM(name)) = lower(clean)
     ORDER BY created_at LIMIT 1;
    IF made.id IS NOT NULL THEN
      RETURN made;
    END IF;
  ELSE
    SELECT * INTO made FROM third_party_vendors WHERE id = p_id AND deleted_at IS NULL;
    IF made.id IS NULL THEN
      RAISE EXCEPTION 'There is no vendor with that id.';
    END IF;
  END IF;

  IF made.id IS NULL THEN
    INSERT INTO third_party_vendors
      (name, contact_name, phone, email, address_line1, address_line2,
       city, postcode, maintenance_rate, covers, notes, created_by)
    VALUES (clean, p_contact_name, p_phone, p_email, p_line1, p_line2,
            p_city, p_postcode, p_rate, p_covers, p_notes, current_actor())
    RETURNING * INTO made;
  ELSE
    UPDATE third_party_vendors SET
      name = clean, contact_name = p_contact_name, phone = p_phone, email = p_email,
      address_line1 = p_line1, address_line2 = p_line2, city = p_city,
      postcode = p_postcode, maintenance_rate = p_rate, covers = p_covers,
      notes = p_notes
     WHERE id = made.id
    RETURNING * INTO made;
  END IF;

  RETURN made;
END;
$fn$;

REVOKE ALL ON FUNCTION vendor_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS vendor_remove(UUID);
CREATE OR REPLACE FUNCTION vendor_remove(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE still INT;
BEGIN
  IF NOT command_may('crm.delete') THEN
    RAISE EXCEPTION 'Removing a vendor needs permission to remove CRM records.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  SELECT count(*) INTO still FROM crm_leads WHERE vendor_id = p_id;
  IF still > 0 THEN
    RAISE EXCEPTION
      'That vendor is on % deal(s). Take them off those first, so nobody loses a rate they agreed.',
      still;
  END IF;

  PERFORM soft_delete('third_party_vendors', p_id, 'Removed from the vendor list.');
END;
$fn$;

REVOKE ALL ON FUNCTION vendor_remove(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_remove(UUID) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a trailer deal now carries its hire, its vendor and a price per unit';
END $$;
