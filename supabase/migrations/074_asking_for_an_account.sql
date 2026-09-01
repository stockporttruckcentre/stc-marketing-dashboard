-- =============================================================
-- 074. Asking for an account, and an administrator granting one.
--
-- From the business:
--
--   the sign up button you put on there, make it a request access
--   button where they type their email address. Then I should see this
--   come through to the admin centre where I can approve and create the
--   account and it'll email them their login details
--
-- ---- Why this replaces sign up ----
--
-- Anybody could sign up, and the account they got was a `viewer` with
-- nothing on it until an administrator noticed and promoted them. So
-- the old flow already needed a person in the loop; it just put them
-- after the account existed rather than before it. Asking first is the
-- same number of steps with one fewer stranger holding an account.
--
-- ---- The one thing this table must never do ----
--
-- Tell an outsider whether an address already has an account. It is
-- reachable by anybody with the URL, so a request that answered "that
-- email is already registered" would be a way to test addresses against
-- the staff list from the sign in page. Every request is accepted with
-- the same answer, and an administrator sees the duplicate rather than
-- the person asking.
--
-- ---- What it deliberately does not do ----
--
-- Send the email. This application has no outbound transport, which its
-- own capability registry says at `rows.email`: "an outbound email
-- transport, which this application does not have". Approving therefore
-- makes the account and hands the administrator a message ready to
-- send, the same way FleetSmart's send works today. Wiring a provider
-- is a separate decision, and pretending to send in the meantime is
-- worse than not sending.
-- =============================================================

CREATE TABLE IF NOT EXISTS access_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  /* Who they say they are and why they want in. Optional, because a
     required field on a form nobody is signed in for is a field people
     put "asdf" in. */
  said         TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  /* Said to the administrator, never to the person who asked. */
  decided_note TEXT,
  /* The account it turned into, so a second request from the same
     person can be seen for what it is. */
  became       UUID REFERENCES auth.users ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_access_requests_pending
  ON access_requests (requested_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests (lower(email));

ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

/* Nobody reads this table except somebody who may manage users, and
   nobody writes it except through the two functions below. The
   anonymous request goes through a SECURITY DEFINER function rather
   than an INSERT policy, so the shape of what can be written is a
   signature rather than a policy somebody widens later. */
DROP POLICY IF EXISTS "access_requests_read" ON access_requests;
CREATE POLICY "access_requests_read" ON access_requests
  FOR SELECT USING (command_may('admin.users'));

REVOKE INSERT, UPDATE, DELETE ON access_requests FROM anon, authenticated;
/* And `anon` never reads it at all, rather than being stopped by the
   policy alone. The policy is the rule; this is the grant, and a table
   holding staff email addresses should fail both ways for somebody who
   is not signed in. `authenticated` keeps SELECT because the policy
   above is what decides between a colleague and an administrator. */
REVOKE SELECT ON access_requests FROM anon;

-- -------------------------------------------------------------
-- 1. Asking.
--
-- Callable by anybody, including nobody at all, because the person
-- asking has no account by definition.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_access(p_email TEXT, p_said TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  clean TEXT;
  /* Not `said`. That is the column's name too, and inside the UPDATE
     below Postgres cannot tell which one is meant: it raises "column
     reference said is ambiguous" and the request is lost. */
  why   TEXT;
BEGIN
  clean := lower(btrim(COALESCE(p_email, '')));
  why   := NULLIF(btrim(COALESCE(p_said, '')), '');

  /* Deliberately loose. A stricter pattern rejects real addresses, and
     the only thing riding on this is whether an administrator can read
     it: nothing is created from the string and nothing is sent to it
     without somebody looking first. */
  IF clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address.';
  END IF;
  IF length(clean) > 254 THEN
    RAISE EXCEPTION 'That address is too long.';
  END IF;
  IF length(COALESCE(why, '')) > 500 THEN
    RAISE EXCEPTION 'Please keep it under 500 characters.';
  END IF;

  /* One open request per address. A second press of the button is
     somebody being unsure it worked, not a second person, and a queue
     with the same address in it eleven times is a queue nobody reads.
     The note is kept up to date, because the second attempt is usually
     where they explain themselves properly. */
  IF EXISTS (SELECT 1 FROM access_requests
              WHERE lower(email) = clean AND status = 'pending') THEN
    UPDATE access_requests
       SET said = COALESCE(why, access_requests.said),
           requested_at = NOW()
     WHERE lower(access_requests.email) = clean AND access_requests.status = 'pending';
  ELSE
    INSERT INTO access_requests (email, said) VALUES (clean, why);
  END IF;

  /* THE SAME ANSWER EVERY TIME.

     Not "you already have an account", not "that was already
     requested", not "an administrator will be in touch shortly if you
     are staff". Any of those turns the sign in page into a way of
     testing addresses against the staff list. */
  RETURN jsonb_build_object(
    'ok', TRUE,
    'said', 'Thanks. Somebody will be in touch once it has been looked at.'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION request_access(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_access(TEXT, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------
-- 2. The queue, as the Admin screen reads it.
--
-- Carries what an administrator needs to decide without opening
-- anything else: whether that address already has an account, and
-- whether this person has asked before and been turned down.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION access_requests_waiting()
RETURNS TABLE (
  id             UUID,
  email          TEXT,
  said           TEXT,
  requested_at   TIMESTAMPTZ,
  status         TEXT,
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decided_note   TEXT,
  /* True where an account with that address already exists. The reason
     the person asking is never told. */
  already_has_one BOOLEAN,
  /* How many times they have asked and been declined before. */
  declined_before INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Reading who has asked for an account is an administrator''s job.';
  END IF;

  RETURN QUERY
  SELECT r.id, r.email, r.said, r.requested_at, r.status,
         COALESCE(p.full_name, p.email),
         r.decided_at, r.decided_note,
         EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(r.email)),
         (SELECT count(*)::INT FROM access_requests o
           WHERE lower(o.email) = lower(r.email) AND o.status = 'declined')
    FROM access_requests r
    LEFT JOIN profiles p ON p.id = r.decided_by
   ORDER BY (r.status = 'pending') DESC, r.requested_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION access_requests_waiting() TO authenticated;

-- -------------------------------------------------------------
-- 3. Approving: make the account.
--
-- The password is written here as a bcrypt hash, the same way the auth
-- API writes it, because there is no admin API call available from
-- inside the database. `crypt(candidate, stored)` is what Supabase does
-- to verify, so a hash written here is indistinguishable from one it
-- wrote itself.
--
-- The default password is an argument rather than a constant, so the
-- day somebody wants it to stop being 123 is a change at the call site
-- rather than a migration.
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

REVOKE ALL ON FUNCTION approve_access_request(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_access_request(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. Declining. Kept rather than deleted, so a third request from the
--    same address reads as a pattern rather than as a first ask.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION decline_access_request(p_request UUID, p_why TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE req access_requests;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Answering a request for access is an administrator''s job.';
  END IF;

  SELECT * INTO req FROM access_requests WHERE id = p_request;
  IF req IS NULL THEN RAISE EXCEPTION 'There is no request with that id.'; END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request was already %.', req.status;
  END IF;

  UPDATE access_requests
     SET status = 'declined', decided_by = current_actor(), decided_at = NOW(),
         decided_note = NULLIF(btrim(COALESCE(p_why, '')), '')
   WHERE id = p_request;

  PERFORM audit('reject', 'access_requests', p_request, req.email,
                jsonb_build_object('why', p_why));

  RETURN jsonb_build_object('ok', TRUE, 'email', req.email);
END;
$fn$;

REVOKE ALL ON FUNCTION decline_access_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_access_request(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 5. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'request_access') THEN
    RAISE EXCEPTION 'nobody can ask for an account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'approve_access_request') THEN
    RAISE EXCEPTION 'nobody can grant one';
  END IF;
  RAISE NOTICE 'ok  access can be asked for by anybody and granted only by an administrator';
END $$;
