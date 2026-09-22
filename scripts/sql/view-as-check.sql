-- =============================================================
-- "Nothing can be saved" is true, including straight from the browser.
--
-- The red banner on an administrator viewing the app as somebody else
-- promises:
--
--   Buttons and tabs are theirs. The rows are still yours, and nothing
--   can be saved.
--
-- `lib/api/guard.ts` kept that promise for every write that goes
-- through a route. The stock list does not: it writes straight from
-- the browser to PostgreSQL, so the only thing in the way is row level
-- security, and who you are viewing as lived in a COOKIE, which never
-- reaches the database.
--
-- Everything below runs AS `authenticated`, not as the owner, because
-- the table owner bypasses row level security and a check that runs as
-- the owner proves nothing about a policy.
--
-- Run with `npm run check:view-as`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
DECLARE boss UUID := 'ace00000-0000-0000-0000-000000000001';
        rep  UUID := 'ace00000-0000-0000-0000-000000000002';
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (boss, 'va-boss@stc.example'), (rep, 'va-rep@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (boss, 'va-boss@stc.example', 'Mo Director', 'admin', TRUE),
    (rep,  'va-rep@stc.example',  'Vic Viewer',  'viewer', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='viewer') WHERE id=rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;
  DELETE FROM stock_trailers WHERE stc_no = 'VA-1';
  INSERT INTO stock_trailers (stc_no, status, customer, sales_price)
  VALUES ('VA-1', 'in_stock', 'Somebody', 1000.00);
END $seed$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_trailers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON view_as_sessions TO authenticated;

SET ROLE authenticated;

DO $check$
DECLARE
  boss UUID := 'ace00000-0000-0000-0000-000000000001';
  rep  UUID := 'ace00000-0000-0000-0000-000000000002';
  n    INT;
BEGIN
  -- ---------------------------------------------------------
  -- 1. THE ADMINISTRATOR, AS THEMSELVES, CAN EDIT THE STOCK LIST.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  UPDATE stock_trailers SET sales_price = 1111.00 WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'an administrator cannot edit the stock list at all, so nothing below means anything';
  END IF;

  -- ---------------------------------------------------------
  -- 2. NOW VIEWING AS SOMEBODY ELSE. THE SAME WRITE IS REFUSED.
  --
  -- This is the fault: the stock grid writes straight from the browser
  -- so no route, no guard, and the cookie was invisible down here.
  -- ---------------------------------------------------------
  PERFORM view_as_start(rep);
  IF NOT viewing_as_somebody() THEN
    RAISE EXCEPTION 'the database cannot tell that view as is running';
  END IF;

  UPDATE stock_trailers SET sales_price = 2222.00 WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a write went through while viewing as somebody else, and the banner says it cannot';
  END IF;

  IF (SELECT sales_price FROM stock_trailers WHERE stc_no = 'VA-1') <> 1111.00 THEN
    RAISE EXCEPTION 'the row changed while viewing as somebody else';
  END IF;

  -- An insert and a delete are refused too, not only an update.
  BEGIN
    INSERT INTO stock_trailers (stc_no, status) VALUES ('VA-2', 'in_stock');
    RAISE EXCEPTION 'an insert went through while viewing as somebody else';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  DELETE FROM stock_trailers WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a delete went through while viewing as somebody else';
  END IF;

  -- ---------------------------------------------------------
  -- 3. STOPPING GIVES IT BACK.
  -- ---------------------------------------------------------
  PERFORM view_as_stop();
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'stopping did not stop';
  END IF;
  UPDATE stock_trailers SET sales_price = 3333.00 WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'the administrator did not get their own account back';
  END IF;

  -- ---------------------------------------------------------
  -- 4. THE CAPABILITY, NOT THE LEGACY ROLE.
  --
  -- `stock_write` read current_role_safe() IN ('admin','marketer','sales'),
  -- so the Roles tab governed nothing: revoking stock.edit left the
  -- grid editable and granting it to a viewer left it read only.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  UPDATE stock_trailers SET sales_price = 4444.00 WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a viewer with no stock.edit wrote to the stock list';
  END IF;
END $check$;

RESET ROLE;

/* Give the viewer stock.edit and NOTHING else, the way the Roles tab
   does, then ask the grid the same question again. Granting has to
   work as surely as revoking, or the tab is half a control. */
INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
VALUES ('ace00000-0000-0000-0000-000000000002', 'stock.edit', TRUE, 'check:view-as')
ON CONFLICT (user_id, capability) DO UPDATE SET granted = TRUE;

SET ROLE authenticated;

DO $after$
DECLARE rep UUID := 'ace00000-0000-0000-0000-000000000002'; n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF NOT command_may('stock.edit') THEN
    RAISE EXCEPTION 'granting stock.edit on the Roles tab did not reach the database';
  END IF;

  UPDATE stock_trailers SET sales_price = 5555.00 WHERE stc_no = 'VA-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'a viewer GRANTED stock.edit still cannot write to the stock list';
  END IF;

  RAISE NOTICE 'view as: every write refused, and stock.edit governs the grid both ways';
END $after$;

RESET ROLE;
ROLLBACK;
