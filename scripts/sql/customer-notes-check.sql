-- =============================================================
-- A note typed on a deal belongs to the customer.
--
-- From the business:
--
--   rework this so that it's a global customer note adder that will
--   update the CRM record [...] will show when clicking into the
--   customer in the CRM and also in any other leads for this customer
--   [...] It can be deleted or updated from the CRM tab after which
--   updates the note globally too.
--
-- Run with `npm run check:customer-notes`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  rep  UUID := 'cccc2222-0000-0000-0000-000000000001';
  mate UUID := 'cccc2222-0000-0000-0000-000000000002';
  boss UUID := 'cccc2222-0000-0000-0000-000000000003';
  cust UUID; other UUID; lead_a UUID; lead_b UUID; lead_c UUID;
  note contact_notes; r RECORD; n INT; said TEXT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep,'cn-rep@stc.example'), (mate,'cn-mate@stc.example'), (boss,'cn-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep, 'cn-rep@stc.example', 'Rita Rep', 'sales', TRUE),
    (mate,'cn-mate@stc.example','Mal Mate', 'sales', TRUE),
    (boss,'cn-boss@stc.example','Mo Director','admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id IN (rep, mate);
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;
  INSERT INTO crm_contacts (company_name) VALUES ('Dawson Group') RETURNING id INTO cust;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, notes)
  VALUES ('Dawson Group', cust, rep,  rep,  'maintenance', 'lead', 'Rang them about the curtainsiders')
  RETURNING id INTO lead_a;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status)
  VALUES ('Dawson Group', cust, mate, mate, 'rental', 'lead')
  RETURNING id INTO lead_b;

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  -- ---------------------------------------------------------
  -- 1. A NOTE TYPED ON ONE DEAL IS ON THE CUSTOMER.
  -- ---------------------------------------------------------
  note := crm_note_add(cust, 'Wants a price on two more by Friday', lead_a);
  IF note.id IS NULL THEN RAISE EXCEPTION 'the note was not written'; END IF;
  IF note.contact_id <> cust THEN RAISE EXCEPTION 'it did not land on the customer'; END IF;
  IF note.from_lead_id <> lead_a THEN RAISE EXCEPTION 'it does not say which deal it came from'; END IF;

  -- ---------------------------------------------------------
  -- 2. AND THEREFORE ON THE OTHER PERSON'S DEAL, which is the whole
  --    point: two people working one customer see one story.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', mate::TEXT, TRUE);
  SELECT * INTO r FROM crm_latest_notes(ARRAY[cust]);
  IF r.text <> 'Wants a price on two more by Friday' THEN
    RAISE EXCEPTION 'the colleague''s deal shows "%"', r.text;
  END IF;
  IF r.notes_total < 1 THEN RAISE EXCEPTION 'the count of notes is %', r.notes_total; END IF;

  -- ---------------------------------------------------------
  -- 3. EDITING IT CHANGES IT EVERYWHERE, AND SAYS IT WAS EDITED.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  note := crm_note_edit(note.id, 'Wants a price on THREE more by Friday');
  IF note.text NOT LIKE '%THREE%' THEN RAISE EXCEPTION 'the edit did not take'; END IF;
  IF note.edited_at IS NULL OR note.edited_by <> rep THEN
    RAISE EXCEPTION 'an edited note does not say it was edited, or by whom';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', mate::TEXT, TRUE);
  SELECT * INTO r FROM crm_latest_notes(ARRAY[cust]);
  IF r.text NOT LIKE '%THREE%' THEN
    RAISE EXCEPTION 'the edit did not reach the other deal';
  END IF;

  -- ---------------------------------------------------------
  -- 4. A COLLEAGUE CANNOT QUIETLY REWRITE IT unless they hold the
  --    right to edit the CRM, and when they do it is stamped as theirs.
  -- ---------------------------------------------------------
  INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
  VALUES (mate, 'crm.edit', FALSE, 'check:customer-notes')
  ON CONFLICT (user_id, capability) DO UPDATE SET granted = FALSE;
  BEGIN
    PERFORM crm_note_edit(note.id, 'Something else entirely');
    RAISE EXCEPTION 'somebody without crm.edit rewrote another person''s note';
  EXCEPTION WHEN OTHERS THEN
    said := SQLERRM;
    IF said = 'somebody without crm.edit rewrote another person''s note' THEN RAISE; END IF;
  END;
  DELETE FROM user_capability_overrides WHERE user_id = mate AND capability = 'crm.edit';

  -- ---------------------------------------------------------
  -- 5. REMOVING IT REMOVES IT EVERYWHERE, softly.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM crm_note_remove(note.id);
  SELECT count(*) INTO n FROM crm_latest_notes(ARRAY[cust]);
  IF n <> 0 THEN RAISE EXCEPTION 'the note is still showing after removal'; END IF;
  SELECT count(*) INTO n FROM contact_notes WHERE id = note.id;
  IF n <> 1 THEN RAISE EXCEPTION 'the row was destroyed rather than set aside'; END IF;

  -- ---------------------------------------------------------
  -- 6. NOTHING IS WRITTEN WHILE VIEWING AS SOMEBODY ELSE.
  -- ---------------------------------------------------------
  INSERT INTO view_as_sessions (admin_id, viewing_id) VALUES (rep, mate)
  ON CONFLICT (admin_id) DO UPDATE SET viewing_id = EXCLUDED.viewing_id;
  BEGIN
    PERFORM crm_note_add(cust, 'typed while pretending', NULL);
    RAISE EXCEPTION 'a note was written while viewing as somebody else';
  EXCEPTION WHEN OTHERS THEN
    said := SQLERRM;
    IF said = 'a note was written while viewing as somebody else' THEN RAISE; END IF;
  END;
  DELETE FROM view_as_sessions WHERE admin_id = rep;

  -- ---------------------------------------------------------
  -- 7. THE BACKFILL MOVES WHAT IS ALREADY THERE AND KEEPS IT.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM tracker_notes_to_customers();
  IF r.moved < 1 THEN RAISE EXCEPTION 'the existing deal note was not brought across'; END IF;

  SELECT count(*) INTO n FROM contact_notes
   WHERE contact_id = cust AND text = 'Rang them about the curtainsiders' AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the deal note is on the customer % times', n; END IF;

  /* The source column is untouched: a backfill that empties what it
     reads has no second chance. */
  SELECT count(*) INTO n FROM crm_leads
   WHERE id = lead_a AND BTRIM(notes) = 'Rang them about the curtainsiders';
  IF n <> 1 THEN RAISE EXCEPTION 'the backfill emptied the column it read'; END IF;

  -- And running it twice adds nothing.
  SELECT * INTO r FROM tracker_notes_to_customers();
  IF r.moved <> 0 THEN RAISE EXCEPTION 'a second run wrote % more', r.moved; END IF;

  -- ---------------------------------------------------------
  -- 8. THE COLUMN IS A MIRROR OF THE NEWEST NOTE, BOTH WAYS.
  --
  -- `crm_contacts.notes` is what the CRM grid, the CSV export and the
  -- command bar all read. Before 145 it only copied across on insert,
  -- so a corrected note left the grid on the old wording.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  note := crm_note_add(cust, 'Newest thing anybody knows', NULL);

  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said <> 'Newest thing anybody knows' THEN
    RAISE EXCEPTION 'the column does not show the newest note, it shows %', said;
  END IF;

  PERFORM crm_note_edit(note.id, 'Corrected: Friday, not Thursday');
  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said <> 'Corrected: Friday, not Thursday' THEN
    RAISE EXCEPTION 'editing a note left the column on %', said;
  END IF;

  PERFORM crm_note_remove(note.id);
  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said = 'Corrected: Friday, not Thursday' THEN
    RAISE EXCEPTION 'removing a note left the column showing it';
  END IF;
  IF said IS NULL THEN
    RAISE EXCEPTION 'removing the newest note emptied the column instead of falling back';
  END IF;

  -- Writing the column WRITES A NOTE, with an author and a date on it.
  UPDATE crm_contacts SET notes = 'Typed straight into the grid' WHERE id = cust;
  SELECT count(*) INTO n FROM contact_notes
   WHERE contact_id = cust AND text = 'Typed straight into the grid' AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'typing in the column made % notes', n; END IF;
  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said <> 'Typed straight into the grid' THEN
    RAISE EXCEPTION 'the column and the note disagree: %', said;
  END IF;

  -- Clearing the cell is refused. Notes are removed one at a time.
  UPDATE crm_contacts SET notes = NULL WHERE id = cust;
  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said IS DISTINCT FROM 'Typed straight into the grid' THEN
    RAISE EXCEPTION 'clearing the cell destroyed the customer history';
  END IF;

  -- ---------------------------------------------------------
  -- 9. THE COLUMN BACKFILL NEVER PROMOTES A STRAY OVER A REAL NOTE.
  -- ---------------------------------------------------------
  PERFORM set_config('stc.note_mirror', 'on', TRUE);
  UPDATE crm_contacts SET notes = 'Something old nobody attributed' WHERE id = cust;
  PERFORM set_config('stc.note_mirror', 'off', TRUE);

  SELECT * INTO r FROM contact_notes_from_column();
  IF r.moved < 1 THEN RAISE EXCEPTION 'the stray column value was not turned into a note'; END IF;

  SELECT notes INTO said FROM crm_contacts WHERE id = cust;
  IF said = 'Something old nobody attributed' THEN
    RAISE EXCEPTION 'the backfill promoted a stray column value over a real note';
  END IF;
  SELECT count(*) INTO n FROM contact_notes
   WHERE contact_id = cust AND text = 'Something old nobody attributed' AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the stray is on the record % times', n; END IF;

  -- And running it twice adds nothing.
  SELECT * INTO r FROM contact_notes_from_column();
  IF r.moved <> 0 THEN RAISE EXCEPTION 'a second run of the column backfill wrote % more', r.moved; END IF;

  -- ---------------------------------------------------------
  -- 10. THE TWO BACKFILLS IN THE WRONG ORDER LOSE NOTHING.
  --
  -- Found by running the handover files against real data. The mirror
  -- recomputes `crm_contacts.notes` the moment any note is written, so
  -- moving the deal notes first overwrote the column, and the sweep
  -- that exists to rescue that value then found the column agreeing
  -- with a note and reported "already there". A line somebody had
  -- typed about a customer was gone and the counts looked fine.
  --
  -- Migration 150 makes the order stop mattering. This asserts the
  -- WRONG order, on purpose, because the right one already worked.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  INSERT INTO crm_contacts (company_name, notes)
  VALUES ('Order Matters Haulage', 'Typed into the grid long ago')
  RETURNING id INTO other;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, notes)
  VALUES ('Order Matters Haulage', other, rep, rep, 'maintenance', 'quoted',
          'Rang them about the curtainsiders')
  RETURNING id INTO lead_c;

  -- Deals first, which is the order that destroyed it.
  PERFORM tracker_notes_to_customers();
  PERFORM contact_notes_from_column();

  IF NOT EXISTS (SELECT 1 FROM contact_notes
                  WHERE contact_id = other AND deleted_at IS NULL
                    AND text = 'Typed into the grid long ago') THEN
    RAISE EXCEPTION 'the column value was destroyed by moving the deal notes first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contact_notes
                  WHERE contact_id = other AND deleted_at IS NULL
                    AND text = 'Rang them about the curtainsiders') THEN
    RAISE EXCEPTION 'the deal note did not reach the customer';
  END IF;

  /* And the rescued one is the OLDER of the two, so the grid still
     shows what was said most recently rather than what was rescued. */
  SELECT text INTO said FROM contact_notes
   WHERE contact_id = other AND deleted_at IS NULL
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF said <> 'Rang them about the curtainsiders' THEN
    RAISE EXCEPTION 'the rescued column value jumped the queue: newest is now %', said;
  END IF;

  -- Both again, still two notes.
  PERFORM tracker_notes_to_customers();
  PERFORM contact_notes_from_column();
  SELECT count(*) INTO n FROM contact_notes WHERE contact_id = other AND deleted_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'a second run of both left % notes, wanted 2', n; END IF;

  RAISE NOTICE 'customer notes: one story per customer, editable, removable, mirrored, and the backfills keep their source in either order';
END $check$;

ROLLBACK;
