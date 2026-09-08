-- =============================================================
-- 096. A lead that moves says so.
--
-- From the business:
--
--   Ensure the Last Updated column in the tracker updates when you add
--   a note/description/value etc, currently it only updates when the
--   lead is created.
--
-- Two separate faults, and this migration fixes the one that is in the
-- database. The other is in the screen: the maintenance grid put the
-- heading "Last update" above `date_of_enquiry`, which is the date the
-- enquiry came in and never changes again. That is a rename in
-- `components/SalesTracker.tsx`.
--
-- The fault here is that `crm_leads.last_activity_at` was only ever
-- written by hand. Three code paths set it (the tracker import, the
-- status route, the FleetSmart+ functions) and every other edit left it
-- alone, so a lead could be worked for a month, gain nine notes and a
-- revised value, and still read as last touched on the day it was
-- raised. `updated_at` moved on every write, but nothing shows it and
-- it also moves for reasons that are not activity.
--
-- WHAT COUNTS AS THE LEAD MOVING.
--
-- Any column except the bookkeeping ones. Written that way round on
-- purpose: an allow list of "real" columns goes stale the first time
-- somebody adds a field, and goes stale silently, which is the same
-- shape of bug as the one being fixed.
--
-- The four exclusions, and why each is not activity:
--
--   last_activity_at  writing it is not evidence of anything. Without
--                     this the trigger fires on its own writes.
--   updated_at        set by a trigger on every statement.
--   company_name      a copy kept in step by `crm_leads_carry_company`.
--                     Renaming a customer in the CRM would otherwise
--                     mark every one of their pitches as worked on.
--   shared_with       giving somebody sight of a lead is not work on it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
-- It does not cascade from the account. A tracker row shows company
-- fields alongside pitch fields, and editing the phone number writes to
-- `crm_contacts`, so a naive cascade would mark all four of Dawson's
-- open pitches as touched because somebody corrected one phone number.
-- The screen touches the lead it was edited FROM instead, which is the
-- row the person was actually looking at.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The trigger
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_lead_touch_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- `to_jsonb` minus the bookkeeping columns, compared as a whole. One
  -- comparison rather than a list of `IS DISTINCT FROM` per column, so
  -- a column added next year is covered on the day it is added.
  IF (to_jsonb(NEW) - 'last_activity_at' - 'updated_at' - 'company_name' - 'shared_with')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'last_activity_at' - 'updated_at' - 'company_name' - 'shared_with')
  THEN
    -- Only where the writer has not said so themselves. The tracker
    -- stamps this column directly when somebody edits a company field
    -- from a lead row, and a trigger that overwrites an explicit value
    -- with the same NOW() is harmless but a trigger that overwrites a
    -- deliberate backdate is not.
    IF NEW.last_activity_at IS NOT DISTINCT FROM OLD.last_activity_at THEN
      NEW.last_activity_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_touch_activity ON crm_leads;
CREATE TRIGGER crm_leads_touch_activity
  BEFORE UPDATE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_lead_touch_activity();

-- A lead is activity the moment it exists, so it starts with a date
-- rather than a blank that the column then has to explain.
CREATE OR REPLACE FUNCTION crm_lead_starts_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_activity_at IS NULL THEN NEW.last_activity_at := NOW(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_start_active ON crm_leads;
CREATE TRIGGER crm_leads_start_active
  BEFORE INSERT ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_lead_starts_active();

-- -------------------------------------------------------------
-- 2. The leads that are already here
--
-- Best available signal, in order: what the column already says, then
-- the row's own updated_at, then when it was raised. Never NULL
-- afterwards, so the screen has one thing to render rather than two.
-- -------------------------------------------------------------
UPDATE crm_leads
   SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
 WHERE last_activity_at IS NULL;

-- -------------------------------------------------------------
-- 3. Reading the tracker by when it last moved
--
-- The tracker sorts and filters on this column now, and the index that
-- exists covers open leads only, because it was written for the
-- inactive prospect nudge. A rep looking at their Customer tab sorted
-- by last touched falls outside it.
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_activity
  ON crm_leads (owner_id, last_activity_at DESC NULLS LAST);
