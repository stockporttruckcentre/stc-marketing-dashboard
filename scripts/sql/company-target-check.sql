-- =============================================================
-- The company target, worked out from the revenue screen.
--
-- From the business:
--
--   find the amount we invoiced in total last year across all divisions
--   on the revenue tab [...] Add 20%. That's the company target
--
-- The thing worth asserting is not the arithmetic, it is that the
-- figure it adds 20 per cent to is THE SAME FIGURE THE REVENUE SCREEN
-- SHOWS. A target worked out a slightly different way from the revenue
-- it is measured against would be wrong by an amount nobody could find.
-- =============================================================
DO $check$
DECLARE
  boss  UUID := 'aaaacccc-0000-0000-0000-000000000001';
  acme  UUID := 'aaaacccc-1111-0000-0000-000000000001';
  fy    DATE := financial_year_of(CURRENT_DATE);
  fy0   DATE := (fy - INTERVAL '1 year')::DATE;
  screen NUMERIC;
  r     RECORD;
  n     INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'target-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'target-boss@stc.example', 'Mo Director', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  INSERT INTO crm_contacts (id, company_name, status)
  VALUES (acme, 'Acme Haulage', 'customer') ON CONFLICT (id) DO NOTHING;
  INSERT INTO protean_accounts (alpha, protean_name, division, contact_id, ignored)
  VALUES ('TGT01', 'Acme Haulage', 'stc', acme, FALSE),
         ('TGT02', 'Acme Haulage', 'rental', acme, FALSE)
  ON CONFLICT DO NOTHING;

  /* Last year, across two divisions, and one in the CURRENT year that
     must not be counted. */
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    ('T-1', 'TGT01', fy0 + 30,  100000, 'stc'),
    ('T-2', 'TGT01', fy0 + 200,  50000, 'stc'),
    ('T-3', 'TGT02', fy0 + 90,   25000, 'rental'),
    ('T-4', 'TGT01', fy  + 5,   999999, 'stc'),
    -- The day before the year began, which is the year before last.
    ('T-5', 'TGT01', fy0 - 1,   777777, 'stc')
  ON CONFLICT DO NOTHING;

  -- What the revenue screen itself says last year came to.
  SELECT COALESCE(SUM(d.last_year_full), 0) INTO screen
    FROM division_revenue(CURRENT_DATE) d;

  IF screen <> 175000 THEN
    RAISE EXCEPTION 'the revenue screen says last year was %, and the fixture is 175000', screen;
  END IF;
  RAISE NOTICE 'the revenue screen says last year came to 175000 across the divisions';

  SELECT * INTO r FROM company_target_from_last_year(0.20);

  IF r.invoiced <> screen THEN
    RAISE EXCEPTION
      'the target is being worked out from %, and the revenue screen shows %. '
      'They have to be the same number.', r.invoiced, screen;
  END IF;
  RAISE NOTICE 'and the target is worked out from that same figure, not a second one';

  IF r.target <> 210000 THEN
    RAISE EXCEPTION 'the target is %, wanted 210000 (175000 plus 20 per cent)', r.target;
  END IF;
  RAISE NOTICE 'twenty per cent on top comes to 210000';

  IF r.last_year_from <> fy0 OR r.last_year_to <> (fy - INTERVAL '1 day')::DATE THEN
    RAISE EXCEPTION 'the period is % to %, wanted % to %',
      r.last_year_from, r.last_year_to, fy0, (fy - INTERVAL '1 day')::DATE;
  END IF;
  RAISE NOTICE 'over the whole of last financial year, not to the same point in it';

  -- Nothing is written by looking.
  SELECT COUNT(*) INTO n FROM performance_targets WHERE scope = 'company';
  IF n <> 0 THEN RAISE EXCEPTION 'looking at the figure wrote a target'; END IF;
  RAISE NOTICE 'and looking at it writes nothing';

  -- ---- Setting it ----
  PERFORM set_company_target_from_last_year(0.20);
  IF company_fy_target() IS DISTINCT FROM 210000 THEN
    RAISE EXCEPTION 'the company target reads %, wanted 210000', company_fy_target();
  END IF;
  SELECT COUNT(*) INTO n FROM performance_targets WHERE scope = 'company';
  IF n <> 1 THEN RAISE EXCEPTION 'there are % company targets, wanted 1', n; END IF;
  RAISE NOTICE 'setting it writes one company target, and it reads back as 210000';

  -- It says how it got there.
  SELECT note INTO r FROM performance_targets WHERE scope = 'company' LIMIT 1;
  IF (SELECT note FROM performance_targets WHERE scope = 'company' LIMIT 1) NOT LIKE '%175,000%' THEN
    RAISE EXCEPTION 'the target does not record the figure it was worked out from';
  END IF;
  RAISE NOTICE 'and it records the figure and the period it was worked out from';

  -- Running it again works it out again rather than stacking up.
  PERFORM set_company_target_from_last_year(0.20);
  SELECT COUNT(*) INTO n FROM performance_targets WHERE scope = 'company';
  IF n <> 1 THEN RAISE EXCEPTION 'running it twice left % company targets', n; END IF;
  RAISE NOTICE 'running it again replaces it rather than adding another';

  -- A different uplift is a different target.
  PERFORM set_company_target_from_last_year(0.10);
  IF company_fy_target() IS DISTINCT FROM 192500 THEN
    RAISE EXCEPTION 'ten per cent came to %, wanted 192500', company_fy_target();
  END IF;
  PERFORM set_company_target_from_last_year(0.20);
  RAISE NOTICE 'and the percentage is an argument, so next year is one call with a new number';

  -- Somebody without the permission cannot set it.
  PERFORM set_config('request.jwt.claim.sub', acme::TEXT, TRUE);
  BEGIN
    PERFORM set_company_target_from_last_year(0.50);
    RAISE EXCEPTION 'somebody with no permission set the company target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%no permission set%' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  IF company_fy_target() IS DISTINCT FROM 210000 THEN
    RAISE EXCEPTION 'the refused call changed the target anyway';
  END IF;
  RAISE NOTICE 'and only somebody who may set targets can set it';

  RAISE NOTICE 'the company target is last year on the revenue screen, plus twenty per cent';
END
$check$;
