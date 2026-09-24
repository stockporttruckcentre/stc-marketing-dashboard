-- =============================================================
-- One record per company. Migration 157.
--
-- Run as `authenticated` wherever a policy or a capability is in
-- question, because the owner of the database bypasses row level
-- security and a check that runs as the owner proves nothing.
--
-- Run with `npm run check:duplicates`.
--
-- ---- What this is for ----
--
-- Every duplicate check this codebase had before 157 was of the form
-- "does this look like a match", written by the same person who then
-- judged whether it matched. All three passed while the CRM filled up
-- with second records. So this asserts OUTCOMES: a row goes in or it
-- does not, and the count afterwards is the evidence.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

-- =============================================================
-- PART 1. The folds, on their own. No database state involved.
-- =============================================================
DO $words$
DECLARE
  cases TEXT[][] := ARRAY[
    ['A.C.S. Construction',                 'acs construction'],
    ['ACS Construction',                    'acs construction'],
    ['A C Transport Ltd',                   'ac transport'],
    ['AC Group',                            'ac'],
    ['J Smith',                             'j smith'],
    ['R. T. Page & Sons Ltd',               'rt page sons'],
    ['RT Page',                             'rt page'],
    ['RICHARDSON''S COMMERCIALS',           'richardsons commercials'],
    ['Richardsons',                         'richardsons'],
    ['Stotts Tours Oldham',                 'stotts tours oldham'],
    ['Biffa Waste Services Ltd',            'biffa waste'],
    ['Transport Holdings UK Limited',       'transport'],
    ['The Booker Group',                    'booker'],
    ['Hartley Haulage ( Sheffield ) LTD',   'hartley haulage'],
    ['S Bannerman T/A JME Transport Limited','s bannerman']
  ];
  i INT;
  got TEXT;
BEGIN
  FOR i IN 1 .. array_length(cases, 1) LOOP
    got := company_words(cases[i][1]);
    IF got IS DISTINCT FROM cases[i][2] THEN
      RAISE EXCEPTION 'company_words(%) is "%" and should be "%"', cases[i][1], got, cases[i][2];
    END IF;
  END LOOP;

  /* A name that is nothing but a suffix folds to nothing, so that it
     cannot become the key "ltd" and match every badly typed record at
     once. */
  IF company_words('Ltd') IS NOT NULL THEN RAISE EXCEPTION '"Ltd" folded to a company name'; END IF;
  IF company_key('Limited') IS NOT NULL THEN RAISE EXCEPTION '"Limited" folded to a company key'; END IF;
  IF company_words('   ') IS NOT NULL THEN RAISE EXCEPTION 'whitespace folded to a company name'; END IF;
  IF company_words(NULL) IS NOT NULL THEN RAISE EXCEPTION 'NULL folded to a company name'; END IF;

  IF phone_key('0161 483 0000') <> '01614830000' THEN RAISE EXCEPTION 'a spaced phone number did not fold'; END IF;
  IF phone_key('+44 161 483 0000') <> '01614830000' THEN RAISE EXCEPTION 'an international phone number did not fold'; END IF;
  IF phone_key('  ') IS NOT NULL THEN RAISE EXCEPTION 'blank folded to a phone number'; END IF;
  IF email_key('  Bob@STC.co.uk ') <> 'bob@stc.co.uk' THEN RAISE EXCEPTION 'an email did not fold'; END IF;
END $words$;

-- =============================================================
-- PART 2. How two names are related, against every pair that really
-- exists in this CRM.
--
-- The truth column is the business's own, from going through them one
-- by one. The point of listing the DIFFERENT ones is that a rule which
-- catches every duplicate by calling everything a duplicate is not a
-- rule, and only the second half of this table can show that.
-- =============================================================
DO $pairs$
DECLARE
  /* Pairs that ARE one company. Every one must come back with a
     relationship, whatever kind. A NULL here is a duplicate this
     engine would let through. */
  same TEXT[][] := ARRAY[
    ['Dillion Whittle',                          'Dillion Whitle'],
    ['Caddow Wood Forestry and Farming Ltd',      'Cadowood Forestry & Farming Ltd'],
    ['Byrne Civil Solutions Ltd',                 'Byrne Civil Solutons Limited'],
    ['Boels Rental Limited',                      'Boels rentals ltd'],
    ['M Markovitz Limited',                       'Markovitz Ltd'],
    ['TIP Trailer Services UK Ltd',               'TIP Trailers'],
    ['Stotts Tours Oldham',                       'STOTTS TOURS'],
    ['Biffa',                                     'Biffa Waste Services Ltd'],
    ['BIFFA MUNICIPAL LTD',                       'Biffa Municipal Limited'],
    ['RICHARDSON''S COMMERCIALS',                 'Richardsons'],
    ['RT Page',                                   'R. T. Page & Sons Ltd'],
    ['VJ Donegan Plant Limited',                  'VJ Donegan'],
    ['Hippo Waste Management',                    'Hippo Waste'],
    ['Newland Express',                           'Newland Express Transport Limited'],
    ['Greif Delta Containers Manchester Limited', 'Greif Delta Containers Limited'],
    ['MRK Transport Limited',                     'MRK Transportation Ltd'],
    ['D Butterworth',                             'Dave Butterworth'],
    ['Stagecoach',                                'Stagecoach Services Ltd'],
    ['Wincanton',                                 'Wincanton Holdings Operations'],
    ['KNDS UK',                                   'KNDS Defence UK Limited'],
    ['Tameside council PFA',                      'Tameside Council'],
    ['Bay Freight PFA Acct',                      'Bay Freight Limited'],
    ['John Sutch',                                'JOHN SUTCH CRANES LTD'],
    ['Holman',                                    'Holman Fleet Limited'],
    ['Oak Tyres UK  Limited',                     'Oak Tyres UK Limited'],
    ['A.C.S. Construction',                       'ACS Construction'],
    ['Hartley Haulage (Sheffield) Ltd',           'Hartley Haulage ( Sheffield ) LTD'],
    ['K & H Bakewell Ltd',                        'K&H Bakewell Ltd'],
    ['K4 Transport',                              'K4TRANSPORT'],
    ['Island Express Limited',                    'Island Express Ltd']
  ];
  /* Pairs that are NOT one company, and which no name rule may claim
     outright. These are allowed to come back as `similar`, because a
     name cannot tell them apart and being asked once is the design.
     What they may NEVER come back as is `exact`. */
  apart TEXT[][] := ARRAY[
    ['A.M Transport',        'ABM Transport'],
    ['JS Transport',         'K.J.S. Transport Services Ltd'],
    ['RBC Logistics Ltd',    'KBC Logistics Limited'],
    ['GEM LOGISTICS LTD',    'GEB Logistics'],
    ['JK COMMERCIALS',       'G&K Commercials Ltd']
  ];
  /* And pairs that must come back with NOTHING AT ALL. A person who is
     asked about these has been asked a stupid question, and a person
     asked enough stupid questions presses through the real one. */
  quiet TEXT[][] := ARRAY[
    ['AC Group',                'A C Transport Ltd'],
    ['AC Group',                'Acrolift Limited'],
    ['AC Group',                'Access Equipment Logistics Limited'],
    ['AC Group',                'Acceleration Services'],
    ['AC Group',                'ACP SERVICES LTD'],
    ['S+B UK Ltd',              'S Bannerman T/A JME Transport Limited'],
    ['Cad Services Limited',    'Cadowood Forestry & Farming Ltd'],
    ['J and U Services',        'Just Chill Social Limited'],
    ['Thomas''s Group Ltd',     'Thomas Storey Fabrications Limited'],
    ['S&D Leisure (Europe) Ltd','SD Group Ltd'],
    ['Ace movements',           'AC Group'],
    ['Dennison Trailers',       'Bay Freight Limited'],
    ['Wincanton',               'Stagecoach']
  ];
  i INT; got TEXT;
BEGIN
  FOR i IN 1 .. array_length(same, 1) LOOP
    got := name_relationship(same[i][1], same[i][2]);
    IF got IS NULL THEN
      RAISE EXCEPTION 'a real duplicate would go straight in: "%" against "%"', same[i][1], same[i][2];
    END IF;
    /* And the other way round, because the order two names arrive in
       is whichever of them somebody typed second. */
    IF name_relationship(same[i][2], same[i][1]) IS DISTINCT FROM got THEN
      RAISE EXCEPTION 'the answer changed when the two names were swapped: "%" and "%"',
        same[i][1], same[i][2];
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(apart, 1) LOOP
    got := name_relationship(apart[i][1], apart[i][2]);
    IF got = 'exact' THEN
      RAISE EXCEPTION 'two different firms were called the same name: "%" and "%"',
        apart[i][1], apart[i][2];
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(quiet, 1) LOOP
    got := name_relationship(quiet[i][1], quiet[i][2]);
    IF got IS NOT NULL THEN
      RAISE EXCEPTION 'somebody would be asked about "%" and "%", which is noise (%)',
        quiet[i][1], quiet[i][2], got;
    END IF;
  END LOOP;
END $pairs$;

-- =============================================================
-- PART 3. The ladder, with real records and real account codes.
-- =============================================================
DO $seed$
DECLARE
  boss UUID := 'dbde0000-0000-0000-0000-0000000000a1';
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'dupe-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'dupe-boss@stc.example', 'Dee Boss', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
  /* Said again after the conflict clause, and asserted, because the
     legacy `role` column is what the CRM's own insert policy reads and
     a seed that quietly left it at `viewer` made every refusal below
     pass for the wrong reason. */
  UPDATE profiles SET role = 'admin' WHERE id = boss;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='administrator')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  DELETE FROM view_as_sessions;

  /* Owned by the seeded user, so the records put on it are ones that
     user can read and edit. A list nobody can see makes every UPDATE
     below affect no rows, and an update that changes nothing raises
     nothing, which would let a refusal pass without ever running. */
  INSERT INTO crm_lists (id, name, is_global, owner_id)
  VALUES ('dbde0000-0000-0000-0000-00000000f1f1', 'Duplicate Test List', FALSE, boss)
  ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

  IF (SELECT role FROM profiles WHERE id = boss) <> 'admin' THEN
    RAISE EXCEPTION 'the seeded user is not an admin, so nothing below would prove anything';
  END IF;
END $seed$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_contacts, crm_leads, crm_list_contacts TO authenticated;
GRANT SELECT ON crm_duplicate_decisions, protean_accounts, protean_cash_sites, protean_invoices TO authenticated;

SET ROLE authenticated;
DO $ladder$
DECLARE
  boss  UUID := 'dbde0000-0000-0000-0000-0000000000a1';
  list  UUID := 'dbde0000-0000-0000-0000-00000000f1f1';
  rbc   UUID;
  kbc   UUID;
  stott UUID;
  n     INT;
  v     TEXT;
  got   RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  /* `auth.role()` reads this, and the CRM's select policy tests it.
     Without it every UPDATE below matches no row, and an update that
     changes nothing raises nothing, so a refusal would pass without
     ever having run. */
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);

  -- ---------------------------------------------------------
  -- 3a. A first record goes in with nothing in its way.
  -- ---------------------------------------------------------
  SELECT decision, contact_id INTO v, stott
    FROM crm_contact_create('Stotts Tours', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'created' THEN RAISE EXCEPTION 'the first record answered %, not created', v; END IF;
  IF stott IS NULL THEN RAISE EXCEPTION 'the first record was not returned'; END IF;

  -- ---------------------------------------------------------
  -- 3b. THE STOTTS CASE. "Stotts Tours Oldham" against "Stotts Tours".
  --
  -- This is the exact pair that produced two records in the live CRM.
  -- Every matcher the application had before 157 let it through.
  -- ---------------------------------------------------------
  SELECT decision INTO v
    FROM crm_contact_create('Stotts Tours Oldham', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'confirm' THEN
    RAISE EXCEPTION 'Stotts Tours Oldham answered % beside Stotts Tours, so the pair that broke the CRM still goes in', v;
  END IF;

  PERFORM set_config('stc.dupe_stott', stott::TEXT, FALSE);

  -- ---------------------------------------------------------
  -- 3c. THE BIFFA CASE. A shorter name inside a longer one.
  -- ---------------------------------------------------------
  SELECT decision INTO v
    FROM crm_contact_create('Biffa Waste Services Ltd', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'created' THEN RAISE EXCEPTION 'Biffa Waste Services could not be created at all (%)', v; END IF;

  SELECT decision INTO v
    FROM crm_contact_create('Biffa', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'confirm' THEN
    RAISE EXCEPTION 'Biffa answered % beside Biffa Waste Services Ltd', v;
  END IF;

  -- ---------------------------------------------------------
  -- 3d. An exact fold is JOINED, not asked about and not duplicated.
  -- ---------------------------------------------------------
  SELECT decision, contact_id INTO v, kbc
    FROM crm_contact_create('BIFFA WASTE SERVICES LIMITED', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'joined' THEN
    RAISE EXCEPTION 'the same name in capitals answered %, not joined', v;
  END IF;


  -- ---------------------------------------------------------
  -- 3e. Confirming they are different lets it through, once, forever.
  -- ---------------------------------------------------------
  SELECT decision, contact_id INTO v, rbc
    FROM crm_contact_create('RBC Logistics Ltd', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'created' THEN RAISE EXCEPTION 'RBC Logistics answered %', v; END IF;

  SELECT decision INTO v
    FROM crm_contact_create('KBC Logistics Limited', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list);
  IF v <> 'confirm' THEN RAISE EXCEPTION 'KBC Logistics answered % beside RBC Logistics', v; END IF;

  SELECT decision, contact_id INTO v, kbc
    FROM crm_contact_create('KBC Logistics Limited', NULL, NULL, NULL, NULL, 'existing', 'test', NULL, list,
                            ARRAY[rbc]);
  IF v <> 'created' THEN RAISE EXCEPTION 'KBC Logistics answered % after being confirmed different', v; END IF;

  -- And the question is never asked again, for anybody.
  SELECT count(*) INTO n
    FROM crm_identity_candidates('KBC Logistics Ltd', NULL, NULL, '[]'::JSONB, kbc) c
   WHERE c.verdict = 'maybe' AND NOT c.settled;
  IF n <> 0 THEN RAISE EXCEPTION 'the same question is still being asked after it was answered'; END IF;

  PERFORM set_config('stc.dupe_rbc', rbc::TEXT, FALSE);
  PERFORM set_config('stc.dupe_kbc', kbc::TEXT, FALSE);
END $ladder$;
RESET ROLE;

/* Protean's own rows, put there by the owner because who may write them
   is a different check (`npm run check:protean`). */
DO $accounts$
DECLARE
  rbc UUID := current_setting('stc.dupe_rbc')::UUID;
  kbc UUID := current_setting('stc.dupe_kbc')::UUID;
BEGIN
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, is_invoicing_type)
  VALUES ('stc', 'RBCLOGIS', 'RBC Logistics Ltd',     rbc, FALSE),
         ('stc', 'KBCLOGIS', 'KBC Logistics Limited', kbc, FALSE),
         ('stc', 'CASHSALE', 'Cash Sale',             rbc, TRUE);
END $accounts$;

SET ROLE authenticated;
DO $alphas$
DECLARE
  boss UUID := 'dbde0000-0000-0000-0000-0000000000a1';
  rbc  UUID := current_setting('stc.dupe_rbc')::UUID;
  kbc  UUID := current_setting('stc.dupe_kbc')::UUID;
  n    INT;
  v    TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  /* `auth.role()` reads this, and the CRM's select policy tests it.
     Without it every UPDATE below matches no row, and an update that
     changes nothing raises nothing, so a refusal would pass without
     ever having run. */
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);

  -- ---------------------------------------------------------
  -- 3f. THE ALPHA OUTRANKS THE NAME, BOTH WAYS.
  -- ---------------------------------------------------------
  -- Sharing the code is proof of the same account, whatever the name says.
  SELECT verdict INTO v FROM crm_identity_candidates(
    'Something Else Entirely Ltd', NULL, NULL,
    '[{"division":"stc","alpha":"RBCLOGIS"}]'::JSONB, NULL) c
   WHERE c.contact_id = rbc;
  IF v IS DISTINCT FROM 'same' THEN
    RAISE EXCEPTION 'two records on one Protean account did not read as the same account (%)', v;
  END IF;

  -- Holding a different code in the same division is proof they are not.
  SELECT verdict INTO v FROM crm_identity_candidates(
    'RBC Logistics Ltd', NULL, NULL,
    '[{"division":"stc","alpha":"KBCLOGIS"}]'::JSONB, NULL) c
   WHERE c.contact_id = rbc;
  IF v IS DISTINCT FROM 'different' THEN
    RAISE EXCEPTION 'two different Protean accounts still read as % on the name', v;
  END IF;

  -- ---------------------------------------------------------
  -- 3g. AN INVOICING TYPE IS NOT AN IDENTITY.
  --
  -- CASHSALE carries 2,607 invoices in the live system. If it counted,
  -- every cash customer in the business would be one company.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM contact_identity_alphas(rbc);
  IF n <> 1 THEN
    RAISE EXCEPTION 'an invoicing type is being read as identity: % codes on the record', n;
  END IF;

  SELECT count(*) INTO n FROM crm_identity_candidates(
    'A Totally Unrelated Haulier Ltd', NULL, NULL,
    '[{"division":"stc","alpha":"CASHSALE"}]'::JSONB, NULL) c
   WHERE c.verdict = 'same';
  IF n <> 0 THEN
    RAISE EXCEPTION 'paying by cash made % records the same company', n;
  END IF;
END $alphas$;
RESET ROLE;

-- -------------------------------------------------------------
-- What the ladder actually left behind, counted by the owner.
--
-- Read here rather than inside the blocks above, because the CRM's own
-- policy only shows a record to somebody who can see a list it is on,
-- and that is a different subject from this one. The WRITES above all
-- ran as `authenticated`, which is the half that matters.
-- -------------------------------------------------------------
DO $counted$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_name = 'Stotts Tours Oldham';
  IF n <> 0 THEN RAISE EXCEPTION 'asking for confirmation wrote a record anyway'; END IF;

  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_key(company_name) = company_key('Biffa Waste Services Ltd');
  IF n <> 1 THEN RAISE EXCEPTION 'there are % Biffa Waste records and there should be one', n; END IF;

  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_key(company_name) = company_key('Stotts Tours');
  IF n <> 1 THEN RAISE EXCEPTION 'there are % Stotts records and there should be one', n; END IF;

  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_name IN ('RBC Logistics Ltd', 'KBC Logistics Limited');
  IF n <> 2 THEN
    RAISE EXCEPTION 'two firms confirmed as different came out as % records', n;
  END IF;

  SELECT count(*) INTO n FROM crm_duplicate_decisions;
  IF n <> 1 THEN RAISE EXCEPTION 'the answer was not written down: % decisions', n; END IF;
END $counted$;

-- =============================================================
-- PART 4. The refusal on the table, which is what makes it an engine
-- rather than a suggestion.
--
-- Every one of these is a path that existed and wrote a duplicate
-- before 157: the grid's own insert, an API route, a database function,
-- somebody in the SQL editor.
-- =============================================================
SET ROLE authenticated;
DO $refuse$
DECLARE
  boss UUID := 'dbde0000-0000-0000-0000-0000000000a1';
  n    INT;
  rbc  UUID := current_setting('stc.dupe_rbc')::UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  /* `auth.role()` reads this, and the CRM's select policy tests it.
     Without it every UPDATE below matches no row, and an update that
     changes nothing raises nothing, so a refusal would pass without
     ever having run. */
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  /* If this user cannot insert at all, every refusal below passes for
     the wrong reason and the check is worthless. */
  IF current_role_safe() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'this user reads as "%" and cannot write to the CRM, so no refusal below proves anything',
      current_role_safe();
  END IF;
  INSERT INTO crm_contacts (company_name) VALUES ('A Firm Nothing Else Resembles Ltd');

  -- 4a. A plain INSERT, the way the CRM grid does it.
  BEGIN
    INSERT INTO crm_contacts (company_name) VALUES ('Biffa Waste Services Limited');
    RAISE EXCEPTION 'a plain insert made a second Biffa';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4b. Different capitals and punctuation, which is how they arrive.
  BEGIN
    INSERT INTO crm_contacts (company_name) VALUES ('  biffa   waste  services,  ltd. ');
    RAISE EXCEPTION 'punctuation and spacing got a second Biffa in';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4c. A near match with nobody having said anything.
  BEGIN
    INSERT INTO crm_contacts (company_name) VALUES ('Stotts Tours Oldham');
    RAISE EXCEPTION 'a near duplicate went in with nobody asked';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4d. A multi row INSERT, which is one statement and must not slip past.
  BEGIN
    INSERT INTO crm_contacts (company_name)
    VALUES ('Totally New Haulage Ltd'), ('Biffa Waste Services Co');
    RAISE EXCEPTION 'a multi row insert carried a duplicate in beside a new record';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4e. Renaming an existing record ONTO another one.
  --
  -- An UPDATE that matches no row raises nothing, so the row has to be
  -- one this user can actually reach before the refusal means anything.
  UPDATE crm_contacts SET phone = '0161 111 1111' WHERE id = rbc;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the record being renamed is not reachable, so the refusal below would prove nothing';
  END IF;
  BEGIN
    UPDATE crm_contacts SET company_name = 'Biffa Waste Services Ltd' WHERE id = rbc;
    RAISE EXCEPTION 'a record was renamed on top of another one';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4f. But an ordinary edit is not blocked. The CRM holds 30 pairs put
  -- there before any of this, and making them uneditable would make
  -- them permanent.
  UPDATE crm_contacts SET phone = '0161 483 0000' WHERE id = rbc;
  UPDATE crm_contacts SET company_name = 'RBC Logistics Ltd' WHERE id = rbc;

  -- 4g. A name that is not a name.
  BEGIN
    INSERT INTO crm_contacts (company_name) VALUES ('Ltd');
    RAISE EXCEPTION '"Ltd" was accepted as a company';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%was accepted as a company' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO crm_contacts (company_name) VALUES ('   ');
    RAISE EXCEPTION 'whitespace was accepted as a company';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%was accepted as a company' THEN RAISE; END IF;
  END;

  -- 4h. The same email on two records is one company, whatever the
  -- names say.
  INSERT INTO crm_contacts (company_name, email) VALUES ('Alpha Freight Ltd', 'ops@alphafreight.co.uk');
  BEGIN
    INSERT INTO crm_contacts (company_name, email) VALUES ('Omega Distribution Ltd', 'OPS@AlphaFreight.co.uk');
    RAISE EXCEPTION 'two records went in on one email address';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $refuse$;
RESET ROLE;

DO $after_refusals$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_name = 'Totally New Haulage Ltd';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a refused multi row insert wrote its other row anyway';
  END IF;

  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND company_key(company_name) = company_key('Biffa Waste Services Ltd');
  IF n <> 1 THEN
    RAISE EXCEPTION 'after every bypass attempt there are % Biffa records', n;
  END IF;

  SELECT count(*) INTO n FROM crm_contacts
   WHERE deleted_at IS NULL AND email_key(email) = 'ops@alphafreight.co.uk';
  IF n <> 1 THEN
    RAISE EXCEPTION '% records share one email address', n;
  END IF;
END $after_refusals$;

ROLLBACK;
