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
-- Sharing in this CRM is list membership, so this asserts against
-- `crm_list_members` rather than against anything the command layer
-- believes about it. The two people are the ones the RLS section above
-- created, which is also why they have `profiles` rows: the project's
-- `handle_new_user` trigger copies an auth user into profiles.
-- -------------------------------------------------------------
DO $$
DECLARE list UUID; out JSONB;
BEGIN
  SELECT id INTO list FROM crm_lists WHERE name = 'TEST tipper prospects';

  SELECT command_share_list(list,
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID,
          'bbbbbbbb-0000-0000-0000-000000000002'::UUID], TRUE) INTO out;
  PERFORM assert('a list is shared with both colleagues', (out ->> 'granted')::INT = 2, out::TEXT);

  -- Sharing twice grants nothing more, which is what `idempotent` in
  -- the capability registry claims and this is what makes it true.
  SELECT command_share_list(list,
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
    ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::UUID,
          '00000000-0000-0000-0000-0000000000ff'::UUID], TRUE);
  PERFORM assert('a person who is not here fails the whole grant', FALSE, 'it succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM assert('a person who is not here fails the whole grant',
    SQLERRM LIKE '%only%are here%', SQLERRM);
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

DELETE FROM record_attachments WHERE filename LIKE 'TEST %';

-- =============================================================
-- 8. The allowlist matches the registry
-- =============================================================
\echo '--- allowlist size ---'
SELECT assert('the seed loaded',
  (SELECT COUNT(*) FROM command_writable_columns) = 103,
  (SELECT COUNT(*)::TEXT FROM command_writable_columns));

SELECT reset_fixtures();
\echo '--- done ---'
