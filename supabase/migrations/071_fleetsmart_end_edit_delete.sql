-- =============================================================
-- 071. Ending, editing and deleting a FleetSmart+ contract.
--
-- From the business:
--
--   Now I need actions to be able to end a contract manually or just
--   entirely delete the record. This applies to the row on the
--   fleetsmart+ page, when i click in to an accepted record where you
--   currently have copy/print buttons, a with customer record where you
--   have accepted/denied buttons we need to be able to edit or just
--   delete entirely from the app with a warning.
--
-- ---- Three verbs, and why each needed its own ----
--
-- END is a new state. A contract that ran its course and stopped is not
-- declined and it is not expired: `declined` means the customer said no
-- and `expired` means nobody followed it up. Both describe a contract
-- that was never won. An accepted contract that has finished was won,
-- was paid, and is now over, and folding it into either of the others
-- would put a customer in the lost column and take real revenue out of
-- every figure that reads it.
--
-- EDIT is a hole in a rule that migration 061 put there on purpose:
--
--   The price is in the customer's inbox: changing the record behind it
--   is how the two copies stop agreeing, and only one of them is
--   enforceable.
--
-- That reasoning still stands and this does not throw it away. Editing
-- a contract that has gone out is a deliberate act, needs the
-- permission that sets prices rather than the one that builds, and is
-- recorded on the row: `reopened_at`, `reopened_by`, and the status it
-- was in when somebody took it back. A price that changed after the
-- customer saw it is then a fact anybody can read rather than a
-- difference nobody can explain.
--
-- DELETE is the destructive one, so it is the one with the most
-- deliberate shape. See below.
--
-- ---- What deleting a contract does to its tracker lead ----
--
-- Migration 067 made the two one record, so deleting one has to say
-- what happens to the other, and the answer is not the same in both
-- cases.
--
-- A contract that made its own lead owns it. Nobody typed that lead, it
-- exists because the contract does, and leaving it behind leaves a
-- maintenance lead on somebody's tracker quoting a reference that no
-- longer resolves. That goes with the contract.
--
-- A contract attached to a pitch somebody had already opened does not
-- own it. That lead is their work, it predates the contract, and it
-- stays exactly where it is.
--
-- `made_its_lead` is what tells the two apart, set by the trigger at the
-- moment the lead is created rather than guessed at later.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The new state, and the columns that record who did what.
-- -------------------------------------------------------------
ALTER TABLE fleetsmart_contracts DROP CONSTRAINT IF EXISTS fleetsmart_contracts_status_check;
ALTER TABLE fleetsmart_contracts ADD CONSTRAINT fleetsmart_contracts_status_check
  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'ended'));

ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS ended_at    TIMESTAMPTZ;
ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS ended_note  TEXT;

-- Taken back for editing after it had gone out. Kept so a price that
-- changed after the customer saw it is a fact rather than a mystery.
ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS reopened_at   TIMESTAMPTZ;
ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS reopened_by   UUID REFERENCES auth.users ON DELETE SET NULL;
ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS reopened_from TEXT;

-- Whether the lead on the other end is this contract's to delete.
ALTER TABLE fleetsmart_contracts ADD COLUMN IF NOT EXISTS made_its_lead BOOLEAN NOT NULL DEFAULT FALSE;

/* The constraint from 061 says anything that is not a draft has a sent
   date. `ended` is not a draft, so it needs one, and every contract that
   can be ended has been sent by definition. Restated rather than
   assumed, because the constraint was dropped and rebuilt above. */
ALTER TABLE fleetsmart_contracts DROP CONSTRAINT IF EXISTS fleetsmart_sent_has_a_date;
ALTER TABLE fleetsmart_contracts ADD CONSTRAINT fleetsmart_sent_has_a_date CHECK (
  (status = 'draft') OR (status <> 'draft' AND sent_at IS NOT NULL)
);

-- -------------------------------------------------------------
-- 2. Which leads this application made.
--
-- Backfilled from the note the trigger writes, which is the only thing
-- that writes that wording, so a lead somebody typed by hand is never
-- mistaken for one the builder created. Runs once and finds nothing the
-- second time.
-- -------------------------------------------------------------
UPDATE fleetsmart_contracts c
   SET made_its_lead = TRUE
  FROM crm_leads l
 WHERE l.id = c.lead_id
   AND l.notes LIKE 'FleetSmart+ contract %'
   AND NOT c.made_its_lead;

-- -------------------------------------------------------------
-- 3. An ended contract leaves its lead alone.
--
-- The company was won and the money was taken. Ending the contract does
-- not un-win it, so the tracker keeps saying customer, which is true:
-- they are an existing customer whose contract has finished. Returning
-- nothing here is what `fleetsmart_moves_its_lead` reads as "do not
-- touch the status".
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_lead_state(p_contract_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_contract_status
           WHEN 'draft'    THEN 'contacted'
           WHEN 'sent'     THEN 'quoted'
           WHEN 'accepted' THEN 'customer'
           WHEN 'declined' THEN 'lost'
           WHEN 'expired'  THEN 'lost'
           ELSE NULL
         END;
$fn$;

-- -------------------------------------------------------------
-- 4. Ending one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_end(p_contract UUID, p_note TEXT DEFAULT NULL)
RETURNS fleetsmart_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result fleetsmart_contracts;
  held   fleetsmart_contracts;
BEGIN
  IF NOT command_may('fleetsmart.build') THEN
    RAISE EXCEPTION 'Ending a FleetSmart+ contract needs more access than you have.';
  END IF;

  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;
  IF held.status = 'ended' THEN
    RAISE EXCEPTION 'That contract already ended on %.', to_char(held.ended_at, 'DD Mon YYYY');
  END IF;
  IF held.status <> 'accepted' THEN
    RAISE EXCEPTION
      'Only a contract the customer accepted can be ended. That one is %, so the answer to record is declined or expired.',
      held.status;
  END IF;

  UPDATE fleetsmart_contracts
     SET status = 'ended', ended_at = NOW(), ended_note = NULLIF(btrim(p_note), '')
   WHERE id = p_contract
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_end FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_end TO authenticated;

-- -------------------------------------------------------------
-- 5. Taking one back to edit it.
--
-- Puts it back to draft, which is the one state the builder can write
-- to, and records that it happened. The permission is the one that sets
-- prices rather than the one that builds a contract, because this is the
-- act of changing a number a customer has already seen.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_reopen(p_contract UUID)
RETURNS fleetsmart_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result fleetsmart_contracts;
  held   fleetsmart_contracts;
BEGIN
  IF NOT command_may('fleetsmart.discount') THEN
    RAISE EXCEPTION
      'Editing a contract the customer already has is the permission that sets prices, which you do not have. Copy it to a new draft instead.';
  END IF;

  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;
  IF held.status = 'draft' THEN
    RAISE EXCEPTION 'That one is already a draft, so it can be opened and edited as it is.';
  END IF;

  UPDATE fleetsmart_contracts
     SET status = 'draft',
         reopened_at = NOW(),
         reopened_by = current_actor(),
         /* The state it was taken back from, so the row still says what
            the customer was told before somebody changed it. */
         reopened_from = held.status,
         decided_at = NULL,
         decision_note = CASE
           WHEN held.decision_note IS NULL THEN NULL
           ELSE held.decision_note || ' (taken back for editing on '
                || to_char(NOW(), 'DD Mon YYYY') || ')'
         END
   WHERE id = p_contract
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_reopen FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_reopen TO authenticated;

-- -------------------------------------------------------------
-- 6. Deleting one.
--
-- A draft is its owner's to throw away and always has been, through the
-- policy migration 061 wrote. Anything that has gone to a customer is a
-- different thing entirely: it is a record of what STC offered and what
-- somebody agreed to, so removing it needs the permission that sets
-- prices, and it takes the lead it created with it.
--
-- The interface asks before calling this. So does this, in its own way:
-- it names what it is about to remove in the row it returns, so the
-- screen can say what happened rather than only that something did.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_delete(p_contract UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  held      fleetsmart_contracts;
  lead_gone BOOLEAN := FALSE;
  lead_kept TEXT;
BEGIN
  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;

  IF held.status = 'draft' THEN
    /* The rule 061 already set: your own draft, and you can build. */
    IF NOT command_may('fleetsmart.build') THEN
      RAISE EXCEPTION 'Deleting a draft needs more access than you have.';
    END IF;
    IF held.owner_id IS DISTINCT FROM current_actor()
       AND held.created_by IS DISTINCT FROM current_actor()
       AND NOT command_may('fleetsmart.discount') THEN
      RAISE EXCEPTION 'That draft belongs to somebody else. Ask them, or copy it.';
    END IF;
  ELSE
    IF NOT command_may('fleetsmart.discount') THEN
      RAISE EXCEPTION
        'That contract has been to a customer, so deleting it needs the permission that sets prices. Ask an administrator.';
    END IF;
  END IF;

  /* Notifications about it, which would otherwise link to nothing. */
  DELETE FROM notifications
   WHERE subject_kind = 'contract' AND subject_id = p_contract;

  IF held.lead_id IS NOT NULL THEN
    IF held.made_its_lead THEN
      /* Ours, because the contract created it. The status trigger from
         043 runs on the delete and puts the account's status back to
         whatever its remaining leads say, which is the right answer. */
      DELETE FROM crm_leads WHERE id = held.lead_id;
      lead_gone := TRUE;
    ELSE
      SELECT COALESCE(NULLIF(btrim(l.requirement), ''), 'a lead somebody opened')
        INTO lead_kept
        FROM crm_leads l WHERE l.id = held.lead_id;
    END IF;
  END IF;

  DELETE FROM fleetsmart_contracts WHERE id = p_contract;

  RETURN jsonb_build_object(
    'ref', held.ref,
    'customer', held.customer_name,
    'was', held.status,
    'lead_deleted', lead_gone,
    'lead_kept', lead_kept
  );
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_delete FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_delete TO authenticated;

-- -------------------------------------------------------------
-- 7. The trigger records which leads it made.
--
-- Replaces the one from 067 so `made_its_lead` is set at the moment the
-- lead is created rather than worked out afterwards from its wording.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_makes_a_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  words JSONB;
  fresh UUID;
BEGIN
  IF fleetsmart_syncing() THEN RETURN NEW; END IF;
  PERFORM set_config('stc.fleetsmart_sync', 'on', true);

  words := fleetsmart_lead_words(NEW);

  IF NEW.lead_id IS NOT NULL THEN
    UPDATE crm_leads
       SET status = COALESCE(fleetsmart_lead_state(NEW.status), status),
           estimated_value = COALESCE(NULLIF(NEW.annual_total, 0), estimated_value),
           last_activity_at = NOW()
     WHERE id = NEW.lead_id;
  ELSE
    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status,
      what, requirement, notes, estimated_value,
      date_of_enquiry, last_activity_at
    ) VALUES (
      NEW.account_id,
      COALESCE(NEW.owner_id, NEW.created_by),
      COALESCE(NEW.created_by, NEW.owner_id),
      'maintenance',
      COALESCE(fleetsmart_lead_state(NEW.status), 'contacted'),
      words ->> 'what',
      words ->> 'requirement',
      words ->> 'notes',
      NULLIF(NEW.annual_total, 0),
      COALESCE(NEW.starts_on, CURRENT_DATE),
      NOW()
    )
    RETURNING id INTO fresh;

    IF NEW.account_id IS NULL AND NULLIF(btrim(NEW.customer_name), '') IS NOT NULL THEN
      UPDATE crm_leads SET company_name = btrim(NEW.customer_name) WHERE id = fresh;
    END IF;

    /* Ours, and recorded as such, so deleting the contract knows
       whether the lead goes with it. */
    UPDATE fleetsmart_contracts
       SET lead_id = fresh, made_its_lead = TRUE
     WHERE id = NEW.id;
  END IF;

  PERFORM set_config('stc.fleetsmart_sync', '', true);
  RETURN NEW;
END;
$fn$;

-- -------------------------------------------------------------
-- 8. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF fleetsmart_lead_state('ended') IS NOT NULL THEN
    RAISE EXCEPTION 'an ended contract is moving its lead, and it should leave it alone';
  END IF;
  IF fleetsmart_lead_state('accepted') <> 'customer' THEN
    RAISE EXCEPTION 'accepting no longer wins the lead';
  END IF;
  RAISE NOTICE 'ok  a contract can be ended, taken back for editing, or deleted';
END $$;

COMMENT ON COLUMN fleetsmart_contracts.made_its_lead IS
  'Whether this contract created the lead it points at. Deleting the '
  'contract takes that lead with it; a lead somebody opened first stays.';
COMMENT ON COLUMN fleetsmart_contracts.reopened_from IS
  'The state a contract was taken back from to be edited, so a price '
  'that changed after the customer saw it is a fact and not a mystery.';
