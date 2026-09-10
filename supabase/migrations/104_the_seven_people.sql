-- =============================================================
-- 104. The seven people, on their proper roles.
--
-- From the business:
--
--   Current users - Alex Ellis - Developer, Tom Moore - BD, Dean Mann -
--   Sales, Gareth Hardy - MD, David Reay - Sales, STC Admin - Admin.
--   Then i need to create a user for Wayne Kenny
--   (waynekenny@stc-uk.com) with Sr Finance role.
--
-- Migration 103 built the eleven roles. This puts people on them, which
-- is the point at which any of it takes effect: `command_may()` reads a
-- template only for somebody who holds one, and until this runs every
-- account is still being answered by the four value role column.
--
-- Matched on email, which is the only thing that cannot be typed two
-- ways. Anybody it does not match is named out loud rather than quietly
-- skipped.
--
-- ---- Three things, and the second is the one that is easy to miss ----
--
--   1. Wayne's account, made the way `approve_access_request` makes one,
--      including the eight token columns that migration 091 exists for.
--   2. The legacy role column moved to match the template. Twenty three
--      row level security policies still read that column, and a
--      template that grants something the policy behind it refuses is
--      the exact "button that appears and then refuses" this whole
--      piece of work is meant to remove.
--   3. The revenue import repointed off `crm.import`, so an office
--      administrator can actually do the thing their role says they can.
--
-- ---- Safe to run twice ----
--
-- Wayne is created only if he is not there, and a second run does not
-- touch his password. The assignments are idempotent by construction.
-- The repoint reads what it is about to change and does nothing on a
-- second pass.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Wayne Kenny.
--
-- The first password is generated here and printed once, in the NOTICE
-- output of this run. It is not written down anywhere else and there is
-- no way to read it back afterwards, so copy it out of the results pane
-- before closing the tab. He should change it at first sign in.
--
-- Generated rather than typed for the obvious reason: a password in a
-- file is a password in the repository, in the chat window it was
-- pasted from, and in whatever else keeps a copy of either.
--
-- Made exactly the way `approve_access_request` makes one in migration
-- 091: confirmed on the way in, so the first sign in is not refused for
-- an unconfirmed address, and `blank_auth_tokens` called afterwards,
-- because GoTrue reads eight nullable columns into non-nullable Go
-- strings and a row inserted by hand leaves them null. That is what
-- "Database error querying schema" actually is, and it is not a schema
-- problem.
-- -------------------------------------------------------------
/* pgcrypto lives in `extensions` on Supabase and in `public` on a
   plain Postgres, so the functions below are named unqualified and the
   path carries both. Naming a schema that is not there is not an error;
   naming a function that is not there is. LOCAL, so it lasts exactly as
   long as this transaction. */
SET LOCAL search_path = public, extensions;

DO $wayne$
DECLARE
  made UUID;
  pw   TEXT;
BEGIN
  SELECT id INTO made FROM auth.users WHERE lower(email) = 'waynekenny@stc-uk.com';

  IF made IS NULL THEN
    /* Eighteen bytes of randomness, printed once. */
    pw := replace(replace(encode(gen_random_bytes(18), 'base64'), '/', '-'), '+', '_');

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'waynekenny@stc-uk.com',
      crypt(pw, gen_salt('bf')),
      NOW(), NOW(), NOW(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      '{"full_name":"Wayne Kenny"}'::JSONB
    )
    RETURNING id INTO made;

    PERFORM blank_auth_tokens(made);

    RAISE NOTICE '----------------------------------------------------------';
    RAISE NOTICE 'Wayne Kenny, waynekenny@stc-uk.com';
    RAISE NOTICE 'First password: %', pw;
    RAISE NOTICE 'Copy that now. It is not stored and cannot be read back.';
    RAISE NOTICE '----------------------------------------------------------';
  ELSE
    /* Already there, so this run is not a create. The password is left
       alone: resetting somebody's password because a file was pasted a
       second time is not a thing a migration should do. */
    PERFORM blank_auth_tokens(made);
    RAISE NOTICE 'Wayne Kenny already had an account. Password left as it was.';
  END IF;

  /* `handle_new_user` makes the profile on insert. This settles what
     that trigger cannot know. */
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (made, 'waynekenny@stc-uk.com', 'Wayne Kenny', 'admin')
  ON CONFLICT (id) DO UPDATE
     SET full_name = COALESCE(NULLIF(btrim(profiles.full_name), ''), 'Wayne Kenny');
END $wayne$;

-- -------------------------------------------------------------
-- 2. Who is on what.
--
-- The second column is the template. The third is the legacy role
-- column, set to whichever of the four the template most resembles, for
-- the policies that still read it.
--
-- David Reay moves from admin to sales, which is a narrowing and is
-- exactly what was asked for: "David Reay - Sales". He keeps everything
-- he owns, because those policies test ownership first and fall back to
-- admin, not the other way round.
--
-- STC Admin stays on viewer. The office administrators do not own
-- accounts and the policies keyed on that column are right about them:
-- everything their role does add, raising a health event and importing
-- invoicing, is decided by `command_may` and not by that column.
-- -------------------------------------------------------------
UPDATE profiles p
   SET role_template_id = rt.id,
       role             = v.legacy
  FROM (VALUES
    ('alexellis@stc-uk.com',  'developer',            'admin'),
    ('tommoore@stc-uk.com',   'business_development', 'admin'),
    ('gareth@stc-uk.com',     'managing_director',    'admin'),
    ('deanmann@stc-uk.com',   'sales_rep',            'sales'),
    ('davidreay@stc-uk.com',  'sales_rep',            'sales'),
    ('admin@stc-uk.com',      'office_admin',         'viewer'),
    ('waynekenny@stc-uk.com', 'sr_finance',           'admin')
  ) AS v(email, slug, legacy)
  JOIN role_templates rt ON rt.slug = v.slug
 WHERE lower(p.email) = v.email;

-- -------------------------------------------------------------
-- 3. The revenue import asks for the right thing.
--
-- Five functions carry `command_may('crm.import')`. They are the
-- Protean and Sage invoice import, not the CRM one, and the office
-- administrators were given `revenue.import` and not `crm.import`
-- because "see the revenue tab entirely and import but no export" is
-- about invoicing and nothing to do with bulk loading customers.
--
-- Left as it was, Admin holds a capability that no code reads, in front
-- of a function that refuses them.
--
-- ---- Why this is patched and not restated ----
--
-- A function is replaced whole, and these are long. Migration 091
-- carries a note about restating a function from memory and producing a
-- plausible one that had quietly lost its role validation. So the
-- definition is read back out of the database, one string in it is
-- replaced, and the result is executed. Nothing can be lost, because
-- nothing is retyped.
--
-- `command_import_contacts` is deliberately not in the list. That one
-- IS the CRM import, and `crm.import` is the right question for it.
-- -------------------------------------------------------------
DO $repoint$
DECLARE
  r     RECORD;
  def   TEXT;
  old   CONSTANT TEXT := 'command_may(''crm.import'')';
  fresh CONSTANT TEXT := 'command_may(''revenue.import'')';
  n     INTEGER;
  moved INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('protean_start_import', 'protean_take_invoices',
                         'protean_take_open_jobs', 'protean_would_close',
                         'protean_finish_open_jobs')
  LOOP
    def := pg_get_functiondef(r.oid);
    n := (length(def) - length(replace(def, old, ''))) / length(old);

    IF n = 0 THEN
      /* Already repointed, or never had a guard. The second is worth
         hearing about: an invoice import with no permission check at
         all is a hole, not a tidy state. */
      IF position(fresh IN def) = 0 THEN
        RAISE EXCEPTION '% has no import guard at all', r.proname;
      END IF;
      CONTINUE;
    END IF;

    IF n <> 1 THEN
      RAISE EXCEPTION '% carries % copies of the guard, so replacing it is a guess', r.proname, n;
    END IF;

    EXECUTE replace(def, old, fresh);
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'revenue import: % function(s) now ask for revenue.import', moved;
END $repoint$;

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
DO $check$
DECLARE
  missed TEXT;
  wrong  TEXT;
  still  TEXT;
BEGIN
  /* Wayne is the one person this file MAKES, so his absence is a
     failure anywhere, on any database. */
  IF NOT EXISTS (
    SELECT 1 FROM profiles p JOIN role_templates rt ON rt.id = p.role_template_id
     WHERE lower(p.email) = 'waynekenny@stc-uk.com' AND rt.slug = 'sr_finance'
  ) THEN
    RAISE EXCEPTION '104 did not land: Wayne Kenny is not on Sr Finance';
  END IF;

  /* The other six are moved, not made, so an address this database has
     never heard of is a fact about the database and not a fault in the
     file. The disposable server every check runs against has none of
     them. Said out loud either way, because a migration that matched
     nothing looks exactly like one that worked. */
  SELECT string_agg(v.email, ', ' ORDER BY v.email) INTO missed
    FROM (VALUES
      ('alexellis@stc-uk.com'), ('tommoore@stc-uk.com'), ('gareth@stc-uk.com'),
      ('deanmann@stc-uk.com'), ('davidreay@stc-uk.com'), ('admin@stc-uk.com')
    ) AS v(email)
   WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE lower(p.email) = v.email);
  IF missed IS NOT NULL THEN
    RAISE NOTICE 'no account on this database for: %', missed;
    RAISE NOTICE 'if you expected one, the address in this file is wrong and nothing was done for them';
  END IF;

  /* Whoever WAS matched has to have ended up somewhere real. This is
     the half that catches a genuine failure. */
  SELECT string_agg(p.email || ' is on ' || COALESCE(rt.slug, 'nothing'), ', ' ORDER BY p.email)
    INTO wrong
    FROM profiles p
    LEFT JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE lower(p.email) IN ('alexellis@stc-uk.com', 'tommoore@stc-uk.com',
                            'gareth@stc-uk.com', 'deanmann@stc-uk.com',
                            'davidreay@stc-uk.com', 'admin@stc-uk.com',
                            'waynekenny@stc-uk.com')
     AND (rt.slug IS NULL OR NOT rt.is_active);
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION '104 did not land: %', wrong;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO still
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname LIKE 'protean_%'
     AND p.prosrc LIKE '%command_may(''crm.import'')%';
  IF still IS NOT NULL THEN
    RAISE EXCEPTION '104 did not land: % still asks for crm.import', still;
  END IF;

  RAISE NOTICE 'seven people on their roles, and the revenue import asks for revenue.import';
END $check$;

COMMIT;

-- PostgREST caches the schema, and three of the functions above were
-- replaced. Without this they are the old ones as far as the API is
-- concerned.
NOTIFY pgrst, 'reload schema';
