-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 041_actor_and_policy_holes.sql. This repository already had a 041 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 041. One name for "who is asking", and the two policies that were
--      not asking at all.
--
-- Three things, together because the second and third are the reason the
-- first is worth having.
--
-- ---- 1. current_actor() ----
--
-- This installation is moving off Supabase onto plain PostgreSQL once
-- the application is rebuilt. `auth.uid()` is Supabase Auth, not
-- PostgreSQL, and it appears in sixty seven policies. `auth.role()` is
-- the same. On a plain host neither function exists and every one of
-- those policies fails.
--
-- `current_role_safe()` already wraps the role half and has since the
-- first schema. This adds the missing half. From here, new policies say
-- `current_actor()` and the move is a one line change to one function
-- body rather than sixty seven edits:
--
--     SELECT NULLIF(current_setting('app.actor_id', TRUE), '')::UUID
--
-- It is LANGUAGE SQL and STABLE on purpose. PostgreSQL inlines a simple
-- SQL function into the calling query, so a policy that calls this costs
-- exactly what a policy calling `auth.uid()` directly costs. A plpgsql
-- version with a fallback would read better and would defeat inlining,
-- and a policy is evaluated per row.
--
-- Existing policies are not swept here. They get the wrapper as they are
-- touched, which is how a sweep avoids becoming its own migration.
--
-- ---- 2. Anybody could edit or delete anybody's calendar entry ----
--
-- `calendar_events` carried five policies that disagreed with each
-- other, and permissive policies combine with OR, so the loosest won
-- every time:
--
--   cal_select          FOR SELECT  auth.role() = 'authenticated'
--   cal_write           FOR ALL     auth.role() = 'authenticated'
--   calendar_select_v2  FOR SELECT  creator, team, or named
--   calendar_events_select FOR SELECT  the above, plus invited
--   calendar_insert / update / delete   creator only
--
-- `cal_write` is FOR ALL, so it covered UPDATE and DELETE and overrode
-- the three narrow policies underneath it. Any signed in person could
-- change or delete any meeting in the company.
--
-- `cal_select` did the same to visibility. The private, team and
-- specific model added by the dashboard migration had no effect at all,
-- because the broadest of the three SELECT policies granted everything
-- to everybody. A meeting marked private was visible to the whole
-- company.
--
-- The calendar one contradicts scope section 34 outright, which requires
-- the database to enforce scope rather than the frontend hiding things.
--
-- ---- 3. Addresses, which were NOT a hole ----
--
-- `addresses_all` is FOR ALL with only an existence check on the parent
-- contact and no test of who is asking, and it was reported as letting
-- anybody read or edit any customer address. Put in front of a real
-- database with two real users, it does not: the subquery inside it is
-- itself subject to row level security, so `crm_select` on
-- `crm_contacts` filters it and the correct list rule applies after all.
-- Measured both ways in `docs/rls-findings.md`.
--
-- It is replaced anyway, and not as a security fix. The rule was
-- inherited through a nested policy evaluation on another table, so
-- editing `crm_select` silently changes who may edit an address with
-- nothing naming the dependency. Four policies calling one
-- SECURITY DEFINER function state the rule once instead. That is a
-- maintainability change and is recorded as one.
--
-- ---- A column the application already writes ----
--
-- `calendar_events.owner_user_id` is written by ScheduleMeetingModal and
-- exists in no migration. The insert has a fallback that strips the
-- field when the column is missing, so it strips it every single time:
-- booking into a colleague's diary has never recorded whose diary it
-- is. It is added here because the delegation feature needs it and
-- because the new update policy has to name it.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Who is asking.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_actor()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $fn$
  SELECT auth.uid()
$fn$;

COMMENT ON FUNCTION current_actor() IS
  'The signed in person, as one name. Replace the body when this leaves '
  'Supabase: SELECT NULLIF(current_setting(''app.actor_id'', TRUE), '''')::UUID';

REVOKE ALL ON FUNCTION current_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_actor() TO authenticated, anon;

-- -------------------------------------------------------------
-- 2. The column the application writes and the schema never had.
-- -------------------------------------------------------------
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users ON DELETE SET NULL;

-- Whose diary a meeting belongs to, when somebody else booked it. Null
-- means it belongs to whoever created it, which is the ordinary case.
CREATE INDEX IF NOT EXISTS idx_calendar_events_owner ON calendar_events (owner_user_id);

-- -------------------------------------------------------------
-- 3. Calendar: one SELECT policy, and writes that check who is asking.
--
-- The two open policies are dropped rather than narrowed. A policy that
-- grants everything cannot be made safe by adding a stricter one beside
-- it, because permissive policies OR.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "cal_select"          ON calendar_events;
DROP POLICY IF EXISTS "cal_write"           ON calendar_events;
DROP POLICY IF EXISTS "calendar_select_v2"  ON calendar_events;
DROP POLICY IF EXISTS "calendar_select"     ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_select" ON calendar_events;
DROP POLICY IF EXISTS "calendar_insert"     ON calendar_events;
DROP POLICY IF EXISTS "calendar_update"     ON calendar_events;
DROP POLICY IF EXISTS "calendar_delete"     ON calendar_events;
-- And the four this file creates, so running it twice replaces them
-- rather than failing on the second pass. `npm run check:bundle-twice`
-- caught exactly that omission here.
DROP POLICY IF EXISTS "calendar_events_insert" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_update" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_delete" ON calendar_events;

-- Five ways in, and no sixth. Creator, owner when it was delegated,
-- anything marked team, anyone named on a specific event, anyone
-- invited.
CREATE POLICY "calendar_events_select" ON calendar_events
  FOR SELECT USING (
    created_by = current_actor()
    OR owner_user_id = current_actor()
    OR visibility = 'team'
    OR (visibility = 'specific' AND current_actor() = ANY (visible_to))
    OR EXISTS (
      SELECT 1 FROM calendar_invites i
      WHERE i.event_id = calendar_events.id AND i.user_id = current_actor()
    )
  );

-- You may create an event in your own name. Booking into somebody
-- else's diary is expressed by owner_user_id, not by claiming to be
-- them, which is what the modal already does.
CREATE POLICY "calendar_events_insert" ON calendar_events
  FOR INSERT WITH CHECK (created_by = current_actor());

-- The person who booked it, the person it is for, or an administrator.
-- The owner is included because a meeting somebody put in your diary is
-- yours to move, which is the whole point of delegation.
CREATE POLICY "calendar_events_update" ON calendar_events
  FOR UPDATE USING (
    created_by = current_actor()
    OR owner_user_id = current_actor()
    OR current_role_safe() = 'admin'
  );

CREATE POLICY "calendar_events_delete" ON calendar_events
  FOR DELETE USING (
    created_by = current_actor()
    OR owner_user_id = current_actor()
    OR current_role_safe() = 'admin'
  );

-- -------------------------------------------------------------
-- 4. Addresses, gated the way notes on the same customer are gated.
--
-- The same rule the old policy reached indirectly, stated directly. A
-- customer whose list you can see is a customer whose addresses you can
-- work with. SECURITY DEFINER so the rule is evaluated here rather than
-- depending on another table's policy still being right.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "addresses_all" ON contact_addresses;
DROP POLICY IF EXISTS "addresses_select" ON contact_addresses;
DROP POLICY IF EXISTS "addresses_insert" ON contact_addresses;
DROP POLICY IF EXISTS "addresses_update" ON contact_addresses;
DROP POLICY IF EXISTS "addresses_delete" ON contact_addresses;

CREATE OR REPLACE FUNCTION can_reach_contact(p_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM crm_contacts c
    LEFT JOIN crm_lists l ON l.id = c.list_id
    WHERE c.id = p_contact_id
      AND (
        l.id IS NULL
        OR l.is_global = TRUE
        OR l.owner_id = current_actor()
        OR is_list_member_safe(l.id)
      )
  )
$fn$;

COMMENT ON FUNCTION can_reach_contact(UUID) IS
  'Can the caller work with this customer record. The list visibility '
  'rule the note policies spell out inline, in one place instead.';

REVOKE ALL ON FUNCTION can_reach_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_contact(UUID) TO authenticated;

CREATE POLICY "addresses_select" ON contact_addresses
  FOR SELECT USING (can_reach_contact(contact_id));

CREATE POLICY "addresses_insert" ON contact_addresses
  FOR INSERT WITH CHECK (can_reach_contact(contact_id));

CREATE POLICY "addresses_update" ON contact_addresses
  FOR UPDATE USING (can_reach_contact(contact_id))
           WITH CHECK (can_reach_contact(contact_id));

CREATE POLICY "addresses_delete" ON contact_addresses
  FOR DELETE USING (can_reach_contact(contact_id));
