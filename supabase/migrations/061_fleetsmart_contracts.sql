-- =============================================================
-- 061. FleetSmart+ contracts.
--
-- The maintenance plan STC sells, built in the application rather than
-- in `FleetSmart_Contract_Builder.xlsx`. The workbook stays the source
-- of the rate card and the wording; what moves here is the act of
-- building one for a named customer, which the spreadsheet cannot do
-- because it has no idea who the customer is.
--
-- ---- Why the whole thing is stored twice ----
--
-- `input` is what somebody typed: the plan, the term, the fleet, the
-- discounts. `priced` is what the engine made of it: every line, every
-- frequency, every cost, and the totals.
--
-- Keeping both looks redundant and is the opposite. The rate card will
-- change, because prices go up. A contract signed in March at March's
-- prices has to keep printing March's numbers in October, or the
-- document in the customer's drawer and the document on the screen stop
-- agreeing, and only one of them is enforceable.
--
-- So `priced` is a snapshot, taken at the moment the contract was
-- built, and `rate_card_version` says which rate card produced it.
-- Reopening a draft reprices from `input`, which is what a draft is
-- for. Reopening something already sent shows the snapshot.
--
-- ---- The money columns are not the truth ----
--
-- `annual_total` and `monthly_total` are copies of two numbers inside
-- `priced`, kept as columns so a list can sort and total without
-- unpacking JSON on every row. A trigger keeps them honest rather than
-- the application, because a figure the screen writes is a figure the
-- screen can get wrong.
-- =============================================================

CREATE TABLE IF NOT EXISTS fleetsmart_contracts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What somebody says out loud: "send FS-31 over".
  ref            TEXT UNIQUE,

  -- Who it is for. The account is the customer in the CRM, and the lead
  -- is the pitch it came out of, where there is one. Both are optional
  -- and for the same reason: a price gets built in a meeting before
  -- anybody has made a record of the company.
  account_id     UUID REFERENCES crm_contacts ON DELETE SET NULL,
  lead_id        UUID REFERENCES crm_leads ON DELETE SET NULL,

  -- Denormalised so a contract still reads correctly after the account
  -- it pointed at is renamed or deleted. What the customer signed said
  -- this name on it.
  customer_name  TEXT NOT NULL DEFAULT '',

  plan           TEXT NOT NULL DEFAULT 'Platinum'
                   CHECK (plan IN ('Silver', 'Gold', 'Platinum')),
  term_months    INT  NOT NULL DEFAULT 36 CHECK (term_months > 0),
  starts_on      DATE,

  -- draft    still being built
  -- sent     the customer has it, and the price is now a commitment
  -- accepted signed
  -- declined they said no
  -- expired  nobody followed it up
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),

  -- What was typed, and what the engine made of it. See the header.
  input          JSONB NOT NULL DEFAULT '{}'::JSONB,
  priced         JSONB NOT NULL DEFAULT '{}'::JSONB,
  extras         JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Which rate card produced `priced`. Bumped in `lib/fleetsmart/ratecard.ts`
  -- whenever a price changes, so a contract can say what it was priced
  -- against rather than only when.
  rate_card_version TEXT NOT NULL DEFAULT '2026-08',

  -- Copies of two figures inside `priced`, kept by the trigger below.
  annual_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  monthly_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  asset_count    INT NOT NULL DEFAULT 0,

  sent_at        TIMESTAMPTZ,
  sent_to        TEXT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,

  owner_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A contract that has gone out has a date on it, and one that has not
  -- does not. Without this the list can show something as sent with no
  -- record of when, which is the state nobody can reconstruct later.
  CONSTRAINT fleetsmart_sent_has_a_date CHECK (
    (status = 'draft') OR (status <> 'draft' AND sent_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fleetsmart_account ON fleetsmart_contracts (account_id);
CREATE INDEX IF NOT EXISTS idx_fleetsmart_lead    ON fleetsmart_contracts (lead_id);
CREATE INDEX IF NOT EXISTS idx_fleetsmart_owner   ON fleetsmart_contracts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetsmart_status  ON fleetsmart_contracts (status, created_at DESC);

-- -------------------------------------------------------------
-- The reference somebody quotes.
-- -------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS fleetsmart_ref_seq;

-- The trigger below runs as whoever is inserting rather than as the
-- owner, so without this every insert fails on the sequence rather than
-- on anything to do with the contract. Same grant migration 056 makes
-- for `task_ref_seq`, and for the same reason.
GRANT USAGE ON SEQUENCE fleetsmart_ref_seq TO authenticated;

CREATE OR REPLACE FUNCTION fleetsmart_assign_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.ref IS NULL THEN
    NEW.ref := 'FS-' || nextval('fleetsmart_ref_seq')::TEXT;
    -- A collision only happens where somebody has typed a ref by hand.
    -- Stepping past it beats failing the insert.
    WHILE EXISTS (SELECT 1 FROM fleetsmart_contracts WHERE ref = NEW.ref) LOOP
      NEW.ref := 'FS-' || nextval('fleetsmart_ref_seq')::TEXT;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleetsmart_ref ON fleetsmart_contracts;
CREATE TRIGGER trg_fleetsmart_ref BEFORE INSERT ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION fleetsmart_assign_ref();

-- -------------------------------------------------------------
-- The totals, read off the snapshot rather than sent alongside it.
--
-- `priced` is computed on the server, by the same engine the screen
-- runs, from the `input` that arrived: `/api/fleetsmart/contracts`
-- never takes a price from a browser, because a browser that can post
-- its own total is a browser that can sell a £14,000 contract for £14.
--
-- These three columns are then read out of that snapshot rather than
-- accepted separately, so a list sorting by annual total and a document
-- printing the monthly figure cannot disagree.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.annual_total  := COALESCE((NEW.priced ->> 'annual')::NUMERIC, 0);
  NEW.monthly_total := COALESCE((NEW.priced ->> 'monthly')::NUMERIC, 0);
  NEW.asset_count   := COALESCE(jsonb_array_length(NEW.priced -> 'assets'), 0);
  NEW.updated_at    := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleetsmart_totals ON fleetsmart_contracts;
CREATE TRIGGER trg_fleetsmart_totals BEFORE INSERT OR UPDATE ON fleetsmart_contracts
  FOR EACH ROW EXECUTE FUNCTION fleetsmart_totals();

-- -------------------------------------------------------------
-- Row level security.
--
-- Reading is wide, because a colleague picking up a customer needs to
-- see what was already quoted them, and a contract nobody can find is a
-- contract that gets built twice at two prices.
--
-- Writing is narrow and follows the capabilities: build to create,
-- build plus ownership to change, and send to put one out.
-- -------------------------------------------------------------
ALTER TABLE fleetsmart_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleetsmart_select" ON fleetsmart_contracts;
CREATE POLICY "fleetsmart_select" ON fleetsmart_contracts
  FOR SELECT USING (command_may('fleetsmart.view'));

DROP POLICY IF EXISTS "fleetsmart_insert" ON fleetsmart_contracts;
CREATE POLICY "fleetsmart_insert" ON fleetsmart_contracts
  FOR INSERT WITH CHECK (command_may('fleetsmart.build') AND created_by = current_actor());

/* A draft, and only your own.

   Two rules in one policy, and both were written the weaker way first.

   A contract that has gone out is frozen for everybody, including the
   person who sent it. The first version let anybody holding
   `fleetsmart.send` edit a sent contract, which is every salesman, and
   a freeze that exempts the people who do the work is not a freeze. The
   price is in the customer's inbox: changing the record behind it is
   how the two copies stop agreeing, and only one of them is
   enforceable. Anything a sent contract still needs to do, it does
   through `fleetsmart_send` and `fleetsmart_decide`, which are the two
   transitions there are.

   A draft belongs to whoever built it. Somebody who wants a different
   price on the same fleet copies it, which is one press and leaves the
   original alone.

   No WITH CHECK, deliberately: with only a USING clause Postgres tests
   the new row against it as well, so an update that moved the status
   off `draft` fails. That is the intent. The status is not a column
   anybody types over. */
DROP POLICY IF EXISTS "fleetsmart_update" ON fleetsmart_contracts;
CREATE POLICY "fleetsmart_update" ON fleetsmart_contracts
  FOR UPDATE USING (
    command_may('fleetsmart.build')
    AND status = 'draft'
    AND (owner_id = current_actor() OR created_by = current_actor())
  );

DROP POLICY IF EXISTS "fleetsmart_delete" ON fleetsmart_contracts;
CREATE POLICY "fleetsmart_delete" ON fleetsmart_contracts
  FOR DELETE USING (
    command_may('fleetsmart.build')
    AND status = 'draft'
    AND (owner_id = current_actor() OR created_by = current_actor())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON fleetsmart_contracts TO authenticated;

-- -------------------------------------------------------------
-- Sending one.
--
-- A function rather than an update, because sending is the moment a
-- price stops being a draft and becomes a number the customer will hold
-- STC to. It asks for its own capability, stamps who and when, and
-- refuses to send the same contract twice.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleetsmart_send(p_contract UUID, p_to TEXT DEFAULT NULL)
RETURNS fleetsmart_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result fleetsmart_contracts;
  held   fleetsmart_contracts;
BEGIN
  IF NOT command_may('fleetsmart.send') THEN
    RAISE EXCEPTION 'Sending a contract to a customer needs the send permission. Ask an administrator.';
  END IF;

  SELECT * INTO held FROM fleetsmart_contracts WHERE id = p_contract;
  IF held IS NULL THEN
    RAISE EXCEPTION 'There is no contract with that id.';
  END IF;
  IF held.status <> 'draft' THEN
    RAISE EXCEPTION 'That contract went out on %. Build a new one rather than sending this again.',
      to_char(held.sent_at, 'DD Mon YYYY');
  END IF;
  IF COALESCE(held.asset_count, 0) = 0 THEN
    RAISE EXCEPTION 'That contract has no assets on it, so there is nothing to send.';
  END IF;

  UPDATE fleetsmart_contracts
     SET status = 'sent', sent_at = NOW(), sent_to = p_to
   WHERE id = p_contract
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_send FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_send TO authenticated;

-- -------------------------------------------------------------
-- Answering one.
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
BEGIN
  IF NOT command_may('fleetsmart.build') THEN
    RAISE EXCEPTION 'You cannot record a decision on a FleetSmart+ contract.';
  END IF;
  IF p_status NOT IN ('accepted', 'declined', 'expired') THEN
    RAISE EXCEPTION 'A contract is accepted, declined or expired.';
  END IF;

  UPDATE fleetsmart_contracts
     SET status = p_status, decided_at = NOW(), decision_note = p_note
   WHERE id = p_contract AND status <> 'draft'
  RETURNING * INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'That contract has not been sent yet, so there is nothing to answer.';
  END IF;
  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION fleetsmart_decide FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleetsmart_decide TO authenticated;

COMMENT ON TABLE fleetsmart_contracts IS
  'A FleetSmart+ maintenance contract. `input` is what was typed and '
  '`priced` is what the engine made of it, kept as a snapshot so a '
  'contract signed at one rate card still prints its own numbers after '
  'the rate card moves.';
