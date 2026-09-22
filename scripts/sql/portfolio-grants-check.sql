-- =============================================================
-- Who may open whose portfolio can be granted in the app.
--
-- From the business:
--
--   if I leave this company in a month, that is one permission that
--   can't be granted to specific people and therefore the app fails on
--   being self-sustainable. I won't always be here.
--
-- Migration 117 made this deliberately unwritable except by migration.
-- 143 reverses that. This is what makes the reversal safe: the rule
-- still refuses everybody it refused before unless somebody with the
-- right to manage people has said otherwise, by name, on the record.
--
-- Run with `npm run check:portfolio-grants`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss UUID := 'aaaa1111-0000-0000-0000-000000000001';  -- managing director
  bd   UUID := 'aaaa1111-0000-0000-0000-000000000002';  -- business development
  bd2  UUID := 'aaaa1111-0000-0000-0000-000000000003';  -- a second BD, their peer
  rep  UUID := 'aaaa1111-0000-0000-0000-000000000004';  -- sales rep
  n    INT; r RECORD; said TEXT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (boss,'pg-boss@stc.example'), (bd,'pg-bd@stc.example'),
    (bd2,'pg-bd2@stc.example'), (rep,'pg-rep@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (boss,'pg-boss@stc.example','Mo Director','admin',TRUE),
    (bd,  'pg-bd@stc.example',  'Bee Dee',    'sales',TRUE),
    (bd2, 'pg-bd2@stc.example', 'Bea Dee',    'sales',TRUE),
    (rep, 'pg-rep@stc.example', 'Reggie Rep', 'sales',TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, is_active = TRUE;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='business_development') WHERE id IN (bd, bd2);
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id=rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM personal_analytics_grants;

  -- ---------------------------------------------------------
  -- 1. THE LADDER STILL DECIDES WHEN NOBODY HAS SAID OTHERWISE.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF NOT personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'business development can no longer see a rep, which the ladder allows';
  END IF;
  IF personal_analytics_may_view(bd2) THEN
    RAISE EXCEPTION 'two people on one role can see each other, which the ladder does not allow';
  END IF;
  IF NOT personal_analytics_may_view(bd) THEN
    RAISE EXCEPTION 'somebody cannot see their own figures';
  END IF;

  -- ---------------------------------------------------------
  -- 2. A REP CANNOT GRANT THEMSELVES ANYTHING.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  BEGIN
    PERFORM set_portfolio_grant(rep, bd, TRUE, 'trying it on');
    RAISE EXCEPTION 'a sales rep granted themselves sight of a colleague';
  EXCEPTION WHEN OTHERS THEN
    said := SQLERRM;
    IF said = 'a sales rep granted themselves sight of a colleague' THEN RAISE; END IF;
  END;

  -- ---------------------------------------------------------
  -- 3. THE THING THAT WAS MISSING. One person, by name, without
  --    anybody writing SQL and without touching either role.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_portfolio_grant(bd, bd2, TRUE, 'covering while Bea is on leave');

  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF NOT personal_analytics_may_view(bd2) THEN
    RAISE EXCEPTION 'a grant by name did not take effect';
  END IF;

  -- and it did not open the door for their peer in the other direction
  PERFORM set_config('request.jwt.claim.sub', bd2::TEXT, TRUE);
  IF personal_analytics_may_view(bd) THEN
    RAISE EXCEPTION 'granting one direction granted the other as well';
  END IF;

  -- ---------------------------------------------------------
  -- 4. AND A REFUSAL BY NAME BEATS THE LADDER.
  --    An exception in one direction only is half a control.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_portfolio_grant(bd, rep, FALSE, 'conflict of interest');

  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'a refusal by name was overruled by the ladder';
  END IF;

  -- ---------------------------------------------------------
  -- 5. CLEARING IT PUTS THE LADDER BACK IN CHARGE.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM clear_portfolio_grant(bd, rep);

  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF NOT personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'clearing the exception did not hand it back to the ladder';
  END IF;

  -- ---------------------------------------------------------
  -- 6. THE LADDER IS EDITABLE TOO, and a role still cannot be given
  --    sight of itself.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_portfolio_ladder('business_development', 'sales_rep', FALSE);

  PERFORM set_config('request.jwt.claim.sub', bd::TEXT, TRUE);
  IF personal_analytics_may_view(rep) THEN
    RAISE EXCEPTION 'closing a rung of the ladder changed nothing';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_portfolio_ladder('business_development', 'sales_rep', TRUE);
  BEGIN
    PERFORM set_portfolio_ladder('business_development', 'business_development', TRUE);
    RAISE EXCEPTION 'a role was given sight of itself';
  EXCEPTION WHEN OTHERS THEN
    said := SQLERRM;
    IF said = 'a role was given sight of itself' THEN RAISE; END IF;
  END;

  -- ---------------------------------------------------------
  -- 7. EVERY CHANGE LEAVES A LINE, which is what makes a grantable
  --    permission safe rather than merely convenient.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM audit_log
   WHERE action IN ('permission_change', 'role_change')
     AND (before ->> 'what' IN ('portfolio_visibility', 'portfolio_ladder')
       OR after  ->> 'what' IN ('portfolio_visibility', 'portfolio_ladder'));
  IF n < 5 THEN
    RAISE EXCEPTION 'only % audit line(s) for six changes', n;
  END IF;

  -- ---------------------------------------------------------
  -- 8. AND THE SCREEN CAN SAY WHY, without working it out itself.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  SELECT * INTO r FROM portfolio_access_for(bd) WHERE subject_id = bd2;
  IF NOT r.may_view OR r.because <> 'Given to them by name' OR NOT r.is_exception THEN
    RAISE EXCEPTION 'the screen would say "%" for a grant by name', r.because;
  END IF;
  SELECT * INTO r FROM portfolio_access_for(bd) WHERE subject_id = rep;
  IF NOT r.may_view OR r.because <> 'Their role' THEN
    RAISE EXCEPTION 'the screen would say "%" for the ladder', r.because;
  END IF;
  SELECT * INTO r FROM portfolio_access_for(bd) WHERE subject_id = bd;
  IF r.because <> 'Their own' THEN
    RAISE EXCEPTION 'the screen would say "%" for themselves', r.because;
  END IF;

  RAISE NOTICE 'portfolio grants: the ladder still holds, a name beats it both ways, and every change is on the record';
END $check$;

ROLLBACK;
