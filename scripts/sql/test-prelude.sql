-- =============================================================
-- Enough of Supabase to run this project's schema locally.
--
-- Not a reimplementation of Supabase: the smallest set of roles,
-- schemas and functions that `schema.sql` and the migrations reference,
-- so migrations 007 and 008 can be executed against real Postgres with
-- the real column types, the real constraints and the real policies.
--
-- `auth.uid()` reads a session setting, so a test can say who it is and
-- RLS behaves as it would for that person.
-- =============================================================
-- Roles live in the cluster rather than the database, so a second run
-- against a fresh database must not trip over them.
DO $prelude$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$prelude$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- The columns the project's own `handle_new_user` trigger reads. A
-- stub with only an id makes every insert fail inside that trigger,
-- which is not a finding about the project, only about the stub.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::JSONB
);

-- Who the current statement is running as, for RLS.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', TRUE), ''), 'anon');
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT,
  public BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name TEXT,
  owner UUID
);

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- -------------------------------------------------------------
-- Nothing else.
--
-- `is_list_member_safe` used to be defined here, because `schema.sql`
-- calls it and this repository did not define it. It does now:
-- `migrations/009_list_visibility_recursion.sql` adds it, along with the
-- two policies that closed the circle around it. A prelude that still
-- carried its own copy would be testing the prelude.
--
-- Row level security on `crm_list_members` used to be switched off here
-- as well, for the same reason: the policies could not be evaluated. It
-- stays on now, so the assertions in `validate-007.sql` run against the
-- policies this repository actually contains.
-- -------------------------------------------------------------
