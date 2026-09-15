-- =============================================================
-- 112. Amending the default rates, and putting a card back on them.
--
-- From the business:
--
--   add a reset to default rates button too when editing a card. And a
--   tab in the builder hub allowing you to amend those default rates,
--   similar to how the fleetsmart+ one works - when you make changes to
--   defaults it should reflect for all future rate cards but it should
--   ask if you want to update any that were using just the default
--   rates (nothing custom set outside of the template pricing model I
--   sent you) and you can update/ignore them 1 by 1 or all at once.
--
-- Four things, and the third is the one with the sharp edge:
--
--   1. The defaults can be edited.
--   2. A new card picks the change up, which needs no code at all:
--      `rate_card_create` already copies the template.
--   3. EXISTING cards are asked about, never changed underneath anybody.
--   4. A card can be put back on the defaults.
--
-- ---- What "using just the default rates" means ----
--
-- A card is untouched when nothing on it has been decided by a person:
-- no overridden rate, no custom labour rate, and every labour rate still
-- at the template's figure. `rate_card_is_untouched` is that question,
-- asked in one place, because the offer to update and the act of
-- updating must agree about which cards qualify or the second one
-- silently widens the first.
--
-- A card carrying even one override is never touched by a defaults
-- change. Somebody decided that number for that customer.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The defaults have a log too.
--
-- Same rules as the card log: append only, and no row ever leaves. A
-- change to the defaults moves every future card, so "who put the HGV
-- rate up" has to be answerable a year later.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_template_changes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL,
  what       TEXT NOT NULL,
  was        TEXT,
  now_is     TEXT,
  -- How many existing cards were resynced as part of the same act.
  cards_moved INT NOT NULL DEFAULT 0,
  actor_id   UUID REFERENCES auth.users ON DELETE SET NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_card_template_changes_at
  ON rate_card_template_changes (at DESC);

ALTER TABLE rate_card_template_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_card_template_changes_select" ON rate_card_template_changes;
CREATE POLICY "rate_card_template_changes_select" ON rate_card_template_changes
  FOR SELECT USING (command_may('ratecard.view'));

REVOKE INSERT, UPDATE, DELETE ON rate_card_template_changes FROM authenticated;

DROP TRIGGER IF EXISTS trg_rate_card_template_changes_no_update ON rate_card_template_changes;
CREATE TRIGGER trg_rate_card_template_changes_no_update
  BEFORE UPDATE ON rate_card_template_changes
  FOR EACH ROW EXECUTE FUNCTION rate_card_log_is_permanent();

DROP TRIGGER IF EXISTS trg_rate_card_template_changes_no_delete ON rate_card_template_changes;
CREATE TRIGGER trg_rate_card_template_changes_no_delete
  BEFORE DELETE ON rate_card_template_changes
  FOR EACH ROW EXECUTE FUNCTION rate_card_log_is_permanent();

CREATE OR REPLACE FUNCTION rate_card_template_log(
  p_kind TEXT, p_what TEXT, p_was TEXT DEFAULT NULL,
  p_now TEXT DEFAULT NULL, p_cards INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE new_id UUID;
BEGIN
  INSERT INTO rate_card_template_changes (kind, what, was, now_is, cards_moved, actor_id)
  VALUES (p_kind, p_what, p_was, p_now, COALESCE(p_cards, 0), current_actor())
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_template_log(TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;


-- -------------------------------------------------------------
-- 2. Is this card still purely on the defaults.
--
-- ---- Why this is not a comparison against the template ----
--
-- The first version of this asked whether each labour rate still EQUALS
-- the template's. That is wrong in the one situation the whole feature
-- exists for: the moment somebody puts the default HGV rate from 85 to
-- 88, every card sitting happily on 85 stops equalling the template and
-- is therefore reported as having been changed for that customer. The
-- offer to bring cards into line then covers none of the cards it was
-- raised about. It was found by driving it, not by reading it.
--
-- So a card records whether a PERSON set its labour rate, and that is
-- what "touched" means. `set_by_hand` is written by
-- `rate_card_set_labour` and cleared by a reset, and no comparison
-- against the current template happens anywhere.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_is_untouched(p_card UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    -- Nothing overridden.
    NOT EXISTS (
      SELECT 1 FROM rate_card_rates r
       WHERE r.card_id = p_card AND r.override_value IS NOT NULL)
    -- No labour rate somebody added.
    AND NOT EXISTS (
      SELECT 1 FROM rate_card_labour l
       WHERE l.card_id = p_card AND l.is_custom)
    -- And no labour rate a person set for this customer.
    AND NOT EXISTS (
      SELECT 1 FROM rate_card_labour l
       WHERE l.card_id = p_card AND l.set_by_hand)
$fn$;

REVOKE ALL ON FUNCTION rate_card_is_untouched(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_is_untouched(UUID) TO authenticated;

/* Which cards a defaults change is being offered for.

   Only cards that can still be edited: an approved card is what the
   admin team bills against and does not change underneath them, so it
   is not offered at all rather than offered and then refused. */
/* Dropped first. `CREATE OR REPLACE` cannot change a function's row
   type, so the day a column is added to what this returns it fails on a
   live database with 42P13 while passing every check here, because the
   test server is built from nothing each time. */
DROP FUNCTION IF EXISTS rate_card_resync_candidates();
CREATE OR REPLACE FUNCTION rate_card_resync_candidates()
RETURNS TABLE (
  card_id UUID, card_ref TEXT, customer_name TEXT, card_status TEXT,
  effective_from DATE, owner_name TEXT, untouched BOOLEAN, why_not TEXT
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
         (SELECT COALESCE(p.full_name, p.email) FROM profiles p WHERE p.id = c.owner_id),
         rate_card_is_untouched(c.id),
         CASE
           WHEN EXISTS (SELECT 1 FROM rate_card_rates r
                         WHERE r.card_id = c.id AND r.override_value IS NOT NULL)
             THEN (SELECT COUNT(*)::TEXT FROM rate_card_rates r
                    WHERE r.card_id = c.id AND r.override_value IS NOT NULL)
                  || ' rate(s) set by hand'
           WHEN EXISTS (SELECT 1 FROM rate_card_labour l
                         WHERE l.card_id = c.id AND l.is_custom)
             THEN 'has a custom labour rate'
           WHEN EXISTS (SELECT 1 FROM rate_card_labour l
                        WHERE l.card_id = c.id AND l.set_by_hand)
             THEN 'labour rate set for this customer'
           ELSE NULL
         END
    FROM rate_cards c
   WHERE c.status IN ('draft', 'awaiting')
   ORDER BY rate_card_is_untouched(c.id) DESC, c.customer_name;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_resync_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_resync_candidates() TO authenticated;


-- -------------------------------------------------------------
-- 3. Changing a default.
--
-- Two functions, one per thing that can move: a labour rate, and a
-- single rate's own figure. Neither touches an existing card. The
-- caller is handed the list of cards this WOULD affect and decides,
-- which is what the business asked for.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_template_set_labour(p_pool TEXT, p_rate NUMERIC)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  was NUMERIC;
  lbl TEXT;
  would INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Changing the default labour rates needs the right to set a labour rate. Every future card starts from them.';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 THEN
    RAISE EXCEPTION 'A labour rate is a number of pounds per hour, and cannot be negative.';
  END IF;

  SELECT rate, label INTO was, lbl FROM rate_card_template_labour WHERE pool = p_pool;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no default labour rate called %.', p_pool; END IF;

  UPDATE rate_card_template_labour SET rate = p_rate WHERE pool = p_pool;

  SELECT COUNT(*) INTO would FROM rate_cards c
   WHERE c.status IN ('draft', 'awaiting') AND rate_card_is_untouched(c.id);

  PERFORM rate_card_template_log('labour', lbl,
    TO_CHAR(was, 'FM999999.00'), TO_CHAR(p_rate, 'FM999999.00'), 0);

  /* How many existing cards COULD be brought into line. Nothing has
     been done to them. */
  RETURN would;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_template_set_labour(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_template_set_labour(TEXT, NUMERIC) TO authenticated;

/* One default rate.

   A derived rate is edited by its HOURS, never by its price, for the
   same reason a card's is: the price is what hours times labour makes,
   and storing one would freeze it. A fixed or statutory rate is edited
   by its amount, which is the only thing it has. */
CREATE OR REPLACE FUNCTION rate_card_template_set_rate(
  p_rate_id TEXT, p_axle INT, p_hours NUMERIC, p_amount NUMERIC, p_text TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t     rate_card_template%ROWTYPE;
  pool  NUMERIC;
  was   TEXT;
  now_t TEXT;
  would INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Changing the default rates needs the right to set a labour rate. Every future card starts from them.';
  END IF;

  SELECT * INTO t FROM rate_card_template
   WHERE rate_id = p_rate_id AND axle = COALESCE(p_axle, 0);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no default rate % on axle %.', p_rate_id, COALESCE(p_axle, 0);
  END IF;

  SELECT rate INTO pool FROM rate_card_template_labour WHERE rate_card_template_labour.pool = t.pool;

  was := CASE
           WHEN t.basis = 'derived' THEN TO_CHAR(ROUND(t.hours * pool, 2), 'FM999999.00')
           WHEN t.amount IS NOT NULL THEN TO_CHAR(t.amount, 'FM999999.00')
           ELSE t.text_value
         END;

  IF t.basis = 'derived' THEN
    IF p_hours IS NULL OR p_hours <= 0 THEN
      RAISE EXCEPTION 'A derived rate is set by its hours, and they have to be more than nothing.';
    END IF;
    UPDATE rate_card_template SET hours = p_hours
     WHERE rate_id = p_rate_id AND axle = COALESCE(p_axle, 0);
    now_t := TO_CHAR(ROUND(p_hours * pool, 2), 'FM999999.00');
  ELSIF t.basis IN ('fixed', 'statutory', 'labour') THEN
    UPDATE rate_card_template SET amount = p_amount
     WHERE rate_id = p_rate_id AND axle = COALESCE(p_axle, 0);
    now_t := TO_CHAR(p_amount, 'FM999999.00');
  ELSE
    /* tbc and blank. Exportable on purpose, so what changes is the
       words that print, not a number. */
    UPDATE rate_card_template SET text_value = NULLIF(TRIM(COALESCE(p_text, '')), '')
     WHERE rate_id = p_rate_id AND axle = COALESCE(p_axle, 0);
    now_t := NULLIF(TRIM(COALESCE(p_text, '')), '');
  END IF;

  SELECT COUNT(*) INTO would FROM rate_cards c
   WHERE c.status IN ('draft', 'awaiting') AND rate_card_is_untouched(c.id);

  PERFORM rate_card_template_log('rate',
    t.item || CASE WHEN t.axle > 0 THEN ' (' || t.axle || '-axle)' ELSE '' END,
    was, now_t, 0);

  RETURN would;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_template_set_rate(TEXT, INT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_template_set_rate(TEXT, INT, NUMERIC, NUMERIC, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 4. Bringing one card into line, and putting one back.
--
-- `rate_card_resync` is the "update this one" the offer leads to.
-- `rate_card_reset` is the button on the builder. They do the same
-- thing to the rates and differ in what they will do it to: resync
-- refuses a card somebody has touched, because it is being applied in
-- bulk and must not surprise anybody; reset is a deliberate act on one
-- card and clears the overrides on purpose, which is what the word
-- means.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_apply_template(p_card UUID, p_clear_overrides BOOLEAN)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  moved INT := 0;
  n     INT;
BEGIN
  /* The hours, amounts and words, from the template. An override is
     left alone unless this is a reset. */
  UPDATE rate_card_rates r
     SET hours = t.hours, amount = t.amount, text_value = t.text_value,
         basis = t.basis, pool = t.pool, cap = t.cap, cap_by = t.cap_by,
         updated_at = NOW()
    FROM rate_card_template t
   WHERE r.card_id = p_card AND t.rate_id = r.rate_id AND t.axle = r.axle;
  GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;

  /* The five template labour rates. A custom one somebody added is not
     the template's business and stays. */
  UPDATE rate_card_labour l
     SET rate = t.rate, label = t.label, updated_at = NOW()
    FROM rate_card_template_labour t
   WHERE l.card_id = p_card AND l.pool = t.pool AND NOT l.is_custom;

  IF p_clear_overrides THEN
    UPDATE rate_card_rates
       SET override_value = NULL, overridden_by = NULL, overridden_at = NULL, updated_at = NOW()
     WHERE card_id = p_card AND override_value IS NOT NULL;
    /* And the card stops counting as one somebody set, which is what
       putting it back on the defaults means. */
    UPDATE rate_card_labour
       SET set_by_hand = FALSE, updated_at = NOW()
     WHERE card_id = p_card AND NOT is_custom AND set_by_hand;
  END IF;

  RETURN moved;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_apply_template(UUID, BOOLEAN) FROM PUBLIC;

CREATE OR REPLACE FUNCTION rate_card_resync(p_card UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE moved INT;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Bringing a card into line with the defaults needs the right to build one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  IF NOT rate_card_is_untouched(p_card) THEN
    RAISE EXCEPTION
      'That card has rates somebody set for this customer, so it is not brought into line automatically. Use Reset to defaults on the card itself if that is really what you want.';
  END IF;

  moved := rate_card_apply_template(p_card, FALSE);
  PERFORM rate_card_log(p_card, 'system', 'Brought into line with the default rates',
                        NULL, NULL, moved, FALSE);
  RETURN moved;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_resync(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_resync(UUID) TO authenticated;

/* Every untouched card at once. The "all at once" half of the offer.
   One log row per card, because each card's history has to show that
   its numbers moved and why. */
CREATE OR REPLACE FUNCTION rate_card_resync_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c     RECORD;
  cards INT := 0;
  moved INT;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Bringing cards into line with the defaults needs the right to build one.';
  END IF;

  FOR c IN
    SELECT id FROM rate_cards
     WHERE status IN ('draft', 'awaiting') AND rate_card_is_untouched(id)
  LOOP
    moved := rate_card_apply_template(c.id, FALSE);
    PERFORM rate_card_log(c.id, 'system', 'Brought into line with the default rates',
                          NULL, NULL, moved, FALSE);
    cards := cards + 1;
  END LOOP;

  PERFORM rate_card_template_log('resync', 'Brought every untouched card into line',
                                 NULL, NULL, cards);
  RETURN cards;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_resync_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_resync_all() TO authenticated;

/* The Reset to defaults button on a card.

   Deliberate, on one card, and it DOES clear the overrides, because
   "reset to default rates" is what somebody pressed. It is logged with
   how many rows moved and how many decisions were undone, so the person
   whose override it was can see what happened to it. */
/* Dropped first. `CREATE OR REPLACE` cannot change a function's row
   type, so the day a column is added to what this returns it fails on a
   live database with 42P13 while passing every check here, because the
   test server is built from nothing each time. */
DROP FUNCTION IF EXISTS rate_card_reset(UUID);
CREATE OR REPLACE FUNCTION rate_card_reset(p_card UUID)
RETURNS TABLE (rates_moved INT, overrides_cleared INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cleared INT;
  moved   INT;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Resetting a card to the default rates needs the right to build one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  SELECT COUNT(*) INTO cleared FROM rate_card_rates
   WHERE card_id = p_card AND override_value IS NOT NULL;

  moved := rate_card_apply_template(p_card, TRUE);

  PERFORM rate_card_log(p_card, 'system', 'Reset to the default rates',
    CASE WHEN cleared > 0 THEN cleared || ' rate(s) set by hand' ELSE NULL END,
    'every rate back on the template', moved, FALSE);

  rates_moved := moved; overrides_cleared := cleared;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_reset(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_reset(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 5. Reading the defaults, and their history.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_template_read()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE out JSONB;
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Reading the default rates needs access to the Rate Card Builder.';
  END IF;

  SELECT JSONB_BUILD_OBJECT(
    'labour', COALESCE((SELECT JSONB_AGG(TO_JSONB(l) ORDER BY l.position)
                          FROM rate_card_template_labour l), '[]'::JSONB),
    'rates', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(t) || JSONB_BUILD_OBJECT(
               'price', CASE WHEN t.basis = 'derived' THEN ROUND(t.hours * l.rate, 2)
                             ELSE t.amount END)
             ORDER BY t.position, t.axle)
        FROM rate_card_template t
        LEFT JOIN rate_card_template_labour l ON l.pool = t.pool), '[]'::JSONB),
    'inclusions', COALESCE((SELECT JSONB_AGG(TO_JSONB(i) ORDER BY i.position)
                              FROM rate_card_inclusions i), '[]'::JSONB),
    'untouched_cards', (SELECT COUNT(*) FROM rate_cards c
                         WHERE c.status IN ('draft', 'awaiting') AND rate_card_is_untouched(c.id)),
    'touched_cards', (SELECT COUNT(*) FROM rate_cards c
                       WHERE c.status IN ('draft', 'awaiting') AND NOT rate_card_is_untouched(c.id))
  ) INTO out;

  RETURN out;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_template_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_template_read() TO authenticated;

/* Dropped first. `CREATE OR REPLACE` cannot change a function's row
   type, so the day a column is added to what this returns it fails on a
   live database with 42P13 while passing every check here, because the
   test server is built from nothing each time. */
DROP FUNCTION IF EXISTS rate_card_template_history();
CREATE OR REPLACE FUNCTION rate_card_template_history()
RETURNS TABLE (id UUID, kind TEXT, what TEXT, was TEXT, now_is TEXT,
               cards_moved INT, actor_name TEXT, at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Reading the defaults history needs access to the Rate Card Builder.';
  END IF;

  RETURN QUERY
  SELECT ch.id, ch.kind, ch.what, ch.was, ch.now_is, ch.cards_moved,
         COALESCE(p.full_name, p.email, 'System'), ch.at
    FROM rate_card_template_changes ch
    LEFT JOIN profiles p ON p.id = ch.actor_id
   ORDER BY ch.at DESC, ch.id DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_template_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_template_history() TO authenticated;

DO $$ BEGIN RAISE NOTICE 'rate card defaults: editable, logged permanently, and offered rather than applied'; END $$;
