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

INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, bound_at) VALUES
  ('stc', 'MONTTRAN', 'Montgomery Transport Limited',     '91000000-0000-0000-0000-000000000001', NOW()),
  ('stc', 'MONTDIST', 'Montgomery Distribution Limited',  '91000000-0000-0000-0000-000000000002', NOW()),
  ('stc', 'MONTTANK', 'Montgomery Tank Services Limited', '91000000-0000-0000-0000-000000000003', NOW()),
  ('stc', 'ARIFLEET', 'Holman Fleet Limited',             '91000000-0000-0000-0000-000000000004', NOW()),
  ('stc', 'ARIVMS', 'Holman Fleet Limited (VMS)',   '91000000-0000-0000-0000-000000000004', NOW())
ON CONFLICT (division, alpha) DO NOTHING;

/* Two years each, so the like for like cut is exercised rather than
   assumed, and more than one invoice per account so a fan out over the
   open jobs join would double a real number rather than a zero. */
/* Dated inside the company's year, which runs April to April. Every
   figure below is read at 1 August 2026, so the year running is the one
   that began 1 April 2026 and the comparison is the same point in the
   year that began 1 April 2025. */
INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net) VALUES
  /* T1 sits exactly on the read date on purpose: the window is
     inclusive of it, and an off by one there would drop a day's
     invoicing from every figure on every screen. */
  ('stc', 'T1', 'MONTTRAN', '2026-08-01', 100000), ('stc', 'T2', 'MONTTRAN', '2026-06-01', 21440),
  ('stc', 'T3', 'MONTTRAN', '2025-05-01',  90000),
  ('stc', 'D1', 'MONTDIST', '2026-05-01', 108110), ('stc', 'D2', 'MONTDIST', '2025-05-01', 100000),
  ('stc', 'K1', 'MONTTANK', '2026-05-01',  83355),
  ('stc', 'H1', 'ARIFLEET', '2026-05-01',  50000), ('stc', 'H2', 'ARIFLEET', '2026-07-01', 25000),
  ('stc', 'V1', 'ARIVMS',   '2026-05-01',  30000),
  /* Last December. Inside the previous year and AFTER the same point in
     it, so it counts to neither figure. That is the like for like cut. */
  ('stc', 'H3', 'ARIFLEET', '2025-12-01',  40000)
ON CONFLICT (division, invoice_no) DO NOTHING;

INSERT INTO protean_open_jobs (division, job_no, protean_name, alpha, job_total, still_open) VALUES
  ('stc', 'J1', 'Montgomery Transport Limited', 'MONTTRAN', 5000, TRUE),
  ('stc', 'J2', 'Montgomery Transport Limited', 'MONTTRAN', 2500, TRUE),
  ('stc', 'J3', 'Holman Fleet Limited (VMS)',   'ARIVMS',   1000, TRUE),
  /* Closed, so it must not be counted anywhere. */
  ('stc', 'J4', 'Holman Fleet Limited',         'ARIFLEET', 9999, FALSE)
ON CONFLICT (division, job_no) DO NOTHING;

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

-- -------------------------------------------------------------
-- 9. MANAGING A GROUP ONCE IT EXISTS.
--
--   I can't edit the group or remove a group.
--
-- `forget_group` had existed since the groups were built and nothing
-- could reach it. A person who cannot undo a thing stops using it, so
-- these are the four things a group has to allow after it is made.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID; n INTEGER; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  g := name_a_group('Montgomery');
  PERFORM put_in_group('91000000-0000-0000-0000-000000000001', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000002', g);

  /* Read who is in it. The screen had no way to ask. */
  SELECT count(*) INTO n FROM group_members(g);
  IF n <> 2 THEN RAISE EXCEPTION 'the group has % members, not 2', n; END IF;
  SELECT * INTO r FROM group_members(g) WHERE company_name = 'Montgomery Transport Limited';
  IF r.accounts <> 1 THEN
    RAISE EXCEPTION 'a member reads as % accounts, not 1', r.accounts;
  END IF;

  /* Rename it. */
  PERFORM rename_group(g, 'Montgomery Group');
  IF (SELECT name FROM customer_groups WHERE id = g) <> 'Montgomery Group' THEN
    RAISE EXCEPTION 'the rename did not take';
  END IF;

  /* Not onto a name already taken, which would make one group two. */
  PERFORM name_a_group('Holman Fleet');
  BEGIN
    PERFORM rename_group(g, 'holman fleet');
    RAISE EXCEPTION 'two groups now share a name';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'two groups now share a name' THEN RAISE; END IF;
  END;

  /* Take one member out. The customer survives, with their revenue. */
  PERFORM put_in_group('91000000-0000-0000-0000-000000000002', NULL);
  SELECT count(*) INTO n FROM group_members(g);
  IF n <> 1 THEN RAISE EXCEPTION 'after removing one, % remain, not 1', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_contacts
                  WHERE id = '91000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'taking a customer out of a group deleted them';
  END IF;

  RAISE NOTICE 'ok  a group can be read, renamed, and have a member taken out of it';
END $$;

-- -------------------------------------------------------------
-- 10. Declining a suggestion, and having it stay declined.
--
-- A threshold will eventually be wrong about something. The answer is
-- not a cleverer threshold, it is that a person can overrule it and the
-- overruling sticks.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');

  PERFORM decline_group_suggestion('John');
  IF NOT EXISTS (SELECT 1 FROM declined_group_suggestions WHERE name = 'john') THEN
    RAISE EXCEPTION 'declining was not remembered';
  END IF;

  /* Case does not matter: the screen offers "John" and the record is
     the lower case of it. */
  PERFORM decline_group_suggestion('  JOHN  ');
  SELECT count(*) INTO n FROM declined_group_suggestions WHERE name = 'john';
  IF n <> 1 THEN RAISE EXCEPTION 'declining twice made % rows', n; END IF;

  /* Saying yes later overrides having once said no, because it is the
     stronger statement. */
  g := name_a_group('John');
  IF EXISTS (SELECT 1 FROM declined_group_suggestions WHERE name = 'john') THEN
    RAISE EXCEPTION 'a group was made under a name still marked as declined';
  END IF;
  PERFORM forget_group(g);

  /* And declining can itself be undone. */
  PERFORM decline_group_suggestion('John');
  PERFORM undecline_group_suggestion('john');
  IF EXISTS (SELECT 1 FROM declined_group_suggestions WHERE name = 'john') THEN
    RAISE EXCEPTION 'undeclining did nothing';
  END IF;

  RAISE NOTICE 'ok  declining a suggestion sticks, saying yes overrides it, and both can be undone';
END $$;

-- -------------------------------------------------------------
-- 11. A viewer can do none of it.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  g := name_a_group('Montgomery Group');

  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM rename_group(g, 'Whatever');
    RAISE EXCEPTION 'a viewer renamed a group';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'a viewer renamed a group' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM decline_group_suggestion('Anything');
    RAISE EXCEPTION 'a viewer declined a suggestion';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'a viewer declined a suggestion' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a viewer can read a group and change nothing about it';
END $$;

-- -------------------------------------------------------------
-- 12. A GROUP SHOWS ON THE SCREEN FOR THE DIVISION ITS MONEY IS IN.
--
--   Ensure only groups relating to STC show on STC's groups tab and
--   vice versa, currently I see maintenance customers on the S&L rental
--   group tab.
--
-- Every other figure learned about divisions and this one did not, so
-- both screens showed every group and rental listed maintenance
-- customers with rental totals of nought beside them.
--
-- "Relating to" cannot mean "made on that screen": a group is a
-- commercial relationship and Montgomery is one group however you
-- arrive at it. It means the group has money in that division, so the
-- same group can honestly appear on both showing its own half.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID; r RECORD; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');

  /* One customer in the Montgomery group also bills on rental. */
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, bound_at)
  VALUES ('rental', 'MONTTRAN', 'Montgomery Transport Limited',
          '91000000-0000-0000-0000-000000000001', NOW())
  ON CONFLICT (division, alpha) DO NOTHING;
  INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net)
  VALUES ('rental', 'MR1', 'MONTTRAN', '2026-05-01', 11000)
  ON CONFLICT (division, invoice_no) DO NOTHING;

  g := name_a_group('Montgomery');
  PERFORM put_in_group('91000000-0000-0000-0000-000000000001', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000002', g);
  PERFORM put_in_group('91000000-0000-0000-0000-000000000003', g);

  /* A group with no rental money at all does not appear on rental. */
  PERFORM put_in_group('91000000-0000-0000-0000-000000000004', name_a_group('Holman Fleet'));

  SELECT count(*) INTO n FROM group_revenue('2026-08-01', 'rental')
   WHERE group_name = 'Holman Fleet';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a group with no rental money is showing on the rental screen';
  END IF;

  /* Montgomery does appear, showing its RENTAL half only. */
  SELECT * INTO r FROM group_revenue('2026-08-01', 'rental') WHERE group_name = 'Montgomery';
  IF r.group_id IS NULL THEN
    RAISE EXCEPTION 'a group with rental money is missing from the rental screen';
  END IF;
  IF r.this_year <> 11000 THEN
    RAISE EXCEPTION 'the rental screen shows Montgomery at %, not its rental half of 11000',
      r.this_year;
  END IF;

  /* And its maintenance half on the maintenance screen. */
  SELECT * INTO r FROM group_revenue('2026-08-01', 'stc') WHERE group_name = 'Montgomery';
  IF r.this_year <> 312905 THEN
    RAISE EXCEPTION 'the maintenance screen shows Montgomery at %, not 312905', r.this_year;
  END IF;

  /* Asked for everything, it is both halves. */
  SELECT * INTO r FROM group_revenue('2026-08-01', NULL) WHERE group_name = 'Montgomery';
  IF r.this_year <> 323905 THEN
    RAISE EXCEPTION 'the whole company shows Montgomery at %, not 323905', r.this_year;
  END IF;

  RAISE NOTICE 'ok  a group shows its own half on each division, and not at all where it has none';
END $$;

-- -------------------------------------------------------------
-- 12b. And the breakdown inside it follows the same division.
-- -------------------------------------------------------------
DO $$
DECLARE g UUID; n INTEGER; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  g := name_a_group('Montgomery');

  SELECT count(*) INTO n FROM group_breakdown(g, '2026-08-01', 'rental');
  IF n <> 1 THEN
    RAISE EXCEPTION 'the rental breakdown lists % accounts, not the 1 with rental money', n;
  END IF;
  SELECT * INTO r FROM group_breakdown(g, '2026-08-01', 'rental');
  IF r.division <> 'rental' THEN
    RAISE EXCEPTION 'the rental breakdown returned a % account', r.division;
  END IF;

  SELECT count(*) INTO n FROM group_breakdown(g, '2026-08-01', 'stc');
  IF n <> 3 THEN
    RAISE EXCEPTION 'the maintenance breakdown lists % accounts, not 3', n;
  END IF;

  SELECT count(*) INTO n FROM group_breakdown(g, '2026-08-01', NULL);
  IF n <> 4 THEN
    RAISE EXCEPTION 'the whole company breakdown lists %, not 4', n;
  END IF;
  RAISE NOTICE 'ok  opening a group shows that division''s accounts, not every division''s';
END $$;

-- -------------------------------------------------------------
-- 12c. The whole of last year, on a group as well.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');
  SELECT * INTO r FROM group_revenue('2026-08-01', 'stc') WHERE group_name = 'Montgomery';
  IF r.last_year_full < r.last_year THEN
    RAISE EXCEPTION 'the whole of last year %, is smaller than the same point in it %',
      r.last_year_full, r.last_year;
  END IF;
  RAISE NOTICE 'ok  a group carries the whole of last year alongside the same point in it';
END $$;

-- -------------------------------------------------------------
-- 12d. THE ROW AND THE MANAGE DIALOG COUNT DIFFERENT THINGS,
--      AND EACH ONE SAYS WHICH.
--
-- From the business:
--
--   We have a group it's made from 2 customers, the dropdown only shows
--   one, the manage screen shows 2. then the inpost one does show 2,
--   but one of them has never had any revenue so it technically doesn't
--   belong in a revenue group yet.
--
-- Reported as a fault and both numbers were right. Manage lists every
-- member of the group; the row on a division screen counts the ones
-- with an account in THAT division. A member who bills only on S&L is
-- correctly absent from the STC row and correctly present in Manage,
-- and nothing anywhere said so.
--
-- The fixture below is the reported shape exactly: a two member group
-- where one member bills on one division and the other bills on the
-- other.
-- -------------------------------------------------------------
INSERT INTO crm_contacts (id, company_name, source, status) VALUES
  ('90100000-0000-0000-0000-0000000000c1', 'Close Brothers Asset Finance', 'protean', 'customer'),
  ('90100000-0000-0000-0000-0000000000c2', 'Close Brothers Vehicle Hire Limited', 'protean', 'customer'),
  /* And a member with an account here and nothing on it, which is the
     InPost half of the report. */
  ('90100000-0000-0000-0000-0000000000c3', 'Close Brothers Leasing Ltd', 'protean', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, bound_at) VALUES
  ('stc',    'CLOSEAF', 'Close Brothers Asset Finance',        '90100000-0000-0000-0000-0000000000c1', NOW()),
  ('rental', 'CLOSEVH', 'Close Brothers Vehicle Hire Limited', '90100000-0000-0000-0000-0000000000c2', NOW()),
  ('stc',    'CLOSELE', 'Close Brothers Leasing Ltd',          '90100000-0000-0000-0000-0000000000c3', NOW())
ON CONFLICT (division, alpha) DO NOTHING;

INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net) VALUES
  ('stc',    'CB1', 'CLOSEAF', '2026-05-01', 55640),
  ('rental', 'CB2', 'CLOSEVH', '2026-05-01', 48319)
  /* CLOSELE gets none, on purpose. */
ON CONFLICT (division, invoice_no) DO NOTHING;

DO $$
DECLARE g UUID; row_stc RECORD; row_rental RECORD; n INTEGER; m RECORD; b RECORD;
BEGIN
  PERFORM pg_temp.act_as('90000000-0000-0000-0000-000000000001');

  g := name_a_group('Close Brothers');
  PERFORM put_in_group('90100000-0000-0000-0000-0000000000c1', g);
  PERFORM put_in_group('90100000-0000-0000-0000-0000000000c2', g);
  PERFORM put_in_group('90100000-0000-0000-0000-0000000000c3', g);

  -- ---- Manage lists the whole group ----
  SELECT count(*) INTO n FROM group_members(g, '2026-08-01');
  IF n <> 3 THEN
    RAISE EXCEPTION 'Manage lists % members, and three were put in the group', n;
  END IF;

  -- ---- The STC row counts the two with an STC account ----
  SELECT * INTO row_stc FROM group_revenue('2026-08-01', 'stc') WHERE group_name = 'Close Brothers';
  IF row_stc IS NULL THEN RAISE EXCEPTION 'the group is not on the STC screen at all'; END IF;
  IF row_stc.customers <> 2 THEN
    RAISE EXCEPTION 'the STC row counts % customers, and two of the three bill on STC',
      row_stc.customers;
  END IF;

  /* THE NUMBER THAT MAKES THE TWO LEGIBLE. Without it the row says two
     and the dialog says three, and the only reading available is that
     something is broken. */
  IF row_stc.members <> 3 THEN
    RAISE EXCEPTION 'the STC row says the group has % members, and it has 3', row_stc.members;
  END IF;
  IF row_stc.this_year <> 55640 THEN
    RAISE EXCEPTION 'the STC row shows %, not the 55640 billed on STC', row_stc.this_year;
  END IF;

  -- ---- And the S&L row counts the one with an S&L account ----
  SELECT * INTO row_rental FROM group_revenue('2026-08-01', 'rental')
   WHERE group_name = 'Close Brothers';
  IF row_rental.customers <> 1 OR row_rental.this_year <> 48319 THEN
    RAISE EXCEPTION 'the S&L row shows % customers at %, not 1 at 48319',
      row_rental.customers, row_rental.this_year;
  END IF;
  IF row_rental.members <> 3 THEN
    RAISE EXCEPTION 'the S&L row says the group has % members, and it has 3', row_rental.members;
  END IF;

  -- ---- Manage names where each member's money is ----
  SELECT * INTO m FROM group_members(g, '2026-08-01')
   WHERE company_name = 'Close Brothers Vehicle Hire Limited';
  IF m.divisions IS DISTINCT FROM 'S&L' THEN
    RAISE EXCEPTION 'Manage says Vehicle Hire bills on %, and it bills on S&L', m.divisions;
  END IF;
  IF m.this_year <> 48319 THEN
    RAISE EXCEPTION 'Manage says Vehicle Hire billed % this year, not 48319', m.this_year;
  END IF;

  /* That one line is the whole answer to the report: somebody looking
     at the STC row and the dialog can now see that the missing member
     is missing because its money is on the other screen. */

  -- ---- A member with an account here and nothing on it ----
  SELECT * INTO b FROM group_breakdown(g, '2026-08-01', 'stc')
   WHERE company_name = 'Close Brothers Leasing Ltd';
  IF b IS NULL THEN
    RAISE EXCEPTION 'a member with an account here and no billing was dropped from the '
                    'breakdown, so the count and the list disagree again';
  END IF;
  IF b.billed_ever <> 0 THEN
    RAISE EXCEPTION 'it reads as having billed % ever, and it has billed nothing', b.billed_ever;
  END IF;

  /* And one that HAS billed is told apart from it, which is the whole
     point of carrying `billed_ever` next to `this_year`. */
  SELECT * INTO b FROM group_breakdown(g, '2026-08-01', 'stc')
   WHERE company_name = 'Close Brothers Asset Finance';
  IF b.billed_ever <= 0 THEN
    RAISE EXCEPTION 'an account that has billed reads as never having billed';
  END IF;

  RAISE NOTICE 'ok  the row counts this division and Manage counts the group, and each says which';
END $$;

ROLLBACK;
