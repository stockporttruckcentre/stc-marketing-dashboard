-- =============================================================
-- Cash Only, the third kind of CRM record. Migration 156.
--
-- Run as `authenticated`, because the owner of the database bypasses
-- row level security and a check that runs as the owner proves nothing
-- about a policy.
--
-- Run with `npm run check:cash-only`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
DECLARE
  boss   UUID := 'cade0000-0000-0000-0000-0000000000a1';
  counter UUID;   -- cash sites only
  twoways    UUID;   -- cash sites AND an invoicing account
  acct    UUID;   -- an invoicing account only
  pros    UUID;   -- neither
  pinned  UUID;   -- cash sites only, but somebody decided by hand
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'cash-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'cash-boss@stc.example', 'Cass Boss', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='administrator')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;


  INSERT INTO crm_contacts (company_name, relationship) VALUES
    ('Counter Only Ltd',   'existing') RETURNING id INTO counter;
  INSERT INTO crm_contacts (company_name, relationship) VALUES
    ('Both Ways Ltd',      'existing') RETURNING id INTO twoways;
  INSERT INTO crm_contacts (company_name, relationship) VALUES
    ('Account Only Ltd',   'existing') RETURNING id INTO acct;
  INSERT INTO crm_contacts (company_name, relationship) VALUES
    ('Nobody Yet Ltd',     'prospect') RETURNING id INTO pros;
  INSERT INTO crm_contacts (company_name, relationship, relationship_pinned) VALUES
    ('Decided By Hand Ltd','existing', TRUE) RETURNING id INTO pinned;

  INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id) VALUES
    ('stc', 'CASH', 'Counter Only',    counter),
    ('stc', 'CASH', 'Both Ways',       twoways),
    ('stc', 'CASH', 'Decided By Hand', pinned);

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id) VALUES
    ('stc', 'BOTH01', 'Both Ways Ltd',    twoways),
    ('stc', 'ACCT01', 'Account Only Ltd', acct);

  PERFORM set_config('stc.counter', counter::TEXT, FALSE);
  PERFORM set_config('stc.twoways',    twoways::TEXT,    FALSE);
  PERFORM set_config('stc.acct',    acct::TEXT,    FALSE);
  PERFORM set_config('stc.pros',    pros::TEXT,    FALSE);
  PERFORM set_config('stc.pinned',  pinned::TEXT,  FALSE);
END $seed$;

-- -------------------------------------------------------------
-- 1. The column now says three things and nothing else.
--
-- There was no constraint at all before 156, so a typo was stored and
-- read as a prospect everywhere the test was against 'existing'.
-- -------------------------------------------------------------
DO $shape$
BEGIN
  BEGIN
    INSERT INTO crm_contacts (company_name, relationship) VALUES ('Typo Ltd', 'custmoer');
    RAISE EXCEPTION 'a typo was accepted as a relationship';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO crm_contacts (company_name, relationship) VALUES ('Third Kind Ltd', 'cash_only');
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'cash_only is not an allowed relationship';
  END;
  DELETE FROM crm_contacts WHERE company_name = 'Third Kind Ltd';
END $shape$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_contacts, crm_leads TO authenticated;
GRANT SELECT ON crm_relationship_moves, protean_cash_sites, protean_accounts TO authenticated;

SET ROLE authenticated;
DO $check$
DECLARE
  boss    UUID := 'cade0000-0000-0000-0000-0000000000a1';
  counter UUID := current_setting('stc.counter')::UUID;
  twoways    UUID := current_setting('stc.twoways')::UUID;
  acct    UUID := current_setting('stc.acct')::UUID;
  pros    UUID := current_setting('stc.pros')::UUID;
  pinned  UUID := current_setting('stc.pinned')::UUID;
  n       INT;
  rel     TEXT;
  lead    UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  -- -----------------------------------------------------------
  -- 2. The rule: cash sites and no invoicing account.
  -- -----------------------------------------------------------
  IF NOT crm_lives_on_cash(counter) THEN
    RAISE EXCEPTION 'a record with cash sites and no account does not read as living on cash';
  END IF;
  IF crm_lives_on_cash(twoways) THEN
    RAISE EXCEPTION 'a record with an invoicing account reads as living on cash';
  END IF;
  IF crm_lives_on_cash(acct) THEN
    RAISE EXCEPTION 'a record with only an account reads as living on cash';
  END IF;
  IF crm_lives_on_cash(pros) THEN
    RAISE EXCEPTION 'a record with nothing at all reads as living on cash';
  END IF;

  -- -----------------------------------------------------------
  -- 3. A dry run changes nothing. THIS IS THE ONE THAT MATTERS,
  --    because a preview that writes is how Monday's work vanished.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM crm_allocate_cash_only(FALSE);
  IF n <> 1 THEN RAISE EXCEPTION 'the dry run named % records, not one', n; END IF;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = counter;
  IF rel <> 'existing' THEN RAISE EXCEPTION 'the dry run moved a record anyway'; END IF;
  SELECT count(*) INTO n FROM crm_relationship_moves;
  IF n <> 0 THEN RAISE EXCEPTION 'the dry run wrote % move rows', n; END IF;

  -- -----------------------------------------------------------
  -- 4. Applying it moves exactly the one, and writes down what it was.
  -- -----------------------------------------------------------
  PERFORM crm_allocate_cash_only(TRUE);

  SELECT relationship INTO rel FROM crm_contacts WHERE id = counter;
  IF rel <> 'cash_only' THEN RAISE EXCEPTION 'the counter-only record reads %, not cash_only', rel; END IF;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = twoways;
  IF rel <> 'existing' THEN RAISE EXCEPTION 'a record with a real account was moved to %', rel; END IF;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = acct;
  IF rel <> 'existing' THEN RAISE EXCEPTION 'an account customer was moved to %', rel; END IF;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = pros;
  IF rel <> 'prospect' THEN RAISE EXCEPTION 'a prospect with no money at all was moved to %', rel; END IF;

  -- Somebody decided this one by hand and an allocation does not argue.
  SELECT relationship INTO rel FROM crm_contacts WHERE id = pinned;
  IF rel <> 'existing' THEN RAISE EXCEPTION 'a pinned record was moved to %', rel; END IF;

  SELECT count(*) INTO n FROM crm_relationship_moves WHERE contact_id = counter AND was = 'existing' AND became = 'cash_only';
  IF n <> 1 THEN RAISE EXCEPTION 'the move was not written down, so it cannot be undone'; END IF;

  -- -----------------------------------------------------------
  -- 5. Running it twice does nothing the second time.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM crm_allocate_cash_only(TRUE);
  IF n <> 0 THEN RAISE EXCEPTION 'running the allocation again moved % more records', n; END IF;

  -- -----------------------------------------------------------
  -- 6. It moves BACK the moment a real account arrives.
  -- -----------------------------------------------------------
  RESET ROLE;
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
  VALUES ('stc', 'CNTR01', 'Counter Only Ltd', counter);
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  SELECT count(*) INTO n FROM crm_allocate_cash_only(TRUE);
  IF n <> 1 THEN RAISE EXCEPTION 'gaining an account moved % records back, not one', n; END IF;
  SELECT relationship INTO rel FROM crm_contacts WHERE id = counter;
  IF rel <> 'existing' THEN RAISE EXCEPTION 'a record that gained an account still reads %', rel; END IF;

  -- Put it back to cash only for the rest of the checks.
  RESET ROLE;
  DELETE FROM protean_accounts WHERE division='stc' AND alpha='CNTR01';
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM crm_allocate_cash_only(TRUE);

  -- -----------------------------------------------------------
  -- 7. Binding a cash sale does not call somebody a customer.
  --
  -- THE BUG THIS MIGRATION EXISTS FOR. `protean_bind_site` used to end
  -- with `relationship = 'existing'`, so every cash site anybody bound
  -- promoted the record to Customer.
  -- -----------------------------------------------------------
  PERFORM protean_bind_site('stc', 'CASH', 'Nobody Yet', pros);
  SELECT relationship INTO rel FROM crm_contacts WHERE id = pros;
  IF rel <> 'cash_only' THEN
    RAISE EXCEPTION 'binding a cash sale made the record %, not cash_only', rel;
  END IF;

  -- And it still says Customer for somebody who holds a real account.
  PERFORM protean_bind_site('stc', 'CASH', 'Account Only', acct);
  SELECT relationship INTO rel FROM crm_contacts WHERE id = acct;
  IF rel <> 'existing' THEN
    RAISE EXCEPTION 'a cash sale demoted an account customer to %', rel;
  END IF;

  -- -----------------------------------------------------------
  -- 8. Winning a deal promotes a prospect and leaves Cash Only alone.
  -- -----------------------------------------------------------
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Counter Only Ltd', counter, boss, boss, 'maintenance', 'quoted', 500)
  RETURNING id INTO lead;
  UPDATE crm_leads SET status = 'won' WHERE id = lead;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = counter;
  IF rel <> 'cash_only' THEN
    RAISE EXCEPTION 'winning a job turned a counter customer into %, and no account was opened', rel;
  END IF;

  -- A prospect with no cash sales is still promoted by a win.
  RESET ROLE;
  UPDATE crm_contacts SET relationship = 'prospect' WHERE id = pros;
  DELETE FROM protean_cash_sites WHERE contact_id = pros;
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Nobody Yet Ltd', pros, boss, boss, 'maintenance', 'quoted', 500)
  RETURNING id INTO lead;
  UPDATE crm_leads SET status = 'won' WHERE id = lead;

  SELECT relationship INTO rel FROM crm_contacts WHERE id = pros;
  IF rel <> 'existing' THEN
    RAISE EXCEPTION 'winning a job for a prospect left them as %, so nothing makes a customer any more', rel;
  END IF;

  -- -----------------------------------------------------------
  -- 9. Binding a real invoicing account promotes out of Cash Only.
  -- -----------------------------------------------------------
  RESET ROLE;
  INSERT INTO protean_accounts (division, alpha, protean_name) VALUES ('stc', 'CNTR02', 'Counter Only Ltd');
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  PERFORM protean_bind('stc', 'CNTR02', counter);
  SELECT relationship INTO rel FROM crm_contacts WHERE id = counter;
  IF rel <> 'existing' THEN
    RAISE EXCEPTION 'opening an account for a counter customer left them as %', rel;
  END IF;
END $check$;
RESET ROLE;

-- -------------------------------------------------------------
-- 10. Somebody who cannot edit the CRM cannot apply the allocation.
-- -------------------------------------------------------------
DO $viewer$
DECLARE looker UUID := 'cade0000-0000-0000-0000-0000000000a2';
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (looker, 'cash-looker@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (looker, 'cash-looker@stc.example', 'Lola Looker', 'viewer', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='observer')
   WHERE id = looker;
  ALTER TABLE profiles ENABLE TRIGGER USER;
END $viewer$;

SET ROLE authenticated;
DO $refused$
DECLARE looker UUID := 'cade0000-0000-0000-0000-0000000000a2';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', looker::TEXT, TRUE);
  IF command_may('crm.edit') THEN
    RAISE EXCEPTION 'the observer used for this check can edit the CRM, so the refusal below proves nothing';
  END IF;
  BEGIN
    PERFORM crm_allocate_cash_only(TRUE);
    RAISE EXCEPTION 'a read only viewer reallocated every customer type in the CRM';
  EXCEPTION WHEN raise_exception THEN
    -- The refusal has to be the RIGHT refusal. A viewer who cannot even
    -- read the CRM would fail on the line above and the check would
    -- pass while proving nothing about the write.
    IF SQLERRM NOT LIKE 'Allocating customer types%' THEN RAISE; END IF;
  END;
END $refused$;
RESET ROLE;

ROLLBACK;
