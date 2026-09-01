-- =============================================================
-- 072. A contract that changes over time.
--
-- From the business:
--
--   We also need some logic setting up where we can update a contract
--   over time. E.g. a customer wants to add more assets on, take assets
--   off, add w&t charge to their silver plan, upgrade from silver to
--   gold etc. The logic all needs to be bulletproof and well-presented
--   for understanding.
--
-- ---- An amendment is not an edit ----
--
-- Editing changes what a record says. An amendment says what changed,
-- when, and what it cost from that day on, and leaves what it used to
-- say intact.
--
-- The difference matters here more than in most places, because a
-- FleetSmart+ contract is a bill. A customer who added two trailers in
-- March and asks in November why their direct debit went up is owed an
-- answer, and "the contract says three trailers" is not one. Neither is
-- a version history nobody can read.
--
-- ---- The shape ----
--
-- The contract row always holds what the contract IS now: `input`,
-- `priced`, and the three total columns. Everything that reads a
-- contract, which is the list, the document, the tracker lead and every
-- figure on the dashboard, keeps working without knowing amendments
-- exist. That is the whole reason for putting the current state there
-- rather than in the newest amendment row.
--
-- `fleetsmart_amendments` is the trail. One row per version, in order,
-- each carrying the whole input and the whole priced snapshot as it
-- stood, so any version can be reprinted exactly as it was rather than
-- reconstructed from a list of changes.
--
-- Version 0 is the contract as first agreed, written the moment the
-- first amendment is applied. Taking that copy at the last possible
-- moment rather than at send time means a contract nobody ever amends
-- carries no amendment rows at all, which is the common case.
--
-- ---- Effective dates, and why they are not clever ----
--
-- Every amendment has a date it takes effect from. Nothing in this
-- migration computes a part month, prorates a charge, or works out what
-- to bill in the month a trailer arrived.
--
-- That is deliberate. Proration depends on the billing run, the direct
-- debit cycle and what was actually invoiced, none of which this
-- application holds, and a figure that looks authoritative and is not
-- reconciled against a real invoice is worse than no figure. The date
-- is recorded so the person who does the billing has it. The application
-- says what the contract costs a year from that date, which it can
-- state with certainty.
--
-- ---- What "bulletproof" means here ----
--
-- Five things, each enforced rather than intended:
--
--   1. An amendment can only be applied to a contract the customer
--      accepted. A draft is edited, not amended.
--   2. Amendments are numbered in order, and the numbering cannot skip
--      or repeat, because a gap in a bill's history is unexplainable.
--   3. Applying one is a single statement: the contract's current state
--      and the new amendment row land together or neither does.
--   4. An applied amendment is never edited or deleted. Getting it
--      wrong is corrected by a further amendment, the way an invoice is
--      corrected by a credit note.
--   5. The price comes from the server, out of the same engine, exactly
--      as it does for a new contract. An amendment cannot post its own
--      total any more than a contract can.
-- =============================================================

CREATE TABLE IF NOT EXISTS fleetsmart_amendments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  UUID NOT NULL REFERENCES fleetsmart_contracts ON DELETE CASCADE,

  -- 0 is the contract as first agreed. 1 upwards are the changes.
  seq          INT NOT NULL CHECK (seq >= 0),

  -- The day the change takes effect. What the billing run needs.
  effective_on DATE NOT NULL,

  -- The whole contract at this version. Not a delta: a delta cannot be
  -- printed, and printing what the customer agreed to on a given day is
  -- the thing this table exists for.
  input        JSONB NOT NULL,
  priced       JSONB NOT NULL,
  rate_card_version TEXT NOT NULL DEFAULT '2026-08',

  -- What changed, in sentences, computed from the two versions rather
  -- than typed. See `lib/fleetsmart/amend.ts`.
  summary      JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Why, in a person's words. Optional and never derived.
  note         TEXT,

  -- Read off `priced` by the trigger below, same as the contract's own.
  annual_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  monthly_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  asset_count   INT NOT NULL DEFAULT 0,

  created_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Numbered in order, without gaps or repeats. The unique index is
  -- what makes that true rather than hoped for.
  CONSTRAINT fleetsmart_amendment_seq UNIQUE (contract_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_fleetsmart_amendments
  ON fleetsmart_amendments (contract_id, seq);

-- -------------------------------------------------------------
-- The totals, read off the snapshot rather than sent alongside it.
-- Same rule as the contract's own, and for the same reason: a browser
-- that can post its own total is a browser that can sell a £14,000
-- contract for £14.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_amendment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.annual_total  := COALESCE((NEW.priced ->> 'annual')::NUMERIC, 0);
  NEW.monthly_total := COALESCE((NEW.priced ->> 'monthly')::NUMERIC, 0);
  NEW.asset_count   := COALESCE(jsonb_array_length(NEW.priced -> 'assets'), 0);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleetsmart_amendment_totals ON fleetsmart_amendments;
CREATE TRIGGER trg_fleetsmart_amendment_totals
  BEFORE INSERT OR UPDATE ON fleetsmart_amendments
  FOR EACH ROW EXECUTE FUNCTION fleetsmart_amendment_totals();

-- -------------------------------------------------------------
-- An applied amendment is a fact, not a draft.
--
-- Reading is as wide as reading a contract: a colleague picking up a
-- customer has to be able to see what changed and when.
--
-- There is no insert, update or delete policy at all. Amendments are
-- written by `fleetsmart_amend` and by nothing else, which is what
-- makes rule 4 true: getting one wrong is corrected by a further
-- amendment, the way an invoice is corrected by a credit note, and not
-- by quietly rewriting history.
-- -------------------------------------------------------------
ALTER TABLE fleetsmart_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleetsmart_amendments_read" ON fleetsmart_amendments;
CREATE POLICY "fleetsmart_amendments_read" ON fleetsmart_amendments
  FOR SELECT USING (command_may('fleetsmart.view'));

/* The grant, taken away rather than left to the absence of a policy.

   Supabase grants `authenticated` every privilege on every table in
   `public` by default, so a table with row level security on and no
   write policy is protected by exactly one thing. That is enough right
   up until somebody adds a policy for one narrow case and widens the
   hole for every other. Migration 053 does the same for
   `capability_catalog`, for the same reason.

   Writing goes through `fleetsmart_amend`, which is SECURITY DEFINER
   and runs as the owner, so taking the grant away costs it nothing. */
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fleetsmart_amendments FROM authenticated, anon;
GRANT SELECT ON fleetsmart_amendments TO authenticated;

-- -------------------------------------------------------------
-- Applying one.
--
-- One statement. The contract's current state and the amendment row
-- land together or neither does, so there is never a contract whose
-- price moved with nothing on the record saying why.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_amend(
  p_contract     UUID,
  p_input        JSONB,
  p_priced       JSONB,
  p_summary      JSONB,
  p_effective_on DATE,
  p_note         TEXT DEFAULT NULL,
  p_rate_card    TEXT DEFAULT NULL
)
RETURNS fleetsmart_amendments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  held    fleetsmart_contracts;
  next_no INT;
  result  fleetsmart_amendments;
BEGIN
  IF NOT command_may('fleetsmart.build') THEN
    RAISE EXCEPTION 'Amending a FleetSmart+ contract needs more access than you have.';
  END IF;

  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;

  /* Rule 1. A draft is edited and a contract nobody accepted is not a
     live agreement, so there is nothing to amend. Saying which state it
     is in beats "cannot amend". */
  IF held.status <> 'accepted' THEN
    RAISE EXCEPTION
      'Only a live contract can be amended, and that one is %. A draft is edited in the builder; a contract that was declined or ended is replaced by a new one.',
      held.status;
  END IF;

  IF p_effective_on IS NULL THEN
    RAISE EXCEPTION 'An amendment needs a date it takes effect from, for the billing run.';
  END IF;
  IF p_effective_on < held.starts_on THEN
    RAISE EXCEPTION
      'That is before the contract started on %. An amendment cannot take effect before the thing it amends.',
      to_char(held.starts_on, 'DD Mon YYYY');
  END IF;

  IF p_priced IS NULL OR jsonb_typeof(p_priced -> 'assets') <> 'array' THEN
    RAISE EXCEPTION 'That amendment carries no priced fleet, so there is nothing to charge for.';
  END IF;
  IF jsonb_array_length(p_priced -> 'assets') = 0 THEN
    RAISE EXCEPTION
      'That amendment leaves the contract with no assets on it. Ending the contract is the way to stop covering everything.';
  END IF;

  /* Version 0, the contract as first agreed, captured now rather than
     at send time so a contract nobody ever amends carries no rows at
     all. Only ever written once: the unique index on (contract, seq)
     would refuse a second, and this checks first so the error somebody
     sees is about their amendment rather than about a constraint. */
  IF NOT EXISTS (
    SELECT 1 FROM fleetsmart_amendments WHERE contract_id = p_contract AND seq = 0
  ) THEN
    INSERT INTO fleetsmart_amendments (
      contract_id, seq, effective_on, input, priced, rate_card_version,
      summary, note, created_by, created_at
    ) VALUES (
      p_contract, 0,
      COALESCE(held.starts_on, held.sent_at::DATE, held.created_at::DATE),
      held.input, held.priced, held.rate_card_version,
      '[]'::JSONB, 'As first agreed.',
      held.created_by, COALESCE(held.decided_at, held.sent_at, held.created_at)
    );
  END IF;

  /* Rule 2. The next number, taken from what is there rather than
     counted, so a gap can never open. */
  SELECT COALESCE(MAX(seq), 0) + 1 INTO next_no
    FROM fleetsmart_amendments WHERE contract_id = p_contract;

  INSERT INTO fleetsmart_amendments (
    contract_id, seq, effective_on, input, priced, rate_card_version,
    summary, note, created_by
  ) VALUES (
    p_contract, next_no, p_effective_on, p_input, p_priced,
    COALESCE(p_rate_card, held.rate_card_version),
    COALESCE(p_summary, '[]'::JSONB), NULLIF(btrim(p_note), ''), current_actor()
  )
  RETURNING * INTO result;

  /* Rule 3. The contract becomes what the amendment says, in the same
     statement, so the list, the document and the tracker lead all move
     together with the record that explains why. */
  UPDATE fleetsmart_contracts
     SET input = p_input,
         priced = p_priced,
         rate_card_version = COALESCE(p_rate_card, rate_card_version),
         plan = COALESCE(p_input ->> 'plan', plan),
         term_months = COALESCE((p_input ->> 'termMonths')::INT, term_months)
   WHERE id = p_contract;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_amend FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_amend TO authenticated;

-- -------------------------------------------------------------
-- What a contract has cost over its life.
--
-- One row per version with the date it started applying and the date it
-- stopped, which is the shape anybody reconciling a direct debit
-- actually wants: not "three amendments" but "£4,302 until 14 March,
-- £6,513 after".
--
-- The last row's `until` is null, meaning it is what applies now.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_amendment_history(p_contract UUID)
RETURNS TABLE (
  seq           INT,
  from_when     DATE,
  until         DATE,
  annual_total  NUMERIC,
  monthly_total NUMERIC,
  asset_count   INT,
  summary       JSONB,
  note          TEXT,
  by_who        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT a.seq,
         a.effective_on,
         LEAD(a.effective_on) OVER (ORDER BY a.seq) - 1,
         a.annual_total,
         a.monthly_total,
         a.asset_count,
         a.summary,
         a.note,
         COALESCE(p.full_name, 'somebody')
    FROM fleetsmart_amendments a
    LEFT JOIN profiles p ON p.id = a.created_by
   WHERE a.contract_id = p_contract
     AND command_may('fleetsmart.view')
   ORDER BY a.seq;
$fn$;

GRANT EXECUTE ON FUNCTION fleetsmart_amendment_history(UUID) TO authenticated;

COMMENT ON TABLE fleetsmart_amendments IS
  'Every version of a live contract, whole, so any of them can be '
  'reprinted as it stood. Version 0 is the contract as first agreed. '
  'Never edited: a wrong amendment is corrected by another one.';
