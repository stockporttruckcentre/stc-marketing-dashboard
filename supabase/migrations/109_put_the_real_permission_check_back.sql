-- =============================================================
-- 109. Put the real permission check back.
--
-- ---- Why this migration exists ----
--
-- On the evening of the lockout, every gated page was bouncing to
-- /dashboard with the managing director stood waiting, and the fault
-- was not found in time. To get the figures on screen, `command_may`
-- was replaced by hand in the production database with a function that
-- answered TRUE for everything. That was a deliberate, stated bypass,
-- not a fix, and it is still in force until this runs.
--
-- From the business, the next morning:
--
--   i presume what you just did was a hardcode. MD has seen the figures
--   now. Undo the hard code and fix the app.
--
-- This is the undo. It restates `command_may` exactly as migration 065
-- defines it, so a database that took the bypass comes back to the real
-- cascade, and a database that never took it is unchanged.
--
-- ---- Why it is safe to run now, and was not before ----
--
-- Before, restoring this meant risking the same evening again: a page
-- that refuses and a page that is broken looked identical from the
-- outside, and the only symptom either produced was a silent bounce to
-- the dashboard.
--
-- That is no longer true. Every gated page now reads its requirement
-- from one declaration, draws a screen naming the capability when it
-- refuses, and prints what the database actually said when the lookup
-- fails. `/dashboard/settings/access` reports the whole resolution for
-- whoever is reading it. So if this restore closes a page that should
-- be open, the screen says which capability and which role, in one
-- click, instead of costing an evening.
--
-- ---- Safe to run twice ----
--
-- CREATE OR REPLACE and idempotent grants. Nothing is dropped, no data
-- is touched, no permission is granted or removed. It only puts one
-- function body back.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The cascade, asked about the caller.
--
-- Byte for byte the definition in 065, which is the one every other
-- function in this schema was written against. Eighteen database
-- functions call it, so the name and the signature are fixed.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_may(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT actor_holds(current_actor(), p_capability)
$fn$;

-- Restated because a function somebody cannot execute fails in a way
-- that looks exactly like a refusal, and telling those two apart is the
-- whole of what the last week was about.
REVOKE ALL ON FUNCTION command_may(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_may(TEXT) TO authenticated;

COMMENT ON FUNCTION command_may(TEXT) IS
  'Whether the signed in person holds a capability. The override, then '
  'the role template, then the legacy role column, in that order. '
  'Restored in 109 after the lockout bypass.';
