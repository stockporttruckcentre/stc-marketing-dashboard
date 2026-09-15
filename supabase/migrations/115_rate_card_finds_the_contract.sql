-- =============================================================
-- 115. A new card finds the contract the customer already has.
--
-- From the business:
--
--   seeing "FleetSmart+ section / No contract ... This customer is not
--   on FleetSmart+" on Paul Hamlett Lifting who have an accepted
--   FleetSmart+ contract so you didn't wire that too.
--
-- Right, and the hole is obvious in hindsight. Migration 113 links a
-- card to a contract when the CONTRACT is created, which covers a
-- contract built from today onwards. Nothing looked the other way: a
-- card made on the Rate Card Builder for a customer who already holds a
-- contract was created with `contract_id` null and drew the "no
-- contract" panel, which is a plain lie about that customer.
--
-- Two halves here: new cards find the contract, and the cards that
-- already exist are linked to theirs.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The contract a customer is actually on.
--
-- Accepted first, because that is a contract they hold. Then sent,
-- because a price they have been given and not yet answered is still
-- the tier the card should describe. Declined and expired are neither.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_live_contract(p_contact UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT f.id
    FROM fleetsmart_contracts f
   WHERE f.account_id = p_contact
     AND f.status IN ('accepted', 'sent')
   ORDER BY CASE f.status WHEN 'accepted' THEN 0 ELSE 1 END,
            f.starts_on DESC NULLS LAST,
            f.created_at DESC
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION rate_card_live_contract(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_live_contract(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 2. Creating a card looks for one.
--
-- `p_contract` is still honoured when it is passed, because the
-- FleetSmart+ trigger passes the contract it has just made and must not
-- be second guessed. When it is not passed, the customer is asked.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_link_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  found UUID;
BEGIN
  IF NEW.contract_id IS NOT NULL OR NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  found := rate_card_live_contract(NEW.contact_id);
  IF found IS NULL THEN RETURN NEW; END IF;

  NEW.contract_id := found;
  NEW.extra_inclusions := rate_card_extras_from_contract(found);
  NEW.show_fleetsmart := TRUE;
  RETURN NEW;
END;
$fn$;

/* BEFORE INSERT, so the row lands with the link already on it rather
   than being corrected a moment later. A card has never existed without
   its contract, which is what makes the panel right on first paint. */
DROP TRIGGER IF EXISTS trg_rate_card_link_contract ON rate_cards;
CREATE TRIGGER trg_rate_card_link_contract
  BEFORE INSERT ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION rate_card_link_contract();


-- -------------------------------------------------------------
-- 3. And the cards that already exist.
--
-- Every card made before this migration, linked to the contract its
-- customer holds, with a line in its own log saying so. A card whose
-- customer has no contract is left alone.
-- -------------------------------------------------------------
DO $backfill$
DECLARE
  c       RECORD;
  found   UUID;
  linked  INT := 0;
BEGIN
  FOR c IN
    SELECT rc.id, rc.ref, rc.contact_id, rc.customer_name
      FROM rate_cards rc
     WHERE rc.contract_id IS NULL AND rc.contact_id IS NOT NULL
  LOOP
    found := rate_card_live_contract(c.contact_id);
    CONTINUE WHEN found IS NULL;

    UPDATE rate_cards
       SET contract_id = found,
           extra_inclusions = rate_card_extras_from_contract(found),
           updated_at = NOW()
     WHERE id = c.id;

    PERFORM rate_card_log(
      c.id, 'system',
      'Linked to the FleetSmart+ contract this customer already held',
      NULL,
      (SELECT f.plan FROM fleetsmart_contracts f WHERE f.id = found),
      0, TRUE);

    linked := linked + 1;
  END LOOP;

  RAISE NOTICE 'rate cards linked to a contract their customer already held: %', linked;
END
$backfill$;

DO $$ BEGIN RAISE NOTICE 'a rate card finds the contract its customer is on, whichever was made first'; END $$;
