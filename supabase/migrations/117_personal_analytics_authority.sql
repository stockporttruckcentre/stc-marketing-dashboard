-- =============================================================
-- 117. Who may see whose personal figures.
--
-- From the agreed development scope, Task 1:
--
--   This must be enforced server-side. Hiding the person selector in
--   React is not permission enforcement. Any API/RPC/query accepting a
--   selected person must independently validate that the signed-in
--   actor is authorised to view that person. A `sales_rep` manually
--   changing a query string or request body to another user's UUID must
--   receive no financial data. Centralise this rule rather than
--   reproducing slightly different role tests in several components.
--
-- So there is exactly one rule, it is in the database, and the screen
-- reads the same function it is judged by.
--
-- ---- The ladder is data, not an ordering ----
--
-- The scope is explicit: "This is an explicit Personal Analytics
-- authority ladder. Do not infer it from role-template sort order."
--
-- Sort order is a menu ordering. It puts Compliance above Business
-- Development and Observer above Sales, and reading authority out of it
-- would hand a Compliance officer everybody's revenue. So the ladder is
-- a table with one row per pairing, seeded below, and a rung can be
-- added or taken away by writing a row rather than by editing code.
--
-- ---- One name in the scope is not a slug in this repository ----
--
-- The scope names `senior_sales`. This repository's role template is
-- `sr_sales`, "Sr Sales", and there is no `senior_sales`. The other
-- four named slugs exist exactly as written. Taken as the same role
-- under the repository's own name, which is what the scope's own
-- instruction to use `role_templates.slug` requires. Nothing else is
-- assumed: if Sr Sales is not what was meant, this seed is the one
-- place to say so.
-- =============================================================

-- -------------------------------------------------------------
-- The rungs.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_analytics_authority (
  viewer_slug   TEXT NOT NULL,
  may_view_slug TEXT NOT NULL,
  PRIMARY KEY (viewer_slug, may_view_slug)
);

COMMENT ON TABLE personal_analytics_authority IS
  'Who may open whose Personal Analytics, by role template slug. One row per pairing. '
  'Seeded from the agreed development scope, Task 1. Not derived from sort order.';

ALTER TABLE personal_analytics_authority ENABLE ROW LEVEL SECURITY;

/* Readable by anybody signed in, because the screen has to draw the
   selector from it. Writable by nobody through PostgREST: changing who
   can see whose revenue is a migration or an administrator with direct
   access, not an API call. */
DROP POLICY IF EXISTS "personal_authority_read" ON personal_analytics_authority;
CREATE POLICY "personal_authority_read" ON personal_analytics_authority
  FOR SELECT USING (auth.role() = 'authenticated');

GRANT SELECT ON personal_analytics_authority TO authenticated;

-- -------------------------------------------------------------
-- The seed: the rungs BELOW each role. Not the role itself.
--
-- "Themselves" is deliberately absent from this table, and the first
-- run of `check:personal-analytics` is why. Seeding `sales_rep` as able
-- to view `sales_rep` reads like "a rep can see their own figures" and
-- means something else entirely: it makes every rep able to open every
-- other rep, which is the first thing the scope forbids.
--
--   `sales_rep` Can see only themselves. They cannot supply another
--   user ID and retrieve that person's personal figures.
--
-- Seeing yourself is identity, not a role pairing, and it is handled as
-- identity in `personal_analytics_may_view` below. The same trap sits
-- on every other rung: two Sr Sales are peers and neither manages the
-- other, and the scope lists only `sales_rep` under `senior_sales`.
-- -------------------------------------------------------------
DELETE FROM personal_analytics_authority;

INSERT INTO personal_analytics_authority (viewer_slug, may_view_slug) VALUES
  -- Sales: nobody below them. Themselves only, by identity.

  -- Sr Sales, over Sales.
  ('sr_sales',             'sales_rep'),

  -- Business Development, over Sr Sales and Sales.
  ('business_development', 'sr_sales'),
  ('business_development', 'sales_rep'),

  -- Managing Director, over Business Development and below.
  ('managing_director',    'business_development'),
  ('managing_director',    'sr_sales'),
  ('managing_director',    'sales_rep'),

  -- Developer, over every rung below.
  ('developer',            'managing_director'),
  ('developer',            'business_development'),
  ('developer',            'sr_sales'),
  ('developer',            'sales_rep');

/* Which roles get a Personal view at all, which is no longer derivable
   from the table above now that the bottom rung has no rows in it. The
   scope names these five and no others. */
CREATE TABLE IF NOT EXISTS personal_analytics_roles (
  slug TEXT PRIMARY KEY
);

COMMENT ON TABLE personal_analytics_roles IS
  'The role templates that get a Personal Analytics view. Seeded from the agreed '
  'development scope, Task 1. Finance, Marketing, Admin, HR and Read Only are not here '
  'on purpose, whatever company Analytics they can otherwise reach.';

ALTER TABLE personal_analytics_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_roles_read" ON personal_analytics_roles;
CREATE POLICY "personal_roles_read" ON personal_analytics_roles
  FOR SELECT USING (auth.role() = 'authenticated');
GRANT SELECT ON personal_analytics_roles TO authenticated;

DELETE FROM personal_analytics_roles;
INSERT INTO personal_analytics_roles (slug) VALUES
  ('sales_rep'), ('sr_sales'), ('business_development'),
  ('managing_director'), ('developer');

-- -------------------------------------------------------------
-- The role template somebody is actually on.
--
-- `profiles.role_template_id`, not the legacy `profiles.role` column.
-- The scope says so, and migration 068 is the evening that says why:
-- an administrator whose access came from a template was bounced off
-- their own screen by a hardcoded read of the legacy column.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_analytics_slug(p_person UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT rt.slug
    FROM profiles p
    JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE p.id = p_person
     AND COALESCE(p.is_active, TRUE)
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION personal_analytics_slug(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_analytics_slug(UUID) TO authenticated;

-- -------------------------------------------------------------
-- Is Personal open to the person asking at all.
--
-- The scope: "Do not expose Personal to Finance, Marketing, Admin
-- Operations, HR, Department Manager or Read Only merely because those
-- roles may otherwise be able to access company Analytics." So this is
-- not `analytics.view`. A Finance controller can open Analytics and
-- cannot open Personal, and that is the intended difference.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_analytics_eligible()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM personal_analytics_roles
     WHERE slug = personal_analytics_slug(current_actor())
  );
$fn$;

REVOKE ALL ON FUNCTION personal_analytics_eligible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_analytics_eligible() TO authenticated;

-- -------------------------------------------------------------
-- THE RULE. Every personal figure goes through this one function.
--
-- A `sales_rep` who edits the UUID in a request reaches here and is
-- refused, because the answer does not depend on what the screen drew.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_analytics_may_view(p_person UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_person IS NOT NULL
     AND personal_analytics_eligible()
     AND (
       /* Yourself. Identity, not a role pairing: two people on one role
          are peers and neither manages the other. */
       (p_person = current_actor()
        AND personal_analytics_slug(p_person) IS NOT NULL)
       /* Or somebody on a rung this role sits above. */
       OR EXISTS (
         SELECT 1
           FROM personal_analytics_authority a
          WHERE a.viewer_slug   = personal_analytics_slug(current_actor())
            AND a.may_view_slug = personal_analytics_slug(p_person)
       )
     );
$fn$;

COMMENT ON FUNCTION personal_analytics_may_view(UUID) IS
  'The one rule for Personal Analytics visibility. Every function that returns a '
  'personal figure calls this before returning a row.';

REVOKE ALL ON FUNCTION personal_analytics_may_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_analytics_may_view(UUID) TO authenticated;

-- -------------------------------------------------------------
-- Who the selector may offer.
--
-- The same rule, read forwards. A screen that built this list itself
-- would be a second copy of the ladder, and the two would drift.
-- `is_self` is here so the screen can open on the right person without
-- comparing ids it had to fetch separately.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_analytics_people();
CREATE OR REPLACE FUNCTION personal_analytics_people()
RETURNS TABLE (
  id        UUID,
  full_name TEXT,
  email     TEXT,
  role_slug TEXT,
  role_name TEXT,
  is_self   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT personal_analytics_eligible() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.full_name,
         p.email,
         rt.slug,
         rt.name,
         p.id = current_actor()
    FROM profiles p
    JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE COALESCE(p.is_active, TRUE)
     AND (
       p.id = current_actor()
       OR EXISTS (
         SELECT 1 FROM personal_analytics_authority a
          WHERE a.viewer_slug   = personal_analytics_slug(current_actor())
            AND a.may_view_slug = rt.slug
       )
     )
   /* Yourself first, then everybody else by name. A selector that opens
      on somebody else's revenue is a selector somebody misreads. */
   ORDER BY (p.id = current_actor()) DESC, p.full_name;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_analytics_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_analytics_people() TO authenticated;

DO $$ BEGIN RAISE NOTICE 'personal analytics authority: one ladder, in one place'; END $$;
