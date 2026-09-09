-- =============================================================
-- 101. One column for a face, and every screen that draws one.
--
-- From the business:
--
--   ensure Teams page is pulling through profile pics, and anywhere
--   else avatars show.
--
-- ---- Why the Team page was drawing initials ----
--
-- `profiles` has held `photo_url` since migration 048, and
-- `team_directory` has returned it since 073. Migration 099 then added
-- `avatar_url` for the settings uploader, with a comment saying "one
-- column", which was wrong: there were already two. The uploader wrote
-- one and the directory read the other, so uploading a photograph put
-- it somewhere nothing on the Team page or the Admin panel ever looked.
--
-- Nobody's picture is lost here. `photo_url` takes anything sitting in
-- `avatar_url`, and only then does the second column go. It goes rather
-- than staying as a synonym, because two columns holding one fact is
-- the defect: leaving both would mean the next person to write an
-- uploader has to guess again, and they would have a fifty per cent
-- chance of guessing the same way as this migration.
--
-- ---- The other screens ----
--
-- The work board and the diary drew initials because neither had
-- anywhere to put a URL: `assignable_people` did not select one, and
-- the diary reads `profiles` for a name and an email. Both now carry
-- the picture, so an assignee chip, a note author and a meeting
-- attendee show the same face as the directory.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Move the pictures across before anything is dropped
--
-- `photo_url` wins where both are set, because it is the one the RPCs
-- have always written and the one `update_my_profile` still writes.
-- In practice nobody has both: the only writer of `photo_url` from the
-- interface is a function no screen calls.
-- -------------------------------------------------------------
DO $$
DECLARE moved INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'profiles' AND column_name = 'avatar_url') THEN

    UPDATE profiles
       SET photo_url = avatar_url
     WHERE avatar_url IS NOT NULL
       AND NULLIF(btrim(avatar_url), '') IS NOT NULL
       AND (photo_url IS NULL OR btrim(photo_url) = '');
    GET DIAGNOSTICS moved = ROW_COUNT;

    RAISE NOTICE 'avatars: % picture(s) moved from avatar_url to photo_url', moved;

    ALTER TABLE profiles DROP COLUMN avatar_url;
  ELSE
    RAISE NOTICE 'avatars: avatar_url is already gone, nothing to move';
  END IF;
END $$;

/* The policy 099 added is a self update policy with an avatar in its
   name. It is still the right rule and still the only thing letting
   somebody set their own picture, so it stays. Renamed so that the
   next person reading the policy list is not looking for a column that
   is no longer there. */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE tablename = 'profiles' AND policyname = 'profiles_update_own_avatar') THEN
    ALTER POLICY profiles_update_own_avatar ON profiles RENAME TO profiles_update_own;
  END IF;
EXCEPTION WHEN OTHERS THEN
  /* Older Postgres has no ALTER POLICY ... RENAME. The policy still
     works under its old name, and the name is cosmetic. */
  RAISE NOTICE 'avatars: left the self update policy under its existing name';
END $$;

COMMENT ON COLUMN profiles.photo_url IS
  'The one place a person''s picture lives. A public URL in the '
  'brand-assets bucket, under avatars/<user id>/. Null draws initials.';

-- -------------------------------------------------------------
-- 2. The work board can see a face
--
-- `assignable_people` is what the assignee picker, the workload rail
-- and every "who has this" chip read. Adding one column to the view is
-- the whole of what those screens needed: they were drawing initials
-- because there was nothing else on the row.
-- -------------------------------------------------------------
/* Appended at the end rather than put next to `full_name` where it
   belongs, because CREATE OR REPLACE VIEW may only add columns after
   the existing ones. Dropping and recreating would order it properly
   and would also drop anything built on top of the view, which is a
   real cost for a cosmetic gain. Every reader names its columns. */
CREATE OR REPLACE VIEW assignable_people AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.role,
  p.department_id,
  d.name                     AS department_name,
  pe.entity_id               AS primary_entity_id,
  e.code                     AS primary_entity_code,
  e.name                     AS primary_entity_name,
  ARRAY(SELECT x.entity_id FROM profile_entities x WHERE x.user_id = p.id) AS entity_ids,
  -- Whether they are on a different company from the person looking.
  NOT (COALESCE(pe.entity_id, p.entity_id) = ANY (actor_entities())) AS is_cross_entity,
  p.photo_url
FROM profiles p
LEFT JOIN profile_entities pe ON pe.user_id = p.id AND pe.is_primary
LEFT JOIN entities   e ON e.id = COALESCE(pe.entity_id, p.entity_id)
LEFT JOIN departments d ON d.id = p.department_id;

GRANT SELECT ON assignable_people TO authenticated;

-- -------------------------------------------------------------
-- 3. Setting your own picture, through the same door as the rest of
--    your profile
--
-- The uploader wrote the column directly, which is why it could point
-- at the wrong one without anything noticing. `update_my_profile` has
-- taken a picture since 073 and had no caller. It has one now, and it
-- is the only writer, so there is one place this can go wrong instead
-- of two.
--
-- Nothing about the function changes. 073 already reads NULL as "leave
-- this field alone" and an empty string as "clear it", which is
-- exactly what an uploader and a Remove button need. Only the comment
-- is added, so the next person can see that from the catalogue rather
-- than by reading the CASE.
-- -------------------------------------------------------------
COMMENT ON FUNCTION update_my_profile IS
  'Your own profile. NULL leaves a field as it was; a blank string '
  'clears it. p_photo_url is the only writer of profiles.photo_url.';

-- -------------------------------------------------------------
-- Said out loud, so a migration that matched nothing is not mistaken
-- for one that worked.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'profiles' AND column_name = 'avatar_url') THEN
    RAISE EXCEPTION '101 did not land: profiles still has both columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'assignable_people' AND column_name = 'photo_url') THEN
    RAISE EXCEPTION '101 did not land: assignable_people cannot see a picture';
  END IF;
  RAISE NOTICE 'avatars: one column, and the work board can read it';
END $$;

COMMIT;

-- PostgREST caches the schema. Without this the view has the column
-- and the API still says it does not.
NOTIFY pgrst, 'reload schema';
