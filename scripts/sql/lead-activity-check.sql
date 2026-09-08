-- =============================================================
-- A lead that moves says so.
--
-- From the business:
--
--   Ensure the Last Updated column in the tracker updates when you add
--   a note/description/value etc, currently it only updates when the
--   lead is created.
--
-- Migration 096 is the half of that fix which lives in the database.
-- This proves the rule it is meant to hold rather than the state it
-- happens to leave behind:
--
--   ANY CHANGE TO WHAT A LEAD SAYS MOVES ITS LAST ACTIVITY DATE, AND
--   NOTHING ELSE DOES.
--
-- Both halves matter. A trigger that fires on everything is as useless
-- as one that fires on nothing: if renaming a customer in the CRM
-- marked all four of their pitches as worked on, the column would go
-- back to meaning nothing within a week, which is where it started.
--
-- Run with `npm run check:lead-activity`.
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

-- A customer and one pitch to them, with the activity date pushed back
-- a fortnight so that "it moved" cannot be confused with "it was always
-- now".
DO $$
DECLARE
  c UUID;
  l UUID;
BEGIN
  INSERT INTO crm_contacts (company_name, status)
  VALUES ('Activity Test Haulage', 'lead') RETURNING id INTO c;

  INSERT INTO crm_leads (contact_id, type, status, what, estimated_value, date_of_enquiry)
  VALUES (c, 'maintenance', 'lead', 'Maintenance contract', 12000, CURRENT_DATE)
  RETURNING id INTO l;

  PERFORM pg_temp.must(
    'a new lead starts with an activity date rather than a blank',
    (SELECT last_activity_at IS NOT NULL FROM crm_leads WHERE id = l));

  UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;

  PERFORM set_config('test.contact', c::TEXT, FALSE);
  PERFORM set_config('test.lead', l::TEXT, FALSE);
END $$;

-- -------------------------------------------------------------
-- 1. The things the business named, one at a time
--
-- A note, a value and a status, each from a fortnight ago, each
-- expected to land on today. Written as a loop over the columns rather
-- than three copies of the same block, because the rule is about every
-- column and not about these three.
-- -------------------------------------------------------------
DO $$
DECLARE
  l    UUID := current_setting('test.lead')::UUID;
  each RECORD;
BEGIN
  FOR each IN
    SELECT * FROM (VALUES
      ('a note',            'notes = ''Rang them, call back Thursday'''),
      ('a description',     'requirement = ''12 tractors, 30 trailers'''),
      ('an estimated value','estimated_value = 18000'),
      ('the status',        'status = ''quoted'''),
      ('the next action',   'next_action = ''Send the quote'''),
      ('what it is for',    'what = ''All services''')
    ) AS t(label, assignment)
  LOOP
    UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;
    EXECUTE format('UPDATE crm_leads SET %s WHERE id = %L', each.assignment, l);

    PERFORM pg_temp.must(
      format('adding %s moves the last activity date', each.label),
      (SELECT last_activity_at > NOW() - INTERVAL '1 minute' FROM crm_leads WHERE id = l));
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 2. And nothing else does
--
-- `company_name` on a lead is a copy kept in step by
-- `crm_leads_carry_company`, so renaming the customer writes to every
-- one of their pitches. That is bookkeeping, not work, and if it
-- counted then one rename would reset a whole tracker's worth of dates.
--
-- Proved through the rename itself rather than by writing the column
-- directly, because the trigger is what would do it in production.
-- -------------------------------------------------------------
DO $$
DECLARE
  c UUID := current_setting('test.contact')::UUID;
  l UUID := current_setting('test.lead')::UUID;
BEGIN
  UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;

  UPDATE crm_contacts SET company_name = 'Activity Test Logistics Ltd' WHERE id = c;

  PERFORM pg_temp.must(
    'renaming the customer does not mark their pitches as worked on',
    (SELECT last_activity_at < NOW() - INTERVAL '13 days' FROM crm_leads WHERE id = l));

  -- The rename did reach the lead, or the assertion above passes for
  -- the wrong reason: a trigger that stopped working would also leave
  -- the date alone.
  PERFORM pg_temp.must(
    'and the rename did reach the lead, so the line above means something',
    (SELECT company_name = 'Activity Test Logistics Ltd' FROM crm_leads WHERE id = l));
END $$;

-- Sharing a lead is not work on it either. Somebody being given sight
-- of a quote does not move the quote.
DO $$
DECLARE
  l UUID := current_setting('test.lead')::UUID;
BEGIN
  UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;
  UPDATE crm_leads SET shared_with = ARRAY[gen_random_uuid()] WHERE id = l;

  PERFORM pg_temp.must(
    'sharing a lead does not count as working it',
    (SELECT last_activity_at < NOW() - INTERVAL '13 days' FROM crm_leads WHERE id = l));
END $$;

-- -------------------------------------------------------------
-- 3. A deliberate date is left alone
--
-- The tracker stamps this column itself when somebody edits a company
-- field from a lead row, because that write goes to `crm_contacts` and
-- the trigger never sees it. A trigger that overwrote an explicit value
-- would undo the very thing that was written.
-- -------------------------------------------------------------
DO $$
DECLARE
  l    UUID := current_setting('test.lead')::UUID;
  when_set TIMESTAMPTZ := NOW() - INTERVAL '3 days';
BEGIN
  UPDATE crm_leads
     SET last_activity_at = when_set, notes = 'Edited alongside a deliberate date'
   WHERE id = l;

  PERFORM pg_temp.must(
    'a date the writer set survives the trigger',
    (SELECT last_activity_at = when_set FROM crm_leads WHERE id = l));
END $$;

-- -------------------------------------------------------------
-- 4. Every lead has one
--
-- The screen renders this column on every row, so a NULL is a blank
-- cell that has to be explained. The backfill in 096 is what makes that
-- impossible, and it is asserted over the whole table rather than over
-- the row this file made.
-- -------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.must(
    'no lead anywhere is left without a last activity date',
    NOT EXISTS (SELECT 1 FROM crm_leads WHERE last_activity_at IS NULL));
END $$;

ROLLBACK;
