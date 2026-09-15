-- =============================================================
-- The rate card's rules, asserted against a real PostgreSQL.
--
-- Every one of these is a sentence somebody said about how rate cards
-- must behave. A check that reads the SQL back proves nothing; these
-- drive the functions and assert what came out.
-- =============================================================
DO $check$
DECLARE
  boss    UUID;
  cust    UUID;
  cust2   UUID;
  card    UUID;
  card2   UUID;
  con     UUID;
  n       INT;
  m       INT;
  txt     TEXT;
  price   NUMERIC;
  failed  BOOLEAN;
BEGIN
  SELECT id INTO boss FROM profiles WHERE role_template_id IS NOT NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM crm_contacts WHERE company_name IN ('Check Haulage', 'Check Logistics');
  INSERT INTO crm_contacts (company_name, contact_name, email, phone)
  VALUES ('Check Haulage', 'Ann Check', 'ann@check.example', '0161 000 0001')
  RETURNING id INTO cust;
  INSERT INTO crm_contacts (company_name, contact_name, email, phone)
  VALUES ('Check Logistics', 'Bob Check', 'bob@check.example', '0161 000 0002')
  RETURNING id INTO cust2;

  -- ---- A card starts as the template ----
  card := rate_card_create(cust);
  SELECT COUNT(*) INTO n FROM rate_card_rates WHERE card_id = card;
  IF n <> (SELECT COUNT(*) FROM rate_card_template) THEN
    RAISE EXCEPTION 'a new card has % rates, the template has %',
      n, (SELECT COUNT(*) FROM rate_card_template);
  END IF;
  RAISE NOTICE 'a new card is the template: % priced columns', n;

  -- ---- The derived rates reproduce the signed KNDS figures ----
  SELECT r.override_value IS NULL AND rate_card_price(r, l.rate) = 157.50
    INTO failed
    FROM rate_card_rates r
    JOIN rate_card_labour l ON l.card_id = r.card_id AND l.pool = r.pool AND l.charge_to = 'customer'
   WHERE r.card_id = card AND r.item = 'HGV 7.5 ton+ A Service & Inspection' AND r.axle = 2;
  IF NOT COALESCE(failed, FALSE) THEN
    RAISE EXCEPTION 'the 2-axle HGV A service does not price to the signed 157.50';
  END IF;
  RAISE NOTICE 'derived rates price to the signed KNDS figures';

  -- ---- A labour change moves every rate that follows it, and nothing else ----
  SELECT rate_card_set_labour(card, 'hgv', 90) INTO n;
  IF n < 15 THEN RAISE EXCEPTION 'moving the HGV rate moved only % rates', n; END IF;

  SELECT rate_card_price(r, l.rate) INTO price
    FROM rate_card_rates r
    JOIN rate_card_labour l ON l.card_id = r.card_id AND l.pool = r.pool AND l.charge_to = 'customer'
   WHERE r.card_id = card AND r.item = 'Trailer Service/Inspection' AND r.axle = 1;
  IF price <> 84.00 THEN
    RAISE EXCEPTION 'moving the HGV rate moved a trailer rate to %', price;
  END IF;
  RAISE NOTICE 'a labour change moves % rates and leaves the other pools alone', n;

  -- ---- An override is a flag, not a delete ----
  PERFORM rate_card_set_rate(card, 'r25', 0, 200);
  SELECT hours IS NOT NULL INTO failed
    FROM rate_card_rates WHERE card_id = card AND rate_id = 'r25' AND axle = 0;
  IF NOT failed THEN RAISE EXCEPTION 'an override threw the hours away'; END IF;
  PERFORM rate_card_set_rate(card, 'r25', 0, NULL);
  SELECT override_value IS NULL INTO failed
    FROM rate_card_rates WHERE card_id = card AND rate_id = 'r25' AND axle = 0;
  IF NOT failed THEN RAISE EXCEPTION 'reverting left the override in place'; END IF;
  RAISE NOTICE 'an override sits beside the hours, so revert is exact';

  -- ---- A DVSA fee warns over its cap and still saves ----
  SELECT over_cap INTO failed FROM rate_card_set_rate(card, 'r36', 0, 200);
  IF NOT failed THEN RAISE EXCEPTION 'a rate over the DVSA cap did not warn'; END IF;
  SELECT override_value INTO price
    FROM rate_card_rates WHERE card_id = card AND rate_id = 'r36' AND axle = 0;
  IF price <> 200 THEN RAISE EXCEPTION 'a rate over its cap was refused rather than warned about'; END IF;
  RAISE NOTICE 'a rate over a DVSA cap warns and still saves';

  -- ---- An uplift skips the DVSA fees BY TYPE ----
  SELECT amount INTO price FROM rate_card_rates
   WHERE card_id = card AND basis = 'statutory' AND amount IS NOT NULL LIMIT 1;
  PERFORM rate_card_uplift(card, 10);
  SELECT COUNT(*) INTO n FROM rate_card_rates
   WHERE card_id = card AND basis = 'statutory' AND amount IS NOT NULL AND amount <> ROUND(amount, 2);
  SELECT COUNT(*) INTO m FROM rate_card_rates r
   WHERE r.card_id = card AND r.basis = 'statutory'
     AND r.amount IS DISTINCT FROM (SELECT t.amount FROM rate_card_template t
                                     WHERE t.rate_id = r.rate_id AND t.axle = r.axle);
  IF m > 0 THEN RAISE EXCEPTION 'an uplift moved % DVSA fee(s)', m; END IF;
  RAISE NOTICE 'an uplift leaves every DVSA fee where it was';

  -- ---- One live card per customer ----
  PERFORM rate_card_set_status(card, 'approved');
  BEGIN
    PERFORM rate_card_create(cust);
    RAISE EXCEPTION 'a second card was created for a customer who already has a live one';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already exists%' THEN
      RAISE NOTICE 'a second card is refused unless replacing is said explicitly';
    ELSE
      RAISE;
    END IF;
  END;

  -- ---- Replacing supersedes rather than duplicating ----
  card2 := rate_card_create(cust, NULL, TRUE);
  SELECT status INTO txt FROM rate_cards WHERE id = card;
  IF txt <> 'superseded' THEN
    RAISE EXCEPTION 'replacing a card left the old one as %', txt;
  END IF;
  RAISE NOTICE 'replacing a card supersedes the old one and keeps it';

  -- ---- An approved card cannot be edited ----
  BEGIN
    PERFORM rate_card_set_rate(card, 'r25', 0, 300);
    RAISE EXCEPTION 'a superseded card was edited';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%cannot be edited%' THEN
      RAISE NOTICE 'a card that is not a draft cannot be edited';
    ELSE RAISE; END IF;
  END;

  -- ---- The log cannot be edited, deleted, or taken out with its card ----
  BEGIN
    UPDATE rate_card_changes SET what = 'x' WHERE card_id = card2;
    RAISE EXCEPTION 'the change log was edited';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%permanent%' THEN NULL; ELSE RAISE; END IF;
  END;
  BEGIN
    DELETE FROM rate_card_changes WHERE card_id = card2;
    RAISE EXCEPTION 'the change log was deleted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%permanent%' THEN NULL; ELSE RAISE; END IF;
  END;
  BEGIN
    DELETE FROM rate_cards WHERE id = card2;
    RAISE EXCEPTION 'a rate card was deleted, taking its log with it';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%withdrawn, not deleted%' THEN NULL; ELSE RAISE; END IF;
  END;
  RAISE NOTICE 'the change log cannot be edited, deleted, or removed with its card';

  -- ---- A defaults change offers rather than applies ----
  PERFORM rate_card_set_labour(card2, 'hgv', 99);
  SELECT rate_card_template_set_labour('hgv', 88) INTO n;
  SELECT l.rate INTO price FROM rate_card_labour l
   WHERE l.card_id = card2 AND l.pool = 'hgv' AND l.charge_to = 'customer';
  IF price <> 99 THEN
    RAISE EXCEPTION 'changing a default changed a card somebody had set, to %', price;
  END IF;
  RAISE NOTICE 'changing a default never changes a card somebody has set';

  -- ---- And an untouched card follows when asked ----
  card := rate_card_create(cust2);
  IF NOT rate_card_is_untouched(card) THEN
    RAISE EXCEPTION 'a brand new card is reported as having been set by hand';
  END IF;
  PERFORM rate_card_template_set_labour('hgv', 77);
  SELECT rate_card_resync_all() INTO n;
  SELECT l.rate INTO price FROM rate_card_labour l
   WHERE l.card_id = card AND l.pool = 'hgv' AND l.charge_to = 'customer';
  IF price <> 77 THEN
    RAISE EXCEPTION 'an untouched card did not follow the defaults, it reads %', price;
  END IF;
  RAISE NOTICE 'an untouched card follows the defaults when asked, %  card(s) moved', n;

  -- ---- A contract brings a card with it ----
  INSERT INTO fleetsmart_contracts (account_id, customer_name, plan, term_months, starts_on, owner_id, created_by)
  SELECT c.id, 'Check Haulage 2', 'Gold', 36, '2026-11-01', boss, boss
    FROM crm_contacts c WHERE c.company_name = 'Check Haulage'
  RETURNING id INTO con;
  SELECT COUNT(*) INTO n FROM rate_cards WHERE contract_id = con;
  IF n <> 1 THEN
    RAISE EXCEPTION 'a contract produced % rate cards', n;
  END IF;
  UPDATE fleetsmart_contracts SET plan = 'Platinum' WHERE id = con;
  SELECT COUNT(*) INTO n FROM rate_card_changes ch
    JOIN rate_cards rc ON rc.id = ch.card_id
   WHERE rc.contract_id = con AND ch.what LIKE '%tier changed%';
  IF n < 1 THEN RAISE EXCEPTION 'a tier change told no card about it'; END IF;
  RAISE NOTICE 'a contract brings a card with it, and a tier change tells every card';

  -- ---- Reset clears what somebody set, deliberately ----
  PERFORM rate_card_set_rate(card, 'r25', 0, 500);
  SELECT overrides_cleared INTO n FROM rate_card_reset(card);
  IF n <> 1 THEN RAISE EXCEPTION 'reset cleared % overrides, expected 1', n; END IF;
  RAISE NOTICE 'reset to defaults clears what somebody set, and says how many';

  RAISE NOTICE 'every rate card rule holds';
END
$check$;
