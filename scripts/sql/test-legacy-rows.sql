-- =============================================================
-- Rows that are already there.
--
-- The disposable database is built from nothing every time, which is
-- what makes it describable and is otherwise exactly right. It also
-- means every migration is applied to an empty table, and a migration
-- that only works on an empty table passes.
--
-- That is not a hypothetical. Migration 065 renamed eleven old
-- notification kinds to their new dotted names and dropped the CHECK
-- constraint that forbade the new ones AFTERWARDS. On this database the
-- rename touched no rows, so nothing failed. On the live one it hit a
-- demo row left over from seeding and took the whole file down:
--
--   new row for relation "notifications" violates check constraint
--   "notifications_kind_check"
--
-- So this file seeds the state a live database is actually in before
-- the command runtime's migrations run: a person, and one notification
-- of every kind the old constraint allowed.
--
-- Applied after migrations 001 to 006, because 006 is what writes that
-- constraint, and before `order.txt`, because that is where the
-- migrations under test begin.
--
-- Anything else that has to survive being migrated over belongs here
-- too. The rule it exists to enforce is one line: a migration is not
-- proved by running it against nothing.
-- =============================================================

/* Its own prefix, and not one any check claims. `ff000000-%` was the
   obvious choice and is exactly wrong: the FleetSmart+ check counts
   every profile matching it and asserts there are five, so seeding a
   sixth here broke a check that has nothing to do with notifications.
   A fixture that exists for every check has to be invisible to all of
   them. */
INSERT INTO auth.users (id, email)
VALUES ('d0000000-0000-0000-0000-00000000000d', 'legacy@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'sales', full_name = 'Legacy Person'
 WHERE id = 'd0000000-0000-0000-0000-00000000000d';

/* One of each kind migration 006's constraint allowed. Every one of
   them has to come out the other side of 065 under its new name, and
   none of them may be lost. */
INSERT INTO notifications (user_id, kind, title, body, link_path)
SELECT 'd0000000-0000-0000-0000-00000000000d', k,
       'Legacy ' || k, 'Written before the catalogue existed.', '/dashboard'
FROM unnest(ARRAY[
  'lead_assigned', 'message', 'system_alert', 'sync_failure', 'yoy_anomaly',
  'meeting_invited', 'meeting_accepted', 'meeting_declined',
  'meeting_proposed', 'meeting_cancelled', 'meeting_moved'
]) AS k
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM notifications
       WHERE user_id = 'd0000000-0000-0000-0000-00000000000d') <> 11 THEN
    RAISE EXCEPTION
      'the legacy fixture did not go in, so every migration after this is being proved against an empty table';
  END IF;
END $$;
