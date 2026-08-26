-- =============================================================
-- 064. An anonymous visitor reads nothing.
--
-- Found by the readback handed over with 062, on the live database.
-- Two holes, one inherited and one mine, and one false alarm worth
-- writing down so nobody chases it again.
--
-- ---- Why `anon` matters now when it did not before ----
--
-- Supabase grants SELECT on the public schema to `anon` by default, and
-- that is fine on its own: row level security is what decides which
-- rows come back, and until now every policy that mattered asked who
-- was asking.
--
-- Migration 062 changed the stakes. It gave `anon` two functions to
-- call, which means the anonymous role is now a role this application
-- actually uses rather than a theoretical one. Anything it can reach is
-- reachable by anybody holding the public key, which is in the browser
-- bundle of every page and is meant to be.
--
-- ---- Hole one, mine ----
--
-- The policy on `calendar_guests` was
--
--   EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id)
--
-- with no check on who is asking at all. It reads as "visible with the
-- meeting", and that was the intent, but "with the meeting" was doing
-- no work: it let through anybody the meeting let through, and the
-- meeting let through more than it should have. See hole two.
--
-- Worse, the column grant in 062 named `authenticated` and said nothing
-- about `anon`, so Supabase's default grant still covered every column
-- including `token`. The link that lets somebody answer an invitation
-- was readable by anybody with the public key.
--
-- ---- Hole two, inherited ----
--
-- `calendar_events_select` has said `OR visibility = 'team'` since
-- migration 006. There is no identity in that branch: it is true for
-- everybody, signed in or not. A team meeting is meant to be visible to
-- everybody who works here, and it read as though that is what it said.
--
-- ---- The false alarm ----
--
-- `crm_contacts` came back as readable by `anon` in the same readback
-- and is not. The check asked `has_table_privilege`, which answers about
-- the grant rather than about the rows, and `crm_select` in migration
-- 009 opens with `auth.role() = 'authenticated'`. The CRM was never
-- exposed. The check was asking the wrong question, and the one handed
-- over with this migration asks the right one: it reads, as `anon`, and
-- counts what comes back.
-- =============================================================

-- -------------------------------------------------------------
-- 1. A team meeting is visible to everybody who works here.
--
-- Which is what it was always meant to say, and now does. Nothing
-- changes for anybody signed in: `auth.uid()` is theirs, so the branch
-- is true exactly when it was before.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "calendar_events_select" ON calendar_events;
CREATE POLICY "calendar_events_select" ON calendar_events
  FOR SELECT USING (
    created_by = auth.uid()
    OR (visibility = 'team' AND auth.uid() IS NOT NULL)
    OR (visibility = 'specific' AND auth.uid() = ANY (visible_to))
    OR EXISTS (SELECT 1 FROM calendar_invites i
               WHERE i.event_id = calendar_events.id AND i.user_id = auth.uid())
  );

-- -------------------------------------------------------------
-- 2. Who is on a meeting is visible to whoever can see the meeting,
--    and only to somebody who is signed in.
--
-- The identity check is stated here rather than left to the meeting's
-- own policy. Leaning on another table's policy for the thing that
-- matters most is how the first version of this went wrong: the moment
-- that policy is loosened, this one is loosened with it and nobody
-- reading this file would know.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "guests_visible_with_the_meeting" ON calendar_guests;
CREATE POLICY "guests_visible_with_the_meeting" ON calendar_guests
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id)
  );

-- -------------------------------------------------------------
-- 3. `anon` has nothing on the guest table.
--
-- Not a column list, not a policy: nothing. A guest answers through
-- `calendar_guest_view` and `calendar_guest_answer`, which are SECURITY
-- DEFINER and read the row themselves. Neither needs the caller to hold
-- anything at all, which is the point of them being functions.
--
-- Said explicitly because Supabase's default grant is what put `anon`
-- there in the first place, and a default is not something to leave
-- covering a table with a credential in it.
-- -------------------------------------------------------------
REVOKE ALL ON calendar_guests FROM anon;

-- And the same for the history, which carries what a guest said.
REVOKE ALL ON calendar_invite_messages FROM anon;
REVOKE ALL ON calendar_invites FROM anon;
REVOKE ALL ON calendar_events FROM anon;

-- -------------------------------------------------------------
-- 4. Two more, found by reading as `anon` rather than by reasoning.
--
-- Neither is a secret and neither is dramatic. Both were `USING (TRUE)`,
-- and both are worth closing for the same reason: a policy that does not
-- ask who is asking is a policy nobody can reason about later.
--
-- `entities` is the company list, STC and STC Sales and Leasing. Its
-- three siblings in migration 048, departments, teams and team members,
-- all check `current_actor()`. This one did not, which reads as an
-- oversight in a block of four rather than a decision.
--
-- `tenant_settings` is the company name, the tagline, the email domain
-- used as the sign in placeholder. It was left open deliberately, for a
-- sign in page that would need the branding before anybody has signed
-- in. That page does not read it yet: nothing in the application reads
-- this table at all today.
--
-- So it closes, and the need it was left open for is served properly
-- below, by a function that returns the four columns a sign in card
-- wants and nothing else. When somebody builds that page it calls the
-- function, and the table stays shut.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "entities_read" ON entities;
CREATE POLICY "entities_read" ON entities
  FOR SELECT USING (current_actor() IS NOT NULL);

DROP POLICY IF EXISTS "tenant_settings_read" ON tenant_settings;
CREATE POLICY "tenant_settings_read" ON tenant_settings
  FOR SELECT USING (current_actor() IS NOT NULL);

REVOKE ALL ON entities FROM anon;
REVOKE ALL ON tenant_settings FROM anon;

-- -------------------------------------------------------------
-- 5. A global list is global to everybody who works here.
--
-- `lists_select` opens with `is_global = TRUE`, which is the same shape
-- as the meeting one and has the same problem: global means "not
-- somebody's private list", not "anybody at all". Found by the check
-- once it was made able to fail, rather than by reading policies and
-- deciding which looked fine.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "lists_select" ON crm_lists;
CREATE POLICY "lists_select" ON crm_lists FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    is_global = TRUE
    OR owner_id = auth.uid()
    OR is_list_member_safe(crm_lists.id)
  )
);

/* What a sign in card may know before anybody has signed in.

   Four columns, chosen because they are already printed on a page
   anybody can reach. Not the support address, not the user agent, not
   whatever this table grows next: a function that returns named columns
   cannot quietly start returning a new one. */
CREATE OR REPLACE FUNCTION tenant_branding()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'companyName', company_name,
    'shortName',   short_name,
    'productName', product_name,
    'tagline',     tagline,
    'emailDomain', email_domain
  )
  FROM tenant_settings WHERE id IS TRUE
$fn$;

REVOKE ALL ON FUNCTION tenant_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_branding() TO anon, authenticated;

COMMENT ON FUNCTION tenant_branding() IS
  'The branding a sign in page needs before anybody has signed in. '
  'Named columns, so the table growing a sensitive one does not '
  'quietly publish it.';

COMMENT ON POLICY "guests_visible_with_the_meeting" ON calendar_guests IS
  'Signed in, and able to see the meeting. The identity check is here '
  'rather than borrowed from the meeting policy, so loosening that one '
  'cannot quietly loosen this one.';
