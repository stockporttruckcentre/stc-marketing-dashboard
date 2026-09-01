-- =============================================================
-- Setting the status on several accounts at once.
--
-- The bulk bar in the CRM can now set the status on everything
-- selected, and the whole difficulty of that feature is one rule it
-- must not break.
--
-- Migration 043 made a company's status derive from its leads, because
-- that is how the business described it working: opening a lead on the
-- tracker moves the company. A trigger on `crm_leads` rewrites
-- `crm_contacts.status` whenever a deal moves.
--
-- So a bulk write has to split the selection. An account with no leads
-- owns its status and is written. An account with leads is left alone
-- and named, because writing it would produce a value that is wrong the
-- moment anybody touches one of those deals, and wrong in the worst
-- way: it looks like it worked.
--
-- The third assertion is the one that earns the other two. It proves
-- the failure rather than describing it: a status written directly onto
-- an account with a lead does not survive the next move on that lead.
--
-- Run with `npm run check:crm-status`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('ba000000-0000-0000-0000-000000000001', 'bulk.admin@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin', role_template_id = NULL, full_name = 'Bulk Admin'
 WHERE id = 'ba000000-0000-0000-0000-000000000001';

INSERT INTO crm_contacts (id, company_name, status) VALUES
  ('ba000000-0000-0000-0000-0000000000c1', 'No Leads Haulage', 'lead'),
  ('ba000000-0000-0000-0000-0000000000c2', 'Has Leads Logistics', 'lead')
ON CONFLICT DO NOTHING;

INSERT INTO crm_leads (id, contact_id, owner_id, status, company_name, created_by)
VALUES ('ba000000-0000-0000-0000-0000000000a1',
        'ba000000-0000-0000-0000-0000000000c2',
        'ba000000-0000-0000-0000-000000000001',
        'quoted', 'Has Leads Logistics', 'ba000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT status FROM crm_contacts WHERE id = 'ba000000-0000-0000-0000-0000000000c2') <> 'quoted' THEN
    RAISE EXCEPTION 'fixture: the account did not follow its lead, so this tests nothing';
  END IF;
  RAISE NOTICE 'ok  an account with a deal already takes its status from that deal';
END $$;

-- The split the route makes, in SQL. Only accounts with no leads.
DO $$
DECLARE direct UUID[];
BEGIN
  SELECT array_agg(c.id) INTO direct
    FROM crm_contacts c
   WHERE c.id::TEXT LIKE 'ba000000-%'
     AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id = c.id);

  IF array_length(direct, 1) <> 1 THEN
    RAISE EXCEPTION 'the split picked % accounts rather than 1', array_length(direct, 1);
  END IF;

  UPDATE crm_contacts SET status = 'contacted' WHERE id = ANY (direct);

  IF (SELECT status FROM crm_contacts WHERE id = 'ba000000-0000-0000-0000-0000000000c1') <> 'contacted' THEN
    RAISE EXCEPTION 'the account with no deals was not set';
  END IF;
  RAISE NOTICE 'ok  an account with no deals is set directly, because nothing derives its status';
END $$;

-- And why the other kind is refused rather than written.
DO $$
BEGIN
  UPDATE crm_contacts SET status = 'won'
   WHERE id = 'ba000000-0000-0000-0000-0000000000c2';

  UPDATE crm_leads SET status = 'contacted'
   WHERE id = 'ba000000-0000-0000-0000-0000000000a1';

  IF (SELECT status FROM crm_contacts WHERE id = 'ba000000-0000-0000-0000-0000000000c2') = 'won' THEN
    RAISE EXCEPTION
      'a directly written status survived the deal moving, so the route could have written it after all';
  END IF;
  RAISE NOTICE 'ok  and writing one directly is undone by the next move on its deal, which is why the route will not';
END $$;

ROLLBACK;
