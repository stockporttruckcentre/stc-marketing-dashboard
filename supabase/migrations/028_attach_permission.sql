-- =============================================================
-- 028. What it takes to attach a file, from one place.
--
-- Migration 014 derived the capability from the target table with a CASE
-- expression written by hand:
--
--   crm_contacts    -> crm.edit
--   stock_trailers  -> stock.edit
--
-- which is right, and was a second copy of an answer the registry now
-- states. `command_entity_permissions` is generated from the same
-- registry the planner reads, so the answer the database gives and the
-- answer the bar gives are one answer, and adding an attachable table is
-- one line in `columns.ts` rather than two edits in two languages.
--
-- Everything else about the function is exactly what 014 left: the eight
-- megabyte ceiling, the visibility check on the record, and the row
-- policy underneath, which is left alone on purpose. It is a second,
-- independent check, and a check reading the same table as the function
-- it guards is not an independent one.
-- =============================================================

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
  -- WHICH capability, decided by what is being written to. Attaching to
  -- a customer is editing that customer; attaching to a stock unit is
  -- editing that unit. One blanket permission would let somebody who
  -- may edit stock leave files on the CRM.
  --
  -- Read from the generated registry rather than written out here, so
  -- the planner and the database give one answer and an attachable
  -- table is declared once.
  SELECT capability INTO needed
    FROM command_entity_permissions
   WHERE table_name = p_entity AND operation = 'attach';

  IF needed IS NULL THEN
    RAISE EXCEPTION 'nothing here attaches things to %', p_entity;
  END IF;
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
