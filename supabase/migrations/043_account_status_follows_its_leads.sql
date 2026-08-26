-- =============================================================
-- 043. A company's status is what its leads say it is.
--
-- From the business, describing how this was always meant to work:
--
--   the moment you open a new lead on the tracker for a company in the
--   CRM its status dynamically changes based on the reason for the lead
--   and also the status of the lead
--
-- It could not work while a lead and a company were the same row,
-- because there was nothing to derive it from. Now there is.
--
-- WHY THIS ALSO SETTLES AN AMBIGUITY.
--
-- Both tables carry `status`, so "set status on Dawson to quoted" had
-- two readings and the command bar answered neither: a sentence naming
-- a company and a deal state matched a company column and a lead column
-- equally well, and refusing is what a tie does. Deriving one of them
-- means there is only one status anybody can set, which is the lead's,
-- and it is the one they meant.
--
-- THE ORDER.
--
-- A company is as far along as its furthest lead. One won deal makes
-- them a customer whatever else is still being chased, and a company is
-- only lost when everything is: a lost quote is not a lost customer
-- while somebody else is still quoting them.
-- =============================================================

CREATE OR REPLACE FUNCTION crm_account_status_from_leads(p_contact UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT l.status
       FROM crm_leads l
      WHERE l.contact_id = p_contact
      ORDER BY CASE l.status
                 WHEN 'customer'  THEN 6
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
$$;

CREATE OR REPLACE FUNCTION crm_account_follows_its_leads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
         relationship = CASE WHEN state = 'customer' THEN 'existing'
                             ELSE COALESCE(relationship, 'prospect') END,
         last_activity_at = NOW()
   WHERE id = target
     AND status IS DISTINCT FROM state;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_set_account_status ON crm_leads;
CREATE TRIGGER crm_leads_set_account_status
  AFTER INSERT OR UPDATE OF status, contact_id OR DELETE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_account_follows_its_leads();

-- Bring every account that already has leads into line, so the column
-- means the same thing on day one as it will on day two.
UPDATE crm_contacts c
   SET status = crm_account_status_from_leads(c.id)
 WHERE EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id = c.id)
   AND c.status IS DISTINCT FROM crm_account_status_from_leads(c.id);

GRANT EXECUTE ON FUNCTION crm_account_status_from_leads(UUID) TO authenticated;

-- -------------------------------------------------------------
-- Duplicating a deal duplicates the pitch, not the customer
--
-- `command_duplicate_deal` copied the whole company row: name, contact,
-- email, phone, address, links, fleet counts. That was the only way to
-- say "another deal with these people" while a deal and a company were
-- one row, and it is now the last place that would still make a second
-- Dawson. The customer stays exactly one customer and gains a second
-- pitch, which is what "duplicate this deal for a second unit" means.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_duplicate_deal(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
      CASE origin.status WHEN 'customer' THEN 'quoted' ELSE origin.status END,
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
$$;

REVOKE ALL ON FUNCTION command_duplicate_deal(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_duplicate_deal(UUID[]) TO authenticated;

-- The unit a deal is for is a column on the deal.
--
-- Ported from migration 038 with the table changed and nothing else:
-- the order of the checks decides which refusal somebody gets, and the
-- stock number in the result is what the preview shows them.
CREATE OR REPLACE FUNCTION command_link_stock(p_deal UUID, p_unit UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  held     UUID;
  affected INTEGER;
  stc      TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;
  IF p_deal IS NULL OR p_unit IS NULL THEN
    RAISE EXCEPTION 'linking needs a deal and a unit';
  END IF;

  SELECT stock_trailer_id INTO held FROM crm_leads WHERE id = p_deal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that deal is not there';
  END IF;

  SELECT stc_no INTO stc FROM stock_trailers WHERE id = p_unit;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that stock unit is not there';
  END IF;

  -- A deal already against another unit is not a link, it is a move,
  -- and moving one silently would leave the first unit looking sold to
  -- nobody. Saying so is the whole of the difference.
  IF held IS NOT NULL AND held <> p_unit THEN
    RAISE EXCEPTION
      'that deal is already against another unit; take it off that one first';
  END IF;

  UPDATE crm_leads SET stock_trailer_id = p_unit WHERE id = p_deal;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  RETURN jsonb_build_object('id', p_deal, 'unit', p_unit, 'stcNo', stc);
END;
$$;

REVOKE ALL ON FUNCTION command_link_stock(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_link_stock(UUID, UUID) TO authenticated;
