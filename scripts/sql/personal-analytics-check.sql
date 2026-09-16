-- =============================================================
-- The Personal Analytics authority ladder, against real PostgreSQL.
--
-- From the agreed development scope, Task 1 and Task 17:
--
--   Test an unauthorised UUID/request, not merely whether the selector
--   hides somebody.
--
-- So every assertion below asks the DATABASE the question a tampered
-- request would ask, as the person who tampered with it. Nothing here
-- looks at a screen, because the screen is not what is being trusted.
-- =============================================================
DO $check$
DECLARE
  rep   UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  rep2  UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  snr   UUID := 'aaaaaaaa-0000-0000-0000-000000000003';
  bd    UUID := 'aaaaaaaa-0000-0000-0000-000000000004';
  md    UUID := 'aaaaaaaa-0000-0000-0000-000000000005';
  dev   UUID := 'aaaaaaaa-0000-0000-0000-000000000006';
  fin   UUID := 'aaaaaaaa-0000-0000-0000-000000000007';
  ghost UUID := 'aaaaaaaa-0000-0000-0000-00000000dead';

  who   UUID;
  saw   INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;

  INSERT INTO auth.users (id, email) VALUES
    (rep, 'rep@stc.example'),   (rep2, 'rep2@stc.example'),
    (snr, 'snr@stc.example'),   (bd,   'bd@stc.example'),
    (md,  'md@stc.example'),    (dev,  'dev@stc.example'),
    (fin, 'fin@stc.example')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,  'rep@stc.example',  'Ray Rep',       'sales',  TRUE),
    (rep2, 'rep2@stc.example', 'Rita Rep',      'sales',  TRUE),
    (snr,  'snr@stc.example',  'Sam Senior',    'sales',  TRUE),
    (bd,   'bd@stc.example',   'Bev Dev',       'admin',  TRUE),
    (md,   'md@stc.example',   'Mo Director',   'admin',  TRUE),
    (dev,  'dev@stc.example',  'Dee Developer', 'admin',  TRUE),
    (fin,  'fin@stc.example',  'Fay Finance',   'admin',  TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE, full_name = EXCLUDED.full_name;

  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sales_rep')
   WHERE id IN (rep, rep2);
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sr_sales')
   WHERE id = snr;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'business_development')
   WHERE id = bd;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = md;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'developer')
   WHERE id = dev;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'finance')
   WHERE id = fin;

  ALTER TABLE profiles ENABLE TRIGGER USER;

  -- ---- Eligibility: five in, everybody else out ----
  FOREACH who IN ARRAY ARRAY[rep, snr, bd, md, dev] LOOP
    PERFORM set_config('request.jwt.claim.sub', who::TEXT, TRUE);
    IF NOT personal_analytics_eligible() THEN
      RAISE EXCEPTION '% is on an eligible role and Personal is shut to them',
        (SELECT full_name FROM profiles WHERE id = who);
    END IF;
  END LOOP;
  RAISE NOTICE 'the five named roles can open Personal';

  PERFORM set_config('request.jwt.claim.sub', fin::TEXT, TRUE);
  IF personal_analytics_eligible() THEN
    RAISE EXCEPTION 'Finance can open Personal, and the scope says they must not';
  END IF;
  IF personal_analytics_may_view(fin) THEN
    RAISE EXCEPTION 'Finance can read their own personal figures, which they have no Personal view for';
  END IF;
  RAISE NOTICE 'and Finance cannot, even about themselves';

  -- ---- Sales: themselves only ----
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF NOT personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'a Sales rep cannot see their own figures';
  END IF;
  IF personal_analytics_may_view(rep2) THEN
    RAISE EXCEPTION 'A SALES REP CAN READ ANOTHER SALES REP. This is the exact request the scope names.';
  END IF;
  IF personal_analytics_may_view(snr) OR personal_analytics_may_view(bd)
     OR personal_analytics_may_view(md) OR personal_analytics_may_view(dev) THEN
    RAISE EXCEPTION 'a Sales rep can read somebody above them';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 1 THEN
    RAISE EXCEPTION 'a Sales rep is offered % people and should be offered themselves alone', saw;
  END IF;
  RAISE NOTICE 'Sales sees themselves, and a hand typed UUID for anybody else is refused';

  -- ---- Sr Sales: themselves and Sales ----
  PERFORM set_config('request.jwt.claim.sub', snr::TEXT, TRUE);
  IF NOT (personal_analytics_may_view(snr) AND personal_analytics_may_view(rep)
          AND personal_analytics_may_view(rep2)) THEN
    RAISE EXCEPTION 'Sr Sales cannot see themselves and their reps';
  END IF;
  IF personal_analytics_may_view(bd) OR personal_analytics_may_view(md)
     OR personal_analytics_may_view(dev) THEN
    RAISE EXCEPTION 'Sr Sales can read somebody above them';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 3 THEN RAISE EXCEPTION 'Sr Sales is offered % people, wanted 3', saw; END IF;
  RAISE NOTICE 'Sr Sales sees themselves and Sales, and nobody above';

  -- ---- Business Development ----
  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF NOT (personal_analytics_may_view(bd) AND personal_analytics_may_view(snr)
          AND personal_analytics_may_view(rep)) THEN
    RAISE EXCEPTION 'Business Development cannot see their own ladder';
  END IF;
  IF personal_analytics_may_view(md) OR personal_analytics_may_view(dev) THEN
    RAISE EXCEPTION 'Business Development can read somebody above them';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 4 THEN RAISE EXCEPTION 'Business Development is offered % people, wanted 4', saw; END IF;
  RAISE NOTICE 'Business Development sees themselves, Sr Sales and Sales';

  -- ---- Managing Director ----
  PERFORM set_config('request.jwt.claim.sub', md::TEXT, TRUE);
  IF NOT (personal_analytics_may_view(md) AND personal_analytics_may_view(bd)
          AND personal_analytics_may_view(snr) AND personal_analytics_may_view(rep)) THEN
    RAISE EXCEPTION 'the Managing Director cannot see their own ladder';
  END IF;
  IF personal_analytics_may_view(dev) THEN
    RAISE EXCEPTION 'the Managing Director can read the Developer, which the ladder does not say';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 5 THEN RAISE EXCEPTION 'the Managing Director is offered % people, wanted 5', saw; END IF;
  RAISE NOTICE 'the Managing Director sees themselves and the three rungs below';

  -- ---- Developer ----
  PERFORM set_config('request.jwt.claim.sub', dev::TEXT, TRUE);
  IF NOT (personal_analytics_may_view(dev) AND personal_analytics_may_view(md)
          AND personal_analytics_may_view(bd) AND personal_analytics_may_view(snr)
          AND personal_analytics_may_view(rep) AND personal_analytics_may_view(rep2)) THEN
    RAISE EXCEPTION 'the Developer cannot see every eligible level';
  END IF;
  IF personal_analytics_may_view(fin) THEN
    RAISE EXCEPTION 'the Developer can read Finance, who have no Personal view at all';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 6 THEN RAISE EXCEPTION 'the Developer is offered % people, wanted 6', saw; END IF;
  RAISE NOTICE 'the Developer sees every eligible level, and nobody outside the ladder';

  -- ---- A UUID that is nobody ----
  PERFORM set_config('request.jwt.claim.sub', md::TEXT, TRUE);
  IF personal_analytics_may_view(ghost) THEN
    RAISE EXCEPTION 'a UUID belonging to nobody is readable';
  END IF;
  IF personal_analytics_may_view(NULL) THEN
    RAISE EXCEPTION 'a null person is readable';
  END IF;
  RAISE NOTICE 'a UUID belonging to nobody, and no UUID at all, are both refused';

  -- ---- Somebody who has left ----
  --
  -- The guard on `profiles` refuses an is_active change from anybody who
  -- is not an administrator, and this is arranging a world rather than
  -- testing that guard, so it is stood down for the arranging.
  ALTER TABLE profiles DISABLE TRIGGER USER;
  UPDATE profiles SET is_active = FALSE WHERE id = rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  PERFORM set_config('request.jwt.claim.sub', snr::TEXT, TRUE);
  IF personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'a deactivated person is still readable';
  END IF;
  SELECT COUNT(*) INTO saw FROM personal_analytics_people();
  IF saw <> 2 THEN
    RAISE EXCEPTION 'Sr Sales is offered % people with one rep deactivated, wanted 2', saw;
  END IF;

  ALTER TABLE profiles DISABLE TRIGGER USER;
  UPDATE profiles SET is_active = TRUE WHERE id = rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  RAISE NOTICE 'and somebody deactivated drops off the ladder';

  -- ---- Nobody is signed in ----
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  IF personal_analytics_eligible() THEN
    RAISE EXCEPTION 'Personal is open to nobody at all';
  END IF;
  IF personal_analytics_may_view(md) THEN
    RAISE EXCEPTION 'a signed out request can read the Managing Director';
  END IF;
  RAISE NOTICE 'signed out, Personal answers nothing';

  RAISE NOTICE 'every rung of the ladder holds, from both ends';
END
$check$;
