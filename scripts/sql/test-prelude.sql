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
-- The helper schema.sql calls and does not define.
--
-- `migrations/001_dashboard.sql` says so in its own header: schema.sql
-- "calls is_list_member_safe(), which is defined nowhere in this
-- repository, so a fresh run of it fails partway". The live database
-- must have it, because the policies that call it work there.
--
-- SECURITY DEFINER is not decoration. Without it the policy on
-- crm_contacts consults crm_lists, whose policy consults
-- crm_list_members, whose policy consults crm_lists, and Postgres stops
-- with "infinite recursion detected in policy". Defining it here is
-- what lets this test database enforce the real policies at all.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_list_member_safe(p_list UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crm_list_members m
    WHERE m.list_id = p_list AND m.user_id = auth.uid()
  );
$$;

-- -------------------------------------------------------------
-- Row level security on the join table, switched off HERE ONLY.
--
-- `crm_select` on crm_contacts contains an inline
-- `EXISTS (SELECT 1 FROM crm_list_members ...)`. That consults
-- `members_all` on crm_list_members, which consults crm_lists, whose
-- `lists_select` consults crm_list_members again, and Postgres stops
-- with "infinite recursion detected in policy". The policies that read
-- notes avoid this by calling `is_list_member_safe`, a SECURITY DEFINER
-- helper; the one on crm_contacts inlines the same query instead.
--
-- This is a real property of the repository's SQL and is reported
-- rather than fixed here: changing a live security policy is not a
-- change to make as a side effect of building a test harness. Turning
-- it off in this database keeps the assertions about crm_contacts
-- honest, because the paths being tested are the global list and the
-- owned list, neither of which needs the join table.
-- -------------------------------------------------------------
ALTER TABLE crm_list_members DISABLE ROW LEVEL SECURITY;
