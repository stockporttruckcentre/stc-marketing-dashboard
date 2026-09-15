-- =============================================================
-- 110. The rate card: what a customer is charged, per hour and per job.
--
-- From the business:
--
--   Add a new tab to Sales - Rate Card Builder ... These will
--   self-generate when a fleetsmart+ contract is built and can be
--   manually created by selecting a customer in the CRM ... It needs to
--   be extremely minimal effort with optional changes on creation.
--
-- ---- Not the FleetSmart+ rate card ----
--
-- `fleetsmart_rates` and `lib/fleetsmart/ratecard.ts` are STC's own
-- pricing workbook: what a maintenance contract costs per asset per
-- month. This is the other document entirely, the one the customer and
-- the admin team both work off: the hourly rates and the job prices
-- that anything OUTSIDE the contract is billed at. Same two words, two
-- different pieces of paper, so nothing here is named `fleetsmart`.
--
-- ---- Hours, never prices ----
--
-- A card has 45 rates and only 5 of them are decisions. 19 more are
-- hours x a labour rate and follow automatically, 6 are DVSA fees that
-- must never move, 10 are STC's own flat charges and 5 are still to be
-- priced. From the handoff, and it is the single most important rule in
-- this migration:
--
--   basis: "derived" stores hours + pool. Store hours, never the price.
--   The price is computed on read, so a labour change needs no
--   migration and no batch job.
--
-- So `rate_card_rates.hours` is the stored truth for a derived rate and
-- there is no price column beside it. A salesman moves one labour rate
-- and nineteen rows move, with nothing written to them at all.
--
-- ---- One row per axle column ----
--
-- A trailer rate is priced four times, once per axle count, and the
-- handoff requires each column to be independent: "A rate can be derived
-- on one column and overridden on another." A single row per rate with
-- four price columns cannot express that, so the grain here is one row
-- per rate per priced column.
--
-- ---- An override is a flag, not a delete ----
--
-- `override_value` sits BESIDE `hours` rather than replacing it, so
-- revert is always available and always exact. A row with both is an
-- overridden derived rate, and it knows what it would have been.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The four capabilities.
--
-- Mirrored in `lib/platform/permissions/catalog.ts`;
-- `npm run check:capabilities` asserts the two cannot drift.
--
-- Four rather than one, for the reason FleetSmart+ has four: reading a
-- card, amending one, moving the labour rate every derived rate follows,
-- and approving a card are four different amounts of authority. The
-- third is the one that moves nineteen rows at once.
-- -------------------------------------------------------------
INSERT INTO capability_catalog (key, label, description, area, feature, danger, requires, scoped, position) VALUES
  ('ratecard.view', 'See rate cards',
   'Open the Rate Card Builder and read the cards on it, whoever built them.',
   'Rate cards', 'Rate cards', 'routine', '{}', FALSE, 10),
  ('ratecard.build', 'Build and amend a rate card',
   'Create a card for a customer and override individual rates on it. Not the right to move the labour rate every other rate follows.',
   'Rate cards', 'Rate cards', 'routine', '{ratecard.view}', FALSE, 20),
  ('ratecard.labour', 'Set a labour rate',
   'Change an hourly rate, which moves every rate derived from it. Nineteen rows on a card follow the five labour rates, so this is the one edit that is reviewed before it commits.',
   'Rate cards', 'Rate cards', 'sensitive', '{ratecard.build}', FALSE, 30),
  ('ratecard.approve', 'Approve a rate card',
   'Make a card the live one for a customer. What the admin team bills against until it is replaced.',
   'Rate cards', 'Rate cards', 'sensitive', '{ratecard.build}', FALSE, 40)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description,
  area = EXCLUDED.area, feature = EXCLUDED.feature, danger = EXCLUDED.danger,
  requires = EXCLUDED.requires, scoped = EXCLUDED.scoped, position = EXCLUDED.position;

-- Who holds them: everybody.
--
-- From the business, plainly: "all roles have full access to rate
-- cards." So this is a cross join rather than a list, which also means a
-- role added later gets them without anybody remembering to come back
-- here. The four capabilities still exist as four, because the change
-- log has to record which act somebody performed, and because narrowing
-- one of them later is then an UPDATE rather than a redesign.
--
-- What stops a rate being changed quietly is not a permission. It is
-- section 12: every change is written to a log that cannot be edited or
-- deleted by anybody, whatever they hold.
-- `scope` is left to its default. These four are `scoped: false` in the
-- catalogue: a rate card is a document about one customer and there is
-- no narrower or wider version of being able to read it.
INSERT INTO role_template_capabilities (role_template_id, capability)
SELECT rt.id, v.capability
  FROM role_templates rt
  CROSS JOIN (VALUES
    ('ratecard.view'), ('ratecard.build'),
    ('ratecard.labour'), ('ratecard.approve')
  ) AS v(capability)
ON CONFLICT (role_template_id, capability) DO NOTHING;


-- -------------------------------------------------------------
-- 2. The card.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What somebody says out loud: "pull up RC-14".
  ref             TEXT UNIQUE,

  contact_id      UUID REFERENCES crm_contacts ON DELETE SET NULL,

  -- Denormalised for the same reason the FleetSmart+ contract keeps it:
  -- a card that has gone to a customer said this name on it, and stays
  -- correct after the CRM record is renamed or deleted.
  customer_name   TEXT NOT NULL DEFAULT '',

  -- Rates are good for about a year, so every card carries the date it
  -- takes effect and the date it stops being trustworthy. The second is
  -- derived from the first and stored, so a query can ask for stale
  -- cards without recomputing it per row.
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  good_until      DATE GENERATED ALWAYS AS (effective_from + INTERVAL '12 months') STORED,

  -- draft      being built, nobody has seen it
  -- awaiting   sent for approval
  -- approved   the live card for this customer
  -- superseded a newer approved card replaced it
  -- withdrawn  taken out of use without a replacement
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'awaiting', 'approved', 'superseded', 'withdrawn')),

  -- The customer block printed at the top of the sheet. Pulled from the
  -- CRM on creation and editable afterwards, because the card is a
  -- document: what it said when it went out does not change because
  -- somebody edited a CRM field six months later.
  main_contact    TEXT,
  address         TEXT,
  telephone       TEXT,
  email           TEXT,
  other_detail    TEXT,
  accounts_detail TEXT,

  -- The FleetSmart+ side of the sheet.
  --
  -- `contract_id` is the link and `show_fleetsmart` is presentation.
  -- From the business: hiding the section is "an option to hide this
  -- whole fleetsmart+ section from the rate card entirely", which is
  -- about what prints. It must never unlink the contract, or the
  -- inclusions stop tracking and nobody finds out until a customer
  -- reads a stale sheet.
  contract_id     UUID REFERENCES fleetsmart_contracts ON DELETE SET NULL,
  show_fleetsmart BOOLEAN NOT NULL DEFAULT TRUE,
  -- Extra inclusions agreed with this customer beyond their tier, as
  -- rows of {inclusion, tiers}. Generated from the contract's extras.
  extra_inclusions JSONB NOT NULL DEFAULT '[]'::JSONB,

  owner_id        UUID REFERENCES auth.users ON DELETE SET NULL,
  created_by      UUID REFERENCES auth.users ON DELETE SET NULL,
  approved_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  -- Set when the 11 month warning has gone out, so it goes out once.
  stale_warned_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An approved card has somebody's name against the approval. Without
  -- this a card can read "approved" with no record of by whom, which is
  -- the state nobody can reconstruct later.
  CONSTRAINT rate_card_approved_has_an_approver CHECK (
    (status <> 'approved') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rate_cards_contact  ON rate_cards (contact_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_rate_cards_status   ON rate_cards (status, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_rate_cards_contract ON rate_cards (contract_id);
CREATE INDEX IF NOT EXISTS idx_rate_cards_owner    ON rate_cards (owner_id, created_at DESC);

-- ONE LIVE CARD PER CUSTOMER.
--
-- From the business: "Ensure it doesn't generate multiple records of
-- rate cards for the same customer." A partial unique index rather than
-- a check in application code, because the FleetSmart+ builder and the
-- Rate Card Builder can both create one and neither knows about the
-- other's half-finished transaction.
--
-- Draft and superseded are deliberately outside it: a replacement is
-- built as a draft while the current one is still live, which is the
-- whole point of having a status.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_card_live_per_customer
  ON rate_cards (contact_id)
  WHERE contact_id IS NOT NULL AND status IN ('awaiting', 'approved');


-- -------------------------------------------------------------
-- 3. The labour rates, which are the only real decisions on a card.
--
-- Five pools ship with the template: trailers in and out of hours, HGV
-- and LCV in and out of hours, and the bodyshop. A card may carry more.
--
-- ---- Why `charge_to` exists ----
--
-- From the business, in full, because it is the part most likely to be
-- built wrong:
--
--   an example would be where a customer is on Gold so their A services
--   are billed internally to STC (as the customer paid via monthly
--   contract) at £85 per hour on a vehicle, but in the event the vehicle
--   needs brake work which is not included in Gold, a salesman could add
--   a custom rate for non-inclusive items (charged to the customer's
--   account, not internally to STC) at £90 per hour. So then our admin
--   team know from the rate card, anything charged to STC internally as
--   a contract inclusive item is £85 per hour, and any jobs open to the
--   actual customer will be £90 per hour.
--
-- So the same hour has two prices depending on who picks up the bill,
-- and the card has to say both. `charge_to = 'stc'` is the contract
-- inclusive rate billed internally; `charge_to = 'customer'` is the
-- non-inclusive rate billed to the customer's account. The admin team
-- reads the pair and knows which to raise.
--
-- A card with no FleetSmart+ contract has only the customer side, which
-- is why 'customer' is the default rather than 'stc'.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_labour (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id      UUID NOT NULL REFERENCES rate_cards ON DELETE CASCADE,

  -- 'trl', 'trlO', 'hgv', 'hgvO', 'body' from the kit, or a slug the
  -- salesman made for a custom pool.
  pool         TEXT NOT NULL,
  label        TEXT NOT NULL,
  rate         NUMERIC(10,2) NOT NULL CHECK (rate >= 0),

  charge_to    TEXT NOT NULL DEFAULT 'customer'
                 CHECK (charge_to IN ('stc', 'customer')),

  -- A pool the kit shipped, or one somebody added for this customer.
  -- Custom pools can be deleted; kit pools cannot, because 19 rates
  -- point at them.
  is_custom    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Did a PERSON set this rate for this customer, as against it being
  -- whatever the template said on the day the card was made.
  --
  -- This is the flag that decides whether a later change to the default
  -- rates may bring this card into line. Comparing the rate against the
  -- template instead is wrong in exactly the case that matters, and
  -- migration 112 sets out why at length.
  set_by_hand  BOOLEAN NOT NULL DEFAULT FALSE,
  note         TEXT,
  position     INT NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (card_id, pool, charge_to)
);

CREATE INDEX IF NOT EXISTS idx_rate_card_labour_card ON rate_card_labour (card_id, position);


-- -------------------------------------------------------------
-- 4. The rates. One row per rate per priced column.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id       UUID NOT NULL REFERENCES rate_cards ON DELETE CASCADE,

  -- The kit's own id, 'r01' to 'r45', so a row can always be matched
  -- back to `lib/ratecards/kit.generated.ts` whatever gets renamed.
  rate_id       TEXT NOT NULL,
  section       TEXT NOT NULL,
  item          TEXT NOT NULL,

  -- 0 for a rate with a single price column; 1 to 4 for the axle count
  -- a trailer or HGV rate is priced at.
  axle          INT NOT NULL DEFAULT 0 CHECK (axle BETWEEN 0 AND 4),

  basis         TEXT NOT NULL
                  CHECK (basis IN ('derived', 'labour', 'fixed', 'statutory', 'tbc', 'blank')),

  -- DERIVED: the stored truth. Full precision, never rounded, never
  -- accompanied by a price. `hours * labour(pool)` is the price.
  hours         NUMERIC(12,6),
  pool          TEXT,

  -- FIXED and STATUTORY: STC's own flat charge, or a DVSA fee.
  amount        NUMERIC(10,2),

  -- TBC and BLANK: exportable on purpose. The master card ships with
  -- TBCs in it, so they are a choice rather than an oversight.
  text_value    TEXT,

  -- THE OVERRIDE. A flag beside the original, never a replacement, so
  -- revert is exact. A derived row that is overridden still knows its
  -- hours and still knows what the labour rate would have made it.
  override_value NUMERIC(10,2),
  overridden_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  overridden_at  TIMESTAMPTZ,

  -- A DVSA cap, carried so a rate over it warns rather than refuses.
  -- From the handoff: "A cap warns in amber and still saves - caps
  -- change, and the tool should not refuse a rate the business has
  -- decided on."
  cap           NUMERIC(10,2),
  cap_by        TEXT,

  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (card_id, rate_id, axle),

  -- A derived rate without hours is a rate that cannot be priced, and a
  -- derived rate with an amount is somebody having stored the price the
  -- handoff says never to store.
  CONSTRAINT rate_derived_stores_hours CHECK (
    basis <> 'derived' OR (hours IS NOT NULL AND pool IS NOT NULL AND amount IS NULL)
  ),
  -- An override records who and when, or it is not an override.
  CONSTRAINT rate_override_is_attributed CHECK (
    override_value IS NULL OR (overridden_by IS NOT NULL AND overridden_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rate_card_rates_card ON rate_card_rates (card_id, position, axle);
CREATE INDEX IF NOT EXISTS idx_rate_card_rates_pool ON rate_card_rates (card_id, pool) WHERE basis = 'derived';


-- -------------------------------------------------------------
-- 5. Who the account manager is.
--
-- From the business: "Add a field for setting an account manager - this
-- should auto populate based on the account owner in the crm but let the
-- user override this or add additional."
--
-- A table rather than a column, because of the last three words.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_managers (
  card_id     UUID NOT NULL REFERENCES rate_cards ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- TRUE for the one filled in from the CRM account owner, so the screen
  -- can say where it came from and an override is visibly an override.
  from_crm    BOOLEAN NOT NULL DEFAULT FALSE,
  position    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, user_id)
);


-- -------------------------------------------------------------
-- 6. The change log and the versions.
--
-- Every edit lands here, including the ones the system makes, because
-- the handoff requires a contract change to write "a System row into
-- each card's change log" and a card open at the time to be told.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     UUID NOT NULL REFERENCES rate_cards ON DELETE CASCADE,

  -- 'labour', 'rate', 'override', 'revert', 'uplift', 'status',
  -- 'fleetsmart', 'detail', 'manager', 'system'
  kind        TEXT NOT NULL,
  what        TEXT NOT NULL,
  was         TEXT,
  now_is      TEXT,
  -- How many rate rows this one act moved. A labour change is one entry
  -- saying nineteen, not nineteen entries.
  rows_moved  INT NOT NULL DEFAULT 0,

  -- Null for a change the system made, which is how the screen tells a
  -- System row from a person's.
  actor_id    UUID REFERENCES auth.users ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_card_changes_card ON rate_card_changes (card_id, at DESC);

-- A snapshot of the whole card, taken on approval, so last year's sheet
-- can be reproduced exactly when a customer compares year on year.
CREATE TABLE IF NOT EXISTS rate_card_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     UUID NOT NULL REFERENCES rate_cards ON DELETE CASCADE,
  version     INT NOT NULL,
  label       TEXT,
  snapshot    JSONB NOT NULL,
  taken_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (card_id, version)
);


-- -------------------------------------------------------------
-- 7. Row level security.
--
-- Reading a card is `ratecard.view`. Every write goes through a function
-- below rather than through a policy, for the reason the FleetSmart+ and
-- Protean tables do: a card is a document the admin team bills against,
-- and one wrong UPDATE moves what a customer is charged. There is
-- exactly one way in and it checks a capability first.
-- -------------------------------------------------------------
ALTER TABLE rate_cards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_labour    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_rates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_managers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_changes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_versions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_cards_select" ON rate_cards;
CREATE POLICY "rate_cards_select" ON rate_cards
  FOR SELECT USING (command_may('ratecard.view'));

DROP POLICY IF EXISTS "rate_card_labour_select" ON rate_card_labour;
CREATE POLICY "rate_card_labour_select" ON rate_card_labour
  FOR SELECT USING (command_may('ratecard.view'));

DROP POLICY IF EXISTS "rate_card_rates_select" ON rate_card_rates;
CREATE POLICY "rate_card_rates_select" ON rate_card_rates
  FOR SELECT USING (command_may('ratecard.view'));

DROP POLICY IF EXISTS "rate_card_managers_select" ON rate_card_managers;
CREATE POLICY "rate_card_managers_select" ON rate_card_managers
  FOR SELECT USING (command_may('ratecard.view'));

DROP POLICY IF EXISTS "rate_card_changes_select" ON rate_card_changes;
CREATE POLICY "rate_card_changes_select" ON rate_card_changes
  FOR SELECT USING (command_may('ratecard.view'));

DROP POLICY IF EXISTS "rate_card_versions_select" ON rate_card_versions;
CREATE POLICY "rate_card_versions_select" ON rate_card_versions
  FOR SELECT USING (command_may('ratecard.view'));

-- No INSERT, UPDATE or DELETE policy on any of the six, deliberately.
-- With row level security on and no policy for a command, that command
-- is refused for everybody who is not the table owner, which is what
-- routes every write through the SECURITY DEFINER functions below.
REVOKE INSERT, UPDATE, DELETE ON rate_cards         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON rate_card_labour   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON rate_card_rates    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON rate_card_managers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON rate_card_changes  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON rate_card_versions FROM authenticated;


-- -------------------------------------------------------------
-- 8. The reference, and the updated stamp.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_ref()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  n INT;
BEGIN
  IF NEW.ref IS NULL THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(ref, '\D', '', 'g'), '')::INT), 0) + 1
      INTO n FROM rate_cards;
    NEW.ref := 'RC-' || n;
    WHILE EXISTS (SELECT 1 FROM rate_cards WHERE ref = NEW.ref) LOOP
      n := n + 1;
      NEW.ref := 'RC-' || n;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_card_ref ON rate_cards;
CREATE TRIGGER trg_rate_card_ref BEFORE INSERT ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION rate_card_ref();

CREATE OR REPLACE FUNCTION rate_card_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_cards_touch ON rate_cards;
CREATE TRIGGER trg_rate_cards_touch BEFORE UPDATE ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION rate_card_touch();


-- -------------------------------------------------------------
-- 9. What a rate is worth right now.
--
-- The one place a price is computed, so the screen, the export and any
-- report cannot disagree about what a row costs. Rounded half up to two
-- decimals at the point of display, per the handoff, and never on the
-- way in.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_price(p_rate rate_card_rates, p_labour NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_rate.override_value IS NOT NULL THEN p_rate.override_value
    WHEN p_rate.basis = 'derived' AND p_labour IS NOT NULL
      THEN ROUND(p_rate.hours * p_labour, 2)
    WHEN p_rate.basis IN ('fixed', 'statutory', 'labour') THEN p_rate.amount
    ELSE NULL
  END
$fn$;


-- -------------------------------------------------------------
-- 10. The template every card starts as.
--
-- The kit's 45 rates and 5 labour pools, as rows. Seeded by migration
-- 111, which is generated from `docs/source/rate_cards/rate-model.json`
-- by `npm run rate-card:generate` and never written by hand.
--
-- In the database rather than only in TypeScript because the FleetSmart+
-- builder creates a card from inside a transaction in the database, and
-- a template only the browser knows cannot be read from there.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_card_template (
  rate_id     TEXT NOT NULL,
  axle        INT  NOT NULL DEFAULT 0,
  section     TEXT NOT NULL,
  item        TEXT NOT NULL,
  basis       TEXT NOT NULL
                CHECK (basis IN ('derived', 'labour', 'fixed', 'statutory', 'tbc', 'blank')),
  hours       NUMERIC(12,6),
  pool        TEXT,
  amount      NUMERIC(10,2),
  text_value  TEXT,
  cap         NUMERIC(10,2),
  cap_by      TEXT,
  position    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_id, axle)
);

CREATE TABLE IF NOT EXISTS rate_card_template_labour (
  pool      TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  rate      NUMERIC(10,2) NOT NULL,
  position  INT NOT NULL DEFAULT 0
);

-- The 23 FleetSmart+ inclusions by tier, for the right hand panel.
CREATE TABLE IF NOT EXISTS rate_card_inclusions (
  inclusion TEXT PRIMARY KEY,
  silver    BOOLEAN NOT NULL DEFAULT FALSE,
  gold      BOOLEAN NOT NULL DEFAULT FALSE,
  platinum  BOOLEAN NOT NULL DEFAULT FALSE,
  position  INT NOT NULL DEFAULT 0
);

ALTER TABLE rate_card_template        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_template_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_inclusions      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_card_template_select" ON rate_card_template;
CREATE POLICY "rate_card_template_select" ON rate_card_template
  FOR SELECT USING (command_may('ratecard.view'));
DROP POLICY IF EXISTS "rate_card_template_labour_select" ON rate_card_template_labour;
CREATE POLICY "rate_card_template_labour_select" ON rate_card_template_labour
  FOR SELECT USING (command_may('ratecard.view'));
DROP POLICY IF EXISTS "rate_card_inclusions_select" ON rate_card_inclusions;
CREATE POLICY "rate_card_inclusions_select" ON rate_card_inclusions
  FOR SELECT USING (command_may('ratecard.view'));


-- -------------------------------------------------------------
-- 11. Does this customer already have one, and does it still matter.
--
-- From the business:
--
--   When creating one in the rate card builder and you select a
--   customer, have it tell you if one exists and ask if you want to
--   proceed. Same as when it warns you a rate card already exists for
--   this customer - if it's one that's close to a year old or past a
--   year old then we need logic so it's not telling you rate cards
--   exist for customers years after they're good to still be used.
--
-- So the answer is not "yes there is one". It is one of four, and the
-- screen says a different sentence for each:
--
--   none      nothing to warn about
--   live      there is a current card, and replacing it supersedes it
--   ageing    within a month of its year, so a replacement is expected
--   expired   past its year, so the old one is not a reason to stop
-- -------------------------------------------------------------
/* Dropped first because the OUT parameters changed after the first
   version shadowed its own column names. CREATE OR REPLACE cannot
   change a function's row type. */
DROP FUNCTION IF EXISTS rate_card_for_customer(UUID);
CREATE OR REPLACE FUNCTION rate_card_for_customer(p_contact UUID)
RETURNS TABLE (
  verdict        TEXT,
  card_id        UUID,
  card_ref       TEXT,
  card_status    TEXT,
  effective_from DATE,
  good_until     DATE,
  days_old       INT,
  owner_name     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Looking up a rate card needs access to the Rate Card Builder.';
  END IF;

  /* Every column is qualified. The OUT parameters above share names
     with the columns below, and an unqualified `status` resolves to the
     parameter rather than the row, which is a silent wrong answer
     rather than an error in most of the places it can happen. */
  RETURN QUERY
  SELECT CASE
           WHEN CURRENT_DATE > c.good_until::DATE       THEN 'expired'
           WHEN CURRENT_DATE > c.good_until::DATE - 30  THEN 'ageing'
           ELSE 'live'
         END::TEXT,
         c.id,
         c.ref,
         c.status,
         c.effective_from,
         c.good_until::DATE,
         (CURRENT_DATE - c.effective_from)::INT,
         (SELECT COALESCE(p.full_name, p.email) FROM profiles p WHERE p.id = c.owner_id)
    FROM rate_cards c
   WHERE c.contact_id = p_contact
     AND c.status IN ('awaiting', 'approved')
   ORDER BY c.effective_from DESC
   LIMIT 1;

  /* Nothing live. A real answer, and the one the screen needs most,
     because it is the case where it says nothing at all rather than
     warning about a card from three years ago. */
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'none'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT,
                        NULL::DATE, NULL::DATE, NULL::INT, NULL::TEXT;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_for_customer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_for_customer(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 12. The log nobody can edit and nobody can delete.
--
-- From the business:
--
--   Ensure we have a full logs system so we know if someone made
--   changes to rates - logs cannot be removed.
--
-- Every role holds every rate card capability, so a permission is not
-- what makes this safe. Three things do, and they are deliberately
-- mechanical rather than a matter of nobody trying:
--
--   1. There is no UPDATE or DELETE policy on `rate_card_changes`, and
--      both are revoked from `authenticated`. Nothing a browser sends
--      can touch a row.
--   2. The trigger below refuses UPDATE and DELETE unconditionally. It
--      fires for the SECURITY DEFINER functions in this file too, so a
--      future function that tries to tidy the log fails loudly at the
--      moment it is written rather than quietly in production.
--   3. `ON DELETE CASCADE` from `rate_cards` is the one legitimate way a
--      row goes, and section 13 removes even that: a card is withdrawn,
--      never deleted, and the delete is refused at the same level.
--
-- The trigger is the part that matters, because 1 can be granted back
-- and 3 can be argued with. A rule with no exception is enforceable; a
-- convention is not.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_log_is_permanent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  /* TG_TABLE_NAME rather than a literal: migration 112 hangs the same
     trigger on the defaults log, and a message naming the wrong table
     sends whoever hit it to the wrong place. */
  RAISE EXCEPTION
    'The rate card change log is permanent. A % on % is refused for everybody, including this function''s owner. Correct a mistake by recording what actually happened, not by removing the record of it.',
    TG_OP, TG_TABLE_NAME;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_card_changes_no_update ON rate_card_changes;
CREATE TRIGGER trg_rate_card_changes_no_update
  BEFORE UPDATE ON rate_card_changes
  FOR EACH ROW EXECUTE FUNCTION rate_card_log_is_permanent();

DROP TRIGGER IF EXISTS trg_rate_card_changes_no_delete ON rate_card_changes;
CREATE TRIGGER trg_rate_card_changes_no_delete
  BEFORE DELETE ON rate_card_changes
  FOR EACH ROW EXECUTE FUNCTION rate_card_log_is_permanent();

-- A card is never deleted either, because deleting one would take its
-- log with it through the cascade, which is the same thing as editing
-- the log with extra steps. `rate_card_withdraw` is the way out.
CREATE OR REPLACE FUNCTION rate_card_is_never_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION
    'A rate card is withdrawn, not deleted: deleting % would take its change log with it. Use rate_card_set_status(id, ''withdrawn'').',
    OLD.ref;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_cards_no_delete ON rate_cards;
CREATE TRIGGER trg_rate_cards_no_delete
  BEFORE DELETE ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION rate_card_is_never_deleted();

/* Writing to the log. The only way a row gets in.

   `p_actor` is null for something the system did, which is how the
   screen tells a System row from a person's. Everything else is
   stamped with whoever is signed in, read from the database rather
   than passed in, so a caller cannot write somebody else's name
   against their own edit. */
CREATE OR REPLACE FUNCTION rate_card_log(
  p_card UUID, p_kind TEXT, p_what TEXT,
  p_was TEXT DEFAULT NULL, p_now TEXT DEFAULT NULL,
  p_rows INT DEFAULT 0, p_system BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO rate_card_changes (card_id, kind, what, was, now_is, rows_moved, actor_id)
  VALUES (p_card, p_kind, p_what, p_was, p_now, COALESCE(p_rows, 0),
          CASE WHEN p_system THEN NULL ELSE current_actor() END)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_log(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN) FROM PUBLIC;

/* Reading it. Open to anybody who can see the card, because a log only
   some people can read is a log the rest have to take on trust. */
CREATE OR REPLACE FUNCTION rate_card_history(p_card UUID)
RETURNS TABLE (
  id UUID, kind TEXT, what TEXT, was TEXT, now_is TEXT,
  rows_moved INT, actor_name TEXT, actor_id UUID, at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Reading a rate card''s history needs access to the Rate Card Builder.';
  END IF;

  RETURN QUERY
  SELECT ch.id, ch.kind, ch.what, ch.was, ch.now_is, ch.rows_moved,
         COALESCE(p.full_name, p.email, 'System'), ch.actor_id, ch.at
    FROM rate_card_changes ch
    LEFT JOIN profiles p ON p.id = ch.actor_id
   WHERE ch.card_id = p_card
   ORDER BY ch.at DESC, ch.id DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_history(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 13. Making one.
--
-- From the business: "It needs to be extremely minimal effort with
-- optional changes on creation." So everything except the customer has
-- a default, and the whole card comes out of the template with the
-- customer's own details filled in from the CRM.
--
-- `p_supersede` is the answer to the warning `rate_card_for_customer`
-- raised. Passing FALSE when a live card exists refuses, rather than
-- silently making a second one, because the unique index would refuse it
-- anyway and an error nobody chose is worse than a question.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_create(
  p_contact    UUID,
  p_effective  DATE DEFAULT NULL,
  p_supersede  BOOLEAN DEFAULT FALSE,
  p_contract   UUID DEFAULT NULL,
  p_system     BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  new_id   UUID;
  existing rate_cards%ROWTYPE;
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

  /* The live one, if there is a live one. */
  SELECT * INTO existing
    FROM rate_cards
   WHERE contact_id = p_contact AND status IN ('awaiting', 'approved')
   ORDER BY effective_from DESC LIMIT 1;

  IF FOUND AND NOT p_supersede THEN
    RAISE EXCEPTION
      'A rate card already exists for % (%, effective %). Say so explicitly to replace it.',
      cust.company_name, existing.ref, existing.effective_from;
  END IF;

  /* The primary address, or any address, or nothing and the screen
     flags it as required. */
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

  /* The labour band, from the template. */
  INSERT INTO rate_card_labour (card_id, pool, label, rate, charge_to, position)
  SELECT new_id, t.pool, t.label, t.rate, 'customer', t.position
    FROM rate_card_template_labour t;

  /* Every rate, from the template, one row per priced column. Hours for
     the derived ones and no price anywhere. */
  INSERT INTO rate_card_rates (
    card_id, rate_id, section, item, axle, basis,
    hours, pool, amount, text_value, cap, cap_by, position
  )
  SELECT new_id, t.rate_id, t.section, t.item, t.axle, t.basis,
         t.hours, t.pool, t.amount, t.text_value, t.cap, t.cap_by, t.position
    FROM rate_card_template t;
  GET DIAGNOSTICS n_rates = ROW_COUNT;

  /* The account manager, from the CRM account owner, marked as having
     come from there so an override reads as an override. */
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

  IF FOUND AND existing.id IS NOT NULL AND p_supersede THEN
    UPDATE rate_cards SET status = 'superseded' WHERE id = existing.id;
    PERFORM rate_card_log(existing.id, 'status', 'Superseded by a new card',
                          existing.status, 'superseded', 0, p_system);
  END IF;

  PERFORM rate_card_log(
    new_id, 'system',
    CASE WHEN p_contract IS NOT NULL
         THEN 'Card created from a FleetSmart+ contract'
         ELSE 'Card created from the template' END,
    NULL, NULL, n_rates, p_system);

  RETURN new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_create(UUID, DATE, BOOLEAN, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_create(UUID, DATE, BOOLEAN, UUID, BOOLEAN) TO authenticated;


-- -------------------------------------------------------------
-- 14. Moving a labour rate, which moves everything derived from it.
--
-- The one edit that is reviewed before it commits, because it moves many
-- rows. The screen stages it, shows what would change, and calls this
-- when the salesman accepts. Nothing is written to the derived rows
-- themselves: they store hours, so they follow on the next read.
--
-- The log gets ONE row saying how many moved, not one row per rate.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_set_labour(
  p_card UUID, p_pool TEXT, p_rate NUMERIC,
  p_charge_to TEXT DEFAULT 'customer'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  was     NUMERIC;
  lbl     TEXT;
  moved   INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Changing a labour rate needs the right to set one. It moves every rate derived from it.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  IF p_rate IS NULL OR p_rate < 0 THEN
    RAISE EXCEPTION 'A labour rate is a number of pounds per hour, and cannot be negative.';
  END IF;

  SELECT rate, label INTO was, lbl
    FROM rate_card_labour
   WHERE card_id = p_card AND pool = p_pool AND charge_to = p_charge_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That card has no % labour rate called %.', p_charge_to, p_pool;
  END IF;

  /* `set_by_hand` is what marks this card as one somebody decided for
     this customer, and it is why a later change to the DEFAULTS leaves
     it alone. Migration 112 adds the column and explains why the
     alternative, comparing against the template, is wrong. */
  UPDATE rate_card_labour
     SET rate = p_rate, set_by_hand = TRUE, updated_at = NOW()
   WHERE card_id = p_card AND pool = p_pool AND charge_to = p_charge_to;

  /* How many rates follow this pool and are not overridden. An
     overridden row does not move, which is the whole point of an
     override, so it is not counted as having moved. */
  SELECT COUNT(*) INTO moved
    FROM rate_card_rates
   WHERE card_id = p_card AND basis = 'derived'
     AND pool = p_pool AND override_value IS NULL;

  PERFORM rate_card_log(
    p_card, 'labour',
    lbl || CASE WHEN p_charge_to = 'stc' THEN ' (billed to STC)' ELSE '' END,
    TO_CHAR(was, 'FM999999.00'), TO_CHAR(p_rate, 'FM999999.00'), moved, FALSE);

  RETURN moved;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_set_labour(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_set_labour(UUID, TEXT, NUMERIC, TEXT) TO authenticated;


/* A card that is approved is not edited. Everything that writes calls
   this first, so the rule is in one place rather than in nine. */
CREATE OR REPLACE FUNCTION rate_card_must_be_open(p_card UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  st TEXT;
  rf TEXT;
BEGIN
  SELECT status, ref INTO st, rf FROM rate_cards WHERE id = p_card;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No rate card with that id.';
  END IF;
  IF st IN ('approved', 'superseded', 'withdrawn') THEN
    RAISE EXCEPTION
      '% is %, so it cannot be edited. A card the admin team bills against does not change underneath them: copy it and amend the copy.',
      rf, st;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_must_be_open(UUID) FROM PUBLIC;


-- -------------------------------------------------------------
-- 15. Overriding one rate, and putting it back.
--
-- From the handoff: "An override is a flag, not a delete. Store the
-- manual price alongside the original hours so revert is always
-- available and always exact."
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_set_rate(
  p_card UUID, p_rate_id TEXT, p_axle INT, p_value NUMERIC
)
RETURNS TABLE (over_cap BOOLEAN, cap NUMERIC, cap_by TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r     rate_card_rates%ROWTYPE;
  lab   NUMERIC;
  was   NUMERIC;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Changing a rate needs the right to build a rate card.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  SELECT * INTO r FROM rate_card_rates
   WHERE card_id = p_card AND rate_id = p_rate_id AND axle = COALESCE(p_axle, 0);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That card has no rate % on axle %.', p_rate_id, COALESCE(p_axle, 0);
  END IF;

  SELECT l.rate INTO lab FROM rate_card_labour l
   WHERE l.card_id = p_card AND l.pool = r.pool AND l.charge_to = 'customer';
  was := rate_card_price(r, lab);

  UPDATE rate_card_rates
     SET override_value = p_value,
         overridden_by  = CASE WHEN p_value IS NULL THEN NULL ELSE current_actor() END,
         overridden_at  = CASE WHEN p_value IS NULL THEN NULL ELSE NOW() END,
         updated_at     = NOW()
   WHERE id = r.id;

  PERFORM rate_card_log(
    p_card,
    CASE WHEN p_value IS NULL THEN 'revert' ELSE 'override' END,
    r.item || CASE WHEN r.axle > 0 THEN ' (' || r.axle || '-axle)' ELSE '' END,
    TO_CHAR(was, 'FM999999.00'),
    CASE WHEN p_value IS NULL
         THEN TO_CHAR(rate_card_price(
                (SELECT x FROM rate_card_rates x WHERE x.id = r.id), lab), 'FM999999.00')
         ELSE TO_CHAR(p_value, 'FM999999.00') END,
    1, FALSE);

  RETURN QUERY
  SELECT (r.cap IS NOT NULL AND p_value IS NOT NULL AND p_value > r.cap), r.cap, r.cap_by;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_set_rate(UUID, TEXT, INT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_set_rate(UUID, TEXT, INT, NUMERIC) TO authenticated;


-- -------------------------------------------------------------
-- 16. A custom labour rate, which is the non-inclusive one.
--
-- See section 3 for the business's own description. A Gold customer's A
-- services are billed to STC at one rate; their brake work, which Gold
-- does not include, is billed to the customer at another. Both print on
-- the card so the admin team knows which to raise.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_add_labour(
  p_card UUID, p_pool TEXT, p_label TEXT, p_rate NUMERIC,
  p_charge_to TEXT DEFAULT 'customer', p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  new_id UUID;
  pos    INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Adding a labour rate needs the right to set one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  IF p_charge_to NOT IN ('stc', 'customer') THEN
    RAISE EXCEPTION 'A labour rate is billed either to STC or to the customer, not to "%".', p_charge_to;
  END IF;
  IF COALESCE(TRIM(p_label), '') = '' THEN
    RAISE EXCEPTION 'A custom labour rate needs a name, or nobody reading the card knows what it is for.';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1 INTO pos FROM rate_card_labour WHERE card_id = p_card;

  INSERT INTO rate_card_labour (card_id, pool, label, rate, charge_to, is_custom, note, position)
  VALUES (p_card, p_pool, TRIM(p_label), p_rate, p_charge_to, TRUE, p_note, pos)
  RETURNING id INTO new_id;

  PERFORM rate_card_log(
    p_card, 'labour', 'Added ' || TRIM(p_label)
      || CASE WHEN p_charge_to = 'stc' THEN ', billed to STC' ELSE ', billed to the customer' END,
    NULL, TO_CHAR(p_rate, 'FM999999.00'), 0, FALSE);

  RETURN new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_add_labour(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_add_labour(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION rate_card_remove_labour(p_card UUID, p_labour UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l rate_card_labour%ROWTYPE;
  n INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Removing a labour rate needs the right to set one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  SELECT * INTO l FROM rate_card_labour WHERE id = p_labour AND card_id = p_card;
  IF NOT FOUND THEN RAISE EXCEPTION 'That card has no such labour rate.'; END IF;
  IF NOT l.is_custom THEN
    RAISE EXCEPTION
      'The five labour rates the template ships with cannot be removed: rates on this card derive from them. Set one to zero if it does not apply.';
  END IF;

  SELECT COUNT(*) INTO n FROM rate_card_rates
   WHERE card_id = p_card AND basis = 'derived' AND pool = l.pool;
  IF n > 0 THEN
    RAISE EXCEPTION '% rate(s) derive from %, so removing it would leave them unpriced.', n, l.label;
  END IF;

  DELETE FROM rate_card_labour WHERE id = p_labour;
  PERFORM rate_card_log(p_card, 'labour', 'Removed ' || l.label,
                        TO_CHAR(l.rate, 'FM999999.00'), NULL, 0, FALSE);
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_remove_labour(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_remove_labour(UUID, UUID) TO authenticated;


-- -------------------------------------------------------------
-- 17. The card's own details, its managers, and the FleetSmart+ toggle.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_set_detail(
  p_card UUID, p_field TEXT, p_value TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  was TEXT;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Changing a rate card''s details needs the right to build one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  /* Named rather than dynamic, so a caller cannot reach a column this
     function was not meant to write. */
  IF p_field NOT IN ('main_contact', 'address', 'telephone', 'email',
                     'other_detail', 'accounts_detail') THEN
    RAISE EXCEPTION '% is not a detail on a rate card.', p_field;
  END IF;

  EXECUTE format('SELECT %I FROM rate_cards WHERE id = $1', p_field)
    INTO was USING p_card;
  EXECUTE format('UPDATE rate_cards SET %I = $2, updated_at = NOW() WHERE id = $1', p_field)
    USING p_card, NULLIF(TRIM(COALESCE(p_value, '')), '');

  PERFORM rate_card_log(p_card, 'detail', REPLACE(INITCAP(REPLACE(p_field, '_', ' ')), ' Detail', ''),
                        was, NULLIF(TRIM(COALESCE(p_value, '')), ''), 0, FALSE);
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_set_detail(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_set_detail(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION rate_card_set_managers(p_card UUID, p_users UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  was TEXT;
  now_is TEXT;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Setting the account manager needs the right to build a rate card.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  SELECT STRING_AGG(COALESCE(p.full_name, p.email), ', ' ORDER BY p.full_name)
    INTO was
    FROM rate_card_managers m JOIN profiles p ON p.id = m.user_id
   WHERE m.card_id = p_card;

  DELETE FROM rate_card_managers WHERE card_id = p_card;
  INSERT INTO rate_card_managers (card_id, user_id, from_crm, position)
  SELECT p_card, u, FALSE, i - 1
    FROM UNNEST(COALESCE(p_users, '{}'::UUID[])) WITH ORDINALITY AS t(u, i)
  ON CONFLICT DO NOTHING;

  SELECT STRING_AGG(COALESCE(p.full_name, p.email), ', ' ORDER BY p.full_name)
    INTO now_is
    FROM rate_card_managers m JOIN profiles p ON p.id = m.user_id
   WHERE m.card_id = p_card;

  PERFORM rate_card_log(p_card, 'manager', 'Account manager', was, now_is, 0, FALSE);
  RETURN COALESCE(ARRAY_LENGTH(p_users, 1), 0);
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_set_managers(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_set_managers(UUID, UUID[]) TO authenticated;

/* Hiding the FleetSmart+ section.

   Presentational only. From the handoff: "Hiding it is presentational
   only and must not unlink the contract." So `contract_id` is not
   touched here and there is no argument for it. */
CREATE OR REPLACE FUNCTION rate_card_show_fleetsmart(p_card UUID, p_show BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  was BOOLEAN;
BEGIN
  IF NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Changing what prints on a rate card needs the right to build one.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);

  SELECT show_fleetsmart INTO was FROM rate_cards WHERE id = p_card;
  UPDATE rate_cards SET show_fleetsmart = p_show, updated_at = NOW() WHERE id = p_card;

  PERFORM rate_card_log(
    p_card, 'fleetsmart', 'FleetSmart+ section on the printed card',
    CASE WHEN was THEN 'shown' ELSE 'hidden' END,
    CASE WHEN p_show THEN 'shown' ELSE 'hidden' END, 0, FALSE);
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_show_fleetsmart(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_show_fleetsmart(UUID, BOOLEAN) TO authenticated;


-- -------------------------------------------------------------
-- 18. Status, and the snapshot approval takes.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_set_status(p_card UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c   rate_cards%ROWTYPE;
  v   INT;
BEGIN
  SELECT * INTO c FROM rate_cards WHERE id = p_card;
  IF NOT FOUND THEN RAISE EXCEPTION 'No rate card with that id.'; END IF;

  IF p_status = 'approved' AND NOT command_may('ratecard.approve') THEN
    RAISE EXCEPTION 'Approving a rate card needs the right to approve one. It becomes what the admin team bills against.';
  END IF;
  IF p_status <> 'approved' AND NOT command_may('ratecard.build') THEN
    RAISE EXCEPTION 'Changing a rate card''s status needs the right to build one.';
  END IF;
  IF p_status NOT IN ('draft', 'awaiting', 'approved', 'superseded', 'withdrawn') THEN
    RAISE EXCEPTION '% is not a status a rate card can be in.', p_status;
  END IF;

  /* Approving supersedes whatever this customer had, which is what
     keeps one live card per customer true without the unique index
     ever having to refuse anybody. */
  IF p_status = 'approved' AND c.contact_id IS NOT NULL THEN
    UPDATE rate_cards SET status = 'superseded'
     WHERE contact_id = c.contact_id AND id <> c.id AND status IN ('awaiting', 'approved');
  END IF;

  UPDATE rate_cards
     SET status = p_status,
         approved_by = CASE WHEN p_status = 'approved' THEN current_actor() ELSE approved_by END,
         approved_at = CASE WHEN p_status = 'approved' THEN NOW() ELSE approved_at END,
         updated_at = NOW()
   WHERE id = p_card;

  /* A version is taken on approval, so last year's sheet can be
     reproduced exactly when a customer compares year on year. */
  IF p_status = 'approved' THEN
    SELECT COALESCE(MAX(version), 0) + 1 INTO v FROM rate_card_versions WHERE card_id = p_card;
    INSERT INTO rate_card_versions (card_id, version, label, snapshot, taken_by)
    SELECT p_card, v, 'Approved ' || TO_CHAR(NOW(), 'DD Mon YYYY'),
           JSONB_BUILD_OBJECT(
             'card',   TO_JSONB(c),
             'labour', COALESCE((SELECT JSONB_AGG(TO_JSONB(l) ORDER BY l.position)
                                   FROM rate_card_labour l WHERE l.card_id = p_card), '[]'::JSONB),
             'rates',  COALESCE((SELECT JSONB_AGG(TO_JSONB(r) ORDER BY r.position, r.axle)
                                   FROM rate_card_rates r WHERE r.card_id = p_card), '[]'::JSONB)
           ),
           current_actor();
  END IF;

  PERFORM rate_card_log(p_card, 'status', 'Status', c.status, p_status, 0, FALSE);
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_set_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_set_status(UUID, TEXT) TO authenticated;


-- -------------------------------------------------------------
-- 19. Rates go up once a year, all at once.
--
-- Statutory rates are skipped BY TYPE rather than by a checkbox somebody
-- has to remember to untick. From the handoff: "Labour changes and bulk
-- uplifts must skip these by type."
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_uplift(p_card UUID, p_percent NUMERIC)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  moved INT := 0;
  n     INT;
BEGIN
  IF NOT command_may('ratecard.labour') THEN
    RAISE EXCEPTION 'Upliftng every rate on a card needs the right to set a labour rate.';
  END IF;
  PERFORM rate_card_must_be_open(p_card);
  IF p_percent IS NULL THEN RAISE EXCEPTION 'An uplift needs a percentage.'; END IF;

  /* The labour rates, which carry the 19 derived ones with them. */
  UPDATE rate_card_labour SET rate = ROUND(rate * (1 + p_percent / 100), 2), updated_at = NOW()
   WHERE card_id = p_card;
  GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;

  /* STC's own flat charges. Not the DVSA fees. */
  UPDATE rate_card_rates
     SET amount = ROUND(amount * (1 + p_percent / 100), 2), updated_at = NOW()
   WHERE card_id = p_card AND basis = 'fixed' AND amount IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;

  /* An override is a price somebody chose. It moves with the uplift
     too, because next year's card is last year's plus the uplift, and
     a row frozen at last year's number is the one that gets missed. */
  UPDATE rate_card_rates
     SET override_value = ROUND(override_value * (1 + p_percent / 100), 2), updated_at = NOW()
   WHERE card_id = p_card AND override_value IS NOT NULL AND basis <> 'statutory';
  GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;

  PERFORM rate_card_log(
    p_card, 'uplift', 'Uplift of ' || TRIM(TO_CHAR(p_percent, 'FM999990.00')) || '%',
    NULL, NULL, moved, FALSE);

  RETURN moved;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_uplift(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_uplift(UUID, NUMERIC) TO authenticated;


-- -------------------------------------------------------------
-- 20. A card that is nearly a year old.
--
-- From the business:
--
--   Rates are usually only good for a year so if a rate card is 11
--   months old, send a notification to the owner of this account that
--   they should look in to it.
--
-- A sweep rather than a scheduled job, for the reason the CRM health
-- chase is a sweep: there is nowhere in this installation to run a cron.
-- It is safe to call at any frequency, because `stale_warned_at` stamps
-- the card and the next sweep skips it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_sweep_stale(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS TABLE (card_id UUID, ref TEXT, customer TEXT, told UUID, months_old NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c RECORD;
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Sweeping for ageing rate cards needs access to the Rate Card Builder.';
  END IF;

  FOR c IN
    SELECT rc.id, rc.ref, rc.customer_name, rc.effective_from, rc.owner_id,
           EXTRACT(EPOCH FROM AGE(CURRENT_DATE, rc.effective_from)) / 2629746 AS months
      FROM rate_cards rc
     WHERE rc.status = 'approved'
       AND rc.stale_warned_at IS NULL
       AND rc.effective_from <= CURRENT_DATE - INTERVAL '11 months'
     ORDER BY rc.effective_from
  LOOP
    /* Whoever owns the card, and every account manager on it, because
       the owner may have left and the card is still being billed. */
    IF NOT p_dry_run THEN
      PERFORM notify(p.user_id, 'ratecard.ageing',
                     c.customer_name || ' rate card is nearly a year old',
                     c.ref || ' took effect on ' || TO_CHAR(c.effective_from, 'DD Mon YYYY')
                       || '. Rates are usually good for a year, so this one wants looking at.',
                     '/dashboard/rate-cards?card=' || c.id)
        FROM (SELECT m.user_id FROM rate_card_managers m WHERE m.card_id = c.id
              UNION
              SELECT c.owner_id WHERE c.owner_id IS NOT NULL) AS p(user_id)
       WHERE p.user_id IS NOT NULL;

      UPDATE rate_cards SET stale_warned_at = NOW() WHERE id = c.id;
      PERFORM rate_card_log(c.id, 'system', 'Nearly a year old, account manager told',
                            NULL, NULL, 0, TRUE);
    END IF;

    card_id := c.id; ref := c.ref; customer := c.customer_name;
    told := c.owner_id; months_old := ROUND(c.months::NUMERIC, 1);
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_sweep_stale(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_sweep_stale(BOOLEAN) TO authenticated;


-- -------------------------------------------------------------
-- 21. The notification kind the sweep raises.
--
-- Registered here rather than assumed, because `notify` refuses a kind
-- nobody has described: a notification with no label, no default and no
-- way to turn it off is worse than none.
-- -------------------------------------------------------------
INSERT INTO notification_kinds
  (key, category, label, blurb, audience, severity, default_on, may_mute,
   capability, self_ok, bundle_title, sort_order)
VALUES
  ('ratecard.ageing', 'crm',
   'A rate card is nearly a year old',
   'Rates are usually good for a year. This goes to whoever owns the account eleven months after the card took effect.',
   'personal', 'attention', TRUE, TRUE, 'ratecard.view', TRUE,
   '{n} rate cards need looking at', 660)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, blurb = EXCLUDED.blurb,
  category = EXCLUDED.category, audience = EXCLUDED.audience, severity = EXCLUDED.severity,
  capability = EXCLUDED.capability, self_ok = EXCLUDED.self_ok,
  bundle_title = EXCLUDED.bundle_title, sort_order = EXCLUDED.sort_order;


-- -------------------------------------------------------------
-- 22. Reading a whole card.
--
-- One call, because the builder needs the card, its labour band, its 45
-- rates already priced, its managers and its FleetSmart+ state to draw
-- a single frame. Five round trips would draw four wrong ones first.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_card_read(p_card UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c   rate_cards%ROWTYPE;
  out JSONB;
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Reading a rate card needs access to the Rate Card Builder.';
  END IF;

  SELECT * INTO c FROM rate_cards WHERE id = p_card;
  IF NOT FOUND THEN RAISE EXCEPTION 'No rate card with that id.'; END IF;

  SELECT JSONB_BUILD_OBJECT(
    'card', TO_JSONB(c) || JSONB_BUILD_OBJECT(
      'days_old', (CURRENT_DATE - c.effective_from),
      'ageing',   (CURRENT_DATE > c.good_until - 30),
      'expired',  (CURRENT_DATE > c.good_until),
      'editable', (c.status IN ('draft', 'awaiting'))
    ),

    'labour', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(l) ORDER BY l.position, l.charge_to)
        FROM rate_card_labour l WHERE l.card_id = p_card), '[]'::JSONB),

    /* Priced here, once, so the screen and the export cannot disagree
       about what a row costs. A derived rate follows the customer-billed
       labour rate for its pool; where an STC-billed rate exists for the
       same pool it is carried alongside, because the admin team needs
       both numbers off one sheet. */
    'rates', COALESCE((
      SELECT JSONB_AGG(
        TO_JSONB(r) || JSONB_BUILD_OBJECT(
          'price',     rate_card_price(r, lc.rate),
          'price_stc', CASE WHEN ls.rate IS NOT NULL AND r.basis = 'derived'
                            THEN ROUND(r.hours * ls.rate, 2) END,
          'would_be',  CASE WHEN r.override_value IS NOT NULL AND r.basis = 'derived'
                            THEN ROUND(r.hours * lc.rate, 2) END,
          'over_cap',  (r.cap IS NOT NULL AND r.override_value IS NOT NULL
                        AND r.override_value > r.cap)
        ) ORDER BY r.position, r.axle)
        FROM rate_card_rates r
        LEFT JOIN rate_card_labour lc
               ON lc.card_id = p_card AND lc.pool = r.pool AND lc.charge_to = 'customer'
        LEFT JOIN rate_card_labour ls
               ON ls.card_id = p_card AND ls.pool = r.pool AND ls.charge_to = 'stc'
       WHERE r.card_id = p_card), '[]'::JSONB),

    'managers', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
               'user_id', m.user_id, 'from_crm', m.from_crm,
               'name', COALESCE(p.full_name, p.email), 'email', p.email)
             ORDER BY m.position)
        FROM rate_card_managers m JOIN profiles p ON p.id = m.user_id
       WHERE m.card_id = p_card), '[]'::JSONB),

    /* The FleetSmart+ side, generated from the contract and never
       typed. A card with no contract gets the tier matrix and a null
       contract, which is the "no contract" state the pack draws. */
    'fleetsmart', JSONB_BUILD_OBJECT(
      'contract', (SELECT TO_JSONB(f) FROM fleetsmart_contracts f WHERE f.id = c.contract_id),
      'shown', c.show_fleetsmart,
      'extras', c.extra_inclusions,
      'inclusions', COALESCE((
        SELECT JSONB_AGG(TO_JSONB(i) ORDER BY i.position) FROM rate_card_inclusions i), '[]'::JSONB)
    ),

    'parts', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(r) ORDER BY r.position)
        FROM rate_card_rates r
       WHERE r.card_id = p_card AND r.section = 'Parts Rates'), '[]'::JSONB),

    /* What is missing and has to be filled in before this goes to a
       customer. From the business: "Pull in things like addresses,
       contacts, phone, email etc where it has it in the CRM, if not
       flag that it's required." The screen draws these as required
       fields rather than leaving a blank line on the sheet. */
    'missing', (
      SELECT COALESCE(JSONB_AGG(f), '[]'::JSONB) FROM (
        SELECT 'main_contact' AS f WHERE COALESCE(TRIM(c.main_contact), '') = ''
        UNION ALL SELECT 'address'   WHERE COALESCE(TRIM(c.address), '') = ''
        UNION ALL SELECT 'telephone' WHERE COALESCE(TRIM(c.telephone), '') = ''
        UNION ALL SELECT 'email'     WHERE COALESCE(TRIM(c.email), '') = ''
        UNION ALL SELECT 'account_manager'
          WHERE NOT EXISTS (SELECT 1 FROM rate_card_managers m WHERE m.card_id = p_card)
      ) AS q
    )
  ) INTO out;

  RETURN out;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_card_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_card_read(UUID) TO authenticated;


-- -------------------------------------------------------------
-- 23. The hub's list.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_cards_list(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, ref TEXT, contact_id UUID, customer_name TEXT,
  status TEXT, effective_from DATE, good_until DATE,
  days_old INT, ageing BOOLEAN, expired BOOLEAN,
  overrides INT, labour_summary TEXT,
  on_contract BOOLEAN, plan TEXT, show_fleetsmart BOOLEAN,
  owner_name TEXT, manager_names TEXT, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('ratecard.view') THEN
    RAISE EXCEPTION 'Seeing the rate cards needs access to the Rate Card Builder.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.ref, c.contact_id, c.customer_name,
         c.status, c.effective_from, c.good_until::DATE,
         (CURRENT_DATE - c.effective_from)::INT,
         (CURRENT_DATE > c.good_until - 30),
         (CURRENT_DATE > c.good_until),
         (SELECT COUNT(*)::INT FROM rate_card_rates r
           WHERE r.card_id = c.id AND r.override_value IS NOT NULL),
         (SELECT STRING_AGG(TRIM(TO_CHAR(l.rate, 'FM999990')), '/' ORDER BY l.position)
            FROM rate_card_labour l WHERE l.card_id = c.id AND l.charge_to = 'customer'),
         (c.contract_id IS NOT NULL),
         (SELECT f.plan FROM fleetsmart_contracts f WHERE f.id = c.contract_id),
         c.show_fleetsmart,
         (SELECT COALESCE(p.full_name, p.email) FROM profiles p WHERE p.id = c.owner_id),
         (SELECT STRING_AGG(COALESCE(p.full_name, p.email), ', ' ORDER BY m.position)
            FROM rate_card_managers m JOIN profiles p ON p.id = m.user_id
           WHERE m.card_id = c.id),
         c.updated_at
    FROM rate_cards c
   WHERE p_status IS NULL OR c.status = p_status
   ORDER BY c.effective_from DESC, c.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION rate_cards_list(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_cards_list(TEXT) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'rate cards: six tables, a permanent change log, and one live card per customer'; END $$;
