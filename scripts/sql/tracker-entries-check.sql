-- =============================================================
-- Every tracker entry, on the customer's own record.
--
-- From the business:
--
--   all tracker entries app-wide should show at the top of a customer's
--   CRM tab. Currently it says searching for open work, but it never
--   finds any. Not finding leads or contracts or open trailer sales
--   stuff, etc.
--
-- Run with `npm run check:tracker-entries`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  rep   UUID := 'aabb3333-0000-0000-0000-000000000001';
  mate  UUID := 'aabb3333-0000-0000-0000-000000000002';
  boss  UUID := 'aabb3333-0000-0000-0000-000000000003';
  clerk UUID := 'aabb3333-0000-0000-0000-000000000004';
  cust UUID; gone UUID; twin UUID;
  l_own UUID; l_merged UUID; l_twin UUID; l_loose UUID; l_other UUID; l_stock UUID;
  unit UUID; contract UUID;
  n INT; r RECORD; said TEXT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep,'te-rep@stc.example'), (mate,'te-mate@stc.example'),
    (boss,'te-boss@stc.example'), (clerk,'te-clerk@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,  'te-rep@stc.example',  'Rita Rep',    'sales',  TRUE),
    (mate, 'te-mate@stc.example', 'Mal Mate',    'sales',  TRUE),
    (boss, 'te-boss@stc.example', 'Mo Director', 'admin',  TRUE),
    (clerk,'te-clerk@stc.example','Ola Office',  'viewer', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id IN (rep, mate);
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='office_admin') WHERE id=clerk;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  DELETE FROM view_as_sessions;

  -- The customer, a record that was merged into them, and their twin.
  INSERT INTO crm_contacts (company_name) VALUES ('Dawson Group Ltd')  RETURNING id INTO cust;
  INSERT INTO crm_contacts (company_name) VALUES ('Dawson Group (UK)') RETURNING id INTO gone;
  INSERT INTO crm_contacts (company_name, parent_customer_id)
  VALUES ('Dawson Maintenance', cust) RETURNING id INTO twin;

  UPDATE crm_contacts SET deleted_at = NOW() WHERE id = gone;
  INSERT INTO crm_merges (merged_id, canonical_id, merged_by)
  VALUES (gone, cust, boss) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  -- 1. Straight at them.
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Dawson Group Ltd', cust, rep, rep, 'trailer_sales', 'quoted', 31000)
  RETURNING id INTO l_own;

  -- 2. At the record that was merged away.
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Dawson Group (UK)', gone, rep, rep, 'rental', 'contacted', 9000)
  RETURNING id INTO l_merged;

  -- 3. At the twin.
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Dawson Maintenance', twin, rep, rep, 'maintenance', 'lead', 4000)
  RETURNING id INTO l_twin;

  -- 4. At nothing, which is what an import leaves behind. The name is
  --    written differently on purpose: "The Dawson Group Limited" and
  --    "Dawson Group Ltd" are one company.
  INSERT INTO crm_leads (company_name, owner_id, created_by, type, status, estimated_value)
  VALUES ('The Dawson Group Limited', rep, rep, 'trailer_sales', 'lead', 12000)
  RETURNING id INTO l_loose;

  /* The trigger used to empty this. SELECT INTO with no rows writes
     NULL, so a lead with no customer record lost the only thing that
     could ever attach it to one. */
  SELECT company_name INTO said FROM crm_leads WHERE id = l_loose;
  IF said IS DISTINCT FROM 'The Dawson Group Limited' THEN
    RAISE EXCEPTION 'a lead with no customer record lost its company name: it now says %', COALESCE(said, 'nothing');
  END IF;

  -- And somebody else entirely, who must never appear.
  INSERT INTO crm_leads (company_name, owner_id, created_by, type, status, estimated_value)
  VALUES ('Wincanton', rep, rep, 'rental', 'lead', 50000)
  RETURNING id INTO l_other;

  -- ---------------------------------------------------------
  -- 1. ALL FOUR WAYS OF BELONGING TO THE CUSTOMER ARE FOUND.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM customer_tracker_entries(cust);
  IF n <> 4 THEN
    RAISE EXCEPTION 'the customer card found % of the four tracker entries', n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE id = l_merged) THEN
    RAISE EXCEPTION 'a deal on a record merged into them was not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE id = l_twin) THEN
    RAISE EXCEPTION 'a deal on their twin account was not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE id = l_loose) THEN
    RAISE EXCEPTION 'a deal written against their name with no account was not found';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE id = l_other) THEN
    RAISE EXCEPTION 'somebody else''s customer turned up on this record';
  END IF;

  -- ---------------------------------------------------------
  -- 2. AND A GUESS SAYS IT IS A GUESS.
  -- ---------------------------------------------------------
  SELECT matched_by INTO said FROM customer_tracker_entries(cust) WHERE id = l_loose;
  IF said <> 'name' THEN
    RAISE EXCEPTION 'the name match is presented as %, not as a name match', said;
  END IF;
  SELECT matched_by INTO said FROM customer_tracker_entries(cust) WHERE id = l_own;
  IF said <> 'record' THEN
    RAISE EXCEPTION 'a deal on the record itself is reported as %', said;
  END IF;

  -- ---------------------------------------------------------
  -- 3. THE CONTRACT AND THE TRAILER COME WITH IT.
  --
  --    "Not finding leads or contracts or open trailer sales stuff."
  --    One list, not three.
  -- ---------------------------------------------------------
  INSERT INTO stock_trailers (stc_no, make, model, status)
  VALUES ('STC143980', 'SDC', 'Curtainsider', 'in_stock') RETURNING id INTO unit;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status,
                         stock_trailer_id, estimated_value)
  VALUES ('Dawson Group Ltd', cust, rep, rep, 'trailer_sales', 'quoted', unit, 28000)
  RETURNING id INTO l_stock;

  SELECT stock_no INTO said FROM customer_tracker_entries(cust) WHERE id = l_stock;
  IF said <> 'STC143980' THEN
    RAISE EXCEPTION 'the trailer on the deal is %, not the unit it is for', COALESCE(said, 'missing');
  END IF;

  INSERT INTO fleetsmart_contracts (ref, customer_name, plan, term_months, starts_on,
                                    status, sent_at, sent_to, lead_id, owner_id, created_by)
  VALUES ('FS-0042', 'Dawson Group Ltd', 'Gold', 36, CURRENT_DATE,
          'sent', NOW(), 'ian@dawson.example', l_twin, rep, rep)
  RETURNING id INTO contract;

  SELECT contract_ref, contract_status INTO r FROM customer_tracker_entries(cust) WHERE id = l_twin;
  IF r.contract_ref <> 'FS-0042' THEN
    RAISE EXCEPTION 'the FleetSmart+ contract behind the deal is %', COALESCE(r.contract_ref, 'missing');
  END IF;
  IF r.contract_status <> 'sent' THEN
    RAISE EXCEPTION 'the contract is reported at %', COALESCE(r.contract_status, 'missing');
  END IF;

  -- ---------------------------------------------------------
  -- 4. THREE TIERS, EXACTLY AS ASKED FOR.
  --
  --   yes everyone can see open deals but only sales/bd/md/dev roles
  --   can see the value of those deals [...] others just see there's a
  --   lead and what the lead is for but cannot click in to it. Only
  --   people with access to click in to that lead are able to
  -- ---------------------------------------------------------
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Dawson Group Ltd', cust, mate, mate, 'rental', 'quoted', 7000);

  SET LOCAL ROLE authenticated;

  -- A rep SEES the colleague's deal now. It is on their customer.
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF NOT EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE owner_id = mate) THEN
    RAISE EXCEPTION 'a rep cannot see that a colleague has a deal on their customer';
  END IF;

  -- And cannot open it, because it is not theirs and they may not read
  -- other people's trackers.
  SELECT may_open INTO said FROM customer_tracker_entries(cust) WHERE owner_id = mate LIMIT 1;
  IF said::BOOLEAN THEN
    RAISE EXCEPTION 'a rep is offered a way into a colleague''s deal';
  END IF;
  SELECT may_open INTO said FROM customer_tracker_entries(cust) WHERE id = l_own;
  IF NOT said::BOOLEAN THEN
    RAISE EXCEPTION 'a rep cannot open their own deal';
  END IF;

  -- Sales holds the figures.
  SELECT estimated_value INTO n FROM customer_tracker_entries(cust) WHERE owner_id = mate LIMIT 1;
  IF n IS DISTINCT FROM 7000 THEN
    RAISE EXCEPTION 'a salesperson cannot see what the deal is worth: %', COALESCE(n::TEXT, 'nothing');
  END IF;

  -- Somebody who may see other trackers can open it.
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  SELECT may_open INTO said FROM customer_tracker_entries(cust) WHERE owner_id = mate LIMIT 1;
  IF NOT said::BOOLEAN THEN
    RAISE EXCEPTION 'somebody who may see other trackers cannot open the deal';
  END IF;

  -- And a role outside the four sees the deal and NOT the figure. The
  -- redaction is in the database, so there is nothing to blank.
  PERFORM set_config('request.jwt.claim.sub', clerk::TEXT, TRUE);
  IF NOT EXISTS (SELECT 1 FROM customer_tracker_entries(cust) WHERE owner_id = mate) THEN
    RAISE EXCEPTION 'an office administrator cannot see that a deal exists';
  END IF;
  SELECT estimated_value INTO n FROM customer_tracker_entries(cust) WHERE owner_id = mate LIMIT 1;
  IF n IS NOT NULL THEN
    RAISE EXCEPTION 'a role outside sales, BD, MD and dev was handed the value: %', n;
  END IF;
  SELECT sale_price INTO n FROM customer_tracker_entries(cust) WHERE id = l_own;
  IF n IS NOT NULL THEN
    RAISE EXCEPTION 'the agreed price reached somebody who may not see values';
  END IF;
  SELECT may_open INTO said FROM customer_tracker_entries(cust) WHERE id = l_own;
  IF said::BOOLEAN THEN
    RAISE EXCEPTION 'an office administrator is offered a way into somebody else''s deal';
  END IF;
  /* And what the deal is FOR still comes through, because that is the
     half they are meant to have. */
  IF (SELECT what IS NULL AND type IS NULL FROM customer_tracker_entries(cust) WHERE id = l_own) THEN
    RAISE EXCEPTION 'the entry came back with nothing on it to read';
  END IF;

  RESET ROLE;

  -- ---------------------------------------------------------
  -- 5. THE REPAIR BINDS THE UNAMBIGUOUS ONE AND NOTHING ELSE.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  SELECT * INTO r FROM crm_bind_orphan_leads(TRUE);
  IF r.bound < 1 THEN RAISE EXCEPTION 'the dry run found nothing to bind'; END IF;
  SELECT contact_id INTO said FROM crm_leads WHERE id = l_loose;
  IF said IS NOT NULL THEN RAISE EXCEPTION 'the DRY RUN wrote to the database'; END IF;

  SELECT * INTO r FROM crm_bind_orphan_leads(FALSE);
  IF r.bound < 1 THEN RAISE EXCEPTION 'the repair bound nothing'; END IF;
  IF (SELECT contact_id FROM crm_leads WHERE id = l_loose) <> cust THEN
    RAISE EXCEPTION 'the loose deal was not attached to its customer';
  END IF;

  -- The one with no customer at all is left alone, not invented.
  IF (SELECT contact_id FROM crm_leads WHERE id = l_other) IS NOT NULL THEN
    RAISE EXCEPTION 'a deal with no matching customer was attached to one anyway';
  END IF;

  -- And running it again binds nothing.
  SELECT * INTO r FROM crm_bind_orphan_leads(FALSE);
  IF r.bound <> 0 THEN RAISE EXCEPTION 'a second run bound % more', r.bound; END IF;

  RAISE NOTICE 'tracker entries: found by record, merge, twin and name, with the trailer and the contract on them';
END $check$;

ROLLBACK;
