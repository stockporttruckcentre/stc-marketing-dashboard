-- =============================================================
-- Which depots a deal is for, and reading the pipeline by depot.
--
-- Migration 154. Run as `authenticated`, because the owner of the
-- database bypasses row level security and a check that runs as the
-- owner proves nothing about a policy.
--
-- Run with `npm run check:depot`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
DECLARE
  rep   UUID := 'fade0000-0000-0000-0000-0000000000b1';
  other UUID := 'fade0000-0000-0000-0000-0000000000b2';
  cust  UUID;
  one   UUID;
  two   UUID;
  none_ UUID;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep, 'depot-rep@stc.example'), (other, 'depot-other@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,   'depot-rep@stc.example',   'Della Rep',  'sales', TRUE),
    (other, 'depot-other@stc.example', 'Otto Other', 'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='sales_rep')
   WHERE id IN (rep, other);
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;
  DELETE FROM crm_leads WHERE company_name = 'Depot Test Ltd';

  INSERT INTO crm_contacts (company_name) VALUES ('Depot Test Ltd') RETURNING id INTO cust;

  /* Three open deals: one for a depot, one for two, one for none. */
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Depot Test Ltd', cust, rep, rep, 'maintenance', 'quoted', 1000) RETURNING id INTO one;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Depot Test Ltd', cust, rep, rep, 'trailer_sales', 'lead', 2000) RETURNING id INTO two;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Depot Test Ltd', cust, rep, rep, 'rental', 'contacted', 4000) RETURNING id INTO none_;

  /* And a WON one, which is not open and must not be counted. */
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Depot Test Ltd', cust, rep, rep, 'maintenance', 'won', 9999);

  PERFORM set_config('stc.one', one::TEXT, FALSE);
  PERFORM set_config('stc.two', two::TEXT, FALSE);
  PERFORM set_config('stc.none', none_::TEXT, FALSE);
END $seed$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_leads TO authenticated;
GRANT SELECT ON depots TO authenticated;

SET ROLE authenticated;
DO $check$
DECLARE
  rep    UUID := 'fade0000-0000-0000-0000-0000000000b1';
  one    UUID := current_setting('stc.one')::UUID;
  two    UUID := current_setting('stc.two')::UUID;
  none_  UUID := current_setting('stc.none')::UUID;
  carr   UUID;
  bred   UUID;
  hyde   UUID;
  n      INT;
  v      NUMERIC;
  ids    UUID[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  SELECT id INTO carr FROM depots WHERE slug = 'carrington';
  SELECT id INTO bred FROM depots WHERE slug = 'bredbury';
  SELECT id INTO hyde FROM depots WHERE slug = 'hyde';
  IF carr IS NULL OR bred IS NULL OR hyde IS NULL THEN
    RAISE EXCEPTION 'the depot register did not seed';
  END IF;

  -- -----------------------------------------------------------
  -- 1. The register is the nine the command bar already knew.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM depots WHERE is_active;
  IF n <> 9 THEN RAISE EXCEPTION 'the register holds % open depots, not nine', n; END IF;

  -- Carrington first, because that is where most of the stock sits.
  IF (SELECT slug FROM depots ORDER BY sort_order LIMIT 1) <> 'carrington' THEN
    RAISE EXCEPTION 'the picker does not open on Carrington';
  END IF;

  -- -----------------------------------------------------------
  -- 2. Setting them, once and twice.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM lead_depots_set(one, ARRAY[carr]);
  IF n <> 1 THEN RAISE EXCEPTION 'setting one depot returned % rows', n; END IF;

  SELECT count(*) INTO n FROM lead_depots_set(two, ARRAY[carr, bred]);
  IF n <> 2 THEN RAISE EXCEPTION 'setting two depots returned % rows', n; END IF;

  -- The order is the register's, not the order they were passed in.
  SELECT depot_ids INTO ids FROM crm_leads WHERE id = two;
  IF ids[1] <> carr OR ids[2] <> bred THEN
    RAISE EXCEPTION 'the depots came back in the order they were typed, not the register''s';
  END IF;

  PERFORM lead_depots_set(two, ARRAY[bred, carr]);
  SELECT depot_ids INTO ids FROM crm_leads WHERE id = two;
  IF ids[1] <> carr OR ids[2] <> bred THEN
    RAISE EXCEPTION 'passing them the other way round changed the stored order';
  END IF;

  -- The same one twice is one depot.
  PERFORM lead_depots_set(one, ARRAY[carr, carr]);
  SELECT depot_ids INTO ids FROM crm_leads WHERE id = one;
  IF COALESCE(array_length(ids, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'the same depot twice stored % of them', array_length(ids, 1);
  END IF;

  -- -----------------------------------------------------------
  -- 3. An id that is not on the register takes the whole call.
  --
  -- A deal quietly holding an id that matches nothing is a deal that
  -- vanishes from every filter and appears in no report.
  -- -----------------------------------------------------------
  BEGIN
    PERFORM lead_depots_set(one, ARRAY[carr, 'fade0000-0000-0000-0000-0000000000ff'::UUID]);
    RAISE EXCEPTION 'a depot that is not on the register was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a depot that is not%' THEN RAISE; END IF;
  END;

  SELECT depot_ids INTO ids FROM crm_leads WHERE id = one;
  IF COALESCE(array_length(ids, 1), 0) <> 1 OR ids[1] <> carr THEN
    RAISE EXCEPTION 'the refused call changed the deal anyway';
  END IF;

  -- Emptying it is allowed: somebody said, and now they say not.
  PERFORM lead_depots_set(one, ARRAY[]::UUID[]);
  SELECT depot_ids INTO ids FROM crm_leads WHERE id = one;
  IF COALESCE(array_length(ids, 1), 0) <> 0 THEN
    RAISE EXCEPTION 'a deal could not have its depots taken off';
  END IF;
  PERFORM lead_depots_set(one, ARRAY[carr]);

  -- -----------------------------------------------------------
  -- 4. The pipeline, by depot.
  -- -----------------------------------------------------------
  SELECT deals, value INTO n, v FROM open_pipeline_by_depot(NULL, rep)
   WHERE depot_id = carr;
  IF n <> 2 THEN RAISE EXCEPTION 'Carrington has % open deals, not two', n; END IF;
  IF v <> 3000 THEN RAISE EXCEPTION 'Carrington is worth %, not 3000', v; END IF;

  SELECT deals, value INTO n, v FROM open_pipeline_by_depot(NULL, rep)
   WHERE depot_id = bred;
  IF n <> 1 THEN RAISE EXCEPTION 'Bredbury has % open deals, not one', n; END IF;

  -- A depot nobody has put work at is a nought, not a missing row.
  SELECT deals INTO n FROM open_pipeline_by_depot(NULL, rep) WHERE depot_id = hyde;
  IF n IS NULL THEN RAISE EXCEPTION 'a depot with no work on it is missing from the report'; END IF;
  IF n <> 0 THEN RAISE EXCEPTION 'Hyde has % open deals and should have none', n; END IF;

  -- The ones nobody has said, NAMED rather than dropped.
  SELECT deals, value INTO n, v FROM open_pipeline_by_depot(NULL, rep)
   WHERE depot_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the deals with no depot count %, not one', n; END IF;
  IF v <> 4000 THEN RAISE EXCEPTION 'the deals with no depot are worth %, not 4000', v; END IF;

  -- THE ONE THAT MATTERS. A deal for two depots is under both, so the
  -- rows come to more than the pipeline. The report says so and this
  -- says the report is right to.
  SELECT SUM(deals) INTO n FROM open_pipeline_by_depot(NULL, rep);
  IF n <> 4 THEN
    RAISE EXCEPTION 'the rows come to % and there are three open deals, so the double count is wrong', n;
  END IF;

  -- The won deal is not open and is in none of it.
  SELECT SUM(value) INTO v FROM open_pipeline_by_depot(NULL, rep);
  IF v >= 9999 THEN RAISE EXCEPTION 'a won deal is being counted in the open pipeline'; END IF;

  -- -----------------------------------------------------------
  -- 5. Narrowed by division, the depot figures move with it.
  -- -----------------------------------------------------------
  SELECT deals INTO n FROM open_pipeline_by_depot(ARRAY['maintenance'], rep)
   WHERE depot_id = carr;
  IF n <> 1 THEN RAISE EXCEPTION 'maintenance at Carrington counts %, not one', n; END IF;

  SELECT deals INTO n FROM open_pipeline_by_depot(ARRAY['maintenance'], rep)
   WHERE depot_id = bred;
  IF n <> 0 THEN RAISE EXCEPTION 'maintenance at Bredbury counts %, not none', n; END IF;

  -- -----------------------------------------------------------
  -- 6. Only a signed in person reads the register at all.
  -- -----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  SELECT count(*) INTO n FROM depots;
  IF n <> 0 THEN RAISE EXCEPTION 'the depot register is readable by nobody in particular'; END IF;
END $check$;

RESET ROLE;

-- -------------------------------------------------------------
-- 7. Somebody else's deal is not theirs to move.
-- -------------------------------------------------------------
SET ROLE authenticated;
DO $theirs$
DECLARE
  other UUID := 'fade0000-0000-0000-0000-0000000000b2';
  one   UUID := current_setting('stc.one')::UUID;
  hydeid UUID;
  ids   UUID[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', other::TEXT, TRUE);
  SELECT id INTO hydeid FROM depots WHERE slug = 'hyde';
  BEGIN
    PERFORM lead_depots_set(one, ARRAY[hydeid]);
    RAISE EXCEPTION 'a rep moved a deal that is not theirs to another depot';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a rep moved%' THEN RAISE; END IF;
  END;
END $theirs$;
RESET ROLE;

DO $after$
DECLARE one UUID := current_setting('stc.one')::UUID; ids UUID[];
BEGIN
  SELECT depot_ids INTO ids FROM crm_leads WHERE id = one;
  IF COALESCE(array_length(ids, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'the refused call changed the deal anyway';
  END IF;
END $after$;

ROLLBACK;
