-- =============================================================
-- FleetSmart+, and the four things it must never let happen.
--
-- 1. A price a browser chose. `annual_total` and `monthly_total` are
--    read off `priced` by a trigger, so a request that posts its own
--    totals alongside a snapshot has them thrown away.
-- 2. A contract sent twice. The second send is a different price
--    landing on a customer who already has one.
-- 3. A sent contract quietly edited. The number is out there.
-- 4. Somebody without the permission doing any of it.
--
-- Everything below the ROLE line runs as `authenticated`. That is not
-- decoration: `postgres` owns these tables and owners bypass row level
-- security, so a file that stays superuser would write every row it
-- claims to have blocked and report a read only viewer selling a
-- maintenance contract.
--
-- Run with `npm run check:fleetsmart`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- The people. Deliberately on the legacy path, no role template,
-- because that is every account in the live database.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('ff000000-0000-0000-0000-000000000001', 'fs.admin@example.test'),
  ('ff000000-0000-0000-0000-000000000002', 'fs.sales@example.test'),
  ('ff000000-0000-0000-0000-000000000003', 'fs.marketer@example.test'),
  ('ff000000-0000-0000-0000-000000000004', 'fs.viewer@example.test'),
  ('ff000000-0000-0000-0000-000000000005', 'fs.other.sales@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',    role_template_id = NULL WHERE id = 'ff000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',    role_template_id = NULL WHERE id = 'ff000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'marketer', role_template_id = NULL WHERE id = 'ff000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'viewer',   role_template_id = NULL WHERE id = 'ff000000-0000-0000-0000-000000000004';
UPDATE profiles SET role = 'sales',    role_template_id = NULL WHERE id = 'ff000000-0000-0000-0000-000000000005';

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ff000000-%') <> 5 THEN
    RAISE EXCEPTION 'fixture: expected five people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ff000000-%');
  END IF;
  IF (SELECT count(*) FROM command_capability_roles WHERE capability LIKE 'fleetsmart.%') = 0 THEN
    RAISE EXCEPTION
      'fixture: the seed carries no fleetsmart capabilities, so every assertion below is testing nothing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

-- A customer to point at, so the foreign key is exercised rather than
-- left null on every row.
INSERT INTO crm_contacts (id, company_name)
VALUES ('ff000000-0000-0000-0000-0000000000c1', 'Fleetsmart Check Haulage')
ON CONFLICT DO NOTHING;

-- What a real snapshot looks like, cut down to the fields the trigger
-- and the screen read. Two assets, so `asset_count` has something to be
-- wrong about.
CREATE OR REPLACE FUNCTION pg_temp.snapshot(p_annual NUMERIC, p_assets INT)
RETURNS JSONB LANGUAGE sql AS $fn$
  SELECT jsonb_build_object(
    'annual',  p_annual,
    'monthly', round(p_annual / 12, 2),
    'weekly',  round(p_annual / 52, 2),
    'assets',  COALESCE((SELECT jsonb_agg(jsonb_build_object('key', 'a' || i, 'reg', 'REG' || i))
                           FROM generate_series(1, p_assets) AS i), '[]'::JSONB)
  );
$fn$;

SET LOCAL ROLE authenticated;

-- =============================================================
-- 1. Who holds what.
--
-- Asserted directly, in both directions, before anything is written.
-- The capability seed is generated from `lib/crm/permissions.ts`, and
-- these are the four grants that file promises.
-- =============================================================
DO $$
DECLARE
  cases TEXT[][] := ARRAY[
    ['ff000000-0000-0000-0000-000000000001', 'admin',    'fleetsmart.view',     'yes'],
    ['ff000000-0000-0000-0000-000000000001', 'admin',    'fleetsmart.build',    'yes'],
    ['ff000000-0000-0000-0000-000000000001', 'admin',    'fleetsmart.send',     'yes'],
    ['ff000000-0000-0000-0000-000000000001', 'admin',    'fleetsmart.discount', 'yes'],
    ['ff000000-0000-0000-0000-000000000002', 'sales',    'fleetsmart.view',     'yes'],
    ['ff000000-0000-0000-0000-000000000002', 'sales',    'fleetsmart.build',    'yes'],
    ['ff000000-0000-0000-0000-000000000002', 'sales',    'fleetsmart.send',     'yes'],
    ['ff000000-0000-0000-0000-000000000002', 'sales',    'fleetsmart.discount', 'no'],
    ['ff000000-0000-0000-0000-000000000003', 'marketer', 'fleetsmart.view',     'yes'],
    ['ff000000-0000-0000-0000-000000000003', 'marketer', 'fleetsmart.build',    'no'],
    ['ff000000-0000-0000-0000-000000000003', 'marketer', 'fleetsmart.send',     'no'],
    ['ff000000-0000-0000-0000-000000000004', 'viewer',   'fleetsmart.view',     'yes'],
    ['ff000000-0000-0000-0000-000000000004', 'viewer',   'fleetsmart.build',    'no'],
    ['ff000000-0000-0000-0000-000000000004', 'viewer',   'fleetsmart.send',     'no'],
    ['ff000000-0000-0000-0000-000000000004', 'viewer',   'fleetsmart.discount', 'no']
  ];
  c   TEXT[];
  got BOOLEAN;
BEGIN
  FOREACH c SLICE 1 IN ARRAY cases LOOP
    PERFORM pg_temp.act_as(c[1]::UUID);
    SELECT command_may(c[3]) INTO got;
    IF got <> (c[4] = 'yes') THEN
      RAISE EXCEPTION 'a % has command_may(%) = %, wanted %', c[2], c[3], got, c[4];
    END IF;
  END LOOP;
  RAISE NOTICE 'ok  capabilities: sales builds and sends, and cannot discount';
END $$;

-- =============================================================
-- 2. Building one.
-- =============================================================

-- A viewer cannot.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000004');
  BEGIN
    INSERT INTO fleetsmart_contracts (customer_name, created_by, owner_id, priced)
    VALUES ('Should Not Exist Ltd', 'ff000000-0000-0000-0000-000000000004',
            'ff000000-0000-0000-0000-000000000004', pg_temp.snapshot(1200, 1));
    RAISE EXCEPTION 'a read only viewer built a maintenance contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a viewer cannot build a contract';
  END;
END $$;

-- Nor can a marketer, who can see the screen.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000003');
  BEGIN
    INSERT INTO fleetsmart_contracts (customer_name, created_by, owner_id, priced)
    VALUES ('Should Not Exist Ltd', 'ff000000-0000-0000-0000-000000000003',
            'ff000000-0000-0000-0000-000000000003', pg_temp.snapshot(1200, 1));
    RAISE EXCEPTION 'a marketer built a maintenance contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a marketer cannot build a contract';
  END;
END $$;

-- Nor can anybody build one in somebody else's name.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  BEGIN
    INSERT INTO fleetsmart_contracts (customer_name, created_by, owner_id, priced)
    VALUES ('Not Mine Ltd', 'ff000000-0000-0000-0000-000000000005',
            'ff000000-0000-0000-0000-000000000005', pg_temp.snapshot(1200, 1));
    RAISE EXCEPTION 'a contract was created in somebody else''s name';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a contract cannot be created in somebody else''s name';
  END;
END $$;

-- A salesman can, and the reference writes itself.
DO $$
DECLARE got TEXT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  INSERT INTO fleetsmart_contracts
    (id, account_id, customer_name, plan, term_months, created_by, owner_id, input, priced)
  VALUES
    ('ff000000-0000-0000-0000-0000000000a1', 'ff000000-0000-0000-0000-0000000000c1',
     'Fleetsmart Check Haulage', 'Platinum', 36,
     'ff000000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-000000000002',
     '{"plan":"Platinum"}'::JSONB, pg_temp.snapshot(14400, 2));

  SELECT ref INTO got FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a1';
  IF got IS NULL OR got !~ '^FS-[0-9]+$' THEN
    RAISE EXCEPTION 'the reference did not write itself, got %', COALESCE(got, 'null');
  END IF;
  RAISE NOTICE 'ok  a salesman builds one and it takes a reference: %', got;
END $$;

-- =============================================================
-- 3. The totals are read off the snapshot, never accepted alongside it.
--
-- This is the assertion the trigger exists for. A request posting a
-- £14,400 snapshot and a £14 total gets £14,400, because the snapshot
-- is what the server priced and the columns are only a copy of it.
-- =============================================================
DO $$
DECLARE a NUMERIC; m NUMERIC; n INT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  INSERT INTO fleetsmart_contracts
    (id, customer_name, created_by, owner_id, priced, annual_total, monthly_total, asset_count)
  VALUES
    ('ff000000-0000-0000-0000-0000000000a2', 'Cheeky Browser Ltd',
     'ff000000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-000000000002',
     pg_temp.snapshot(14400, 3), 14, 1, 99);

  SELECT annual_total, monthly_total, asset_count INTO a, m, n
    FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a2';

  IF a <> 14400 THEN
    RAISE EXCEPTION 'the annual total came from the request rather than the snapshot: %', a;
  END IF;
  IF m <> 1200 THEN
    RAISE EXCEPTION 'the monthly total came from the request rather than the snapshot: %', m;
  END IF;
  IF n <> 3 THEN
    RAISE EXCEPTION 'the asset count came from the request rather than the snapshot: %', n;
  END IF;
  RAISE NOTICE 'ok  a posted total is thrown away and the snapshot wins';
END $$;

-- =============================================================
-- 4. Sending.
-- =============================================================

-- A contract with nothing on it has nothing to send.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  INSERT INTO fleetsmart_contracts (id, customer_name, created_by, owner_id, priced)
  VALUES ('ff000000-0000-0000-0000-0000000000a3', 'Empty Fleet Ltd',
          'ff000000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-000000000002',
          pg_temp.snapshot(0, 0));
  BEGIN
    PERFORM fleetsmart_send('ff000000-0000-0000-0000-0000000000a3', 'them@example.test');
    RAISE EXCEPTION 'a contract with no assets on it was sent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%no assets%' THEN
      RAISE NOTICE 'ok  a contract with no assets cannot be sent';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- A viewer cannot send somebody else's contract, or any contract.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000004');
  BEGIN
    PERFORM fleetsmart_send('ff000000-0000-0000-0000-0000000000a1', 'them@example.test');
    RAISE EXCEPTION 'a read only viewer sent a contract to a customer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%send permission%' THEN
      RAISE NOTICE 'ok  a viewer cannot send a contract';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- A salesman can, once.
DO $$
DECLARE st TEXT; at_ TIMESTAMPTZ; to_ TEXT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  PERFORM fleetsmart_send('ff000000-0000-0000-0000-0000000000a1', 'buyer@example.test');

  SELECT status, sent_at, sent_to INTO st, at_, to_
    FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a1';
  IF st <> 'sent' OR at_ IS NULL OR to_ <> 'buyer@example.test' THEN
    RAISE EXCEPTION 'sending did not stamp the record: % % %', st, at_, to_;
  END IF;
  RAISE NOTICE 'ok  sending stamps who it went to and when';

  BEGIN
    PERFORM fleetsmart_send('ff000000-0000-0000-0000-0000000000a1', 'buyer@example.test');
    RAISE EXCEPTION 'the same contract was sent to the customer twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%Build a new one%' THEN
      RAISE NOTICE 'ok  the same contract cannot go out twice';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- =============================================================
-- 5. A sent contract is frozen, and cannot be thrown away.
-- =============================================================
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');

  UPDATE fleetsmart_contracts SET customer_name = 'Quietly Changed Ltd'
    WHERE id = 'ff000000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a salesman edited a contract that is already with the customer';
  END IF;
  RAISE NOTICE 'ok  a sent contract cannot be edited by the person who built it';

  DELETE FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a contract that has gone to a customer was deleted';
  END IF;
  RAISE NOTICE 'ok  a sent contract cannot be deleted';
END $$;

-- Somebody else's draft is not theirs to edit or delete either.
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000005');
  UPDATE fleetsmart_contracts SET customer_name = 'Not Yours Ltd'
    WHERE id = 'ff000000-0000-0000-0000-0000000000a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'one salesman edited another salesman''s draft';
  END IF;

  DELETE FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'one salesman deleted another salesman''s draft';
  END IF;
  RAISE NOTICE 'ok  a draft belongs to whoever built it';
END $$;

-- Their own draft, though, is theirs.
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  UPDATE fleetsmart_contracts SET customer_name = 'Renamed Ltd'
    WHERE id = 'ff000000-0000-0000-0000-0000000000a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'a salesman could not edit their own draft';
  END IF;
  RAISE NOTICE 'ok  a salesman can still edit their own draft';
END $$;

-- =============================================================
-- 6. Recording the answer.
-- =============================================================
DO $$
BEGIN
  -- A draft has not been answered, because it was never asked.
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM fleetsmart_decide('ff000000-0000-0000-0000-0000000000a2', 'accepted', NULL);
    RAISE EXCEPTION 'a draft nobody sent was recorded as accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%not been sent%' THEN
      RAISE NOTICE 'ok  a draft cannot be accepted';
    ELSE
      RAISE;
    END IF;
  END;

  -- A viewer cannot answer one either.
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000004');
  BEGIN
    PERFORM fleetsmart_decide('ff000000-0000-0000-0000-0000000000a1', 'accepted', NULL);
    RAISE EXCEPTION 'a read only viewer recorded a contract decision';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%cannot record a decision%' THEN
      RAISE NOTICE 'ok  a viewer cannot record a decision';
    ELSE
      RAISE;
    END IF;
  END;

  -- And there are only three answers.
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM fleetsmart_decide('ff000000-0000-0000-0000-0000000000a1', 'maybe', NULL);
    RAISE EXCEPTION 'a contract was recorded as "maybe"';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%accepted, declined or expired%' THEN
      RAISE NOTICE 'ok  a contract is accepted, declined or expired';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

DO $$
DECLARE st TEXT; d TIMESTAMPTZ; note TEXT;
BEGIN
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000002');
  PERFORM fleetsmart_decide('ff000000-0000-0000-0000-0000000000a1', 'accepted',
                            'Signed by the transport manager.');
  SELECT status, decided_at, decision_note INTO st, d, note
    FROM fleetsmart_contracts WHERE id = 'ff000000-0000-0000-0000-0000000000a1';
  IF st <> 'accepted' OR d IS NULL OR note IS NULL THEN
    RAISE EXCEPTION 'accepting did not stamp the record: % % %', st, d, note;
  END IF;
  RAISE NOTICE 'ok  accepting stamps the date and keeps the note';
END $$;

-- =============================================================
-- 7. Reading is wide, on purpose.
--
-- A colleague picking up a customer has to see what was already quoted
-- them. A contract nobody can find is a contract that gets built twice
-- at two different prices.
-- =============================================================
DO $$
DECLARE n INT;
BEGIN
  FOR n IN 1..1 LOOP END LOOP;
  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000004');
  SELECT count(*) INTO n FROM fleetsmart_contracts WHERE id::TEXT LIKE 'ff000000-%';
  IF n < 3 THEN
    RAISE EXCEPTION 'a viewer can see only % of the contracts on file', n;
  END IF;

  PERFORM pg_temp.act_as('ff000000-0000-0000-0000-000000000005');
  SELECT count(*) INTO n FROM fleetsmart_contracts WHERE id::TEXT LIKE 'ff000000-%';
  IF n < 3 THEN
    RAISE EXCEPTION 'one salesman can see only % of the other salesman''s contracts', n;
  END IF;
  RAISE NOTICE 'ok  everybody who can open the screen can read what was quoted';
END $$;

-- =============================================================
-- 8. The constraint that stops a contract being sent with no date.
-- =============================================================
RESET ROLE;
DO $$
BEGIN
  BEGIN
    INSERT INTO fleetsmart_contracts (customer_name, status, sent_at, priced)
    VALUES ('No Date Ltd', 'sent', NULL, pg_temp.snapshot(1200, 1));
    RAISE EXCEPTION 'a contract was marked as sent with no record of when';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  a contract cannot be sent without a date on it';
  END;
END $$;

ROLLBACK;
