-- =============================================================
-- 025. Whose tracker, and who may put something on it.
--
-- Both tracker operations take an owner. Both checked one capability and
-- then let the supplied owner decide whose tracker and whose name the
-- row landed under, which means a direct RPC was more powerful than the
-- button that calls it.
--
-- THE PERMISSION MODEL ALREADY DISTINGUISHES THESE.
--
--   crm.proposal            raise one
--   crm.proposalForOthers   raise one on somebody else's behalf
--
-- Sales holds the first and not the second. So a sales rep calling
-- `command_raise_proposal` with a colleague's id could put a quoted row
-- on that colleague's tracker under that colleague's name, which is
-- exactly the distinction the meeting asked for and exactly what the
-- application refused to offer through the screen.
--
-- The check moves INSIDE the function, because a caller passing the
-- right value is not a permission model. The route still passes its own
-- user id; that is now belt as well as braces rather than the whole of
-- it.
--
-- SENDING STOCK TO A TRACKER HAS NO DELEGATED FORM AT ALL.
--
-- `app/api/tracker/send-from-stock` calls it "the caller's own sales
-- tracker" and there is no screen, capability or sentence in this
-- application for sending a unit to somebody else's. An operation with
-- no delegated form does not get an owner parameter that acts like one,
-- so a different owner is refused outright rather than gated on a
-- capability nobody has been granted for it.
-- =============================================================

CREATE OR REPLACE FUNCTION command_send_from_stock(
  p_trailers UUID[],
  p_owner    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  list    UUID;
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

  list := command_tracker_list(owner);

  FOR unit IN
    SELECT id, stc_no, chassis_number, year, make, model, description, location
      FROM stock_trailers WHERE id = ANY(p_trailers)
  LOOP
    INSERT INTO crm_contacts (
      list_id, side, status, company_name, description, source,
      date_of_enquiry, location, stock_trailer_id
    ) VALUES (
      list, 'trailer_sales', 'lead',
      'Lead ' || COALESCE(unit.stc_no, unit.chassis_number, 'Trailer'),
      NULLIF(concat_ws(' ', unit.year, unit.make, unit.model, unit.description), ''),
      'From Stock',
      CURRENT_DATE,
      unit.location,
      unit.id
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

  RETURN jsonb_build_object('listId', list, 'made', made, 'trackerRowId', first);
END;
$$;

REVOKE ALL ON FUNCTION command_send_from_stock(UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_send_from_stock(UUID[], UUID) TO authenticated;

-- -------------------------------------------------------------
-- A proposal for somebody else is a different permission
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
  list    UUID;
  side    TEXT;
  who     TEXT;
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

  side := CASE COALESCE(p_kind, 'trailer_sales')
    WHEN 'trailer_sales' THEN 'trailer_sales'
    WHEN 'rental'        THEN 'trailer_sales'
    WHEN 'maintenance'   THEN 'maintenance'
    WHEN 'refurb'        THEN 'maintenance'
    ELSE NULL
  END;
  IF side IS NULL THEN
    RAISE EXCEPTION 'there is no proposal type called %', p_kind;
  END IF;

  wanted := COALESCE(array_length(p_contacts, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said who the proposal is for';
  END IF;

  list := command_tracker_list(owner);
  SELECT COALESCE(full_name, email) INTO who FROM profiles WHERE id = owner;

  FOR person IN
    SELECT * FROM crm_contacts WHERE id = ANY(p_contacts)
  LOOP
    INSERT INTO crm_contacts (
      list_id, side, status, source, company_name, contact_name, email, phone,
      location, assigned_to, relationship, requirement, date_of_enquiry, last_contact
    ) VALUES (
      list, side, 'quoted', 'CRM proposal',
      person.company_name, person.contact_name, person.email, person.phone,
      person.location, who,
      COALESCE(person.relationship, 'prospect'),
      replace(COALESCE(p_kind, 'trailer_sales'), '_', ' '),
      CURRENT_DATE, CURRENT_DATE
    )
    RETURNING id INTO first;

    made := made + 1;
  END LOOP;

  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to raise % proposals but raised %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('listId', list, 'made', made, 'kind', p_kind, 'rowId', first);
END;
$$;

REVOKE ALL ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- The tracker list belongs to whoever is asking
-- -------------------------------------------------------------
--
-- `command_tracker_list` creates a list on first use, and it took an
-- owner too. Creating a list under somebody else's name is the same
-- overreach one level down, so it is refused here as well: the callers
-- above have already decided who the owner may be.
CREATE OR REPLACE FUNCTION command_tracker_list(p_owner UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  found UUID;
  owner UUID;
BEGIN
  owner := COALESCE(p_owner, auth.uid());
  IF owner IS NULL THEN
    RAISE EXCEPTION 'nothing said whose tracker';
  END IF;
  IF owner IS DISTINCT FROM auth.uid() AND NOT command_may('crm.proposalForOthers') THEN
    RAISE EXCEPTION 'you do not have crm.proposalForOthers';
  END IF;

  SELECT id INTO found FROM crm_lists
   WHERE owner_id = owner AND is_global = FALSE AND name ILIKE '%Sales tracker%'
   LIMIT 1;

  IF found IS NULL THEN
    INSERT INTO crm_lists (name, description, owner_id, is_global)
    VALUES ('Sales tracker', 'Your own tracker', owner, FALSE)
    RETURNING id INTO found;
  END IF;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION command_tracker_list(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_tracker_list(UUID) TO authenticated;
