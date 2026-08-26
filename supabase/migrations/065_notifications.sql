-- =============================================================
-- 065. Notifications, as a thing the whole application writes to.
--
-- The bell in the top bar has been a button with no click handler since
-- migration 001 built the table underneath it. One function writes to
-- that table today, `command_meeting_notify`, and one screen reads five
-- rows off it. Everything else the application does happens silently.
--
-- That is the wrong way round for this product. The Diary tracks
-- somebody's day and Work tracks what is on them, and neither is worth
-- much if nothing ever taps them on the shoulder. A person who has to
-- remember to go and look at the thing that remembers for them is doing
-- the remembering.
--
-- ---- The shape of the problem ----
--
-- Two failures are available here and they pull against each other.
--
-- Say nothing, and the diary and the task list are diaries and task
-- lists somebody has to visit.
--
-- Say everything, and within a fortnight the bell is a red dot nobody
-- looks at, which is the same as saying nothing but with more work
-- behind it.
--
-- So four things decide what somebody actually gets:
--
--   the catalogue    every kind of thing worth saying is a row in a
--                    table, not a string in a CHECK constraint. It
--                    carries who it is for, whether it can be turned
--                    off, and what the toggle says.
--   preferences      a row per person per kind. The catalogue supplies
--                    the default and the person overrules it.
--   bunching         two accounts assigned in one breath is one
--                    notification saying two, not two saying one.
--   quiet hours      something that is not urgent and arrives at
--                    half past ten at night waits until morning.
--
-- ---- Bunching, since it is the part with a shape ----
--
-- Every call to `notify` may carry a `group_key`. Two calls with the
-- same key, to the same person, within that person's bundle window,
-- become one row: the count goes up, the item is appended to the
-- payload, and the title is rewritten from the catalogue's plural.
--
-- Which means the CRM does not have to know it is assigning two
-- accounts. It assigns one, twice, and says so twice. What the person
-- reads is "2 accounts were assigned to you", with both of them in it
-- and a way to open the pair. Select one and it stays the detailed
-- single, because a bunch of one is not a bunch.
--
-- ---- What this file does not do ----
--
-- It does not send anything anywhere. No email, no push, no webhook.
-- This installation is reachable on the VPN only and there is no
-- outbound mail configured, so a channel column would be a promise the
-- application cannot keep. When single sign on arrives and brings a way
-- to send, the place it plugs in is `notify`, and the preference rows
-- grow a column rather than the callers changing.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Can a NAMED person do this.
--
-- `command_may` answers for whoever is signed in, which is the right
-- question ninety nine times out of a hundred and the wrong one here:
-- deciding who to tell about a post awaiting approval means asking
-- about somebody who is not in the room.
--
-- So the cascade moves into a function that takes the person, and
-- `command_may` becomes that function asked about the caller. One
-- implementation, so the two answers cannot drift, which they would
-- within a month of being written twice.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION actor_holds(p_user UUID, p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  override BOOLEAN;
  template UUID;
BEGIN
  IF p_user IS NULL OR p_capability IS NULL THEN
    RETURN FALSE;
  END IF;

  -- An explicit decision about this person beats everything.
  SELECT granted INTO override
  FROM user_capability_overrides
  WHERE user_id = p_user
    AND capability = p_capability
    AND (expires_at IS NULL OR expires_at > NOW());

  IF override IS NOT NULL THEN
    RETURN override;
  END IF;

  -- Their template.
  SELECT role_template_id INTO template FROM profiles WHERE id = p_user;

  IF template IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM role_template_capabilities
      WHERE role_template_id = template AND capability = p_capability
    );
  END IF;

  -- Nobody has given this account a template yet, so the legacy role
  -- seed still answers. Removed once every account holds one.
  RETURN EXISTS (
    SELECT 1 FROM command_capability_roles r
    JOIN profiles p ON p.id = p_user
    WHERE r.capability = p_capability
      AND r.role = p.role
  );
END;
$fn$;

REVOKE ALL ON FUNCTION actor_holds(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_holds(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION actor_holds(UUID, TEXT) IS
  'Whether a named person holds a capability. The cascade that '
  'command_may runs, asked about somebody who is not the caller.';

CREATE OR REPLACE FUNCTION command_may(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT actor_holds(current_actor(), p_capability)
$fn$;

REVOKE ALL ON FUNCTION command_may(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_may(TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 2. The catalogue.
--
-- Every kind of notification the application can raise, as a row.
--
-- It was a CHECK constraint on one column, which meant adding a kind
-- was a migration that rewrote a constraint, and meant the settings
-- screen would have had to keep its own hand written list of what the
-- toggles are. Two lists, one of which is wrong.
--
-- As rows, the settings screen is a SELECT, and `notify` can refuse a
-- kind nobody has described rather than writing a notification with no
-- label, no default and no way to turn it off.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_kinds (
  key           TEXT PRIMARY KEY,

  -- Which group of toggles it sits under on the settings screen.
  category      TEXT NOT NULL
                  CHECK (category IN ('diary', 'work', 'crm', 'content',
                                      'sales', 'fleetsmart', 'admin', 'team')),

  -- What the toggle says, and the line under it. Written here rather
  -- than in the component, so the screen cannot describe a kind
  -- differently from the thing that raises it.
  label         TEXT NOT NULL,
  blurb         TEXT NOT NULL,

  -- personal  about you, or something waiting on you
  -- team      about the business. Everybody who wants it gets it.
  audience      TEXT NOT NULL DEFAULT 'personal'
                  CHECK (audience IN ('personal', 'team')),

  -- info       worth knowing
  -- attention  somebody is waiting on you
  -- urgent     it is happening now, or a deadline has passed
  --
  -- Urgent is the only one that ignores quiet hours, which is why
  -- there are three rather than five: a scale nobody can hold in their
  -- head gets used arbitrarily and stops meaning anything.
  severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'attention', 'urgent')),

  -- On unless somebody turns it off.
  default_on    BOOLEAN NOT NULL DEFAULT TRUE,

  -- Some cannot be turned off. Being told your own role changed is not
  -- a preference: it changes what the application will let you do, and
  -- somebody who does not know that is somebody filing a bug.
  may_mute      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Only offered to, and only raised for, people who hold this. A
  -- toggle for approving posts on the screen of somebody who cannot
  -- approve posts is clutter that teaches people to ignore the screen.
  capability    TEXT,

  -- Whether you hear about something you did yourself. Mostly no: you
  -- know, you just did it. Yes for the ones where the doing and the
  -- finishing are minutes apart and somewhere else, like an import.
  self_ok       BOOLEAN NOT NULL DEFAULT FALSE,

  -- How the title reads once there is more than one. `{n}` is the
  -- count. Null means this kind never bunches, which is right for
  -- anything with a single subject: two meetings moved are two
  -- different meetings and squashing them loses which.
  bundle_title  TEXT,

  sort_order    INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_kinds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_kinds_read" ON notification_kinds;
CREATE POLICY "notification_kinds_read" ON notification_kinds
  FOR SELECT USING (current_actor() IS NOT NULL);

REVOKE ALL ON notification_kinds FROM anon;


-- -------------------------------------------------------------
-- 3. The catalogue's contents.
--
-- Written as one idempotent upsert so this file can be run again over
-- a database that already has it. Wording matters here more than it
-- usually does in a migration: these strings are the toggle labels
-- somebody reads on the settings screen, and the titles are the first
-- thing they see in the bell.
-- -------------------------------------------------------------
INSERT INTO notification_kinds
  (key, category, label, blurb, audience, severity, default_on, may_mute,
   capability, self_ok, bundle_title, sort_order)
VALUES
  -- ---- Diary ----
  ('meeting.invited', 'diary',
   'Somebody asks you to a meeting',
   'With accept, decline and suggest another time on the notification itself.',
   'personal', 'attention', TRUE, FALSE, NULL, FALSE, NULL, 10),

  ('meeting.answered', 'diary',
   'Somebody answers your invitation',
   'They accepted, declined, or could not make it.',
   'personal', 'info', TRUE, TRUE, NULL, FALSE,
   '{n} people answered your invitations', 20),

  ('meeting.proposed', 'diary',
   'Somebody suggests a different time',
   'The ball is back with you and the meeting has not moved yet.',
   'personal', 'attention', TRUE, TRUE, NULL, FALSE, NULL, 30),

  ('meeting.moved', 'diary',
   'A meeting you are on moves',
   'The time changed after you had already accepted it.',
   'personal', 'attention', TRUE, TRUE, NULL, FALSE, NULL, 40),

  ('meeting.cancelled', 'diary',
   'A meeting you are on is called off',
   'So the hour goes back in your day rather than staying blocked.',
   'personal', 'attention', TRUE, TRUE, NULL, FALSE, NULL, 50),

  ('meeting.soon', 'diary',
   'A meeting is about to start',
   'An hour before, once, with who is coming and what it is about.',
   'personal', 'urgent', TRUE, TRUE, NULL, TRUE, NULL, 60),

  ('call.soon', 'diary',
   'A call is due',
   'The same hour ahead notice, for anything booked as a call.',
   'personal', 'urgent', TRUE, TRUE, NULL, TRUE, NULL, 70),

  ('diary.today', 'diary',
   'What is on today',
   'One notification first thing, listing the day. Nothing if the day is empty.',
   'personal', 'info', TRUE, TRUE, NULL, TRUE,
   '{n} things in your diary today', 80),

  ('guest.answered', 'diary',
   'A guest answers an invitation',
   'Somebody outside the business who you put on a meeting.',
   'personal', 'info', TRUE, TRUE, NULL, FALSE,
   '{n} guests answered', 90),

  -- ---- Work ----
  ('task.assigned', 'work',
   'A task is put on you',
   'Assigned by somebody else, or handed over.',
   'personal', 'attention', TRUE, TRUE, 'work.view', FALSE,
   '{n} tasks were put on you', 110),

  ('task.due', 'work',
   'A task is due today',
   'One notification on the morning it is due.',
   'personal', 'attention', TRUE, TRUE, 'work.view', TRUE,
   '{n} tasks are due today', 120),

  ('task.overdue', 'work',
   'A task has gone past its date',
   'Once, the morning after. Not every morning forever.',
   'personal', 'urgent', TRUE, TRUE, 'work.view', TRUE,
   '{n} tasks are past their date', 130),

  ('task.release_requested', 'work',
   'Somebody asks to hand a task back',
   'They cannot take it and are asking you to place it elsewhere.',
   'personal', 'attention', TRUE, TRUE, 'work.reassign', FALSE,
   '{n} people asked to hand tasks back', 140),

  ('task.released', 'work',
   'A task you asked to hand back was moved',
   'Somebody has taken the decision, either way.',
   'personal', 'info', TRUE, TRUE, 'work.view', FALSE, NULL, 150),

  -- ---- CRM ----
  ('crm.account_assigned', 'crm',
   'An account is assigned to you',
   'Assign several at once and it arrives as one notification with all of them in it.',
   'personal', 'attention', TRUE, TRUE, 'crm.view', FALSE,
   '{n} accounts were assigned to you', 210),

  ('crm.lead_assigned', 'crm',
   'A prospect is put on your tracker',
   'A lead somebody else raised and handed to you.',
   'personal', 'attention', TRUE, TRUE, 'crm.view', FALSE,
   '{n} prospects were put on your tracker', 220),

  ('crm.winback', 'crm',
   'A lost deal is worth another go',
   'Six months after a lead was marked lost, once, with what it was worth.',
   'personal', 'info', TRUE, TRUE, 'crm.view', TRUE,
   '{n} lost deals are worth another go', 230),

  ('crm.dormant', 'crm',
   'A prospect has gone quiet',
   'Nothing logged against an open lead for six weeks.',
   'personal', 'info', TRUE, TRUE, 'crm.view', TRUE,
   '{n} prospects have gone quiet', 240),

  ('crm.import_finished', 'crm',
   'An import you ran finished',
   'How many went in, how many were skipped and why.',
   'personal', 'info', TRUE, TRUE, 'crm.import', TRUE, NULL, 250),

  ('crm.export_ready', 'crm',
   'An export you ran is ready',
   'Kept here so you can download it again if you lose the file.',
   'personal', 'info', TRUE, TRUE, 'crm.export', TRUE, NULL, 260),

  -- ---- Content ----
  ('content.review_requested', 'content',
   'A post is waiting for your approval',
   'Somebody has submitted something and cannot publish it until you look.',
   'personal', 'attention', TRUE, TRUE, 'social.approve', FALSE,
   '{n} posts are waiting for your approval', 310),

  ('content.approved', 'content',
   'A post of yours was approved',
   'It can be scheduled.',
   'personal', 'info', TRUE, TRUE, 'social.draft', FALSE, NULL, 320),

  ('content.rejected', 'content',
   'A post of yours was sent back',
   'With the reason, so it can be fixed rather than guessed at.',
   'personal', 'attention', TRUE, TRUE, 'social.draft', FALSE, NULL, 330),

  ('content.due', 'content',
   'A post is about to go out',
   'An hour before a scheduled post publishes.',
   'personal', 'info', FALSE, TRUE, 'social.schedule', TRUE,
   '{n} posts go out within the hour', 340),

  -- ---- Sales ----
  ('sales.commission', 'sales',
   'A trailer you sold is marked sold',
   'Confirm the commission, with the unit, the price and the margin on the notification.',
   'personal', 'attention', TRUE, TRUE, NULL, TRUE, NULL, 410),

  ('sales.milestone_close', 'sales',
   'You are close to a monthly figure',
   'At four fifths of target, once in the month, with what is left to do.',
   'personal', 'info', TRUE, TRUE, NULL, TRUE, NULL, 420),

  ('sales.milestone_hit', 'sales',
   'You hit a monthly figure',
   'Worth saying out loud.',
   'personal', 'info', TRUE, TRUE, NULL, TRUE, NULL, 430),

  -- ---- FleetSmart+ ----
  ('fleetsmart.renewal', 'fleetsmart',
   'A contract is coming up for renewal',
   'A month out, a fortnight out, a week out, and the day it lapses.',
   'personal', 'attention', TRUE, TRUE, 'fleetsmart.view', TRUE,
   '{n} contracts are coming up for renewal', 510),

  ('fleetsmart.decided', 'fleetsmart',
   'A contract you sent was answered',
   'Accepted or declined, with whatever they said.',
   'personal', 'attention', TRUE, TRUE, 'fleetsmart.view', FALSE, NULL, 520),

  -- ---- Admin, and the two that cannot be silenced ----
  ('admin.role_changed', 'admin',
   'Your role or permissions change',
   'Cannot be turned off. It changes what the application will let you do.',
   'personal', 'urgent', TRUE, FALSE, NULL, FALSE, NULL, 610),

  ('system.alert', 'admin',
   'Something needs an administrator',
   'Cannot be turned off.',
   'personal', 'urgent', TRUE, FALSE, NULL, TRUE, NULL, 620),

  ('system.sync_failure', 'admin',
   'A scheduled job failed',
   'A feed, an import or a sync that did not finish.',
   'personal', 'attention', TRUE, TRUE, 'admin.settings', TRUE,
   '{n} jobs failed', 630),

  ('system.message', 'admin',
   'A message from an administrator',
   'Somebody telling everybody something.',
   'personal', 'info', TRUE, TRUE, NULL, FALSE, NULL, 640),

  ('analytics.anomaly', 'admin',
   'A customer''s numbers move sharply',
   'A spike or a drop against the same month last year.',
   'personal', 'info', TRUE, TRUE, 'crm.viewGlobal', TRUE,
   '{n} accounts moved sharply', 650),

  -- ---- Team ----
  --
  -- Everything above is about you or waiting on you. These are about
  -- the business, they are off by default, and they are the reason the
  -- feed has two tabs: somebody who wants to see every deal landing can
  -- have it without it burying the four things actually on them.
  ('team.trailer_sold', 'team',
   'A trailer is sold',
   'Anywhere in the business, whoever sold it.',
   'team', 'info', FALSE, TRUE, NULL, TRUE,
   '{n} trailers were sold', 710),

  ('team.contract_won', 'team',
   'A FleetSmart+ contract is accepted',
   'Whoever it was for and whoever sent it.',
   'team', 'info', FALSE, TRUE, 'fleetsmart.view', TRUE,
   '{n} contracts were accepted', 720),

  ('team.account_created', 'team',
   'A new account goes into the CRM',
   'Off by default. It is a lot of notifications on an import day.',
   'team', 'info', FALSE, TRUE, 'crm.viewGlobal', TRUE,
   '{n} accounts were added', 730),

  ('team.milestone_hit', 'team',
   'The business hits a monthly figure',
   'The company number, not yours.',
   'team', 'info', FALSE, TRUE, NULL, TRUE, NULL, 740)

ON CONFLICT (key) DO UPDATE SET
  category     = EXCLUDED.category,
  label        = EXCLUDED.label,
  blurb        = EXCLUDED.blurb,
  audience     = EXCLUDED.audience,
  severity     = EXCLUDED.severity,
  default_on   = EXCLUDED.default_on,
  may_mute     = EXCLUDED.may_mute,
  capability   = EXCLUDED.capability,
  self_ok      = EXCLUDED.self_ok,
  bundle_title = EXCLUDED.bundle_title,
  sort_order   = EXCLUDED.sort_order;


-- -------------------------------------------------------------
-- 4. The notification itself.
--
-- Migration 001 built five columns and this adds nine. Additive rather
-- than a rebuild, because the rows already in there are real: a
-- meeting invitation somebody has not read yet is not something to
-- drop on the way past.
-- -------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience     TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity     TEXT NOT NULL DEFAULT 'info';

-- What bunches with what. Null never bunches.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_key    TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS item_count   INT NOT NULL DEFAULT 1;

-- What it is about, so a screen can offer the right buttons without
-- parsing the title. `subject_kind` is a word, not a table name: an
-- invitation points at a meeting, and whether that lives in one table
-- or three is not the notification's business.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_kind TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_id   UUID;

-- Everything the card needs to draw itself without a second query: the
-- unit and the margin on a commission, the file on an export, the
-- accounts inside a bunch.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payload      JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Who caused it, so somebody is not told about their own doing.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id     UUID REFERENCES auth.users ON DELETE SET NULL;

-- Answered, and how. Separate from read: reading an invitation is not
-- accepting it, and a card that disappears on being read loses the
-- thing that was waiting on you.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actioned_at  TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_taken TEXT;

-- When it becomes visible. Null is now. This is how quiet hours work
-- and how the renewal ladder is written four times in advance rather
-- than being recomputed by something that has to keep running.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS due_at       TIMESTAMPTZ;

-- When it stops being worth reading. An hour ahead notice about a
-- meeting that finished yesterday is landfill.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;

-- Bumped when a bunch grows, so a growing bunch rises back to the top.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- What makes a swept notification the same notification. The sweep runs
-- again and again over the same contracts and the same meetings, and
-- this is what stops the fourth run being the fourth copy.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key   TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_audience_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_audience_check
  CHECK (audience IN ('personal', 'team'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_severity_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_severity_check
  CHECK (severity IN ('info', 'attention', 'urgent'));

/* The constraint that listed the old kinds goes FIRST, before anything
   is renamed.

   The order matters and getting it wrong is what this comment is for.
   `notifications_kind_check` allows eleven strings and none of the new
   dotted ones, so renaming a row to `crm.account_assigned` while it is
   still in force fails the whole migration on the first existing row:

     new row for relation "notifications" violates check constraint
     "notifications_kind_check"

   Which is exactly what happened on the live database, on a demo row
   left over from seeding, and did not happen on the disposable one
   because that starts with an empty table and the rename touched
   nothing. A migration that only works on a database with no data in
   it is not a migration.

   Dropped rather than replaced. Not a foreign key either: a kind being
   retired should not take a person's history with it, and ON DELETE SET
   NULL is not available on a NOT NULL column. `notify` checks the
   catalogue itself and refuses, which is the check that matters,
   because it happens before the row is written rather than after
   somebody tidies the catalogue. */
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

/* And now the old kinds become the new ones.

   Eleven strings, written across two migrations, and every one of them
   has a row in the catalogue above under a dotted name. Anything
   unrecognised becomes a system alert rather than being deleted: a
   notification whose kind nobody wrote down is still a notification
   somebody was sent. */
UPDATE notifications SET kind = CASE kind
  WHEN 'lead_assigned'     THEN 'crm.account_assigned'
  WHEN 'message'           THEN 'system.message'
  WHEN 'system_alert'      THEN 'system.alert'
  WHEN 'sync_failure'      THEN 'system.sync_failure'
  WHEN 'yoy_anomaly'       THEN 'analytics.anomaly'
  WHEN 'meeting_invited'   THEN 'meeting.invited'
  WHEN 'meeting_accepted'  THEN 'meeting.answered'
  WHEN 'meeting_declined'  THEN 'meeting.answered'
  WHEN 'meeting_proposed'  THEN 'meeting.proposed'
  WHEN 'meeting_cancelled' THEN 'meeting.cancelled'
  WHEN 'meeting_moved'     THEN 'meeting.moved'
  ELSE kind
END
WHERE kind NOT IN (SELECT key FROM notification_kinds);

UPDATE notifications SET kind = 'system.alert'
WHERE kind NOT IN (SELECT key FROM notification_kinds);

-- What the bell asks for: mine, live, unread, newest first.
CREATE INDEX IF NOT EXISTS idx_notifications_live
  ON notifications (user_id, updated_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

-- What bunching asks for.
CREATE INDEX IF NOT EXISTS idx_notifications_bunch
  ON notifications (user_id, kind, group_key, updated_at DESC)
  WHERE group_key IS NOT NULL AND read_at IS NULL AND dismissed_at IS NULL;

-- What the sweep asks for, and what makes it idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_due
  ON notifications (due_at)
  WHERE due_at IS NOT NULL;


-- -------------------------------------------------------------
-- 5. What somebody wants to hear about.
--
-- A row per person per kind, written only when it differs from the
-- catalogue default. So a fresh account has none of these and gets the
-- defaults, and turning one off is one row rather than thirty eight.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id    UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  kind       TEXT REFERENCES notification_kinds(key) ON DELETE CASCADE NOT NULL,
  enabled    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind)
);

ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_prefs_own" ON notification_prefs;
CREATE POLICY "notification_prefs_own" ON notification_prefs
  FOR ALL USING (user_id = current_actor())
  WITH CHECK (user_id = current_actor());

REVOKE ALL ON notification_prefs FROM anon;

-- The settings that are not per kind.
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id       UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,

  -- Everything off until this passes. For a week off, rather than
  -- turning thirty toggles off and forgetting which were on.
  muted_until   TIMESTAMPTZ,

  -- Hours of the day, 0 to 23. Anything not urgent that arrives inside
  -- them waits until `quiet_to`. Equal values mean no quiet hours,
  -- which is the default: 0 and 0.
  quiet_from    SMALLINT NOT NULL DEFAULT 0 CHECK (quiet_from BETWEEN 0 AND 23),
  quiet_to      SMALLINT NOT NULL DEFAULT 0 CHECK (quiet_to   BETWEEN 0 AND 23),

  -- How long two of the same thing count as one thing. Ten minutes
  -- covers somebody selecting rows and assigning them, which is the
  -- case this exists for. Zero turns bunching off entirely.
  bundle_minutes INT NOT NULL DEFAULT 10 CHECK (bundle_minutes BETWEEN 0 AND 240),

  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_settings_own" ON notification_settings;
CREATE POLICY "notification_settings_own" ON notification_settings
  FOR ALL USING (user_id = current_actor())
  WITH CHECK (user_id = current_actor());

REVOKE ALL ON notification_settings FROM anon;


-- -------------------------------------------------------------
-- 6. Does this person want this.
--
-- Three questions in order, and the order is what makes the
-- unmutable ones unmutable: the capability gate is above the
-- preference, so somebody who cannot approve posts is never asked
-- whether they want to hear about approvals, and `may_mute` is checked
-- before the preference row so a stale row from before a kind was
-- locked cannot silence it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_wanted(p_user UUID, p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  k        notification_kinds;
  chosen   BOOLEAN;
  muted    TIMESTAMPTZ;
BEGIN
  SELECT * INTO k FROM notification_kinds WHERE key = p_kind;
  IF k IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Somebody who cannot do the thing is not told about the thing.
  IF k.capability IS NOT NULL AND NOT actor_holds(p_user, k.capability) THEN
    RETURN FALSE;
  END IF;

  -- Locked kinds ignore everything below, including a mute.
  IF NOT k.may_mute THEN
    RETURN TRUE;
  END IF;

  SELECT muted_until INTO muted FROM notification_settings WHERE user_id = p_user;
  IF muted IS NOT NULL AND muted > NOW() THEN
    RETURN FALSE;
  END IF;

  SELECT enabled INTO chosen
  FROM notification_prefs WHERE user_id = p_user AND kind = p_kind;

  RETURN COALESCE(chosen, k.default_on);
END;
$fn$;

REVOKE ALL ON FUNCTION notification_wanted(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_wanted(UUID, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 7. When it should land.
--
-- Now, unless the person has quiet hours and this is not urgent, in
-- which case the moment they end.
--
-- Written as a separate function because the arithmetic has a corner:
-- quiet hours that cross midnight, 21 to 7, are not a range you can
-- write as BETWEEN. Somebody reading `notify` should not have to hold
-- that in their head to follow what it does.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_lands_at(p_user UUID, p_severity TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  s        notification_settings;
  hour_now INT := EXTRACT(HOUR FROM NOW())::INT;
  quiet    BOOLEAN;
  landing  TIMESTAMPTZ;
BEGIN
  IF p_severity = 'urgent' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO s FROM notification_settings WHERE user_id = p_user;
  IF s IS NULL OR s.quiet_from = s.quiet_to THEN
    RETURN NULL;
  END IF;

  quiet := CASE
    WHEN s.quiet_from < s.quiet_to
      THEN hour_now >= s.quiet_from AND hour_now < s.quiet_to
    -- Crosses midnight: 21 to 7 is late evening OR early morning.
    ELSE hour_now >= s.quiet_from OR hour_now < s.quiet_to
  END;

  IF NOT quiet THEN
    RETURN NULL;
  END IF;

  landing := date_trunc('day', NOW()) + (s.quiet_to || ' hours')::INTERVAL;
  -- Already past today, so it is tomorrow morning.
  IF landing <= NOW() THEN
    landing := landing + INTERVAL '1 day';
  END IF;
  RETURN landing;
END;
$fn$;

REVOKE ALL ON FUNCTION notification_lands_at(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_lands_at(UUID, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 8. Telling somebody.
--
-- The one way anything in this application says anything to anybody.
--
-- SECURITY DEFINER, because the thing raising a notification is
-- usually acting on its own behalf rather than the recipient's: a
-- trailer being marked sold has to be able to write a row belonging to
-- the rep, and the rep is not in the room.
--
-- Every caller passes the actor. Without it, "do not tell somebody
-- about their own doing" cannot be enforced anywhere except in each of
-- the thirty callers, which means it is enforced in about nineteen.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify(
  p_user       UUID,
  p_kind       TEXT,
  p_title      TEXT,
  p_body       TEXT    DEFAULT NULL,
  p_link       TEXT    DEFAULT NULL,
  p_actor      UUID    DEFAULT NULL,
  p_subject_kind TEXT  DEFAULT NULL,
  p_subject_id UUID    DEFAULT NULL,
  p_payload    JSONB   DEFAULT '{}'::JSONB,
  p_group_key  TEXT    DEFAULT NULL,
  p_dedupe_key TEXT    DEFAULT NULL,
  p_due_at     TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  k        notification_kinds;
  window_m INT;
  existing notifications;
  fresh_id UUID;
  landing  TIMESTAMPTZ;
  item     JSONB;
  existing_items JSONB;
BEGIN
  IF p_user IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO k FROM notification_kinds WHERE key = p_kind;
  IF k IS NULL THEN
    RAISE EXCEPTION 'there is no notification kind called %. Add it to notification_kinds first.', p_kind;
  END IF;

  -- You did it. You know.
  IF p_actor IS NOT NULL AND p_actor = p_user AND NOT k.self_ok THEN
    RETURN NULL;
  END IF;

  IF NOT notification_wanted(p_user, p_kind) THEN
    RETURN NULL;
  END IF;

  -- When it becomes visible. Worked out before the bunching lookup,
  -- because whether two things bunch depends on whether they land
  -- together. See the condition below.
  landing := COALESCE(p_due_at, notification_lands_at(p_user, k.severity));

  -- ---- Does it join something already there ----
  --
  -- Three conditions, and the third is the one worth explaining.
  --
  -- Live, because bunching into something already read would change a
  -- notification somebody has dealt with and they would never see the
  -- addition.
  --
  -- Inside the window, because that is what "in one breath" means.
  --
  -- And landing at the same moment. Without that last one, the four
  -- renewal reminders a contract books when it is accepted, a month
  -- out, a fortnight, a week and the day it lapses, are written in the
  -- same instant under one group key and collapse into a single
  -- notification saying four, which then lands once and says nothing on
  -- the other three dates. The check caught it saying "the renewal
  -- ladder has 1 rung rather than 4".
  --
  -- Comparing the landing time rather than refusing to bunch anything
  -- scheduled is what keeps quiet hours working: two accounts assigned
  -- at eleven at night are both held to seven in the morning, land at
  -- the same computed moment, and still arrive as one notification
  -- saying two.
  IF p_group_key IS NOT NULL AND k.bundle_title IS NOT NULL THEN
    SELECT COALESCE(bundle_minutes, 10) INTO window_m
      FROM notification_settings WHERE user_id = p_user;
    window_m := COALESCE(window_m, 10);

    IF window_m > 0 THEN
      SELECT * INTO existing
        FROM notifications
       WHERE user_id = p_user
         AND kind = p_kind
         AND group_key = p_group_key
         AND read_at IS NULL
         AND dismissed_at IS NULL
         AND actioned_at IS NULL
         AND updated_at > NOW() - (window_m || ' minutes')::INTERVAL
         AND due_at IS NOT DISTINCT FROM landing
       ORDER BY updated_at DESC
       LIMIT 1;
    END IF;
  END IF;

  IF existing.id IS NOT NULL THEN
    /* One line per thing in the bunch, so the card can list what it
       is counting rather than only how many. Capped, because a bunch
       of four hundred is a number and a link, not four hundred lines,
       and the payload should not grow without bound either. */
    item := jsonb_build_object(
      'title', p_title,
      'body',  p_body,
      'link',  p_link,
      'id',    p_subject_id
    );

    /* The first one to arrive was written as an ordinary single
       notification, so it is not in the list yet. Seeding from the row
       itself is what stops a bunch of two listing one, which is a
       count that contradicts the thing under it.

       It works because this branch only ever sees the singular title:
       the moment a bunch forms, `items` exists, and the COALESCE stops
       looking at the row. */
    existing_items := COALESCE(
      existing.payload -> 'items',
      jsonb_build_array(jsonb_build_object(
        'title', existing.title,
        'body',  existing.body,
        'link',  existing.link_path,
        'id',    existing.subject_id
      ))
    );

    UPDATE notifications SET
      item_count = item_count + 1,
      title      = replace(k.bundle_title, '{n}', (item_count + 1)::TEXT),
      body       = NULL,
      payload    = CASE
                     WHEN jsonb_array_length(existing_items) >= 25
                       THEN jsonb_set(payload, '{items}', existing_items, TRUE)
                     ELSE jsonb_set(payload, '{items}', existing_items || item, TRUE)
                   END,
      -- A bunch points at the list rather than at whichever one
      -- happened to be first, where the caller gave one.
      link_path  = COALESCE(payload ->> 'allLink', link_path),
      updated_at = NOW()
    WHERE id = existing.id
    RETURNING id INTO fresh_id;

    RETURN fresh_id;
  END IF;

  -- ---- A new one ----
  INSERT INTO notifications (
    user_id, kind, title, body, link_path,
    audience, severity, group_key, item_count,
    subject_kind, subject_id, payload, actor_id,
    due_at, expires_at, dedupe_key, created_at, updated_at
  ) VALUES (
    p_user, p_kind, p_title, p_body, p_link,
    k.audience, k.severity, p_group_key, 1,
    p_subject_kind, p_subject_id, COALESCE(p_payload, '{}'::JSONB), p_actor,
    landing, p_expires_at, p_dedupe_key, NOW(), NOW()
  )
  /* The sweep runs over the same contracts every few minutes. Second
     time round, this is where it stops. */
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO fresh_id;

  RETURN fresh_id;
END;
$fn$;

REVOKE ALL ON FUNCTION notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
                              JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
                                 JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
                           JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'The one way anything tells anybody anything. Checks the catalogue, '
  'the capability, the preference and the mute, bunches on group_key, '
  'and holds non urgent things out of quiet hours.';


-- -------------------------------------------------------------
-- 9. Telling everybody who can do a thing.
--
-- For the ones with no named recipient: a post is waiting for whoever
-- approves posts, and which of the three that is depends on who holds
-- the capability today rather than on a list written when the feature
-- was built.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_capability(
  p_capability TEXT,
  p_kind       TEXT,
  p_title      TEXT,
  p_body       TEXT    DEFAULT NULL,
  p_link       TEXT    DEFAULT NULL,
  p_actor      UUID    DEFAULT NULL,
  p_subject_kind TEXT  DEFAULT NULL,
  p_subject_id UUID    DEFAULT NULL,
  p_payload    JSONB   DEFAULT '{}'::JSONB,
  p_group_key  TEXT    DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  who  RECORD;
  sent INT := 0;
BEGIN
  FOR who IN
    SELECT id FROM profiles WHERE COALESCE(is_active, TRUE)
  LOOP
    IF p_capability IS NULL OR actor_holds(who.id, p_capability) THEN
      IF notify(who.id, p_kind, p_title, p_body, p_link, p_actor,
                p_subject_kind, p_subject_id, p_payload, p_group_key) IS NOT NULL THEN
        sent := sent + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN sent;
END;
$fn$;

REVOKE ALL ON FUNCTION notify_capability(TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
                                         TEXT, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_capability(TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
                                            TEXT, UUID, JSONB, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 10. Reading them.
--
-- One function rather than a policy and a client side query, because
-- "live" is four conditions and getting one of them wrong on one
-- screen is how the bell and the page end up disagreeing about the
-- number.
--
-- Live means: mine, its time has come, it has not expired, and it has
-- not been dismissed.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_feed(
  p_audience TEXT DEFAULT 'personal',
  p_unread   BOOLEAN DEFAULT FALSE,
  p_limit    INT DEFAULT 50
)
RETURNS SETOF notifications
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $fn$
  SELECT *
    FROM notifications
   WHERE user_id = current_actor()
     AND dismissed_at IS NULL
     AND (due_at IS NULL OR due_at <= NOW())
     AND (expires_at IS NULL OR expires_at > NOW())
     AND (p_audience = 'all' OR audience = p_audience)
     AND (NOT p_unread OR read_at IS NULL)
   ORDER BY
     -- Anything still waiting on you, above anything that is not.
     (actioned_at IS NULL AND severity IN ('urgent', 'attention')) DESC,
     updated_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
$fn$;

REVOKE ALL ON FUNCTION notification_feed(TEXT, BOOLEAN, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_feed(TEXT, BOOLEAN, INT) TO authenticated;

/* The number on the bell. Personal and team counted separately, so
   somebody who has turned the team feed on does not see a nine when
   two of those are actually on them. */
CREATE OR REPLACE FUNCTION notification_counts()
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'personal', COUNT(*) FILTER (WHERE audience = 'personal' AND read_at IS NULL),
    'team',     COUNT(*) FILTER (WHERE audience = 'team'     AND read_at IS NULL),
    'waiting',  COUNT(*) FILTER (WHERE read_at IS NULL AND actioned_at IS NULL
                                   AND severity IN ('urgent', 'attention'))
  )
  FROM notifications
  WHERE user_id = current_actor()
    AND dismissed_at IS NULL
    AND (due_at IS NULL OR due_at <= NOW())
    AND (expires_at IS NULL OR expires_at > NOW())
$fn$;

REVOKE ALL ON FUNCTION notification_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_counts() TO authenticated;


-- -------------------------------------------------------------
-- 11. Doing something with one.
--
-- Read, dismissed and actioned are three different things and the
-- screen needs all three. Read is "I have seen this". Dismissed is
-- "and I do not want it in the list". Actioned is "and the thing it
-- was asking for is done", which is what stops an invitation you have
-- accepted from still looking like a question.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_read(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  UPDATE notifications SET read_at = NOW()
   WHERE user_id = current_actor()
     AND id = ANY (p_ids)
     AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION notification_read_all(p_audience TEXT DEFAULT 'personal')
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  UPDATE notifications SET read_at = NOW()
   WHERE user_id = current_actor()
     AND read_at IS NULL
     AND dismissed_at IS NULL
     AND (due_at IS NULL OR due_at <= NOW())
     AND (p_audience = 'all' OR audience = p_audience);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION notification_dismiss(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  UPDATE notifications SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW())
   WHERE user_id = current_actor()
     AND id = ANY (p_ids)
     AND dismissed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

/* Marking one answered. What was done is recorded rather than only
   that something was: a commission confirmed and a commission queried
   are both "actioned" and the difference is the whole point. */
CREATE OR REPLACE FUNCTION notification_acted(p_id UUID, p_what TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  UPDATE notifications
     SET actioned_at = NOW(), action_taken = p_what,
         read_at = COALESCE(read_at, NOW()), updated_at = NOW()
   WHERE user_id = current_actor() AND id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION notification_read(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_read_all(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_dismiss(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_acted(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_read(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION notification_read_all(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION notification_dismiss(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION notification_acted(UUID, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 12. The settings screen, as one call each way.
--
-- Every toggle the person is allowed to see, with where it currently
-- stands and why. The screen renders this and nothing else, so a kind
-- added to the catalogue appears on the settings screen without a
-- line of TypeScript changing.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_choices()
RETURNS TABLE (
  key TEXT, category TEXT, label TEXT, blurb TEXT,
  audience TEXT, severity TEXT, may_mute BOOLEAN,
  enabled BOOLEAN, is_default BOOLEAN, sort_order INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT
    k.key, k.category, k.label, k.blurb,
    k.audience, k.severity, k.may_mute,
    CASE WHEN NOT k.may_mute THEN TRUE
         ELSE COALESCE(p.enabled, k.default_on) END,
    p.enabled IS NULL,
    k.sort_order
  FROM notification_kinds k
  LEFT JOIN notification_prefs p
    ON p.kind = k.key AND p.user_id = current_actor()
  WHERE k.capability IS NULL
     OR actor_holds(current_actor(), k.capability)
  ORDER BY k.sort_order
$fn$;

CREATE OR REPLACE FUNCTION notification_choose(p_kind TEXT, p_enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  k  notification_kinds;
  me UUID := current_actor();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'nobody is signed in';
  END IF;

  SELECT * INTO k FROM notification_kinds WHERE key = p_kind;
  IF k IS NULL THEN
    RAISE EXCEPTION 'there is no notification called %', p_kind;
  END IF;
  IF NOT k.may_mute THEN
    RAISE EXCEPTION '% cannot be turned off. %', k.label, k.blurb;
  END IF;
  IF k.capability IS NOT NULL AND NOT actor_holds(me, k.capability) THEN
    RAISE EXCEPTION 'that notification is not one of yours to set';
  END IF;

  INSERT INTO notification_prefs (user_id, kind, enabled)
  VALUES (me, p_kind, p_enabled)
  ON CONFLICT (user_id, kind) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_at = NOW();

  RETURN p_enabled;
END;
$fn$;

/* A whole category at once, because thirty toggles with no way to say
   "none of the team stuff" is thirty clicks. */
CREATE OR REPLACE FUNCTION notification_choose_category(p_category TEXT, p_enabled BOOLEAN)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me UUID := current_actor();
  n  INT;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'nobody is signed in';
  END IF;

  INSERT INTO notification_prefs (user_id, kind, enabled)
  SELECT me, k.key, p_enabled
    FROM notification_kinds k
   WHERE k.category = p_category
     AND k.may_mute
     AND (k.capability IS NULL OR actor_holds(me, k.capability))
  ON CONFLICT (user_id, kind) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_at = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION notification_settings_set(
  p_quiet_from SMALLINT DEFAULT NULL,
  p_quiet_to   SMALLINT DEFAULT NULL,
  p_bundle     INT      DEFAULT NULL,
  p_muted_until TIMESTAMPTZ DEFAULT NULL,
  p_clear_mute BOOLEAN  DEFAULT FALSE
)
RETURNS notification_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me  UUID := current_actor();
  out notification_settings;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'nobody is signed in';
  END IF;

  INSERT INTO notification_settings (user_id) VALUES (me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE notification_settings SET
    quiet_from     = COALESCE(p_quiet_from, quiet_from),
    quiet_to       = COALESCE(p_quiet_to, quiet_to),
    bundle_minutes = COALESCE(p_bundle, bundle_minutes),
    muted_until    = CASE WHEN p_clear_mute THEN NULL
                          ELSE COALESCE(p_muted_until, muted_until) END,
    updated_at     = NOW()
  WHERE user_id = me
  RETURNING * INTO out;

  RETURN out;
END;
$fn$;

REVOKE ALL ON FUNCTION notification_choices() FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_choose(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_choose_category(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_settings_set(SMALLINT, SMALLINT, INT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_choices() TO authenticated;
GRANT EXECUTE ON FUNCTION notification_choose(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION notification_choose_category(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION notification_settings_set(SMALLINT, SMALLINT, INT, TIMESTAMPTZ, BOOLEAN) TO authenticated;


-- -------------------------------------------------------------
-- 13. Row level security on the notifications themselves.
--
-- Migration 001 wrote one FOR ALL policy, which let a browser insert
-- rows for itself. That was harmless when nothing read them and is not
-- now: a notification is a claim about what happened, and a person who
-- can write their own can write "your role is now admin" and then find
-- out it is not, which wastes an afternoon.
--
-- So it splits. Read and update your own, and inserting goes through
-- `notify`, which is SECURITY DEFINER and asks the catalogue first.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_own" ON notifications;

DROP POLICY IF EXISTS "notifications_read_own" ON notifications;
CREATE POLICY "notifications_read_own" ON notifications
  FOR SELECT USING (user_id = current_actor());

DROP POLICY IF EXISTS "notifications_answer_own" ON notifications;
CREATE POLICY "notifications_answer_own" ON notifications
  FOR UPDATE USING (user_id = current_actor())
  WITH CHECK (user_id = current_actor());

DROP POLICY IF EXISTS "notifications_bin_own" ON notifications;
CREATE POLICY "notifications_bin_own" ON notifications
  FOR DELETE USING (user_id = current_actor());

REVOKE ALL ON notifications FROM anon;

COMMENT ON TABLE notifications IS
  'One row per person per thing worth saying. Written only by notify(), '
  'which checks the catalogue, the capability and the preference. '
  'A browser may read, answer and delete its own and may not write one.';
