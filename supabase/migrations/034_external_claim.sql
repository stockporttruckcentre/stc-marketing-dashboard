-- =============================================================
-- 034. Claiming a paid call, rather than noticing one is missing.
--
-- Migration 027 said an external attempt is "spent at most once per
-- confirmation" and did not establish it. The read and the insert were
-- two statements:
--
--   A  SELECT key   -> none
--   B  SELECT key   -> none
--   A  INSERT       -> succeeds
--   B  INSERT ON CONFLICT DO NOTHING -> writes nothing
--   A  returns pending
--   B  returns pending
--
-- Both callers saw `pending`, and `pending` meant "go and call the
-- provider". Two simultaneous confirmations of the same lookup spent
-- two credits.
--
-- THE INSERT IS THE CLAIM.
--
-- There is exactly one way to find out whether you claimed an attempt,
-- and it is whether your INSERT produced a row. `ON CONFLICT DO NOTHING
-- RETURNING key` answers that in one statement under the primary key's
-- own uniqueness, which is the only thing here that serialises. The
-- loser reads the row and is told what is happening to it. It never
-- calls the provider.
--
-- WHAT THE CALLER IS TOLD.
--
--   claimed      you own this attempt. Call the provider, then settle it
--   in_progress  somebody else owns it and has not settled it yet
--   done         it was bought, and the answer is here
--   failed       the provider refused, and said why
--   uncertain    a claim was made and never settled. See below
--
-- ONLY `claimed` PERMITS A PROVIDER CALL. Everything else is a caller
-- consuming, waiting, or stopping.
--
-- WHY `uncertain` IS NOT `pending`.
--
-- A process that claims an attempt, calls Lusha, and dies before
-- settling leaves a claim behind. Whether the credit was spent is
-- unknowable from here: the request may never have left, or it may have
-- been answered and charged.
--
-- Retrying is only safe if the provider deduplicates on a key we
-- supply. Lusha does not. `lib/lusha.ts` shows the whole surface this
-- application uses: `GET /v2/person`, `POST /prospecting/*`, one
-- `api_key` header, and no idempotency key anywhere in the request. So
-- an unsettled claim past `STALE_AFTER` is reported as `uncertain` and
-- the runtime stops. It is a thing for a person to reconcile against
-- the Lusha console, not a thing to gamble another credit on.
--
-- SERVER ONLY.
--
-- This ledger is the record of an irreversible purchase, and the
-- canonical runtime turns a stored `done` result into database changes.
-- A browser that could write here could manufacture provider evidence.
-- `authenticated` is revoked from every function below; they are
-- reachable only through the service role, from the server, behind the
-- ordinary `crm.enrich` capability check on the real actor.
--
-- The actor is recorded explicitly rather than taken from `auth.uid()`,
-- because under the service role there is no `auth.uid()` to take.
-- =============================================================

-- The states a row can be in. `uncertain` is new: see the header.
ALTER TABLE command_external_attempts
  DROP CONSTRAINT IF EXISTS command_external_attempts_state_check;
ALTER TABLE command_external_attempts
  ADD CONSTRAINT command_external_attempts_state_check
  CHECK (state IN ('pending', 'done', 'failed', 'uncertain'));

-- When the claim was made, so an unsettled one can be aged out, and how
-- many times somebody has come back to it.
ALTER TABLE command_external_attempts
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE command_external_attempts
  ADD COLUMN IF NOT EXISTS seen INTEGER DEFAULT 0 NOT NULL;

-- `spent_by` referenced auth.users and was set from auth.uid(). Under
-- the service role there is no auth.uid(), so the real actor is passed
-- in and recorded. The reference stays: it is still a person.
ALTER TABLE command_external_attempts
  ALTER COLUMN spent_by DROP DEFAULT;

-- How long an unsettled claim is treated as somebody else still
-- working, before it becomes a thing to reconcile. Long enough that a
-- slow provider is not declared dead, short enough that a real crash is
-- not left looking like traffic.
CREATE OR REPLACE FUNCTION command_external_stale_after()
RETURNS INTERVAL LANGUAGE SQL IMMUTABLE AS $$ SELECT INTERVAL '5 minutes' $$;

-- -------------------------------------------------------------
-- Claiming one
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_external_claim(
  p_key        TEXT,
  p_capability TEXT,
  p_subject    UUID,
  p_strategy   TEXT,
  p_actor      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mine  TEXT;
  found RECORD;
BEGIN
  IF COALESCE(btrim(p_key), '') = '' THEN
    RAISE EXCEPTION 'an external attempt needs a key';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'an external attempt needs an actor';
  END IF;

  -- THE CLAIM. One statement, decided by the primary key.
  --
  -- `RETURNING key` comes back only when this statement wrote the row.
  -- That is the whole race: whoever writes it calls the provider, and
  -- there is exactly one of them however many callers arrive together.
  INSERT INTO command_external_attempts
    (key, capability, subject_id, strategy, spent_by, state, claimed_at)
  VALUES (p_key, p_capability, p_subject, p_strategy, p_actor, 'pending', NOW())
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO mine;

  IF mine IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'claimed', 'result', NULL, 'why', NULL);
  END IF;

  -- Somebody else has it, or it is already settled. Count the look so a
  -- caller that keeps coming back is visible.
  UPDATE command_external_attempts SET seen = seen + 1 WHERE key = p_key;
  SELECT * INTO found FROM command_external_attempts WHERE key = p_key;

  IF found.state = 'done' THEN
    RETURN jsonb_build_object('state', 'done', 'result', found.result, 'why', NULL);
  END IF;
  IF found.state = 'failed' THEN
    RETURN jsonb_build_object('state', 'failed', 'result', NULL, 'why', found.why);
  END IF;
  IF found.state = 'uncertain' THEN
    RETURN jsonb_build_object('state', 'uncertain', 'result', NULL, 'why', found.why);
  END IF;

  -- Unsettled. Still somebody else's work, or old enough that nobody is
  -- coming back for it.
  IF found.claimed_at < NOW() - command_external_stale_after() THEN
    UPDATE command_external_attempts
       SET state = 'uncertain',
           why = 'a claim was made and never settled, so whether the provider charged for it is unknown'
     WHERE key = p_key AND state = 'pending';
    RETURN jsonb_build_object(
      'state', 'uncertain', 'result', NULL,
      'why', 'a claim was made and never settled, so whether the provider charged for it is unknown');
  END IF;

  RETURN jsonb_build_object('state', 'in_progress', 'result', NULL, 'why', NULL);
END;
$$;

-- -------------------------------------------------------------
-- Settling one
-- -------------------------------------------------------------
--
-- Only the claim's own owner settles it, and only while it is
-- unsettled. Settling somebody else's, or settling twice, is refused
-- rather than quietly overwriting a purchased answer.
CREATE OR REPLACE FUNCTION command_external_settle(
  p_key    TEXT,
  p_actor  UUID,
  p_state  TEXT,
  p_result JSONB DEFAULT NULL,
  p_why    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed INTEGER;
BEGIN
  IF p_state NOT IN ('done', 'failed', 'uncertain') THEN
    RAISE EXCEPTION '% is not a state an attempt can be settled into', p_state;
  END IF;

  UPDATE command_external_attempts
     SET state = p_state, result = p_result, why = p_why, settled_at = NOW()
   WHERE key = p_key AND spent_by = p_actor AND state = 'pending';
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM command_external_attempts WHERE key = p_key) THEN
      RAISE EXCEPTION 'there is no attempt with that key to settle';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM command_external_attempts
                    WHERE key = p_key AND spent_by = p_actor) THEN
      RAISE EXCEPTION 'that attempt belongs to somebody else';
    END IF;
    -- Already settled. Not a failure: a retry raced with itself.
    RETURN jsonb_build_object('settled', FALSE);
  END IF;

  RETURN jsonb_build_object('settled', TRUE);
END;
$$;

-- -------------------------------------------------------------
-- Reading one back
-- -------------------------------------------------------------
--
-- For reconciliation and for the checks. Never claims anything.
CREATE OR REPLACE FUNCTION command_external_read(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found RECORD;
BEGIN
  SELECT * INTO found FROM command_external_attempts WHERE key = p_key;
  IF found.key IS NULL THEN
    RETURN jsonb_build_object('state', 'absent');
  END IF;
  RETURN jsonb_build_object(
    'state', found.state, 'result', found.result, 'why', found.why,
    'actor', found.spent_by, 'seen', found.seen,
    'claimedAt', found.claimed_at, 'settledAt', found.settled_at);
END;
$$;

-- -------------------------------------------------------------
-- Who may run any of this
-- -------------------------------------------------------------
--
-- Nobody with a browser. The ledger is provider evidence, and a
-- signed-in client that could write it could manufacture a Lusha
-- result the command runtime would then turn into database changes.
REVOKE ALL ON FUNCTION command_external_claim(TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_external_settle(TEXT, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_external_read(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_external_claim(TEXT, TEXT, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION command_external_settle(TEXT, UUID, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION command_external_read(TEXT) TO service_role;

-- The two from migration 027 are withdrawn from everybody. They were
-- reachable through PostgREST by any signed-in user, and the second one
-- accepted an arbitrary result JSON.
REVOKE ALL ON FUNCTION command_external_begin(TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_external_begin(TEXT, TEXT, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION command_external_finish(TEXT, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_external_finish(TEXT, BOOLEAN, JSONB, TEXT) FROM authenticated;

-- The table itself is not written by anybody through PostgREST either.
REVOKE INSERT, UPDATE, DELETE ON command_external_attempts FROM authenticated;

-- -------------------------------------------------------------
-- The dispatch forgets it ever performed these
-- -------------------------------------------------------------
--
-- `command_invoke_one` never had a branch for the ledger and must not
-- gain one: a programme step is a thing an authenticated actor asks
-- for, and this is not.
