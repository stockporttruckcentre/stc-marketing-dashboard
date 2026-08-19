-- =============================================================
-- Attaching what a command produced to the record it is about.
--
-- "Export the sold curtainsiders as a PDF and attach it to STC143580"
-- is a real thing to want and there was nowhere to put the result. The
-- destination has been declared in the capability registry since the
-- registry existed, with no handler, so the command bar could represent
-- it, gate it, confirm it, and then not do it.
--
-- WHY A TABLE AND NOT A BUCKET.
--
-- This project already uses Supabase Storage for brand assets, so a
-- bucket was the obvious answer and is the wrong one here. A bucket has
-- its own access rules, written separately from the ones on the records
-- these files are about, and an export of the CRM sitting behind a
-- second set of rules is exactly how a customer list ends up readable
-- by somebody who cannot read the customers. Bytes in a row are covered
-- by the row's own policy, which is the policy on the record it hangs
-- off, and there is nothing to keep in step.
--
-- The size limit is stated rather than discovered. A spreadsheet of
-- every customer is a couple of megabytes; anything past eight is
-- refused by name instead of being stored somewhere nobody looks.
--
-- WHAT IT CAN BE ATTACHED TO.
--
-- Only records this application actually holds, checked here rather
-- than trusted from the caller. `entity` is not a free text label: it
-- names one of two tables, and a value outside that list raises. A
-- polymorphic key that accepts anything is a key that eventually points
-- at nothing.
--
-- SEEING A RECORD IS NOT PERMISSION TO WRITE TO IT.
--
-- The first version of this asked only whether the target row was
-- visible, and was granted to every authenticated user. A viewer, who
-- can read the whole CRM and change none of it, could call it straight
-- through PostgREST with no command runtime in front and leave a file on
-- any customer. The runtime's own gate is irrelevant to that: it was
-- never in the path.
--
-- So the capability is asked for here, in the database, and it is
-- derived from the TARGET rather than being one blanket permission:
-- attaching to a customer is `crm.edit` and attaching to a stock unit is
-- `stock.edit`, which are the same two capabilities the application
-- checks before it edits either. `command_may` reads
-- `command_capability_roles`, which is generated from
-- `lib/crm/permissions.ts`, so the two cannot drift.
--
-- SECURITY INVOKER on top of that, so row level security still decides
-- which records exist as far as the caller is concerned.
-- =============================================================

CREATE TABLE IF NOT EXISTS record_attachments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Which table the record is in. Checked against a fixed list below.
  entity       TEXT NOT NULL CHECK (entity IN ('stock_trailers', 'crm_contacts')),
  record_id    UUID NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  size_bytes   INTEGER NOT NULL,
  -- What the command bar was asked, so an attachment can be traced back
  -- to the sentence that made it.
  described_as TEXT,
  created_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_attachments_record
  ON record_attachments (entity, record_id, created_at DESC);

ALTER TABLE record_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attachments_select" ON record_attachments;
DROP POLICY IF EXISTS "attachments_insert" ON record_attachments;
DROP POLICY IF EXISTS "attachments_delete" ON record_attachments;

-- Visible when the record it hangs off is visible. The two arms are the
-- two tables the check constraint permits, and each one defers to that
-- table's own policy by selecting from it.
CREATE POLICY "attachments_select" ON record_attachments FOR SELECT USING (
  (entity = 'stock_trailers'
   AND EXISTS (SELECT 1 FROM stock_trailers t WHERE t.id = record_attachments.record_id))
  OR
  (entity = 'crm_contacts'
   AND EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = record_attachments.record_id))
);

-- The same capability the function asks for, on the table itself, so an
-- INSERT that goes round the function is refused too.
CREATE POLICY "attachments_insert" ON record_attachments FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND command_may(CASE entity
        WHEN 'crm_contacts'   THEN 'crm.edit'
        WHEN 'stock_trailers' THEN 'stock.edit'
      END)
  AND (
    (entity = 'stock_trailers'
     AND EXISTS (SELECT 1 FROM stock_trailers t WHERE t.id = record_attachments.record_id))
    OR
    (entity = 'crm_contacts'
     AND EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = record_attachments.record_id))
  )
);

-- Whoever put it there, or an admin.
CREATE POLICY "attachments_delete" ON record_attachments FOR DELETE USING (
  created_by = auth.uid() OR current_role_safe() = 'admin'
);

-- -------------------------------------------------------------
-- The operation
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION command_attach_file(
  p_entity    TEXT,
  p_record    UUID,
  p_filename  TEXT,
  p_mime      TEXT,
  -- Base64, because PostgREST carries JSON and JSON has no bytes.
  p_base64    TEXT,
  p_described TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  raw      BYTEA;
  size     INTEGER;
  new_id   UUID;
  needed   TEXT;
  -- Eight megabytes. Stated here so the refusal has a number in it.
  ceiling  CONSTANT INTEGER := 8 * 1024 * 1024;
BEGIN
  IF p_entity NOT IN ('stock_trailers', 'crm_contacts') THEN
    RAISE EXCEPTION 'nothing here attaches things to %', p_entity;
  END IF;

  -- WHICH capability, decided by what is being written to. Attaching to
  -- a customer is editing that customer; attaching to a stock unit is
  -- editing that unit. One blanket permission would let somebody who
  -- may edit stock leave files on the CRM.
  needed := CASE p_entity
    WHEN 'crm_contacts'   THEN 'crm.edit'
    WHEN 'stock_trailers' THEN 'stock.edit'
  END;
  IF NOT command_may(needed) THEN
    RAISE EXCEPTION 'you do not have %', needed;
  END IF;
  IF p_record IS NULL THEN
    RAISE EXCEPTION 'nothing said which record to attach it to';
  END IF;
  IF p_base64 IS NULL OR p_base64 = '' THEN
    RAISE EXCEPTION 'there is nothing to attach';
  END IF;

  raw  := decode(p_base64, 'base64');
  size := octet_length(raw);

  IF size > ceiling THEN
    RAISE EXCEPTION
      'that file is % bytes, and the most that can be attached to a record is %',
      size, ceiling;
  END IF;

  -- The record has to be there AND visible. A row hidden by row level
  -- security is not found here either, which is the point: attaching
  -- something to a record somebody cannot see would tell them it exists.
  IF p_entity = 'stock_trailers' THEN
    PERFORM 1 FROM stock_trailers WHERE id = p_record;
  ELSE
    PERFORM 1 FROM crm_contacts WHERE id = p_record;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that record is not there';
  END IF;

  INSERT INTO record_attachments
    (entity, record_id, filename, mime, bytes, size_bytes, described_as, created_by)
  VALUES
    (p_entity, p_record, p_filename, p_mime, raw, size, p_described, auth.uid())
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'attachmentId', new_id,
    'recordId', p_record,
    'filename', p_filename,
    'size', size
  );
END;
$$;

REVOKE ALL ON FUNCTION command_attach_file(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_attach_file(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
