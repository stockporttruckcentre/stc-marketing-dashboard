-- =============================================================
-- 060. The posts that were already here get a channel.
--
-- Migration 054 grew `social_posts` into a proper content model, and it
-- backfilled what it could: every existing row got a board column and,
-- where the name matched an account, an author. It could not give them
-- a CHANNEL, because a channel is a real account on a real network and
-- 054 does not know which accounts this company has.
--
-- This does. It reads them out of the data.
--
-- ---- Why that matters rather than being tidy ----
--
-- The planner draws a post's networks from its variants. A post with no
-- variants falls back to `platform`, the text array it has always
-- carried, so it is visible either way and this is not a rescue. What
-- it cannot do without a channel is take part in anything the rest of
-- the screen does: it cannot be scheduled, because a queue belongs to a
-- channel; it cannot be previewed, because a preview is drawn as an
-- account; and `content_submit` refuses a post with nowhere to go.
--
-- So the posts already in this database would have been readable and
-- inert. That is the failure worth avoiding: not a missing row, a row
-- that looks present and cannot be acted on.
--
-- ---- Why a function and not three statements ----
--
-- Because it is not only a one off. An installation that adds Instagram
-- to `social_networks` next year, or imports a batch of old posts from
-- a spreadsheet, wants exactly this run again. A function is also the
-- only shape `scripts/sql/content-check.sql` can call twice inside one
-- transaction to prove the second run does nothing.
-- =============================================================

CREATE OR REPLACE FUNCTION content_adopt_legacy_posts()
RETURNS TABLE (channels_made INT, variants_made INT, times_set INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  made INT := 0;
  joined INT := 0;
  timed INT := 0;
BEGIN
  -- -----------------------------------------------------------
  -- 1. A channel for every network the existing posts name.
  --
  -- `platform` holds labels rather than keys: 'LinkedIn', 'Facebook'.
  -- Matched on the label first and the key second, both case folded, so
  -- a row written as 'linkedin' and one written as 'LinkedIn' find the
  -- same network and produce one channel rather than two.
  --
  -- State is `disconnected`, which is the truth: no network driver
  -- exists yet, nothing has signed in, and a channel that claimed to be
  -- connected would be a lie the publish path would then discover.
  --
  -- Conditional on what is already there rather than ON CONFLICT,
  -- because the channel's unique index covers only active rows and a
  -- channel somebody had hidden would otherwise be recreated.
  -- -----------------------------------------------------------
  WITH named AS (
    SELECT DISTINCT btrim(said) AS said
      FROM social_posts p, unnest(COALESCE(p.platform, '{}')) AS said
     WHERE btrim(said) <> ''
  ), wanted AS (
    SELECT DISTINCT n.key, n.position
      FROM named
      JOIN social_networks n
        ON lower(n.label) = lower(named.said)
        OR lower(n.key)   = lower(named.said)
  )
  INSERT INTO social_channels
    (network_key, handle, display_name, entity_id, timezone, state, position)
  SELECT
    w.key,
    -- The handle, lowercased and stripped to what a handle can hold. It
    -- is what the composer prints after an @, and somebody will correct
    -- it to the real one under Channels the first time they look.
    lower(regexp_replace(COALESCE(t.short_name, 'stc'), '[^A-Za-z0-9_]', '', 'g')),
    COALESCE(t.company_name, 'Stockport Truck Centre'),
    (SELECT e.id FROM entities e WHERE e.is_default ORDER BY e.sort_order LIMIT 1),
    COALESCE(t.timezone, 'Europe/London'),
    'disconnected',
    w.position
  FROM wanted w
  LEFT JOIN tenant_settings t ON t.id
  WHERE NOT EXISTS (
    SELECT 1 FROM social_channels c WHERE c.network_key = w.key
  );
  GET DIAGNOSTICS made = ROW_COUNT;

  -- -----------------------------------------------------------
  -- 2. And a variant joining each post to the channel for its network.
  --
  -- `content` is left NULL, which means "the post's own words". That is
  -- the correct answer and not a shortcut: these posts were written
  -- once for every network they went to, and copying the words into
  -- each variant would create six things to edit where there is one.
  --
  -- `state` stays at its default of `pending` even for a post already
  -- marked posted. A variant's state is what THIS product did with it,
  -- and this product did not publish these: they went out before it
  -- could. Marking them published would put a permalink shaped hole in
  -- the record and make a report claim work the software never did.
  -- -----------------------------------------------------------
  INSERT INTO social_post_variants (post_id, channel_id, position)
  SELECT p.id, c.id, said.ord - 1
  FROM social_posts p
  CROSS JOIN LATERAL unnest(COALESCE(p.platform, '{}')) WITH ORDINALITY AS said(name, ord)
  JOIN social_networks n
    ON lower(n.label) = lower(btrim(said.name))
    OR lower(n.key)   = lower(btrim(said.name))
  JOIN social_channels c ON c.network_key = n.key AND c.is_active
  WHERE NOT EXISTS (
    SELECT 1 FROM social_post_variants v WHERE v.post_id = p.id AND v.channel_id = c.id
  );
  GET DIAGNOSTICS joined = ROW_COUNT;

  -- -----------------------------------------------------------
  -- 3. A time on anything that only had a date.
  --
  -- `scheduled_at` is what the calendar, the queue and the drawer all
  -- read. `scheduled_date` is what every row written before 054 has. A
  -- post with a date and no time draws on the calendar already, because
  -- `postDay` prefers the time and falls back to the date, but it sorts
  -- against posts that do have one as though it were midnight.
  --
  -- Nine in the morning, in the installation's own zone, because that
  -- is when a marketing post goes out and midnight is a time nobody
  -- chose. Only for work that has not gone yet: a posted row's date is
  -- a record of what happened and inventing an hour for it would be a
  -- fiction.
  -- -----------------------------------------------------------
  UPDATE social_posts p
     SET scheduled_at = (p.scheduled_date::TEXT || ' 09:00')::TIMESTAMP
                          AT TIME ZONE COALESCE(
                            (SELECT t.timezone FROM tenant_settings t WHERE t.id),
                            'Europe/London')
   WHERE p.scheduled_at IS NULL
     AND p.scheduled_date IS NOT NULL
     AND p.status NOT IN ('posted', 'publishing', 'failed');
  GET DIAGNOSTICS timed = ROW_COUNT;

  RETURN QUERY SELECT made, joined, timed;
END;
$fn$;

REVOKE ALL ON FUNCTION content_adopt_legacy_posts FROM PUBLIC;
-- Admin only in practice: it is the deployment step, not a screen. The
-- function itself is idempotent, so a second call costs nothing.
GRANT EXECUTE ON FUNCTION content_adopt_legacy_posts TO authenticated;

-- And run it, which is the whole point of the file.
SELECT * FROM content_adopt_legacy_posts();

COMMENT ON TABLE social_post_variants IS
  'What one channel receives. Posts written before migration 054 were '
  'given theirs by 060, from the platform array they already carried.';
