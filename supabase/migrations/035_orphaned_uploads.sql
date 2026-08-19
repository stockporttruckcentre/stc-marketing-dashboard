-- =============================================================
-- 035. Files a failed command left behind.
--
-- An upload happens before the programme commits, so a transaction that
-- fails leaves an object on a bucket that nothing references. The
-- runtime removes it. Sometimes removing it fails too: the bucket is
-- unreachable, the credential is wrong, the process dies in between.
--
-- A cleanup that fails silently is the same litter with a clear
-- conscience. This is where it is written down instead, so somebody can
-- find it later and so the command can say honestly that it left
-- external state behind rather than claiming it left none.
--
-- Server only, like the purchase ledger and for the same reason: it is
-- a record of what actually happened outside the database, and nothing
-- with a browser writes those.
-- =============================================================

CREATE TABLE IF NOT EXISTS command_orphaned_uploads (
  key        TEXT PRIMARY KEY,
  bucket     TEXT NOT NULL,
  why        TEXT,
  -- Whose command left it. A person, so it can be traced back.
  actor_id   UUID REFERENCES auth.users ON DELETE SET NULL,
  noted_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  cleared_at TIMESTAMPTZ
);

ALTER TABLE command_orphaned_uploads ENABLE ROW LEVEL SECURITY;

-- No policy at all, which means no row is visible to `authenticated`
-- through PostgREST. The service role bypasses row level security and
-- is the only thing that reads or writes this.
REVOKE ALL ON command_orphaned_uploads FROM PUBLIC;
REVOKE ALL ON command_orphaned_uploads FROM authenticated;

CREATE OR REPLACE FUNCTION command_note_orphan(
  p_key    TEXT,
  p_bucket TEXT,
  p_why    TEXT,
  p_actor  UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO command_orphaned_uploads (key, bucket, why, actor_id)
  VALUES (p_key, p_bucket, p_why, p_actor)
  -- Noting the same orphan twice is the same orphan. The reason is
  -- refreshed, because the second attempt to clear it may have failed
  -- differently and that is the useful one.
  ON CONFLICT (key) DO UPDATE SET why = EXCLUDED.why, noted_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION command_note_orphan(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_note_orphan(TEXT, TEXT, TEXT, UUID) TO service_role;
