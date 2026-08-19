-- =============================================================
-- 027. Paid work that happened, whether or not the transaction did.
--
-- Lusha cannot join a PostgreSQL transaction. Pretending otherwise was
-- the honest-sounding version of a real hole: the lookup happened, a
-- credit was spent, and if the transaction that recorded what it found
-- then failed, the money was gone and the customer was unchanged. A
-- retry spent a second credit for the same answer.
--
-- So the paid call is recorded here BEFORE it happens and its answer is
-- recorded here as soon as it returns, in its own transaction, outside
-- the programme's. The programme then consumes what is stored. If the
-- programme fails, the next attempt at the same confirmation finds the
-- answer already bought and does not buy it again.
--
-- THE KEY IS THE CONFIRMATION, THE RECORD AND THE STRATEGY.
--
-- Server-generated, from the two hashes the confirmation already
-- carries. The same confirmed command retried is the same key and
-- therefore the same purchase. A different sentence, a different
-- customer or a different strategy is a different key and a different
-- purchase, which is what it is.
--
-- This is NOT whole-programme atomicity across an external debit, and it
-- does not claim to be. It is a durable, recoverable external effect:
-- spent at most once per confirmation, and never lost once spent.
-- =============================================================

CREATE TABLE IF NOT EXISTS command_external_attempts (
  -- The idempotency key. Server generated, never supplied by a client.
  key         TEXT PRIMARY KEY,
  capability  TEXT NOT NULL,
  -- The record it was for, and how it was looked up.
  subject_id  UUID,
  strategy    TEXT NOT NULL,
  -- pending  claimed, the provider has not answered yet
  -- done     the provider answered and the answer is here
  -- failed   the provider refused, and said why
  state       TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'done', 'failed')),
  result      JSONB,
  why         TEXT,
  spent_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  settled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_external_attempts_subject
  ON command_external_attempts (subject_id, capability);

ALTER TABLE command_external_attempts ENABLE ROW LEVEL SECURITY;

-- An attempt is visible to whoever spent it. Nothing reads somebody
-- else's, and nothing writes these except the functions below.
DROP POLICY IF EXISTS "external_attempts_own" ON command_external_attempts;
CREATE POLICY "external_attempts_own" ON command_external_attempts
  FOR SELECT USING (spent_by = auth.uid());

-- -------------------------------------------------------------
-- Claiming one, or finding it already bought
-- -------------------------------------------------------------
--
-- Returns the stored answer when this key has already been paid for, so
-- the caller can skip the provider entirely. `pending` from an earlier
-- run that died mid-call is returned as pending: the caller may retry
-- the provider, because a call that never returned an answer is a call
-- whose credit nobody can account for either way.
CREATE OR REPLACE FUNCTION command_external_begin(
  p_key        TEXT,
  p_capability TEXT,
  p_subject    UUID,
  p_strategy   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  found RECORD;
BEGIN
  IF COALESCE(btrim(p_key), '') = '' THEN
    RAISE EXCEPTION 'an external attempt needs a key';
  END IF;

  SELECT * INTO found FROM command_external_attempts WHERE key = p_key;
  IF found.key IS NOT NULL THEN
    IF found.spent_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'that attempt belongs to somebody else';
    END IF;
    RETURN jsonb_build_object(
      'state', found.state, 'result', found.result, 'why', found.why);
  END IF;

  INSERT INTO command_external_attempts (key, capability, subject_id, strategy, spent_by)
  VALUES (p_key, p_capability, p_subject, p_strategy, auth.uid())
  ON CONFLICT (key) DO NOTHING;

  RETURN jsonb_build_object('state', 'pending', 'result', NULL, 'why', NULL);
END;
$$;

REVOKE ALL ON FUNCTION command_external_begin(TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_external_begin(TEXT, TEXT, UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- Recording what came back
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_external_finish(
  p_key    TEXT,
  p_ok     BOOLEAN,
  p_result JSONB DEFAULT NULL,
  p_why    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE command_external_attempts
     SET state = CASE WHEN p_ok THEN 'done' ELSE 'failed' END,
         result = p_result,
         why = p_why,
         settled_at = NOW()
   WHERE key = p_key AND spent_by = auth.uid() AND state = 'pending';

  IF NOT FOUND THEN
    -- Either it was already settled, which is fine and means a retry
    -- raced, or it is not this caller's, which is not.
    IF NOT EXISTS (SELECT 1 FROM command_external_attempts
                    WHERE key = p_key AND spent_by = auth.uid()) THEN
      RAISE EXCEPTION 'there is no attempt of yours with that key';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION command_external_finish(TEXT, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_external_finish(TEXT, BOOLEAN, JSONB, TEXT) TO authenticated;
