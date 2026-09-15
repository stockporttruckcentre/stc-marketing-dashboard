-- =============================================================
-- 113. A FleetSmart+ contract brings its rate card with it.
--
-- From the business:
--
--   These will self-generate when a fleetsmart+ contract is built ...
--   If you go to create a contract for a CRM customer who already have
--   a fleetsmart+ contract live, automatically update these
--   inclusions/exclusions with an option to hide this whole fleetsmart+
--   section from the rate card entirely.
--
-- And from the pack, which set out what the builder owes this screen:
--
--   1. On contract create, make a rate card for that customer from the
--      current template, with fleetsmartContractId set and
--      showFleetsmartSection: true.
--   2. Set the card's effective date to the contract start date.
--   3. The card appears in the hub as a draft. Nobody has to know it
--      was created.
--   4. On contract change (tier, extras, cancellation), update every
--      card referencing it and write a System row into each card's
--      change log.
--
-- ---- Why a trigger rather than the route that creates contracts ----
--
-- Because there is more than one way a contract is created: the API
-- route, `fleetsmart_amend`, an import, and whatever is written next. A
-- rule that lives in one of those is a rule the others do not have, and
-- the business asked for this to happen when a contract is built, not
-- when a contract is built through one particular door.
--
-- ---- What it deliberately does not do ----
--
-- It never touches a card's RATES. A contract decides what is included
-- in the monthly price, not what an hour costs. So the generated card
-- starts on the current defaults like any other, and a contract change
-- moves the inclusions panel and nothing else.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The extras on a contract, as inclusion rows.
--
-- `fleetsmart_contracts.extras` is whatever the builder put there. The
-- rate card needs rows of {inclusion, tiers}, so the shape is converted
-- in one place rather than in the trigger and the screen separately.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_extras_from_contract(p_contract UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c      fleetsmart_contracts%ROWTYPE;
  out    JSONB := '[]'::JSONB;
  k      TEXT;
  v      JSONB;
BEGIN
  SELECT * INTO c FROM fleetsmart_contracts WHERE id = p_contract;
  IF NOT FOUND THEN RETURN out; END IF;

  /* An extra is anything in `extras` that is switched on. The tier it
     applies at is this contract's tier, because an extra is agreed with
     this customer on the plan they are on. */
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(c.extras, '{}'::JSONB))
  LOOP
    CONTINUE WHEN v IS NULL;
    CONTINUE WHEN jsonb_typeof(v) = 'boolean' AND NOT (v)::BOOLEAN;
    CONTINUE WHEN jsonb_typeof(v) = 'number' AND (v)::NUMERIC = 0;
    CONTINUE WHEN jsonb_typeof(v) = 'string' AND COALESCE(TRIM(v #>> '{}'), '') = '';

    out := out || JSONB_BUILD_OBJECT(
      /* The key as written, with underscores and camel case turned into
         words, because it prints on a customer's sheet. */
      'inclusion', INITCAP(REGEXP_REPLACE(REGEXP_REPLACE(k, '([a-z])([A-Z])', '\1 \2', 'g'), '[_-]+', ' ', 'g')),
      'tiers', JSONB_BUILD_ARRAY(c.plan)
    );
  END LOOP;

  RETURN out;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_extras_from_contract(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_extras_from_contract(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 2. The trigger.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_follow_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  existing UUID;
  new_card UUID;
  moved    INT := 0;
  c        RECORD;
BEGIN
  -- ---- A contract with no CRM customer has nobody to bill ----
  --
  -- A price gets built in a meeting before anybody has made a record of
  -- the company, which is why `account_id` is nullable. There is
  -- nothing to make a rate card for until it is filled in, and filling
  -- it in later fires this again as an UPDATE.
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    /* One card per contract. A contract that is saved twice, or an
       import that runs again, must not leave two. */
    SELECT id INTO existing FROM rate_cards WHERE contract_id = NEW.id LIMIT 1;
    IF existing IS NOT NULL THEN RETURN NEW; END IF;

    /* And if this customer already has a live card, the contract does
       not replace it. It links to it and brings its inclusions up to
       date, which is what the business asked for:
       "automatically update these inclusions/exclusions". */
    SELECT id INTO existing
      FROM rate_cards
     WHERE contact_id = NEW.account_id AND status IN ('draft', 'awaiting', 'approved')
     ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'awaiting' THEN 1 ELSE 2 END,
              effective_from DESC
     LIMIT 1;

    IF existing IS NOT NULL THEN
      UPDATE rate_cards
         SET contract_id = NEW.id,
             extra_inclusions = rate_card_extras_from_contract(NEW.id),
             updated_at = NOW()
       WHERE id = existing;
      PERFORM rate_card_log(existing, 'system',
        'Linked to FleetSmart+ contract ' || COALESCE(NEW.ref, '(no reference yet)'),
        NULL, NEW.plan, 0, TRUE);
      RETURN NEW;
    END IF;

    /* Nothing yet, so make one. `p_system` because this is the database
       acting on a contract rather than somebody pressing New rate card,
       and a salesman who may build a contract but not a rate card must
       still get the card their contract needs. */
    new_card := rate_card_create(
      p_contact   => NEW.account_id,
      p_effective => COALESCE(NEW.starts_on, CURRENT_DATE),
      p_supersede => FALSE,
      p_contract  => NEW.id,
      p_system    => TRUE);

    UPDATE rate_cards
       SET extra_inclusions = rate_card_extras_from_contract(NEW.id),
           show_fleetsmart = TRUE
     WHERE id = new_card;

    PERFORM rate_card_log(new_card, 'system',
      'Created with the ' || NEW.plan || ' contract ' || COALESCE(NEW.ref, ''),
      NULL, NULL, 0, TRUE);

    RETURN NEW;
  END IF;

  -- ---- The contract changed ----
  --
  -- Tier, extras, start date or status. Every card that shows this
  -- contract is brought up to date and TOLD SO in its own log, because
  -- a customer's sheet quietly changing underneath the person who sent
  -- it is the thing the log exists to make visible.
  IF TG_OP = 'UPDATE' AND (
       NEW.plan IS DISTINCT FROM OLD.plan
    OR NEW.extras IS DISTINCT FROM OLD.extras
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
  ) THEN
    FOR c IN SELECT id, status FROM rate_cards WHERE contract_id = NEW.id
    LOOP
      UPDATE rate_cards
         SET extra_inclusions = rate_card_extras_from_contract(NEW.id),
             updated_at = NOW()
       WHERE id = c.id;

      IF NEW.plan IS DISTINCT FROM OLD.plan THEN
        PERFORM rate_card_log(c.id, 'system', 'FleetSmart+ tier changed on the contract',
                              OLD.plan, NEW.plan, 0, TRUE);
      END IF;
      IF NEW.extras IS DISTINCT FROM OLD.extras THEN
        PERFORM rate_card_log(c.id, 'system', 'Extra inclusions changed on the contract',
                              NULL, NULL, 0, TRUE);
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM rate_card_log(c.id, 'system', 'FleetSmart+ contract is now ' || NEW.status,
                              OLD.status, NEW.status, 0, TRUE);
      END IF;
      moved := moved + 1;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_card_follow_contract ON fleetsmart_contracts;
CREATE TRIGGER trg_rate_card_follow_contract
  AFTER INSERT OR UPDATE ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION rate_card_follow_contract();


-- -------------------------------------------------------------
-- 3. Which rate card belongs to a contract.
--
-- Read by the FleetSmart+ builder's download step, so the rate card can
-- be generated and downloaded from beside the contract rather than by
-- going and finding it. From the business:
--
--   Ensure in the fs+ builder when presented with options to download
--   the contract you can generate/download the rate card.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_of_contract(p_contract UUID)
RETURNS TABLE (card_id UUID, card_ref TEXT, card_status TEXT, effective_from DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Finding a contract''s rate card needs access to the Rate Card Builder.';
  END IF;

  RETURN QUERY
  SELECT rc.id, rc.ref, rc.status, rc.effective_from
    FROM rate_cards rc
   WHERE rc.contract_id = p_contract
   ORDER BY rc.effective_from DESC
   LIMIT 1;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_of_contract(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_of_contract(UUID) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'a FleetSmart+ contract now brings its rate card with it'; END $$;
