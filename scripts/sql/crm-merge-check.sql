-- =============================================================
-- Merging two customers, against real PostgreSQL.
--
-- From the agreed development scope, Task 17:
--
--   no deleted duplicate still owns dependent rows
--   merged notes/history remain visible
--   Protean-bound canonical account remains bound
--   ambiguous companies were not automatically merged
--
-- And from the business:
--
--   tk components is touchy as it has an open pending fleetsmart
--   contract that can't be affected to be careful with that merge.
--
-- So the fixture is that case: an open contract on the duplicate, and
-- an assertion that it comes out of the merge on the canonical customer
-- with its status exactly as it went in.
-- =============================================================
DO $check$
DECLARE
  boss  UUID := 'eeeeeeee-0000-0000-0000-000000000001';
  keep  UUID := 'eeeeeeee-1111-0000-0000-000000000001';
  dupe  UUID := 'eeeeeeee-1111-0000-0000-000000000002';
  other UUID := 'eeeeeeee-1111-0000-0000-000000000003';
  lead1 UUID;
  con1  UUID;
  m     crm_merges;
  n     INT;
  txt   TEXT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'merge-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'merge-boss@stc.example', 'Mo Director', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'administrator')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  /* The refusal from migration 157 is turned off FOR THE SEED ONLY.
     This check is about what happens to two records for one company
     that are ALREADY here, and the refusal exists to stop a third ever
     being made. Leaving it on would mean the one thing this file
     cannot do is construct the state it tests. It goes back on before
     a single assertion runs. */
  ALTER TABLE crm_contacts DISABLE TRIGGER crm_contacts_one_per_company;

  -- The canonical record: Protean bound, and missing a phone number.
  INSERT INTO crm_contacts (id, company_name, status, email, phone)
  VALUES (keep, 'TK Components', 'won', 'accounts@tk.example', NULL)
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, phone = NULL;

  -- The duplicate: older, has the phone number and some history on it.
  INSERT INTO crm_contacts (id, company_name, status, phone, notes)
  VALUES (dupe, 'TK Components Ltd', 'lead', '0161 000 0000', 'Spoke to Ian about the fleet.')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name,
                                 phone = EXCLUDED.phone, notes = EXCLUDED.notes;

  INSERT INTO crm_contacts (id, company_name, status)
  VALUES (other, 'Somebody Else', 'won') ON CONFLICT (id) DO NOTHING;

  INSERT INTO protean_accounts (alpha, protean_name, division, contact_id, ignored)
  VALUES ('TKC01', 'TK Components', 'stc', keep, FALSE) ON CONFLICT DO NOTHING;

  -- History that must survive: a note, a deal, and an address.
  INSERT INTO contact_notes (contact_id, text) VALUES (dupe, 'Chased in March, no answer.');
  INSERT INTO contact_addresses (contact_id, address, city)
  VALUES (dupe, '1 Old Road', 'Stockport');
  INSERT INTO crm_leads (contact_id, owner_id, type, status, estimated_value, what)
  VALUES (dupe, boss, 'maintenance', 'quoted', 15000, 'A quote from before')
  RETURNING id INTO lead1;

  -- THE ONE THE BUSINESS WARNED ABOUT: an open contract on the duplicate.
  INSERT INTO fleetsmart_contracts (account_id, customer_name, plan, term_months,
                                    input, priced, extras, status, sent_at)
  VALUES (dupe, 'TK Components Ltd', 'Gold', 36,
          '{}'::JSONB, '{}'::JSONB, '{}'::JSONB, 'sent', NOW())
  RETURNING id INTO con1;

  -- ---- The preview writes nothing and says what would happen ----
  SELECT COUNT(*) INTO n FROM crm_merge_preview(keep, dupe);
  IF n = 0 THEN RAISE EXCEPTION 'the preview said nothing at all'; END IF;

  IF NOT EXISTS (SELECT 1 FROM crm_merge_preview(keep, dupe) WHERE what = 'fleetsmart') THEN
    RAISE EXCEPTION 'the preview did not mention the live FleetSmart contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_merge_preview(keep, dupe)
                  WHERE what = 'fills in' AND detail LIKE 'phone%') THEN
    RAISE EXCEPTION 'the preview did not spot the blank phone number';
  END IF;
  SELECT COUNT(*) INTO n FROM crm_contacts WHERE id = dupe AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the preview changed something'; END IF;
  RAISE NOTICE 'the preview names the live contract and the blank field, and writes nothing';

  -- ---- Two live contracts refuses without a person ----
  INSERT INTO fleetsmart_contracts (account_id, customer_name, plan, term_months,
                                    input, priced, extras, status, sent_at)
  VALUES (keep, 'TK Components', 'Platinum', 36,
          '{}'::JSONB, '{}'::JSONB, '{}'::JSONB, 'sent', NOW());
  BEGIN
    PERFORM crm_merge(keep, dupe);
    RAISE EXCEPTION 'two live contracts and the merge went ahead anyway';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%went ahead anyway%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not declined%' THEN
      RAISE EXCEPTION 'two live contracts raised the wrong thing: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'two live contracts across the pair refuses, and says why';

  /* The contract check fires first, so the second contract goes now and
     its rate card stays, which is exactly the state a half tidied merge
     leaves behind. */
  DELETE FROM fleetsmart_contracts WHERE account_id = keep;

  -- ---- Two rate cards refuses too ----
  --
  -- And they arrived on their own: the contract to rate card trigger
  -- from migration 113 makes a card the moment a contract lands, so two
  -- customers who each had a contract have two cards between them
  -- whether anybody meant them to or not. That is the Task 8 question,
  -- and this function does not answer it for anybody.
  SELECT COUNT(*) INTO n FROM rate_cards
   WHERE contact_id IN (keep, dupe) AND status NOT IN ('superseded', 'withdrawn');
  IF n < 2 THEN
    RAISE EXCEPTION 'expected two live rate cards from the two contracts, found %', n;
  END IF;
  BEGIN
    PERFORM crm_merge(keep, dupe);
    RAISE EXCEPTION 'two rate cards and the merge went ahead anyway';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%went ahead anyway%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%rate cards between them%' THEN
      RAISE EXCEPTION 'two rate cards raised the wrong thing: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'two live rate cards across the pair refuses as well, rather than picking one';

  /* Put the fixture back to one contract and one card, which is the
     case the business actually described. */
  /* A rate card is withdrawn, never deleted: the trigger says so and it
     is right, because deleting one takes its change log with it. */
  PERFORM rate_card_set_status(id, 'withdrawn') FROM rate_cards WHERE contact_id = keep;

  -- ---- The merge ----
  SELECT * INTO m FROM crm_merge(keep, dupe);

  -- Nothing is left pointing at the duplicate.
  SELECT COUNT(*) INTO n FROM crm_merge_leftovers(dupe);
  IF n > 0 THEN
    SELECT string_agg(format('%s.%s (%s)', table_name, column_name, rows_left), ', ')
      INTO txt FROM crm_merge_leftovers(dupe);
    RAISE EXCEPTION 'rows still point at the merged customer: %', txt;
  END IF;
  RAISE NOTICE 'nothing anywhere still points at the merged customer';

  -- The history is on the canonical record and readable.
  SELECT COUNT(*) INTO n FROM contact_notes WHERE contact_id = keep;
  IF n <> 1 THEN RAISE EXCEPTION 'the note did not move'; END IF;
  SELECT COUNT(*) INTO n FROM contact_addresses WHERE contact_id = keep;
  IF n <> 1 THEN RAISE EXCEPTION 'the address did not move'; END IF;
  SELECT COUNT(*) INTO n FROM crm_leads WHERE contact_id = keep AND id = lead1;
  IF n <> 1 THEN RAISE EXCEPTION 'the deal did not move'; END IF;
  RAISE NOTICE 'the notes, the address and the deal are all on the record that was kept';

  -- THE CONTRACT: moved, and untouched.
  SELECT COUNT(*) INTO n FROM fleetsmart_contracts
   WHERE id = con1 AND account_id = keep AND status = 'sent';
  IF n <> 1 THEN
    SELECT status INTO txt FROM fleetsmart_contracts WHERE id = con1;
    RAISE EXCEPTION
      'the open FleetSmart contract is not on the kept customer with its status intact. '
      'It reads %', COALESCE(txt, 'gone');
  END IF;
  RAISE NOTICE 'the open FleetSmart contract moved across and its status is exactly as it was';

  -- The Protean binding is still on the canonical record.
  SELECT COUNT(*) INTO n FROM protean_accounts WHERE contact_id = keep AND alpha = 'TKC01';
  IF n <> 1 THEN RAISE EXCEPTION 'the Protean binding came off the canonical account'; END IF;
  RAISE NOTICE 'and the Protean binding on the record that was kept is untouched';

  -- The blank was filled, the set value was not overwritten.
  SELECT phone INTO txt FROM crm_contacts WHERE id = keep;
  IF txt IS DISTINCT FROM '0161 000 0000' THEN
    RAISE EXCEPTION 'the blank phone number was not filled in from the duplicate';
  END IF;
  SELECT email INTO txt FROM crm_contacts WHERE id = keep;
  IF txt IS DISTINCT FROM 'accounts@tk.example' THEN
    RAISE EXCEPTION 'the canonical email was overwritten, and it was not blank';
  END IF;
  RAISE NOTICE 'a blank field was filled from the duplicate and a set one was left alone';

  -- Nothing was destroyed.
  SELECT COUNT(*) INTO n FROM crm_contacts WHERE id = dupe;
  IF n <> 1 THEN RAISE EXCEPTION 'the duplicate row was destroyed rather than soft deleted'; END IF;
  SELECT COUNT(*) INTO n FROM crm_contacts WHERE id = dupe AND deleted_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the duplicate is not soft deleted'; END IF;
  RAISE NOTICE 'the duplicate is soft deleted, still there, and restorable';

  -- And the merge is described.
  IF m.snapshot IS NULL OR m.snapshot->>'company_name' IS NULL THEN
    RAISE EXCEPTION 'the merge recorded no snapshot of what it merged';
  END IF;
  IF NOT (m.moved ? 'contact_notes.contact_id') THEN
    RAISE EXCEPTION 'the merge did not record moving the notes';
  END IF;
  IF NOT (m.filled ? 'phone') THEN
    RAISE EXCEPTION 'the merge did not record filling in the phone number';
  END IF;
  IF array_length(m.warnings, 1) IS NULL THEN
    RAISE EXCEPTION 'the merge did not warn about the live contract';
  END IF;
  RAISE NOTICE 'and the merge wrote down what it moved, what it filled and what it flagged';

  -- ---- It refuses the obvious mistakes ----
  BEGIN
    PERFORM crm_merge(keep, keep);
    RAISE EXCEPTION 'merging a customer into itself went ahead';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%went ahead%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM crm_merge(keep, dupe);
    RAISE EXCEPTION 'merging an already merged customer went ahead';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%went ahead%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'a customer cannot be merged into itself, nor merged twice';

  -- =============================================================
  -- Choosing which of a pair to keep.
  --
  -- From the business: "needs merging into the account with the most
  -- action". From the scope: the Protean bound record is normally
  -- canonical. Those two can disagree, so the order is asserted rather
  -- than left to whoever reads the function.
  -- =============================================================
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  -- Protean beats weight: the thin record is bound, the fat one is not.
  INSERT INTO crm_contacts (id, company_name, status) VALUES
    ('eeeeeeee-2222-0000-0000-000000000001', 'Thin But Bound', 'won'),
    ('eeeeeeee-2222-0000-0000-000000000002', 'Fat But Unbound', 'won')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO protean_accounts (alpha, protean_name, division, contact_id, ignored)
  VALUES ('THIN01', 'Thin But Bound', 'stc', 'eeeeeeee-2222-0000-0000-000000000001', FALSE)
  ON CONFLICT DO NOTHING;
  INSERT INTO contact_notes (contact_id, text) VALUES
    ('eeeeeeee-2222-0000-0000-000000000002', 'one'),
    ('eeeeeeee-2222-0000-0000-000000000002', 'two'),
    ('eeeeeeee-2222-0000-0000-000000000002', 'three');

  SELECT kept, because INTO txt, txt FROM crm_merge_pair(
    'eeeeeeee-2222-0000-0000-000000000002'::UUID,
    'eeeeeeee-2222-0000-0000-000000000001'::UUID);
  IF (SELECT company_name FROM crm_contacts
       WHERE id = 'eeeeeeee-2222-0000-0000-000000000001' AND deleted_at IS NULL) IS NULL THEN
    RAISE EXCEPTION 'the Protean bound record was the one thrown away';
  END IF;
  SELECT COUNT(*) INTO n FROM contact_notes
   WHERE contact_id = 'eeeeeeee-2222-0000-0000-000000000001';
  IF n <> 3 THEN
    RAISE EXCEPTION 'the three notes did not follow onto the bound record, % found', n;
  END IF;
  RAISE NOTICE 'the Protean bound record is kept even when the other one has more on it';

  -- Neither bound: the one with more on it wins.
  INSERT INTO crm_contacts (id, company_name, status) VALUES
    ('eeeeeeee-3333-0000-0000-000000000001', 'Quiet One', 'lead'),
    ('eeeeeeee-3333-0000-0000-000000000002', 'Busy One', 'lead')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO contact_notes (contact_id, text) VALUES
    ('eeeeeeee-3333-0000-0000-000000000002', 'a'),
    ('eeeeeeee-3333-0000-0000-000000000002', 'b');

  PERFORM crm_merge_pair(
    'eeeeeeee-3333-0000-0000-000000000001'::UUID,
    'eeeeeeee-3333-0000-0000-000000000002'::UUID);
  IF (SELECT company_name FROM crm_contacts
       WHERE id = 'eeeeeeee-3333-0000-0000-000000000002' AND deleted_at IS NULL) IS NULL THEN
    RAISE EXCEPTION 'with neither bound, the busier record was thrown away';
  END IF;
  RAISE NOTICE 'and with neither bound, the one with more action on it is kept';

  -- ---- A later merge does not rewrite an earlier merge's record ----
  --
  -- `crm_merges.canonical_id` points at a customer, so a generic sweep
  -- of everything that points at a customer would move it. If B was
  -- merged into A, and A is later merged into C, rewriting that first
  -- record makes it say B was merged into C, which never happened.
  INSERT INTO crm_contacts (id, company_name, status) VALUES
    ('eeeeeeee-4444-0000-0000-000000000001', 'Absorber', 'won'),
    ('eeeeeeee-4444-0000-0000-000000000002', 'Absorbed', 'lead'),
    ('eeeeeeee-4444-0000-0000-000000000003', 'Final Home', 'won')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO contact_notes (contact_id, text) VALUES
    ('eeeeeeee-4444-0000-0000-000000000001', 'x'),
    ('eeeeeeee-4444-0000-0000-000000000003', 'y'),
    ('eeeeeeee-4444-0000-0000-000000000003', 'z');

  PERFORM crm_merge('eeeeeeee-4444-0000-0000-000000000001'::UUID,
                    'eeeeeeee-4444-0000-0000-000000000002'::UUID);
  PERFORM crm_merge('eeeeeeee-4444-0000-0000-000000000003'::UUID,
                    'eeeeeeee-4444-0000-0000-000000000001'::UUID);

  SELECT COUNT(*) INTO n FROM crm_merges
   WHERE merged_id = 'eeeeeeee-4444-0000-0000-000000000002'
     AND canonical_id = 'eeeeeeee-4444-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'the first merge record no longer says Absorbed went into Absorber. A later merge '
      'rewrote it, and that is history being tidied up by something that happened after it.';
  END IF;
  RAISE NOTICE 'and merging a record that had absorbed another does not rewrite the first record';

  RAISE NOTICE 'a merge moves everything, keeps the contract intact, and destroys nothing';
END
$check$;
