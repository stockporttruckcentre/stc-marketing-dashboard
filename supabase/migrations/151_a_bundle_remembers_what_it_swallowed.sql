-- =============================================================
-- 151. A bundle remembers what it swallowed.
--
-- From the business, with three screenshots an hour apart:
--
--   2 tasks are past their date [...] 3 tasks are past their date [...]
--   4 tasks are past their date
--   notifs need looking at, same ones duplicating over and over.
--
-- Seven of them in one day, each listing the same handful of tasks.
--
-- ---- What is actually wrong ----
--
-- `notify()` has two mechanisms and they do not know about each other.
--
--   The DEDUPE KEY stops the same thing being said twice. A task going
--   overdue carries `overdue:<task id>:<date>`, so the sweep running
--   every few minutes says it once a day.
--
--   The BUNDLE collapses several notifications into one card, so eight
--   overdue tasks are "8 tasks are past their date" rather than eight
--   separate lines.
--
-- When the second task bundles into the first, the row it joins keeps
-- the FIRST task's dedupe key. The second task's key is never written
-- anywhere. So on the next sweep the second task looks like something
-- nobody has ever been told about, and it starts a fresh card, which
-- the third and fourth then bundle into.
--
-- Every task except the one that happens to own the card is re-notified
-- on every single sweep, for ever. Today that produced cards reading 8,
-- 7, 6, 89, 4, 3 and 2, all about the same four tasks.
--
-- ---- The fix ----
--
-- A bundle keeps the list of every dedupe key it has absorbed, and the
-- dedupe question asks that list as well as the column. One row can
-- stand for eight things, so it has to be able to say so.
--
-- This is in `notify()` rather than in the sweep, so it holds for every
-- kind that bundles: overdue tasks, tasks due today, dormant prospects
-- and anything added later.
--
-- NOTHING IS DELETED. The cards already sent are somebody's history and
-- stay exactly as they are.
-- =============================================================

CREATE OR REPLACE FUNCTION notify(
  p_user UUID, p_kind TEXT, p_title TEXT, p_body TEXT DEFAULT NULL,
  p_link TEXT DEFAULT NULL, p_actor UUID DEFAULT NULL,
  p_subject_kind TEXT DEFAULT NULL, p_subject_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB, p_group_key TEXT DEFAULT NULL,
  p_dedupe_key TEXT DEFAULT NULL, p_due_at TIMESTAMPTZ DEFAULT NULL,
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
  existing_keys  JSONB;
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

  landing := COALESCE(p_due_at, notification_lands_at(p_user, k.severity));

  /* ---- ALREADY SAID, IN ANY FORM ----

     Two places to look, and looking in only one of them is the fault
     this migration exists for.

     The COLUMN holds the key of whichever notification was written
     first. The LIST in the payload holds the key of everything that
     later bundled into it. A task that was swallowed by a card reading
     "8 tasks are past their date" has been told to somebody, and
     asking only the column says it has not. */
  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO fresh_id
      FROM notifications
     WHERE user_id = p_user
       AND (dedupe_key = p_dedupe_key
            OR payload -> 'dedupe_keys' ? p_dedupe_key)
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
    item := jsonb_build_object(
      'title', p_title,
      'body',  p_body,
      'link',  p_link,
      'id',    p_subject_id
    );

    existing_items := COALESCE(
      existing.payload -> 'items',
      jsonb_build_array(jsonb_build_object(
        'title', existing.title,
        'body',  existing.body,
        'link',  existing.link_path,
        'id',    existing.subject_id
      ))
    );

    /* Seeded from the row's own key the first time, for the same
       reason `items` is seeded from the row itself: the notification
       that started the bundle was written as an ordinary single one
       and its key is in the column, not in the list. */
    existing_keys := COALESCE(
      existing.payload -> 'dedupe_keys',
      CASE WHEN existing.dedupe_key IS NULL
           THEN '[]'::JSONB
           ELSE jsonb_build_array(existing.dedupe_key) END
    );
    IF p_dedupe_key IS NOT NULL AND NOT (existing_keys ? p_dedupe_key) THEN
      existing_keys := existing_keys || to_jsonb(p_dedupe_key);
    END IF;

    UPDATE notifications SET
      item_count = item_count + 1,
      title      = replace(k.bundle_title, '{n}', (item_count + 1)::TEXT),
      body       = NULL,
      payload    = jsonb_set(
                     CASE
                       WHEN jsonb_array_length(existing_items) >= 25
                         THEN jsonb_set(payload, '{items}', existing_items, TRUE)
                       ELSE jsonb_set(payload, '{items}', existing_items || item, TRUE)
                     END,
                     /* The key list is NOT capped at 25 the way the
                        readable list is. A card that stops remembering
                        the twenty sixth thing it swallowed starts
                        re-announcing it every few minutes, which is
                        the whole fault. A key is forty bytes. */
                     '{dedupe_keys}', existing_keys, TRUE),
      link_path  = COALESCE(payload ->> 'allLink', link_path),
      updated_at = NOW()
    WHERE id = existing.id
    RETURNING id INTO fresh_id;

    RETURN fresh_id;
  END IF;

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
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO fresh_id;

  RETURN fresh_id;
END;
$fn$;

/* The dedupe question now reads a key out of the payload on every
   notification the sweep considers, which is every few minutes. */
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_keys
  ON notifications USING GIN ((payload -> 'dedupe_keys'));

-- -------------------------------------------------------------
-- And the cards already sent get their lists filled in.
--
-- Without this, every task swallowed by a bundle BEFORE today keeps
-- being re-announced, because its key is still nowhere. The bundles
-- already carry the readable list of what they swallowed, and the
-- overdue and due-today keys are derivable from it: the item id is the
-- task id and the card's own date is the day.
--
-- NOTHING IS DELETED and no card changes what it says. Only the list of
-- keys is added.
-- -------------------------------------------------------------
UPDATE notifications n
   SET payload = jsonb_set(
         n.payload, '{dedupe_keys}',
         (SELECT COALESCE(jsonb_agg(DISTINCT key), '[]'::JSONB)
            FROM (
              SELECT n.dedupe_key AS key
               WHERE n.dedupe_key IS NOT NULL
              UNION
              SELECT CASE WHEN n.kind = 'task.overdue' THEN 'overdue:' ELSE 'due:' END
                     || (i ->> 'id')
                     || ':' || to_char(n.created_at, 'YYYY-MM-DD')
                FROM jsonb_array_elements(n.payload -> 'items') i
               WHERE i ->> 'id' IS NOT NULL
            ) keys),
         TRUE)
 WHERE n.kind IN ('task.overdue', 'task.due')
   AND n.payload ? 'items'
   AND NOT (n.payload ? 'dedupe_keys');
