-- =============================================================
-- 041. Putting a customer on your tracker raises a lead.
--
-- `command_tracker_from_crm` copied the company row: name, contact,
-- email, phone, address, links, fleet counts, notes, all of it, onto
-- your tracker list. That copy IS the duplicate the business has been
-- looking at. Every time somebody used the CRM properly the CRM grew
-- another Dawson.
--
-- It now creates a lead pointing at the account, which is the same
-- sentence people were already saying. "Put Dawson on my tracker" never
-- meant "make a second Dawson".
--
-- THREE THINGS CHANGE IN WHAT IT WILL ACCEPT.
--
-- Rental is a lead type, because the type lives on the lead now and no
-- longer has to be a column on the company with room for two values.
--
-- The same customer can go on twice, for different work. It used to be
-- meaningless and is now the ordinary case: a trailer sales lead and a
-- maintenance lead against one account, held by two people.
--
-- And it accepts an owner other than you. It refused before, for a good
-- reason at the time: whose tracker gained a deal was decided by a list
-- id the browser sent, so accepting an owner meant accepting whatever
-- the payload claimed. A lead names its owner as a column, so handing
-- one over is a value rather than a loophole. The business asked for it
-- directly: somebody takes a call while a colleague is away and wants
-- it on that colleague's tracker as they write it down.
-- =============================================================

CREATE OR REPLACE FUNCTION command_tracker_from_crm(
  p_contacts UUID[],
  p_side     TEXT DEFAULT 'trailer_sales',
  p_what     TEXT DEFAULT NULL,
  p_owner    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
      -- A lost account stays lost and a customer stays a customer.
      -- Everything in between is a fresh enquiry on this tracker.
      CASE account.status WHEN 'lost' THEN 'lost' WHEN 'customer' THEN 'customer'
                          ELSE 'lead' END,
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
$$;

REVOKE ALL ON FUNCTION command_tracker_from_crm(UUID[], TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_tracker_from_crm(UUID[], TEXT, TEXT, UUID) TO authenticated;
