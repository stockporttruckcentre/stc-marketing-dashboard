-- =============================================================
-- Filling the CRM in from somebody else's file.
--
-- From the business:
--
--   Any customers on the attached that are not on the crm should not
--   import as new accounts, only update existing records. The name
--   might not be a 1:1 match from the attached to the crm and it needs
--   to get around that without mistake.
--
-- "Without mistake" is the requirement, and a mistake here is silent:
-- the wrong company gets somebody else's phone number and nothing looks
-- wrong until a salesperson rings it. So every case below is a case
-- where a plausible implementation gets it wrong, and every fixture
-- name is taken from the real file.
--
--   1. THE ACCOUNT CODE WINS. Somebody bound that code to that record
--      by looking at both. A name heuristic must never overrule it.
--   2. NOTHING IS CREATED. A company on the file and not in the CRM is
--      left alone, in as many words.
--   3. NOTHING IS OVERWRITTEN. A record with a phone number keeps it.
--   4. AN AMBIGUOUS NAME IS REFUSED, on either side. Two CRM records
--      with the same normalised name, or a name appearing twice in the
--      file, and the answer is to report rather than pick.
--   5. ONE CUSTOMER, TWO ACCOUNT CODES. Normal, and not a
--      contradiction. Ipsum is IPSUM in Chorley and IPSUM01 in Glasgow,
--      both bound to one record. The first version called that "two
--      rows disagree" and refused everything for that customer,
--      including the email only one row had. Reported by the business:
--      "if you're doing a direct alpha match what's the confusion? ...
--      It didn't put the address in. One of many".
--   6. A NAME THAT IS ONLY A SUFFIX IS NOT A NAME. "Ltd" must not
--      become a key that matches half the CRM.
--
-- Run with `npm run check:enrichment`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

/* -------------------------------------------------------------
   No function writes without saying which rows.

   Supabase preloads `pg_safeupdate`, which refuses any DELETE or UPDATE
   with no WHERE clause and says "DELETE requires a WHERE clause". The
   disposable Postgres here does not have it, and that difference let a
   bare `DELETE FROM _enrich;` through every check in this file and fail
   on the first real press of Apply.

   The extension cannot be installed here, so the rule is asserted
   statically instead, over every function this application owns rather
   than only the two this file is about. A check that runs under looser
   rules than production passes for the wrong reason, and the fix is to
   stop it passing rather than to remember harder.
   ------------------------------------------------------------- */
/* Comments off first. This very check is explained inside
   `crm_apply_enrichment` and the explanation quotes the bad statement,
   so a scan of the raw source fails on the note describing the fix.
   The screen capability check hit the same trap and solves it the same
   way. */
CREATE OR REPLACE FUNCTION pg_temp.body(p_src TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $fn$
  SELECT regexp_replace(
           regexp_replace(p_src, '/\*.*?\*/', ' ', 'g'),
           '--[^' || chr(10) || ']*', ' ', 'g')
$fn$;

DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(x.proname, ', ' ORDER BY x.proname) INTO bad
    FROM (
      SELECT p.proname, pg_temp.body(p.prosrc) AS src
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
    ) x
     /* `DELETE FROM something;` with nothing between the table and the
        semicolon. The only form that matters, and the only one a regex
        over a function body can call with confidence. */
   WHERE x.src ~* '\mDELETE\s+FROM\s+[a-z_][a-z0-9_.]*\s*;';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  these delete without a WHERE and Supabase will refuse them: %', bad;
  END IF;

  SELECT string_agg(x.proname, ', ' ORDER BY x.proname) INTO bad
    FROM (
      SELECT p.proname, pg_temp.body(p.prosrc) AS src
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
    ) x
     /* `UPDATE something SET ... ;` with no WHERE anywhere in it. The
        SET clause may span lines, so the class runs to the terminator,
        and a WHERE inside it lets the statement through. */
   WHERE x.src ~* '\mUPDATE\s+[a-z_][a-z0-9_.]*\s+SET\s+[^;]*;'
     AND x.src !~* '\mUPDATE\s+[a-z_][a-z0-9_.]*\s+SET\s+[^;]*\yWHERE\y[^;]*;';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  these update without a WHERE and Supabase will refuse them: %', bad;
  END IF;

  RAISE NOTICE 'ok    no function writes without saying which rows, which Supabase refuses';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

/* An administrator, so `crm.import` answers yes. The permission itself
   is proved at the end, as somebody who does not hold it. */
DO $$
DECLARE boss UUID;
BEGIN
  SELECT id INTO boss FROM profiles WHERE role = 'admin' LIMIT 1;
  IF boss IS NULL THEN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'check.boss@stc-uk.test', 'x',
            NOW(), NOW(), NOW(), '{}'::JSONB, '{}'::JSONB)
    RETURNING id INTO boss;
    INSERT INTO profiles (id, email, full_name, role)
    VALUES (boss, 'check.boss@stc-uk.test', 'Check Boss', 'admin');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END $$;

-- =============================================================
-- The normalising, on its own, before any matching.
-- =============================================================
DO $$
BEGIN
  PERFORM pg_temp.must('brackets are not part of a name',
    company_key('A&A Scaffolding Group Limited (PRE FUNDED)') = company_key('A & A Scaffolding'));

  PERFORM pg_temp.must('nor is a company suffix, however many are stacked up',
    company_key('Wilson Transport Holdings UK Limited') = company_key('Wilson Transport'));

  PERFORM pg_temp.must('"and" and "&" are the same word',
    company_key('Charles and Ivy') = company_key('Charles & Ivy'));

  PERFORM pg_temp.must('punctuation and case are not part of a name',
    company_key('A.C.S. CONSTRUCTION GROUP LTD') = company_key('ACS Construction Group Ltd'));

  PERFORM pg_temp.must('a leading "the" is not part of a name',
    company_key('The Booker Group Ltd') = company_key('Booker'));

  PERFORM pg_temp.must('a trading name after t/a is not the legal entity',
    company_key('Smith Haulage Ltd t/a Speedy Freight') = company_key('Smith Haulage'));

  PERFORM pg_temp.must('a name that is nothing but a suffix is not a name',
    company_key('Ltd') IS NULL AND company_key('The') IS NULL);

  /* And the half that matters more: two DIFFERENT companies must not
     collide. A normaliser that strips too much is worse than one that
     strips too little, because too little only misses a match. */
  PERFORM pg_temp.must('two different hauliers do not collide',
    company_key('Wilson Transport Ltd') <> company_key('Wilsons Transport Ltd'));
  PERFORM pg_temp.must('nor do a father and son firm and an unrelated one',
    company_key('J Fox & Sons Ltd') <> company_key('D Fox & Sons Ltd'));
END $$;

-- =============================================================
-- The matching.
-- =============================================================
DO $$
DECLARE
  booker    UUID;
  amphorea1 UUID;
  amphorea2 UUID;
  fox       UUID;
  acs       UUID;
  dummy     UUID;
  plan      RECORD;
  said      JSONB;
  done      JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);

  /* The CRM as it stands. Deliberately messy, because the real one is. */
  INSERT INTO crm_contacts (company_name, phone)
  VALUES ('Booker Limited', '01942 000000') RETURNING id INTO booker;

  /* Two records that normalise to the same thing, which is the case a
     name match must refuse rather than guess between. */
  INSERT INTO crm_contacts (company_name) VALUES ('Amphorea Packaging Ltd')
  RETURNING id INTO amphorea1;
  INSERT INTO crm_contacts (company_name) VALUES ('Amphorea Packaging')
  RETURNING id INTO amphorea2;

  INSERT INTO crm_contacts (company_name) VALUES ('David Fox Haulage Ltd')
  RETURNING id INTO fox;

  INSERT INTO crm_contacts (company_name) VALUES ('A.C.S. Construction Group')
  RETURNING id INTO acs;

  INSERT INTO crm_contacts (company_name) VALUES ('Dummy Mail Transport Ltd')
  RETURNING id INTO dummy;

  /* The account code, bound by a person. Note the names DISAGREE: the
     whole point of the code is that it does not care. */
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
  VALUES ('stc', 'BOOKER', 'Booker', booker),
         ('stc', 'BOOKERLIM', 'Booker Limited', booker)
  ON CONFLICT (division, alpha) DO UPDATE SET contact_id = EXCLUDED.contact_id;

  /* An account nobody has bound, so its row falls through to the name. */
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
  VALUES ('stc', 'ACSCON', 'ACS Construction Group Ltd', NULL)
  ON CONFLICT (division, alpha) DO UPDATE SET contact_id = NULL;

  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::TEXT FROM profiles WHERE role = 'admin' LIMIT 1), TRUE);

  said := jsonb_build_array(
    /* 1. Matched on the code, and the names do not agree. */
    jsonb_build_object('alpha', 'BOOKER', 'name', 'Booker',
      'email', 'transport@booker.co.uk', 'phone', '01933 371000',
      'address', 'Equity House, Irthlingborough, NN9 5QG'),
    /* 2. Matched on the name, because nobody bound the code. */
    jsonb_build_object('alpha', 'ACSCON', 'name', 'ACS Construction Group Ltd',
      'email', '', 'phone', '0161 486 6300',
      'address', 'Unit 11 Oak Green, Cheadle, SK8 6QL'),
    /* 3. Two CRM records normalise to this. Refused. */
    jsonb_build_object('alpha', 'AMPHOREA', 'name', 'Amphorea Packaging Ltd',
      'email', 'sales@amphorea.test', 'phone', '', 'address', 'Somewhere'),
    /* 4. Not in the CRM at all. Must not be created. */
    jsonb_build_object('alpha', 'NOTHERE1', 'name', 'A Company We Have Never Billed Ltd',
      'email', 'hello@nothere.test', 'phone', '01234 567890', 'address', 'Nowhere'),
    /* 5 and 6. The same name twice in the file, which is what "DAVID
       FOX" and "CASH SALE" do in the real one. Both refused. */
    jsonb_build_object('alpha', 'DFOX1', 'name', 'David Fox Haulage',
      'email', 'one@fox.test', 'phone', '', 'address', 'Yard One'),
    jsonb_build_object('alpha', 'DFOX2', 'name', 'David Fox Haulage',
      'email', 'two@fox.test', 'phone', '', 'address', 'Yard Two'),
    /* 7. A name that is nothing but a suffix. */
    jsonb_build_object('alpha', 'JUSTLTD', 'name', 'Ltd',
      'email', 'x@x.test', 'phone', '', 'address', 'Anywhere'),
    /* 8. A row carrying nothing worth having. */
    jsonb_build_object('alpha', 'BOOKERLIM', 'name', 'Booker Limited',
      'email', '', 'phone', '', 'address', ''),
    /* 9. An email that is not an email. The field is dropped, the row
          is still used for the rest. */
    jsonb_build_object('alpha', 'DUMMYMAIL', 'name', 'Dummy Mail Transport',
      'email', 'no email on file', 'phone', '0161 111 2222', 'address', '')
  );

  -- ---- 1. the code wins, and the names disagreeing does not matter ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'BOOKER';
  PERFORM pg_temp.must('the account code matches a record whose name does not agree',
    plan.contact_id = booker AND plan.matched_by = 'account code');
  PERFORM pg_temp.must('and it fills the email and the address',
    plan.fill_email = 'transport@booker.co.uk' AND plan.fill_address IS NOT NULL);
  PERFORM pg_temp.must('and leaves the phone number that is already there alone',
    plan.fill_phone IS NULL AND plan.verdict = 'fill');

  -- ---- 2. the name, where nobody has bound the code ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'ACSCON';
  PERFORM pg_temp.must('an unbound account falls through to the name',
    plan.contact_id = acs AND plan.matched_by = 'name' AND plan.verdict = 'fill');

  -- ---- 3. an ambiguous name is refused ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'AMPHOREA';
  PERFORM pg_temp.must('a name matching two CRM records is refused, not guessed',
    plan.contact_id IS NULL AND plan.verdict = 'ambiguous name');

  -- ---- 4. nothing is created ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'NOTHERE1';
  PERFORM pg_temp.must('a company we do not have is reported and not created',
    plan.contact_id IS NULL AND plan.verdict = 'no match');

  -- ---- 5. a name twice in the file is refused, both times ----
  PERFORM pg_temp.must('a name appearing twice in the file is refused on both rows',
    (SELECT count(*) FROM crm_enrichment_plan(said) p
      WHERE p.alpha IN ('DFOX1', 'DFOX2') AND p.verdict = 'name twice') = 2);

  -- ---- 6. a suffix is not a name ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'JUSTLTD';
  PERFORM pg_temp.must('a name that is only a company suffix matches nothing',
    plan.contact_id IS NULL);

  -- ---- 7. Booker's second account code ----
  /* BOOKERLIM is Booker's other Protean account and carries nothing. It
     used to read "file has nothing"; now it reads as what it is, the
     second row for a customer another row speaks for. Both are true and
     the second is the more useful thing to see when looking for why a
     line did not fill. */
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'BOOKERLIM';
  PERFORM pg_temp.must('a second account code on a customer says which it is',
    plan.contact_id = booker AND plan.verdict = 'same customer as another row');

  /* And a customer with ONE account code and an empty row still says
     the file had nothing for it, which is a different fact. */
  DECLARE
    quiet UUID;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    INSERT INTO crm_contacts (company_name) VALUES ('Quiet Haulage Ltd') RETURNING id INTO quiet;
    INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
    VALUES ('stc', 'QUIETHAU', 'Quiet Haulage Ltd', quiet)
    ON CONFLICT (division, alpha) DO UPDATE SET contact_id = EXCLUDED.contact_id;
    PERFORM set_config('request.jwt.claim.sub',
      (SELECT id::TEXT FROM profiles WHERE role = 'admin' LIMIT 1), TRUE);

    SELECT * INTO plan FROM crm_enrichment_plan(jsonb_build_array(
      jsonb_build_object('alpha', 'QUIETHAU', 'name', 'Quiet Haulage Ltd',
        'email', '', 'phone', '', 'address', ''))) p;
    PERFORM pg_temp.must('a row carrying nothing says so rather than counting as work',
      plan.contact_id = quiet AND plan.verdict = 'file has nothing');
  END;

  -- ---- 8. a field that is not what it claims ----
  SELECT * INTO plan FROM crm_enrichment_plan(said) p WHERE p.alpha = 'DUMMYMAIL';
  PERFORM pg_temp.must('"no email on file" is not an email address and is dropped',
    plan.fill_email IS NULL);

  -- ===========================================================
  -- One customer with two account codes.
  --
  -- The case that was reported, with the real names and the real
  -- addresses. Both codes bound to one record, one row carrying an
  -- email and a Chorley address, the other carrying a Glasgow one.
  --
  -- What must happen: the record is filled, the email goes in, and the
  -- address is the one from the row whose own name IS the record's
  -- name. What must NOT happen is the first version's answer, which was
  -- to refuse the lot.
  -- ===========================================================
  DECLARE
    ipsum UUID;
    two   JSONB;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    INSERT INTO crm_contacts (company_name) VALUES ('Ipsum Water England & Wales')
    RETURNING id INTO ipsum;
    INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
    VALUES ('stc', 'IPSUM',   'Ipsum Water England & Wales',    ipsum),
           ('stc', 'IPSUM01', 'Ipsum - Infrastructure Vehicle', ipsum)
    ON CONFLICT (division, alpha) DO UPDATE SET contact_id = EXCLUDED.contact_id;
    PERFORM set_config('request.jwt.claim.sub',
      (SELECT id::TEXT FROM profiles WHERE role = 'admin' LIMIT 1), TRUE);

    two := jsonb_build_array(
      jsonb_build_object('alpha', 'IPSUM', 'name', 'Ipsum Water England & Wales',
        'email', 'iwe.accounts@ipsumutilities.com', 'phone', '',
        'address', 'Rochester House, Ackhurst Business Park, Foxhole Road, Chorley, PR7 1NY'),
      jsonb_build_object('alpha', 'IPSUM01', 'name', 'Ipsum - Infrastructure Vehicle',
        'email', '', 'phone', '', 'address', '2-4 Watt Road, , Hillington, Glasgow, G52 4RR'));

    SELECT * INTO plan FROM crm_enrichment_plan(two) p WHERE p.alpha = 'IPSUM';
    PERFORM pg_temp.must('a customer with two account codes is filled, not refused',
      plan.verdict = 'fill');
    PERFORM pg_temp.must('and the address comes from the row whose name IS the record''s name',
      plan.fill_address LIKE 'Rochester House%');
    PERFORM pg_temp.must('and the email only one of the two rows had still goes in',
      plan.fill_email = 'iwe.accounts@ipsumutilities.com');

    SELECT * INTO plan FROM crm_enrichment_plan(two) p WHERE p.alpha = 'IPSUM01';
    PERFORM pg_temp.must('and the other row says why it is not the one supplying them',
      plan.verdict = 'same customer as another row' AND plan.contact_id = ipsum);

    PERFORM crm_apply_enrichment(two);
    PERFORM pg_temp.must('and applying it actually writes the Chorley address',
      (SELECT address FROM crm_contacts WHERE id = ipsum) LIKE 'Rochester House%');
    PERFORM pg_temp.must('and the email',
      (SELECT email FROM crm_contacts WHERE id = ipsum) = 'iwe.accounts@ipsumutilities.com');
  END;

  -- ===========================================================
  -- An address is a ROW, not a column.
  --
  -- `contact_addresses` is where an address lives and
  -- `crm_contacts.address` is a shadow of the primary one, maintained by
  -- `contact_addresses_sync` in one direction. Writing the shadow, which
  -- the first version did, leaves the record's Addresses panel empty and
  -- the shadow full, so the next run says "nothing to add" about an
  -- address nobody can see. Reported as: "It found ipsum and said
  -- nothing to add, but the address is missing from the crm record."
  --
  -- Three states, and the middle one is the one that must not overwrite.
  -- ===========================================================
  DECLARE
    broke UUID;
    typed UUID;
    empty UUID;
    said3 JSONB;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);

    /* a. what the broken version left: the shadow holds the file's own
          address and there is no address row. */
    INSERT INTO crm_contacts (company_name, address)
    VALUES ('Broken Shadow Ltd', 'Rochester House, Chorley, PR7 1NY') RETURNING id INTO broke;
    /* b. a hand typed address in the old field, DIFFERENT from the
          file's. Theirs, and it must survive. */
    INSERT INTO crm_contacts (company_name, address)
    VALUES ('Hand Typed Ltd', 'Old Yard, Stockport, SK1 1AA') RETURNING id INTO typed;
    /* c. nothing at all. */
    INSERT INTO crm_contacts (company_name) VALUES ('Empty Haulage Ltd') RETURNING id INTO empty;

    INSERT INTO protean_accounts (division, alpha, protean_name, contact_id)
    VALUES ('stc', 'BROKESHA', 'Broken Shadow Ltd', broke),
           ('stc', 'HANDTYPE', 'Hand Typed Ltd',    typed),
           ('stc', 'EMPTYHAU', 'Empty Haulage Ltd', empty)
    ON CONFLICT (division, alpha) DO UPDATE SET contact_id = EXCLUDED.contact_id;

    PERFORM set_config('request.jwt.claim.sub',
      (SELECT id::TEXT FROM profiles WHERE role = 'admin' LIMIT 1), TRUE);

    said3 := jsonb_build_array(
      jsonb_build_object('alpha', 'BROKESHA', 'name', 'Broken Shadow Ltd',
        'email', '', 'phone', '', 'address', 'Rochester House, Chorley, PR7 1NY', 'city', 'Chorley'),
      jsonb_build_object('alpha', 'HANDTYPE', 'name', 'Hand Typed Ltd',
        'email', '', 'phone', '', 'address', 'A DIFFERENT ADDRESS, Leeds, LS1 1AA', 'city', 'Leeds'),
      jsonb_build_object('alpha', 'EMPTYHAU', 'name', 'Empty Haulage Ltd',
        'email', '', 'phone', '', 'address', 'New Depot, Warrington, WA1 1AA', 'city', 'Warrington'));

    PERFORM crm_apply_enrichment(said3);

    PERFORM pg_temp.must('an address goes on the Addresses list, where the map reads it',
      (SELECT count(*) FROM contact_addresses a WHERE a.contact_id = empty) = 1);
    PERFORM pg_temp.must('and is the primary one, which is what sets the record''s location',
      (SELECT is_primary FROM contact_addresses a WHERE a.contact_id = empty));
    PERFORM pg_temp.must('with the city, so the map can place it even if it cannot geocode the street',
      (SELECT city FROM contact_addresses a WHERE a.contact_id = empty) = 'Warrington');
    PERFORM pg_temp.must('and no coordinates, so the map geocodes it once and keeps them',
      (SELECT lat IS NULL AND lng IS NULL FROM contact_addresses a WHERE a.contact_id = empty));

    PERFORM pg_temp.must('a record stranded on the old single field gets a proper row',
      (SELECT count(*) FROM contact_addresses a WHERE a.contact_id = broke) = 1);

    /* The one that matters most. A hand typed address is theirs. */
    PERFORM pg_temp.must('and a hand typed address is promoted, never replaced by the file',
      (SELECT address FROM contact_addresses a WHERE a.contact_id = typed) = 'Old Yard, Stockport, SK1 1AA');

    PERFORM pg_temp.must('and the shadow column follows the row rather than being written directly',
      (SELECT c.address FROM crm_contacts c WHERE c.id = typed) = 'Old Yard, Stockport, SK1 1AA');

    /* Running it again adds no second address row. */
    PERFORM crm_apply_enrichment(said3);
    PERFORM pg_temp.must('running it again does not add a second address',
      (SELECT count(*) FROM contact_addresses a WHERE a.contact_id = empty) = 1);
  END;

  -- =============================================================
  -- Applying it.
  -- =============================================================
  done := crm_apply_enrichment(said);

  PERFORM pg_temp.must('the phone number that was already there is untouched',
    (SELECT phone FROM crm_contacts WHERE id = booker) = '01942 000000');
  PERFORM pg_temp.must('and the blanks are filled',
    (SELECT email FROM crm_contacts WHERE id = booker) = 'transport@booker.co.uk');
  PERFORM pg_temp.must('the unbound account was reached by name',
    (SELECT phone FROM crm_contacts WHERE id = acs) = '0161 486 6300');

  PERFORM pg_temp.must('neither Amphorea record was touched',
    (SELECT count(*) FROM crm_contacts
      WHERE id IN (amphorea1, amphorea2) AND email IS NOT NULL) = 0);
  PERFORM pg_temp.must('and neither did the ambiguous Fox rows write anything',
    (SELECT email FROM crm_contacts WHERE id = fox) IS NULL);

  PERFORM pg_temp.must('nothing was created',
    (SELECT count(*) FROM crm_contacts
      WHERE company_name = 'A Company We Have Never Billed Ltd') = 0);

  /* Booker, ACS and the dummy mail one. Three records, and the counts
     per field are what the screen shows, so they have to be right
     rather than roughly right. */
  PERFORM pg_temp.must('and it says how many records it filled',
    (done ->> 'records')::INTEGER = 3);
  PERFORM pg_temp.must('and how many of each field',
    (done ->> 'emails')::INTEGER = 1
    AND (done ->> 'phones')::INTEGER = 2
    AND (done ->> 'addresses')::INTEGER = 2);
  PERFORM pg_temp.must('the invalid email was dropped and the phone on that row still went in',
    (SELECT email FROM crm_contacts WHERE id = dummy) IS NULL
    AND (SELECT phone FROM crm_contacts WHERE id = dummy) = '0161 111 2222');

  /* Running it again fills nothing, because there is nothing left
     blank. A file pasted twice is a file pasted twice. */
  done := crm_apply_enrichment(said);
  PERFORM pg_temp.must('running it a second time changes nothing',
    (done ->> 'emails')::INTEGER = 0 AND (done ->> 'phones')::INTEGER = 0);
END $$;

-- =============================================================
-- And it is refused to somebody who may not import.
--
-- Interface gating is a courtesy. The function is the gate.
-- =============================================================
DO $$
DECLARE reader UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'check.reader@stc-uk.test', 'x',
          NOW(), NOW(), NOW(), '{}'::JSONB, '{}'::JSONB)
  RETURNING id INTO reader;
  /* `handle_new_user` has already made the profile, so this settles the
     parts that trigger cannot know rather than making a second one. */
  INSERT INTO profiles (id, email, full_name, role, role_template_id)
  VALUES (reader, 'check.reader@stc-uk.test', 'Check Reader', 'viewer',
          (SELECT id FROM role_templates WHERE slug = 'office_admin'))
  ON CONFLICT (id) DO UPDATE
     SET role = 'viewer', role_template_id = EXCLUDED.role_template_id;

  PERFORM set_config('request.jwt.claim.sub', reader::TEXT, TRUE);

  BEGIN
    PERFORM crm_apply_enrichment('[]'::JSONB);
    PERFORM pg_temp.must('an office administrator cannot bring a file into the CRM', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('an office administrator cannot bring a file into the CRM',
      SQLERRM LIKE '%import permission%');
  END;

  BEGIN
    PERFORM count(*) FROM crm_enrichment_plan('[]'::JSONB);
    PERFORM pg_temp.must('and cannot even see what it would do', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('and cannot even see what it would do',
      SQLERRM LIKE '%import permission%');
  END;
END $$;

ROLLBACK;
