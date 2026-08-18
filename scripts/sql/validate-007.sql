-- =============================================================
-- Migrations 007 and 008, against real PostgreSQL.
--
-- Everything before this ran against a fake that behaves the way I
-- expected PostgREST to behave. That proves the executor sends the
-- right call; it proves nothing at all about whether the SQL works.
-- These assertions are the other half: real column types, real
-- constraints, real row level security, real transaction boundaries.
--
-- Each case reports one line. `FAIL` anywhere means the run failed.
--
--   psql -f scripts/sql/validate-007.sql
-- =============================================================
\set ON_ERROR_STOP off
\pset pager off
\pset tuples_only on

/**
 * A spare administrator, so the harness can demote its own user.
 *
 * Migration 019 refuses to let the last administrator stop being one,
 * which is the point of it. Every section that needs the harness to
 * BE something else calls this first.
 */
CREATE OR REPLACE FUNCTION keep_an_admin() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES ('dddddddd-0000-0000-0000-00000000000d', 'spare@test.local')
  ON CONFLICT DO NOTHING;
  UPDATE profiles SET role = 'admin' WHERE id = 'dddddddd-0000-0000-0000-00000000000d';
END
$$;

CREATE OR REPLACE FUNCTION assert(what TEXT, cond BOOLEAN, got TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN
    RAISE NOTICE 'ok    %', what;
  ELSE
    RAISE WARNING 'FAIL  %  %', what, COALESCE(got, '');
  END IF;
END
$$;

-- Fixtures, owned by nobody in particular. Ids are fixed so a failure
-- names a row somebody can look at.
CREATE OR REPLACE FUNCTION reset_fixtures() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM crm_contacts WHERE company_name LIKE 'TEST %';
  DELETE FROM stock_trailers WHERE stc_no LIKE 'TESTSTC%';
  DELETE FROM social_posts WHERE content LIKE 'TEST %';

  INSERT INTO stock_trailers (id, stc_no, status, location, category, retail_price, nbv, mot_date, notes)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'TESTSTC1', 'in_stock', 'Hyde', 'curtainsider', 20000, 15000, '2027-03-14', 'first note'),
    ('22222222-2222-2222-2222-222222222222', 'TESTSTC2', 'in_stock', 'Hyde', 'curtainsider', 24000, 18000, '2027-06-01', NULL),
    ('33333333-3333-3333-3333-333333333333', 'TESTSTC3', 'in_stock', 'Hyde', 'fridge',       30000, 22000, '2026-12-01', NULL);

  INSERT INTO social_posts (id, content, platform, scheduled_date, status, created_by, hashtags)
  VALUES ('44444444-4444-4444-4444-444444444444', 'TEST post', ARRAY['linkedin'], '2026-09-01', 'draft', 'tester', ARRAY['#a']);
END
$$;

SELECT reset_fixtures();

-- =============================================================
-- 1. Types: every writable kind survives the round trip
-- =============================================================
\echo '--- types ---'

SELECT command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"retail_price":24995}}]'::JSONB);
SELECT assert('a money column takes a number',
  (SELECT retail_price FROM stock_trailers WHERE stc_no='TESTSTC1') = 24995,
  (SELECT retail_price::TEXT FROM stock_trailers WHERE stc_no='TESTSTC1'));

SELECT command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"mot_date":"2028-01-31"}}]'::JSONB);
SELECT assert('a date column takes an ISO date',
  (SELECT mot_date FROM stock_trailers WHERE stc_no='TESTSTC1') = DATE '2028-01-31',
  (SELECT mot_date::TEXT FROM stock_trailers WHERE stc_no='TESTSTC1'));

SELECT command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"status":"rental"}}]'::JSONB);
SELECT assert('an enum column takes a checked value',
  (SELECT status FROM stock_trailers WHERE stc_no='TESTSTC1') = 'rental',
  (SELECT status FROM stock_trailers WHERE stc_no='TESTSTC1'));

SELECT command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"notes":null}}]'::JSONB);
SELECT assert('a nullable column takes null',
  (SELECT notes FROM stock_trailers WHERE stc_no='TESTSTC1') IS NULL,
  (SELECT notes FROM stock_trailers WHERE stc_no='TESTSTC1'));

-- The case I flagged as unverified: TEXT[] through jsonb_populate_record.
SELECT command_apply('[{"table":"social_posts","id":"44444444-4444-4444-4444-444444444444","set":{"platform":["linkedin","facebook"]}}]'::JSONB);
SELECT assert('an array column takes an array',
  (SELECT platform FROM social_posts WHERE content='TEST post') = ARRAY['linkedin','facebook'],
  (SELECT platform::TEXT FROM social_posts WHERE content='TEST post'));

SELECT command_apply('[{"table":"social_posts","id":"44444444-4444-4444-4444-444444444444","set":{"hashtags":[]}}]'::JSONB);
SELECT assert('and an empty array',
  (SELECT hashtags FROM social_posts WHERE content='TEST post') = ARRAY[]::TEXT[],
  (SELECT hashtags::TEXT FROM social_posts WHERE content='TEST post'));

SELECT command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"retail_price":24995,"location":"Bredbury"}}]'::JSONB);
SELECT assert('several columns in one change',
  (SELECT location FROM stock_trailers WHERE stc_no='TESTSTC1') = 'Bredbury');

-- =============================================================
-- 2. A constraint is still a constraint
-- =============================================================
\echo '--- constraints ---'

DO $$
BEGIN
  PERFORM command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"status":null}}]'::JSONB);
  PERFORM assert('emptying a NOT NULL column is refused by the database', FALSE, 'it was allowed');
EXCEPTION WHEN not_null_violation THEN
  PERFORM assert('emptying a NOT NULL column is refused by the database', TRUE);
END
$$;

DO $$
BEGIN
  PERFORM command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"status":"nonsense"}}]'::JSONB);
  PERFORM assert('a value outside the CHECK is refused', FALSE, 'it was allowed');
EXCEPTION WHEN check_violation THEN
  PERFORM assert('a value outside the CHECK is refused', TRUE);
END
$$;

-- =============================================================
-- 3. The allowlist
-- =============================================================
\echo '--- allowlist ---'

DO $$
BEGIN
  PERFORM command_apply('[{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"profit":999}}]'::JSONB);
  PERFORM assert('a column outside the allowlist is refused', FALSE, 'it was allowed');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a column outside the allowlist is refused', SQLERRM LIKE '%may not write%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_apply('[{"table":"profiles","id":"11111111-1111-1111-1111-111111111111","set":{"role":"admin"}}]'::JSONB);
  PERFORM assert('a table outside the allowlist is refused', FALSE, 'it was allowed');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a table outside the allowlist is refused', SQLERRM LIKE '%may not write%', SQLERRM);
END
$$;

-- =============================================================
-- 4. Exact row atomicity
-- =============================================================
\echo '--- atomicity ---'

SELECT reset_fixtures();

-- Three changes, the middle one naming a row that is not there.
DO $$
DECLARE
  before_1 NUMERIC;
  before_3 NUMERIC;
BEGIN
  SELECT retail_price INTO before_1 FROM stock_trailers WHERE stc_no='TESTSTC1';
  SELECT retail_price INTO before_3 FROM stock_trailers WHERE stc_no='TESTSTC3';

  BEGIN
    PERFORM command_apply(('[' ||
      '{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"retail_price":1}},' ||
      '{"table":"stock_trailers","id":"99999999-9999-9999-9999-999999999999","set":{"retail_price":2}},' ||
      '{"table":"stock_trailers","id":"33333333-3333-3333-3333-333333333333","set":{"retail_price":3}}' ||
      ']')::JSONB);
    PERFORM assert('a missing row fails the call', FALSE, 'it succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM assert('a missing row fails the call', SQLERRM LIKE '%exactly one row%', SQLERRM);
  END;

  PERFORM assert('and the change before it did not commit',
    (SELECT retail_price FROM stock_trailers WHERE stc_no='TESTSTC1') = before_1,
    (SELECT retail_price::TEXT FROM stock_trailers WHERE stc_no='TESTSTC1'));
  PERFORM assert('nor did the change after it',
    (SELECT retail_price FROM stock_trailers WHERE stc_no='TESTSTC3') = before_3,
    (SELECT retail_price::TEXT FROM stock_trailers WHERE stc_no='TESTSTC3'));
END
$$;

-- The same three changes with every row present must all land.
DO $$
DECLARE changed INTEGER;
BEGIN
  SELECT command_apply(('[' ||
    '{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"retail_price":111}},' ||
    '{"table":"stock_trailers","id":"22222222-2222-2222-2222-222222222222","set":{"retail_price":222}},' ||
    '{"table":"stock_trailers","id":"33333333-3333-3333-3333-333333333333","set":{"retail_price":333}}' ||
    ']')::JSONB) INTO changed;
  PERFORM assert('three good changes all commit', changed = 3, changed::TEXT);
  PERFORM assert('and every row holds its new value',
    (SELECT COUNT(*) FROM stock_trailers WHERE retail_price IN (111,222,333) AND stc_no LIKE 'TESTSTC%') = 3);
END
$$;

-- =============================================================
-- 5. Row level security, as a real caller sees it
-- =============================================================
\echo '--- row level security ---'

SELECT reset_fixtures();

-- `crm_select` restricts contacts to rows on a global list, a list you
-- own, or one shared with you. A contact on somebody else's private
-- list is invisible, and an update against it affects nothing.
-- With an email, because the project's `handle_new_user` trigger
-- copies it into `profiles`, and a null there fails the insert inside
-- the trigger. Without it these two people never existed, the list and
-- the contact below silently failed their foreign keys, and every RLS
-- assertion passed because the row was not there rather than because
-- it was hidden.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.local')
ON CONFLICT DO NOTHING;

INSERT INTO crm_lists (id, name, owner_id, is_global)
VALUES ('cccccccc-0000-0000-0000-000000000003', 'TEST private list', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_contacts (id, company_name, list_id, status, source)
VALUES ('dddddddd-0000-0000-0000-000000000004', 'TEST hidden co', 'cccccccc-0000-0000-0000-000000000003', 'lead', 'manual')
ON CONFLICT (id) DO NOTHING;

-- Become B, who is not on that list.
--
-- Session scoped, not `SET LOCAL`. psql runs each statement in its own
-- transaction, so a transaction local setting is gone by the next line
-- and `auth.uid()` reads null: the RLS assertions then pass for
-- everybody equally, which proves nothing at all. That is what the
-- first run of this file did.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE);
SELECT set_config('request.jwt.claim.role', 'authenticated', FALSE);

SELECT assert('a contact on somebody else''s private list is invisible',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST hidden co') = 0,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST hidden co'));

DO $$
BEGIN
  PERFORM command_apply('[{"table":"crm_contacts","id":"dddddddd-0000-0000-0000-000000000004","set":{"phone":"0161"}}]'::JSONB);
  PERFORM assert('an RLS hidden row fails the call rather than silently doing nothing', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an RLS hidden row fails the call rather than silently doing nothing',
    SQLERRM LIKE '%exactly one row%', SQLERRM);
END
$$;

RESET ROLE;

-- And the same row, for the person who owns the list.
--
-- With a role that may edit contacts. `crm_update` is
-- `current_role_safe() IN ('admin','marketer','sales')`, and the
-- trigger gives a new profile the lowest role, so without this the
-- owner is correctly refused and the assertion is about the wrong
-- thing. Worth noting for its own sake: that policy is about the ROLE
-- and says nothing about which COLUMN, so at the database level any of
-- those three may write any writable column of any contact they can
-- see, including `assigned_to`, whatever `crm.assign` says.
--
-- Nobody, before changing anybody's role. A `set_config` with `FALSE`
-- lasts the whole session, so B's claims are still in force here, and
-- the project has a trigger on `profiles` that refuses a role change
-- from anybody who is not an administrator. Leaving B in place made
-- that trigger reject this line, which left the owner a viewer, which
-- made the next assertion fail for a reason that has nothing to do with
-- what it is about.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT set_config('request.jwt.claim.role', '', FALSE);
-- A spare administrator first: migration 019 will not let the last one
-- stop being one, and this section needs this user to be a rep.
SELECT keep_an_admin();
UPDATE profiles SET role = 'sales' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Asserted, because a refused role change is silent and every
-- conclusion after it would be about the wrong person.
SELECT assert('the list owner has a role that may edit contacts',
  (SELECT role FROM profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'sales',
  (SELECT role FROM profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'));

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
SELECT set_config('request.jwt.claim.role', 'authenticated', FALSE);

SELECT assert('the owner can see it',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST hidden co') = 1);

DO $$
DECLARE changed INTEGER;
BEGIN
  SELECT command_apply('[{"table":"crm_contacts","id":"dddddddd-0000-0000-0000-000000000004","set":{"phone":"0161"}}]'::JSONB) INTO changed;
  PERFORM assert('and the owner''s change goes through', changed = 1, changed::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('and the owner''s change goes through', FALSE, SQLERRM);
END
$$;

RESET ROLE;

-- The one that matters: a batch mixing a visible row with a hidden one
-- must change neither.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE);
SELECT set_config('request.jwt.claim.role', 'authenticated', FALSE);

DO $$
DECLARE before_1 NUMERIC;
BEGIN
  SELECT retail_price INTO before_1 FROM stock_trailers WHERE stc_no='TESTSTC1';
  BEGIN
    PERFORM command_apply(('[' ||
      '{"table":"stock_trailers","id":"11111111-1111-1111-1111-111111111111","set":{"retail_price":777}},' ||
      '{"table":"crm_contacts","id":"dddddddd-0000-0000-0000-000000000004","set":{"phone":"0999"}}' ||
      ']')::JSONB);
    PERFORM assert('a batch mixing a visible row with a hidden one fails', FALSE, 'it succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM assert('a batch mixing a visible row with a hidden one fails',
      SQLERRM LIKE '%exactly one row%', SQLERRM);
  END;
  PERFORM assert('and the visible row was rolled back',
    (SELECT retail_price FROM stock_trailers WHERE stc_no='TESTSTC1') = before_1,
    (SELECT retail_price::TEXT FROM stock_trailers WHERE stc_no='TESTSTC1'));
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT set_config('request.jwt.claim.role', '', FALSE);

-- -------------------------------------------------------------
-- The four ways a contact can be visible, with the join table's own
-- policy switched ON.
--
-- These could not be asserted at all until migration 009. `crm_select`
-- consulted `crm_lists`, whose `lists_select` consulted
-- `crm_list_members`, whose `members_all` consulted `crm_lists`, and
-- Postgres refused to evaluate any of it:
--
--   ERROR: infinite recursion detected in policy for relation
--          "crm_list_members"
--
-- The test database used to switch row level security off on
-- `crm_list_members` to get past that, which meant the assertions above
-- ran against policies the repository does not contain. It is on here.
-- -------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT set_config('request.jwt.claim.role', '', FALSE);

-- A's own list is above. This adds a list of B's that A was added to,
-- and one of B's that A was not.
INSERT INTO crm_lists (id, name, owner_id, is_global) VALUES
  ('cccccccc-0000-0000-0000-000000000005', 'TEST shared with A', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE),
  ('cccccccc-0000-0000-0000-000000000006', 'TEST B only',        'bbbbbbbb-0000-0000-0000-000000000002', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_list_members (list_id, user_id)
VALUES ('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO crm_contacts (id, company_name, list_id, status, source) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'TEST unlisted co', NULL, 'lead', 'manual'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'TEST global co', (SELECT id FROM crm_lists WHERE is_global LIMIT 1), 'lead', 'manual'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'TEST shared co', 'cccccccc-0000-0000-0000-000000000005', 'lead', 'manual'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'TEST b only co', 'cccccccc-0000-0000-0000-000000000006', 'lead', 'manual')
ON CONFLICT (id) DO NOTHING;

-- Every one of them is really there, checked as the owner before
-- anybody becomes anybody. A row that failed its foreign key looks
-- exactly like a row row level security is hiding, and an assertion that
-- cannot tell those apart passes for the wrong reason. That has already
-- happened once in this file.
SELECT assert('all four visibility fixtures exist',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name IN
    ('TEST unlisted co','TEST global co','TEST shared co','TEST b only co')) = 4,
  (SELECT string_agg(company_name, ', ' ORDER BY company_name) FROM crm_contacts
   WHERE company_name LIKE 'TEST %'));

SELECT assert('and A really is a member of B''s shared list',
  (SELECT COUNT(*) FROM crm_list_members
   WHERE list_id='cccccccc-0000-0000-0000-000000000005'
     AND user_id='aaaaaaaa-0000-0000-0000-000000000001') = 1);

-- Forced, because the fixtures belong to the same role that is about to
-- read them and a table owner is exempt from its own policies.
ALTER TABLE crm_contacts     FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_lists        FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_list_members FORCE ROW LEVEL SECURITY;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
SELECT set_config('request.jwt.claim.role', 'authenticated', FALSE);

-- That this returns at all is the repair. Before 009 it raised.
SELECT assert('a contact on no list is visible',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST unlisted co') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST unlisted co'));

SELECT assert('a contact on the global list is visible',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST global co') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST global co'));

SELECT assert('a contact on a list you own is visible',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST hidden co') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST hidden co'));

SELECT assert('a contact on a list you were added to is visible',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST shared co') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST shared co'));

SELECT assert('a contact on somebody else''s list you are not on is not',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name='TEST b only co') = 0,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name='TEST b only co'));

-- The same four rules, on the lists themselves.
SELECT assert('the lists you can see are the global one, yours, and the one shared with you',
  (SELECT COUNT(*) FROM crm_lists WHERE name LIKE 'TEST %') = 2,
  (SELECT string_agg(name, ', ' ORDER BY name) FROM crm_lists WHERE name LIKE 'TEST %'));

-- And a change through `command_apply` reaches a shared row.
DO $$
DECLARE changed INTEGER;
BEGIN
  SELECT command_apply('[{"table":"crm_contacts","id":"eeeeeeee-0000-0000-0000-000000000003","set":{"phone":"0161"}}]'::JSONB)
    INTO changed;
  PERFORM assert('a change to a contact on a shared list goes through', changed = 1, changed::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a change to a contact on a shared list goes through', FALSE, SQLERRM);
END
$$;

-- And does not reach one on a list nobody shared.
DO $$
BEGIN
  PERFORM command_apply('[{"table":"crm_contacts","id":"eeeeeeee-0000-0000-0000-000000000004","set":{"phone":"0161"}}]'::JSONB);
  PERFORM assert('a change to a contact on a list you cannot see fails', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a change to a contact on a list you cannot see fails',
    SQLERRM LIKE '%exactly one row%', SQLERRM);
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT set_config('request.jwt.claim.role', '', FALSE);

ALTER TABLE crm_contacts     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_lists        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_list_members NO FORCE ROW LEVEL SECURITY;

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST %';
DELETE FROM crm_lists    WHERE name LIKE 'TEST %';

-- -------------------------------------------------------------
-- A set of deals, sold in one call
--
-- `command_mark_sold` sells one deal. A sentence names a set, and six
-- calls from application code is six transactions, any of which can
-- fail after the ones before it have committed. `command_mark_sold_many`
-- is the same operation over a list, in one transaction.
-- -------------------------------------------------------------
SELECT reset_fixtures();

INSERT INTO crm_contacts (id, company_name, status, source, stock_trailer_id, sale_price, profit, commission_rate)
VALUES
  ('a1111111-0000-0000-0000-000000000001', 'TEST buyer one', 'quoted', 'manual',
   '11111111-1111-1111-1111-111111111111', 24995, 3000, 0.10),
  ('a1111111-0000-0000-0000-000000000002', 'TEST buyer two', 'quoted', 'manual',
   '22222222-2222-2222-2222-222222222222', 31000, 4000, 0.10)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_mark_sold_many(
    ARRAY['a1111111-0000-0000-0000-000000000001'::UUID,
          'a1111111-0000-0000-0000-000000000002'::UUID],
    'AE', NULL, NULL, DATE '2026-08-17'
  ) INTO out;
  PERFORM assert('two deals sell in one call', jsonb_array_length(out) = 2, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('two deals sell in one call', FALSE, SQLERRM);
END
$$;

SELECT assert('both deals are won',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name LIKE 'TEST buyer%' AND status = 'customer') = 2,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name LIKE 'TEST buyer%' AND status = 'customer'));

SELECT assert('both stock units are sold',
  (SELECT COUNT(*) FROM stock_trailers WHERE stc_no IN ('TESTSTC1','TESTSTC2') AND status = 'sold') = 2,
  (SELECT string_agg(stc_no || '=' || status, ', ') FROM stock_trailers WHERE stc_no LIKE 'TESTSTC%'));

SELECT assert('commission was raised on each',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name LIKE 'TEST buyer%' AND commission IS NOT NULL) = 2);

SELECT assert('and the rep is on the units',
  (SELECT COUNT(*) FROM stock_trailers WHERE stc_no IN ('TESTSTC1','TESTSTC2') AND sales_rep = 'AE') = 2);

-- One bad deal in the list takes the whole call with it.
SELECT reset_fixtures();
DELETE FROM crm_contacts WHERE company_name LIKE 'TEST buyer%';
INSERT INTO crm_contacts (id, company_name, status, source, stock_trailer_id, sale_price, profit, commission_rate)
VALUES ('a1111111-0000-0000-0000-000000000003', 'TEST buyer three', 'quoted', 'manual',
        '11111111-1111-1111-1111-111111111111', 24995, 3000, 0.10)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM command_mark_sold_many(
    ARRAY['a1111111-0000-0000-0000-000000000003'::UUID,
          'a1111111-0000-0000-0000-000000000099'::UUID],
    'AE', NULL, NULL, DATE '2026-08-17'
  );
  PERFORM assert('a deal that is not there fails the whole call', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a deal that is not there fails the whole call',
    SQLERRM LIKE '%not there%', SQLERRM);
END
$$;

SELECT assert('and the good deal in the same call was rolled back',
  (SELECT status FROM crm_contacts WHERE company_name = 'TEST buyer three') <> 'customer',
  (SELECT status FROM crm_contacts WHERE company_name = 'TEST buyer three'));

SELECT assert('so its stock unit is untouched too',
  (SELECT status FROM stock_trailers WHERE stc_no = 'TESTSTC1') <> 'sold',
  (SELECT status FROM stock_trailers WHERE stc_no = 'TESTSTC1'));

-- The same deal twice in one call is two commission lines on one sale.
DO $$
BEGIN
  PERFORM command_mark_sold_many(
    ARRAY['a1111111-0000-0000-0000-000000000003'::UUID,
          'a1111111-0000-0000-0000-000000000003'::UUID],
    'AE', NULL, NULL, DATE '2026-08-17'
  );
  PERFORM assert('the same deal named twice is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the same deal named twice is refused',
    SQLERRM LIKE '%more than once%', SQLERRM);
END
$$;

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST buyer%';

-- -------------------------------------------------------------
-- Creating and deleting, through the same door
-- -------------------------------------------------------------
\echo '--- lifecycle ---'

-- Creating and deleting ask for a capability, so the harness has to say
-- who it is. Without a claim `current_role_safe()` answers nobody, which
-- is correct and useless.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

SELECT reset_fixtures();

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT command_apply('[{"op":"insert","table":"crm_contacts","set":{"company_name":"TEST made here","status":"lead"}}]'::JSONB)
    INTO n;
  PERFORM assert('an insert creates one row', n = 1, n::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an insert creates one row', FALSE, SQLERRM);
END
$$;

SELECT assert('and the row is really there',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST made here') = 1);

SELECT assert('with the values it was given',
  (SELECT status FROM crm_contacts WHERE company_name = 'TEST made here') = 'lead',
  (SELECT status FROM crm_contacts WHERE company_name = 'TEST made here'));

-- The allowlist holds whichever direction a row is moving.
DO $$
BEGIN
  PERFORM command_apply('[{"op":"insert","table":"crm_contacts","set":{"company_name":"TEST blocked","created_at":"2020-01-01"}}]'::JSONB);
  PERFORM assert('an insert cannot fill in a column outside the allowlist', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an insert cannot fill in a column outside the allowlist',
    SQLERRM LIKE '%may not write%', SQLERRM);
END
$$;

SELECT assert('and nothing was created by the attempt',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST blocked') = 0);

-- A constraint the database holds is still held.
DO $$
BEGIN
  PERFORM command_apply('[{"op":"insert","table":"crm_contacts","set":{"company_name":"TEST bad status","status":"nonsense"}}]'::JSONB);
  PERFORM assert('an insert outside a CHECK is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an insert outside a CHECK is refused', TRUE);
END
$$;

-- Deleting, and the same all-or-nothing promise.
DO $$
DECLARE target UUID;
DECLARE n INTEGER;
BEGIN
  SELECT id INTO target FROM crm_contacts WHERE company_name = 'TEST made here';
  SELECT command_apply(('[{"op":"delete","table":"crm_contacts","id":"' || target || '"}]')::JSONB) INTO n;
  PERFORM assert('a delete removes one row', n = 1, n::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a delete removes one row', FALSE, SQLERRM);
END
$$;

SELECT assert('and it is gone',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST made here') = 0);

DO $$
BEGIN
  PERFORM command_apply(('[' ||
    '{"op":"insert","table":"crm_contacts","set":{"company_name":"TEST rolled back"}},' ||
    '{"op":"delete","table":"crm_contacts","id":"00000000-0000-0000-0000-000000000000"}' ||
    ']')::JSONB);
  PERFORM assert('a delete of a row that is not there fails the call', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a delete of a row that is not there fails the call',
    SQLERRM LIKE '%exactly one row%', SQLERRM);
END
$$;

SELECT assert('and the insert in the same call was rolled back',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST rolled back') = 0);

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST %';

-- -------------------------------------------------------------
-- A list, and the records in it, in that order
-- -------------------------------------------------------------
SELECT reset_fixtures();

INSERT INTO crm_contacts (id, company_name, status, source) VALUES
  ('b1111111-0000-0000-0000-000000000001', 'TEST listed one', 'lead', 'manual'),
  ('b1111111-0000-0000-0000-000000000002', 'TEST listed two', 'lead', 'manual')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_create_list('TEST tipper prospects',
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          'b1111111-0000-0000-0000-000000000002'::UUID], NULL) INTO out;
  PERFORM assert('a list is created with its records in it', (out ->> 'moved')::INT = 2, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list is created with its records in it', FALSE, SQLERRM);
END
$$;

SELECT assert('the list is really there',
  (SELECT COUNT(*) FROM crm_lists WHERE name = 'TEST tipper prospects') = 1);

SELECT assert('and both records point at it',
  (SELECT COUNT(*) FROM crm_contacts c JOIN crm_lists l ON l.id = c.list_id
   WHERE l.name = 'TEST tipper prospects') = 2);

-- One record that cannot be moved takes the list with it.
DO $$
BEGIN
  PERFORM command_create_list('TEST never made',
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          '00000000-0000-0000-0000-000000000000'::UUID], NULL);
  PERFORM assert('a record that is not there fails the whole thing', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a record that is not there fails the whole thing',
    SQLERRM LIKE '%expected to put%', SQLERRM);
END
$$;

SELECT assert('and the list was not created either',
  (SELECT COUNT(*) FROM crm_lists WHERE name = 'TEST never made') = 0);

-- -------------------------------------------------------------
-- Sharing that list with colleagues
--
-- The functions ask `command_may`, which reads the caller's role, so
-- the harness has to say who it is. Without this every capability check
-- answers "nobody", which is correct and useless.
--
-- Sharing in this CRM is list membership, so this asserts against
-- `crm_list_members` rather than against anything the command layer
-- believes about it. The two people are the ones the RLS section above
-- created, which is also why they have `profiles` rows: the project's
-- `handle_new_user` trigger copies an auth user into profiles.
-- -------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE list UUID; out JSONB;
BEGIN
  SELECT id INTO list FROM crm_lists WHERE name = 'TEST tipper prospects';

  SELECT command_share_list(list,
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          'b1111111-0000-0000-0000-000000000002'::UUID],
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID,
          'bbbbbbbb-0000-0000-0000-000000000002'::UUID], TRUE) INTO out;
  PERFORM assert('a list is shared with both colleagues', (out ->> 'granted')::INT = 2, out::TEXT);

  -- Sharing twice grants nothing more, which is what `idempotent` in
  -- the capability registry claims and this is what makes it true.
  SELECT command_share_list(list,
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          'b1111111-0000-0000-0000-000000000002'::UUID],
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID], TRUE) INTO out;
  PERFORM assert('sharing again with the same person changes nothing',
    (out ->> 'granted')::INT = 0 AND (out ->> 'alreadyHad')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list is shared with both colleagues', FALSE, SQLERRM);
END
$$;

SELECT assert('and the memberships are really there',
  (SELECT COUNT(*) FROM crm_list_members m JOIN crm_lists l ON l.id = m.list_id
   WHERE l.name = 'TEST tipper prospects') = 2);

-- One person who is not here takes the whole grant with them.
DO $$
DECLARE list UUID;
BEGIN
  SELECT id INTO list FROM crm_lists WHERE name = 'TEST tipper prospects';
  PERFORM command_share_list(list,
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          'b1111111-0000-0000-0000-000000000002'::UUID],
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID,
          '00000000-0000-0000-0000-0000000000ff'::UUID], TRUE);
  PERFORM assert('a person who is not here fails the whole grant', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a person who is not here fails the whole grant',
    SQLERRM LIKE '%only%are here%', SQLERRM);
END
$$;

-- Two of the records on a list is not the list, and sharing grants the
-- whole list. See the header of migration 013.
DO $$
DECLARE list UUID;
BEGIN
  SELECT id INTO list FROM crm_lists WHERE name = 'TEST tipper prospects';
  PERFORM command_share_list(list,
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID],
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID], TRUE);
  PERFORM assert('sharing part of a list is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('sharing part of a list is refused',
    SQLERRM LIKE '%1 of the 2 records%', SQLERRM);
END
$$;

SELECT assert('and nobody new was granted access either',
  (SELECT COUNT(*) FROM crm_list_members m JOIN crm_lists l ON l.id = m.list_id
   WHERE l.name = 'TEST tipper prospects') = 2);

-- The global list is everybody's already.
DO $$
DECLARE glob UUID;
BEGIN
  SELECT id INTO glob FROM crm_lists WHERE is_global LIMIT 1;
  PERFORM command_share_list(glob,
    ARRAY(SELECT id FROM crm_contacts WHERE list_id = glob),
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID], TRUE);
  PERFORM assert('the global list refuses to be shared', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the global list refuses to be shared',
    SQLERRM LIKE '%global list%', SQLERRM);
END
$$;

-- -------------------------------------------------------------
-- Moving records onto a list that already exists
-- -------------------------------------------------------------
INSERT INTO crm_lists (id, name, is_global)
VALUES ('e1111111-0000-0000-0000-000000000001', 'TEST second list', FALSE)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_add_to_list('TEST second list',
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID,
          'b1111111-0000-0000-0000-000000000002'::UUID]) INTO out;
  PERFORM assert('records move onto a list named by its name',
    (out ->> 'moved')::INT = 2, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('records move onto a list named by its name', FALSE, SQLERRM);
END
$$;

SELECT assert('and they really are on it',
  (SELECT COUNT(*) FROM crm_contacts
   WHERE list_id = 'e1111111-0000-0000-0000-000000000001') = 2);

-- A name that fits two lists is a question, not a choice made here.
INSERT INTO crm_lists (id, name, is_global)
VALUES ('e1111111-0000-0000-0000-000000000002', 'TEST second list 2026', FALSE)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM command_add_to_list('TEST second',
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID]);
  PERFORM assert('a name that fits two lists moves nothing', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a name that fits two lists moves nothing',
    SQLERRM LIKE '%more than one list%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_add_to_list('TEST no such list',
    ARRAY['b1111111-0000-0000-0000-000000000001'::UUID]);
  PERFORM assert('a list that is not there is said so', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list that is not there is said so',
    SQLERRM LIKE '%no list here is called%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);

DELETE FROM crm_list_members WHERE list_id IN (SELECT id FROM crm_lists WHERE name LIKE 'TEST %');
DELETE FROM crm_contacts WHERE company_name LIKE 'TEST listed%';
DELETE FROM crm_lists WHERE name LIKE 'TEST %';

-- =============================================================
-- 6. command_mark_sold
-- =============================================================
\echo '--- marking a deal sold ---'

SELECT reset_fixtures();

-- There is a unique index permitting exactly one global list, so this
-- uses whichever one exists rather than inserting a second and failing
-- silently, which is what left the next three fixtures with no list to
-- belong to.
CREATE OR REPLACE FUNCTION test_global_list() RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM crm_lists WHERE is_global LIMIT 1;
  IF v IS NULL THEN
    INSERT INTO crm_lists (name, is_global) VALUES ('TEST global', TRUE) RETURNING id INTO v;
  END IF;
  RETURN v;
END
$$;

INSERT INTO crm_contacts (id, company_name, list_id, status, source, stock_trailer_id, profit, sale_price)
VALUES
  ('f0000000-0000-0000-0000-000000000010', 'TEST buyer', test_global_list(), 'quoted', 'manual',
   '11111111-1111-1111-1111-111111111111', 4000, 24000),
  ('f0000000-0000-0000-0000-000000000011', 'TEST rival', test_global_list(), 'quoted', 'manual',
   '11111111-1111-1111-1111-111111111111', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE result JSONB;
BEGIN
  SELECT command_mark_sold('f0000000-0000-0000-0000-000000000010', 'DA', 24000, 4000, NULL, NULL, DATE '2026-08-14') INTO result;
  PERFORM assert('the sale goes through', result IS NOT NULL, result::TEXT);
  PERFORM assert('commission is worked out at the row''s rate',
    (result ->> 'commission')::NUMERIC = 400, result ->> 'commission');
  PERFORM assert('the deal is marked won',
    (SELECT status FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000010') = 'customer');
  PERFORM assert('the stock unit is sold',
    (SELECT status FROM stock_trailers WHERE id='11111111-1111-1111-1111-111111111111') = 'sold');
  PERFORM assert('and it carries the buyer and the rep',
    (SELECT customer FROM stock_trailers WHERE id='11111111-1111-1111-1111-111111111111') = 'TEST buyer'
    AND (SELECT sales_rep FROM stock_trailers WHERE id='11111111-1111-1111-1111-111111111111') = 'DA');
  PERFORM assert('the other rep is told it is gone',
    (SELECT status FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000011') = 'customer');
  PERFORM assert('but keeps no commission',
    (SELECT commission FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000011') IS NULL);
  PERFORM assert('and it reports how many others it told',
    (result ->> 'cascadedOthers')::INTEGER = 1, result ->> 'cascadedOthers');
END
$$;

-- A sale whose stock update affects nothing.
--
-- `crm_contacts.stock_trailer_id` has a foreign key, so a deal cannot
-- point at a stock row that is not there: my first attempt at this case
-- inserted nothing and then asserted against a row that had never
-- existed. The real shape of this failure is a stock row the caller
-- cannot write, so that is what this creates: a policy that denies the
-- update, exactly as an RLS restriction would.
SELECT reset_fixtures();

INSERT INTO crm_contacts (id, company_name, list_id, status, source, stock_trailer_id, profit)
VALUES ('f0000000-0000-0000-0000-000000000012', 'TEST blocked', test_global_list(), 'quoted', 'manual',
        '22222222-2222-2222-2222-222222222222', 1000)
ON CONFLICT (id) DO NOTHING;

-- FORCE, because this runs as the table's owner and an owner is exempt
-- from its own policies otherwise. Without it the restrictive policy is
-- ignored, the sale succeeds, and the test passes while proving the
-- opposite of what it claims.
CREATE POLICY "test_block_stock_update" ON stock_trailers
  AS RESTRICTIVE FOR UPDATE USING (FALSE);
ALTER TABLE stock_trailers FORCE ROW LEVEL SECURITY;

-- As somebody who is not the table's owner and not a superuser, since
-- both ignore row level security however forcefully it is declared.
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
SELECT set_config('request.jwt.claim.role', 'authenticated', FALSE);

DO $$
BEGIN
  BEGIN
    PERFORM command_mark_sold('f0000000-0000-0000-0000-000000000012', 'DA', 1, 1, NULL, NULL, DATE '2026-08-14');
    PERFORM assert('a sale whose stock unit cannot be updated fails', FALSE, 'it succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM assert('a sale whose stock unit cannot be updated fails',
      SQLERRM LIKE '%stock unit could not be updated%', SQLERRM);
  END;
  PERFORM assert('and the deal was rolled back to where it started',
    (SELECT status FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000012') = 'quoted',
    (SELECT status FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000012'));
  PERFORM assert('and the other reps were not told either',
    (SELECT COUNT(*) FROM crm_contacts
     WHERE stock_trailer_id='22222222-2222-2222-2222-222222222222' AND status='customer') = 0);
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', FALSE);
ALTER TABLE stock_trailers NO FORCE ROW LEVEL SECURITY;
DROP POLICY "test_block_stock_update" ON stock_trailers;

-- A deal with no stock unit at all is a legitimate sale.
INSERT INTO crm_contacts (id, company_name, list_id, status, source, profit)
VALUES ('f0000000-0000-0000-0000-000000000013', 'TEST unlinked', test_global_list(), 'quoted', 'manual', 500)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE result JSONB;
BEGIN
  SELECT command_mark_sold('f0000000-0000-0000-0000-000000000013', 'DA', NULL, NULL, NULL, NULL, DATE '2026-08-14') INTO result;
  PERFORM assert('a deal with no stock unit still sells',
    (SELECT status FROM crm_contacts WHERE id='f0000000-0000-0000-0000-000000000013') = 'customer');
  PERFORM assert('and reports no stock update', (result ->> 'stockUpdated')::BOOLEAN = FALSE, result::TEXT);
END
$$;

DO $$
BEGIN
  BEGIN
    PERFORM command_mark_sold('99999999-9999-9999-9999-999999999999', 'DA');
    PERFORM assert('a deal that is not there fails', FALSE, 'it succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM assert('a deal that is not there fails', SQLERRM LIKE '%not there%', SQLERRM);
  END;
END
$$;

-- =============================================================
-- 7. Attaching a file to a record
-- =============================================================
\echo '--- attaching a file ---'

SELECT reset_fixtures();
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE unit UUID; out JSONB;
BEGIN
  SELECT id INTO unit FROM stock_trailers LIMIT 1;

  SELECT command_attach_file('stock_trailers', unit, 'TEST report.pdf', 'application/pdf',
    encode('%PDF-1.4 not really a pdf'::BYTEA, 'base64'), 'TEST the sold curtainsiders') INTO out;
  PERFORM assert('a file is attached to a record', (out ->> 'size')::INT > 0, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a file is attached to a record', FALSE, SQLERRM);
END
$$;

SELECT assert('and the bytes really came back out intact',
  (SELECT convert_from(bytes, 'UTF8') FROM record_attachments WHERE filename = 'TEST report.pdf')
    = '%PDF-1.4 not really a pdf',
  (SELECT convert_from(bytes, 'UTF8') FROM record_attachments WHERE filename = 'TEST report.pdf'));

-- A table the command bar does not attach to.
DO $$
BEGIN
  PERFORM command_attach_file('profiles', gen_random_uuid(), 'TEST no.pdf', 'application/pdf',
    encode('x'::BYTEA, 'base64'), NULL);
  PERFORM assert('a table it does not attach to is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a table it does not attach to is refused',
    SQLERRM LIKE '%attaches things to%', SQLERRM);
END
$$;

-- A record that is not there.
DO $$
BEGIN
  PERFORM command_attach_file('stock_trailers', '00000000-0000-0000-0000-0000000000ff',
    'TEST no.pdf', 'application/pdf', encode('x'::BYTEA, 'base64'), NULL);
  PERFORM assert('a record that is not there is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a record that is not there is refused',
    SQLERRM LIKE '%not there%', SQLERRM);
END
$$;

SELECT assert('and nothing was stored for either of those',
  (SELECT COUNT(*) FROM record_attachments WHERE filename = 'TEST no.pdf') = 0);

SELECT set_config('request.jwt.claim.sub', '', FALSE);

DELETE FROM record_attachments WHERE filename LIKE 'TEST %';

-- =============================================================
-- 8. Seeing a record is not permission to write to it
-- =============================================================
\echo '--- attaching as a viewer ---'

SELECT reset_fixtures();

-- The runtime's gate is irrelevant here: this is the function called
-- directly, which is what PostgREST exposes.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE unit UUID;
BEGIN
  SELECT id INTO unit FROM stock_trailers LIMIT 1;
  PERFORM command_attach_file('stock_trailers', unit, 'TEST viewer.pdf', 'application/pdf',
    encode('x'::BYTEA, 'base64'), NULL);
  PERFORM assert('a viewer calling the attach function directly is refused', FALSE, 'it attached');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer calling the attach function directly is refused',
    SQLERRM LIKE '%stock.edit%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT assert('and nothing was attached',
  (SELECT COUNT(*) FROM record_attachments WHERE filename = 'TEST viewer.pdf') = 0);

-- =============================================================
-- 9. One programme, one transaction
-- =============================================================
\echo '--- command_perform ---'

SELECT reset_fixtures();
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

INSERT INTO crm_contacts (id, company_name, status, source) VALUES
  ('c1111111-0000-0000-0000-000000000001', 'TEST perform one', 'lead', 'manual'),
  ('c1111111-0000-0000-0000-000000000002', 'TEST perform two', 'lead', 'manual')
ON CONFLICT (id) DO NOTHING;

-- Make a list and share it, in one call, with the share naming the list
-- by the position of the step that creates it.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(('[' ||
    '{"op":"invoke","capability":"list.create",' ||
    ' "subjects":["c1111111-0000-0000-0000-000000000001","c1111111-0000-0000-0000-000000000002"],' ||
    ' "args":{"name":"TEST performed list"}},' ||
    '{"op":"invoke","capability":"rows.share",' ||
    ' "subjects":["c1111111-0000-0000-0000-000000000001","c1111111-0000-0000-0000-000000000002"],' ||
    ' "args":{"list":{"$from":{"step":0,"key":"listId"}},' ||
    '          "users":["aaaaaaaa-0000-0000-0000-000000000001"]}}' ||
    ']')::JSONB) INTO out;
  PERFORM assert('a list is made and shared in one call', (out ->> 'changed')::INT = 3, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list is made and shared in one call', FALSE, SQLERRM);
END
$$;

SELECT assert('the list is there',
  (SELECT COUNT(*) FROM crm_lists WHERE name = 'TEST performed list') = 1);
SELECT assert('and it is shared',
  (SELECT COUNT(*) FROM crm_list_members m JOIN crm_lists l ON l.id = m.list_id
   WHERE l.name = 'TEST performed list') = 1);

DELETE FROM crm_list_members WHERE list_id IN (SELECT id FROM crm_lists WHERE name LIKE 'TEST %');
DELETE FROM crm_lists WHERE name LIKE 'TEST %';
UPDATE crm_contacts SET list_id = NULL WHERE company_name LIKE 'TEST perform%';

-- The share fails. The list must not survive it.
DO $$
BEGIN
  PERFORM command_perform(('[' ||
    '{"op":"invoke","capability":"list.create",' ||
    ' "subjects":["c1111111-0000-0000-0000-000000000001","c1111111-0000-0000-0000-000000000002"],' ||
    ' "args":{"name":"TEST rolled back list"}},' ||
    '{"op":"invoke","capability":"rows.share",' ||
    ' "subjects":["c1111111-0000-0000-0000-000000000001"],' ||
    ' "args":{"list":{"$from":{"step":0,"key":"listId"}},' ||
    '          "users":["aaaaaaaa-0000-0000-0000-000000000001"]}}' ||
    ']')::JSONB);
  PERFORM assert('a share that fails fails the whole programme', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a share that fails fails the whole programme',
    SQLERRM LIKE '%records on the list%', SQLERRM);
END
$$;

SELECT assert('and the list it would have shared was never created',
  (SELECT COUNT(*) FROM crm_lists WHERE name = 'TEST rolled back list') = 0);
SELECT assert('nor were the records moved onto one',
  (SELECT COUNT(*) FROM crm_contacts
   WHERE company_name LIKE 'TEST perform%' AND list_id IS NOT NULL) = 0);

-- A field write and an operation in one call, with the operation failing.
DO $$
BEGIN
  PERFORM command_perform(('[' ||
    '{"op":"changes","changes":[{"table":"stock_trailers",' ||
    ' "id":"11111111-1111-1111-1111-111111111111","set":{"location":"TEST moved"}}]},' ||
    '{"op":"invoke","capability":"list.create","subjects":[],"args":{"name":"TEST empty list"}}' ||
    ']')::JSONB);
  PERFORM assert('an operation that fails takes the field write with it', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an operation that fails takes the field write with it',
    SQLERRM LIKE '%needs something in it%', SQLERRM);
END
$$;

SELECT assert('and the trailer did not move',
  (SELECT location FROM stock_trailers WHERE stc_no = 'TESTSTC1') <> 'TEST moved',
  (SELECT location FROM stock_trailers WHERE stc_no = 'TESTSTC1'));

SELECT set_config('request.jwt.claim.sub', '', FALSE);

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST perform%';

-- =============================================================
-- 10. Changing what somebody is allowed to do
-- =============================================================
\echo '--- role changes ---'

SELECT reset_fixtures();

-- A second admin, so the last-admin guard is not what is being tested.
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_set_role('bbbbbbbb-0000-0000-0000-000000000002', 'admin') INTO out;
  PERFORM assert('an admin can change somebody''s role',
    (out ->> 'was') = 'sales' AND (out ->> 'now') = 'admin', out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an admin can change somebody''s role', FALSE, SQLERRM);
END
$$;

SELECT assert('and the profile really holds it',
  (SELECT role FROM profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002') = 'admin',
  (SELECT role FROM profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'));

-- A role nobody has.
DO $$
BEGIN
  PERFORM command_set_role('bbbbbbbb-0000-0000-0000-000000000002', 'superuser');
  PERFORM assert('a role that does not exist is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a role that does not exist is refused',
    SQLERRM LIKE '%no role called%', SQLERRM);
END
$$;

-- The last administrator.
UPDATE profiles SET role = 'sales' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'sales' WHERE id = 'dddddddd-0000-0000-0000-00000000000d';

DO $$
BEGIN
  PERFORM command_set_role('aaaaaaaa-0000-0000-0000-000000000001', 'viewer');
  PERFORM assert('the last administrator cannot stop being one', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the last administrator cannot stop being one',
    SQLERRM LIKE '%only administrator%', SQLERRM);
END
$$;

SELECT assert('and they are still an admin',
  (SELECT role FROM profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'admin');

-- A sales rep calling it directly, which is what PostgREST exposes.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE);

DO $$
BEGIN
  PERFORM command_set_role('bbbbbbbb-0000-0000-0000-000000000002', 'admin');
  PERFORM assert('a sales rep calling it directly is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a sales rep calling it directly is refused',
    SQLERRM LIKE '%admin.users%', SQLERRM);
END
$$;

SELECT assert('and they did not elevate themselves',
  (SELECT role FROM profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002') = 'sales',
  (SELECT role FROM profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'));

-- A direct UPDATE, going nowhere near command_set_role. The rule is on
-- the table, so the path does not matter.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
UPDATE profiles SET role = 'sales' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'sales' WHERE id = 'dddddddd-0000-0000-0000-00000000000d';

DO $$
BEGIN
  UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM assert('a direct update cannot remove the last administrator', FALSE, 'it updated');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a direct update cannot remove the last administrator',
    SQLERRM LIKE '%only administrator%', SQLERRM);
END
$$;

DO $$
BEGIN
  DELETE FROM profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM assert('nor can deleting their profile', FALSE, 'it deleted');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('nor can deleting their profile',
    SQLERRM LIKE '%only administrator%', SQLERRM);
END
$$;

SELECT assert('and there is still an administrator',
  (SELECT COUNT(*) FROM profiles WHERE role = 'admin') = 1);

-- Two administrators, one demotion. Allowed.
UPDATE profiles SET role = 'admin' WHERE id = 'dddddddd-0000-0000-0000-00000000000d';
UPDATE profiles SET role = 'sales' WHERE id = 'dddddddd-0000-0000-0000-00000000000d';
SELECT assert('with two administrators one of them may step down',
  (SELECT COUNT(*) FROM profiles WHERE role = 'admin') = 1);

-- =============================================================
-- 11. A payload is not a permission
-- =============================================================
\echo '--- deleting as the wrong role ---'

SELECT reset_fixtures();

INSERT INTO crm_contacts (id, company_name, status, source) VALUES
  ('f1111111-0000-0000-0000-000000000001', 'TEST deletable', 'lead', 'manual')
ON CONFLICT (id) DO NOTHING;

-- A marketer holds crm.edit and not crm.delete. The column allowlist has
-- nothing to say about a delete, which writes no columns at all.
--
-- The claim is cleared around every role flip, because migration 005's
-- trigger refuses a role change from a non-admin and the harness is
-- about to become one.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'marketer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_apply(
    '[{"op":"delete","table":"crm_contacts","id":"f1111111-0000-0000-0000-000000000001"}]'::JSONB);
  PERFORM assert('a marketer cannot delete a customer', FALSE, 'it deleted');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a marketer cannot delete a customer',
    SQLERRM LIKE '%may not delete rows of crm_contacts%', SQLERRM);
END
$$;

SELECT assert('and the customer is still there',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST deletable') = 1);

-- Sales holds crm.delete.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
UPDATE profiles SET role = 'sales' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_apply(
    '[{"op":"delete","table":"crm_contacts","id":"f1111111-0000-0000-0000-000000000001"}]'::JSONB);
  PERFORM assert('a sales rep can delete a customer', TRUE);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a sales rep can delete a customer', FALSE, SQLERRM);
END
$$;

SELECT assert('and it is gone',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST deletable') = 0);

-- A viewer creating one.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_apply(
    '[{"op":"insert","table":"crm_contacts","set":{"company_name":"TEST viewer made this"}}]'::JSONB);
  PERFORM assert('a viewer cannot create a customer', FALSE, 'it inserted');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer cannot create a customer',
    SQLERRM LIKE '%may not create rows of crm_contacts%', SQLERRM);
END
$$;

SELECT assert('and nothing was created',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST viewer made this') = 0);

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =============================================================
-- 12. Operations that were route bodies
-- =============================================================
\echo '--- tracker operations ---'

SELECT reset_fixtures();
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE unit UUID; out JSONB;
BEGIN
  SELECT id INTO unit FROM stock_trailers WHERE stc_no = 'TESTSTC1';
  SELECT command_send_from_stock(ARRAY[unit], 'aaaaaaaa-0000-0000-0000-000000000001') INTO out;
  PERFORM assert('a unit goes onto the tracker', (out ->> 'made')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a unit goes onto the tracker', FALSE, SQLERRM);
END
$$;

SELECT assert('as a lead on the trailer sales side',
  (SELECT COUNT(*) FROM crm_contacts
    WHERE source = 'From Stock' AND side = 'trailer_sales' AND status = 'lead') = 1);
SELECT assert('linked to the unit it came from',
  (SELECT COUNT(*) FROM crm_contacts c JOIN stock_trailers t ON t.id = c.stock_trailer_id
    WHERE c.source = 'From Stock' AND t.stc_no = 'TESTSTC1') = 1);

-- A unit that is not there takes the whole call with it.
DO $$
BEGIN
  PERFORM command_send_from_stock(
    ARRAY['00000000-0000-0000-0000-0000000000ff'::UUID],
    'aaaaaaaa-0000-0000-0000-000000000001');
  PERFORM assert('a unit that is not there is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a unit that is not there is refused',
    SQLERRM LIKE '%expected to send%', SQLERRM);
END
$$;

-- A proposal, carrying the relationship across.
INSERT INTO crm_contacts (id, company_name, status, source, relationship, contact_name)
VALUES ('a2222222-0000-0000-0000-000000000001', 'TEST proposal target', 'lead', 'manual',
        'existing', 'Sam Dawson')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_raise_proposal(
    ARRAY['a2222222-0000-0000-0000-000000000001'::UUID], 'maintenance',
    'aaaaaaaa-0000-0000-0000-000000000001') INTO out;
  PERFORM assert('a proposal is raised', (out ->> 'made')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a proposal is raised', FALSE, SQLERRM);
END
$$;

SELECT assert('as a quoted row on the maintenance side',
  (SELECT COUNT(*) FROM crm_contacts
    WHERE source = 'CRM proposal' AND side = 'maintenance' AND status = 'quoted') = 1);
SELECT assert('carrying the relationship across',
  (SELECT relationship FROM crm_contacts WHERE source = 'CRM proposal' LIMIT 1) = 'existing',
  (SELECT relationship FROM crm_contacts WHERE source = 'CRM proposal' LIMIT 1));

DO $$
BEGIN
  PERFORM command_raise_proposal(
    ARRAY['a2222222-0000-0000-0000-000000000001'::UUID], 'nonsense', NULL);
  PERFORM assert('a proposal type that does not exist is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a proposal type that does not exist is refused',
    SQLERRM LIKE '%no proposal type%', SQLERRM);
END
$$;

-- A viewer, straight at the function.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_raise_proposal(
    ARRAY['a2222222-0000-0000-0000-000000000001'::UUID], 'trailer_sales', NULL);
  PERFORM assert('a viewer cannot raise a proposal', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer cannot raise a proposal', SQLERRM LIKE '%crm.proposal%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST %' OR source IN ('From Stock', 'CRM proposal');
DELETE FROM crm_lists WHERE name = 'Sales tracker';

-- =============================================================
-- 13. Meetings: inviting, answering, and moving one
--
-- Migration 021. The route body became SQL so that both callers use one
-- description of the work, and these are the assertions that say the SQL
-- does what the route did: the length of a meeting survives being
-- moved, an invitation records its own history, accepting a counter
-- proposal moves the meeting, and a role without crm.delegate reaches
-- none of it.
-- =============================================================
\echo '--- meetings ---'

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM calendar_events WHERE title LIKE 'TEST %';
INSERT INTO calendar_events (id, title, description, start_at, end_at, visibility, created_by)
VALUES ('e1111111-0000-0000-0000-000000000001', 'TEST site visit', 'Yard walk round',
        '2026-09-04 09:00+00', '2026-09-04 10:30+00', 'team',
        'aaaaaaaa-0000-0000-0000-000000000001');

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID],
    '2026-09-04 14:00+00') INTO out;
  PERFORM assert('a meeting moves', jsonb_array_length(out) = 1, out::TEXT);
  PERFORM assert('and reports what it was and what it is',
    (out -> 0 ->> 'was') IS NOT NULL AND (out -> 0 ->> 'now') IS NOT NULL, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a meeting moves', FALSE, SQLERRM);
END
$$;

SELECT assert('it starts at the new time',
  (SELECT start_at FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001')
    = '2026-09-04 14:00+00',
  (SELECT start_at::TEXT FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001'));

-- Writing the start alone would leave a meeting that finishes before it
-- begins. An hour and a half is still an hour and a half.
SELECT assert('and it is the same length',
  (SELECT end_at - start_at FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001') = INTERVAL '90 minutes',
  (SELECT (end_at - start_at)::TEXT FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001'));

DO $$
BEGIN
  PERFORM command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID], '2026-09-04 14:00+00');
  PERFORM assert('moving it to where it already is is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('moving it to where it already is is refused',
    SQLERRM LIKE '%already at%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID,
          'e1111111-0000-0000-0000-0000000000ff'::UUID],
    '2026-09-05 09:00+00');
  PERFORM assert('a meeting that is not there fails the whole call', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a meeting that is not there fails the whole call',
    SQLERRM LIKE '%expected to move%', SQLERRM);
END
$$;

SELECT assert('and nothing moved',
  (SELECT start_at FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001')
    = '2026-09-04 14:00+00',
  (SELECT start_at::TEXT FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001'));

-- A clock time with no day. "Move it to 4:30" keeps the day the meeting
-- is already on, which planning cannot know because it has not read the
-- record.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID], NULL, '16:30') INTO out;
  PERFORM assert('a clock time moves it within its own day',
    jsonb_array_length(out) = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a clock time moves it within its own day', FALSE, SQLERRM);
END
$$;

SELECT assert('on the same date it was already on',
  (SELECT start_at::DATE FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001') = DATE '2026-09-04',
  (SELECT start_at::TEXT FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001'));

SELECT assert('and still the same length',
  (SELECT end_at - start_at FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001') = INTERVAL '90 minutes',
  (SELECT (end_at - start_at)::TEXT FROM calendar_events
    WHERE id = 'e1111111-0000-0000-0000-000000000001'));

DO $$
BEGIN
  PERFORM command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID], NULL, NULL);
  PERFORM assert('saying no time at all is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('saying no time at all is refused',
    SQLERRM LIKE '%what time to move it to%', SQLERRM);
END
$$;

-- Inviting somebody, and the history line that goes with it.
INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002', 'invitee@test.local')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'sales', full_name = 'TEST Invitee'
 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_meeting_invite(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID],
    ARRAY['bbbbbbbb-0000-0000-0000-000000000002'::UUID],
    'Come along') INTO out;
  PERFORM assert('an invitation is sent', (out ->> 'sent')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an invitation is sent', FALSE, SQLERRM);
END
$$;

SELECT assert('it is waiting on the person invited',
  (SELECT awaiting FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001')
  = 'bbbbbbbb-0000-0000-0000-000000000002',
  (SELECT awaiting::TEXT FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001'));

SELECT assert('and the exchange has its first line',
  (SELECT COUNT(*) FROM calendar_invite_messages m
     JOIN calendar_invites i ON i.id = m.invite_id
    WHERE i.event_id = 'e1111111-0000-0000-0000-000000000001' AND m.action = 'invited') = 1);

-- Inviting twice is the same invitation, not a second one.
DO $$
BEGIN
  PERFORM command_meeting_invite(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID],
    ARRAY['bbbbbbbb-0000-0000-0000-000000000002'::UUID], NULL);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('inviting twice is the same invitation', FALSE, SQLERRM);
END
$$;

SELECT assert('inviting twice is the same invitation',
  (SELECT COUNT(*) FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001') = 1);

-- The invitee counters, the organiser accepts, and the meeting moves to
-- the time that was countered with. That is the whole conversation.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE);

DO $$
DECLARE out JSONB; inv UUID;
BEGIN
  SELECT id INTO inv FROM calendar_invites
   WHERE event_id = 'e1111111-0000-0000-0000-000000000001';
  SELECT command_meeting_answer(inv, 'propose', '2026-09-07 11:00+00', '2026-09-07 12:30+00', NULL)
    INTO out;
  PERFORM assert('the invitee can suggest another time', (out ->> 'ok')::BOOLEAN, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the invitee can suggest another time', FALSE, SQLERRM);
END
$$;

SELECT assert('and the ball is with the organiser',
  (SELECT awaiting FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001')
  = 'aaaaaaaa-0000-0000-0000-000000000001',
  (SELECT awaiting::TEXT FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001'));

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB; inv UUID;
BEGIN
  SELECT id INTO inv FROM calendar_invites
   WHERE event_id = 'e1111111-0000-0000-0000-000000000001';
  SELECT command_meeting_answer(inv, 'accept', NULL, NULL, NULL) INTO out;
  PERFORM assert('the organiser accepting moves the meeting',
    (out ->> 'movedTo') IS NOT NULL, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the organiser accepting moves the meeting', FALSE, SQLERRM);
END
$$;

SELECT assert('the meeting is at the time that was agreed',
  (SELECT start_at FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001')
    = '2026-09-07 11:00+00',
  (SELECT start_at::TEXT FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001'));

SELECT assert('and nobody is being waited on',
  (SELECT awaiting IS NULL FROM calendar_invites
    WHERE event_id = 'e1111111-0000-0000-0000-000000000001'));

-- The whole programme path, which is what the command bar uses: the same
-- operation, dispatched by capability, inside one transaction.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(jsonb_build_array(jsonb_build_object(
    'op', 'invoke',
    'capability', 'meeting.reschedule',
    'subjects', jsonb_build_array('e1111111-0000-0000-0000-000000000001'),
    'args', jsonb_build_object('start', '2026-09-08 08:30+00')
  ))) INTO out;
  PERFORM assert('a programme can move a meeting', (out ->> 'changed')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a programme can move a meeting', FALSE, SQLERRM);
END
$$;

SELECT assert('and it moved',
  (SELECT start_at FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001')
    = '2026-09-08 08:30+00',
  (SELECT start_at::TEXT FROM calendar_events WHERE id = 'e1111111-0000-0000-0000-000000000001'));

-- A marketer may edit every field on a customer and touch no meeting.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'marketer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_reschedule_meeting(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID], '2026-09-09 09:00+00');
  PERFORM assert('a marketer cannot move a meeting', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a marketer cannot move a meeting', SQLERRM LIKE '%crm.delegate%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_meeting_invite(
    ARRAY['e1111111-0000-0000-0000-000000000001'::UUID],
    ARRAY['bbbbbbbb-0000-0000-0000-000000000002'::UUID], NULL);
  PERFORM assert('nor invite anybody to one', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('nor invite anybody to one', SQLERRM LIKE '%crm.delegate%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM calendar_events WHERE title LIKE 'TEST %';

-- =============================================================
-- 13b. Whose tracker, and who may put something on it
--
-- Migration 025. A direct RPC must never be more powerful than the
-- capability the screen gates on. Both tracker operations took an owner
-- and let it decide whose tracker the row landed on.
-- =============================================================
\echo '--- owner authority ---'

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'sales' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO auth.users (id, email) VALUES ('cccccccc-0000-0000-0000-00000000000c', 'other@test.local')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'sales', full_name = 'TEST Colleague'
 WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM crm_contacts WHERE source IN ('From Stock', 'CRM proposal') OR company_name LIKE 'TEST %';
DELETE FROM crm_lists WHERE name = 'Sales tracker';
INSERT INTO crm_contacts (id, company_name, status, source, relationship)
VALUES ('a3333333-0000-0000-0000-000000000001', 'TEST owner target', 'lead', 'manual', 'prospect')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_raise_proposal(
    ARRAY['a3333333-0000-0000-0000-000000000001'::UUID], 'trailer_sales',
    'aaaaaaaa-0000-0000-0000-000000000001') INTO out;
  PERFORM assert('a rep raises their own proposal', (out ->> 'made')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a rep raises their own proposal', FALSE, SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_raise_proposal(
    ARRAY['a3333333-0000-0000-0000-000000000001'::UUID], 'trailer_sales',
    'cccccccc-0000-0000-0000-00000000000c');
  PERFORM assert('a rep cannot raise one onto a colleague''s tracker', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a rep cannot raise one onto a colleague''s tracker',
    SQLERRM LIKE '%crm.proposalForOthers%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_send_from_stock(
    ARRAY['11111111-1111-1111-1111-111111111111'::UUID],
    'cccccccc-0000-0000-0000-00000000000c');
  PERFORM assert('nor send stock to one', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('nor send stock to one', SQLERRM LIKE '%your own tracker%', SQLERRM);
END
$$;

-- An administrator holds crm.proposalForOthers, which is what the
-- capability is for.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_raise_proposal(
    ARRAY['a3333333-0000-0000-0000-000000000001'::UUID], 'trailer_sales',
    'cccccccc-0000-0000-0000-00000000000c') INTO out;
  PERFORM assert('somebody with crm.proposalForOthers can', (out ->> 'made')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('somebody with crm.proposalForOthers can', FALSE, SQLERRM);
END
$$;

SELECT assert('and it lands under the colleague''s name',
  (SELECT COUNT(*) FROM crm_contacts
    WHERE source = 'CRM proposal' AND assigned_to = 'TEST Colleague') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE source = 'CRM proposal'));

-- Even an administrator has no delegated form of sending stock.
DO $$
BEGIN
  PERFORM command_send_from_stock(
    ARRAY['11111111-1111-1111-1111-111111111111'::UUID],
    'cccccccc-0000-0000-0000-00000000000c');
  PERFORM assert('sending stock has no delegated form at all', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('sending stock has no delegated form at all',
    SQLERRM LIKE '%your own tracker%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_raise_proposal(
    ARRAY['a3333333-0000-0000-0000-000000000001'::UUID], 'trailer_sales', NULL);
  PERFORM assert('a viewer raises nothing for anybody', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer raises nothing for anybody', SQLERRM LIKE '%crm.proposal%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM crm_contacts WHERE source IN ('From Stock', 'CRM proposal') OR company_name LIKE 'TEST owner%';
DELETE FROM crm_lists WHERE name = 'Sales tracker';

-- =============================================================
-- 14. Writing a social post
--
-- Migration 022. The composer fills in the author and the status from
-- the profile, and a client that decided either could put a post
-- straight to approved. Both callers go through the function, so these
-- assertions cover the form as well as the sentence.
-- =============================================================
\echo '--- social posts ---'

DELETE FROM social_posts WHERE content LIKE 'TEST post %';

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
UPDATE profiles SET role = 'admin', full_name = 'TEST Author'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_create_post('TEST post one', ARRAY['LinkedIn'], NULL, NULL, NULL, NULL) INTO out;
  PERFORM assert('a post is written', (out ->> 'id') IS NOT NULL, out::TEXT);
  PERFORM assert('an administrator writes an approved post',
    out ->> 'status' = 'approved', out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a post is written', FALSE, SQLERRM);
END
$$;

SELECT assert('the author is whoever wrote it, not whoever asked for it',
  (SELECT created_by FROM social_posts WHERE content = 'TEST post one') = 'TEST Author',
  (SELECT created_by FROM social_posts WHERE content = 'TEST post one'));

SELECT assert('it goes out on the platform the sentence named',
  (SELECT platform FROM social_posts WHERE content = 'TEST post one') = ARRAY['LinkedIn'],
  (SELECT platform::TEXT FROM social_posts WHERE content = 'TEST post one'));

-- A date nobody picked is today, which is what the composer defaults to.
SELECT assert('and it is dated today when nobody said',
  (SELECT scheduled_date FROM social_posts WHERE content = 'TEST post one') = CURRENT_DATE,
  (SELECT scheduled_date::TEXT FROM social_posts WHERE content = 'TEST post one'));

DO $$
BEGIN
  PERFORM command_create_post('   ', NULL, NULL, NULL, NULL, NULL);
  PERFORM assert('an empty post is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an empty post is refused', SQLERRM LIKE '%nothing in it%', SQLERRM);
END
$$;

-- A marketer writes, and their post waits for approval. Nothing in the
-- sentence can change that, because the function reads the role.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'marketer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_create_post('TEST post two', NULL, NULL, NULL, NULL, NULL) INTO out;
  PERFORM assert('a marketer writes a post that waits for approval',
    out ->> 'status' = 'pending_review', out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a marketer writes a post that waits for approval', FALSE, SQLERRM);
END
$$;

SELECT assert('naming no platform means the two the composer starts with',
  (SELECT platform FROM social_posts WHERE content = 'TEST post two')
    = ARRAY['Facebook', 'LinkedIn'],
  (SELECT platform::TEXT FROM social_posts WHERE content = 'TEST post two'));

-- A sales rep has no marketing.edit at all.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'sales' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_create_post('TEST post three', NULL, NULL, NULL, NULL, NULL);
  PERFORM assert('a sales rep cannot write a post', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a sales rep cannot write a post', SQLERRM LIKE '%marketing.edit%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

-- Through the programme runner, which is the path the command bar takes.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(jsonb_build_array(jsonb_build_object(
    'op', 'invoke',
    'capability', 'post.create',
    'subjects', '[]'::JSONB,
    'args', jsonb_build_object('content', 'TEST post four', 'platform', 'LinkedIn,X')
  ))) INTO out;
  PERFORM assert('a programme can write a post', (out ->> 'changed')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a programme can write a post', FALSE, SQLERRM);
END
$$;

SELECT assert('with both platforms it named',
  (SELECT platform FROM social_posts WHERE content = 'TEST post four')
    = ARRAY['LinkedIn', 'X'],
  (SELECT platform::TEXT FROM social_posts WHERE content = 'TEST post four'));

DELETE FROM social_posts WHERE content LIKE 'TEST post %';

-- =============================================================
-- 15. Importing a spreadsheet
--
-- Migration 023. The file never reaches the database: what gets here is
-- rows already checked against the import dictionary. What this proves
-- is the half a route could not: five thousand rows either all arrive or
-- none do, the list is resolved by name inside the same transaction, and
-- a column the import may not write is refused rather than written.
-- =============================================================
\echo '--- import ---'

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

DELETE FROM crm_contacts WHERE source = 'Spreadsheet import';
DELETE FROM crm_lists WHERE name = 'TEST import list';
INSERT INTO crm_lists (id, name, owner_id, is_global)
VALUES ('c1111111-0000-0000-0000-000000000001', 'TEST import list',
        'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Dawson', 'email', 'sam@dawson.co.uk',
                       'source', 'Spreadsheet import', 'status', 'lead'),
    jsonb_build_object('company_name', 'TEST Ward', 'email', 'lisa@ward.co.uk',
                       'source', 'Spreadsheet import', 'status', 'lead')
  ), 'TEST import list') INTO out;
  PERFORM assert('a file is imported', (out ->> 'inserted')::INT = 2, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a file is imported', FALSE, SQLERRM);
END
$$;

SELECT assert('onto the list it was named for',
  (SELECT COUNT(*) FROM crm_contacts
    WHERE list_id = 'c1111111-0000-0000-0000-000000000001') = 2,
  (SELECT COUNT(*)::TEXT FROM crm_contacts
    WHERE list_id = 'c1111111-0000-0000-0000-000000000001'));

DO $$
BEGIN
  PERFORM command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Never', 'source', 'Spreadsheet import')
  ), 'a list nobody has');
  PERFORM assert('a list that is not there is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list that is not there is refused', SQLERRM LIKE '%no list called%', SQLERRM);
END
$$;

-- A name that fits two lists is a question, not a reason to take
-- whichever one the planner happened to return first.
INSERT INTO crm_lists (id, name, owner_id, is_global)
VALUES ('c1111111-0000-0000-0000-000000000002', 'test import list',
        'aaaaaaaa-0000-0000-0000-000000000001', FALSE)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Ambiguous', 'source', 'Spreadsheet import')
  ), 'TEST import list');
  PERFORM assert('a name that fits two lists is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a name that fits two lists is refused',
    SQLERRM LIKE '%not clear which one%', SQLERRM);
END
$$;

SELECT assert('and nothing was imported into either',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST Ambiguous') = 0);

-- By id, which is what the screen has and what the manual route sends.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST By Id', 'source', 'Spreadsheet import')
  ), NULL, 'c1111111-0000-0000-0000-000000000002') INTO out;
  PERFORM assert('a list named by id is used', (out ->> 'inserted')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list named by id is used', FALSE, SQLERRM);
END
$$;

SELECT assert('on that exact list',
  (SELECT list_id FROM crm_contacts WHERE company_name = 'TEST By Id')
    = 'c1111111-0000-0000-0000-000000000002',
  (SELECT list_id::TEXT FROM crm_contacts WHERE company_name = 'TEST By Id'));

DELETE FROM crm_lists WHERE id = 'c1111111-0000-0000-0000-000000000002';

-- Every row or none. The second row has no company name, which the
-- preparer would have dropped; if one reaches here the whole import
-- fails rather than filing half a file.
DO $$
BEGIN
  PERFORM command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Half', 'source', 'Spreadsheet import'),
    jsonb_build_object('company_name', '', 'source', 'Spreadsheet import')
  ), 'TEST import list');
  PERFORM assert('a row with no company name fails the whole import', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a row with no company name fails the whole import',
    SQLERRM LIKE '%no company name%', SQLERRM);
END
$$;

SELECT assert('and the row before it did not arrive',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST Half') = 0,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name = 'TEST Half'));

-- A column the import may not write is refused rather than written.
-- `commission` is a real column and not one a spreadsheet gets to set.
DO $$
BEGIN
  PERFORM command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Sneaky', 'made_up_column', 'x')
  ), 'TEST import list');
  PERFORM assert('a column the import may not write is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a column the import may not write is refused',
    SQLERRM LIKE '%not a column it may write%', SQLERRM);
END
$$;

-- Through the programme runner, which is the path the command bar takes.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(jsonb_build_array(jsonb_build_object(
    'op', 'invoke',
    'capability', 'rows.import',
    'subjects', '[]'::JSONB,
    'args', jsonb_build_object(
      'list', 'TEST import list',
      'rows', jsonb_build_array(jsonb_build_object(
        'company_name', 'TEST Programme', 'source', 'Spreadsheet import')))
  ))) INTO out;
  PERFORM assert('a programme can import', (out ->> 'changed')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a programme can import', FALSE, SQLERRM);
END
$$;

-- A viewer, straight at the function.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_import_contacts(jsonb_build_array(
    jsonb_build_object('company_name', 'TEST Viewer', 'source', 'Spreadsheet import')
  ), NULL);
  PERFORM assert('a viewer cannot import', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer cannot import', SQLERRM LIKE '%crm.import%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM crm_contacts WHERE source = 'Spreadsheet import';
DELETE FROM crm_lists WHERE name = 'TEST import list';

-- =============================================================
-- 15e. A CRM customer, onto your own tracker
--
-- Migration 033. The screen sent its own list id, so the payload
-- decided whose tracker gained a deal. It is decided from who is
-- asking, exactly as sending from stock is.
-- =============================================================
\echo '--- a customer onto the tracker ---'

DELETE FROM crm_contacts WHERE company_name = 'TEST Copied Co';
DELETE FROM crm_contacts WHERE company_name = 'TEST Source Co';

INSERT INTO crm_contacts (id, list_id, company_name, contact_name, status, source, side)
SELECT 'd3333333-0000-0000-0000-000000000001',
       (SELECT id FROM crm_lists WHERE is_global = TRUE LIMIT 1),
       'TEST Source Co', 'Sam Source', 'lead', 'Cold call', 'trailer_sales';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_tracker_from_crm(
    ARRAY['d3333333-0000-0000-0000-000000000001']::UUID[]) INTO out;
  PERFORM assert('a customer is copied onto the tracker',
    (out ->> 'made')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a customer is copied onto the tracker', FALSE, SQLERRM);
END
$$;

SELECT assert('onto the caller''s own tracker list',
  (SELECT COUNT(*) FROM crm_contacts c
     JOIN crm_lists l ON l.id = c.list_id
    WHERE c.company_name = 'TEST Source Co'
      AND l.owner_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND l.is_global = FALSE) = 1,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name = 'TEST Source Co'));

SELECT assert('and the original is still where it was',
  (SELECT COUNT(*) FROM crm_contacts c
     JOIN crm_lists l ON l.id = c.list_id
    WHERE c.id = 'd3333333-0000-0000-0000-000000000001' AND l.is_global = TRUE) = 1);

-- Somebody else's tracker is not a thing this operation does.
DO $$
BEGIN
  PERFORM command_tracker_from_crm(
    ARRAY['d3333333-0000-0000-0000-000000000001']::UUID[],
    'trailer_sales', NULL,
    'bbbbbbbb-0000-0000-0000-000000000002');
  PERFORM assert('somebody else''s tracker is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('somebody else''s tracker is refused',
    SQLERRM LIKE '%your own tracker%', SQLERRM);
END
$$;

-- A customer that is not there takes the whole call with it.
DO $$
BEGIN
  PERFORM command_tracker_from_crm(ARRAY[
    'd3333333-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff']::UUID[]);
  PERFORM assert('a customer that is not there fails the whole call', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a customer that is not there fails the whole call',
    SQLERRM LIKE '%but put%', SQLERRM);
END
$$;

SELECT assert('and the one that was there did not arrive twice',
  (SELECT COUNT(*) FROM crm_contacts WHERE company_name = 'TEST Source Co') = 2,
  (SELECT COUNT(*)::TEXT FROM crm_contacts WHERE company_name = 'TEST Source Co'));

DELETE FROM crm_contacts WHERE company_name = 'TEST Source Co';

-- =============================================================
-- 15d. Sharing a list somebody named
--
-- Migration 032. Sharing is list membership, so a named list needs no
-- records at all. The list is resolved exactly: none refuses by name,
-- one is used, several asks.
-- =============================================================
\echo '--- sharing a named list ---'

DELETE FROM crm_list_members WHERE list_id IN
  (SELECT id FROM crm_lists WHERE name LIKE 'TEST share%');
DELETE FROM crm_lists WHERE name LIKE 'TEST share%';

INSERT INTO crm_lists (id, name, owner_id, is_global)
VALUES ('c2222222-0000-0000-0000-000000000001', 'TEST share list',
        'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_share_named_list(
    'TEST share list',
    ARRAY['bbbbbbbb-0000-0000-0000-000000000002']::UUID[]) INTO out;
  PERFORM assert('a list is shared by name', (out ->> 'granted')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list is shared by name', FALSE, SQLERRM);
END
$$;

SELECT assert('and the grant is on that list',
  (SELECT COUNT(*) FROM crm_list_members
    WHERE list_id = 'c2222222-0000-0000-0000-000000000001') = 1,
  (SELECT COUNT(*)::TEXT FROM crm_list_members
    WHERE list_id = 'c2222222-0000-0000-0000-000000000001'));

-- Sharing again with the same person is the access they already had.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_share_named_list(
    'TEST share list',
    ARRAY['bbbbbbbb-0000-0000-0000-000000000002']::UUID[]) INTO out;
  PERFORM assert('sharing twice grants nothing twice',
    (out ->> 'granted')::INT = 0 AND (out ->> 'alreadyHad')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('sharing twice grants nothing twice', FALSE, SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_share_named_list(
    'a list nobody has', ARRAY['bbbbbbbb-0000-0000-0000-000000000002']::UUID[]);
  PERFORM assert('a list that is not there is refused by name', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a list that is not there is refused by name',
    SQLERRM LIKE '%no list called%', SQLERRM);
END
$$;

-- A name that fits two lists is a question, not a reason to take one.
INSERT INTO crm_lists (id, name, owner_id, is_global)
VALUES ('c2222222-0000-0000-0000-000000000002', 'test share list',
        'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_share_named_list(
    'TEST share list', ARRAY['cccccccc-0000-0000-0000-00000000000c']::UUID[]);
  PERFORM assert('a name that fits two lists is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a name that fits two lists is refused',
    SQLERRM LIKE '%not clear which one%', SQLERRM);
END
$$;

SELECT assert('and neither of them was shared',
  (SELECT COUNT(*) FROM crm_list_members
    WHERE user_id = 'cccccccc-0000-0000-0000-00000000000c'
      AND list_id IN ('c2222222-0000-0000-0000-000000000001',
                      'c2222222-0000-0000-0000-000000000002')) = 0);

DELETE FROM crm_lists WHERE id = 'c2222222-0000-0000-0000-000000000002';

-- Somebody who is not here stops the whole grant.
DO $$
BEGIN
  PERFORM command_share_named_list('TEST share list', ARRAY[
    'cccccccc-0000-0000-0000-00000000000c',
    'ffffffff-ffff-ffff-ffff-ffffffffffff']::UUID[]);
  PERFORM assert('a person who is not here stops the whole share', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a person who is not here stops the whole share',
    SQLERRM LIKE '%only % of them are here%', SQLERRM);
END
$$;

SELECT assert('and the one who is here got nothing',
  (SELECT COUNT(*) FROM crm_list_members
    WHERE list_id = 'c2222222-0000-0000-0000-000000000001'
      AND user_id = 'cccccccc-0000-0000-0000-00000000000c') = 0);

-- Through the programme runner, which is the path the command bar takes.
DELETE FROM crm_list_members WHERE list_id = 'c2222222-0000-0000-0000-000000000001';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(jsonb_build_array(jsonb_build_object(
    'op', 'invoke',
    'capability', 'list.share',
    'subjects', '[]'::JSONB,
    'args', jsonb_build_object(
      'list', 'TEST share list',
      'users', jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000002'))
  ))) INTO out;
  PERFORM assert('a programme can share a named list', (out ->> 'changed')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a programme can share a named list', FALSE, SQLERRM);
END
$$;

-- A viewer, straight at the function.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_share_named_list(
    'TEST share list', ARRAY['bbbbbbbb-0000-0000-0000-000000000002']::UUID[]);
  PERFORM assert('a viewer cannot share a list', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer cannot share a list', SQLERRM LIKE '%crm.manageLists%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM crm_list_members WHERE list_id = 'c2222222-0000-0000-0000-000000000001';
DELETE FROM crm_lists WHERE name LIKE 'TEST share%';

-- =============================================================
-- 15c. Loading a supplier's stock file
--
-- Migration 031. The stock screen's import button used to write from
-- the browser, which put the allowlist and the permission in code
-- somebody can edit in a console. Both callers land here now, so every
-- unit or none from either.
-- =============================================================
\echo '--- stock import ---'

DELETE FROM stock_trailers WHERE stc_no LIKE 'TESTSYNC%';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_import_stock(jsonb_build_array(
    jsonb_build_object('stc_no', 'TESTSYNC001', 'make', 'Schmitz', 'model', 'Curtainsider'),
    jsonb_build_object('stc_no', 'TESTSYNC002', 'make', 'SDC', 'model', 'Box')
  )) INTO out;
  PERFORM assert('a supplier file is loaded', (out ->> 'inserted')::INT = 2, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a supplier file is loaded', FALSE, SQLERRM);
END
$$;

SELECT assert('and the units start in stock',
  (SELECT COUNT(*) FROM stock_trailers
    WHERE stc_no LIKE 'TESTSYNC%' AND status = 'in_stock') = 2,
  (SELECT COUNT(*)::TEXT FROM stock_trailers WHERE stc_no LIKE 'TESTSYNC%'));

-- Every unit or none. A row with no stock number cannot be found again,
-- so one reaching here fails the file rather than loading half of it.
DO $$
BEGIN
  PERFORM command_import_stock(jsonb_build_array(
    jsonb_build_object('stc_no', 'TESTSYNC003', 'make', 'Krone'),
    jsonb_build_object('stc_no', '', 'make', 'Krone')
  ));
  PERFORM assert('a row with no stock number fails the whole file', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a row with no stock number fails the whole file',
    SQLERRM LIKE '%no stock number%', SQLERRM);
END
$$;

SELECT assert('and the row before it did not arrive',
  (SELECT COUNT(*) FROM stock_trailers WHERE stc_no = 'TESTSYNC003') = 0,
  (SELECT COUNT(*)::TEXT FROM stock_trailers WHERE stc_no = 'TESTSYNC003'));

-- A column the import may not write. `profit` is derived from the sale
-- price and the book value, and a spreadsheet does not get to set it.
DO $$
BEGIN
  PERFORM command_import_stock(jsonb_build_array(
    jsonb_build_object('stc_no', 'TESTSYNC004', 'profit', 12345)
  ));
  PERFORM assert('a column the stock import may not write is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a column the stock import may not write is refused',
    SQLERRM LIKE '%not a column it may write%', SQLERRM);
END
$$;

-- Through the programme runner, which is the path the command bar takes.
DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_perform(jsonb_build_array(jsonb_build_object(
    'op', 'invoke',
    'capability', 'stock.import',
    'subjects', '[]'::JSONB,
    'args', jsonb_build_object('rows', jsonb_build_array(
      jsonb_build_object('stc_no', 'TESTSYNC005', 'make', 'Montracon')))
  ))) INTO out;
  PERFORM assert('a programme can load stock', (out ->> 'changed')::INT = 1, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a programme can load stock', FALSE, SQLERRM);
END
$$;

-- A viewer, straight at the function.
SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_import_stock(jsonb_build_array(
    jsonb_build_object('stc_no', 'TESTSYNC006')
  ));
  PERFORM assert('a viewer cannot load stock', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer cannot load stock', SQLERRM LIKE '%stock.edit%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM stock_trailers WHERE stc_no LIKE 'TESTSYNC%';

-- =============================================================
-- 15a. The parts of a customer that are not columns on it
--
-- Migration 029. Sites, links and twinned accounts, all of which had
-- buttons and no words.
-- =============================================================
\echo '--- customer details ---'

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST detail%';
INSERT INTO crm_contacts (id, company_name, status, source, relationship)
VALUES ('a4444444-0000-0000-0000-000000000001', 'TEST detail one', 'lead', 'manual', 'prospect'),
       ('a4444444-0000-0000-0000-000000000002', 'TEST detail two', 'lead', 'manual', 'prospect')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_add_address('a4444444-0000-0000-0000-000000000001',
    '4 Ashton Road, Hyde', 'Yard', FALSE) INTO out;
  PERFORM assert('a site is added', (out ->> 'id') IS NOT NULL, out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a site is added', FALSE, SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_add_address('a4444444-0000-0000-0000-000000000001',
    '9 Bredbury Way', 'Depot', FALSE);
  PERFORM command_primary_address('a4444444-0000-0000-0000-000000000001', 'Bredbury');
  PERFORM assert('one of them becomes the main one', TRUE);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('one of them becomes the main one', FALSE, SQLERRM);
END
$$;

SELECT assert('and only one is',
  (SELECT COUNT(*) FROM contact_addresses
    WHERE contact_id = 'a4444444-0000-0000-0000-000000000001' AND is_primary) = 1,
  (SELECT COUNT(*)::TEXT FROM contact_addresses
    WHERE contact_id = 'a4444444-0000-0000-0000-000000000001' AND is_primary));

DO $$
BEGIN
  PERFORM command_primary_address('a4444444-0000-0000-0000-000000000001', '');
  PERFORM assert('a reference that fits two addresses is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a reference that fits two addresses is refused',
    SQLERRM LIKE '%not clear which one%', SQLERRM);
END
$$;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_add_link('a4444444-0000-0000-0000-000000000001',
    'linkedin.com/company/test', NULL, NULL) INTO out;
  PERFORM assert('a link is added', out ->> 'kind' = 'linkedin', out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a link is added', FALSE, SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_add_link('a4444444-0000-0000-0000-000000000001',
    'https://linkedin.com/company/test', NULL, NULL);
  PERFORM assert('the same link twice is refused', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('the same link twice is refused', SQLERRM LIKE '%already on the account%', SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_remove_link('a4444444-0000-0000-0000-000000000001', 'linkedin');
  PERFORM assert('and it can be taken off again', TRUE);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('and it can be taken off again', FALSE, SQLERRM);
END
$$;

SELECT assert('leaving none behind',
  (SELECT jsonb_array_length(COALESCE(links, '[]'::JSONB)) FROM crm_contacts
    WHERE id = 'a4444444-0000-0000-0000-000000000001') = 0,
  (SELECT links::TEXT FROM crm_contacts WHERE id = 'a4444444-0000-0000-0000-000000000001'));

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_link_accounts('a4444444-0000-0000-0000-000000000002',
    'a4444444-0000-0000-0000-000000000001') INTO out;
  PERFORM assert('two accounts are linked', out ->> 'to' = 'TEST detail one', out::TEXT);
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('two accounts are linked', FALSE, SQLERRM);
END
$$;

DO $$
BEGIN
  PERFORM command_link_accounts('a4444444-0000-0000-0000-000000000001',
    'a4444444-0000-0000-0000-000000000001');
  PERFORM assert('an account cannot be linked to itself', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('an account cannot be linked to itself', SQLERRM LIKE '%to itself%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'viewer' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DO $$
BEGIN
  PERFORM command_add_address('a4444444-0000-0000-0000-000000000001', 'Anywhere', NULL, FALSE);
  PERFORM assert('a viewer adds nothing', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a viewer adds nothing', SQLERRM LIKE '%crm.edit%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', '', FALSE);
SELECT keep_an_admin();
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);

DELETE FROM crm_contacts WHERE company_name LIKE 'TEST detail%';

-- =============================================================
-- 15b. Paid work that is bought once
--
-- Migration 027. Lusha cannot join a transaction, so the purchase is
-- recorded before it happens and consumed from the record. What this
-- proves is the ledger's own contract: a key is claimed once, settled
-- once, and returns what was bought to whoever bought it.
-- =============================================================
\echo '--- external attempts ---'

DELETE FROM command_external_attempts WHERE key LIKE 'test-%';

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_external_begin('test-key-1', 'contact.enrich',
    'a2222222-0000-0000-0000-000000000001', 'email') INTO out;
  PERFORM assert('a new attempt is pending', out ->> 'state' = 'pending', out::TEXT);
END
$$;

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_external_begin('test-key-1', 'contact.enrich',
    'a2222222-0000-0000-0000-000000000001', 'email') INTO out;
  PERFORM assert('claiming it again finds the same one', out ->> 'state' = 'pending', out::TEXT);
END
$$;

SELECT assert('and there is one row, not two',
  (SELECT COUNT(*) FROM command_external_attempts WHERE key = 'test-key-1') = 1);

SELECT command_external_finish('test-key-1', TRUE,
  jsonb_build_object('fields', jsonb_build_object('phone', '0161 000 0001')), NULL);

DO $$
DECLARE out JSONB;
BEGIN
  SELECT command_external_begin('test-key-1', 'contact.enrich',
    'a2222222-0000-0000-0000-000000000001', 'email') INTO out;
  PERFORM assert('a settled attempt comes back done', out ->> 'state' = 'done', out::TEXT);
  PERFORM assert('with what was bought',
    out -> 'result' -> 'fields' ->> 'phone' = '0161 000 0001', out::TEXT);
END
$$;

-- Settling twice does not overwrite what was bought.
SELECT command_external_finish('test-key-1', FALSE, NULL, 'a later failure');
SELECT assert('a settled attempt stays settled',
  (SELECT state FROM command_external_attempts WHERE key = 'test-key-1') = 'done',
  (SELECT state FROM command_external_attempts WHERE key = 'test-key-1'));

-- Somebody else's purchase is not yours to read or to settle.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', FALSE);

DO $$
BEGIN
  PERFORM command_external_begin('test-key-1', 'contact.enrich',
    'a2222222-0000-0000-0000-000000000001', 'email');
  PERFORM assert('somebody else cannot claim your attempt', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('somebody else cannot claim your attempt',
    SQLERRM LIKE '%belongs to somebody else%', SQLERRM);
END
$$;

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', FALSE);
DELETE FROM command_external_attempts WHERE key LIKE 'test-%';

-- =============================================================
-- 16. The allowlist matches the registry
-- =============================================================
\echo '--- allowlist size ---'
SELECT assert('the seed loaded',
  (SELECT COUNT(*) FROM command_writable_columns) = 103,
  (SELECT COUNT(*)::TEXT FROM command_writable_columns));

SELECT reset_fixtures();
\echo '--- done ---'
