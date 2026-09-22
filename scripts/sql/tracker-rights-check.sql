-- =============================================================
-- The Sales Tracker asks the capability, not the ownership alone.
--
-- From the audit:
--
--   Revoking edit/delete permissions leaves users able to edit and
--   delete their own leads.
--
--   Granting crm.viewOthers exposes the colleague picker, but the
--   database still restricts records to owned/shared/created leads or
--   legacy admins. A newly authorised non-admin can receive an empty
--   or incomplete tracker.
--
-- Runs AS `authenticated`. The owner bypasses row level security, so a
-- check that runs as the owner proves nothing about a policy.
--
-- Run with `npm run check:tracker-rights`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
DECLARE
  rep  UUID := 'fade0000-0000-0000-0000-000000000001';
  mate UUID := 'fade0000-0000-0000-0000-000000000002';
  cust UUID;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep, 'tr-rep@stc.example'), (mate, 'tr-mate@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,  'tr-rep@stc.example',  'Rita Rep',  'sales', TRUE),
    (mate, 'tr-mate@stc.example', 'Mal Mate',  'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep')
   WHERE id IN (rep, mate);
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;
  DELETE FROM crm_leads WHERE company_name IN ('Mine Ltd', 'Theirs Ltd');
  INSERT INTO crm_contacts (company_name) VALUES ('Mine Ltd') RETURNING id INTO cust;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Mine Ltd', cust, rep, rep, 'maintenance', 'lead', 1000);
  INSERT INTO crm_contacts (company_name) VALUES ('Theirs Ltd') RETURNING id INTO cust;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Theirs Ltd', cust, mate, mate, 'maintenance', 'lead', 2000);
END $seed$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_leads TO authenticated;

SET ROLE authenticated;
DO $check$
DECLARE rep UUID := 'fade0000-0000-0000-0000-000000000001'; n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  -- 1. A rep with crm.edit can edit their own lead.
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'a sales rep does not hold crm.edit, so nothing below means anything';
  END IF;
  UPDATE crm_leads SET estimated_value = 1100 WHERE company_name = 'Mine Ltd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'a rep cannot edit their own lead'; END IF;

  -- 2. Their own tracker only: the colleague's lead is not visible.
  SELECT count(*) INTO n FROM crm_leads WHERE company_name = 'Theirs Ltd';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a rep without crm.viewOthers can already read a colleague''s tracker';
  END IF;
END $check$;
RESET ROLE;

-- ---- Take crm.edit away, the way the Roles tab does ----
INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
VALUES ('fade0000-0000-0000-0000-000000000001', 'crm.edit', FALSE, 'check:tracker-rights')
ON CONFLICT (user_id, capability) DO UPDATE SET granted = FALSE;

SET ROLE authenticated;
DO $revoked$
DECLARE rep UUID := 'fade0000-0000-0000-0000-000000000001'; n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF command_may('crm.edit') THEN
    RAISE EXCEPTION 'revoking crm.edit did not reach the database';
  END IF;

  -- 3. THE FAULT. Their own lead must now be read only.
  UPDATE crm_leads SET estimated_value = 9999 WHERE company_name = 'Mine Ltd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'crm.edit was revoked and the rep edited their own lead anyway';
  END IF;
  IF (SELECT estimated_value FROM crm_leads WHERE company_name = 'Mine Ltd') <> 1100 THEN
    RAISE EXCEPTION 'the row changed after crm.edit was revoked';
  END IF;

  -- 4. And delete, which was ownership alone as well.
  DELETE FROM crm_leads WHERE company_name = 'Mine Ltd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a rep deleted their own lead with crm.delete not asked for';
  END IF;
END $revoked$;
RESET ROLE;

-- ---- Give it back, and add crm.viewOthers ----
UPDATE user_capability_overrides SET granted = TRUE
 WHERE user_id = 'fade0000-0000-0000-0000-000000000001' AND capability = 'crm.edit';
INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
VALUES ('fade0000-0000-0000-0000-000000000001', 'crm.viewOthers', TRUE, 'check:tracker-rights')
ON CONFLICT (user_id, capability) DO UPDATE SET granted = TRUE;

/* And take crm.assign away, which the sales_rep template holds.
   Changing a row that is not yours is what THAT capability is for, so
   leaving it on would mean the next assertion passed or failed on
   crm.assign while claiming to be about crm.viewOthers. A check that
   proves the right thing for the wrong reason is worse than no check. */
INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
VALUES ('fade0000-0000-0000-0000-000000000001', 'crm.assign', FALSE, 'check:tracker-rights')
ON CONFLICT (user_id, capability) DO UPDATE SET granted = FALSE;

SET ROLE authenticated;
DO $others$
DECLARE rep UUID := 'fade0000-0000-0000-0000-000000000001'; n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  -- 5. THE SECOND FAULT. The colleague's tracker is no longer empty.
  SELECT count(*) INTO n FROM crm_leads WHERE company_name = 'Theirs Ltd';
  IF n <> 1 THEN
    RAISE EXCEPTION 'crm.viewOthers was granted and the colleague''s tracker is still empty';
  END IF;

  -- 6. But a viewing right is not an editing right.
  IF command_may('crm.assign') THEN
    RAISE EXCEPTION 'crm.assign is still on, so this assertion would not be about viewOthers';
  END IF;
  UPDATE crm_leads SET estimated_value = 8888 WHERE company_name = 'Theirs Ltd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'crm.viewOthers let somebody change a colleague''s lead';
  END IF;

  RAISE NOTICE 'tracker: viewOthers shows the rows and does not make them editable';
END $others$;
RESET ROLE;

/* ---- 7. And viewing as somebody else writes nothing ----

   The row goes in as the owner, because view_as_sessions is writable
   only through view_as_start(), which is gated on admin.users. That
   refusal is itself correct and is why this cannot be done from inside
   the block above. */
INSERT INTO view_as_sessions (admin_id, viewing_id)
VALUES ('fade0000-0000-0000-0000-000000000001', 'fade0000-0000-0000-0000-000000000002')
ON CONFLICT (admin_id) DO UPDATE SET viewing_id = EXCLUDED.viewing_id;

SET ROLE authenticated;
DO $pretending$
DECLARE rep UUID := 'fade0000-0000-0000-0000-000000000001'; n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF NOT viewing_as_somebody() THEN
    RAISE EXCEPTION 'the database cannot tell that view as is running';
  END IF;

  UPDATE crm_leads SET estimated_value = 7777 WHERE company_name = 'Mine Ltd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a lead was edited while viewing as somebody else';
  END IF;

  RAISE NOTICE 'tracker: edit and delete need the capability, viewOthers reads without writing, and view as writes nothing';
END $pretending$;
RESET ROLE;

ROLLBACK;
