-- =============================================================
-- Asking for something you may not do, and being in charge of somebody.
--
-- From the business:
--
--   Ensure everything connects to something though - if one role cannot
--   export and one can, ensure the button states reflect this across the
--   accounts, that one user understand why they don't have access and
--   who to contact to perform that task.
--
--   BD - this is tom's role, he manages sales and marketing departments.
--   He needs everything they have and ways of managing them.
--
--   the only difference here is that they're the sales overseer, so like
--   when you mark a crm customer as red it'll alert Sr Sales etc.
--
-- Everything below can only be proved against a real database, because
-- every one of them is a refusal, and a refusal that quietly stops being
-- a refusal looks exactly like a feature working.
--
--   1. A REFUSAL NAMES A ROLE. Dean cannot export the CRM, and the
--      screen has to be able to say who can. It walks the chain, so
--      approving a post skips past Sr Sales, who cannot do it either.
--   2. YOU CANNOT DECIDE FOR SOMEBODY YOU DO NOT RUN. Sr Admin holds
--      access.decide. That must not let them hand a salesperson the CRM
--      export.
--   3. YOU CANNOT GRANT WHAT YOU DO NOT HOLD. Otherwise access.decide
--      is a way of manufacturing access nobody has.
--   4. NOBODY DECIDES THEIR OWN. The obvious way back in.
--   5. TOM RUNS SALES AND MARKETING AND NOT FINANCE. The whole point of
--      admin.usersDepartment being narrower than admin.users.
--   6. A RED ACCOUNT REACHES THE SALES LEADS. Owner, Sr Sales, BD.
--
-- Run with `npm run check:asking`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

/* One person on one of the eleven roles.
 *
 * Made here rather than relying on migration 104's seven, because this
 * file has to be able to make a Sr Sales and a Sr Admin and neither of
 * those is a real account yet. */
CREATE OR REPLACE FUNCTION pg_temp.person(p_email TEXT, p_name TEXT, p_slug TEXT)
RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  made UUID;
  was  TEXT := current_setting('request.jwt.claim.sub', TRUE);
BEGIN
  /* Nobody, while the fixture is being made. `profiles_guard_privileges`
     refuses a role_template_id written by anybody who is not an
     administrator, and lets a null actor through as the service role,
     which is what a seeder is. Put back afterwards, so a fixture made
     halfway through the file does not quietly change who the next
     assertion is speaking as. */
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);

  SELECT id INTO made FROM auth.users WHERE email = p_email;
  IF made IS NULL THEN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', p_email, 'x',
            NOW(), NOW(), NOW(), '{}'::JSONB, '{}'::JSONB)
    RETURNING id INTO made;
  END IF;

  INSERT INTO profiles (id, email, full_name, role, role_template_id)
  VALUES (made, p_email, p_name, 'viewer',
          (SELECT id FROM role_templates WHERE slug = p_slug))
  ON CONFLICT (id) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         role_template_id = EXCLUDED.role_template_id;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(was, ''), TRUE);
  RETURN made;
END;
$fn$;

DO $$
DECLARE
  dean    UUID;
  srsales UUID;
  tom     UUID;
  sradmin UUID;
  wayne   UUID;
  req     UUID;
  got     RECORD;
  n       INTEGER;
  cust    UUID;
BEGIN
  dean    := pg_temp.person('check.dean@stc-uk.test',    'Check Dean',     'sales_rep');
  srsales := pg_temp.person('check.srsales@stc-uk.test', 'Check Sr Sales', 'sr_sales');
  tom     := pg_temp.person('check.tom@stc-uk.test',     'Check Tom',      'business_development');
  sradmin := pg_temp.person('check.sradmin@stc-uk.test', 'Check Sr Admin', 'sr_office_admin');
  wayne   := pg_temp.person('check.wayne@stc-uk.test',   'Check Wayne',    'sr_finance');

  -- ===========================================================
  -- 1. A refusal names a role, and it names the RIGHT one.
  -- ===========================================================
  PERFORM pg_temp.act_as(dean);

  SELECT * INTO got FROM escalation_for('crm.export');
  PERFORM pg_temp.must('a salesperson refused the CRM export is told to ask Sr Sales',
    got.slug = 'sr_sales');

  SELECT * INTO got FROM escalation_for('stock.export');
  PERFORM pg_temp.must('and the same for the stock list, which is the one that walks out of the door',
    got.slug = 'sr_sales');

  /* Sr Sales cannot approve a post either, so the chain has to carry on
     past them rather than stopping at the first rung. A version that
     returned the immediate senior would name somebody who would then
     have to refuse, which is worse than naming nobody. */
  SELECT * INTO got FROM escalation_for('social.approve');
  PERFORM pg_temp.must('approving a post skips Sr Sales, who cannot do it either, and names BD',
    got.slug = 'business_development');

  got := NULL;
  SELECT * INTO got FROM escalation_for('crm.view');
  PERFORM pg_temp.must('and something they can already do names nobody', got.slug IS NULL);

  -- ===========================================================
  -- 2. Asking.
  -- ===========================================================
  req := request_capability('crm.export', 'Send Tom the Carrington list', 'He asked in the meeting');
  PERFORM pg_temp.must('a salesperson can ask for what they were refused',
    (SELECT status FROM capability_requests WHERE id = req) = 'pending');

  PERFORM pg_temp.must('asking twice is the same ask rather than a second row',
    request_capability('crm.export', 'again') = req);

  BEGIN
    PERFORM request_capability('crm.view');
    PERFORM pg_temp.must('asking for something you already have is refused', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('asking for something you already have is refused',
      SQLERRM LIKE '%already%');
  END;

  -- ===========================================================
  -- 3. Deciding, and the three ways it must be refused.
  -- ===========================================================

  /* Nobody decides their own. */
  BEGIN
    PERFORM decide_capability_request(req, TRUE);
    PERFORM pg_temp.must('nobody approves their own request', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('nobody approves their own request', TRUE);
  END;

  /* Sr Admin holds access.decide and runs the office administrators.
     They must not be able to decide for somebody in sales. */
  PERFORM pg_temp.act_as(sradmin);
  PERFORM pg_temp.must('Sr Admin does hold the right to decide, so this is not a permission accident',
    command_may('access.decide'));
  BEGIN
    PERFORM decide_capability_request(req, TRUE);
    PERFORM pg_temp.must('Sr Admin cannot decide for a salesperson', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('Sr Admin cannot decide for a salesperson',
      SQLERRM LIKE '%not in a department you run%');
  END;

  /* Sr Sales runs sales and holds the export, so this one goes through.
     Refuse it first, to prove a refusal is recorded as a refusal and
     does not hand anything over. */
  PERFORM pg_temp.act_as(srsales);
  PERFORM decide_capability_request(req, FALSE, 'Not for a list that size');
  PERFORM pg_temp.must('a refusal is recorded as one',
    (SELECT status FROM capability_requests WHERE id = req) = 'refused');

  PERFORM pg_temp.act_as(dean);
  PERFORM pg_temp.must('and a refused request hands over nothing',
    NOT command_may('crm.export'));

  PERFORM pg_temp.must('the reason is kept, so the answer is not silence',
    (SELECT note FROM capability_requests WHERE id = req) = 'Not for a list that size');

  BEGIN
    PERFORM pg_temp.act_as(srsales);
    PERFORM decide_capability_request(req, TRUE);
    PERFORM pg_temp.must('a request that was already decided cannot be decided again', FALSE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.must('a request that was already decided cannot be decided again',
      SQLERRM LIKE '%already%');
  END;

  -- Ask again, and this time it is granted.
  PERFORM pg_temp.act_as(dean);
  req := request_capability('crm.export', 'Send Tom the Carrington list');
  PERFORM pg_temp.act_as(srsales);
  PERFORM decide_capability_request(req, TRUE, 'The Carrington list only',
                                    NOW() + INTERVAL '2 days');

  PERFORM pg_temp.act_as(dean);
  PERFORM pg_temp.must('an approved request actually hands the capability over',
    command_may('crm.export'));
  PERFORM pg_temp.must('and it can be handed over until Thursday rather than for ever',
    (SELECT expires_at FROM user_capability_overrides
      WHERE user_id = dean AND capability = 'crm.export') IS NOT NULL);

  -- ===========================================================
  -- 4. You cannot grant what you do not hold.
  --
  -- Sr Admin runs the office administrators, so they CAN decide for one
  -- of them. What they must not be able to do is conjure a capability
  -- their own role refuses them.
  -- ===========================================================
  DECLARE
    clerk UUID := pg_temp.person('check.clerk@stc-uk.test', 'Check Clerk', 'office_admin');
    ask   UUID;
  BEGIN
    PERFORM pg_temp.act_as(clerk);
    ask := request_capability('crm.export', 'A list for the auditors');

    PERFORM pg_temp.act_as(sradmin);
    /* `in_charge_of` and not `may_manage_user`. Sr Admin runs the office
       administrators and cannot edit anybody's account, which is right:
       only Tom and the two roles with `admin.users` do that. Being
       somebody's lead and being able to edit their account are separate
       questions and this file asserts them separately. */
    PERFORM pg_temp.must('Sr Admin is in charge of an office administrator',
      in_charge_of(clerk));
    PERFORM pg_temp.must('and cannot edit their account, because running a department is not administering one',
      NOT may_manage_user(clerk));
    PERFORM pg_temp.must('and does not hold the CRM export themselves',
      NOT command_may('crm.export'));

    BEGIN
      PERFORM decide_capability_request(ask, TRUE);
      PERFORM pg_temp.must('so they cannot grant it', FALSE);
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.must('so they cannot grant it',
        SQLERRM LIKE '%do not have it yourself%');
    END;

    /* Refusing it is still theirs to do. A lead who can only ever say
       yes is not a lead. */
    PERFORM decide_capability_request(ask, FALSE, 'Ask Sr Sales for that one');
    PERFORM pg_temp.must('but refusing it is still theirs to do',
      (SELECT status FROM capability_requests WHERE id = ask) = 'refused');
  END;

  -- ===========================================================
  -- 5. Tom runs sales and marketing. Not finance.
  -- ===========================================================
  PERFORM pg_temp.act_as(tom);
  PERFORM pg_temp.must('Tom can edit a salesperson''s account',   may_manage_user(dean));
  PERFORM pg_temp.must('and the sales lead''s',                   may_manage_user(srsales));
  PERFORM pg_temp.must('and not the finance director''s',         NOT may_manage_user(wayne));
  PERFORM pg_temp.must('and not the admin lead''s',               NOT may_manage_user(sradmin));
  PERFORM pg_temp.must('and not his own',                         NOT may_manage_user(tom));
  PERFORM pg_temp.must('and he does not hold the right that reaches everybody',
    NOT command_may('admin.users'));
  PERFORM pg_temp.must('he holds the narrower one instead',
    command_may('admin.usersDepartment'));

  DECLARE
    marketer UUID := pg_temp.person('check.marketer@stc-uk.test', 'Check Marketer', 'marketing_exec');
  BEGIN
    PERFORM pg_temp.act_as(tom);
    PERFORM pg_temp.must('and he reaches marketing as well as sales',
      may_manage_user(marketer));

    /* The sales lead runs sales and nothing else, which is the half that
       proves the department is doing the work rather than seniority. */
    PERFORM pg_temp.act_as(srsales);
    PERFORM pg_temp.must('the sales lead is not in charge of a marketer',
      NOT in_charge_of(marketer));
    PERFORM pg_temp.must('and is in charge of their own salesperson',
      in_charge_of(dean));
  END;

  /* Somebody with no role at all belongs to no department, and a
     department lead is not in charge of them. Erring towards refusal
     matters here: the other way round hands Tom the finance director on
     the day somebody forgets to set a role. */
  DECLARE
    nobody UUID := pg_temp.person('check.nobody@stc-uk.test', 'Check Nobody', 'sales_rep');
  BEGIN
    /* As nobody, for the same reason `pg_temp.person` is: the guard on
       `profiles` refuses a role_template_id written by anybody who is
       not an administrator, and this file is standing up a fixture
       rather than exercising that rule. */
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    UPDATE profiles SET role_template_id = NULL WHERE id = nobody;
    PERFORM pg_temp.act_as(tom);
    PERFORM pg_temp.must('somebody with no role yet is nobody''s to manage',
      NOT may_manage_user(nobody) AND NOT in_charge_of(nobody));
  END;

  -- ===========================================================
  -- 6. A red account reaches the sales leads.
  -- ===========================================================
  PERFORM pg_temp.act_as(NULL);
  SELECT set_config('request.jwt.claim.sub', '', FALSE) INTO got;

  INSERT INTO crm_contacts (company_name, assigned_to)
  VALUES ('TEST red flag audience', 'Check Dean')
  RETURNING id INTO cust;

  SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = dean;
  PERFORM pg_temp.must('the owner hears when their account goes red', n = 1);

  SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = srsales;
  PERFORM pg_temp.must('so does Sr Sales', n = 1);

  SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = tom;
  PERFORM pg_temp.must('and so does BD', n = 1);

  SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = wayne;
  PERFORM pg_temp.must('and the finance director does not, because he does not run sales', n = 0);

  /* And it is driven off the role rather than a list of two slugs. Put
     somebody else in charge of sales and they hear about it, which is
     the whole reason `manages` is a column instead of an IN clause. */
  DECLARE
    stand_in UUID := pg_temp.person('check.standin@stc-uk.test', 'Check Stand In', 'sr_marketing');
  BEGIN
    SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = stand_in;
    PERFORM pg_temp.must('somebody who runs marketing does not hear about a red account', n = 0);

    UPDATE role_templates SET manages = ARRAY['marketing', 'sales'] WHERE slug = 'sr_marketing';
    SELECT count(*) INTO n FROM crm_red_flag_audience(cust) a WHERE a.user_id = stand_in;
    PERFORM pg_temp.must('and does the moment their role is put in charge of sales', n = 1);
    UPDATE role_templates SET manages = ARRAY['marketing'] WHERE slug = 'sr_marketing';
  END;

  /* The function that sends it is looking at the wider audience, which
     is the line migration 105 patches and the one thing that makes all
     of the above reach anybody. */
  PERFORM pg_temp.must('and crm_set_health sends to that audience rather than the owners alone',
    (SELECT p.prosrc LIKE '%crm_red_flag_audience(p_contact)%'
       FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = 'crm_set_health'));

  DELETE FROM crm_contacts WHERE id = cust;
END $$;

ROLLBACK;
