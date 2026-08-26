-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 042_entities_departments_people.sql. This repository already had a 042 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 042. Who owns a record, who works where, and who somebody is.
--
-- Three tables and a set of columns on `profiles`. They are one
-- migration because the permission model in 043 needs all of them and
-- landing them separately would mean three half-usable states.
--
-- ---- Owning entity ----
--
-- This is not one company. Stockport Truck Centre is the maintenance
-- business: workshop, parts, MOT, Trukplan. STC Sales and Leasing is the
-- trailer business: sales, rental, contract hire. Protean holds them as
-- separate accounts, which is why a customer can have a maintenance
-- record and a sales record and why the CRM twins them.
--
-- Every substantive record carries an owning entity, and it is a
-- permission boundary before it is a label. Work that belongs to one
-- company can be kept off the other company's staff.
--
-- Retrofitting this onto a CRM after a year of data is painful, so it
-- goes in before there is any.
--
-- Only the entity table lands here. Stamping `owning_entity` onto record
-- tables happens as each one is built or rebuilt, because half of them
-- are being replaced in the CRM decomposition and columns added to a
-- table that is about to be dropped are wasted work.
--
-- ---- Departments and teams ----
--
-- Permission scopes of own,
-- assigned, team, department, project, company-wide and specific
-- records. Three of those seven name a thing that does not exist in this
-- schema, which is why this migration comes before the permission one.
--
-- The department list is seeded, not hardcoded. Scope 32 says do not
-- hardcode this exact list into business logic, so it is rows an
-- administrator edits rather than an enum a developer edits.
--
-- ---- People ----
--
-- Scope section 31. `profiles` had seven columns and no notion of where
-- anybody sits. It gains a manager, a department, a job title and the
-- rest of a directory, plus three columns that come from elsewhere:
--
--   aliases            from the meeting, section 3. First-name-only references
--                      are constant in internal material and Sean has two
--                      names in circulation. A single display name
--                      produces duplicate people within a week.
--   directory_object_id  Microsoft Entra, confirmed as the identity
--                      provider. Nullable, and profiles keep their own
--                      id as the key, so linking an account to Entra
--                      later is an UPDATE rather than a re-key of every
--                      foreign key in the schema.
--   is_insider         from the meeting, 4.5. Officers and directors have
--                      restricted trading windows and filing
--                      obligations. Whether the intranet carries any of
--                      the Section 16 workflow is still open; carrying
--                      the designation costs one boolean either way.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The legal entities this installation serves.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Stable and short, because this appears in code and in URLs.
  code         TEXT UNIQUE NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name         TEXT NOT NULL,
  legal_name   TEXT,
  jurisdiction TEXT,
  -- The ticker, where the entity has one. Rendered as `OTCID: CRCW` and
  -- never as a bare CRCW, per the kit's brand constraints.
  ticker       TEXT,
  -- What a record gets when nobody says otherwise.
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One default, enforced rather than assumed. Two defaults means every
-- unattributed record lands in whichever the query happened to return.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_entity
  ON entities (is_default) WHERE is_default;

/* THE TWO COMPANIES, AS THE BUSINESS DESCRIBES THEM.

   From the meeting: Stockport Truck Centre is the maintenance side and
   STC Sales and Leasing is the trailer side, and Protean treats them as
   separate accounts, which is why the CRM has twinned records at all.

   The maintenance company is the default because it is the older of the
   two and the one everybody has an account on. */
INSERT INTO entities (code, name, legal_name, jurisdiction, ticker, is_default, sort_order)
VALUES
  ('stc',  'Stockport Truck Centre', 'Stockport Truck Centre Ltd',  'England and Wales', NULL, TRUE,  1),
  ('stcsl','STC Sales and Leasing',  'STC Sales and Leasing Ltd',   'England and Wales', NULL, FALSE, 2)
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------------
-- 2. Departments.
--
-- `entity_id` is nullable on purpose. Workshop serves the maintenance
-- company, Sales serves the leasing company, and Marketing serves both.
-- A department with no entity is a shared one.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name       TEXT NOT NULL,
  entity_id  UUID REFERENCES entities ON DELETE SET NULL,
  parent_id  UUID REFERENCES departments ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_entity ON departments (entity_id);

/* The parts of this business somebody can be tasked as. Shared where
   the work genuinely serves both companies, which is most of them. */
INSERT INTO departments (slug, name, sort_order) VALUES
  ('management',  'Management',           1),
  ('sales',       'Sales',                2),
  ('workshop',    'Workshop',             3),
  ('parts',       'Parts',                4),
  ('rental',      'Rental and Leasing',   5),
  ('marketing',   'Marketing',            6),
  ('transport',   'Transport',            7),
  ('accounts',    'Accounts',             8),
  ('reception',   'Reception',            9)
ON CONFLICT (slug) DO NOTHING;

/* Which company each one answers to, where it is only one of them. */
UPDATE departments d SET entity_id = e.id
  FROM entities e
 WHERE e.code = 'stc' AND d.slug IN ('workshop', 'parts') AND d.entity_id IS NULL;
UPDATE departments d SET entity_id = e.id
  FROM entities e
 WHERE e.code = 'stcsl' AND d.slug IN ('sales', 'rental') AND d.entity_id IS NULL;

-- -------------------------------------------------------------
-- 3. Teams.
--
-- A team sits inside a department and a person can be on several, which
-- is why membership is its own table rather than a column. Scope 34's
-- `team` scope reads this.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name          TEXT NOT NULL,
  department_id UUID REFERENCES departments ON DELETE SET NULL,
  lead_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_department ON teams (department_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id  UUID NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- What they do on this team, which is not their job title.
  role     TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

-- -------------------------------------------------------------
-- 4. The people directory.
-- -------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS entity_id           UUID REFERENCES entities ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department_id       UUID REFERENCES departments ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_id          UUID REFERENCES auth.users ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title           TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo_url           TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location            TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone            TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS working_hours       TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS responsibilities    TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS skills              TEXT[] NOT NULL DEFAULT '{}';

-- Every name this person is referred to by, lowercased on write by the
-- application. See the header: two names for one person is the normal
-- case here, not the exception.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS aliases             TEXT[] NOT NULL DEFAULT '{}';

-- Microsoft Entra. Null until SSO lands, and null forever for any
-- account that never had a directory identity.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS directory_object_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS directory_synced_at TIMESTAMPTZ;

-- Restricted trading windows and Section 16 filing obligations.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_insider          BOOLEAN NOT NULL DEFAULT FALSE;

-- Deprovisioning. An account is deactivated rather than deleted, because
-- the records it created still point at it and because the retention
-- rules in from the meeting, 4.4 assume history survives the person.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles (department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_manager    ON profiles (manager_id);
CREATE INDEX IF NOT EXISTS idx_profiles_entity     ON profiles (entity_id);
-- One Entra account maps to one person. A duplicate here would let two
-- profiles claim the same sign in.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_directory_object
  ON profiles (directory_object_id) WHERE directory_object_id IS NOT NULL;
-- Finding somebody by any name they go by.
CREATE INDEX IF NOT EXISTS idx_profiles_aliases ON profiles USING GIN (aliases);

-- Everyone starts on the default entity. Somebody who works for one side
-- only gets narrowed by an administrator; guessing from an email domain
-- would be wrong for anybody who works across both.
UPDATE profiles SET entity_id = (SELECT id FROM entities WHERE is_default)
WHERE entity_id IS NULL;

-- -------------------------------------------------------------
-- 5. Reading the directory, and who may change it.
--
-- The org chart is not a secret. Everybody signed in can read entities,
-- departments, teams and membership, because scope 31 wants questions
-- like "who owns validator communications" to be answerable by anybody.
--
-- Writes go through `admin.users`, checked by name rather than by a
-- policy that repeats the rule.
-- -------------------------------------------------------------
ALTER TABLE entities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entities_read"     ON entities;
DROP POLICY IF EXISTS "departments_read"  ON departments;
DROP POLICY IF EXISTS "teams_read"        ON teams;
DROP POLICY IF EXISTS "team_members_read" ON team_members;

-- `anon` is included on entities alone: the sign in page needs to know
-- which company it belongs to, same reason `tenant_settings` is public.
CREATE POLICY "entities_read"     ON entities     FOR SELECT USING (TRUE);
CREATE POLICY "departments_read"  ON departments  FOR SELECT USING (current_actor() IS NOT NULL);
CREATE POLICY "teams_read"        ON teams        FOR SELECT USING (current_actor() IS NOT NULL);
CREATE POLICY "team_members_read" ON team_members FOR SELECT USING (current_actor() IS NOT NULL);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['entities', 'departments', 'teams', 'team_members'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM authenticated', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 6. Which team is somebody on, and which department.
--
-- Written once here so the permission model in 043 and every policy
-- after it ask the same question the same way. SECURITY DEFINER because
-- a scope check has to be able to see membership rows the caller's own
-- policies might not show them.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION actor_department()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT department_id FROM profiles WHERE id = current_actor()
$fn$;

CREATE OR REPLACE FUNCTION actor_teams()
RETURNS UUID[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(team_id), '{}')
  FROM team_members WHERE user_id = current_actor()
$fn$;

CREATE OR REPLACE FUNCTION actor_entity()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT entity_id FROM profiles WHERE id = current_actor()
$fn$;

REVOKE ALL ON FUNCTION actor_department() FROM PUBLIC;
REVOKE ALL ON FUNCTION actor_teams()      FROM PUBLIC;
REVOKE ALL ON FUNCTION actor_entity()     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_department() TO authenticated;
GRANT EXECUTE ON FUNCTION actor_teams()      TO authenticated;
GRANT EXECUTE ON FUNCTION actor_entity()     TO authenticated;
