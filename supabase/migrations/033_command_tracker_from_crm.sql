-- =============================================================
-- 033. Taking a CRM customer onto your own tracker.
--
-- The tracker screen has had this since it was built: pick a customer
-- off the CRM and a copy of them appears as a deal on your own list.
-- The copy is the point. The CRM record is the account and the tracker
-- row is one attempt to sell them something, so the two have to be able
-- to move independently.
--
-- WHOSE TRACKER, AND HOW THE ANSWER IS DECIDED.
--
-- The screen sent its own `list.id`. That is right on a screen showing
-- your own tracker and wrong as an operation: a list id is a value
-- anybody can type, and row level security lets a person write to any
-- list shared with them, so the payload decided whose tracker gained a
-- deal. It is decided here, from `auth.uid()`, exactly as sending from
-- stock is. There is no delegated form of this in the application, so
-- there is not one here.
--
-- WHAT IS COPIED AND WHAT IS NOT.
--
-- Everything that belongs to the BUSINESS: the name, who to ring, where
-- they are, the size of their fleet. Nothing that belongs to the
-- original DEAL: no price, no dates, no commission, no stock link. The
-- new row is a fresh enquiry dated today.
--
-- SECURITY INVOKER, gated on `crm.create`, which is what starting any
-- deal needs and what the tracker screen gates on.
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
  list   UUID;
  owner  UUID;
  origin RECORD;
  made   INTEGER := 0;
  wanted INTEGER;
  first  UUID;
  side   TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  owner := COALESCE(p_owner, auth.uid());
  IF owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION
      'a customer goes onto your own tracker; there is no operation for putting one on somebody else''s';
  END IF;

  wanted := COALESCE(array_length(p_contacts, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which customers to put on the tracker';
  END IF;

  side := COALESCE(NULLIF(btrim(p_side), ''), 'trailer_sales');
  IF side NOT IN ('trailer_sales', 'maintenance') THEN
    RAISE EXCEPTION '% is not a side of this business', side;
  END IF;

  list := command_tracker_list(owner);

  -- The loop variable is `origin` rather than `source`, because
  -- `source` is also a column on this table and plpgsql resolves the
  -- name to the variable inside the INSERT below.
  FOR origin IN
    SELECT company_name, contact_name, email, phone, source, status, address,
           links, location, employee_count, turnover, trucks, trailers, vans,
           assigned_to, notes
      FROM crm_contacts WHERE id = ANY(p_contacts)
  LOOP
    INSERT INTO crm_contacts (
      list_id, company_name, contact_name, email, phone, source, status,
      side, what, address, links, location, employee_count, turnover,
      trucks, trailers, vans, assigned_to, notes, date_of_enquiry
    ) VALUES (
      list, origin.company_name, origin.contact_name, origin.email, origin.phone,
      COALESCE(origin.source, 'Imported from CRM'),
      -- A lost account stays lost and a customer stays a customer.
      -- Everything in between is a fresh enquiry on this tracker.
      CASE origin.status WHEN 'lost' THEN 'lost' WHEN 'customer' THEN 'customer'
                         ELSE 'lead' END,
      side,
      CASE WHEN side = 'maintenance' THEN p_what ELSE NULL END,
      origin.address, origin.links, origin.location, origin.employee_count,
      origin.turnover, origin.trucks, origin.trailers, origin.vans,
      origin.assigned_to, origin.notes, CURRENT_DATE
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

  RETURN jsonb_build_object('listId', list, 'made', made, 'rowId', first);
END;
$$;

REVOKE ALL ON FUNCTION command_tracker_from_crm(UUID[], TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_tracker_from_crm(UUID[], TEXT, TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns it
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Everything
-- except the one new branch is exactly what migration 032 left, and this
-- is the only copy that runs.
CREATE OR REPLACE FUNCTION command_invoke_one(
  p_capability TEXT,
  p_subjects   UUID[],
  p_args       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cap     TEXT := p_capability;
  args    JSONB := COALESCE(p_args, '{}'::JSONB);
  outcome JSONB;
  changed INTEGER := 0;
BEGIN
  IF cap = 'list.create' THEN
    outcome := command_create_list(args ->> 'name', p_subjects, NULL);
    changed := COALESCE((outcome ->> 'moved')::INTEGER, 0);

  ELSIF cap = 'list.add' THEN
    outcome := command_add_to_list(args ->> 'list', p_subjects);
    changed := COALESCE((outcome ->> 'moved')::INTEGER, 0);

  ELSIF cap = 'rows.share' THEN
    outcome := command_share_list(
      (args ->> 'list')::UUID,
      p_subjects,
      ARRAY(SELECT (jsonb_array_elements_text(COALESCE(args -> 'users', '[]'::JSONB)))::UUID),
      COALESCE((args ->> 'canEdit')::BOOLEAN, TRUE));
    changed := COALESCE((outcome ->> 'granted')::INTEGER, 0);

  ELSIF cap = 'list.share' THEN
    outcome := command_share_named_list(
      args ->> 'list',
      ARRAY(SELECT (jsonb_array_elements_text(COALESCE(args -> 'users', '[]'::JSONB)))::UUID),
      COALESCE((args ->> 'canEdit')::BOOLEAN, TRUE));
    changed := COALESCE((outcome ->> 'granted')::INTEGER, 0);

  ELSIF cap = 'record.attach' THEN
    outcome := command_attach_file(
      args ->> 'table',
      p_subjects[1],
      args ->> 'filename',
      args ->> 'mime',
      args ->> 'base64',
      args ->> 'describedAs');
    changed := 1;

  ELSIF cap = 'stock.sendToTracker' THEN
    outcome := command_send_from_stock(p_subjects, NULL);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'crm.toTracker' THEN
    outcome := command_tracker_from_crm(
      p_subjects, args ->> 'side', args ->> 'what', NULL);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'crm.raiseProposal' THEN
    outcome := command_raise_proposal(p_subjects, args ->> 'kind', NULL);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'rows.import' THEN
    outcome := command_import_contacts(
      args -> 'rows', args ->> 'list', (args ->> 'listId')::UUID);
    changed := COALESCE((outcome ->> 'inserted')::INTEGER, 0);

  ELSIF cap = 'stock.import' THEN
    outcome := command_import_stock(args -> 'rows');
    changed := COALESCE((outcome ->> 'inserted')::INTEGER, 0);

  ELSIF cap = 'user.setRole' THEN
    outcome := command_set_role(p_subjects[1], args ->> 'role');
    changed := 1;

  ELSIF cap = 'contact.addAddress' THEN
    outcome := command_add_address(
      p_subjects[1], args ->> 'address', args ->> 'label',
      COALESCE((args ->> 'primary')::BOOLEAN, FALSE));
    changed := 1;

  ELSIF cap = 'contact.primaryAddress' THEN
    outcome := command_primary_address(p_subjects[1], args ->> 'address');
    changed := 1;

  ELSIF cap = 'contact.addLink' THEN
    outcome := command_add_link(p_subjects[1], args ->> 'url', args ->> 'label', NULL);
    changed := 1;

  ELSIF cap = 'contact.removeLink' THEN
    outcome := command_remove_link(p_subjects[1], args ->> 'which');
    changed := 1;

  ELSIF cap = 'contact.link' THEN
    outcome := command_link_accounts(p_subjects[1], (args ->> 'parent')::UUID);
    changed := 1;

  ELSIF cap = 'news.refresh' THEN
    outcome := command_refresh_news(args -> 'items', (args ->> 'maxAge')::INTEGER);
    changed := COALESCE((outcome ->> 'added')::INTEGER, 0);

  ELSIF cap = 'meeting.create' THEN
    outcome := command_create_meeting(
      args ->> 'title',
      (args ->> 'start')::TIMESTAMPTZ,
      (args ->> 'minutes')::INTEGER,
      (args ->> 'contact')::UUID,
      COALESCE(args ->> 'visibility', 'private'));
    changed := 1;

  ELSIF cap = 'meeting.answer' THEN
    outcome := command_meeting_answer_for(
      p_subjects,
      args ->> 'action',
      (args ->> 'start')::TIMESTAMPTZ,
      (args ->> 'end')::TIMESTAMPTZ,
      args ->> 'note');
    changed := 1;

  ELSIF cap = 'meeting.reschedule' THEN
    outcome := command_reschedule_meeting(
      p_subjects, (args ->> 'start')::TIMESTAMPTZ, args ->> 'time');
    changed := COALESCE(array_length(p_subjects, 1), 0);

  ELSIF cap = 'meeting.invite' THEN
    outcome := command_meeting_invite(
      p_subjects,
      ARRAY(SELECT (jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(args -> 'who') = 'array' THEN args -> 'who'
             ELSE jsonb_build_array(args -> 'who') END))::UUID),
      args ->> 'note');
    changed := COALESCE((outcome ->> 'sent')::INTEGER, 0);

  ELSIF cap = 'post.create' THEN
    outcome := command_create_post(
      args ->> 'content',
      CASE WHEN args ->> 'platform' IS NULL THEN NULL
           ELSE string_to_array(args ->> 'platform', ',') END,
      (args ->> 'scheduledDate')::DATE,
      args ->> 'caption',
      NULL,
      NULL);
    changed := 1;

  ELSIF cap = 'deal.markSold' THEN
    outcome := command_mark_sold_many(
      p_subjects,
      COALESCE(args ->> 'repInitials', 'Unknown'),
      (args ->> 'salePrice')::NUMERIC,
      (args ->> 'dispatchDate')::DATE,
      (args ->> 'today')::DATE);
    changed := COALESCE(array_length(p_subjects, 1), 0);

  ELSE
    RAISE EXCEPTION 'nothing in this database performs %', cap;
  END IF;

  RETURN jsonb_build_object('changed', changed, 'outcome', COALESCE(outcome, '{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) TO authenticated;
