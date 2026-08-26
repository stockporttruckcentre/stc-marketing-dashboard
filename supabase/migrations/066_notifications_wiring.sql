-- =============================================================
-- 066. What actually raises a notification.
--
-- Migration 065 built the machine. This is everything that pulls the
-- lever, and it is deliberately one file: a reader asking "what will
-- this application tell me about" should get the answer by reading one
-- thing, not by grepping thirty for a call to `notify`.
--
-- ---- Triggers, not application code ----
--
-- Every one of these hangs off the table rather than off the route that
-- writes it, because the routes are not the only writers. The command
-- bar writes through `command_apply`, the CRM grid writes through
-- PostgREST, the importer writes in batches, and a person in the
-- Supabase SQL editor writes directly. A notification wired into one
-- route is a notification that four of the five ways in do not raise.
--
-- The exceptions are the two things the database cannot see: an import
-- finishing and an export being produced. Both happen in a route,
-- neither leaves a row that says so, and both call `notify` from there.
--
-- ---- Nothing here may break the thing it is watching ----
--
-- A notification is a courtesy. A trigger that raises is a trigger that
-- stops somebody accepting a meeting, and a courtesy that can do that
-- is a liability. So every trigger body is wrapped: it catches
-- everything and returns. The cost is that a broken notification is
-- silent, and that is the right trade against a broken CRM.
--
-- ---- The time based ones ----
--
-- An hour before a meeting. A month before a contract lapses. Six
-- months after a deal was lost. None of those are a row changing, so no
-- trigger can see them.
--
-- There is no scheduler in this deployment: no cron, no worker, no
-- queue. So `notification_sweep` computes them, and the bell calls it
-- on open, at most once every few minutes. That means somebody who
-- never opens the application never gets swept, which is fine: they
-- were not going to read it either.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Turning a name somebody typed into a person.
--
-- Half the CRM's ownership is a free text column holding whatever went
-- into a spreadsheet cell: "Alex", "alex ellis", "A.Ellis", an email
-- address, and a good number of blanks. `lib/crm/ownership.ts` already
-- folds those together for reading, and this is the same folding, in
-- SQL, because a trigger cannot call TypeScript.
--
-- Two implementations of one rule is how they drift, so this is stated
-- plainly rather than hidden: the assertions in
-- `scripts/sql/notify-check.sql` cover the same cases as the ones in
-- the TypeScript, and the comment above each says so.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION owner_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(COALESCE(p_text, '')), '[._-]+', ' ', 'g'),
        '[^a-z0-9@ ]+', '', 'g'),
      '\s+', ' ', 'g')
  )
$fn$;

/* The stock list holds a rep as initials: "AE" is Alex Ellis. Its own
   function rather than an expression inside the one below, because
   folding a name down to its first letters needs an aggregate over the
   words and an aggregate cannot go in a WHERE clause. */
CREATE OR REPLACE FUNCTION initials_of(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower(string_agg(left(w, 1), ''))
  FROM unnest(string_to_array(owner_key(p_name), ' ')) AS w
  WHERE w <> ''
$fn$;

/* Who a free text owner means, when it means exactly one person.

   Null for nobody, and null for more than one. Two people called Dave
   and a column saying "Dave" is not a person this can name, and
   guessing would put somebody else's accounts in somebody's
   notifications. Silence is the right answer there. */
CREATE OR REPLACE FUNCTION person_named(p_text TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  needle TEXT := owner_key(p_text);
  found  UUID;
  n      INT;
BEGIN
  IF needle = '' THEN RETURN NULL; END IF;

  /* array_agg rather than min, because Postgres has no min() for a
     uuid. Only read when the count is one, so the ordering inside the
     array never matters. */
  SELECT count(*), (array_agg(p.id))[1] INTO n, found
  FROM profiles p
  WHERE COALESCE(p.is_active, TRUE)
    AND (
      owner_key(p.full_name) = needle
      OR owner_key(p.email) = needle
      OR owner_key(split_part(p.email, '@', 1)) = needle
      OR split_part(owner_key(p.full_name), ' ', 1) = needle
      OR (length(needle) BETWEEN 2 AND 3 AND initials_of(p.full_name) = needle)
    );

  IF n = 1 THEN RETURN found; END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION owner_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION initials_of(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION person_named(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION initials_of(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION person_named(TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 2. How a name and a time read in a notification.
--
-- One place each, so the invitation, the reminder and the history
-- cannot describe the same meeting three ways.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION person_label(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(NULLIF(btrim(full_name), ''), email, 'Somebody')
  FROM profiles WHERE id = p_user
$fn$;

REVOKE ALL ON FUNCTION person_label(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_label(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 3. The diary.
--
-- Four things happen to a meeting that somebody else needs to know
-- about, and until now the application raised one of them, from the
-- command bar only. Booking a meeting through the diary screen told
-- nobody anything.
-- -------------------------------------------------------------

/* Being asked. */
CREATE OR REPLACE FUNCTION notify_on_invite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE ev RECORD;
BEGIN
  BEGIN
    SELECT title, start_at INTO ev FROM calendar_events WHERE id = NEW.event_id;

    PERFORM notify(
      NEW.user_id, 'meeting.invited',
      person_label(NEW.invited_by) || ' has asked you to ' || COALESCE(ev.title, 'a meeting'),
      command_meeting_when(ev.start_at),
      '/dashboard/calendar?event=' || NEW.event_id::TEXT,
      NEW.invited_by, 'meeting', NEW.event_id,
      jsonb_build_object('inviteId', NEW.id, 'startAt', ev.start_at)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_invite_sent ON calendar_invites;
CREATE TRIGGER notify_invite_sent
  AFTER INSERT ON calendar_invites
  FOR EACH ROW EXECUTE FUNCTION notify_on_invite();

/* Being answered. Goes to the other side of the conversation.

   Worked out from who did the answering rather than from `awaiting`.
   The first version read `awaiting`, on the reasoning that it already
   holds whose turn it is, and that is exactly wrong: accepting clears
   it to null, because after an acceptance nobody is being waited on.
   So the one case that matters most, somebody saying yes, told the
   organiser nothing. Caught by the check, which is the only reason it
   is not still doing that. */
CREATE OR REPLACE FUNCTION notify_on_invite_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  ev       RECORD;
  said     TEXT;
  who      UUID;
  answerer UUID;
  kind     TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT title, start_at INTO ev FROM calendar_events WHERE id = NEW.event_id;

    /* Two people are on an invitation and one of them just answered.
       Tell the other one. Falls back to the person invited when there
       is no session, which is how a change made in the SQL editor still
       reaches the organiser. */
    answerer := COALESCE(current_actor(), NEW.user_id);
    who := CASE WHEN answerer = NEW.invited_by THEN NEW.user_id ELSE NEW.invited_by END;
    IF who IS NULL THEN RETURN NEW; END IF;

    IF NEW.status = 'proposed' THEN
      kind := 'meeting.proposed';
      said := person_label(answerer) || ' has suggested another time for '
              || COALESCE(ev.title, 'a meeting');
    ELSE
      kind := 'meeting.answered';
      said := person_label(answerer)
              || CASE NEW.status
                   WHEN 'accepted' THEN ' is coming to '
                   WHEN 'declined' THEN ' cannot make '
                   ELSE ' has answered '
                 END
              || COALESCE(ev.title, 'your meeting');
    END IF;

    PERFORM notify(
      who, kind, said,
      COALESCE(NEW.note, command_meeting_when(COALESCE(NEW.proposed_start_at, ev.start_at))),
      '/dashboard/calendar?event=' || NEW.event_id::TEXT,
      answerer, 'meeting', NEW.event_id,
      jsonb_build_object('inviteId', NEW.id, 'status', NEW.status,
                         'proposedStartAt', NEW.proposed_start_at),
      'invite-answers:' || NEW.event_id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_invite_answered ON calendar_invites;
CREATE TRIGGER notify_invite_answered
  AFTER UPDATE ON calendar_invites
  FOR EACH ROW EXECUTE FUNCTION notify_on_invite_answer();

/* The meeting moving under everybody who had already accepted it.

   This is the one that actually matters. Somebody who said yes to
   Tuesday and finds out on Thursday that it moved has had their week
   quietly rearranged. */
CREATE OR REPLACE FUNCTION notify_on_event_moved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE who RECORD;
BEGIN
  IF NEW.start_at IS NOT DISTINCT FROM OLD.start_at THEN
    RETURN NEW;
  END IF;

  BEGIN
    FOR who IN
      SELECT user_id FROM calendar_invites WHERE event_id = NEW.id
      UNION
      SELECT unnest(NEW.visible_to) WHERE NEW.visibility = 'specific'
    LOOP
      PERFORM notify(
        who.user_id, 'meeting.moved',
        NEW.title || ' has moved',
        'It was ' || command_meeting_when(OLD.start_at)
          || '. It is now ' || command_meeting_when(NEW.start_at) || '.',
        '/dashboard/calendar?event=' || NEW.id::TEXT,
        current_actor(), 'meeting', NEW.id,
        jsonb_build_object('wasAt', OLD.start_at, 'nowAt', NEW.start_at)
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_event_moved ON calendar_events;
CREATE TRIGGER notify_event_moved
  AFTER UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION notify_on_event_moved();

/* Being called off. BEFORE, because the invitations go with it. */
CREATE OR REPLACE FUNCTION notify_on_event_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE who RECORD;
BEGIN
  BEGIN
    FOR who IN SELECT user_id FROM calendar_invites WHERE event_id = OLD.id
    LOOP
      PERFORM notify(
        who.user_id, 'meeting.cancelled',
        OLD.title || ' is off',
        'It was ' || command_meeting_when(OLD.start_at) || '. The time is yours again.',
        '/dashboard/calendar',
        current_actor(), 'meeting', OLD.id,
        jsonb_build_object('wasAt', OLD.start_at)
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_event_cancelled ON calendar_events;
CREATE TRIGGER notify_event_cancelled
  BEFORE DELETE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION notify_on_event_cancelled();

/* A guest answering. Only ever goes to whoever asked them. */
CREATE OR REPLACE FUNCTION notify_on_guest_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE ev RECORD;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.invited_by IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT title FROM calendar_events WHERE id = NEW.event_id INTO ev;
    PERFORM notify(
      NEW.invited_by, 'guest.answered',
      COALESCE(NULLIF(btrim(NEW.name), ''), NEW.email, 'A guest')
        || CASE NEW.status
             WHEN 'accepted' THEN ' is coming to '
             WHEN 'declined' THEN ' cannot make '
             WHEN 'proposed' THEN ' has suggested another time for '
             ELSE ' has answered '
           END || COALESCE(ev.title, 'your meeting'),
      NEW.note,
      '/dashboard/calendar?event=' || NEW.event_id::TEXT,
      NULL, 'meeting', NEW.event_id,
      jsonb_build_object('guest', NEW.name, 'status', NEW.status),
      'guest-answers:' || NEW.event_id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_guest_answered ON calendar_guests;
CREATE TRIGGER notify_guest_answered
  AFTER UPDATE ON calendar_guests
  FOR EACH ROW EXECUTE FUNCTION notify_on_guest_answer();


-- -------------------------------------------------------------
-- 4. Work.
--
-- A task landing on somebody, and somebody asking to hand one back.
-- Both bunch on whoever did it, so assigning six tasks in a sitting is
-- one notification with six lines rather than six notifications.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE by_who UUID := current_actor();
BEGIN
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM notify(
      NEW.assignee_id, 'task.assigned',
      NEW.title,
      CASE WHEN NEW.due_at IS NOT NULL
           THEN 'Put on you by ' || person_label(by_who) || '. Due ' || command_meeting_when(NEW.due_at) || '.'
           ELSE 'Put on you by ' || person_label(by_who) || '.' END,
      '/dashboard/work?task=' || NEW.id::TEXT,
      by_who, 'task', NEW.id,
      jsonb_build_object('dueAt', NEW.due_at, 'allLink', '/dashboard/work'),
      'task-assigned:' || COALESCE(by_who::TEXT, 'system')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_task_assigned ON tasks;
CREATE TRIGGER notify_task_assigned
  AFTER INSERT OR UPDATE OF assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_on_task_assigned();

CREATE OR REPLACE FUNCTION notify_on_release_asked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE t RECORD;
BEGIN
  BEGIN
    SELECT title FROM tasks WHERE id = NEW.task_id INTO t;

    IF NEW.asked_of IS NOT NULL THEN
      PERFORM notify(
        NEW.asked_of, 'task.release_requested',
        person_label(NEW.asked_by) || ' would like to hand back ' || COALESCE(t.title, 'a task'),
        NEW.reason,
        '/dashboard/work?task=' || NEW.task_id::TEXT,
        NEW.asked_by, 'task', NEW.task_id,
        jsonb_build_object('requestId', NEW.id, 'allLink', '/dashboard/work'),
        'release-asked:' || COALESCE(NEW.asked_by::TEXT, 'system')
      );
    ELSE
      -- Nobody named, so whoever can place work hears it.
      PERFORM notify_capability(
        'work.reassign', 'task.release_requested',
        person_label(NEW.asked_by) || ' would like to hand back ' || COALESCE(t.title, 'a task'),
        NEW.reason,
        '/dashboard/work?task=' || NEW.task_id::TEXT,
        NEW.asked_by, 'task', NEW.task_id,
        jsonb_build_object('requestId', NEW.id, 'allLink', '/dashboard/work'),
        'release-asked:' || COALESCE(NEW.asked_by::TEXT, 'system')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_release_asked ON task_delegation_requests;
CREATE TRIGGER notify_release_asked
  AFTER INSERT ON task_delegation_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_release_asked();

CREATE OR REPLACE FUNCTION notify_on_release_decided()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE t RECORD;
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state OR NEW.state = 'open' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT title FROM tasks WHERE id = NEW.task_id INTO t;
    PERFORM notify(
      NEW.asked_by, 'task.released',
      COALESCE(t.title, 'A task') || ': ' ||
      CASE NEW.state WHEN 'granted' THEN 'it has been moved off you'
                     ELSE 'it stays with you' END,
      NEW.decision_note,
      '/dashboard/work?task=' || NEW.task_id::TEXT,
      NEW.decided_by, 'task', NEW.task_id,
      jsonb_build_object('state', NEW.state)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_release_decided ON task_delegation_requests;
CREATE TRIGGER notify_release_decided
  AFTER UPDATE ON task_delegation_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_release_decided();


-- -------------------------------------------------------------
-- 5. The CRM.
--
-- The one the brief is most specific about: two rows assigned to Dean
-- is one notification saying two, with a way to open both. One row is
-- the detailed single.
--
-- Both fall out of the same call. The bunching key is who did the
-- assigning, so a person selecting rows and handing them over produces
-- one notification whatever the number, and two different people
-- assigning something to Dean in the same ten minutes produce two,
-- which is right: they are two separate conversations he is about to
-- have.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_account_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  who  UUID;
  by_who UUID := current_actor();
  size TEXT;
BEGIN
  IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  BEGIN
    who := person_named(NEW.assigned_to);
    IF who IS NULL THEN RETURN NEW; END IF;

    /* As much about the one as will fit, because a single is the case
       where detail is worth having. A bunch throws this away and keeps
       the title, which is the trade the brief asks for. */
    size := concat_ws(', ',
      NULLIF(btrim(COALESCE(NEW.location, '')), ''),
      CASE WHEN COALESCE(NEW.fleet_size, 0) > 0
           THEN NEW.fleet_size::TEXT || ' vehicles' END,
      NULLIF(btrim(COALESCE(NEW.status, '')), ''),
      CASE WHEN NEW.last_contact IS NOT NULL
           THEN 'last spoken to ' || to_char(NEW.last_contact, 'DD Mon') END
    );

    PERFORM notify(
      who, 'crm.account_assigned',
      NEW.company_name || ' is yours',
      NULLIF(size, ''),
      '/dashboard/crm?id=' || NEW.id::TEXT,
      by_who, 'account', NEW.id,
      jsonb_build_object('allLink', '/dashboard/crm?owner=me'),
      'account-assigned:' || COALESCE(by_who::TEXT, 'system')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_account_assigned ON crm_contacts;
CREATE TRIGGER notify_account_assigned
  AFTER UPDATE OF assigned_to ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION notify_on_account_assigned();

/* A prospect landing on somebody's tracker. */
CREATE OR REPLACE FUNCTION notify_on_lead_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE by_who UUID := current_actor();
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM notify(
      NEW.owner_id, 'crm.lead_assigned',
      COALESCE(NULLIF(btrim(NEW.company_name), ''), 'A prospect')
        || COALESCE(': ' || NULLIF(btrim(NEW.what), ''), '') || ' is on your tracker',
      concat_ws('. ',
        NULLIF(btrim(COALESCE(NEW.requirement, '')), ''),
        CASE WHEN NEW.estimated_value IS NOT NULL
             THEN 'Worth about ' || to_char(NEW.estimated_value, 'FM£999,999,999') END,
        NULLIF(btrim(COALESCE(NEW.next_action, '')), '')),
      '/dashboard/leads?lead=' || NEW.id::TEXT,
      by_who, 'lead', NEW.id,
      jsonb_build_object('allLink', '/dashboard/leads'),
      'lead-assigned:' || COALESCE(by_who::TEXT, 'system')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_lead_assigned ON crm_leads;
CREATE TRIGGER notify_lead_assigned
  AFTER INSERT OR UPDATE OF owner_id ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION notify_on_lead_assigned();

/* A lead going to lost books its own comeback.

   Six months out, written now rather than computed later, so the
   promise exists in the database the moment the deal is lost. The
   sweep does not have to remember to look, and somebody reading the
   row can see the reminder is already booked.

   Marked lost again inside the six months and the dedupe key holds, so
   it stays one reminder rather than becoming a queue of them. */
CREATE OR REPLACE FUNCTION notify_on_lead_lost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status <> 'lost' OR OLD.status = 'lost' OR NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM notify(
      NEW.owner_id, 'crm.winback',
      COALESCE(NULLIF(btrim(NEW.company_name), ''), 'A prospect') || ' is worth another go',
      'Marked lost six months ago'
        || COALESCE(', worth about ' || to_char(NEW.estimated_value, 'FM£999,999,999'), '')
        || '. Nothing has been raised against them since.',
      '/dashboard/leads?lead=' || NEW.id::TEXT,
      NULL, 'lead', NEW.id,
      jsonb_build_object('lostAt', NOW(), 'wasWorth', NEW.estimated_value,
                         'allLink', '/dashboard/leads?status=lost'),
      'winback',
      'winback:' || NEW.id::TEXT,
      NOW() + INTERVAL '6 months',
      NOW() + INTERVAL '9 months'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_lead_lost ON crm_leads;
CREATE TRIGGER notify_lead_lost
  AFTER UPDATE OF status ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION notify_on_lead_lost();


-- -------------------------------------------------------------
-- 6. A unit selling, and the commission on it.
--
-- The brief: a trailer marked sold where you were the rep should ask
-- you to confirm what you earned, with the trailer on the notification.
--
-- Two ways in, because the tracker and the stock list are two screens
-- that both mark things sold, and either can happen first.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_lead_won()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE unit RECORD;
BEGIN
  IF NEW.status NOT IN ('won', 'customer') OR OLD.status IN ('won', 'customer') THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS NULL OR NEW.sale_price IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT stc_no, make, model, category, year
      INTO unit FROM stock_trailers WHERE id = NEW.stock_trailer_id;

    PERFORM notify(
      NEW.owner_id, 'sales.commission',
      'Confirm your commission on '
        || COALESCE(NULLIF(btrim(unit.stc_no), ''), NEW.company_name, 'the sale'),
      concat_ws('. ',
        NULLIF(btrim(concat_ws(' ', unit.year::TEXT, unit.make, unit.model, unit.category)), ''),
        'Sold for ' || to_char(NEW.sale_price, 'FM£999,999,999')
          || COALESCE(' to ' || NULLIF(btrim(NEW.company_name), ''), ''),
        CASE WHEN NEW.profit IS NOT NULL
             THEN 'Margin ' || to_char(NEW.profit, 'FM£999,999,999')
                  || COALESCE(' (' || to_char(NEW.profit_pct, 'FM990.0') || '%)', '') END,
        CASE WHEN NEW.commission IS NOT NULL
             THEN 'Your commission works out at ' || to_char(NEW.commission, 'FM£999,999,990.00')
             ELSE 'No commission has been worked out yet' END),
      '/dashboard/leads?lead=' || NEW.id::TEXT,
      NULL, 'lead', NEW.id,
      jsonb_build_object(
        'salePrice', NEW.sale_price, 'profit', NEW.profit,
        'commission', NEW.commission, 'commissionRate', NEW.commission_rate,
        'trailer', unit.stc_no, 'confirm', TRUE),
      NULL,
      'commission:' || NEW.id::TEXT
    );

    PERFORM notify_capability(
      NULL, 'team.trailer_sold',
      COALESCE(NULLIF(btrim(unit.stc_no), ''), 'A trailer') || ' is sold',
      person_label(NEW.owner_id) || ' sold it'
        || COALESCE(' to ' || NULLIF(btrim(NEW.company_name), ''), '')
        || ' for ' || to_char(NEW.sale_price, 'FM£999,999,999') || '.',
      '/dashboard/sales',
      NEW.owner_id, 'lead', NEW.id,
      jsonb_build_object('salePrice', NEW.sale_price, 'allLink', '/dashboard/sales'),
      'sold-today'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_lead_won ON crm_leads;
CREATE TRIGGER notify_lead_won
  AFTER UPDATE OF status ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION notify_on_lead_won();

/* And the stock list's own way of saying it, for a unit sold without a
   lead behind it. The rep is initials in a text column, so this only
   fires where those initials name exactly one person. */
CREATE OR REPLACE FUNCTION notify_on_trailer_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE rep UUID;
BEGIN
  IF NEW.status <> 'sold' OR OLD.status = 'sold' THEN RETURN NEW; END IF;

  BEGIN
    -- A lead already covered this one, so saying it twice would be
    -- two notifications about one sale.
    IF EXISTS (SELECT 1 FROM crm_leads
                WHERE stock_trailer_id = NEW.id AND status IN ('won', 'customer')) THEN
      RETURN NEW;
    END IF;

    rep := person_named(NEW.sales_rep);
    IF rep IS NULL THEN RETURN NEW; END IF;

    PERFORM notify(
      rep, 'sales.commission',
      'Confirm your commission on ' || COALESCE(NULLIF(btrim(NEW.stc_no), ''), 'the sale'),
      concat_ws('. ',
        NULLIF(btrim(concat_ws(' ', NEW.year::TEXT, NEW.make, NEW.model, NEW.category)), ''),
        CASE WHEN COALESCE(NEW.sales_price, NEW.sold_price) IS NOT NULL
             THEN 'Sold for ' || to_char(COALESCE(NEW.sales_price, NEW.sold_price), 'FM£999,999,999')
                  || COALESCE(' to ' || NULLIF(btrim(NEW.customer), ''), '') END,
        CASE WHEN NEW.profit IS NOT NULL
             THEN 'Margin ' || to_char(NEW.profit, 'FM£999,999,999') END,
        'Nothing is worked out yet: open it and put the commission on'),
      '/dashboard/sales?trailer=' || NEW.id::TEXT,
      current_actor(), 'trailer', NEW.id,
      jsonb_build_object('salePrice', COALESCE(NEW.sales_price, NEW.sold_price),
                         'profit', NEW.profit, 'trailer', NEW.stc_no, 'confirm', TRUE),
      NULL,
      'commission-trailer:' || NEW.id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_trailer_sold ON stock_trailers;
CREATE TRIGGER notify_trailer_sold
  AFTER UPDATE OF status ON stock_trailers
  FOR EACH ROW EXECUTE FUNCTION notify_on_trailer_sold();


-- -------------------------------------------------------------
-- 7. Content.
--
-- A manager asked to look at a post, and the answer coming back.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_post_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE preview TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  BEGIN
    preview := left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 90);

    IF NEW.status = 'pending_review' THEN
      PERFORM notify_capability(
        'social.approve', 'content.review_requested',
        person_label(COALESCE(NEW.author_id, current_actor()))
          || ' has put a post up for approval',
        preview,
        '/dashboard/social?post=' || NEW.id::TEXT,
        COALESCE(NEW.author_id, current_actor()), 'post', NEW.id,
        jsonb_build_object('allLink', '/dashboard/social?status=pending_review'),
        'posts-to-approve'
      );

    ELSIF NEW.status = 'approved' AND NEW.author_id IS NOT NULL THEN
      PERFORM notify(
        NEW.author_id, 'content.approved',
        'Your post was approved', preview,
        '/dashboard/social?post=' || NEW.id::TEXT,
        NEW.approved_by_id, 'post', NEW.id
      );

    ELSIF NEW.status = 'draft' AND OLD.status = 'pending_review'
          AND NEW.author_id IS NOT NULL THEN
      PERFORM notify(
        NEW.author_id, 'content.rejected',
        'Your post was sent back',
        COALESCE(NEW.rejection_note, preview),
        '/dashboard/social?post=' || NEW.id::TEXT,
        current_actor(), 'post', NEW.id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_post_status ON social_posts;
CREATE TRIGGER notify_post_status
  AFTER UPDATE OF status ON social_posts
  FOR EACH ROW EXECUTE FUNCTION notify_on_post_status();


-- -------------------------------------------------------------
-- 8. FleetSmart+.
--
-- A contract being answered, and the renewal ladder that the brief
-- asks for: a month out, a fortnight, a week, and the day it lapses.
--
-- The ladder is written the moment a contract is accepted, all four at
-- once, each with its own due date and its own dedupe key. So the
-- promise exists in the database rather than depending on something
-- running every day, and a contract renewed early has its remaining
-- rungs taken back down in one statement.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_ends_on(p_contract fleetsmart_contracts)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_contract.starts_on IS NULL THEN NULL
    ELSE p_contract.starts_on + (p_contract.term_months || ' months')::INTERVAL
  END::DATE
$fn$;

CREATE OR REPLACE FUNCTION notify_on_contract_decided()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  ends  DATE;
  rung  RECORD;
  who   UUID := COALESCE(NEW.owner_id, NEW.created_by);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  BEGIN
    IF NEW.status IN ('accepted', 'declined') AND who IS NOT NULL THEN
      PERFORM notify(
        who, 'fleetsmart.decided',
        COALESCE(NEW.ref, 'A contract') || ' was '
          || CASE NEW.status WHEN 'accepted' THEN 'accepted' ELSE 'declined' END
          || ' by ' || COALESCE(NULLIF(btrim(NEW.customer_name), ''), 'the customer'),
        concat_ws('. ',
          NEW.plan || ', ' || NEW.term_months || ' months, '
            || NEW.asset_count || ' assets',
          to_char(NEW.annual_total, 'FM£999,999,990.00') || ' a year',
          NULLIF(btrim(COALESCE(NEW.decision_note, '')), '')),
        '/dashboard/fleetsmart?contract=' || NEW.id::TEXT,
        current_actor(), 'contract', NEW.id,
        jsonb_build_object('status', NEW.status, 'annualTotal', NEW.annual_total)
      );
    END IF;

    IF NEW.status = 'accepted' THEN
      PERFORM notify_capability(
        'fleetsmart.view', 'team.contract_won',
        COALESCE(NULLIF(btrim(NEW.customer_name), ''), 'A customer')
          || ' signed a ' || NEW.plan || ' contract',
        to_char(NEW.annual_total, 'FM£999,999,990.00') || ' a year over '
          || NEW.term_months || ' months.',
        '/dashboard/fleetsmart?contract=' || NEW.id::TEXT,
        who, 'contract', NEW.id,
        jsonb_build_object('annualTotal', NEW.annual_total, 'allLink', '/dashboard/fleetsmart'),
        'contracts-won'
      );

      -- ---- The ladder ----
      ends := fleetsmart_ends_on(NEW);
      IF ends IS NOT NULL AND who IS NOT NULL THEN
        FOR rung IN
          SELECT * FROM (VALUES
            ('a month',    INTERVAL '1 month',  'month'),
            ('a fortnight', INTERVAL '14 days', 'fortnight'),
            ('a week',     INTERVAL '7 days',   'week')
          ) AS t(said, ahead, tag)
        LOOP
          PERFORM notify(
            who, 'fleetsmart.renewal',
            COALESCE(NEW.ref, 'A contract') || ' for '
              || COALESCE(NULLIF(btrim(NEW.customer_name), ''), 'a customer')
              || ' runs out in ' || rung.said,
            'It ends ' || to_char(ends, 'DD Mon YYYY') || '. '
              || to_char(NEW.annual_total, 'FM£999,999,990.00')
              || ' a year, ' || NEW.asset_count
              || ' assets. Nothing has been raised to replace it.',
            '/dashboard/fleetsmart?contract=' || NEW.id::TEXT,
            NULL, 'contract', NEW.id,
            jsonb_build_object('endsOn', ends, 'stage', rung.tag,
                               'annualTotal', NEW.annual_total,
                               'allLink', '/dashboard/fleetsmart'),
            'renewals',
            'renewal:' || NEW.id::TEXT || ':' || rung.tag,
            (ends - rung.ahead)::TIMESTAMPTZ + INTERVAL '8 hours',
            ends::TIMESTAMPTZ + INTERVAL '1 day'
          );
        END LOOP;

        PERFORM notify(
          who, 'fleetsmart.renewal',
          COALESCE(NEW.ref, 'A contract') || ' for '
            || COALESCE(NULLIF(btrim(NEW.customer_name), ''), 'a customer') || ' has run out',
          'It ended ' || to_char(ends, 'DD Mon YYYY')
            || ' and nothing replaced it. That is '
            || to_char(NEW.annual_total, 'FM£999,999,990.00') || ' a year gone.',
          '/dashboard/fleetsmart?contract=' || NEW.id::TEXT,
          NULL, 'contract', NEW.id,
          jsonb_build_object('endsOn', ends, 'stage', 'expired',
                             'annualTotal', NEW.annual_total,
                             'allLink', '/dashboard/fleetsmart'),
          'renewals',
          'renewal:' || NEW.id::TEXT || ':expired',
          ends::TIMESTAMPTZ + INTERVAL '8 hours',
          ends::TIMESTAMPTZ + INTERVAL '3 months'
        );
      END IF;
    END IF;

    /* Renewed, or lapsed on purpose. The rungs that have not landed yet
       come back down: a reminder to chase something already chased is
       the fastest way to teach somebody to stop reading these. */
    IF NEW.status IN ('declined', 'expired') OR OLD.status = 'accepted' THEN
      DELETE FROM notifications
       WHERE dedupe_key LIKE 'renewal:' || OLD.id::TEXT || ':%'
         AND read_at IS NULL
         AND due_at > NOW();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_contract_decided ON fleetsmart_contracts;
CREATE TRIGGER notify_contract_decided
  AFTER UPDATE OF status ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION notify_on_contract_decided();


-- -------------------------------------------------------------
-- 9. A role changing.
--
-- The one nobody can turn off. It changes what the application will
-- let somebody do, and a person who does not know is a person who
-- files a bug about a button that has stopped working.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_role_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE was TEXT; now_is TEXT;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.role_template_id IS NOT DISTINCT FROM OLD.role_template_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    was := COALESCE((SELECT name FROM role_templates WHERE id = OLD.role_template_id), OLD.role);
    now_is := COALESCE((SELECT name FROM role_templates WHERE id = NEW.role_template_id), NEW.role);

    IF was IS NOT DISTINCT FROM now_is THEN RETURN NEW; END IF;

    PERFORM notify(
      NEW.id, 'admin.role_changed',
      'You are now ' || now_is,
      'You were ' || COALESCE(was, 'not set') || '. '
        || 'Changed by ' || person_label(current_actor())
        || '. What you can reach has changed with it.',
      '/dashboard/settings',
      current_actor(), 'person', NEW.id,
      jsonb_build_object('was', was, 'now', now_is)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notify_role_changed ON profiles;
CREATE TRIGGER notify_role_changed
  AFTER UPDATE OF role, role_template_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION notify_on_role_changed();


-- -------------------------------------------------------------
-- 10. The sweep.
--
-- Everything a trigger cannot see, because nothing changed: a meeting
-- getting closer, a task reaching its date, a prospect going quiet, a
-- monthly figure coming into reach.
--
-- Guarded so that fifty people opening the bell at nine o'clock is one
-- sweep and forty nine cheap returns. SECURITY DEFINER because it
-- writes rows belonging to everybody.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_sweeps (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
  runs         BIGINT NOT NULL DEFAULT 0,
  last_wrote   INT NOT NULL DEFAULT 0
);
INSERT INTO notification_sweeps (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

ALTER TABLE notification_sweeps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_sweeps FROM anon, authenticated;

CREATE OR REPLACE FUNCTION notification_sweep(p_force BOOLEAN DEFAULT FALSE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  last  TIMESTAMPTZ;
  wrote INT := 0;
  r     RECORD;
BEGIN
  SELECT last_run_at INTO last FROM notification_sweeps WHERE id LIMIT 1 FOR UPDATE;
  IF NOT p_force AND last > NOW() - INTERVAL '5 minutes' THEN
    RETURN -1;
  END IF;

  UPDATE notification_sweeps SET last_run_at = NOW(), runs = runs + 1 WHERE id;

  -- ---- A meeting or a call starting within the hour ----
  --
  -- Expires when the thing starts, so an alert about something that
  -- has already begun is never in the list.
  FOR r IN
    SELECT e.id, e.title, e.start_at, e.end_at, i.user_id, e.contact_id
      FROM calendar_events e
      JOIN calendar_invites i ON i.event_id = e.id
     WHERE e.start_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
       AND COALESCE(e.all_day, FALSE) = FALSE
       AND i.status <> 'declined'
    UNION
    SELECT e.id, e.title, e.start_at, e.end_at, e.created_by, e.contact_id
      FROM calendar_events e
     WHERE e.start_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
       AND COALESCE(e.all_day, FALSE) = FALSE
       AND e.created_by IS NOT NULL
  LOOP
    IF notify(
      r.user_id,
      CASE WHEN r.title ILIKE '%call%' THEN 'call.soon' ELSE 'meeting.soon' END,
      r.title || ' starts at ' || to_char(r.start_at, 'HH24:MI'),
      concat_ws('. ',
        (SELECT company_name FROM crm_contacts WHERE id = r.contact_id),
        (SELECT CASE WHEN count(*) = 0 THEN NULL
                     ELSE count(*)::TEXT || ' others on it' END
           FROM calendar_invites WHERE event_id = r.id AND user_id <> r.user_id)),
      '/dashboard/calendar?event=' || r.id::TEXT,
      NULL, 'meeting', r.id,
      jsonb_build_object('startAt', r.start_at),
      NULL,
      'soon:' || r.id::TEXT || ':' || r.user_id::TEXT,
      NULL,
      r.start_at
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- A task reaching its date, and one that has gone past it ----
  --
  -- Once each, keyed on the day, so a task that sits overdue for a
  -- fortnight is one notification and not fourteen.
  FOR r IN
    SELECT t.id, t.title, t.due_at, t.assignee_id,
           (t.due_at < date_trunc('day', NOW())) AS late
      FROM tasks t
     WHERE t.assignee_id IS NOT NULL
       AND t.due_at IS NOT NULL
       AND t.due_at < date_trunc('day', NOW()) + INTERVAL '1 day'
       AND t.status NOT IN ('done', 'cancelled')
  LOOP
    IF notify(
      r.assignee_id,
      CASE WHEN r.late THEN 'task.overdue' ELSE 'task.due' END,
      r.title,
      CASE WHEN r.late
           THEN 'It was due ' || to_char(r.due_at, 'DD Mon') || '.'
           ELSE 'Due today.' END,
      '/dashboard/work?task=' || r.id::TEXT,
      NULL, 'task', r.id,
      jsonb_build_object('dueAt', r.due_at, 'allLink', '/dashboard/work'),
      CASE WHEN r.late THEN 'overdue' ELSE 'due-today' END,
      CASE WHEN r.late THEN 'overdue:' ELSE 'due:' END
        || r.id::TEXT || ':' || to_char(NOW(), 'YYYY-MM-DD')
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- An open prospect nobody has touched in six weeks ----
  --
  -- Keyed on the month, so it comes round again if it stays quiet
  -- rather than being said once and forgotten.
  FOR r IN
    SELECT l.id, l.company_name, l.owner_id, l.estimated_value,
           COALESCE(l.last_activity_at, l.updated_at) AS quiet_since
      FROM crm_leads l
     WHERE l.owner_id IS NOT NULL
       AND l.status IN ('lead', 'contacted', 'quoted')
       AND COALESCE(l.last_activity_at, l.updated_at) < NOW() - INTERVAL '6 weeks'
  LOOP
    IF notify(
      r.owner_id, 'crm.dormant',
      COALESCE(NULLIF(btrim(r.company_name), ''), 'A prospect') || ' has gone quiet',
      'Nothing logged since ' || to_char(r.quiet_since, 'DD Mon')
        || COALESCE('. Worth about ' || to_char(r.estimated_value, 'FM£999,999,999'), ''),
      '/dashboard/leads?lead=' || r.id::TEXT,
      NULL, 'lead', r.id,
      jsonb_build_object('quietSince', r.quiet_since, 'allLink', '/dashboard/leads'),
      'dormant',
      'dormant:' || r.id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
    ) IS NOT NULL THEN wrote := wrote + 1; END IF;
  END LOOP;

  -- ---- Monthly figures ----
  --
  -- Four fifths of the way, and there. Once each per person per month,
  -- and the company one is a team notification so it is not four
  -- people each being told the same number personally.
  FOR r IN
    SELECT t.user_id, t.target_amount,
           COALESCE(SUM(l.sale_price), 0) AS booked
      FROM revenue_targets t
      LEFT JOIN crm_leads l
        ON l.owner_id = t.user_id
       AND l.status IN ('won', 'customer')
       AND l.order_date >= date_trunc('month', NOW())
       AND l.order_date <  date_trunc('month', NOW()) + INTERVAL '1 month'
     WHERE t.user_id IS NOT NULL
       AND t.period_month = date_trunc('month', NOW())::DATE
       AND t.target_amount > 0
     GROUP BY t.user_id, t.target_amount
  LOOP
    IF r.booked >= r.target_amount THEN
      IF notify(
        r.user_id, 'sales.milestone_hit',
        'You are over your number for ' || to_char(NOW(), 'Month'),
        to_char(r.booked, 'FM£999,999,999') || ' against '
          || to_char(r.target_amount, 'FM£999,999,999') || '.',
        '/dashboard/analytics',
        NULL, 'target', NULL,
        jsonb_build_object('booked', r.booked, 'target', r.target_amount),
        NULL,
        'hit:' || r.user_id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
      ) IS NOT NULL THEN wrote := wrote + 1; END IF;

    ELSIF r.booked >= r.target_amount * 0.8 THEN
      IF notify(
        r.user_id, 'sales.milestone_close',
        to_char(r.target_amount - r.booked, 'FM£999,999,999') || ' short of your number',
        to_char(r.booked, 'FM£999,999,999') || ' of '
          || to_char(r.target_amount, 'FM£999,999,999') || ' with '
          || (date_trunc('month', NOW()) + INTERVAL '1 month' - NOW())::DATE
             - NOW()::DATE || ' days left in the month.',
        '/dashboard/analytics',
        NULL, 'target', NULL,
        jsonb_build_object('booked', r.booked, 'target', r.target_amount),
        NULL,
        'close:' || r.user_id::TEXT || ':' || to_char(NOW(), 'YYYY-MM')
      ) IS NOT NULL THEN wrote := wrote + 1; END IF;
    END IF;
  END LOOP;

  UPDATE notification_sweeps SET last_wrote = wrote WHERE id;
  RETURN wrote;
END;
$fn$;

REVOKE ALL ON FUNCTION notification_sweep(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_sweep(BOOLEAN) TO authenticated;

COMMENT ON FUNCTION notification_sweep(BOOLEAN) IS
  'Everything no trigger can see, because nothing changed. Called when '
  'somebody opens the bell, at most once every five minutes. Returns '
  'how many it wrote, or -1 when another call did it recently.';


-- -------------------------------------------------------------
-- 11. Opening the bell.
--
-- One call: sweep if it is time, then hand back the counts. So the
-- screen does not have to know that a sweep exists, and cannot forget
-- to run it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_open()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE swept INT;
BEGIN
  BEGIN
    swept := notification_sweep(FALSE);
  EXCEPTION WHEN OTHERS THEN
    -- A sweep that fails must not stop somebody reading what is
    -- already there.
    swept := -1;
  END;
  RETURN notification_counts() || jsonb_build_object('swept', swept);
END;
$fn$;

REVOKE ALL ON FUNCTION notification_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_open() TO authenticated;
