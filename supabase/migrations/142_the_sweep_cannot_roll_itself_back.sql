-- =============================================================
-- 142. A sweep that cannot roll itself back, and a count that cannot
--      inflate.
--
-- Two findings from the audit, both verified against real PostgreSQL
-- before anything was changed.
--
-- ---- THE SWEEP COULD ROLL BACK EVERY WRITE IT HAD JUST MADE ----
--
-- The monthly target branch, for somebody between 80 and 99 per cent
-- of their number, built its message with:
--
--   (date_trunc('month', NOW()) + INTERVAL '1 month' - NOW())::DATE
--
-- That subtraction yields an INTERVAL, and PostgreSQL answers a cast
-- from interval to date with "cannot cast type interval to date". Run
-- against this database it does exactly that, every time.
--
-- The whole sweep is one statement, so that exception discards the
-- reminders it had already written. And `notification_open` catches
-- OTHERS so a failed sweep cannot stop somebody reading their bell,
-- which is right, and meant this failed in complete silence: the bell
-- opened, the notifications were simply not there.
--
-- Whether it ever fired depends on somebody sitting between 80 and 99
-- per cent of a monthly target, which is a normal place to be.
--
-- The fix is the bracket. Close it before the cast, so a DATE has a
-- DATE subtracted from it and the answer is a number of days.
--
-- ---- AND A TASK REMINDER THAT COUNTED ITSELF AGAIN ----
--
-- `notify` consulted the dedupe key only at the INSERT, through
-- ON CONFLICT DO NOTHING. The bunching branch runs BEFORE that, so a
-- second sweep inside the bundle window found the unread notification
-- by its group key and incremented item_count without the dedupe key
-- being looked at once. One task became "2 tasks", then "3 tasks",
-- and nobody had gained a task.
--
-- Both functions below are the live definitions with that one change
-- each, taken out of the database rather than retyped, so nothing
-- else can have drifted.
-- =============================================================

CREATE OR REPLACE FUNCTION public.notification_sweep(p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          || (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE
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
$function$

;

CREATE OR REPLACE FUNCTION public.notify(p_user uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_subject_kind text DEFAULT NULL::text, p_subject_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_group_key text DEFAULT NULL::text, p_dedupe_key text DEFAULT NULL::text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  /* ---- ASKED BEFORE THE BUNCH, NOT AFTER IT ----

     The dedupe key was only ever consulted by the INSERT at the
     bottom, through ON CONFLICT DO NOTHING. The bunching branch above
     that runs first, so a second sweep inside the bundle window found
     the unread notification by its group key and did
     item_count = item_count + 1 without the dedupe key being looked
     at once. One task reminder became "2 tasks", then "3 tasks", and
     nobody had gained a task.

     So the question is asked here. Already sent, already unread, and
     the same key: nothing to say. The existing row is returned so the
     caller still gets an id and cannot read the silence as a failure. */
  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO fresh_id
      FROM notifications
     WHERE user_id = p_user
       AND dedupe_key = p_dedupe_key
     LIMIT 1;
    IF fresh_id IS NOT NULL THEN
      RETURN fresh_id;
    END IF;
  END IF;

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
$function$

;

DO $$ BEGIN
  RAISE NOTICE 'the sweep no longer casts an interval to a date, and a bunch asks the dedupe key first';
END $$;
