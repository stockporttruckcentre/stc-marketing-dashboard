-- =============================================================
-- 070. The rate card, editable.
--
-- From the business:
--
--   Add an extra tab ... that says Rate Editor and in there you can
--   update all the default rates that the fleetsmart+ builder is using
--   which avoids me having to import a new rate card down the line.
--
-- ---- Where the rates were ----
--
-- In `lib/fleetsmart/ratecard.ts`, lifted 1:1 from the workbook's Rates
-- tab. That file's own header says migration 061 seeds
-- `fleetsmart_rates` from it and that the database is what the running
-- application prices from. Neither was true. There was no such table
-- and 061 never made one, so a price rise meant editing a TypeScript
-- file and deploying.
--
-- ---- Versions, not a table of numbers ----
--
-- The card is stored whole, as one JSONB document per version, rather
-- than as a row per rate.
--
-- A rate is not one number. It is four axle prices, a frequency code and
-- whether it takes the labour uplift, and it only means anything
-- alongside the plan inclusion lists, the service kits, the oil, the
-- portal, the bulbs, the wear and tear bases and half a dozen engine
-- settings. Splitting that across six tables makes "what did the card
-- say in March" a six way join, and that question is the whole reason
-- the card is stored at all.
--
-- Every save writes a new version and makes it current. Nothing is
-- edited in place, so what was charged in March can still be read in
-- October, next to what it says now.
--
-- ---- A contract already priced never moves ----
--
-- `fleetsmart_contracts.priced` is a snapshot taken when the contract
-- was built, and 061 says why: a contract signed at March's prices has
-- to keep printing March's numbers, or the document in the customer's
-- drawer and the document on the screen stop agreeing and only one of
-- them is enforceable.
--
-- So editing the card changes what the next contract costs and nothing
-- at all about one already sent. That is not a limitation to work
-- around. It is the point.
--
-- ---- Empty is not broken ----
--
-- No row here means the application prices off the card it ships with,
-- which is the workbook's. That is a working installation, not a
-- missing one, and it is why nothing in this migration inserts a
-- version: the first one is written the first time somebody saves a
-- change.
-- =============================================================

CREATE TABLE IF NOT EXISTS fleetsmart_rate_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What a contract records as the card it was priced against. Dated
  -- rather than numbered, because "2026-08" is what somebody says out
  -- loud about a price list and "version 7" is not.
  version     TEXT UNIQUE NOT NULL,

  -- The whole card. See `lib/fleetsmart/ratecard.ts` for its shape, and
  -- `cardFrom` there for what happens to a stored card missing a field
  -- added since: it keeps the shipped value rather than pricing that
  -- line at nothing.
  card        JSONB NOT NULL,

  -- What changed, worked out from the previous version rather than
  -- typed, so it cannot say something the numbers do not.
  note        TEXT,

  -- Exactly one row is current. Enforced below rather than trusted.
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,

  created_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* One current card, or none at all. A partial unique index rather than a
   constraint, because "at most one row where this is true" is not a
   thing a CHECK can say. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetsmart_one_current
  ON fleetsmart_rate_cards ((is_current)) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_fleetsmart_cards_new
  ON fleetsmart_rate_cards (created_at DESC);

-- -------------------------------------------------------------
-- Reading is wide, writing is narrow.
--
-- Everybody who can open FleetSmart+ reads the card, because the price
-- on their screen is computed from it and a builder that cannot read
-- the rates cannot price anything.
--
-- Writing is `fleetsmart.discount`, which is the permission that already
-- means "may change what something costs". Building a contract is not
-- the right to set a price, and the capability register says so in as
-- many words.
-- -------------------------------------------------------------
ALTER TABLE fleetsmart_rate_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleetsmart_cards_read" ON fleetsmart_rate_cards;
CREATE POLICY "fleetsmart_cards_read" ON fleetsmart_rate_cards
  FOR SELECT USING (command_may('fleetsmart.view'));

/* No insert, update or delete policy at all, deliberately. Saving goes
   through `fleetsmart_save_rate_card` below, which is the only thing
   that can make a version current, so there is no path that writes a
   card without also settling which one is in use. */

GRANT SELECT ON fleetsmart_rate_cards TO authenticated;

-- -------------------------------------------------------------
-- The card in use.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_current_rate_card()
RETURNS fleetsmart_rate_cards
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT * FROM fleetsmart_rate_cards WHERE is_current LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION fleetsmart_current_rate_card() TO authenticated;

-- -------------------------------------------------------------
-- Saving a new one.
--
-- One statement, so there is never a moment where two cards are current
-- or none is.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_save_rate_card(
  p_version TEXT,
  p_card    JSONB,
  p_note    TEXT DEFAULT NULL
)
RETURNS fleetsmart_rate_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE result fleetsmart_rate_cards;
BEGIN
  IF NOT command_may('fleetsmart.discount') THEN
    RAISE EXCEPTION
      'Changing the rate card is the permission that sets prices, which you do not have. Ask an administrator.';
  END IF;

  IF NULLIF(btrim(p_version), '') IS NULL THEN
    RAISE EXCEPTION 'A rate card version needs a name, so a contract can say what it was priced against.';
  END IF;

  /* The shape is checked here rather than trusted, because a card
     missing its rates prices every line at nothing and the first anybody
     would know is a contract going out at zero. */
  IF p_card IS NULL OR jsonb_typeof(p_card -> 'rates') <> 'array'
     OR jsonb_array_length(p_card -> 'rates') = 0 THEN
    RAISE EXCEPTION 'That rate card carries no rates, so every line on every contract would price at nothing.';
  END IF;

  UPDATE fleetsmart_rate_cards SET is_current = FALSE WHERE is_current;

  INSERT INTO fleetsmart_rate_cards (version, card, note, is_current, created_by)
  VALUES (btrim(p_version), p_card, NULLIF(btrim(p_note), ''), TRUE, current_actor())
  ON CONFLICT (version) DO UPDATE SET
    card = EXCLUDED.card,
    note = EXCLUDED.note,
    is_current = TRUE,
    created_by = EXCLUDED.created_by,
    created_at = NOW()
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_save_rate_card FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_save_rate_card TO authenticated;

-- -------------------------------------------------------------
-- Going back to one.
--
-- Not a delete. An old card stays readable, and making it current again
-- is how a price rise gets taken back out without anybody retyping it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_use_rate_card(p_version TEXT)
RETURNS fleetsmart_rate_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE result fleetsmart_rate_cards;
BEGIN
  IF NOT command_may('fleetsmart.discount') THEN
    RAISE EXCEPTION 'Changing which rate card is in use is a permission you do not have.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fleetsmart_rate_cards WHERE version = btrim(p_version)) THEN
    RAISE EXCEPTION 'There is no rate card called %.', p_version;
  END IF;

  UPDATE fleetsmart_rate_cards SET is_current = FALSE WHERE is_current;
  UPDATE fleetsmart_rate_cards SET is_current = TRUE
   WHERE version = btrim(p_version)
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_use_rate_card FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_use_rate_card TO authenticated;

COMMENT ON TABLE fleetsmart_rate_cards IS
  'Every version of the FleetSmart+ rate card, whole. No row means the '
  'application prices off the card it ships with, which is a working '
  'installation and not a missing one.';
