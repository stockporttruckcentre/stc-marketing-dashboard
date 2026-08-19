-- =============================================================
-- Putting a unit on somebody's tracker, and raising a proposal.
--
-- Both were route bodies: `app/api/tracker/send-from-stock` and
-- `app/api/crm/proposal`. Reachable by clicking and by no sentence at
-- all, and reachable by the command runtime only if somebody rewrote
-- what they do, which is how two implementations of one operation start
-- to disagree.
--
-- So the business logic moves HERE, once, and both callers use it: the
-- routes through thin wrappers in `lib/crm/`, and the command bar
-- through its capability registry. That is the arrangement
-- `command_mark_sold` already has, and it is why marking a deal sold
-- cascades the same way from both.
--
-- WHY IT IS SQL RATHER THAN SHARED TYPESCRIPT.
--
-- Each of these is several writes that have to happen together and a
-- lookup that decides where the row goes. A shared TypeScript function
-- would have to issue them as separate PostgREST calls, which is
-- several transactions, and it could not join a command programme's
-- transaction at all. Putting them here means "send this to my tracker
-- and mark it sold" is one commit.
--
-- SECURITY INVOKER, gated on the capability the manual route gates on.
-- =============================================================

-- -------------------------------------------------------------
-- The caller's own tracker list
-- -------------------------------------------------------------
--
-- Both operations put a row on the rep's own tracker. The list is
-- created on first use rather than refused, because "you have no sales
-- tracker yet, open the tracker once to make one" is an error message
-- about the application's own bookkeeping.
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

-- -------------------------------------------------------------
-- A stock unit, onto a tracker, as a lead
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
  list    UUID;
  unit    RECORD;
  made    INTEGER := 0;
  wanted  INTEGER;
  first   UUID;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  wanted := COALESCE(array_length(p_trailers, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which units to send';
  END IF;

  list := command_tracker_list(p_owner);

  FOR unit IN
    SELECT id, stc_no, chassis_number, year, make, model, description, location
      FROM stock_trailers WHERE id = ANY(p_trailers)
  LOOP
    INSERT INTO crm_contacts (
      list_id, side, status, company_name, description, source,
      date_of_enquiry, location, stock_trailer_id
    ) VALUES (
      list, 'trailer_sales', 'lead',
      -- The same name the route composed, without the dash: a lead
      -- against a unit is called after the unit.
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
-- A proposal, raised against a customer
-- -------------------------------------------------------------
--
-- Trailer sales and maintenance have a home already: a quoted row on
-- the rep's own tracker, on the right side of the business. Rental and
-- refurb have no dedicated tool yet and land in the same place rather
-- than disappearing, which is what the route did and why.
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
BEGIN
  IF NOT command_may('crm.proposal') THEN
    RAISE EXCEPTION 'you do not have crm.proposal';
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

  list := command_tracker_list(p_owner);
  SELECT COALESCE(full_name, email) INTO who
    FROM profiles WHERE id = COALESCE(p_owner, auth.uid());

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
      -- Carried across so the dashboard can split proposals to prospects
      -- from proposals to existing customers, which was the whole point
      -- of recording it.
      COALESCE(person.relationship, 'prospect'),
      replace(COALESCE(p_kind, 'trailer_sales'), '_', ' '),
      CURRENT_DATE, CURRENT_DATE
    )
    RETURNING id INTO first;

    made := made + 1;
  END LOOP;

  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to raise % proposals but raised %; nothing has been changed',
      wanted, made;
  END IF;

  RETURN jsonb_build_object(
    'listId', list, 'made', made, 'kind', COALESCE(p_kind, 'trailer_sales'), 'rowId', first
  );
END;
$$;

REVOKE ALL ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_raise_proposal(UUID[], TEXT, UUID) TO authenticated;
