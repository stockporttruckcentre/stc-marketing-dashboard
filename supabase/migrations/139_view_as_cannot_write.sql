-- =============================================================
-- 139. "Nothing can be saved" becomes true.
--
-- The red banner on an administrator viewing the app as somebody else
-- says, in as many words:
--
--   Buttons and tabs are theirs. The rows are still yours, and nothing
--   can be saved.
--
-- It was not true. `lib/api/guard.ts` refuses a write while viewing as
-- somebody, and that covers every route that goes through it. It does
-- not cover a screen that writes STRAIGHT FROM THE BROWSER to
-- PostgreSQL, and the stock list does exactly that:
--
--   supabase.from('stock_trailers').update({ [field]: value })
--
-- No route, no guard. The only thing in its way is row level security,
-- and row level security could not know, because who you are viewing
-- as lives in a COOKIE. A cookie reaches a route handler. It never
-- reaches the database.
--
-- So an administrator checking what a read only viewer sees could edit
-- the stock list, and it saved, under the administrator's name, from a
-- screen that said it was somebody else's. That is the audit trail
-- this feature exists to protect.
--
-- ---- The fix ----
--
-- Give it a row. The cookie still drives the interface, but the row is
-- the authority, and `viewing_as_somebody()` is a question row level
-- security can ask. Then say it once in the policies that matter.
--
-- ---- And the second fault in the same policy ----
--
-- `stock_write` read `current_role_safe() IN ('admin','marketer','sales')`.
-- A legacy role, not a capability. Revoking `stock.edit` on the Roles
-- tab changed nothing, and granting it to a viewer changed nothing
-- either. The Roles tab governed a screen that was not listening.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Who is pretending to be whom, where the database can see it.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS view_as_sessions (
  admin_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  viewing_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE view_as_sessions IS
  'One row per administrator currently viewing the app as somebody else. The '
  'cookie drives the interface; THIS is what row level security reads, because a '
  'cookie never reaches the database and a direct browser write carries no route.';

ALTER TABLE view_as_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "view_as_own" ON view_as_sessions;
CREATE POLICY "view_as_own" ON view_as_sessions
  FOR SELECT USING (admin_id = auth.uid() OR command_may('admin.users'));
GRANT SELECT ON view_as_sessions TO authenticated;

-- -------------------------------------------------------------
-- 2. The question, asked once.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION viewing_as_somebody()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM view_as_sessions v WHERE v.admin_id = auth.uid());
$fn$;

COMMENT ON FUNCTION viewing_as_somebody() IS
  'TRUE while this person is viewing the app as somebody else. Every write policy '
  'that a browser can reach directly says AND NOT this.';

REVOKE ALL ON FUNCTION viewing_as_somebody() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viewing_as_somebody() TO authenticated;

-- -------------------------------------------------------------
-- 3. Starting and stopping it. Only somebody who may manage users.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION view_as_start(p_person UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Viewing the app as somebody else needs permission to manage users.';
  END IF;
  IF p_person = auth.uid() THEN
    RAISE EXCEPTION 'That is already you.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_person) THEN
    RAISE EXCEPTION 'There is nobody with that id.';
  END IF;

  INSERT INTO view_as_sessions (admin_id, viewing_id, started_at)
  VALUES (auth.uid(), p_person, NOW())
  ON CONFLICT (admin_id) DO UPDATE
    SET viewing_id = EXCLUDED.viewing_id, started_at = NOW();
END;
$fn$;

CREATE OR REPLACE FUNCTION view_as_stop()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  /* Deliberately NOT gated on a capability. Stopping is how somebody
     gets their own account back, and a person whose permission was
     taken away mid-session must never be stuck inside somebody else. */
  DELETE FROM view_as_sessions WHERE admin_id = auth.uid();
$fn$;

REVOKE ALL ON FUNCTION view_as_start(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION view_as_stop() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION view_as_start(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION view_as_stop() TO authenticated;

-- -------------------------------------------------------------
-- 4. The stock list: the capability, and the promise.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "stock_write" ON stock_trailers;
CREATE POLICY "stock_write" ON stock_trailers
  FOR ALL
  USING (command_may('stock.edit') AND NOT viewing_as_somebody())
  WITH CHECK (command_may('stock.edit') AND NOT viewing_as_somebody());

DROP POLICY IF EXISTS "stock_select" ON stock_trailers;
CREATE POLICY "stock_select" ON stock_trailers
  FOR SELECT USING (command_may('stock.view'));

DO $$ BEGIN
  RAISE NOTICE 'viewing as somebody else can no longer write, including straight from the browser';
END $$;
