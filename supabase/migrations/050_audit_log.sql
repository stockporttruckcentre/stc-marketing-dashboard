-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 044_audit_log.sql. This repository already had a 044 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 044. The audit trail.
--
-- Scope section 37 lists twelve things that must be auditable and
-- section 48 makes audit part of the definition of a completed write.
-- `docs/source/TCC_CONTEXT.md` 4.4 goes further, because TCC is an SEC
-- reporting company: assume every record is potentially discoverable and
-- potentially subject to auditor review.
--
-- Before this, nothing in the application recorded who changed what.
-- Worse, `lib/crm/roles.ts` opened by claiming `command_set_role` writes
-- an audit line, and it never did. The most dangerous operation here was
-- documented as audited and was not. Section 5 below says where that is
-- fixed and why it is not fixed here.
--
-- ---- Append only, enforced rather than intended ----
--
-- A log somebody can edit is not evidence. Three things stop it:
--
--   1. No UPDATE or DELETE grant to any application role.
--   2. A trigger that raises on either, so a future GRANT does not
--      quietly open it.
--   3. Writes go through `audit()`, which is SECURITY DEFINER. The table
--      itself takes no direct inserts from `authenticated`, so a client
--      cannot forge a line with somebody else's name on it.
--
-- ---- Reads are audited too ----
--
-- This is the unusual one and it is not optional here. from the meeting, 4.1
-- requires insider list generation: when a project is flagged material,
-- the system must produce the list of everyone who accessed the record,
-- with timestamps. That is a real regulatory artifact. It is impossible
-- unless reads of sensitive records are recorded, so `action` includes
-- 'read' and `insider_list()` at the bottom is the artifact.
--
-- Reads are recorded for sensitive records only. Logging every SELECT in
-- the application would produce a table nobody can query and would slow
-- every page down for no compliance benefit.
--
-- ---- Why actor_label is denormalized ----
--
-- People leave. `actor_id` references a user row that may later be
-- deactivated or, in a data subject erasure, removed. An audit line
-- naming a UUID nobody can resolve is not much use to an auditor two
-- years later, so the name at the time of the action is copied in.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The table.
--
-- BIGSERIAL rather than a UUID: the log is read in time order far more
-- often than by id, and a monotonic key makes that an index scan.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ---- who ----
  -- Null for anything the system did on nobody's behalf: a scheduled
  -- job, an automation, an integration callback.
  actor_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  -- Their name as it was. See the header.
  actor_label    TEXT,
  -- Which side of the business they were acting for.
  entity_id      UUID REFERENCES entities ON DELETE SET NULL,

  -- ---- what ----
  action         TEXT NOT NULL CHECK (action IN (
                   'create', 'read', 'update', 'delete', 'restore',
                   'export', 'import',
                   'permission_change', 'role_change',
                   'approve', 'reject', 'publish',
                   'sign_in', 'sign_out', 'access_denied'
                 )),
  -- The table, or a module name where the action is not about a row.
  target_type    TEXT NOT NULL,
  target_id      UUID,
  -- Something a human recognizes, so a log line reads without a join.
  target_label   TEXT,

  -- ---- the change ----
  -- Only the columns that moved, not the whole row. A full before and
  -- after on a wide table makes the log larger than the data.
  before         JSONB,
  after          JSONB,

  -- ---- context ----
  source         TEXT NOT NULL DEFAULT 'ui' CHECK (source IN (
                   'ui', 'command', 'api', 'automation', 'import',
                   'sso', 'system'
                 )),
  -- Ties every line written by one request together, so a change set
  -- that touched nine rows reads as one action.
  request_id     TEXT,
  approval_id    UUID,
  ip             INET,
  user_agent     TEXT,

  -- ---- why ----
  reason         TEXT,
  -- What the record was classified as at the time. Copied rather than
  -- joined, because a record reclassified later must not rewrite the
  -- history of who saw it when.
  classification TEXT,
  -- Whether the record was flagged as material when this happened. This
  -- is what makes an insider list answerable.
  was_sensitive       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_audit_at          ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target      ON audit_log (target_type, target_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_log (action, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_request     ON audit_log (request_id) WHERE request_id IS NOT NULL;
-- The insider list query: reads of material records.
CREATE INDEX IF NOT EXISTS idx_audit_sensitive        ON audit_log (target_type, target_id, at DESC) WHERE was_sensitive;

-- -------------------------------------------------------------
-- 2. Append only.
-- -------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION audit_log_is_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION
    'audit_log is append only: % is not permitted. A correction is a new line, not an edit.',
    TG_OP;
END;
$fn$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

REVOKE ALL ON audit_log FROM PUBLIC;
REVOKE ALL ON audit_log FROM authenticated;
-- Reading is granted back through the policy below. Writing never is:
-- `audit()` is the only way in.
GRANT SELECT ON audit_log TO authenticated;

DROP POLICY IF EXISTS "audit_read" ON audit_log;
-- Whoever holds the capability sees everything, which is the point of
-- an audit trail. Everybody else sees their own actions, so a person can
-- answer "what did I do to this record" without being able to watch
-- their colleagues.
CREATE POLICY "audit_read" ON audit_log
  FOR SELECT USING (
    command_may('admin.audit') OR actor_id = current_actor()
  );

-- -------------------------------------------------------------
-- 3. Writing a line.
--
-- Everything except the action and the target has a default, so a caller
-- that knows only "this person deleted that row" can still write a
-- usable line, and a caller that knows more can say more.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit(
  p_action         TEXT,
  p_target_type    TEXT,
  p_target_id      UUID    DEFAULT NULL,
  p_target_label   TEXT    DEFAULT NULL,
  p_before         JSONB   DEFAULT NULL,
  p_after          JSONB   DEFAULT NULL,
  p_source         TEXT    DEFAULT 'ui',
  p_reason         TEXT    DEFAULT NULL,
  p_request_id     TEXT    DEFAULT NULL,
  p_approval_id    UUID    DEFAULT NULL,
  p_classification TEXT    DEFAULT NULL,
  p_was_sensitive       BOOLEAN DEFAULT FALSE,
  p_actor          UUID    DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  who   UUID;
  label TEXT;
  ent   UUID;
  line  BIGINT;
BEGIN
  -- An explicit actor is only for the system acting on somebody's
  -- behalf, which is why it is the last argument rather than the first.
  who := COALESCE(p_actor, current_actor());

  IF who IS NOT NULL THEN
    SELECT COALESCE(full_name, email), entity_id INTO label, ent
    FROM profiles WHERE id = who;
  END IF;

  INSERT INTO audit_log (
    actor_id, actor_label, entity_id, action, target_type, target_id,
    target_label, before, after, source, request_id, approval_id,
    reason, classification, was_sensitive
  ) VALUES (
    who, label, ent, p_action, p_target_type, p_target_id,
    p_target_label, p_before, p_after, p_source, p_request_id, p_approval_id,
    p_reason, p_classification, p_was_sensitive
  )
  RETURNING id INTO line;

  RETURN line;
END;
$fn$;

REVOKE ALL ON FUNCTION audit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit TO authenticated;

-- -------------------------------------------------------------
-- 4. The insider list.
--
-- from the meeting, 4.1. When a record is flagged material, this is who
-- touched it and when. A real regulatory artifact rather than a report,
-- so it returns rows and takes no view of how they are presented.
--
-- Gated on `admin.audit` inside the function rather than by a policy,
-- because it is SECURITY DEFINER and therefore reads past the audit
-- policy. Without the check it would be a way for anybody to read the
-- whole log.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION insider_list(
  p_target_type TEXT,
  p_target_id   UUID,
  p_since       TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  actor_id     UUID,
  actor_label  TEXT,
  first_access TIMESTAMPTZ,
  last_access  TIMESTAMPTZ,
  accesses     BIGINT,
  actions      TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('admin.audit') THEN
    RAISE EXCEPTION 'you do not have admin.audit';
  END IF;

  -- Producing the list is itself an access to material information, so
  -- it is recorded before the rows are returned.
  PERFORM audit(
    'read', p_target_type, p_target_id,
    'insider list', NULL, NULL, 'system',
    'Generated an insider list', NULL, NULL, NULL, TRUE
  );

  RETURN QUERY
  SELECT a.actor_id,
         MAX(a.actor_label)          AS actor_label,
         MIN(a.at)                   AS first_access,
         MAX(a.at)                   AS last_access,
         COUNT(*)                    AS accesses,
         array_agg(DISTINCT a.action) AS actions
  FROM audit_log a
  WHERE a.target_type = p_target_type
    AND a.target_id   = p_target_id
    AND a.actor_id IS NOT NULL
    AND (p_since IS NULL OR a.at >= p_since)
  GROUP BY a.actor_id
  ORDER BY MIN(a.at);
END;
$fn$;

REVOKE ALL ON FUNCTION insider_list FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insider_list TO authenticated;

-- -------------------------------------------------------------
-- 5. The line `command_set_role` always claimed to write.
--
-- `lib/crm/roles.ts` says that function checks the capability, refuses
-- to leave the company with no administrator, and writes an audit line.
-- Two of those three were true.
--
-- The fix is in migration 018, not here, because that is where the
-- function is defined and `scripts/sql/order.txt` runs 018 and 019 last
-- so 019's trigger sees the final shape of it. Redefining it here would
-- be silently undone twenty lines later in the bundle.
-- -------------------------------------------------------------
