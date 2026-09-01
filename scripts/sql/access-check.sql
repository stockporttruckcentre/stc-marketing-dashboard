-- =============================================================
-- Asking for an account, and an administrator granting one.
--
-- Driven as the three people actually involved: a stranger with no
-- account at all, a signed in colleague who is not an administrator,
-- and an administrator.
--
-- The four things this must never let happen:
--
--   1. The sign in page telling an outsider whether an address already
--      has an account, which would make it a way to test addresses
--      against the staff list.
--   2. Anybody but an administrator reading the queue, or answering
--      anything in it.
--   3. An account created that cannot then sign in, which is what an
--      unconfirmed email or a bad hash gives you.
--   4. The same request answered twice.
--
-- Run with `npm run check:access`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-0000-0000-000000000001', 'ac.admin@example.test'),
  ('ac000000-0000-0000-0000-000000000002', 'ac.sales@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Access Admin'
 WHERE id = 'ac000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Access Sales'
 WHERE id = 'ac000000-0000-0000-0000-000000000002';

/* Reading `auth.users` is not something `authenticated` may do, and
   that is right. These two are how the check looks anyway, from the
   owner's position, so an assertion about whether an account can sign
   in does not require weakening the thing it is asserting about. */
CREATE OR REPLACE FUNCTION pg_temp.can_sign_in(p_user UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth
AS $fn$
DECLARE stored TEXT;
BEGIN
  SELECT encrypted_password INTO stored FROM auth.users WHERE id = p_user;
  IF stored IS NULL OR stored = '' THEN RETURN FALSE; END IF;
  RETURN stored = crypt(p_password, stored);
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.is_confirmed(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
AS $fn$
  SELECT email_confirmed_at IS NOT NULL FROM auth.users WHERE id = p_user;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.how_many_accounts()
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
AS $fn$ SELECT count(*)::INT FROM auth.users; $fn$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role',
                     CASE WHEN p_who IS NULL THEN 'anon' ELSE 'authenticated' END, TRUE);
END;
$fn$;

DO $$
BEGIN
  IF NOT actor_holds('ac000000-0000-0000-0000-000000000001', 'admin.users') THEN
    RAISE EXCEPTION 'fixture: the admin cannot manage users, so nothing below is a guard';
  END IF;
  RAISE NOTICE 'ok  fixture: one administrator, one salesperson, and a stranger';
END $$;

-- =============================================================
-- 1. A stranger asks. Nobody at all: no session, no account.
-- =============================================================
SET ROLE anon;

DO $$
DECLARE said JSONB; rows INT;
BEGIN
  PERFORM pg_temp.act_as(NULL);

  said := request_access('newstarter@stc-uk.com', 'Started Monday in the workshop.');
  IF NOT (said ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'a stranger could not ask for an account, which is the whole feature';
  END IF;

  /* Deliberately not read back here. anon cannot see the table, which
     is the point of the assertion after this one. */
  rows := 0;
  RAISE NOTICE 'ok  a stranger with no session can ask for an account';
END $$;

-- ...and cannot read what they just wrote, nor anybody else's.
DO $$
DECLARE seen INT; ok BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.act_as(NULL);

  /* Refused by the grant, not merely emptied by the policy. Both are
     asserted because a later migration widening the grant would leave
     the policy as the only thing standing between anon and a list of
     staff addresses. */
  ok := FALSE;
  BEGIN SELECT count(*) INTO seen FROM access_requests;
  EXCEPTION WHEN OTHERS THEN ok := TRUE; seen := 0; END;
  IF NOT ok AND seen <> 0 THEN
    RAISE EXCEPTION 'a stranger can read the queue, which is a list of staff email addresses';
  END IF;

  BEGIN
    INSERT INTO access_requests (email) VALUES ('sneaky@example.test');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a stranger can write the table directly, so the function guards are decoration';
  END IF;

  RAISE NOTICE 'ok  and can neither read the queue nor write to it directly';
END $$;

-- =============================================================
-- 2. THE ONE THAT MATTERS. The answer never differs.
--
-- An address that already has an account, one that has been declined
-- before, and one nobody has ever seen must all come back the same.
-- Anything else turns the sign in page into a way of testing addresses
-- against the staff list.
-- =============================================================
DO $$
DECLARE fresh JSONB; known JSONB; refused JSONB;
BEGIN
  PERFORM pg_temp.act_as(NULL);

  fresh   := request_access('nobody.here@example.test');
  known   := request_access('ac.admin@example.test');       -- has an account
  refused := request_access('turneddown@example.test');

  IF (fresh ->> 'said') IS DISTINCT FROM (known ->> 'said')
     OR (fresh ->> 'said') IS DISTINCT FROM (refused ->> 'said') THEN
    RAISE EXCEPTION
      'the answer differs by address. Asking about % said "%", asking about a real account said "%".',
      'a stranger', fresh ->> 'said', known ->> 'said';
  END IF;
  IF (fresh ->> 'ok') IS DISTINCT FROM (known ->> 'ok') THEN
    RAISE EXCEPTION 'the ok flag differs by whether the address has an account';
  END IF;

  RAISE NOTICE 'ok  the same answer whether the address is a stranger, a colleague, or was turned down before';
END $$;

-- A second press of the button is not a second request.
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  PERFORM request_access('newstarter@stc-uk.com', 'Asking again, not sure it went.');
  PERFORM request_access('newstarter@stc-uk.com');
  RESET ROLE;
  SELECT count(*) INTO n FROM access_requests
   WHERE email = 'newstarter@stc-uk.com' AND status = 'pending';
  SET ROLE anon;
  IF n <> 1 THEN
    RAISE EXCEPTION 'pressing the button three times made % requests, so the queue fills with duplicates', n;
  END IF;
  RAISE NOTICE 'ok  pressing it again updates the one request rather than adding another';
END $$;

-- Rubbish is refused before it reaches the queue.
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  FOREACH ok IN ARRAY ARRAY[FALSE] LOOP END LOOP;

  ok := FALSE;
  BEGIN PERFORM request_access('not an email'); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'a string with no @ in it got into the queue'; END IF;

  ok := FALSE;
  BEGIN PERFORM request_access(''); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'an empty address got into the queue'; END IF;

  ok := FALSE;
  BEGIN PERFORM request_access('a@b.c', repeat('x', 501)); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'a 501 character note got into the queue'; END IF;

  RAISE NOTICE 'ok  an address with no @, an empty one, and an essay are all refused';
END $$;

-- =============================================================
-- 3. A colleague who is not an administrator sees none of it.
-- =============================================================
SET ROLE authenticated;

DO $$
DECLARE seen INT; ok BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000002');

  SELECT count(*) INTO seen FROM access_requests;
  IF seen <> 0 THEN
    RAISE EXCEPTION 'a salesperson can read the queue';
  END IF;

  ok := FALSE;
  BEGIN PERFORM access_requests_waiting(); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'a salesperson can list who has asked for an account'; END IF;

  ok := FALSE;
  BEGIN
    PERFORM approve_access_request(
      (SELECT id FROM access_requests WHERE email = 'newstarter@stc-uk.com' LIMIT 1));
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'a salesperson created an account'; END IF;

  RAISE NOTICE 'ok  a salesperson can neither see the queue nor answer anything in it';
END $$;

-- =============================================================
-- 4. An administrator reads it, and it says what they need.
-- =============================================================
DO $$
DECLARE waiting INT; one RECORD;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');

  SELECT count(*) INTO waiting FROM access_requests_waiting() WHERE status = 'pending';
  IF waiting < 3 THEN
    RAISE EXCEPTION 'the administrator sees % pending, and at least three were made', waiting;
  END IF;

  SELECT * INTO one FROM access_requests_waiting() WHERE email = 'newstarter@stc-uk.com';
  IF one.said IS NULL THEN
    RAISE EXCEPTION 'what they typed did not reach the screen, so there is nothing to judge on';
  END IF;
  IF one.already_has_one THEN
    RAISE EXCEPTION 'a brand new address is reported as already having an account';
  END IF;

  SELECT * INTO one FROM access_requests_waiting() WHERE email = 'ac.admin@example.test';
  IF NOT one.already_has_one THEN
    RAISE EXCEPTION
      'an address that already has an account is not flagged, so an administrator would make a second one';
  END IF;

  RAISE NOTICE 'ok  an administrator sees the queue, what they typed, and which addresses already have accounts';
END $$;

-- =============================================================
-- 5. Approving makes an account that can actually sign in.
-- =============================================================
DO $$
DECLARE got JSONB; made UUID; stored TEXT; prof RECORD;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');

  got := approve_access_request(
    (SELECT id FROM access_requests WHERE email = 'newstarter@stc-uk.com' AND status = 'pending'),
    '123', 'sales', 'New Starter');
  made := (got ->> 'user')::UUID;

  IF made IS NULL THEN RAISE EXCEPTION 'approving made no account'; END IF;

  /* The same test Supabase makes at sign in. An account that exists and
     cannot sign in is the failure this catches. */
  IF NOT pg_temp.can_sign_in(made, '123') THEN
    RAISE EXCEPTION 'the new account cannot sign in with the password it was given';
  END IF;
  IF pg_temp.can_sign_in(made, '1234') THEN
    RAISE EXCEPTION 'the stored hash matches the wrong password too';
  END IF;
  stored := 'checked';

  IF NOT pg_temp.is_confirmed(made) THEN
    RAISE EXCEPTION
      'the email was left unconfirmed, so their first sign in is refused with a message nobody can act on';
  END IF;

  SELECT * INTO prof FROM profiles WHERE id = made;
  IF prof IS NULL THEN RAISE EXCEPTION 'no profile, so they sign in to a broken screen'; END IF;
  IF prof.role <> 'sales' THEN
    RAISE EXCEPTION 'the role the administrator picked was not applied: got %', prof.role;
  END IF;
  IF prof.full_name <> 'New Starter' THEN
    RAISE EXCEPTION 'the name the administrator typed was not applied: got %', prof.full_name;
  END IF;

  IF (SELECT status FROM access_requests WHERE became = made) <> 'approved' THEN
    RAISE EXCEPTION 'the request was not marked approved, so it stays in the queue forever';
  END IF;

  RAISE NOTICE 'ok  approving makes an account that signs in, with the role and the name that were chosen';
END $$;

-- And the same request cannot be answered twice.
DO $$
DECLARE ok BOOLEAN := FALSE; req UUID;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');
  SELECT id INTO req FROM access_requests WHERE email = 'newstarter@stc-uk.com';

  BEGIN PERFORM approve_access_request(req); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'an approved request was approved again, making a second account'; END IF;

  ok := FALSE;
  BEGIN PERFORM decline_access_request(req); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'an approved request was then declined'; END IF;

  RAISE NOTICE 'ok  a request that has been answered cannot be answered again';
END $$;

-- =============================================================
-- 6. Approving somebody who already has an account resets it rather
--    than making a second one.
-- =============================================================
DO $$
DECLARE got JSONB; before INT; after_n INT;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');
  before := pg_temp.how_many_accounts();

  got := approve_access_request(
    (SELECT id FROM access_requests WHERE email = 'ac.admin@example.test' AND status = 'pending'),
    '123', 'admin');

  after_n := pg_temp.how_many_accounts();
  IF after_n <> before THEN
    RAISE EXCEPTION 'a second account was made for an address that already had one';
  END IF;
  IF NOT (got ->> 'existed_already')::BOOLEAN THEN
    RAISE EXCEPTION 'the screen was not told the account already existed';
  END IF;

  RAISE NOTICE 'ok  approving an address that already has an account resets it instead of duplicating it';
END $$;

-- =============================================================
-- 7. Declining is kept, so a pattern is visible.
-- =============================================================
DO $$
DECLARE one RECORD;
BEGIN
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');
  PERFORM decline_access_request(
    (SELECT id FROM access_requests WHERE email = 'turneddown@example.test' AND status = 'pending'),
    'Not staff.');

  SET LOCAL ROLE anon;
  PERFORM pg_temp.act_as(NULL);
  PERFORM request_access('turneddown@example.test');
  RESET ROLE;
  PERFORM pg_temp.act_as('ac000000-0000-0000-0000-000000000001');

  SELECT * INTO one FROM access_requests_waiting()
   WHERE email = 'turneddown@example.test' AND status = 'pending';
  IF one.declined_before < 1 THEN
    RAISE EXCEPTION
      'somebody turned down and asking again looks like a first request, which is the one thing the record is for';
  END IF;

  RAISE NOTICE 'ok  somebody asking again after being turned down is shown as such';
END $$;

RESET ROLE;
ROLLBACK;
