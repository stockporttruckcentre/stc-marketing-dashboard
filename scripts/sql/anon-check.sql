-- =============================================================
-- What an anonymous visitor can read, which has to be nothing.
--
-- ---- Why this is its own check ----
--
-- Supabase grants SELECT on the whole public schema to `anon` by
-- default. The disposable database this runs against does not, so every
-- policy here looks watertight whether or not it is, and a check that
-- passes for the wrong reason is worse than no check.
--
-- So this grants `anon` what Supabase grants it, seeds a row into every
-- table it is worth seeding, and then reads as `anon`. Anything that
-- comes back is readable by anybody holding the public key, which sits
-- in the browser bundle of every page.
--
-- ---- Why it exists at all ----
--
-- Migration 062 gave `anon` two functions to call, so the anonymous
-- role stopped being theoretical. The readback handed over with it
-- found two tables it could read: `calendar_events`, whose team branch
-- had never asked who was asking, and `calendar_guests`, whose policy
-- I wrote that way myself. Migration 064 closed both.
--
-- This is what stops a third one appearing.
--
-- Run with `npm run check:anon`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- Somebody to own a meeting, and a meeting of each visibility, so
-- every branch of the policy has something to let through or not.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'anon.check@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin', role_template_id = NULL
  WHERE id = 'aa000000-0000-0000-0000-000000000001';

INSERT INTO crm_contacts (id, company_name)
VALUES ('aa000000-0000-0000-0000-0000000000c1', 'Anon Check Haulage')
ON CONFLICT DO NOTHING;

INSERT INTO calendar_events (id, title, start_at, end_at, created_by, visibility)
VALUES
  ('aa000000-0000-0000-0000-0000000000e1', 'A team meeting',
   NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour',
   'aa000000-0000-0000-0000-000000000001', 'team'),
  ('aa000000-0000-0000-0000-0000000000e2', 'A private meeting',
   NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 1 hour',
   'aa000000-0000-0000-0000-000000000001', 'private')
ON CONFLICT DO NOTHING;

INSERT INTO calendar_guests (event_id, email, name, invited_by, token)
VALUES ('aa000000-0000-0000-0000-0000000000e1', 'guest@outside.test', 'A Guest',
        'aa000000-0000-0000-0000-000000000001', repeat('f', 64))
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM calendar_events WHERE id::TEXT LIKE 'aa000000-%') <> 2 THEN
    RAISE EXCEPTION 'fixture: the meetings are not there, so this check tests nothing';
  END IF;
  IF (SELECT count(*) FROM calendar_guests WHERE token = repeat('f', 64)) <> 1 THEN
    RAISE EXCEPTION 'fixture: the guest is not there, so this check tests nothing';
  END IF;
END $$;

-- -------------------------------------------------------------
-- Grant `anon` what Supabase grants it, which is the whole point.
--
-- Without this the check passes on a database that has never granted
-- `anon` anything, which is not the database this is protecting.
-- Migration 064's own revokes run after it, so what is left is exactly
-- what the live project has.
-- -------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
/* And EXECUTE, which Supabase also grants by default and which this
   check cannot do without. Several policies on these tables call
   `command_may`, and without EXECUTE the read fails on the function
   before row level security has decided anything. That failure looks
   exactly like a refusal, so the check passed while the hole it was
   written for was wide open. */
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

-- Then the revokes 064 makes, applied again on top, because that is the
-- order a live project ends up in: the default grant, then the
-- migration.
REVOKE ALL ON calendar_guests FROM anon;
REVOKE ALL ON calendar_invite_messages FROM anon;
REVOKE ALL ON calendar_invites FROM anon;
REVOKE ALL ON calendar_events FROM anon;
REVOKE ALL ON entities FROM anon;
REVOKE ALL ON tenant_settings FROM anon;

SET LOCAL ROLE anon;

-- -------------------------------------------------------------
-- Read everything, as somebody with no session.
-- -------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
  n BIGINT;
  leaked TEXT[] := '{}';
  odd    TEXT[] := '{}';
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    /* Three answers, not two.

       Rows back is an exposure. Refused on privilege is the strongest
       possible pass. Anything else is neither, and swallowing it as a
       pass is what made the first version of this check unable to fail:
       a missing EXECUTE on a policy's function raised an error, the
       error was counted as zero rows, and the check reported safe. */
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO n;
      IF n > 0 THEN
        leaked := leaked || (t.relname || ' (' || n || ' rows)');
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
      WHEN OTHERS THEN
        odd := odd || (t.relname || ' (' || SQLERRM || ')');
    END;
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION
      'an anonymous visitor can read: %. Anybody holding the public key can read it too.',
      array_to_string(leaked, ', ');
  END IF;
  IF array_length(odd, 1) > 0 THEN
    RAISE EXCEPTION
      'these did not refuse and did not answer, so this check cannot say they are safe: %',
      array_to_string(odd, ', ');
  END IF;
  RAISE NOTICE 'ok  an anonymous visitor can read nothing in the public schema';
END $$;

-- -------------------------------------------------------------
-- The two that were open, asked directly, so a failure names the thing
-- rather than making somebody read a list.
-- -------------------------------------------------------------
DO $$
DECLARE n BIGINT;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM calendar_events;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  IF n > 0 THEN
    RAISE EXCEPTION 'a team meeting is readable with no session: the team branch is open again';
  END IF;
  RAISE NOTICE 'ok  and a team meeting is not readable without a session';

  BEGIN
    SELECT count(*) INTO n FROM calendar_guests;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  IF n > 0 THEN
    RAISE EXCEPTION 'the guest list is readable with no session, tokens and all';
  END IF;
  RAISE NOTICE 'ok  and the guest list, which is where the invitation links are, is not';
END $$;

/* The branding a sign in card needs is still reachable, through a
   function that names its columns. Locking the table and leaving no way
   to read the company name would be trading one problem for another. */
DO $$
DECLARE said JSONB;
BEGIN
  said := tenant_branding();
  IF said IS NULL OR COALESCE(said ->> 'companyName', '') = '' THEN
    RAISE EXCEPTION 'a sign in page can no longer read the company name';
  END IF;
  IF said ? 'supportEmail' OR said ? 'userAgent' THEN
    RAISE EXCEPTION 'the branding function returns more than a sign in card needs';
  END IF;
  RAISE NOTICE 'ok  and the sign in branding is still readable, by name, through a function';
END $$;

-- -------------------------------------------------------------
-- And the two functions `anon` is meant to have still work, because a
-- revoke that also broke the feature would be a different kind of
-- wrong.
-- -------------------------------------------------------------
DO $$
DECLARE said JSONB;
BEGIN
  said := calendar_guest_view(repeat('f', 64));
  IF NOT (said ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'a guest can no longer open their own invitation: %', said ->> 'why';
  END IF;
  IF said -> 'meeting' ->> 'title' <> 'A team meeting' THEN
    RAISE EXCEPTION 'the invitation shows the wrong meeting';
  END IF;
  RAISE NOTICE 'ok  and a guest can still open their own invitation, through the function';
END $$;

RESET ROLE;
ROLLBACK;
