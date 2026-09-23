-- =============================================================
-- The CRM picks a division, the way the tracker does.
--
-- From the business:
--
--   CRM: top of crm have a rental/maint/ts picker like tracker
--
-- Run with `npm run check:crm-division`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  rep   UUID := 'dd441111-0000-0000-0000-000000000001';
  mate  UUID := 'dd441111-0000-0000-0000-000000000002';
  clerk UUID := 'dd441111-0000-0000-0000-000000000003';
  dawson UUID; wincanton UUID; nobody UUID;
  kinds TEXT[]; n INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep,'cd-rep@stc.example'), (mate,'cd-mate@stc.example'), (clerk,'cd-clerk@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,  'cd-rep@stc.example',  'Rita Rep',   'sales',  TRUE),
    (mate, 'cd-mate@stc.example', 'Mal Mate',   'sales',  TRUE),
    (clerk,'cd-clerk@stc.example','Ola Office', 'viewer', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep')
   WHERE id IN (rep, mate);
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='office_admin')
   WHERE id = clerk;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  DELETE FROM view_as_sessions;

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  INSERT INTO crm_contacts (company_name) VALUES ('Dawson Group')   RETURNING id INTO dawson;
  INSERT INTO crm_contacts (company_name) VALUES ('Wincanton')      RETURNING id INTO wincanton;
  INSERT INTO crm_contacts (company_name) VALUES ('Nobody Pitched') RETURNING id INTO nobody;

  -- Dawson: a trailer deal of the rep's, and a MAINTENANCE deal that
  -- belongs to somebody else entirely.
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status)
  VALUES ('Dawson Group', dawson, rep,  rep,  'trailer_sales', 'quoted'),
         ('Dawson Group', dawson, mate, mate, 'maintenance',   'lead');

  -- Wincanton: rental only.
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status)
  VALUES ('Wincanton', wincanton, rep, rep, 'rental', 'contacted');

  -- ---------------------------------------------------------
  -- 1. A CUSTOMER IS IN EVERY DIVISION SOMEBODY IS WORKING THEM IN.
  -- ---------------------------------------------------------
  SELECT lead_types INTO kinds FROM crm_contact_divisions(NULL) WHERE contact_id = dawson;
  IF NOT ('trailer_sales' = ANY (kinds)) THEN
    RAISE EXCEPTION 'Dawson is not in trailer sales: %', kinds;
  END IF;

  /* THE ONE THAT MATTERS. The maintenance deal is on a COLLEAGUE'S
     tracker. The CRM is the shared book, so Dawson is a maintenance
     customer whoever is working it. A rep losing them off the
     Maintenance tab because the deal is not theirs is the opposite of
     what a division filter is for. */
  IF NOT ('maintenance' = ANY (kinds)) THEN
    RAISE EXCEPTION 'a colleague''s maintenance deal did not put Dawson in maintenance: %', kinds;
  END IF;
  IF 'rental' = ANY (kinds) THEN
    RAISE EXCEPTION 'Dawson turned up in a division nobody is working them in: %', kinds;
  END IF;

  SELECT lead_types INTO kinds FROM crm_contact_divisions(NULL) WHERE contact_id = wincanton;
  IF kinds <> ARRAY['rental']::TEXT[] THEN
    RAISE EXCEPTION 'Wincanton reads as %, not rental alone', kinds;
  END IF;

  -- ---------------------------------------------------------
  -- 2. AND A CUSTOMER NOBODY HAS PITCHED TO IS IN NONE OF THEM.
  --
  --    Not "all three by default", which is what `crm_contacts.side`
  --    would have said: it defaults to trailer_sales on every row ever
  --    written. They belong on All, which is where somebody goes
  --    looking for who has not been approached.
  -- ---------------------------------------------------------
  IF EXISTS (SELECT 1 FROM crm_contact_divisions(NULL) WHERE contact_id = nobody) THEN
    RAISE EXCEPTION 'a customer with no deals was put in a division anyway';
  END IF;

  -- ---------------------------------------------------------
  -- 3. THE OPEN COUNT IS THE OPEN ONES.
  -- ---------------------------------------------------------
  SELECT open_deals INTO n FROM crm_contact_divisions(ARRAY[dawson]);
  IF n <> 2 THEN RAISE EXCEPTION 'Dawson has % open, wanted 2', n; END IF;

  UPDATE crm_leads SET status = 'lost' WHERE contact_id = dawson AND type = 'maintenance';
  SELECT open_deals INTO n FROM crm_contact_divisions(ARRAY[dawson]);
  IF n <> 1 THEN RAISE EXCEPTION 'losing one left % open, wanted 1', n; END IF;

  /* And a lost deal still puts them in the division. "Which customers
     do we do maintenance work with" includes the ones it went wrong
     with: that is who you ring. */
  SELECT lead_types INTO kinds FROM crm_contact_divisions(NULL) WHERE contact_id = dawson;
  IF NOT ('maintenance' = ANY (kinds)) THEN
    RAISE EXCEPTION 'losing the deal took them out of the division';
  END IF;

  -- ---------------------------------------------------------
  -- 4. IT SAYS NOTHING TO SOMEBODY WHO MAY NOT OPEN THE CRM.
  -- ---------------------------------------------------------
  /* The trigger that stops somebody editing their own permissions is
     the one being worked around here, not tested. Stood down for the
     fixture and put straight back. */
  ALTER TABLE profiles DISABLE TRIGGER USER;
  UPDATE profiles SET role_template_id = NULL, role = 'viewer' WHERE id = clerk;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM user_capability_overrides WHERE user_id = clerk;
  INSERT INTO user_capability_overrides (user_id, capability, granted, granted_by)
  VALUES (clerk, 'crm.view', FALSE, rep)
  ON CONFLICT (user_id, capability) DO UPDATE SET granted = FALSE;

  PERFORM set_config('request.jwt.claim.sub', clerk::TEXT, TRUE);
  IF command_may('crm.view') THEN
    RAISE EXCEPTION 'the fixture did not take the CRM away, so the next line proves nothing';
  END IF;
  IF EXISTS (SELECT 1 FROM crm_contact_divisions(NULL)) THEN
    RAISE EXCEPTION 'somebody who cannot open the CRM read which divisions a customer is in';
  END IF;

  -- And a rep gets the whole book, colleague's deals included.
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  SELECT count(*) INTO n FROM crm_contact_divisions(NULL);
  IF n < 2 THEN
    RAISE EXCEPTION 'a rep sees % customers with deals, wanted at least 2', n;
  END IF;

  RAISE NOTICE 'the CRM division is the tracker''s division, counted across everybody''s deals';
END $check$;

ROLLBACK;
