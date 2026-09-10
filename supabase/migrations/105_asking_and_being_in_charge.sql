-- =============================================================
-- 105. Asking for something, and being in charge of somebody.
--
-- Three things the eleven roles need in order to be usable rather than
-- merely correct, and they all turn on one fact the database did not
-- hold: who is in charge of whom.
--
-- From the business:
--
--   Ensure everything connects to something though - if one role cannot
--   export and one can, ensure the button states reflect this across the
--   accounts, that one user understand why they don't have access and
--   who to contact to perform that task.
--
--   BD - this is tom's role, he manages sales and marketing departments.
--   He needs everything they have and ways of managing them.
--
--   the only difference here is that they're the sales overseer, so like
--   when you mark a crm customer as red it'll alert Sr Sales etc.
--
-- And when asked what a blocked button should do, rather than simply
-- greying out: "Request it, and Sr gets a decision."
--
-- ---- One fact, three uses ----
--
-- A role now says which department it belongs to, which departments it
-- RUNS, and who it escalates to. From that:
--
--   1. A refusal can name the role to ask, and the person can ask.
--   2. `admin.usersDepartment` reaches exactly the people in the
--      departments you run and nobody else.
--   3. A red account tells its owner, and everybody who runs sales.
--
-- Written in `lib/platform/permissions/roles.ts` and generated into the
-- block below, for the reason 103 gives at length: a list of slugs typed
-- into a migration stops being right the first time somebody adds a role
-- and nothing says so.
--
-- ---- Safe to run twice ----
--
-- Columns are added IF NOT EXISTS, the shape is an UPDATE, and both
-- functions replace themselves.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. A role has a shape as well as a list of capabilities.
-- -------------------------------------------------------------
ALTER TABLE role_templates
  ADD COLUMN IF NOT EXISTS department   TEXT,
  -- Which departments this role RUNS. Empty for everybody who runs none.
  ADD COLUMN IF NOT EXISTS manages      TEXT[] NOT NULL DEFAULT '{}',
  -- The slug of the role that signs off what this one is refused.
  ADD COLUMN IF NOT EXISTS escalates_to TEXT;

CREATE INDEX IF NOT EXISTS idx_role_templates_department ON role_templates (department);

-- >>> GENERATED FROM lib/platform/permissions/roles.ts. Do not edit by hand.

UPDATE role_templates rt
   SET department   = v.department,
       manages      = v.manages,
       escalates_to = v.escalates_to
  FROM (VALUES
    ('developer', 'exec', ARRAY['sales', 'marketing', 'finance', 'admin', 'exec']::TEXT[], NULL::TEXT),
    ('managing_director', 'exec', ARRAY['sales', 'marketing', 'finance', 'admin', 'exec']::TEXT[], NULL::TEXT),
    ('business_development', 'exec', ARRAY['sales', 'marketing']::TEXT[], 'managing_director'::TEXT),
    ('sr_sales', 'sales', ARRAY['sales']::TEXT[], 'business_development'::TEXT),
    ('sales_rep', 'sales', '{}'::TEXT[], 'sr_sales'::TEXT),
    ('sr_marketing', 'marketing', ARRAY['marketing']::TEXT[], 'business_development'::TEXT),
    ('marketing_exec', 'marketing', '{}'::TEXT[], 'sr_marketing'::TEXT),
    ('sr_finance', 'finance', ARRAY['finance', 'admin']::TEXT[], 'managing_director'::TEXT),
    ('finance', 'finance', '{}'::TEXT[], 'sr_finance'::TEXT),
    ('sr_office_admin', 'admin', ARRAY['admin']::TEXT[], 'managing_director'::TEXT),
    ('office_admin', 'admin', '{}'::TEXT[], 'sr_office_admin'::TEXT)
  ) AS v(slug, department, manages, escalates_to)
 WHERE rt.slug = v.slug;

-- <<< END GENERATED

-- -------------------------------------------------------------
-- 2. Who do I ask.
--
-- From the business: "have a hover-over 'ask your department lead to run
-- this' for regular admin users".
--
-- It names a ROLE and never a person. People leave, and a button that
-- names somebody who left is worse than one that names nobody. The Team
-- screen turns the role into whoever currently holds it.
--
-- Walks up the escalation chain from the caller's own role to the first
-- one above them that actually holds the capability. Null means nobody
-- above them has it either, and the interface says "nobody here can do
-- that" rather than sending them on a walk.
-- -------------------------------------------------------------
/* Dropped first. It returns a TABLE, and `CREATE OR REPLACE` cannot
   change one: adding a column to the list answers "cannot change return
   type of existing function". `npm run check:migrations` enforces it. */
DROP FUNCTION IF EXISTS escalation_for(TEXT);

CREATE OR REPLACE FUNCTION escalation_for(p_capability TEXT)
RETURNS TABLE (slug TEXT, name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  at    TEXT;
  seen  TEXT[] := '{}';
  found RECORD;
BEGIN
  IF command_may(p_capability) THEN
    /* They already hold it, so there is nobody to ask. Not an error:
       the interface asks this about buttons it is deciding how to draw,
       and the answer for most of them is "you can just press it". */
    RETURN;
  END IF;

  SELECT rt.slug INTO at
    FROM profiles p JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE p.id = current_actor();

  IF at IS NULL THEN
    /* No template, so no chain. Falls back to whoever runs their
       department, and to nothing if that is nobody. */
    RETURN QUERY
      SELECT rt.slug, rt.name FROM role_templates rt
       WHERE rt.is_active
         AND EXISTS (SELECT 1 FROM role_template_capabilities c
                      WHERE c.role_template_id = rt.id AND c.capability = p_capability)
       ORDER BY rt.sort_order
       LIMIT 1;
    RETURN;
  END IF;

  LOOP
    SELECT rt.escalates_to INTO at FROM role_templates rt WHERE rt.slug = at;
    EXIT WHEN at IS NULL OR at = ANY(seen);
    seen := seen || at;

    SELECT rt.slug AS s, rt.name AS n INTO found
      FROM role_templates rt
     WHERE rt.slug = at AND rt.is_active
       AND EXISTS (SELECT 1 FROM role_template_capabilities c
                    WHERE c.role_template_id = rt.id AND c.capability = p_capability);

    IF found.s IS NOT NULL THEN
      slug := found.s; name := found.n; RETURN NEXT; RETURN;
    END IF;
  END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION escalation_for(TEXT) TO authenticated;

COMMENT ON FUNCTION escalation_for(TEXT) IS
  'The role to ask for a capability the caller does not hold. Names a '
  'role and never a person, because people leave. Returns no row when '
  'they already hold it, and no row when nobody above them holds it.';

-- -------------------------------------------------------------
-- 3. Am I in charge of this person, and may I change their access.
--
-- Two questions, and running them together was a mistake worth writing
-- down. Sr Sales runs the sales department and holds no administrative
-- right at all, which is correct: being somebody's lead is not the same
-- as being able to edit their account. The first version asked the
-- second question in order to answer the first, and Sr Sales could not
-- decide a request from their own salesperson.
--
--   in_charge_of    does my ROLE run the department this person is in
--   may_manage_user may I change their access
--
-- The first needs no capability. The second needs `admin.users`, which
-- reaches everybody, or `admin.usersDepartment`, which reaches only the
-- departments the caller's role runs. For Tom that is sales and
-- marketing, which is exactly what was asked for.
--
-- Nobody is in charge of themselves and nobody manages themselves. That
-- is not pedantry: every guard in `073_the_permission_hub.sql` exists
-- because somebody could otherwise change their own access, and neither
-- of these may be the way back in.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION in_charge_of(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  mine   TEXT[];
  theirs TEXT;
BEGIN
  IF p_user IS NULL THEN RETURN FALSE; END IF;
  IF p_user = current_actor() THEN RETURN FALSE; END IF;

  SELECT rt.manages INTO mine
    FROM profiles p JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE p.id = current_actor();

  IF mine IS NULL OR cardinality(mine) = 0 THEN RETURN FALSE; END IF;

  SELECT rt.department INTO theirs
    FROM profiles p LEFT JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE p.id = p_user;

  /* Somebody with no role yet belongs to no department, and a
     department lead is not in charge of them. Erring towards refusal is
     the right direction: the alternative hands Tom the finance director
     on the day somebody forgets to set a role. */
  IF theirs IS NULL THEN RETURN FALSE; END IF;

  RETURN theirs = ANY(mine);
END;
$fn$;

GRANT EXECUTE ON FUNCTION in_charge_of(UUID) TO authenticated;

COMMENT ON FUNCTION in_charge_of(UUID) IS
  'Does the caller''s role run the department this person works in. No '
  'capability required: a lead is a lead whether or not they can also '
  'edit accounts. Never yourself.';

CREATE OR REPLACE FUNCTION may_manage_user(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_user IS NULL OR p_user = current_actor() THEN RETURN FALSE; END IF;
  IF command_may('admin.users') THEN RETURN TRUE; END IF;
  RETURN command_may('admin.usersDepartment') AND in_charge_of(p_user);
END;
$fn$;

GRANT EXECUTE ON FUNCTION may_manage_user(UUID) TO authenticated;

COMMENT ON FUNCTION may_manage_user(UUID) IS
  'May the caller change this person''s access. admin.users reaches '
  'everybody; admin.usersDepartment reaches only the departments the '
  'caller''s role runs. Never yourself, by either route.';

-- -------------------------------------------------------------
-- 4. Asking for something you may not do.
--
-- From the business, choosing between a greyed out button and something
-- that goes somewhere: "Request it, and Sr gets a decision."
--
-- A request names the capability, what they were trying to do when they
-- hit the wall, and why. Approving it writes a per user override, which
-- is the mechanism migration 049 already built for exactly this: one
-- person, one capability, without inventing a role for them.
--
-- ---- The two rules on deciding ----
--
--   You cannot grant what you do not hold. Otherwise the senior office
--   administrator, who holds `access.decide`, could hand somebody the
--   CRM export they cannot run themselves.
--
--   You can only decide for somebody you are in charge of. Sr Sales
--   decides for sales. Tom decides for sales and marketing. The MD
--   decides for anybody.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capability_requests (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asked_by     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  capability   TEXT NOT NULL,
  -- What they were doing. "Export the STC pipeline", not "crm.export".
  doing        TEXT,
  -- Why, in their words. Optional: making it required produces "asdf".
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'refused', 'withdrawn')),
  decided_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  note         TEXT,
  -- A grant can be for the afternoon rather than for ever, which is what
  -- makes approving a one off export a smaller decision than it looks.
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open request per person per capability. Asking twice is the same
-- ask, and two rows means two people answer it and one of them wastes
-- their time.
CREATE UNIQUE INDEX IF NOT EXISTS capability_requests_one_open
  ON capability_requests (asked_by, capability)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_capreq_status ON capability_requests (status, created_at DESC);

ALTER TABLE capability_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capreq_read ON capability_requests;
-- Your own, always. Everybody else's only if you could decide it.
CREATE POLICY capreq_read ON capability_requests
  FOR SELECT USING (
    asked_by = current_actor()
    OR (command_may('access.decide') AND (in_charge_of(asked_by) OR command_may('admin.users')))
  );

-- Nothing is written from the application directly. Both verbs are
-- functions, because both have to check something a policy cannot say.
REVOKE INSERT, UPDATE, DELETE ON capability_requests FROM authenticated, anon;
GRANT SELECT ON capability_requests TO authenticated;

CREATE OR REPLACE FUNCTION request_capability(
  p_capability TEXT,
  p_doing      TEXT DEFAULT NULL,
  p_reason     TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me    UUID := current_actor();
  up    RECORD;
  fresh UUID;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF NOT command_may('access.request') THEN
    RAISE EXCEPTION 'Asking for access is not something this account can do.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM capability_catalog WHERE key = p_capability AND is_active) THEN
    RAISE EXCEPTION 'There is nothing called %.', p_capability;
  END IF;
  IF command_may(p_capability) THEN
    RAISE EXCEPTION 'You already have that.';
  END IF;

  /* An existing open request is answered with its own id rather than an
     error. Pressing the button twice is not a mistake worth a red
     message, and the screen shows "asked already" either way. */
  SELECT id INTO fresh FROM capability_requests
   WHERE asked_by = me AND capability = p_capability AND status = 'pending';
  IF fresh IS NOT NULL THEN RETURN fresh; END IF;

  INSERT INTO capability_requests (asked_by, capability, doing, reason)
  VALUES (me, p_capability, NULLIF(btrim(COALESCE(p_doing, '')), ''),
          NULLIF(btrim(COALESCE(p_reason, '')), ''))
  RETURNING id INTO fresh;

  /* Tell whoever can decide it. Everybody who holds `access.decide` and
     is in charge of this person, which for a salesperson is Sr Sales,
     Tom and the MD, and is nobody at all if their department has no
     lead, in which case the request sits and the screen says so. */
  PERFORM notify(
    d.id, 'access.requested',
    COALESCE(me_name.full_name, 'Somebody') || ' has asked for ' || COALESCE(c.label, p_capability),
    COALESCE(NULLIF(btrim(COALESCE(p_doing, '')), ''), c.description),
    /* Not the Admin screen. A sales lead decides for their own people
       and holds no administrative capability, so Admin refuses them and
       a notification pointing there points nowhere they can go. */
    '/dashboard/requests',
    me, 'request', fresh,
    jsonb_build_object('capability', p_capability, 'reason', p_reason),
    NULL, 'capreq:' || fresh::TEXT)
    FROM profiles d
    CROSS JOIN (SELECT full_name FROM profiles WHERE id = me) me_name
    LEFT JOIN capability_catalog c ON c.key = p_capability
   WHERE d.is_active IS NOT FALSE
     AND d.id <> me
     AND EXISTS (
       SELECT 1 FROM role_template_capabilities rc
        WHERE rc.role_template_id = d.role_template_id
          AND rc.capability IN ('access.decide', 'admin.users'))
     AND EXISTS (
       SELECT 1 FROM role_template_capabilities rc
        WHERE rc.role_template_id = d.role_template_id
          AND rc.capability = p_capability);

  RETURN fresh;
END;
$fn$;

REVOKE ALL ON FUNCTION request_capability(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_capability(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION decide_capability_request(
  p_request UUID,
  p_grant   BOOLEAN,
  p_note    TEXT        DEFAULT NULL,
  p_until   TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  req capability_requests;
  me  UUID := current_actor();
BEGIN
  SELECT * INTO req FROM capability_requests WHERE id = p_request;
  IF req IS NULL THEN RAISE EXCEPTION 'There is no request with that id.'; END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request was already %.', req.status;
  END IF;

  IF NOT command_may('access.decide') AND NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Deciding what somebody may do is a department lead''s job.';
  END IF;

  /* `in_charge_of` and not `may_manage_user`. Sr Sales runs sales and
     holds no administrative right at all, and deciding what their own
     salesperson may do is the whole job. Requiring an admin capability
     here meant only Tom and the MD could answer anybody, which is the
     opposite of "Request it, and Sr gets a decision". */
  IF NOT in_charge_of(req.asked_by) AND NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'That person is not in a department you run.';
  END IF;

  /* You cannot grant what you do not hold. Without this the senior
     office administrator, who holds access.decide, could hand somebody
     the CRM export that their own role refuses them. */
  IF p_grant AND NOT command_may(req.capability) THEN
    RAISE EXCEPTION 'You cannot grant % because you do not have it yourself.', req.capability;
  END IF;

  UPDATE capability_requests
     SET status     = CASE WHEN p_grant THEN 'approved' ELSE 'refused' END,
         decided_by = me,
         decided_at = NOW(),
         note       = NULLIF(btrim(COALESCE(p_note, '')), ''),
         expires_at = CASE WHEN p_grant THEN p_until ELSE NULL END
   WHERE id = p_request;

  IF p_grant THEN
    /* The mechanism migration 049 built for exactly this. An override
       beats the template in both directions, so this is also how it is
       taken away again later. */
    INSERT INTO user_capability_overrides
      (user_id, capability, granted, reason, granted_by, expires_at)
    VALUES (req.asked_by, req.capability, TRUE,
            COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''),
                     'Asked for it on ' || to_char(req.created_at, 'DD Mon YYYY')),
            me, p_until)
    ON CONFLICT (user_id, capability) DO UPDATE
       SET granted = TRUE, reason = EXCLUDED.reason,
           granted_by = EXCLUDED.granted_by, granted_at = NOW(),
           expires_at = EXCLUDED.expires_at;
  END IF;

  PERFORM notify(
    req.asked_by,
    CASE WHEN p_grant THEN 'access.approved' ELSE 'access.refused' END,
    CASE WHEN p_grant
         THEN 'You can now ' || COALESCE(lower(c.label), req.capability)
         ELSE 'Your request to ' || COALESCE(lower(c.label), req.capability) || ' was turned down'
    END,
    COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''),
             CASE WHEN p_grant THEN NULL ELSE 'No reason was given.' END),
    '/dashboard/requests', me, 'request', req.id,
    jsonb_build_object('capability', req.capability, 'granted', p_grant,
                       'expires_at', p_until),
    NULL, 'capreq:' || req.id::TEXT || ':decided')
    FROM (SELECT 1) one
    LEFT JOIN capability_catalog c ON c.key = req.capability;

  PERFORM audit(
    'update', 'user_capability_overrides', req.asked_by, req.capability,
    jsonb_build_object('from_request', p_request, 'granted', p_grant,
                       'expires_at', p_until));

  RETURN jsonb_build_object('request', p_request, 'granted', p_grant,
                            'capability', req.capability, 'expires_at', p_until);
END;
$fn$;

REVOKE ALL ON FUNCTION decide_capability_request(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_capability_request(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated;

-- Withdrawing your own. Nobody else's, and only while it is open.
CREATE OR REPLACE FUNCTION withdraw_capability_request(p_request UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE capability_requests
     SET status = 'withdrawn', decided_at = NOW()
   WHERE id = p_request AND asked_by = current_actor() AND status = 'pending';
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION withdraw_capability_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_capability_request(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. The three notifications this raises.
-- -------------------------------------------------------------
INSERT INTO notification_kinds
  (key, category, label, blurb, audience, severity, default_on, may_mute,
   capability, self_ok, bundle_title, sort_order)
VALUES
  ('access.requested', 'admin',
   'Somebody asks you for access',
   'A person in a department you run has hit a button they cannot press and asked for it.',
   'personal', 'attention', TRUE, FALSE, 'access.decide', FALSE, NULL, 300),

  ('access.approved', 'admin',
   'You are given access you asked for',
   'A department lead has approved something you asked to be able to do.',
   'personal', 'attention', TRUE, FALSE, NULL, FALSE, NULL, 301),

  ('access.refused', 'admin',
   'A request of yours is turned down',
   'With whatever the person deciding wrote, so the answer is not silence.',
   'personal', 'attention', TRUE, FALSE, NULL, FALSE, NULL, 302)
ON CONFLICT (key) DO UPDATE SET
  category = EXCLUDED.category, label = EXCLUDED.label, blurb = EXCLUDED.blurb,
  audience = EXCLUDED.audience, severity = EXCLUDED.severity,
  capability = EXCLUDED.capability, sort_order = EXCLUDED.sort_order;

-- -------------------------------------------------------------
-- 6. A red account tells the people in charge of sales.
--
-- From the business: "they're the sales overseer, so like when you mark
-- a crm customer as red it'll alert Sr Sales etc." Asked who exactly:
-- "Account owner, Sr Sales and BD."
--
-- The owner already hears, through `crm_account_managers`. This adds
-- everybody whose ROLE runs the sales department, which today is Sr
-- Sales and Business Development and tomorrow is whoever else is put in
-- charge of sales. Naming those two by slug would have been shorter and
-- would have stopped being true the first time somebody added a role.
--
-- ---- Running everything is not being the sales overseer ----
--
-- Developer and Managing Director run every department, which is right
-- for editing accounts and wrong here: the list asked for was three
-- people, and an urgent notification that cannot be muted, on every red
-- account in the company, is how the MD stops reading them.
--
-- So the rule is "runs sales, and does not run the executive layer".
-- Only the two roles that hold the whole application run `exec`. If the
-- MD does want them, take the `exec` line out and everybody who runs
-- sales hears, which is the one line this turns on.
--
-- Amber is deliberately not included. Amber waits for the button by
-- design, and sending it up the chain as well would make the two levels
-- mean the same thing.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_red_flag_audience(UUID);

CREATE OR REPLACE FUNCTION crm_red_flag_audience(p_contact UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT user_id FROM crm_account_managers(p_contact)
  UNION
  SELECT p.id
    FROM profiles p
    JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE rt.is_active
     AND p.is_active IS NOT FALSE
     AND 'sales' = ANY(rt.manages)
     AND NOT ('exec' = ANY(rt.manages));
$fn$;

GRANT EXECUTE ON FUNCTION crm_red_flag_audience(UUID) TO authenticated;

COMMENT ON FUNCTION crm_red_flag_audience(UUID) IS
  'Who hears when an account goes red: whoever owns it, plus everybody '
  'whose role runs the sales department without running the whole '
  'company. Driven off the role rather than a list of names, so it '
  'stays right when somebody is promoted.';

COMMIT;

-- -------------------------------------------------------------
-- 7. And the function that sends it, repointed.
--
-- Outside the transaction above and patched rather than restated, for
-- the reason migration 104 gives: `crm_set_health` is long, a function is
-- replaced whole, and migration 091 carries a note about restating one
-- from memory and losing its role validation. The definition is read
-- back out of the database, one call is replaced, and the result is
-- executed.
-- -------------------------------------------------------------
DO $repoint$
DECLARE
  fn  OID;
  def TEXT;
  old CONSTANT TEXT := 'FOR manager IN SELECT user_id FROM crm_account_managers(p_contact) LOOP';
  new_ CONSTANT TEXT := 'FOR manager IN SELECT user_id FROM crm_red_flag_audience(p_contact) LOOP';
BEGIN
  SELECT p.oid INTO fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'crm_set_health'
   LIMIT 1;

  IF fn IS NULL THEN
    RAISE EXCEPTION '105 did not land: crm_set_health is not there, so migration 099 has not run';
  END IF;

  def := pg_get_functiondef(fn);

  IF position(new_ IN def) > 0 THEN
    RAISE NOTICE 'red flags already reach the sales leads';
  ELSIF position(old IN def) = 0 THEN
    /* Neither. Something has changed the loop and replacing it would be
       a guess, so it says so rather than doing nothing quietly. */
    RAISE EXCEPTION '105 did not land: crm_set_health does not loop over crm_account_managers as expected';
  ELSE
    EXECUTE replace(def, old, new_);
    RAISE NOTICE 'red flags now reach the owner, Sr Sales and BD';
  END IF;
END $repoint$;

-- -------------------------------------------------------------
-- 8. Did it land.
-- -------------------------------------------------------------
DO $check$
DECLARE
  shapeless TEXT;
  n         INTEGER;
BEGIN
  SELECT string_agg(slug, ', ' ORDER BY slug) INTO shapeless
    FROM role_templates WHERE is_active AND department IS NULL;
  IF shapeless IS NOT NULL THEN
    RAISE EXCEPTION '105 did not land: these roles are in no department: %', shapeless;
  END IF;

  SELECT count(*) INTO n FROM role_templates
   WHERE is_active AND 'sales' = ANY(manages) AND NOT ('exec' = ANY(manages));
  IF n <> 2 THEN
    RAISE EXCEPTION '105 did not land: % role(s) hear about a red account, expected Sr Sales and BD', n;
  END IF;

  IF to_regclass('public.capability_requests') IS NULL THEN
    RAISE EXCEPTION '105 did not land: there is nowhere to put a request';
  END IF;

  FOR n IN SELECT 1 WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('escalation_for', 'may_manage_user',
                         'request_capability', 'decide_capability_request')
     GROUP BY 1 HAVING count(*) = 4)
  LOOP
    RAISE EXCEPTION '105 did not land: one of the four functions is missing';
  END LOOP;

  RAISE NOTICE 'asking and being in charge: the roles have a shape, and a refusal has somewhere to go';
END $check$;

NOTIFY pgrst, 'reload schema';
