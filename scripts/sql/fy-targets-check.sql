-- =============================================================
-- Financial year targets, against real PostgreSQL.
--
-- From the agreed development scope, Task 17:
--
--   Test: Dean has £600,000 current FY personal target; Dean does not
--   accidentally have £600,000 monthly target; company FY target is
--   missing/null; missing target renders as Not set
--
-- The second of those is the one worth having. Putting the figure in
-- the wrong table is the named risk, and nothing about the number on a
-- screen would show it: £600,000 a month and £600,000 a year look
-- identical until somebody reads the label.
-- =============================================================
DO $check$
DECLARE
  dean  UUID := 'dddddddd-0000-0000-0000-000000000001';
  dean2 UUID := 'dddddddd-0000-0000-0000-000000000002';
  boss  UUID := 'dddddddd-0000-0000-0000-000000000003';
  fy    DATE := financial_year_of(CURRENT_DATE);
  got   NUMERIC;
  said  TEXT;
  n     INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (dean, 'dean@stc.example'), (dean2, 'dean.two@stc.example'), (boss, 'boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (dean,  'dean@stc.example',     'Dean Sharples', 'sales', TRUE),
    (dean2, 'dean.two@stc.example', 'Dean Other',    'sales', FALSE),
    (boss,  'boss@stc.example',     'Mo Director',   'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, is_active = EXCLUDED.is_active;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sales_rep')
   WHERE id IN (dean, dean2);
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  -- ---- One Dean: the target lands on him ----
  said := seed_dean_fy_target();
  IF said NOT LIKE 'Dean (%' THEN
    RAISE EXCEPTION 'the seed did not find the one active Dean: %', said;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', dean::TEXT, TRUE);
  got := personal_fy_target(dean);
  IF got IS DISTINCT FROM 600000 THEN
    RAISE EXCEPTION 'Dean holds % for the financial year, wanted 600000', COALESCE(got::TEXT, 'nothing');
  END IF;
  RAISE NOTICE 'Dean holds a 600000 target for the year from %', fy;

  -- ---- And it is not a MONTHLY target ----
  --
  -- The whole reason this table exists. `revenue_targets` must not have
  -- gained a row, and certainly not one for 600000.
  SELECT COUNT(*) INTO n FROM revenue_targets WHERE target_amount = 600000;
  IF n > 0 THEN
    RAISE EXCEPTION
      'revenue_targets has % row(s) of 600000 in it. The annual figure has been written '
      'into the monthly table, which is exactly what the scope forbids.', n;
  END IF;
  SELECT COUNT(*) INTO n FROM revenue_targets WHERE user_id = dean;
  IF n > 0 THEN
    RAISE EXCEPTION 'Dean has % monthly target row(s), and this feature wrote none', n;
  END IF;
  RAISE NOTICE 'and revenue_targets is untouched, so 600000 is not a monthly target';

  -- ---- The company target does not exist, and that is not zero ----
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  IF company_fy_target() IS NOT NULL THEN
    RAISE EXCEPTION 'a company target exists and the business has not set one';
  END IF;
  SELECT COUNT(*) INTO n FROM performance_targets WHERE scope = 'company';
  IF n > 0 THEN
    RAISE EXCEPTION 'a company target row was written, and unknown is a missing row';
  END IF;
  RAISE NOTICE 'the company target is absent rather than zero';

  -- ---- Somebody with no target reads as nothing, not nought ----
  IF personal_fy_target(boss) IS NOT NULL THEN
    RAISE EXCEPTION 'somebody with no target came back with a figure';
  END IF;
  RAISE NOTICE 'and a person with no target answers nothing, not zero';

  -- ---- The ladder governs a target the same as a figure ----
  PERFORM set_config('request.jwt.claim.sub', dean::TEXT, TRUE);
  IF personal_fy_target(boss) IS NOT NULL THEN
    RAISE EXCEPTION 'a Sales rep can read the Managing Director''s target';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  IF personal_fy_target(dean) IS DISTINCT FROM 600000 THEN
    RAISE EXCEPTION 'the Managing Director cannot read a rep''s target';
  END IF;
  RAISE NOTICE 'a target is as private as the revenue it measures';

  -- ---- Setting one needs the capability, not the sight of it ----
  PERFORM set_config('request.jwt.claim.sub', dean::TEXT, TRUE);
  BEGIN
    PERFORM set_personal_fy_target(dean, 999999);
    RAISE EXCEPTION 'a Sales rep set their own target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%set their own target%' THEN RAISE; END IF;
  END;
  IF personal_fy_target(dean) IS DISTINCT FROM 600000 THEN
    RAISE EXCEPTION 'the refused write changed the target anyway';
  END IF;
  RAISE NOTICE 'a rep can see their target and cannot set it';

  -- ---- Two Deans: refuse, loudly ----
  ALTER TABLE profiles DISABLE TRIGGER USER;
  UPDATE profiles SET is_active = TRUE WHERE id = dean2;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  BEGIN
    PERFORM seed_dean_fy_target();
    RAISE EXCEPTION 'two Deans and the seed picked one anyway';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%picked one anyway%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Refusing to guess%' THEN
      RAISE EXCEPTION 'two Deans raised the wrong thing: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'two Deans and the seed refuses rather than guessing';
  ALTER TABLE profiles DISABLE TRIGGER USER;
  UPDATE profiles SET is_active = FALSE WHERE id = dean2;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  -- ---- Zero is a target somebody set ----
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_personal_fy_target(boss, 0);
  IF personal_fy_target(boss) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a deliberate zero target does not read back as zero';
  END IF;
  RAISE NOTICE 'and a deliberate zero reads as zero, which is not the same as absent';

  RAISE NOTICE 'the financial year targets hold, and the monthly ones are where they were';
END
$check$;
