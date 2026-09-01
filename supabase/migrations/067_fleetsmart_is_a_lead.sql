-- =============================================================
-- 067. A FleetSmart+ contract and its lead are one record.
--
-- From the business, in their own words:
--
--   ensure when creating a fleetsmart+ contract that it creates a lead
--   in the tracker for it. If you mark a contract as accepted in either
--   the fleetsmart+ page or the tracker page, one will update the other
--   as a shared record.
--
-- ---- What was wrong ----
--
-- `fleetsmart_contracts.lead_id` has existed since migration 061 and
-- nothing ever filled it in. The wizard offers to attach a contract to a
-- lead somebody has already made by hand, and a contract built without
-- doing that was invisible to the tracker: the pipeline figure did not
-- count it, the customer's account status did not move for it, and the
-- salesman who built it had no row to work.
--
-- So a maintenance contract worth £14,000 a year existed in one screen
-- and not the other, and the only thing keeping the two in step was
-- somebody remembering.
--
-- ---- What this does ----
--
-- Every contract gets a lead, made in the same statement as the contract
-- and never afterwards. The two then move together in both directions:
-- sending a contract quotes the lead, accepting it wins the lead, and
-- winning the lead on the tracker accepts the contract.
--
-- ---- The two statuses, and how they map ----
--
-- A contract has five states and a lead has six, and they are not the
-- same words. This is the mapping, and it is the only place it exists:
--
--   draft     contacted   being priced. Somebody is working on them,
--                         which is more than a lead and less than a
--                         quote, because nothing has gone out yet
--   sent      quoted      the price is with the customer
--   accepted  customer    signed
--   declined  lost        they said no
--   expired   lost        nobody followed it up, which is the same
--                         outcome as being turned down and is worth
--                         separating on the contract and not on the
--                         tracker
--
-- Going the other way only three lead states say anything a contract can
-- act on: `customer` and `won` accept it, `lost` declines it. Moving a
-- lead to `quoted` deliberately does NOT mark the contract sent, because
-- sending is an act with a date and an addressee on it, and a tracker
-- click is not that act.
--
-- ---- The money on the lead ----
--
-- `estimated_value` while it is open, `sale_price` once it is accepted.
-- Both are the annual total rather than the whole term, because that is
-- what the rest of the tracker means by a value and a maintenance
-- contract is sold by the year.
--
-- ---- Not a loop ----
--
-- Each side writes to the other and each write fires the other's
-- trigger, so without a guard accepting a contract would accept it
-- again through its own lead, forever. `stc.fleetsmart_sync` is set for
-- the length of the transaction while one of these is writing, and every
-- one of them stands down when it sees it.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The two mappings, as functions rather than as CASE statements
--    repeated in four triggers.
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
         END;
$fn$;

/* What a lead's status says about the contract, or nothing where it
   says nothing. `quoted` is deliberately absent: see the header. */
CREATE OR REPLACE FUNCTION fleetsmart_contract_state(p_lead_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_lead_status
           WHEN 'customer' THEN 'accepted'
           WHEN 'won'      THEN 'accepted'
           WHEN 'lost'     THEN 'declined'
         END;
$fn$;

/* Whether one of these triggers is already writing. */
CREATE OR REPLACE FUNCTION fleetsmart_syncing()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(current_setting('stc.fleetsmart_sync', true), '') = 'on';
$fn$;

-- -------------------------------------------------------------
-- 2. What a contract looks like on a tracker.
--
-- The tracker's own columns, filled from the contract. A maintenance
-- lead that came out of the builder reads as a maintenance lead, and the
-- drawer that opens it shows the plan, the fleet and the price because
-- the contract is still there behind it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_lead_words(c fleetsmart_contracts)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'what', 'FleetSmart+',
    'requirement',
      c.plan || ' plan, ' || c.term_months || ' months, '
      || c.asset_count || ' asset' || CASE WHEN c.asset_count = 1 THEN '' ELSE 's' END
      || CASE WHEN c.starts_on IS NOT NULL
              THEN ', from ' || to_char(c.starts_on, 'DD Mon YYYY') ELSE '' END,
    'notes',
      'FleetSmart+ contract ' || COALESCE(c.ref, 'not yet referenced') || '. '
      || to_char(c.annual_total, 'FM£999,999,990.00') || ' a year, '
      || to_char(c.monthly_total, 'FM£999,999,990.00') || ' a month. '
      || 'Built in the FleetSmart+ builder, and the two move together: '
      || 'winning this lead accepts the contract.'
  );
$fn$;

-- -------------------------------------------------------------
-- 3. A contract makes its lead.
--
-- Runs after the insert rather than before it, because the lead carries
-- the contract's reference and its totals and both of those are filled
-- in by the triggers from migration 061.
--
-- A contract built against a lead somebody already made keeps that lead
-- and does not make a second one. That is the wizard's "against which
-- pitch" box, and honouring it is the difference between linking two
-- records and duplicating one.
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
    /* Somebody attached it to a pitch they had already opened. Move that
       one along rather than making another, and leave its own wording
       alone: they wrote it. */
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

    /* A lead with no account is allowed and is what migration 040 calls
       a pitch with nobody named yet. It happens where a price was built
       in a meeting before anybody made the CRM record, and the name is
       carried so the row still reads. */
    IF NEW.account_id IS NULL AND NULLIF(btrim(NEW.customer_name), '') IS NOT NULL THEN
      UPDATE crm_leads SET company_name = btrim(NEW.customer_name) WHERE id = fresh;
    END IF;

    UPDATE fleetsmart_contracts SET lead_id = fresh WHERE id = NEW.id;
  END IF;

  PERFORM set_config('stc.fleetsmart_sync', '', true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS fleetsmart_makes_a_lead ON fleetsmart_contracts;
CREATE TRIGGER fleetsmart_makes_a_lead
  AFTER INSERT ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION fleetsmart_makes_a_lead();

-- -------------------------------------------------------------
-- 4. A contract moves its lead.
--
-- Status, and the price. A draft repriced from a bigger fleet is a
-- bigger number on the tracker in the same statement, because a pipeline
-- figure that is a week behind the quote is a pipeline figure nobody
-- trusts.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_moves_its_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  words JSONB;
  state TEXT;
BEGIN
  IF fleetsmart_syncing() THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.annual_total IS NOT DISTINCT FROM OLD.annual_total
     AND NEW.asset_count IS NOT DISTINCT FROM OLD.asset_count
     AND NEW.plan IS NOT DISTINCT FROM OLD.plan
     AND NEW.term_months IS NOT DISTINCT FROM OLD.term_months THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('stc.fleetsmart_sync', 'on', true);

  words := fleetsmart_lead_words(NEW);
  state := fleetsmart_lead_state(NEW.status);

  UPDATE crm_leads SET
    status = COALESCE(state, status),
    requirement = words ->> 'requirement',
    notes = words ->> 'notes',
    /* Won money moves out of the pipeline column and into the taken
       column, which is where the rest of the tracker keeps it. */
    estimated_value = CASE WHEN NEW.status = 'accepted'
                           THEN NULL ELSE NULLIF(NEW.annual_total, 0) END,
    sale_price = CASE WHEN NEW.status = 'accepted'
                      THEN NULLIF(NEW.annual_total, 0) ELSE NULL END,
    last_activity_at = NOW()
  WHERE id = NEW.lead_id;

  PERFORM set_config('stc.fleetsmart_sync', '', true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS fleetsmart_moves_its_lead ON fleetsmart_contracts;
CREATE TRIGGER fleetsmart_moves_its_lead
  AFTER UPDATE ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION fleetsmart_moves_its_lead();

-- -------------------------------------------------------------
-- 5. A lead moves its contract.
--
-- The other half of "one shared record", and the half that needed the
-- most care, because a lead can be moved by anybody who can edit the
-- tracker and a contract is a price a customer is being held to.
--
-- Two things stop that being a hole. Only `customer`, `won` and `lost`
-- say anything at all, so nothing else on the tracker touches a
-- contract. And a draft accepted from the tracker gets a `sent_at` of
-- now with a note saying where the acceptance came from, because the
-- table will not hold a contract that is not a draft and has never been
-- sent, and pretending it was sent silently would be worse than saying
-- so.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION lead_moves_its_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  state TEXT;
  note  TEXT;
BEGIN
  IF fleetsmart_syncing() THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  state := fleetsmart_contract_state(NEW.status);
  IF state IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fleetsmart_contracts
     WHERE lead_id = NEW.id AND status NOT IN ('accepted', 'declined')
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('stc.fleetsmart_sync', 'on', true);

  note := CASE state
    WHEN 'accepted' THEN 'Marked won on the tracker'
    ELSE 'Marked lost on the tracker'
  END || ' by ' || COALESCE(
    (SELECT full_name FROM profiles WHERE id = current_actor()), 'somebody');

  UPDATE fleetsmart_contracts SET
    status = state,
    decided_at = NOW(),
    decision_note = note,
    /* The constraint from migration 061: anything that is not a draft
       has a sent date. A contract won without ever being sent out of the
       application is a real thing, and this is the honest way to record
       it rather than the way that fails the insert. */
    sent_at = COALESCE(sent_at, NOW()),
    sent_to = COALESCE(sent_to, 'Not recorded, accepted from the tracker')
  WHERE lead_id = NEW.id AND status NOT IN ('accepted', 'declined');

  /* The money follows, the same way it would have coming the other way. */
  UPDATE crm_leads l SET
    sale_price = CASE WHEN state = 'accepted'
                      THEN COALESCE(l.sale_price, c.annual_total) ELSE l.sale_price END,
    estimated_value = CASE WHEN state = 'accepted' THEN NULL ELSE l.estimated_value END
  FROM fleetsmart_contracts c
  WHERE l.id = NEW.id AND c.lead_id = NEW.id;

  PERFORM set_config('stc.fleetsmart_sync', '', true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS lead_moves_its_contract ON crm_leads;
CREATE TRIGGER lead_moves_its_contract
  AFTER UPDATE OF status ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION lead_moves_its_contract();

-- -------------------------------------------------------------
-- 6. Deciding a contract, from either side, through one function.
--
-- `fleetsmart_decide` from migration 061 refuses a draft, which was
-- right when the only way to accept something was to have sent it from
-- here. The tracker can now win a deal that was priced in the
-- application and sent by hand from Outlook, so a draft is answerable,
-- and the sent date is stamped rather than assumed.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_decide(
  p_contract UUID,
  p_status   TEXT,
  p_note     TEXT DEFAULT NULL
)
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
    RAISE EXCEPTION 'You cannot record a decision on a FleetSmart+ contract.';
  END IF;
  IF p_status NOT IN ('accepted', 'declined', 'expired') THEN
    RAISE EXCEPTION 'A contract is accepted, declined or expired.';
  END IF;

  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;
  IF held.status IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'That contract was already answered on %. Build a new one.',
      to_char(held.decided_at, 'DD Mon YYYY');
  END IF;

  UPDATE fleetsmart_contracts
     SET status = p_status,
         decided_at = NOW(),
         decision_note = p_note,
         sent_at = COALESCE(sent_at, NOW()),
         sent_to = COALESCE(sent_to,
           CASE WHEN held.status = 'draft'
                THEN 'Not recorded, answered while still a draft' END)
   WHERE id = p_contract
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_decide FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_decide TO authenticated;

GRANT EXECUTE ON FUNCTION fleetsmart_lead_state(TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION fleetsmart_contract_state(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 7. Contracts already in the database.
--
-- Anything built before this migration has no lead. Runs once: the
-- second run finds nothing because every contract now has one.
-- -------------------------------------------------------------
DO $$
DECLARE
  c fleetsmart_contracts;
  words JSONB;
  fresh UUID;
  made INT := 0;
BEGIN
  PERFORM set_config('stc.fleetsmart_sync', 'on', true);

  FOR c IN SELECT * FROM fleetsmart_contracts WHERE lead_id IS NULL LOOP
    words := fleetsmart_lead_words(c);

    INSERT INTO crm_leads (
      contact_id, owner_id, created_by, type, status,
      what, requirement, notes, estimated_value, sale_price,
      company_name, date_of_enquiry, last_activity_at
    ) VALUES (
      c.account_id,
      COALESCE(c.owner_id, c.created_by),
      COALESCE(c.created_by, c.owner_id),
      'maintenance',
      COALESCE(fleetsmart_lead_state(c.status), 'contacted'),
      words ->> 'what',
      words ->> 'requirement',
      words ->> 'notes',
      CASE WHEN c.status = 'accepted' THEN NULL ELSE NULLIF(c.annual_total, 0) END,
      CASE WHEN c.status = 'accepted' THEN NULLIF(c.annual_total, 0) END,
      CASE WHEN c.account_id IS NULL
           THEN NULLIF(btrim(c.customer_name), '') END,
      COALESCE(c.starts_on, c.created_at::DATE),
      COALESCE(c.decided_at, c.sent_at, c.updated_at)
    )
    RETURNING id INTO fresh;

    UPDATE fleetsmart_contracts SET lead_id = fresh WHERE id = c.id;
    made := made + 1;
  END LOOP;

  PERFORM set_config('stc.fleetsmart_sync', '', true);

  IF made > 0 THEN
    RAISE NOTICE 'ok  % contract(s) that had no lead now have one', made;
  END IF;
END $$;

COMMENT ON FUNCTION fleetsmart_lead_state(TEXT) IS
  'The tracker status a FleetSmart+ contract status means. The only '
  'place that mapping exists.';
