-- =============================================================
-- 038. Copying a row, linking, and a file on the brand kit.
--
-- Five operations the screens have and the command bar did not. Each is
-- the same shape as everything else here: SECURITY INVOKER, one
-- capability check by name, every subject or none of them, and one
-- transaction.
--
-- WHY THEY ARE HERE AND NOT IN THE COMPONENT.
--
-- Two of them already existed as application code that issued a client
-- side insert. A copy made that way is one round trip per row with no
-- transaction around them, so a sentence naming three units could make
-- two and fail on the third, and the bar and the button would have had
-- two different ideas of what duplicating means. One function is one
-- answer to both.
-- =============================================================

-- -------------------------------------------------------------
-- 1. A second copy of a stock unit
-- -------------------------------------------------------------
--
-- WHAT CARRIES ACROSS: everything on the row.
-- WHAT DOES NOT: the id, and the two audit timestamps.
--
-- That is exactly what the Duplicate button on the stock list does
-- today: `const { id, created_at, updated_at, ...rest } = row`. It is
-- lifted rather than improved, deliberately. A duplicate carries the
-- stock number, the sale state and the customer, which reads wrong
-- until you watch somebody use it: the button exists to make the NEXT
-- unit off the same build, and every one of those fields is about to be
-- edited by hand. Changing that here would mean the bar and the button
-- did different things under one word, which is worse than a rule
-- somebody may want to revisit.
--
-- The copy is built by turning the row into JSON, removing those three
-- keys and populating a fresh row type from it, so a column added to
-- the table is copied without anybody remembering to add it.
CREATE OR REPLACE FUNCTION command_duplicate_stock(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  wanted INTEGER;
  made   INTEGER := 0;
  fresh  UUID;
  ids    UUID[] := ARRAY[]::UUID[];
  body   JSONB;
BEGIN
  IF NOT command_may('stock.edit') THEN
    RAISE EXCEPTION 'you do not have stock.edit';
  END IF;

  wanted := COALESCE(array_length(p_ids, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which unit to duplicate';
  END IF;

  FOR body IN
    SELECT to_jsonb(t) - 'id' - 'created_at' - 'updated_at'
      FROM stock_trailers t WHERE t.id = ANY(p_ids)
  LOOP
    INSERT INTO stock_trailers
    SELECT (jsonb_populate_record(
      NULL::stock_trailers,
      body || jsonb_build_object(
        'id', gen_random_uuid(), 'created_at', NOW(), 'updated_at', NOW()))).*
    RETURNING id INTO fresh;

    ids  := ids || fresh;
    made := made + 1;
  END LOOP;

  -- Every unit or none. One the caller cannot see takes the call with
  -- it rather than being quietly skipped.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to duplicate % units but duplicated %; nothing has been changed',
      wanted, made;
  END IF;

  RETURN jsonb_build_object('made', made, 'ids', to_jsonb(ids), 'id', to_jsonb(ids[1]));
END;
$$;

REVOKE ALL ON FUNCTION command_duplicate_stock(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_duplicate_stock(UUID[]) TO authenticated;


-- -------------------------------------------------------------
-- 2. A second deal for the same customer
-- -------------------------------------------------------------
--
-- "Duplicate this deal for a second unit". There is no live button for
-- this one: the tracker has a context menu with a Duplicate item in it
-- and nothing renders the menu, so there is no existing rule to lift
-- and the rule is stated here instead.
--
-- WHAT CARRIES ACROSS: who the customer is and how to reach them, the
-- side of the business, what they want, who is looking after it, the
-- fleet figures and the notes. Everything that describes the CONVERSATION.
--
-- WHAT RESETS: the id and the timestamps; the stock unit, because the
-- sentence says the copy is for a SECOND unit and pointing both rows at
-- one unit would put two commissions on one sale; the order and
-- dispatch dates, the sale price, the profit, the profit percentage and
-- the commission, because none of them happened to the copy; the
-- enquiry date, which is today.
--
-- The status carries across unless the original is a customer, meaning
-- it is sold. A second unit for somebody you have already sold to is a
-- new enquiry rather than a second sale, and a copy that arrives
-- already marked sold is a commission line for a deal nobody has done.
--
-- Onto YOUR tracker, from `auth.uid()`, exactly as migration 033
-- decided it: a list id in a payload is a value anybody can type.
CREATE OR REPLACE FUNCTION command_duplicate_deal(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  wanted INTEGER;
  made   INTEGER := 0;
  fresh  UUID;
  ids    UUID[] := ARRAY[]::UUID[];
  origin RECORD;
  list   UUID;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'you do not have crm.create';
  END IF;

  wanted := COALESCE(array_length(p_ids, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which deal to duplicate';
  END IF;

  list := command_tracker_list(auth.uid());

  FOR origin IN
    SELECT company_name, contact_name, email, phone, source, status, address,
           links, location, employee_count, turnover, trucks, trailers, vans,
           vehicles, assigned_to, account_manager, initials, notes, side, what,
           requirement, estimated_value, new_or_used, category, description,
           next_action
      FROM crm_contacts WHERE id = ANY(p_ids)
  LOOP
    INSERT INTO crm_contacts (
      list_id, company_name, contact_name, email, phone, source, status,
      address, links, location, employee_count, turnover, trucks, trailers,
      vans, vehicles, assigned_to, account_manager, initials, notes, side,
      what, requirement, estimated_value, new_or_used, category, description,
      next_action, date_of_enquiry
    ) VALUES (
      list, origin.company_name, origin.contact_name, origin.email, origin.phone,
      COALESCE(origin.source, 'manual'),
      CASE origin.status WHEN 'customer' THEN 'quoted' ELSE origin.status END,
      origin.address, origin.links, origin.location, origin.employee_count,
      origin.turnover, origin.trucks, origin.trailers, origin.vans,
      origin.vehicles, origin.assigned_to, origin.account_manager, origin.initials,
      origin.notes, origin.side, origin.what, origin.requirement,
      origin.estimated_value, origin.new_or_used, origin.category,
      origin.description, origin.next_action, CURRENT_DATE
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

  RETURN jsonb_build_object('made', made, 'ids', to_jsonb(ids), 'id', to_jsonb(ids[1]));
END;
$$;

REVOKE ALL ON FUNCTION command_duplicate_deal(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_duplicate_deal(UUID[]) TO authenticated;


-- -------------------------------------------------------------
-- 3. A stock unit against a deal
-- -------------------------------------------------------------
--
-- `crm_contacts.stock_trailer_id` is what makes a sale carry through to
-- the stock list, and nothing in this application could set it on a
-- deal that already exists. Sending FROM stock creates a deal with the
-- link on it, and marking sold reads it. The tracker has a stock picker
-- component for exactly this and nothing renders it.
--
-- The column is not writable through the command bar's allowlist and
-- should not be: it says which unit, and a unit is named by its stock
-- number rather than by a UUID somebody types. So it is an operation,
-- with the ambiguity handled where the ambiguity is, in the runtime
-- that resolves "STC143580" to a row and asks when two match.
--
-- ONE DEAL AND ONE UNIT. Never a set: linking six deals to one unit
-- would be six commissions on one sale, and linking one deal to six
-- units is not a thing the column can hold.
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

  SELECT stock_trailer_id INTO held FROM crm_contacts WHERE id = p_deal;
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

  UPDATE crm_contacts SET stock_trailer_id = p_unit WHERE id = p_deal;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'the deal could not be updated; nothing has been changed';
  END IF;

  RETURN jsonb_build_object('id', p_deal, 'unit', p_unit, 'stcNo', stc);
END;
$$;

REVOKE ALL ON FUNCTION command_link_stock(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_link_stock(UUID, UUID) TO authenticated;


-- -------------------------------------------------------------
-- 4. A file on the brand kit
-- -------------------------------------------------------------
--
-- The upload itself is not SQL: the browser holds the bytes and a
-- bucket is not a table. The runtime stages the file first, under a key
-- derived from the confirmation and the file's own digest so a retry
-- reuses the object rather than leaving a second copy, and this is the
-- row that points at it.
--
-- The metadata is checked here rather than taken. `type` is one of five
-- words the table's own constraint allows, and a category nobody named
-- is the same 'General' the screen defaults to.
CREATE OR REPLACE FUNCTION command_add_brand_asset(
  p_name     TEXT,
  p_type     TEXT,
  p_url      TEXT,
  p_category TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  fresh UUID;
  kind  TEXT := lower(btrim(COALESCE(p_type, '')));
BEGIN
  IF NOT command_may('marketing.edit') THEN
    RAISE EXCEPTION 'you do not have marketing.edit';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a brand asset needs a name';
  END IF;
  IF COALESCE(btrim(p_url), '') = '' THEN
    RAISE EXCEPTION 'a brand asset needs somewhere to point';
  END IF;
  IF kind NOT IN ('logo', 'font', 'color', 'template', 'image') THEN
    RAISE EXCEPTION '% is not a kind of brand asset', COALESCE(p_type, 'that');
  END IF;

  INSERT INTO brand_assets (name, type, url, category)
  VALUES (btrim(p_name), kind, btrim(p_url),
          COALESCE(NULLIF(btrim(p_category), ''), 'General'))
  RETURNING id INTO fresh;

  RETURN jsonb_build_object('id', fresh, 'name', btrim(p_name), 'kind', kind);
END;
$$;

REVOKE ALL ON FUNCTION command_add_brand_asset(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_add_brand_asset(TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 5. Two accounts that are one business
-- -------------------------------------------------------------
--
-- `command_link_accounts` puts one account under another and has since
-- migration 029. What it cannot express is the sentence people actually
-- type: "link these two customer records as the same account", with two
-- rows ticked and neither of them named.
--
-- The missing half is WHICH ONE IS THE MAIN ACCOUNT, and there is no
-- safe convention for it. First row, most recent, most complete: each
-- of those is a guess about a merge, and a merge under the wrong parent
-- is somebody ringing a depot that closed. So the runtime asks, and
-- this takes the answer: every account named except the main one goes
-- under the main one.
--
-- It does not reimplement the link. `command_link_accounts` is still
-- the operation, once per child, so the rules about self linking, about
-- an account that is not there and about links not chaining are stated
-- once.
CREATE OR REPLACE FUNCTION command_link_among(
  p_ids    UUID[],
  p_parent UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  child   UUID;
  linked  INTEGER := 0;
  outcome JSONB;
  parent  TEXT;
BEGIN
  IF p_parent IS NULL THEN
    RAISE EXCEPTION 'nothing said which account is the main one';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'nothing said which accounts to link';
  END IF;

  SELECT company_name INTO parent FROM crm_contacts WHERE id = p_parent;
  IF parent IS NULL THEN
    RAISE EXCEPTION 'the account you named as the main one is not there';
  END IF;

  FOREACH child IN ARRAY p_ids
  LOOP
    -- The main account is allowed to be one of the ones named: "link
    -- these two, Dawson Group is the main one" names both.
    CONTINUE WHEN child = p_parent;
    outcome := command_link_accounts(child, p_parent);
    linked  := linked + 1;
  END LOOP;

  IF linked = 0 THEN
    RAISE EXCEPTION 'that names only the main account, so there is nothing to link to it';
  END IF;

  RETURN jsonb_build_object('linked', linked, 'to', parent);
END;
$$;

REVOKE ALL ON FUNCTION command_link_among(UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_link_among(UUID[], UUID) TO authenticated;


-- -------------------------------------------------------------
-- The dispatch learns all five
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Everything
-- except the five new branches is exactly what migration 033 left, and
-- this is the only copy that runs.
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
  IF cap = 'stock.duplicate' THEN
    outcome := command_duplicate_stock(p_subjects);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'deal.duplicate' THEN
    outcome := command_duplicate_deal(p_subjects);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'deal.linkStock' THEN
    outcome := command_link_stock(p_subjects[1], (args ->> 'unit')::UUID);
    changed := 1;

  ELSIF cap = 'brand.upload' THEN
    outcome := command_add_brand_asset(
      args ->> 'name', args ->> 'kind', args ->> 'url', args ->> 'category');
    changed := 1;

  ELSIF cap = 'list.create' THEN
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
    -- Every account named except the main one, under the main one. One
    -- named account and one parent is the same call with one child in
    -- it, which is what "link Dawson Maintenance to Dawson Group" is.
    outcome := command_link_among(p_subjects, (args ->> 'parent')::UUID);
    changed := COALESCE((outcome ->> 'linked')::INTEGER, 0);

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
