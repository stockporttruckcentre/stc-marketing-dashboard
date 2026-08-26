-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 046_file_service.sql. This repository already had a 046 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 046. One file service.
--
-- Scope section 41: one coherent file service for CRM attachments,
-- project files, brand files, content assets, meeting files and
-- documents, with stable ids, permission-aware access, metadata,
-- classification, versioning, previews, retention, deletion and audit.
--
-- ---- What it replaces ----
--
-- Two incompatible things, which is the actual defect.
--
--   `record_attachments`  stores the bytes as BYTEA inside PostgreSQL,
--                         capped at 8MB, and only for two record types.
--                         The database carries the file data, so every
--                         backup and every restore carries it too.
--   Supabase Storage      used directly by the brand kit and by social
--                         media, with the bucket name written into the
--                         component and no permission model beyond the
--                         bucket's own.
--
-- So a PDF on a customer and a logo in the brand kit are stored two
-- different ways, with different limits and different rules. Scope 41
-- exists to say do not do that.
--
-- ---- Where the bytes go ----
--
-- Not here. This table is the card catalogue: what a file is, who
-- uploaded it, what it is attached to, how sensitive it is and which
-- version it is. The bytes live in object storage behind a driver, so
-- the store can change without this schema changing.
--
-- That matters more than usual here. The intended destination is this
-- company's own server with no third party involved. The driver
-- interface speaks the S3 protocol, which Cloudflare R2 speaks and
-- which self-hosted object storage speaks, so moving is a change of
-- endpoint and credentials rather than a migration.
--
-- ---- Retention ----
--
-- Confirmed: keep everything, decide schedules later. So there is a
-- `retain_until` column and nothing that acts on it. from the meeting, 4.4
-- wants defined retention schedules with legal hold, and `legal_hold`
-- is here so that when the schedules arrive the column they suspend is
-- already on every row rather than being added to a populated table.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The file.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ---- where the bytes are ----
  -- Which driver wrote it. A row written under one driver stays
  -- readable after the default changes, which is what makes a migration
  -- between stores possible one file at a time rather than all at once.
  driver       TEXT NOT NULL CHECK (driver IN ('s3', 'local', 'supabase', 'inline')),
  bucket       TEXT,
  -- The path inside the bucket. Unique per driver and bucket, because
  -- two files must never point at the same object: deleting one would
  -- silently empty the other.
  object_key   TEXT NOT NULL,

  -- ---- what it is ----
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL CHECK (size_bytes >= 0),
  -- SHA-256 of the contents. Two jobs: proving a file has not changed
  -- since it was uploaded, and noticing the same document uploaded
  -- twice under different names.
  checksum     TEXT,

  -- ---- versions ----
  -- Replacing a file does not overwrite it. The new row supersedes the
  -- old, the old stops being current, and both stay readable. Scope 41
  -- asks for versioning where needed, and a contract is exactly where
  -- it is needed.
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes   UUID REFERENCES files ON DELETE SET NULL,
  is_current   BOOLEAN NOT NULL DEFAULT TRUE,

  -- ---- describing it ----
  title        TEXT,
  description  TEXT,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  -- A generated preview: a thumbnail, or the first page of a PDF. A key
  -- in the same store rather than bytes, same reasoning as the file.
  preview_key  TEXT,

  -- ---- retention, which nothing acts on yet ----
  retain_until DATE,
  -- Suspends deletion regardless of any schedule. from the meeting, 4.4.
  legal_hold   BOOLEAN NOT NULL DEFAULT FALSE,

  uploaded_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two rows must never name the same object.
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_object
  ON files (driver, COALESCE(bucket, ''), object_key);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files (uploaded_by, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_checksum    ON files (checksum) WHERE checksum IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_current     ON files (is_current) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_files_tags        ON files USING GIN (tags);

-- Classification, commercially sensitive, owning entity, soft delete. The same set every
-- other record carries, from migration 056.
SELECT add_record_columns('files');

-- -------------------------------------------------------------
-- 2. What it is attached to.
--
-- A separate table because one file can hang off several records: the
-- same signed agreement belongs to the organization, the opportunity
-- and the project. Copying it three times would give three things to
-- keep in step.
--
-- A file with no attachments is legitimate. Brand assets belong to the
-- brand kit rather than to a record.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_attachments (
  file_id     UUID NOT NULL REFERENCES files ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  record_id   UUID NOT NULL,
  -- What this file is to that record: 'contract', 'kyc', 'deck',
  -- 'recording', 'transcript'. Free text, because the list grows with
  -- the product and a CHECK constraint would need a migration each time.
  role        TEXT,
  attached_by UUID REFERENCES auth.users ON DELETE SET NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (file_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_file_attachments_record
  ON file_attachments (record_type, record_id);

-- -------------------------------------------------------------
-- 3. Who may open it.
--
-- Fails closed. A file is reachable if you uploaded it, or it is
-- attached to something you can reach, or it is unattached and not
-- sensitive. Anything else is no.
--
-- The reachability question is per record type and there is no generic
-- answer, so this asks the table itself: can the caller SELECT that
-- row. That is one question with one answer, already enforced by that
-- table's own policies, rather than a second copy of every rule.
--
-- SECURITY INVOKER is the whole trick. The inner SELECT runs as the
-- caller, so row level security answers the question. A DEFINER version
-- would see everything and would have to reimplement every policy in
-- the schema.
-- -------------------------------------------------------------
-- The policy already has the row, so it hands over what it needs.
--
-- The obvious shape, `can_reach_file(id)` selecting the row itself, does
-- not work: it is called BY the policy on `files`, so selecting from
-- `files` re-evaluates that policy and PostgreSQL refuses with infinite
-- recursion. The workaround of a SECURITY DEFINER reader was worse: it
-- either leaks every file's metadata to anybody who calls it directly,
-- or it has to be revoked, and then the INVOKER function that needs it
-- cannot execute it. Both were tried here before this shape.
--
-- Passing the columns in solves it outright. Nothing reads `files`, so
-- nothing recurses, and there is no privileged reader to lock down.
CREATE OR REPLACE FUNCTION can_reach_file(
  p_file           UUID,
  p_uploaded_by    UUID,
  p_classification TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $fn$
DECLARE
  a           file_attachments;
  reachable   BOOLEAN;
  attachments INTEGER;
BEGIN
  -- Your own upload, always.
  IF p_uploaded_by = current_actor() THEN
    RETURN TRUE;
  END IF;

  -- Whoever holds the audit capability can see what exists. They are
  -- the people who have to answer who accessed what.
  IF command_may('admin.audit') THEN
    RETURN TRUE;
  END IF;

  SELECT count(*) INTO attachments FROM file_attachments WHERE file_id = p_file;

  -- Unattached files are library material: brand assets, templates.
  -- Readable at Internal and below, and never at Confidential or above
  -- without a record to inherit permission from.
  IF attachments = 0 THEN
    RETURN classification_rank(p_classification) <= classification_rank('internal');
  END IF;

  -- Attached: can the caller reach any record it hangs off. The inner
  -- SELECT runs as the caller, so that table's own policies answer,
  -- rather than this function holding a second copy of every rule.
  FOR a IN SELECT * FROM file_attachments WHERE file_id = p_file LOOP
    -- Only tables this installation knows about. An unknown type is a
    -- no rather than an error, so a file attached to a table that has
    -- since been dropped does not become readable by everybody.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = a.record_type AND c.relkind = 'r'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1)', a.record_type)
      INTO reachable USING a.record_id;

    IF reachable THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$fn$;

-- What everything other than the policy calls. One id, and the answer
-- comes from the policy above rather than from a second copy of the
-- rule: if the row is selectable, it is reachable.
CREATE OR REPLACE FUNCTION can_reach_file(p_file UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY INVOKER
STABLE
AS $fn$
  SELECT EXISTS (SELECT 1 FROM files WHERE id = p_file)
$fn$;

DROP FUNCTION IF EXISTS file_meta(UUID);

ALTER TABLE files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "files_select"    ON files;
DROP POLICY IF EXISTS "files_insert"    ON files;
DROP POLICY IF EXISTS "files_update"    ON files;
DROP POLICY IF EXISTS "file_att_select" ON file_attachments;
DROP POLICY IF EXISTS "file_att_write"  ON file_attachments;
DROP POLICY IF EXISTS "file_att_insert" ON file_attachments;

-- One rule, asked once. An earlier version of this policy said "any
-- file that is attached to anything", to dodge the recursion above,
-- which made every attached file in the company readable by everybody.
CREATE POLICY "files_select" ON files
  FOR SELECT USING (can_reach_file(id, uploaded_by, classification));

CREATE POLICY "files_insert" ON files
  FOR INSERT WITH CHECK (uploaded_by = current_actor());

-- Metadata is editable by whoever uploaded it. Superseding happens
-- through `supersede_file` rather than by hand.
CREATE POLICY "files_update" ON files
  FOR UPDATE USING (uploaded_by = current_actor() OR command_may('admin.users'))
           WITH CHECK (TRUE);

CREATE POLICY "file_att_select" ON file_attachments
  FOR SELECT USING (current_actor() IS NOT NULL);

-- Attaching goes through `attach_file`, which checks that the caller
-- can reach both ends first. This policy is the backstop: whatever
-- route a row arrives by, it is stamped with who attached it.
CREATE POLICY "file_att_insert" ON file_attachments
  FOR INSERT WITH CHECK (attached_by = current_actor());

REVOKE ALL ON FUNCTION can_reach_file(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_reach_file(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_file(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_reach_file(UUID, UUID, TEXT) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON files    FROM PUBLIC;
REVOKE UPDATE, DELETE ON file_attachments FROM PUBLIC, authenticated;

-- -------------------------------------------------------------
-- 4. Attaching, and the audit line that comes with opening one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION attach_file(
  p_file        UUID,
  p_record_type TEXT,
  p_record_id   UUID,
  p_role        TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE reachable BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_record_type AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'there is no table called %', p_record_type;
  END IF;

  -- You may only attach a file to a record you can reach. Otherwise
  -- attaching would be a way to find out that a record exists.
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1)', p_record_type)
    INTO reachable USING p_record_id;
  IF NOT reachable THEN
    RAISE EXCEPTION 'that record does not exist or you cannot reach it';
  END IF;

  IF NOT can_reach_file(p_file) THEN
    RAISE EXCEPTION 'that file does not exist or you cannot reach it';
  END IF;

  INSERT INTO file_attachments (file_id, record_type, record_id, role, attached_by)
  VALUES (p_file, p_record_type, p_record_id, p_role, current_actor())
  ON CONFLICT DO NOTHING;

  PERFORM audit('update', p_record_type, p_record_id, NULL, NULL,
                jsonb_build_object('attached_file', p_file), 'ui',
                'Attached a file');
  RETURN TRUE;
END;
$fn$;

-- Opening a sensitive file is an access worth recording. from the meeting, 6:
-- KYC and KYB documents are high sensitivity, restrict access to a
-- named role and log every view. This is the log-every-view half, and
-- it is what makes an insider list over a document possible.
CREATE OR REPLACE FUNCTION record_file_access(p_file UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE f files;
BEGIN
  IF NOT can_reach_file(p_file) THEN
    RAISE EXCEPTION 'that file does not exist or you cannot reach it';
  END IF;

  SELECT * INTO f FROM files WHERE id = p_file;

  -- Only the sensitive ones. Logging every thumbnail would produce a
  -- table nobody can query, which is the same as no log at all.
  IF f.is_sensitive OR classification_rank(f.classification) >= classification_rank('confidential') THEN
    PERFORM audit('read', 'files', p_file, f.filename, NULL, NULL, 'ui',
                  NULL, NULL, NULL, f.classification, f.is_sensitive);
  END IF;

  RETURN TRUE;
END;
$fn$;

-- Replacing a file. The old version stays, readable and attached to
-- everything it was attached to, and stops being current.
CREATE OR REPLACE FUNCTION supersede_file(
  p_old UUID,
  p_new UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE old_version INTEGER;
BEGIN
  IF NOT can_reach_file(p_old) OR NOT can_reach_file(p_new) THEN
    RAISE EXCEPTION 'one of those files does not exist or you cannot reach it';
  END IF;

  SELECT version INTO old_version FROM files WHERE id = p_old;

  UPDATE files SET is_current = FALSE, updated_at = NOW() WHERE id = p_old;
  UPDATE files SET version = old_version + 1, supersedes = p_old, updated_at = NOW()
  WHERE id = p_new;

  -- The new version inherits every attachment the old one had, so a
  -- contract replaced on the organization record is also replaced on
  -- the opportunity and the project.
  INSERT INTO file_attachments (file_id, record_type, record_id, role, attached_by)
  SELECT p_new, record_type, record_id, role, current_actor()
  FROM file_attachments WHERE file_id = p_old
  ON CONFLICT DO NOTHING;

  PERFORM audit('update', 'files', p_new, NULL,
                jsonb_build_object('supersedes', p_old),
                jsonb_build_object('version', old_version + 1), 'ui',
                'Replaced an earlier version');
  RETURN TRUE;
END;
$fn$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'attach_file(UUID, TEXT, UUID, TEXT)',
    'record_file_access(UUID)',
    'supersede_file(UUID, UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

GRANT INSERT, UPDATE ON files TO authenticated;
GRANT INSERT ON file_attachments TO authenticated;

-- -------------------------------------------------------------
-- 5. The old table, kept until its rows are moved.
--
-- `record_attachments` is not dropped here. Its rows carry the only
-- copy of their bytes, and dropping the table would destroy them. It is
-- dropped by the migration that moves them, once there is somewhere to
-- move them to.
-- -------------------------------------------------------------
COMMENT ON TABLE record_attachments IS
  'Superseded by `files`. Holds bytes inline, capped at 8MB. Do not add '
  'rows: use the file service. Dropped once its contents are migrated.';
