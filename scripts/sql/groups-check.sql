-- =============================================================
-- Groups of customers, against real rows.
--
-- The business drew the line in one sentence:
--
--   an alpha makes an account unique. If dawson truck and dawson vans
--   were the same, we'd bind their alpha on protean, but they aren't
--   ... You can however add a grouping system, so we can see the total
--   of both holman accounts ... but also allow us to view the revenue
--   of each.
--
-- So there are two figures for every one of these companies and both
-- have to be right at once. The four things this must never let happen:
--
--   1. A group total that is not the sum of its members, which is what
--      a join fanning out over open jobs or a second invoice year gives
--      you, and which reads as plausible.
--   2. Grouping changing what any individual account billed.
--   3. Deleting a group taking a customer or an invoice with it.
--   4. Somebody without `crm.edit` moving a customer between groups,
--      or somebody without `crm.view` reading any of it.
--
-- Run with `npm run check:groups`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('90000000-0000-0000-0000-000000000001', 'grp.admin@example.test'),
  ('90000000-0000-0000-0000-000000000002', 'grp.viewer@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin', role_template_id = NULL, full_name = 'Group Admin'
 WHERE id = '90000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Group Viewer'
 WHERE id = '90000000-0000-0000-0000-000000000002';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role',
                     CASE WHEN p_who IS NULL THEN 'anon' ELSE 'authenticated' END, TRUE);
END;
$fn$;

-- -------------------------------------------------------------
-- Three Montgomery companies and two Holman accounts, as they really
-- arrive: three separate customers, and one customer with two alphas.
-- -------------------------------------------------------------
INSERT INTO crm_contacts (id, company_name, source, status) VALUES
  ('91000000-0000-0000-0000-000000000001', 'Montgomery Transport Limited', 'protean', 'won'),
  ('91000000-0000-0000-0000-000000000002', 'Montgomery Distribution Limited', 'protean', 'won'),
  ('91000000-0000-0000-0000-000000000003', 'Montgomery Tank Services Limited', 'protean', 'won'),
  ('91000000-0000-0000-0000-000000000004', 'Holman', 'protean', 'won')
ON CONFLICT (id) DO NOTHING;

INSERT INTO protean_accounts (alpha, protean_name, contact_id, bound_at) VALUES
  ('MONTTRAN', 'Montgomery Transport Limited',     '91000000-0000-0000-0000-000000000001', NOW()),
  ('MONTDIST', 'Montgomery Distribution Limited',  '91000000-0000-0000-0000-000000000002', NOW()),
  ('MONTTANK', 'Montgomery Tank Services Limited', '91000000-0000-0000-0000-000000000003', NOW()),
  ('ARIFLEET', 'Holman Fleet Limited',             '91000000-0000-0000-0000-000000000004', NOW()),
  ('ARIVMS',   'Holman Fleet Limited (VMS)',       '91000000-0000-0000-0000-000000000004', NOW())
ON CONFLICT (alpha) DO NOTHING;

/* Two years each, so the like for like cut is exercised rather than
   assumed, and more than one invoice per account so a fan out over the
   open jobs join would double a real number rather than a zero. */
/* Dated inside the company's year, which runs April to April. Every
   figure below is read at 1 August 2026, so the year running is the one
   that began 1 April 2026 and the comparison is the same point in the
   year that began 1 April 2025. */
INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net) VALUES
  /* T1 sits exactly on the read date on purpose: the window is
     inclusive of it, and an off by one there would drop a day's
     invoicing from every figure on every screen. */
  ('T1', 'MONTTRAN', '2026-08-01', 100000), ('T2', 'MONTTRAN', '2026-06-01', 21440),
  ('T3', 'MONTTRAN', '2025-05-01',  90000),
  ('D1', 'MONTDIST', '2026-05-01', 108110), ('D2', 'MONTDIST', '2025-05-01', 100000),
  ('K1', 'MONTTANK', '2026-05-01',  83355),
  ('H1', 'ARIFLEET', '2026-05-01',  50000), ('H2', 'ARIFLEET', '2026-07-01', 25000),
  ('V1', 'ARIVMS',   '2026-05-01',  30000),
  /* Last December. Inside the previous year and AFTER the same point in
     it, so it counts to neither figure. That is the like for like cut. */
  ('H3', 'ARIFLEET', '2025-12-01',  40000)
ON CONFLICT (invoice_no) DO NOTHING;

INSERT INTO protean_open_jobs (job_no, protean_name, alpha, job_total, still_open) VALUES
  ('J1', 'Montgomery Transport Limited', 'MONTTRAN', 5000, TRUE),
  ('J2', 'Montgomery Transport Limited', 'MONTTRAN', 2500, TRUE),
  ('J3', 'Holman Fleet Limited (VMS)',   'ARIVMS',   1000, TRUE),
  /* Closed, so it must not be counted anywhere. */
  ('J4', 'Holman Fleet Limited',         'ARIFLEET', 9999, FALSE)
ON CONFLICT (job_no) DO NOTHING;

-- -------------------------------------------------------------
-- 1. Grouping needs permission, and a viewer does not have it.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000002');
  BEGIN
    g := name_a_group('Montgomery');
    RAISE EXCEPTION 'a viewer made a group';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'a viewer made a group' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a viewer cannot make a customer group';
END $$;

-- -------------------------------------------------------------
-- 2. An administrator makes one, and making it twice makes one.
-- -------------------------------------------------------------
DO $$
DECLARE a UUID; b UUID;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  a := name_a_group('Montgomery');
  b := name_a_group('  montgomery ');
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'the same group was made twice, and every total it carries is now half';
  END IF;
  IF (SELECT count(*) FROM customer_groups WHERE lower(name) = 'montgomery') <> 1 THEN
    RAISE EXCEPTION 'there is more than one Montgomery group';
  END IF;
  RAISE NOTICE 'ok  a group is named once however many times it is asked for';
END $$;

-- -------------------------------------------------------------
-- 3. The total is the sum of the members, and each member is still
--    readable on its own.
--
--    The year from April 2026, read at 1 August: Transport 121,440 +
--    Distribution 108,110 + Tank 83,355 = 312,905. The same point in
--    the year from April 2025: 90,000 + 100,000 = 190,000. Holman is
--    deliberately in a different group so a stray join cannot pull it
--    in.
-- -------------------------------------------------------------
DO $$
DECLARE
  g UUID; h UUID;
  r RECORD;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  g := name_a_group('Montgomery');
  h := name_a_group('Holman Fleet');
  PERFORM put_in_group('91000000-0000-0000-0000-000000000001', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000002', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000003', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000004', h);

  SELECT * INTO r FROM group_revenue('2026-08-01') WHERE group_id = g;
  IF r.this_year <> 312905 THEN
    RAISE EXCEPTION 'Montgomery this year is %, not 312905', r.this_year;
  END IF;
  IF r.last_year <> 190000 THEN
    RAISE EXCEPTION 'Montgomery last year is %, not 190000', r.last_year;
  END IF;
  IF r.change <> 122905 THEN
    RAISE EXCEPTION 'Montgomery change is %, not 122905', r.change;
  END IF;
  IF r.customers <> 3 OR r.accounts <> 3 THEN
    RAISE EXCEPTION 'Montgomery has % customers over % accounts', r.customers, r.accounts;
  END IF;
  /* Two open jobs on one account, and the invoice join must not
     multiply them. */
  IF r.open_jobs <> 2 OR r.open_value <> 7500 THEN
    RAISE EXCEPTION 'Montgomery has % open jobs worth %', r.open_jobs, r.open_value;
  END IF;
  RAISE NOTICE 'ok  a group totals its members exactly, and open work is not multiplied by invoices';
END $$;

-- -------------------------------------------------------------
-- 4. One customer, two accounts. The group is the sum, and each
--    account is still separately visible.
--
--    Holman to 1 August 2026: ARIFLEET 75,000 + ARIVMS 30,000 =
--    105,000. The same point last year: nothing, because H3 is
--    December, which is after 1 August in its own year.
-- -------------------------------------------------------------
DO $$
DECLARE
  h UUID; r RECORD; fleet NUMERIC; vms NUMERIC; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  h := name_a_group('Holman Fleet');

  SELECT * INTO r FROM group_revenue('2026-08-01') WHERE group_id = h;
  IF r.this_year <> 105000 THEN
    RAISE EXCEPTION 'Holman this year is %, not 105000', r.this_year;
  END IF;
  IF r.last_year <> 0 THEN
    RAISE EXCEPTION 'Holman last year is %, and December is not before 1 August', r.last_year;
  END IF;
  IF r.customers <> 1 OR r.accounts <> 2 THEN
    RAISE EXCEPTION 'Holman is % customers over % accounts', r.customers, r.accounts;
  END IF;

  SELECT count(*) INTO n FROM group_breakdown(h, '2026-08-01');
  IF n <> 2 THEN RAISE EXCEPTION 'the Holman breakdown has % rows', n; END IF;

  SELECT this_year INTO fleet FROM group_breakdown(h, '2026-08-01') WHERE alpha = 'ARIFLEET';
  SELECT this_year INTO vms   FROM group_breakdown(h, '2026-08-01') WHERE alpha = 'ARIVMS';
  IF fleet <> 75000 OR vms <> 30000 THEN
    RAISE EXCEPTION 'the split is % and %, not 75000 and 30000', fleet, vms;
  END IF;
  IF fleet + vms <> r.this_year THEN
    RAISE EXCEPTION 'the two accounts do not add up to the group';
  END IF;
  RAISE NOTICE 'ok  two accounts on one customer total together and read apart';
END $$;

-- -------------------------------------------------------------
-- 5. The same split on the customer record itself, and a closed job
--    counted nowhere.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; n INTEGER; total NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  SELECT count(*), SUM(net) INTO n, total
    FROM protean_accounts_of('91000000-0000-0000-0000-000000000004');
  IF n <> 2 THEN RAISE EXCEPTION 'the Holman record shows % accounts', n; END IF;
  IF total <> 145000 THEN
    RAISE EXCEPTION 'the Holman record shows % across both years, not 145000', total;
  END IF;

  SELECT * INTO r FROM protean_accounts_of('91000000-0000-0000-0000-000000000004')
   WHERE alpha = 'ARIFLEET';
  IF r.open_jobs <> 0 OR r.open_value <> 0 THEN
    RAISE EXCEPTION 'a closed job is being counted as open work';
  END IF;
  RAISE NOTICE 'ok  a customer record can be taken apart by account, and a closed job counts nowhere';
END $$;

-- -------------------------------------------------------------
-- 6. Grouping changes nothing about what anybody billed.
-- -------------------------------------------------------------
DO $$
DECLARE before_total NUMERIC; after_total NUMERIC; g UUID;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  SELECT net INTO before_total FROM protean_spend('91000000-0000-0000-0000-000000000001')
   WHERE year = 2026;

  g := name_a_group('Somewhere Else Entirely');
  PERFORM put_in_group('91000000-0000-0000-0000-000000000001', g);

  SELECT net INTO after_total FROM protean_spend('91000000-0000-0000-0000-000000000001')
   WHERE year = 2026;
  IF before_total IS DISTINCT FROM after_total THEN
    RAISE EXCEPTION 'moving a customer between groups changed what they billed: % then %',
      before_total, after_total;
  END IF;

  /* Put them back where they belong. */
  PERFORM put_in_group('91000000-0000-0000-0000-000000000001', name_a_group('Montgomery'));
  RAISE NOTICE 'ok  a customer''s own revenue is untouched by which group they sit in';
END $$;

-- -------------------------------------------------------------
-- 7. Forgetting a group keeps every customer and every invoice.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID; freed INTEGER; people INTEGER; money NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  g := name_a_group('Montgomery');
  freed := forget_group(g);
  IF freed <> 3 THEN RAISE EXCEPTION 'forgetting the group freed % customers', freed; END IF;

  SELECT count(*) INTO people FROM crm_contacts
   WHERE id IN ('91000000-0000-0000-0000-000000000001',
                '91000000-0000-0000-0000-000000000002',
                '91000000-0000-0000-0000-000000000003');
  IF people <> 3 THEN RAISE EXCEPTION 'deleting a group took % customers with it', 3 - people; END IF;

  /* Both years, all three companies: 121,440 + 208,110 + 83,355. */
  SELECT SUM(net) INTO money FROM protean_invoices WHERE alpha LIKE 'MONT%';
  IF money <> 502905 THEN RAISE EXCEPTION 'invoices went missing: % remains', money; END IF;

  IF EXISTS (SELECT 1 FROM customer_groups WHERE id = g) THEN
    RAISE EXCEPTION 'the group is still there';
  END IF;
  RAISE NOTICE 'ok  forgetting a group frees its members and loses nothing';
END $$;

-- -------------------------------------------------------------
-- 8. A viewer cannot move anybody, and a stranger cannot read.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM put_in_group('91000000-0000-0000-0000-000000000001', NULL);
    RAISE EXCEPTION 'a viewer regrouped a customer';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'a viewer regrouped a customer' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.act_as(NULL);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM customer_groups;
    RAISE EXCEPTION 'a stranger read the customer groups';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM = 'a stranger read the customer groups' THEN RAISE; END IF;
  END;
  RESET ROLE;
  RAISE NOTICE 'ok  a viewer cannot regroup and a stranger cannot read';
END $$;

ROLLBACK;
