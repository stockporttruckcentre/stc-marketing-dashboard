-- =============================================================
-- 114. Starting a card from another card.
--
-- From the business, looking at the new card dialog:
--
--   in the creation wizard it says start from and the only option is
--   The current default rates - is that correct?
--
-- It was not. The pack's own `modal-new-card.html` has the field and
-- the line underneath it:
--
--   Start from:  2026 generic template
--   Or copy an existing card.
--
-- So the kit offered two ways to start and only one of them was built.
-- The field was disabled with a title saying where the defaults are
-- changed, which is honest about being unfinished but is still half of
-- a control. This is the other half.
--
-- ---- What copying takes, and what it does not ----
--
-- It takes everything that makes that card what it is: the hours, the
-- amounts, the words, the labour rates INCLUDING any custom one, and
-- the overrides somebody agreed for that customer. That is the point of
-- copying rather than starting fresh: "the same as Dole, with their
-- name on it" is the sentence being answered.
--
-- It does not take the customer, the contract, the dates, the managers
-- or the log. Those belong to the card being made, and a copied log
-- would be a record of things that happened to somebody else.
-- =============================================================

/* The signature gains an argument, so the old one is dropped rather
   than left beside it: every argument has a default, and two overloads
   that differ only by a trailing defaulted argument are ambiguous to
   call. */
DROP FUNCTION IF EXISTS rate_card_create(UUID, DATE, BOOLEAN, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION rate_card_create(
  p_contact    UUID,
  p_effective  DATE DEFAULT NULL,
  p_supersede  BOOLEAN DEFAULT FALSE,
  p_contract   UUID DEFAULT NULL,
  p_system     BOOLEAN DEFAULT FALSE,
  -- Another card to start from. Null means the current defaults, which
  -- is what almost every card starts as.
  p_copy_from  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  new_id   UUID;
  existing rate_cards%ROWTYPE;
  source   rate_cards%ROWTYPE;
  cust     crm_contacts%ROWTYPE;
  addr     TEXT;
  mgr      UUID;
  n_rates  INT;
BEGIN
  IF NOT p_system AND NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Creating a rate card needs the right to build one.';
  END IF;

  SELECT * INTO cust FROM crm_contacts WHERE id = p_contact;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No customer with that id, so there is nothing to make a rate card for.';
  END IF;

  IF p_copy_from IS NOT NULL THEN
    SELECT * INTO source FROM rate_cards WHERE id = p_copy_from;
    IF source.id IS NULL THEN
      RAISE EXCEPTION 'There is no rate card to copy from with that id.';
    END IF;
  END IF;

  SELECT * INTO existing
    FROM rate_cards
   WHERE contact_id = p_contact AND status IN ('awaiting', 'approved')
   ORDER BY effective_from DESC LIMIT 1;

  IF existing.id IS NOT NULL AND NOT p_supersede THEN
    RAISE EXCEPTION
      'A rate card already exists for % (%, effective %). Say so explicitly to replace it.',
      cust.company_name, existing.ref, existing.effective_from;
  END IF;

  SELECT COALESCE(
           NULLIF(TRIM(CONCAT_WS(', ', a.address, a.city)), ''),
           NULLIF(TRIM(cust.address), '')
         )
    INTO addr
    FROM contact_addresses a
   WHERE a.contact_id = p_contact
   ORDER BY a.is_primary DESC, a.created_at
   LIMIT 1;
  IF addr IS NULL THEN addr := NULLIF(TRIM(cust.address), ''); END IF;

  INSERT INTO rate_cards (
    contact_id, customer_name, effective_from, contract_id,
    main_contact, address, telephone, email,
    owner_id, created_by
  ) VALUES (
    p_contact, cust.company_name, COALESCE(p_effective, CURRENT_DATE), p_contract,
    NULLIF(TRIM(cust.contact_name), ''), addr,
    NULLIF(TRIM(cust.phone), ''), NULLIF(TRIM(cust.email), ''),
    current_actor(), current_actor()
  ) RETURNING id INTO new_id;

  IF p_copy_from IS NULL THEN
    /* The defaults, which is what almost every card starts as. */
    INSERT INTO rate_card_labour (card_id, pool, label, rate, charge_to, position)
    SELECT new_id, t.pool, t.label, t.rate, 'customer', t.position
      FROM rate_card_template_labour t;

    INSERT INTO rate_card_rates (
      card_id, rate_id, section, item, axle, basis,
      hours, pool, amount, text_value, cap, cap_by, position
    )
    SELECT new_id, t.rate_id, t.section, t.item, t.axle, t.basis,
           t.hours, t.pool, t.amount, t.text_value, t.cap, t.cap_by, t.position
      FROM rate_card_template t;
    GET DIAGNOSTICS n_rates = ROW_COUNT;
  ELSE
    /* Another card, whole: its labour band including anything custom,
       and its rates including what somebody agreed for that customer.
       `set_by_hand` comes across too, so a later change to the defaults
       leaves the copy alone exactly as it leaves the original alone. */
    INSERT INTO rate_card_labour (card_id, pool, label, rate, charge_to, is_custom, set_by_hand, note, position)
    SELECT new_id, l.pool, l.label, l.rate, l.charge_to, l.is_custom, l.set_by_hand, l.note, l.position
      FROM rate_card_labour l WHERE l.card_id = p_copy_from;

    INSERT INTO rate_card_rates (
      card_id, rate_id, section, item, axle, basis,
      hours, pool, amount, text_value, cap, cap_by, position,
      override_value, overridden_by, overridden_at
    )
    SELECT new_id, r.rate_id, r.section, r.item, r.axle, r.basis,
           r.hours, r.pool, r.amount, r.text_value, r.cap, r.cap_by, r.position,
           r.override_value,
           /* The override is kept, and it becomes this person's
              decision rather than staying attributed to whoever made it
              on the other customer's card. */
           CASE WHEN r.override_value IS NULL THEN NULL ELSE current_actor() END,
           CASE WHEN r.override_value IS NULL THEN NULL ELSE NOW() END
      FROM rate_card_rates r WHERE r.card_id = p_copy_from;
    GET DIAGNOSTICS n_rates = ROW_COUNT;
  END IF;

  SELECT p.id INTO mgr
    FROM profiles p
   WHERE cust.account_manager IS NOT NULL
     AND (LOWER(p.full_name) = LOWER(TRIM(cust.account_manager))
          OR LOWER(p.email) = LOWER(TRIM(cust.account_manager)))
   LIMIT 1;
  IF mgr IS NULL AND cust.assigned_to IS NOT NULL THEN
    SELECT p.id INTO mgr FROM profiles p
     WHERE LOWER(p.full_name) = LOWER(TRIM(cust.assigned_to))
        OR LOWER(p.email) = LOWER(TRIM(cust.assigned_to))
     LIMIT 1;
  END IF;
  IF mgr IS NOT NULL THEN
    INSERT INTO rate_card_managers (card_id, user_id, from_crm, position)
    VALUES (new_id, mgr, TRUE, 0) ON CONFLICT DO NOTHING;
  END IF;

  IF existing.id IS NOT NULL AND p_supersede THEN
    UPDATE rate_cards SET status = 'superseded' WHERE id = existing.id;
    PERFORM rate_card_log(existing.id, 'status', 'Superseded by a new card',
                          existing.status, 'superseded', 0, p_system);
  END IF;

  PERFORM rate_card_log(
    new_id, 'system',
    CASE
      WHEN p_copy_from IS NOT NULL
        THEN 'Card copied from ' || source.ref || ', ' || source.customer_name
      WHEN p_contract IS NOT NULL
        THEN 'Card created from a FleetSmart+ contract'
      ELSE 'Card created from the current default rates'
    END,
    NULL, NULL, n_rates, p_system);

  RETURN new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_create(UUID, DATE, BOOLEAN, UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_create(UUID, DATE, BOOLEAN, UUID, BOOLEAN, UUID) TO authenticated;


-- -------------------------------------------------------------
-- What a new card can be started from.
--
-- The defaults, and every card worth copying. Ordered so the most
-- likely answer is near the top: this customer's own previous cards
-- first, then everybody else's, newest first.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS rate_card_sources(UUID);
CREATE OR REPLACE FUNCTION rate_card_sources(p_contact UUID DEFAULT NULL)
RETURNS TABLE (
  card_id UUID, card_ref TEXT, customer_name TEXT, card_status TEXT,
  effective_from DATE, overrides INT, same_customer BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Listing rate cards needs access to the Rate Card Builder.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.ref, c.customer_name, c.status, c.effective_from,
         (SELECT COUNT(*)::INT FROM rate_card_rates r
           WHERE r.card_id = c.id AND r.override_value IS NOT NULL),
         (p_contact IS NOT NULL AND c.contact_id = p_contact)
    FROM rate_cards c
   WHERE c.status <> 'withdrawn'
   ORDER BY (p_contact IS NOT NULL AND c.contact_id = p_contact) DESC,
            c.effective_from DESC, c.created_at DESC
   LIMIT 60;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_sources(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_sources(UUID) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'a new rate card can start from the defaults or from another card'; END $$;
