-- =============================================================
-- 116. Putting a picture in the content library.
--
-- From the business, about the social planner going into use today:
--
--   make it so images uploaded to social posts actually save and the
--   whole thing is wired end to end
--
-- Two separate faults were behind that, and this is the second one.
--
-- The first was in the application: the composer uploaded a picture,
-- held the URL, drew it in the preview, and then never sent it when the
-- post was saved. Fixed in `app/api/content/posts/route.ts` and
-- `components/social/composer.tsx`.
--
-- ---- The one this migration is about ----
--
-- `social_library.file_id` is `UUID NOT NULL REFERENCES files`. The
-- planner passed the bucket's public URL instead, which is a string and
-- not a UUID, so every attempt to add a picture to the library failed
-- at the type before it reached the foreign key.
--
-- Underneath that, nothing in this application has ever written a row
-- to `files`. The table was created by migration 052 and left empty, so
-- even a correctly typed UUID would have failed the foreign key. The
-- library has never worked, and could not have.
--
-- `file_register` is the missing half: it records an object that is
-- already in the bucket and hands back the id the library needs.
-- =============================================================

CREATE OR REPLACE FUNCTION file_register(
  p_bucket     TEXT,
  p_object_key TEXT,
  p_filename   TEXT,
  p_mime       TEXT,
  p_size       BIGINT,
  p_checksum   TEXT DEFAULT NULL,
  p_title      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  found UUID;
BEGIN
  IF NOT command_may('social.draft') AND NOT command_may('brand.manage') THEN
    RAISE EXCEPTION 'Adding a file needs the right to draft content or to manage the brand kit.';
  END IF;

  IF COALESCE(TRIM(p_object_key), '') = '' THEN
    RAISE EXCEPTION 'A file needs the key it was stored under.';
  END IF;

  /* The same object twice is the same file.

     The key is deterministic in `lib/social/media.ts`, so uploading the
     same picture twice lands on the same object, and registering it
     twice must land on the same row rather than making a second one
     that points at the same bytes. */
  SELECT id INTO found
    FROM files
   WHERE bucket = p_bucket AND object_key = p_object_key AND deleted_at IS NULL
   LIMIT 1;
  IF found IS NOT NULL THEN
    RETURN found;
  END IF;

  INSERT INTO files (driver, bucket, object_key, filename, mime, size_bytes,
                     checksum, title, uploaded_by)
  VALUES ('supabase', p_bucket, p_object_key,
          COALESCE(NULLIF(TRIM(p_filename), ''), p_object_key),
          COALESCE(NULLIF(TRIM(p_mime), ''), 'application/octet-stream'),
          GREATEST(COALESCE(p_size, 0), 0),
          NULLIF(TRIM(COALESCE(p_checksum, '')), ''),
          NULLIF(TRIM(COALESCE(p_title, '')), ''),
          current_actor())
  RETURNING id INTO found;

  RETURN found;
END;
$fn$;

REVOKE ALL ON FUNCTION file_register(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION file_register(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- Where a registered file actually is.
--
-- Read by `/api/files/[id]`, which is the address the composer builds
-- when somebody picks a picture out of the library. That route did not
-- exist either, so a library picture rendered as a broken image even
-- when the row behind it was sound.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS file_location(UUID);
CREATE OR REPLACE FUNCTION file_location(p_file UUID)
RETURNS TABLE (bucket TEXT, object_key TEXT, mime TEXT, filename TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading a file needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT f.bucket, f.object_key, f.mime, f.filename
    FROM files f
   WHERE f.id = p_file AND f.deleted_at IS NULL
   LIMIT 1;
END;
$fn$;

REVOKE ALL ON FUNCTION file_location(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION file_location(UUID) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'a picture can be registered as a file and found again'; END $$;
