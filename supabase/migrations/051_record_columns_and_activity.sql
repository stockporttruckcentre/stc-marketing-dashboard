-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 045_record_columns_and_activity.sql. This repository already had a 045 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 045. What every substantive record carries, and one timeline.
--
-- Four things that belong together because they are all answers to
-- "what is true of this row regardless of which table it is in".
--
--   owning_entity_id   Stockport Truck Centre or STC Sales and Leasing. A permission boundary, not a label.
--   classification     Public, Internal, Confidential, Restricted.
--   commercially sensitive               commercially sensitive information, with a review
--                      date and a cleansed transition.
--   deleted_at         soft delete, because hard delete is not available
--                      to ordinary users at a company that gets audited.
--
-- Plus `activity`, which scope 5.5 and 42 ask for: one chronological
-- timeline as shared infrastructure rather than each module building its
-- own history.
--
-- ---- Why a helper rather than nine ALTER blocks ----
--
-- `add_record_columns()` applies the set to a table and records that it
-- did. Every table built from here calls it in one line, and the
-- functions below can refuse to operate on a table that has not, rather
-- than failing halfway through with a missing column.
--
-- ---- Which tables ----
--
-- The ones that survive into Frame. `stock_trailers`, `trailer_sales`,
-- `maint_accounts`, `revenue_targets` and `account_ownership` are being
-- deleted, so columns added to them would be wasted work.
-- `crm_contacts` and `crm_lists` are covered even though the CRM
-- decomposition replaces them, because they hold the live data until it
-- does and an uncovered table is an uncovered table.
--
-- ---- Activity is not the audit log ----
--
-- They look similar and they are not interchangeable. The audit log is
-- evidence: append only, records reads, keeps before and after values,
-- and exists for auditors and insider lists. Activity is a feed: what
-- happened on this record, in language a person reads, shown on the
-- record page. A note added is one line in each, phrased differently.
--
-- Keeping them separate means the audit log can stay narrow and
-- complete while the timeline can stay readable, and neither has to
-- compromise for the other.
-- =============================================================

-- -------------------------------------------------------------
-- 1. How sensitive a record is.
--
-- Scope 35. Four levels, and the examples that go with them: a published
-- blog is Public, a project plan is Internal, an investor discussion is
-- Confidential, and board, legal or financing material is Restricted.
-- -------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'classification_level') THEN
    CREATE DOMAIN classification_level AS TEXT
      CHECK (VALUE IN ('public', 'internal', 'confidential', 'restricted'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION classification_rank(p_level TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $fn$
  SELECT CASE p_level
    WHEN 'restricted'   THEN 40
    WHEN 'confidential' THEN 30
    WHEN 'internal'     THEN 20
    WHEN 'public'       THEN 10
    ELSE 0
  END
$fn$;

-- -------------------------------------------------------------
-- 2. Which tables carry the record columns.
--
-- A table rather than a hardcoded list, so `soft_delete` and the rest
-- can validate their argument against something a migration keeps up to
-- date rather than against a constant somebody has to remember.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS record_tables (
  table_name TEXT PRIMARY KEY,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE record_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "record_tables_read" ON record_tables;
CREATE POLICY "record_tables_read" ON record_tables
  FOR SELECT USING (current_actor() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON record_tables FROM PUBLIC, authenticated;

-- -------------------------------------------------------------
-- 3. The helper.
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, and the policy is
-- dropped before it is created. Running this file twice is a no-op,
-- which `npm run check:bundle-twice` asserts.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_record_columns(p_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'there is no table called %', p_table;
  END IF;

  EXECUTE format($sql$
    ALTER TABLE %1$I
      ADD COLUMN IF NOT EXISTS owning_entity_id UUID REFERENCES entities ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS classification   classification_level NOT NULL DEFAULT 'internal',
      -- Commercially sensitive information. from the meeting, 4.1: a CRM that
      -- stores deal notes stores commercially sensitive information by definition.
      ADD COLUMN IF NOT EXISTS is_sensitive          BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sensitive_flagged_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sensitive_flagged_by  UUID REFERENCES auth.users ON DELETE SET NULL,
      -- When somebody should look again and decide whether it is still
      -- material. A flag with no review date never comes off.
      ADD COLUMN IF NOT EXISTS sensitive_review_at   DATE,
      -- When the information became public and the flag was lifted.
      ADD COLUMN IF NOT EXISTS sensitive_lifted_at TIMESTAMPTZ,
      -- Soft delete. from the meeting, 4.4.
      ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_by       UUID REFERENCES auth.users ON DELETE SET NULL
  $sql$, p_table);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (deleted_at) WHERE deleted_at IS NOT NULL',
    'idx_' || p_table || '_deleted', p_table);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (owning_entity_id)',
    'idx_' || p_table || '_entity', p_table);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (is_sensitive) WHERE is_sensitive',
    'idx_' || p_table || '_sensitive', p_table);

  -- A deleted row is gone, with two exceptions that are not optional.
  --
  -- RESTRICTIVE is the point of the shape. Permissive policies combine
  -- with OR, which is how `calendar_events` ended up readable by
  -- everybody. Restrictive policies combine with AND, so this narrows
  -- every existing policy on the table without any of them being
  -- rewritten, and a permissive policy added later cannot undo it.
  --
  -- FOR SELECT, not FOR ALL, and `deleted_by = current_actor()` is in
  -- the clause. Both of those are the result of the same discovery and
  -- neither was obvious.
  --
  -- A row an UPDATE produces has to satisfy the policies that would let
  -- the actor see it. So a policy saying "deleted rows are invisible to
  -- you" also says "you may not produce a deleted row", and soft delete
  -- becomes impossible for everybody except an audit holder. The first
  -- two attempts at this failed with `new row violates row-level
  -- security policy`, and adding `WITH CHECK (TRUE)` did not help,
  -- because it is not the UPDATE check doing the refusing.
  --
  -- Letting the person who deleted it still see it resolves that, and is
  -- the right behavior anyway: somebody who deletes a record should be
  -- able to find it again. Everybody else loses sight of it immediately.
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
                 p_table || '_not_deleted', p_table);
  EXECUTE format($sql$
    CREATE POLICY %1$I ON %2$I AS RESTRICTIVE
      FOR SELECT USING (
        deleted_at IS NULL
        OR deleted_by = current_actor()
        OR command_may('admin.audit')
      )
  $sql$, p_table || '_not_deleted', p_table);

  INSERT INTO record_tables (table_name) VALUES (p_table)
  ON CONFLICT (table_name) DO NOTHING;
END;
$fn$;

-- -------------------------------------------------------------
-- 4. Apply it.
-- -------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_contacts', 'crm_lists', 'contact_notes', 'contact_addresses',
    'calendar_events', 'social_posts', 'brand_assets', 'news_items',
    'record_attachments', 'notifications'
  ] LOOP
    PERFORM add_record_columns(t);
  END LOOP;
END $$;

-- Everything starts on the default entity, same reasoning as profiles in
-- 042: guessing which side of the business a record belongs to would be
-- wrong for anything that serves both.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT table_name FROM record_tables LOOP
    EXECUTE format(
      'UPDATE %I SET owning_entity_id = (SELECT id FROM entities WHERE is_default) WHERE owning_entity_id IS NULL',
      t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 5. Deleting, restoring, and really deleting.
--
-- `soft_delete` is SECURITY INVOKER on purpose. Row level security
-- decides whether the caller may touch the row, exactly as it would for
-- an ordinary UPDATE, so this adds no new way in. What it adds is that
-- the deletion is recorded.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete(
  p_table  TEXT,
  p_id     UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE affected INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_tables WHERE table_name = p_table) THEN
    RAISE EXCEPTION '% does not carry the record columns, so it cannot be soft deleted', p_table;
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NOW(), deleted_by = current_actor() WHERE id = $1 AND deleted_at IS NULL',
    p_table) USING p_id;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    RETURN FALSE;
  END IF;

  PERFORM audit('delete', p_table, p_id, NULL, NULL, NULL, 'ui', p_reason);
  RETURN TRUE;
END;
$fn$;

-- Restoring has to be SECURITY DEFINER, because the restrictive policy
-- above hides the row from the person who would restore it. That makes
-- the capability check the whole of the authorization, so it is the
-- first thing here.
CREATE OR REPLACE FUNCTION restore_record(
  p_table  TEXT,
  p_id     UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE affected INTEGER;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'you do not have admin.users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM record_tables WHERE table_name = p_table) THEN
    RAISE EXCEPTION '% does not carry the record columns', p_table;
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
    p_table) USING p_id;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    RETURN FALSE;
  END IF;

  PERFORM audit('restore', p_table, p_id, NULL, NULL, NULL, 'ui', p_reason);
  RETURN TRUE;
END;
$fn$;

-- from the meeting, 4.4: hard delete should require an elevated role and
-- should itself be logged. The audit line is written before the row
-- goes, because afterwards there is nothing left to describe.
CREATE OR REPLACE FUNCTION hard_delete(
  p_table  TEXT,
  p_id     UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE affected INTEGER;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'you do not have admin.users';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a hard delete needs a reason, because it is the one that cannot be undone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM record_tables WHERE table_name = p_table) THEN
    RAISE EXCEPTION '% does not carry the record columns', p_table;
  END IF;

  PERFORM audit('delete', p_table, p_id, NULL, NULL, NULL, 'ui',
                'HARD DELETE. ' || p_reason);

  EXECUTE format('DELETE FROM %I WHERE id = $1', p_table) USING p_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$fn$;

-- -------------------------------------------------------------
-- 6. Flagging and cleansing material information.
--
-- INVOKER, so somebody who cannot change the record cannot change
-- whether it is material either.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_sensitive(
  p_table    TEXT,
  p_id       UUID,
  p_reason   TEXT,
  p_review   DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE affected INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_tables WHERE table_name = p_table) THEN
    RAISE EXCEPTION '% does not carry the record columns', p_table;
  END IF;

  EXECUTE format($sql$
    UPDATE %I SET
      is_sensitive = TRUE,
      sensitive_flagged_at = NOW(),
      sensitive_flagged_by = current_actor(),
      sensitive_review_at = COALESCE($2, CURRENT_DATE + 90),
      sensitive_lifted_at = NULL,
      classification = CASE
        WHEN classification_rank(classification) < classification_rank('confidential')
        THEN 'confidential' ELSE classification END
    WHERE id = $1
  $sql$, p_table) USING p_id, p_review;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN RETURN FALSE; END IF;

  PERFORM audit('update', p_table, p_id, NULL,
                jsonb_build_object('is_sensitive', FALSE),
                jsonb_build_object('is_sensitive', TRUE),
                'ui', p_reason, NULL, NULL, 'confidential', TRUE);
  RETURN TRUE;
END;
$fn$;

-- When the information becomes public. The flag comes off, the record
-- keeps the date it happened, and the classification is left alone
-- rather than dropped to public: a deal that has been announced is not
-- automatically a deal whose notes are publishable.
CREATE OR REPLACE FUNCTION lift_sensitive(
  p_table  TEXT,
  p_id     UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE affected INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_tables WHERE table_name = p_table) THEN
    RAISE EXCEPTION '% does not carry the record columns', p_table;
  END IF;

  EXECUTE format(
    'UPDATE %I SET is_sensitive = FALSE, sensitive_lifted_at = NOW(), sensitive_review_at = NULL WHERE id = $1 AND is_sensitive',
    p_table) USING p_id;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN RETURN FALSE; END IF;

  PERFORM audit('update', p_table, p_id, NULL,
                jsonb_build_object('is_sensitive', TRUE),
                jsonb_build_object('is_sensitive', FALSE),
                'ui', p_reason, NULL, NULL, NULL, TRUE);
  RETURN TRUE;
END;
$fn$;

-- -------------------------------------------------------------
-- 7. The timeline.
--
-- Scope 5.5 lists fourteen kinds of thing that belong on one
-- chronological timeline, and says it should be shared infrastructure
-- rather than each module building a separate history system.
--
-- Two references rather than one. A note is about an organization. A
-- meeting is about an organization AND a project. `subject` is what the
-- timeline is being read for; `object` is the other end.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  actor_id         UUID REFERENCES auth.users ON DELETE SET NULL,
  actor_label      TEXT,

  -- What happened, as a word a person reads: created, updated, noted,
  -- called, met, emailed, moved, approved, published, linked.
  verb             TEXT NOT NULL,

  subject_type     TEXT NOT NULL,
  subject_id       UUID NOT NULL,
  subject_label    TEXT,

  object_type      TEXT,
  object_id        UUID,
  object_label     TEXT,

  -- One line, already written. The timeline should not have to
  -- reconstruct sentences from columns at render time.
  summary          TEXT NOT NULL,
  metadata         JSONB,

  -- The timeline inherits the sensitivity of what it describes, so a
  -- confidential note does not become readable because somebody
  -- mentioned it in a feed.
  classification   classification_level NOT NULL DEFAULT 'internal',
  is_sensitive          BOOLEAN NOT NULL DEFAULT FALSE,
  owning_entity_id UUID REFERENCES entities ON DELETE SET NULL,

  -- Whether a person did this or the system did.
  is_system        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_activity_subject ON activity (subject_type, subject_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_object  ON activity (object_type, object_id, at DESC)
  WHERE object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_actor   ON activity (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_at      ON activity (at DESC);

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity FROM PUBLIC, authenticated;
GRANT SELECT ON activity TO authenticated;

DROP POLICY IF EXISTS "activity_read" ON activity;
-- Restricted lines are for whoever holds the audit capability or the
-- person who did the thing. Everything else follows the record it
-- describes, which each module's own policies already govern.
CREATE POLICY "activity_read" ON activity
  FOR SELECT USING (
    classification <> 'restricted'
    OR actor_id = current_actor()
    OR command_may('admin.audit')
  );

CREATE OR REPLACE FUNCTION log_activity(
  p_verb           TEXT,
  p_subject_type   TEXT,
  p_subject_id     UUID,
  p_summary        TEXT,
  p_subject_label  TEXT DEFAULT NULL,
  p_object_type    TEXT DEFAULT NULL,
  p_object_id      UUID DEFAULT NULL,
  p_object_label   TEXT DEFAULT NULL,
  p_metadata       JSONB DEFAULT NULL,
  p_classification TEXT DEFAULT 'internal',
  p_is_sensitive        BOOLEAN DEFAULT FALSE,
  p_is_system      BOOLEAN DEFAULT FALSE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  label TEXT;
  ent   UUID;
  line  BIGINT;
BEGIN
  IF current_actor() IS NOT NULL THEN
    SELECT COALESCE(full_name, email), entity_id INTO label, ent
    FROM profiles WHERE id = current_actor();
  END IF;

  INSERT INTO activity (
    actor_id, actor_label, verb, subject_type, subject_id, subject_label,
    object_type, object_id, object_label, summary, metadata,
    classification, is_sensitive, owning_entity_id, is_system
  ) VALUES (
    current_actor(), label, p_verb, p_subject_type, p_subject_id, p_subject_label,
    p_object_type, p_object_id, p_object_label, p_summary, p_metadata,
    p_classification::classification_level, p_is_sensitive, ent, p_is_system
  )
  RETURNING id INTO line;

  RETURN line;
END;
$fn$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'soft_delete(TEXT, UUID, TEXT)',
    'restore_record(TEXT, UUID, TEXT)',
    'hard_delete(TEXT, UUID, TEXT)',
    'mark_sensitive(TEXT, UUID, TEXT, DATE)',
    'lift_sensitive(TEXT, UUID, TEXT)',
    'classification_rank(TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION log_activity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_activity TO authenticated;
-- `add_record_columns` is a migration tool. Nothing at runtime should be
-- altering tables.
REVOKE ALL ON FUNCTION add_record_columns(TEXT) FROM PUBLIC, authenticated;
