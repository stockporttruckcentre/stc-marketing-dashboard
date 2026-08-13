-- =============================================================
-- 006. Meeting invitations that go both ways.
--
-- Until now "attendees" on a calendar event was a JSONB list of names.
-- It recorded who was supposed to be there and asked nobody. Somebody
-- invited to a meeting found out by opening the calendar, and had no way
-- to say they could not make it, let alone suggest a time that worked.
--
-- What this adds is a conversation. An invitation is sent, and the
-- person invited accepts it, declines it, or proposes a different time.
-- A proposal goes back to the organiser, who can accept it, decline it,
-- or propose something else again. That goes back and forth until
-- somebody accepts, and every round is kept, so the entry in the
-- calendar shows how the time was arrived at rather than just the time.
--
-- Two tables rather than columns on the event:
--
--   calendar_invites   one row per person per event: where they stand
--   calendar_invite_messages   one row per round: the ping and the pong
--
-- The status lives on the invite so the calendar can render it without
-- reading the history, and the history is kept separately so it can grow
-- without the invite row being rewritten.
--
-- The JSONB attendees column stays. It is what the existing form writes
-- and what the existing calendar reads, and this is additive: an event
-- with no invite rows behaves exactly as it does today.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Where each person stands on each meeting.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE NOT NULL,
  -- Who was asked.
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  -- Who asked them. Kept even if the organiser leaves, so a meeting
  -- never loses the record of where it came from.
  invited_by UUID REFERENCES auth.users ON DELETE SET NULL,

  -- pending   asked, has not said either way
  -- accepted  in their diary
  -- declined  not coming, and the organiser can see why
  -- proposed  they have suggested a different time, ball is elsewhere
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'proposed')),

  -- The time currently on the table for this person, when it differs
  -- from the event. Null once they accept, because then the event is the
  -- agreed time and two copies of it would only disagree.
  proposed_start_at TIMESTAMPTZ,
  proposed_end_at   TIMESTAMPTZ,

  -- Whose turn it is to answer. The organiser proposes, the invitee
  -- counters, and this says who is being waited on so neither of them
  -- has to work it out from the history.
  awaiting UUID REFERENCES auth.users ON DELETE SET NULL,

  -- How many times it has gone back and forth. Not a limit, just so the
  -- calendar can say "after four goes" rather than making somebody count.
  rounds INTEGER NOT NULL DEFAULT 0,

  note TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- One standing position per person per meeting. Inviting somebody
  -- twice is not a second invitation, it is the same one.
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_invites_event ON calendar_invites (event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_invites_user  ON calendar_invites (user_id, status);
CREATE INDEX IF NOT EXISTS idx_calendar_invites_waiting
  ON calendar_invites (awaiting) WHERE status IN ('pending', 'proposed');

-- -------------------------------------------------------------
-- 2. Every round of the conversation.
--
-- Append only. Nothing here is ever updated, so the entry in somebody's
-- calendar can show the whole exchange: invited Tuesday, Tom asked for
-- Thursday, Thursday declined, Friday proposed, Friday accepted.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_invite_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_id UUID REFERENCES calendar_invites(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES auth.users ON DELETE SET NULL,
  -- invited / accepted / declined / proposed / withdrawn
  action TEXT NOT NULL
    CHECK (action IN ('invited', 'accepted', 'declined', 'proposed', 'withdrawn')),
  -- The time being put forward by this round, when there is one.
  start_at TIMESTAMPTZ,
  end_at   TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_messages_invite
  ON calendar_invite_messages (invite_id, created_at);

-- -------------------------------------------------------------
-- 3. Notifications for each of those rounds.
--
-- The kinds are added to the existing CHECK rather than replacing it, so
-- nothing already written becomes invalid. Written as a drop and re-add
-- because Postgres has no ALTER CONSTRAINT for a CHECK.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN (
        'lead_assigned', 'message', 'system_alert', 'sync_failure', 'yoy_anomaly',
        'meeting_invited', 'meeting_accepted', 'meeting_declined',
        'meeting_proposed', 'meeting_cancelled', 'meeting_moved'
      ));
  END IF;
END $$;

-- -------------------------------------------------------------
-- 4. Row level security.
--
-- An invite is visible to the person invited and to the organiser, and
-- to nobody else. The person invited may change their own row, which is
-- how accepting and declining work. The organiser may change it too,
-- which is how answering a counter proposal works.
-- -------------------------------------------------------------
ALTER TABLE calendar_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_invite_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_visible_to_both_sides" ON calendar_invites;
CREATE POLICY "invites_visible_to_both_sides" ON calendar_invites
  FOR SELECT USING (user_id = auth.uid() OR invited_by = auth.uid());

DROP POLICY IF EXISTS "invites_created_by_organiser" ON calendar_invites;
CREATE POLICY "invites_created_by_organiser" ON calendar_invites
  FOR INSERT WITH CHECK (invited_by = auth.uid());

DROP POLICY IF EXISTS "invites_answered_by_either_side" ON calendar_invites;
CREATE POLICY "invites_answered_by_either_side" ON calendar_invites
  FOR UPDATE USING (user_id = auth.uid() OR invited_by = auth.uid())
  WITH CHECK (user_id = auth.uid() OR invited_by = auth.uid());

DROP POLICY IF EXISTS "invites_withdrawn_by_organiser" ON calendar_invites;
CREATE POLICY "invites_withdrawn_by_organiser" ON calendar_invites
  FOR DELETE USING (invited_by = auth.uid());

-- The history follows whatever the invite allows. Insert only, because
-- a round that has happened has happened.
DROP POLICY IF EXISTS "invite_messages_follow_the_invite" ON calendar_invite_messages;
CREATE POLICY "invite_messages_follow_the_invite" ON calendar_invite_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM calendar_invites i
            WHERE i.id = invite_id AND (i.user_id = auth.uid() OR i.invited_by = auth.uid()))
  );

DROP POLICY IF EXISTS "invite_messages_written_by_either_side" ON calendar_invite_messages;
CREATE POLICY "invite_messages_written_by_either_side" ON calendar_invite_messages
  FOR INSERT WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM calendar_invites i
                WHERE i.id = invite_id AND (i.user_id = auth.uid() OR i.invited_by = auth.uid()))
  );

-- -------------------------------------------------------------
-- 5. An invited person can see the meeting.
--
-- The existing policy shows an event to its creator, to everybody when
-- it is a team event, and to named people when it is specific. Being
-- invited is a fourth way in, and without it somebody would get a
-- notification about a meeting they cannot open.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "calendar_events_select" ON calendar_events;
CREATE POLICY "calendar_events_select" ON calendar_events
  FOR SELECT USING (
    created_by = auth.uid()
    OR visibility = 'team'
    OR (visibility = 'specific' AND auth.uid() = ANY (visible_to))
    OR EXISTS (SELECT 1 FROM calendar_invites i
               WHERE i.event_id = calendar_events.id AND i.user_id = auth.uid())
  );

-- -------------------------------------------------------------
-- 6. Keep updated_at honest.
-- -------------------------------------------------------------
DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_calendar_invites_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_calendar_invites_updated_at BEFORE UPDATE ON calendar_invites
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
