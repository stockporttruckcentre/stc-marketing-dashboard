-- =============================================================
-- 091. An approved account can actually sign in.
--
-- From the business:
--
--   I requested access, request came through and I accepted them and
--   set their role which was all fine. Now i'm trying to log in to that
--   account and I get "Database error querying schema"
--
-- Everything up to the sign in worked. The request arrived, an
-- administrator approved it, the row in `auth.users` exists, the
-- profile exists and carries the role they picked. The account is real
-- and it cannot be used.
--
-- ---- What that message actually is ----
--
-- It is GoTrue, Supabase's auth service, failing to read the row back.
-- Not a permission problem and nothing to do with our schema: it is a
-- Go program scanning a database row into a struct.
--
-- `auth.users` carries a set of token columns:
--
--   confirmation_token          recovery_token
--   email_change                email_change_token_new
--   email_change_token_current  phone_change
--   phone_change_token          reauthentication_token
--
-- Every one of them is NULLABLE in the table and NOT nullable in the
-- struct GoTrue reads them into. The service itself always writes an
-- empty string, so in normal use they are never null and the mismatch
-- never shows. A row inserted by hand leaves them null, and the scan
-- fails with `converting NULL to string is unsupported`, which the API
-- surfaces as "Database error querying schema".
--
-- So the account is fine, the password is fine, and the sign in fails
-- on eight columns nobody set because nothing said they had to be.
--
-- ---- Why the fix is dynamic SQL ----
--
-- That list is GoTrue's, and it has grown: `reauthentication_token`
-- arrived after the others, and a project on an older release does not
-- have it. Naming a column that is not there fails the whole migration
-- on that database, so `blank_auth_tokens` writes only to the ones
-- `information_schema` says exist.
--
-- ---- Two things, and both are needed ----
--
--   1. The account already approved is repaired, so the person waiting
--      to sign in can.
--   2. `approve_access_request` blanks them from now on, so the next
--      approval is not the same phone call.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The columns GoTrue insists are not null, blanked.
-- -------------------------------------------------------------

/**
 * Empty string in place of null, on every auth token column that this
 * database actually has.
 *
 * `p_user` null means every user, which is the repair. A user id means
 * the one just created, which is the fix.
 *
 * Returns how many rows it touched, so the migration can say so and the
 * readback can prove it.
 */
CREATE OR REPLACE FUNCTION blank_auth_tokens(p_user UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  col     TEXT;
  present TEXT[] := '{}';
  sets    TEXT;
  touched INTEGER := 0;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = col
    ) THEN
      present := present || col;
    END IF;
  END LOOP;

  IF cardinality(present) = 0 THEN RETURN 0; END IF;

  SELECT string_agg(format('%I = COALESCE(%I, %L)', c, c, ''), ', ')
    INTO sets FROM unnest(present) AS c;

  EXECUTE format(
    'UPDATE auth.users SET %s WHERE ($1 IS NULL OR id = $1) AND (%s)',
    sets,
    (SELECT string_agg(format('%I IS NULL', c), ' OR ') FROM unnest(present) AS c)
  ) USING p_user;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$fn$;

/* Deliberately not granted to `authenticated`. It writes to `auth`, and
   the only callers are this migration and `approve_access_request`,
   which is SECURITY DEFINER and does its own permission check. */
REVOKE ALL ON FUNCTION blank_auth_tokens(UUID) FROM PUBLIC;

-- -------------------------------------------------------------
-- 2. Repair whoever is already locked out.
-- -------------------------------------------------------------
DO $$
DECLARE fixed INTEGER;
BEGIN
  fixed := blank_auth_tokens(NULL);
  IF fixed > 0 THEN
    RAISE NOTICE '091: % account(s) could not sign in and now can', fixed;
  ELSE
    RAISE NOTICE '091: no account was in that state';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 3. And every approval from now on.
--
-- TAKEN FROM 074 VERBATIM, with two lines added and nothing else
-- touched. It is quoted rather than rewritten on purpose: I restated
-- this function from memory on the first attempt and produced a
-- plausible one that had lost the role validation, the password reset
-- branch for an address that already has an account, and the second
-- entry on its search path. `npm run check:access` caught it, which is
-- the only reason this note is a note and not a defect.
--
-- A function is replaced whole, so the whole of it is here.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_access_request(
  p_request  UUID,
  p_password TEXT DEFAULT '123',
  p_role     TEXT DEFAULT 'viewer',
  p_name     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  req    access_requests;
  made   UUID;
  exists_already UUID;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Creating an account is an administrator''s job.';
  END IF;

  SELECT * INTO req FROM access_requests WHERE id = p_request;
  IF req IS NULL THEN RAISE EXCEPTION 'There is no request with that id.'; END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request was already %.', req.status;
  END IF;
  IF p_role NOT IN ('admin', 'marketer', 'sales', 'viewer') THEN
    RAISE EXCEPTION '% is not a role.', p_role;
  END IF;
  IF length(COALESCE(p_password, '')) < 1 THEN
    RAISE EXCEPTION 'A password is required.';
  END IF;

  SELECT id INTO exists_already FROM auth.users WHERE lower(email) = lower(req.email);

  IF exists_already IS NOT NULL THEN
    /* They already have one. Approving is then a password reset rather
       than a create, which is almost always what the administrator
       means: somebody asked for access because they could not get in. */
    UPDATE auth.users
       SET encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = NOW()
     WHERE id = exists_already;
    made := exists_already;
    /* The same on a reset. An account made by hand before this
       migration is in exactly the state that cannot sign in, and
       resetting its password would otherwise leave it there. */
    PERFORM blank_auth_tokens(made);
  ELSE
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      lower(req.email), crypt(p_password, gen_salt('bf')),
      /* Confirmed on the way in. An administrator approving a colleague
         IS the confirmation, and leaving it null means a first sign in
         that refuses with "email not confirmed". */
      NOW(), NOW(), NOW(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      CASE WHEN NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN '{}'::JSONB
           ELSE jsonb_build_object('full_name', btrim(p_name)) END
    )
    RETURNING id INTO made;

    /* THE ONE LINE THIS MIGRATION EXISTS FOR.

       Eight token columns that GoTrue reads into non-nullable Go
       strings. Left null, every sign in on this account answers
       "Database error querying schema" and nothing in our own logs
       says why, because nothing of ours has failed. */
    PERFORM blank_auth_tokens(made);
  END IF;

  /* The profile. `handle_new_user` makes one on insert, so this settles
     the parts that trigger cannot know: the role an administrator
     picked, and the name they typed. */
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (made, lower(req.email),
          COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), split_part(lower(req.email), '@', 1)),
          p_role)
  ON CONFLICT (id) DO UPDATE
     SET role = EXCLUDED.role,
         full_name = COALESCE(NULLIF(btrim(p_name), ''), profiles.full_name);

  UPDATE access_requests
     SET status = 'approved', decided_by = current_actor(), decided_at = NOW(), became = made
   WHERE id = p_request;

  /* `create` and `reject`, not words of this migration's own. The
     action column is a closed set from migration 050 and the audit
     screen reads it: a new verb would have been a line nothing knows
     how to render, and widening the set to add one would make the
     vocabulary whatever the last migration felt like. */
  PERFORM audit(
    'create', 'profiles', made, lower(req.email),
    jsonb_build_object('from_request', p_request, 'role', p_role,
                       'existed_already', exists_already IS NOT NULL)
  );

  RETURN jsonb_build_object(
    'user', made,
    'email', lower(req.email),
    'role', p_role,
    'existed_already', exists_already IS NOT NULL
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION approve_access_request(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
DO $$
DECLARE stuck INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'blank_auth_tokens'
  ) THEN
    RAISE EXCEPTION '091 did not land: blank_auth_tokens is not there';
  END IF;

  /* And nobody is left in the state that started this. */
  stuck := blank_auth_tokens(NULL);
  IF stuck <> 0 THEN
    RAISE EXCEPTION '091 ran and % account(s) are still unable to sign in', stuck;
  END IF;
END $$;
