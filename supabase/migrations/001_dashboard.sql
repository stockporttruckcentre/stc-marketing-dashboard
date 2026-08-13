-- =============================================================
-- 001_dashboard.sql
--
-- Additive schema for the dashboard build. Safe to re-run.
--
-- Kept out of schema.sql on purpose. That file is one long idempotent
-- script that has already drifted from production: it calls
-- is_list_member_safe(), which is defined nowhere in this repository, so
-- a fresh run of it fails partway. Dump the live database and compare
-- before assuming anything here matches what is actually deployed.
--
-- Nothing in the dashboard requires this to have been run. Widgets whose
-- tables are missing render a "not wired up yet" state instead of
-- failing, so this can be applied when convenient.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Which dashboard someone sees.
--
-- Separate from `role` on purpose. Role is what you may do, variant is
-- what you see, and they are different questions. Today Dave, Dean, Tom
-- and Gareth are all `admin`, so role cannot tell a rep from an exec.
--
-- Read only through getDashboardVariant() in lib/dashboard/variant.ts.
-- Nothing else may read this column. When the granular permissions panel
-- lands, that one function changes and no widget does.
-- -------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dashboard_variant TEXT
  NOT NULL DEFAULT 'rep'
  CHECK (dashboard_variant IN ('rep','exec','support'));


-- -------------------------------------------------------------
-- 2. An honest activity timestamp.
--
-- The "gone quiet" and "biggest stuck deals" widgets are built entirely
-- on this, and they were the two asked for by name. It must NOT be
-- driven by the generic updated_at trigger: if fixing a typo counts as
-- progress, the widget lies.
--
-- Write it from the things that are actually activity: a note added, a
-- call logged, an action completed, a status change.
-- -------------------------------------------------------------
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_last_activity
  ON crm_contacts (last_activity_at DESC NULLS LAST);

-- Backfill from the best signal available today: the newest note, else
-- the hand-entered last_contact date, else the row's own updated_at.
UPDATE crm_contacts c
SET last_activity_at = GREATEST(
      COALESCE((SELECT MAX(n.created_at) FROM contact_notes n WHERE n.contact_id = c.id), 'epoch'::timestamptz),
      COALESCE(c.last_contact::timestamptz, 'epoch'::timestamptz),
      COALESCE(c.updated_at, 'epoch'::timestamptz))
WHERE c.last_activity_at IS NULL;

-- Adding a note is real activity, so keep it current automatically.
CREATE OR REPLACE FUNCTION touch_last_activity_from_note()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  UPDATE crm_contacts SET last_activity_at = NEW.created_at WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS contact_notes_touch_activity ON contact_notes;
CREATE TRIGGER contact_notes_touch_activity
  AFTER INSERT ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION touch_last_activity_from_note();

-- A status change is real activity. An edit to any other column is not.
CREATE OR REPLACE FUNCTION touch_last_activity_on_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_activity_at = NOW();
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS crm_contacts_touch_activity ON crm_contacts;
CREATE TRIGGER crm_contacts_touch_activity
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_last_activity_on_status();


-- -------------------------------------------------------------
-- 3. Notifications.
--
-- Built, not restored. There was no notifications table, no code and no
-- read state in this repository; the bell in the top bar was a button
-- with no click handler.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lead_assigned','message','system_alert','sync_failure','yoy_anomaly')),
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_own" ON notifications;
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- -------------------------------------------------------------
-- 4. Revenue targets.
--
-- user_id NULL means the company-wide figure. Nothing reads this until
-- somebody loads real numbers, and the widget says so until then.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  period_month DATE NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, period_month)
);

ALTER TABLE revenue_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "targets_read" ON revenue_targets;
DROP POLICY IF EXISTS "targets_write" ON revenue_targets;
CREATE POLICY "targets_read"  ON revenue_targets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "targets_write" ON revenue_targets FOR ALL    USING (current_role_safe() = 'admin');


-- -------------------------------------------------------------
-- 5. Account ownership.
--
-- This is the FIFTH way the app associates a person with work, after
-- crm_lists.owner_id and the free-text assigned_to, account_manager and
-- stock_trailers.sales_rep. Make it authoritative and let the text
-- columns become display-only, or the dashboard's portfolio will
-- disagree with the analytics leaderboard.
--
-- The backfill below is deliberately commented out. It matches on a
-- free-text first name, which is exactly the fragility being retired,
-- so it should be run once by hand and checked, not applied blindly.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_ownership (
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  role_on_account TEXT NOT NULL DEFAULT 'owner'
    CHECK (role_on_account IN ('owner','support','shadow')),
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (contact_id, user_id)
);

ALTER TABLE account_ownership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ownership_read"  ON account_ownership;
DROP POLICY IF EXISTS "ownership_write" ON account_ownership;
CREATE POLICY "ownership_read"  ON account_ownership FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "ownership_write" ON account_ownership FOR ALL    USING (current_role_safe() = 'admin');

-- INSERT INTO account_ownership (contact_id, user_id)
-- SELECT c.id, p.id
-- FROM crm_contacts c
-- JOIN profiles p ON LOWER(SPLIT_PART(p.full_name, ' ', 1)) = LOWER(TRIM(c.assigned_to))
-- WHERE c.assigned_to IS NOT NULL AND c.assigned_to <> ''
-- ON CONFLICT DO NOTHING;


-- -------------------------------------------------------------
-- 6. The next-actions queue.
--
-- A new concept with no precedent in the schema. Until this exists the
-- dashboard derives a read-only list from meetings and stalled deals,
-- and labels it as derived.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE,
  stock_trailer_id UUID REFERENCES stock_trailers ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('call','email','meeting','quote_followup','custom')),
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  priority SMALLINT NOT NULL DEFAULT 2,
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_actions_queue
  ON dashboard_actions (user_id, due_at)
  WHERE completed_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE dashboard_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "actions_own" ON dashboard_actions;
-- Assignable: a colleague can put an action on your queue, and you own it after that.
CREATE POLICY "actions_own" ON dashboard_actions
  FOR ALL USING (user_id = auth.uid() OR created_by = auth.uid())
  WITH CHECK (user_id = auth.uid() OR created_by = auth.uid());
