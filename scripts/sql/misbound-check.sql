-- =============================================================
-- Money cannot be parked on a customer that is not there.
--
-- From the business:
--
--   i imported an invoice earlier for HATS Group, it asked me to look
--   up the correct account for it and select one. It's not showing on
--   any revenue tabs. It's been a problematic customer in this CRM too.
--
-- The picker listed soft deleted records and `protean_bind` accepted
-- one, so the invoice counted in the division total and showed against
-- no customer anywhere. Migration 127 refuses the bind, finds the ones
-- already made, and puts them back.
--
-- Run with `npm run check:misbound`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss  UUID := 'dddddddd-0000-0000-0000-000000000001';
  keep  UUID := 'dddddddd-1111-0000-0000-000000000001';
  dupe  UUID := 'dddddddd-1111-0000-0000-000000000002';
  orph  UUID := 'dddddddd-1111-0000-0000-000000000003';
  fy    DATE := financial_year_of(CURRENT_DATE);
  r     RECORD;
  n     INT;
  msg   TEXT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'misbound@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'misbound@stc.example', 'Mo Director', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM protean_invoices;
  DELETE FROM protean_accounts;

  INSERT INTO crm_contacts (id, company_name) VALUES
    (keep, 'HATS Group Ltd'),
    (dupe, 'HATS Group'),
    (orph, 'Gone Without Trace Ltd')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, deleted_at = NULL;

  INSERT INTO protean_accounts (division, alpha, protean_name, last_seen) VALUES
    ('stc', 'HATS01', 'HATS GROUP', NOW()),
    ('stc', 'GONE01', 'GONE WITHOUT TRACE', NOW())
  ON CONFLICT (division, alpha) DO NOTHING;

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    ('MB0001', 'HATS01', fy + 10, 4000.00, 'stc'),
    ('MB0002', 'GONE01', fy + 10,  900.00, 'stc');

  -- ---------------------------------------------------------
  -- 1. The merge that creates the dead record.
  -- ---------------------------------------------------------
  PERFORM crm_merge(keep, dupe, TRUE);
  IF (SELECT deleted_at FROM crm_contacts WHERE id = dupe) IS NULL THEN
    RAISE EXCEPTION 'the merge did not soft delete the duplicate, so this check proves nothing';
  END IF;

  -- ---------------------------------------------------------
  -- 2. THE BUG. Binding to the merged away record is refused, and the
  --    refusal names where the work went rather than only saying no.
  -- ---------------------------------------------------------
  BEGIN
    PERFORM protean_bind('stc', 'HATS01', dupe);
    RAISE EXCEPTION 'binding to a merged away customer was ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
    IF msg = 'binding to a merged away customer was ACCEPTED' THEN RAISE; END IF;
    IF msg NOT LIKE '%HATS Group Ltd%' THEN
      RAISE EXCEPTION 'the refusal does not name the live record: %', msg;
    END IF;
  END;

  -- ---------------------------------------------------------
  -- 3. Binding to the live record still works, and is visible.
  -- ---------------------------------------------------------
  PERFORM protean_bind('stc', 'HATS01', keep);
  SELECT COALESCE(SUM(d.net), 0) INTO n FROM customer_divisions(keep) d;
  IF n <> 4000 THEN
    RAISE EXCEPTION 'the live customer record shows % rather than 4000', n;
  END IF;

  -- ---------------------------------------------------------
  -- 4. One made the old way, straight into the table, is FOUND.
  -- ---------------------------------------------------------
  UPDATE protean_accounts SET contact_id = dupe WHERE division = 'stc' AND alpha = 'HATS01';

  /* THE SYMPTOM. The customer's own record shows nothing, while the
     division total still counts every penny. That gap is the whole
     fault: the headline is right and the customer is empty. */
  SELECT COALESCE(SUM(d.net), 0) INTO n FROM customer_divisions(keep) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'the live record still shows %, so this check is not reproducing the fault', n;
  END IF;
  SELECT this_year INTO n FROM division_revenue(CURRENT_DATE) WHERE division = 'stc';
  IF n <> 4900 THEN
    RAISE EXCEPTION 'the division total is % rather than 4900, so the money did move', n;
  END IF;

  SELECT * INTO r FROM protean_misbound() WHERE alpha = 'HATS01';
  IF r.alpha IS NULL THEN RAISE EXCEPTION 'protean_misbound did not find the stranded account'; END IF;
  IF r.goes_to <> keep THEN
    RAISE EXCEPTION 'it points at % rather than the live record', r.goes_to;
  END IF;
  IF r.this_year <> 4000.00 THEN
    RAISE EXCEPTION 'it says % is hidden rather than 4000', r.this_year;
  END IF;

  -- ---------------------------------------------------------
  -- 5. And one whose record went with no merge to explain it is
  --    reported, NOT guessed at.
  -- ---------------------------------------------------------
  UPDATE protean_accounts SET contact_id = orph WHERE division = 'stc' AND alpha = 'GONE01';
  PERFORM soft_delete('crm_contacts', orph, 'deleted outright');

  SELECT * INTO r FROM protean_misbound() WHERE alpha = 'GONE01';
  IF r.alpha IS NULL THEN RAISE EXCEPTION 'the outright deleted one was not found'; END IF;
  IF r.goes_to IS NOT NULL THEN
    RAISE EXCEPTION 'it invented a destination for a record nothing replaced';
  END IF;

  -- ---------------------------------------------------------
  -- 6. Putting them back moves the one it can and leaves the other.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM protean_fix_misbound();
  IF r.moved <> 1 THEN RAISE EXCEPTION '% moved, wanted 1', r.moved; END IF;
  IF r.left_alone <> 1 THEN RAISE EXCEPTION '% left alone, wanted 1', r.left_alone; END IF;
  IF r.net_restored <> 4000.00 THEN
    RAISE EXCEPTION '% restored, wanted 4000', r.net_restored; END IF;

  SELECT COALESCE(SUM(d.net), 0) INTO n FROM customer_divisions(keep) d;
  IF n <> 4000 THEN
    RAISE EXCEPTION 'the live customer shows % rather than 4000 after the fix', n;
  END IF;

  -- Nothing was deleted anywhere.
  SELECT count(*) INTO n FROM protean_invoices;
  IF n <> 2 THEN RAISE EXCEPTION '% invoices left, wanted 2', n; END IF;

  RAISE NOTICE 'misbound: refused, found, put back, and nothing guessed';
END $check$;

ROLLBACK;
