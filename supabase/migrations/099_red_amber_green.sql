-- =============================================================
-- 099. Red, amber, green on a customer.
--
-- From the business:
--
--   Red Amber Green system needs adding to CRM drawer to add
--   complaints/slowness. When marked Amber - potential issue,
--   slowness/etc. Add a button to alert the account manager(s) manually
--   with the reason. Red would alert them automatically. Via
--   notification, the actual CRM column rows should show a dot and we
--   can just sort by dot colour, and also by email. With a 7-day
--   cooldown (ensure weekends/holidays/bankholidays respected) on Amber
--   and 3-day on red (before you are alerted in notifs to chase, by
--   email to chase, and as a Work task to chase.
--
-- Four things, and they are deliberately four rather than one column.
--
--   1. WHERE AN ACCOUNT STANDS       on `crm_contacts`, so the grid can
--                                    sort a dot with no join.
--   2. WHY, AND SINCE WHEN           an event with a reason, opened when
--                                    it goes amber or red and closed when
--                                    it goes green. The reason is the
--                                    whole value: "amber" tells nobody
--                                    anything on a Monday morning.
--   3. WHO WAS TOLD, AND WHEN        so a chase can be due rather than
--                                    repeated every time a page loads.
--   4. WHEN THE CHASE IS DUE         working days, which needs a
--                                    calendar, which is why there is a
--                                    bank holidays table below.
--
-- ---- Why working days are a table and not a formula ----
--
-- Because Easter moves and the late May bank holiday is not the last
-- Monday in May in a jubilee year. A formula that is right in 2026 and
-- wrong in 2027 is worse than a list somebody can read, and the list is
-- three rows a year.
--
-- England and Wales only. STC is in Stockport. Scotland and Northern
-- Ireland have different days and adding them would be inventing a
-- requirement.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The calendar
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk_bank_holidays (
  on_date DATE PRIMARY KEY,
  name    TEXT NOT NULL
);

INSERT INTO uk_bank_holidays (on_date, name) VALUES
  -- 2025
  ('2025-01-01', 'New Year''s Day'),
  ('2025-04-18', 'Good Friday'),
  ('2025-04-21', 'Easter Monday'),
  ('2025-05-05', 'Early May bank holiday'),
  ('2025-05-26', 'Spring bank holiday'),
  ('2025-08-25', 'Summer bank holiday'),
  ('2025-12-25', 'Christmas Day'),
  ('2025-12-26', 'Boxing Day'),
  -- 2026
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-04', 'Early May bank holiday'),
  ('2026-05-25', 'Spring bank holiday'),
  ('2026-08-31', 'Summer bank holiday'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-28', 'Boxing Day (substitute)'),
  -- 2027
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-05-03', 'Early May bank holiday'),
  ('2027-05-31', 'Spring bank holiday'),
  ('2027-08-30', 'Summer bank holiday'),
  ('2027-12-27', 'Christmas Day (substitute)'),
  ('2027-12-28', 'Boxing Day (substitute)')
ON CONFLICT (on_date) DO UPDATE SET name = EXCLUDED.name;

ALTER TABLE uk_bank_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_holidays_read ON uk_bank_holidays;
CREATE POLICY bank_holidays_read ON uk_bank_holidays
  FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON uk_bank_holidays FROM anon, authenticated;

/**
 * How many working days have passed since an instant.
 *
 * Counts the days AFTER the one it happened on, up to and including
 * today, skipping Saturdays, Sundays and anything in the table above.
 * So something raised on a Friday afternoon is one working day old on
 * the Monday, which is what anybody in the office would say.
 *
 * A day that is beyond the end of the table counts as a working day if
 * it is a weekday. That is the safe direction to be wrong in: the worst
 * case is somebody being chased one day early over Christmas 2028,
 * rather than a chase that never arrives.
 */
CREATE OR REPLACE FUNCTION working_days_since(p_from TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
    FROM generate_series(
           (p_from AT TIME ZONE 'Europe/London')::DATE + 1,
           (NOW()  AT TIME ZONE 'Europe/London')::DATE,
           INTERVAL '1 day') AS d(day)
   WHERE EXTRACT(ISODOW FROM d.day) < 6
     AND NOT EXISTS (SELECT 1 FROM uk_bank_holidays h WHERE h.on_date = d.day::DATE);
$$;

COMMENT ON FUNCTION working_days_since(TIMESTAMPTZ) IS
  'Working days elapsed, England and Wales, excluding the day it happened on.';

-- -------------------------------------------------------------
-- 2. Where an account stands
--
-- On `crm_contacts` rather than in a join, because the CRM grid sorts
-- on it and a dot that costs a join is a dot the grid cannot sort
-- without loading everything.
-- -------------------------------------------------------------
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS health TEXT NOT NULL DEFAULT 'green';
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_health_check;
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_health_check
  CHECK (health IN ('green', 'amber', 'red'));

-- Denormalised from the open event, by the trigger below. The grid
-- shows the reason on hover and cannot afford a second query per row.
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS health_reason      TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS health_since       TIMESTAMPTZ;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS health_last_chased TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_health
  ON crm_contacts (health) WHERE health <> 'green';

-- -------------------------------------------------------------
-- 3. Why, and since when
--
-- One open event per account at a time. Closing it is what going green
-- means, and the closed ones are the history: "how many times have we
-- been amber with Booker this year" is a question somebody will ask.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_health_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES crm_contacts ON DELETE CASCADE,

  level      TEXT NOT NULL CHECK (level IN ('amber', 'red')),
  reason     TEXT NOT NULL,

  raised_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  raised_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When somebody last told the account managers about it. Null means
  -- nobody has yet, which for red is a state that lasts milliseconds
  -- and for amber can last as long as somebody likes.
  alerted_at TIMESTAMPTZ,
  alert_count INTEGER NOT NULL DEFAULT 0,

  -- When the chase last went out, which is what the cooldown counts
  -- from. Distinct from `alerted_at`: the first alert is news, a chase
  -- is a reminder that nothing has happened since.
  chased_at   TIMESTAMPTZ,
  chase_count INTEGER NOT NULL DEFAULT 0,

  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users ON DELETE SET NULL,
  resolution  TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_events_contact ON crm_health_events (contact_id, raised_at DESC);
/* One open event per account. A second amber while an amber is open is
   the same problem being described twice. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_events_one_open
  ON crm_health_events (contact_id) WHERE resolved_at IS NULL;

ALTER TABLE crm_health_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_events_read ON crm_health_events;
CREATE POLICY health_events_read ON crm_health_events
  FOR SELECT USING (auth.uid() IS NOT NULL);

/* Raising and resolving both go through the functions below, which are
   SECURITY INVOKER, so this policy is what actually decides. Writing
   one by hand is allowed for the same people, because a policy that
   only trusts a function is a policy nobody can reason about. */
DROP POLICY IF EXISTS health_events_write ON crm_health_events;
CREATE POLICY health_events_write ON crm_health_events
  FOR ALL USING (command_may('crm.health'))
  WITH CHECK (command_may('crm.health'));

-- -------------------------------------------------------------
-- 4. The account keeps up with its open event
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_health_follows_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target UUID := COALESCE(NEW.contact_id, OLD.contact_id);
  open_one crm_health_events;
BEGIN
  SELECT * INTO open_one
    FROM crm_health_events
   WHERE contact_id = target AND resolved_at IS NULL
   ORDER BY raised_at DESC
   LIMIT 1;

  UPDATE crm_contacts
     SET health             = COALESCE(open_one.level, 'green'),
         health_reason      = open_one.reason,
         health_since       = open_one.raised_at,
         health_last_chased = open_one.chased_at
   WHERE id = target;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS crm_health_events_sync ON crm_health_events;
CREATE TRIGGER crm_health_events_sync
  AFTER INSERT OR UPDATE OR DELETE ON crm_health_events
  FOR EACH ROW EXECUTE FUNCTION crm_health_follows_event();

-- -------------------------------------------------------------
-- 5. Who the account managers are
--
-- Everybody who should hear about this customer. Three sources, because
-- the CRM has grown three ways of saying who looks after an account and
-- none of them is complete on its own:
--
--   the owner of any open lead against them   the person actually on it
--   `assigned_to`, matched by name            the CRM's own column
--   whoever is watching, if that exists       explicit
--
-- De-duplicated. Somebody who is both the lead owner and the named
-- account manager is told once.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_account_managers(p_contact UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT x.user_id FROM (
    SELECT l.owner_id AS user_id
      FROM crm_leads l
     WHERE l.contact_id = p_contact AND l.owner_id IS NOT NULL
    UNION
    SELECT p.id
      FROM crm_contacts c
      JOIN profiles p
        ON LOWER(BTRIM(p.full_name)) = LOWER(BTRIM(c.assigned_to))
        OR LOWER(BTRIM(SPLIT_PART(p.full_name, ' ', 1))) = LOWER(BTRIM(c.assigned_to))
     WHERE c.id = p_contact AND COALESCE(BTRIM(c.assigned_to), '') <> ''
  ) x
  WHERE x.user_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION crm_account_managers(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. The notifications this raises
-- -------------------------------------------------------------
INSERT INTO notification_kinds
  (key, category, label, blurb, audience, severity, default_on, may_mute,
   capability, self_ok, bundle_title, sort_order)
VALUES
  ('crm.health_red', 'crm',
   'A customer goes red',
   'A complaint or a serious problem on an account you look after. Raised the moment it is set.',
   'personal', 'urgent', TRUE, FALSE, 'crm.view', FALSE, NULL, 260),

  ('crm.health_amber', 'crm',
   'Somebody flags a customer amber',
   'Slowness or a potential issue, sent to the account managers when whoever raised it presses Alert.',
   'personal', 'attention', TRUE, TRUE, 'crm.view', FALSE, NULL, 261),

  ('crm.health_chase', 'crm',
   'A red or amber customer has gone quiet',
   'Three working days on a red, seven on an amber, and nothing has changed. Also raised as a task.',
   'personal', 'attention', TRUE, TRUE, 'crm.view', TRUE, NULL, 262)
ON CONFLICT (key) DO UPDATE SET
  category = EXCLUDED.category, label = EXCLUDED.label, blurb = EXCLUDED.blurb,
  audience = EXCLUDED.audience, severity = EXCLUDED.severity,
  capability = EXCLUDED.capability, sort_order = EXCLUDED.sort_order;

-- -------------------------------------------------------------
-- 7. Setting where an account stands
--
-- One function, because the three transitions are one decision and
-- three code paths is how one of them forgets to close the open event.
--
--   green            resolves whatever is open. Nothing is raised.
--   amber with reason opens an event. Tells NOBODY: the business asked
--                    for a button, because an amber is often something
--                    the person raising it is already dealing with.
--   red with reason  opens an event AND tells the account managers, now.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_set_health(
  p_contact UUID,
  p_level   TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  who      UUID := auth.uid();
  said     TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  company  TEXT;
  fresh    UUID;
  told     INTEGER := 0;
  manager  RECORD;
BEGIN
  IF NOT command_may('crm.health') THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'You cannot set where an account stands.');
  END IF;
  IF p_level NOT IN ('green', 'amber', 'red') THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'That is not a level.');
  END IF;

  SELECT company_name INTO company FROM crm_contacts WHERE id = p_contact;
  IF company IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'No such customer.');
  END IF;

  IF p_level = 'green' THEN
    UPDATE crm_health_events
       SET resolved_at = NOW(), resolved_by = who, resolution = said
     WHERE contact_id = p_contact AND resolved_at IS NULL;
    RETURN jsonb_build_object('ok', TRUE, 'level', 'green');
  END IF;

  IF said IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE,
      'why', 'Say what the problem is. An amber with no reason tells the next person nothing.');
  END IF;

  /* Already open at some level: change the level and the reason rather
     than opening a second one. Going amber to red restarts the clock,
     because it is a new severity and the three day cooldown has not
     been served. */
  UPDATE crm_health_events
     SET level = p_level,
         reason = said,
         raised_by = who,
         raised_at = CASE WHEN level <> p_level THEN NOW() ELSE raised_at END,
         chased_at = CASE WHEN level <> p_level THEN NULL ELSE chased_at END
   WHERE contact_id = p_contact AND resolved_at IS NULL
  RETURNING id INTO fresh;

  IF fresh IS NULL THEN
    INSERT INTO crm_health_events (contact_id, level, reason, raised_by)
    VALUES (p_contact, p_level, said, who)
    RETURNING id INTO fresh;
  END IF;

  /* Red tells them now. Amber waits for the button. */
  IF p_level = 'red' THEN
    FOR manager IN SELECT user_id FROM crm_account_managers(p_contact) LOOP
      IF manager.user_id IS DISTINCT FROM who THEN
        PERFORM notify(
          manager.user_id, 'crm.health_red',
          company || ' has gone red',
          said,
          '/dashboard/crm?contact=' || p_contact::TEXT,
          who, 'account', p_contact,
          jsonb_build_object('level', 'red', 'reason', said),
          NULL, 'health:' || fresh::TEXT || ':raised');
        told := told + 1;
      END IF;
    END LOOP;

    UPDATE crm_health_events
       SET alerted_at = NOW(), alert_count = alert_count + 1
     WHERE id = fresh;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'level', p_level, 'told', told, 'event', fresh);
END;
$$;

-- -------------------------------------------------------------
-- 8. Telling them by hand
--
-- The amber button. Separate from setting the level because they are
-- separate acts: somebody can flag a customer amber on Monday, work on
-- it themselves, and decide on Wednesday that the account manager needs
-- to know.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_alert_health(p_contact UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  who     UUID := auth.uid();
  ev      crm_health_events;
  company TEXT;
  told    INTEGER := 0;
  manager RECORD;
  said    TEXT;
BEGIN
  IF NOT command_may('crm.health') THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'You cannot alert on an account.');
  END IF;

  SELECT * INTO ev FROM crm_health_events
   WHERE contact_id = p_contact AND resolved_at IS NULL
   ORDER BY raised_at DESC LIMIT 1;

  IF ev.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE,
      'why', 'This account is green. There is nothing to alert anybody about.');
  END IF;

  SELECT company_name INTO company FROM crm_contacts WHERE id = p_contact;
  said := COALESCE(NULLIF(BTRIM(COALESCE(p_note, '')), ''), ev.reason);

  FOR manager IN SELECT user_id FROM crm_account_managers(p_contact) LOOP
    IF manager.user_id IS DISTINCT FROM who THEN
      PERFORM notify(
        manager.user_id,
        CASE WHEN ev.level = 'red' THEN 'crm.health_red' ELSE 'crm.health_amber' END,
        company || ' is ' || ev.level,
        said,
        '/dashboard/crm?contact=' || p_contact::TEXT,
        who, 'account', p_contact,
        jsonb_build_object('level', ev.level, 'reason', said),
        NULL,
        /* The count is in the key on purpose. Pressing Alert twice with
           a new note is two different messages, and deduping them would
           swallow the second. */
        'health:' || ev.id::TEXT || ':alert:' || (ev.alert_count + 1)::TEXT);
      told := told + 1;
    END IF;
  END LOOP;

  UPDATE crm_health_events
     SET alerted_at = NOW(), alert_count = alert_count + 1
   WHERE id = ev.id;

  RETURN jsonb_build_object('ok', TRUE, 'told', told, 'level', ev.level);
END;
$$;

-- -------------------------------------------------------------
-- 9. What is due a chase
--
-- Three working days on a red, seven on an amber, counted from the last
-- chase or from when it was raised.
--
-- A view rather than a function, so the sweep can read it, a report can
-- read it, and somebody can look at it in the SQL editor without
-- learning a signature.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW crm_health_due_a_chase AS
SELECT e.id            AS event_id,
       e.contact_id,
       c.company_name,
       e.level,
       e.reason,
       e.raised_at,
       e.raised_by,
       e.chased_at,
       e.chase_count,
       CASE WHEN e.level = 'red' THEN 3 ELSE 7 END AS cooldown_working_days,
       working_days_since(COALESCE(e.chased_at, e.raised_at)) AS working_days_quiet
  FROM crm_health_events e
  JOIN crm_contacts c ON c.id = e.contact_id
 WHERE e.resolved_at IS NULL
   AND working_days_since(COALESCE(e.chased_at, e.raised_at))
       >= CASE WHEN e.level = 'red' THEN 3 ELSE 7 END;

GRANT SELECT ON crm_health_due_a_chase TO authenticated;

-- -------------------------------------------------------------
-- 10. Chasing
--
-- Notification and a Work task, both. The business asked for three
-- things and named the third itself:
--
--   before you are alerted in notifs to chase, by email to chase, and
--   as a Work task to chase. Email stuff may have to come after SSO
--   plug in.
--
-- So two of the three land here and the email is left for when there is
-- something to send it with. The task is the one that survives being
-- ignored: a notification is read and dismissed, a task sits in My work
-- until somebody closes it.
--
-- Run by `/api/crm/health/sweep`. Returns what it did, so the route can
-- say so rather than reporting success into the dark.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_health_chase()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  due       RECORD;
  manager   RECORD;
  chased    INTEGER := 0;
  told      INTEGER := 0;
  tasks     INTEGER := 0;
  task_id   UUID;
BEGIN
  FOR due IN SELECT * FROM crm_health_due_a_chase LOOP
    FOR manager IN SELECT user_id FROM crm_account_managers(due.contact_id) LOOP
      PERFORM notify(
        manager.user_id, 'crm.health_chase',
        due.company_name || ' has been ' || due.level || ' for '
          || due.working_days_quiet || ' working days',
        due.reason,
        '/dashboard/crm?contact=' || due.contact_id::TEXT,
        NULL, 'account', due.contact_id,
        jsonb_build_object('level', due.level, 'reason', due.reason,
                           'workingDays', due.working_days_quiet),
        NULL,
        /* One chase per cooldown, not one per sweep. The sweep runs as
           often as anybody likes and this is what makes that safe. */
        'health:' || due.event_id::TEXT || ':chase:' || (due.chase_count + 1)::TEXT);
      told := told + 1;

      /* And a task, on the same person, about the same customer. The
         `source` is what tells the Work tab this was not typed by hand,
         and `organisation_id` is what makes "what is outstanding on
         Booker" answerable. */
      INSERT INTO tasks (title, description, status, priority,
                         assignee_kind, assignee_id, organisation_id,
                         due_at, source, created_by)
      /* Cast every one of these. `tasks.status`, `tasks.priority` and
         `tasks.assignee_kind` are enumerated types, and an INSERT ...
         SELECT does not coerce a bare string literal into an enum the
         way a VALUES list does: it fails outright with "column is of
         type task_priority but expression is of type text". Found by
         `npm run check:health` rather than by a chase that never
         arrived. */
      SELECT 'Chase ' || due.company_name || ' (' || due.level || ')',
             due.reason,
             'ready'::task_status,
             (CASE WHEN due.level = 'red' THEN 'p0' ELSE 'p1' END)::task_priority,
             'person'::assignee_kind, manager.user_id, due.contact_id,
             NOW(), 'health', manager.user_id
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks t
          WHERE t.organisation_id = due.contact_id
            AND t.source = 'health'
            AND t.assignee_id = manager.user_id
            AND t.status NOT IN ('done', 'cancelled')
            AND t.deleted_at IS NULL)
      RETURNING id INTO task_id;

      IF task_id IS NOT NULL THEN tasks := tasks + 1; END IF;
    END LOOP;

    UPDATE crm_health_events
       SET chased_at = NOW(), chase_count = chase_count + 1
     WHERE id = due.event_id;
    chased := chased + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'accounts', chased, 'notified', told, 'tasks', tasks);
END;
$$;

GRANT EXECUTE ON FUNCTION crm_set_health(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION crm_alert_health(UUID, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION crm_health_chase()               TO authenticated;

NOTIFY pgrst, 'reload schema';

-- -------------------------------------------------------------
-- 11. The capability
--
-- `crm.health` is its own, not `crm.edit`. From the business: "Ensure
-- permission granular wiring."
--
-- It is granular in the direction that matters. Setting a customer red
-- sends an urgent notification to whoever looks after them, and that is
-- a different kind of authority from correcting a phone number. A
-- restricted updater who maintains stock records has `crm.edit` and has
-- no business declaring a customer in dispute; a rep who owns accounts
-- has both.
--
-- Seeded into the catalogue AND into the legacy role table, because the
-- legacy seed is still what authorises every account on this
-- installation: see the header of `lib/crm/permissions.ts`.
-- -------------------------------------------------------------
INSERT INTO capability_catalog
  (key, label, description, area, feature, danger, requires, scoped, position)
VALUES
  ('crm.health', 'Flag a customer amber or red',
   'Record a complaint or a problem on an account, and alert whoever looks after it. Red notifies them the moment it is set.',
   'CRM', 'Records', 'sensitive', '{crm.view}', FALSE, 45)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description,
  area = EXCLUDED.area, feature = EXCLUDED.feature, danger = EXCLUDED.danger,
  requires = EXCLUDED.requires, scoped = EXCLUDED.scoped, position = EXCLUDED.position;

/* Who holds it. Everybody who works accounts, which is administrators,
   sales and the restricted updater: Rama takes the call when a customer
   rings up about a trailer that has not arrived, and the whole point is
   that whoever hears it can record it. A read only viewer cannot. */
INSERT INTO command_capability_roles (capability, role) VALUES
  ('crm.health', 'admin'),
  ('crm.health', 'sales'),
  ('crm.health', 'marketer')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT rt.id, 'crm.health', 'company'
  FROM role_templates rt
 WHERE rt.slug IN ('administrator', 'compliance', 'member')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------
-- 12. A face on a profile
--
-- From the business: "Add options to update your profile pic."
--
-- One column. The picture itself goes in the `brand-assets` bucket,
-- which already exists and is already the one place this application
-- puts a file, and this holds the URL that comes back.
--
-- Nullable, and the sidebar draws initials when it is null, which is
-- what it does today for everybody and will keep doing for anybody who
-- never uploads one.
-- -------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

/* Your own, and nobody else's. `profiles` already has an update policy;
   this asserts the part that matters for a column somebody can point at
   a URL of their choosing. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'profiles' AND policyname = 'profiles_update_own_avatar'
  ) THEN
    CREATE POLICY profiles_update_own_avatar ON profiles
      FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
END $$;
