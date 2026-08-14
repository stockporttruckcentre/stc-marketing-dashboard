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
UPDATE profiles SET role = 'sales' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
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
-- 7. The allowlist matches the registry
-- =============================================================
\echo '--- allowlist size ---'
SELECT assert('the seed loaded',
  (SELECT COUNT(*) FROM command_writable_columns) = 103,
  (SELECT COUNT(*)::TEXT FROM command_writable_columns));

SELECT reset_fixtures();
\echo '--- done ---'
