-- =============================================================
-- 122. "Next free slot" means the next clear day, at three o'clock.
--
-- From the business:
--
--   'next free slot' in socials, have this push it to the next
--   available day where nothing is scheduled, at 3pm.
--
-- That is a different rule from the one that was here, and it is worth
-- writing down what the old one was so nobody puts it back by accident.
--
-- ---- What it used to do ----
--
-- `content_next_slot` read `social_channel_slots`, a per channel table
-- of posting times: Monday 09:00, Monday 13:00, Tuesday 09:00 and so
-- on. It walked forward fourteen days looking for a slot on that
-- channel with nothing already in it.
--
-- Nobody at STC has ever filled that table in. A channel with no rows
-- in it answers null, which is why the queue did nothing: the control
-- was wired to a schedule that does not exist.
--
-- ---- What it does now ----
--
-- One rule, in the words it was asked for. Starting from now, in the
-- channel's own timezone, find the first day that has NOTHING scheduled
-- on it, and answer that day at three o'clock.
--
-- "Nothing scheduled" is read across the whole planner rather than per
-- channel, because that is what the words say: a day with a post going
-- out on LinkedIn is not a day where nothing is scheduled. One post a
-- day, spread out, which is what a queue is for.
--
-- Today counts if three o'clock has not been and gone and the day is
-- clear. "The next available day" is the next one that is available,
-- and refusing today when today is free would push a post back
-- twenty-four hours for no reason anybody could see.
--
-- Weekends count too. Nothing was said about weekdays, so nothing is
-- assumed about them.
--
-- ---- Three o'clock is a setting, not a constant ----
--
-- From the business, about what happens after they leave:
--
--   once I leave STC in a couple of months it has no more developer at
--   all [...] The app should be self-sufficient
--
-- So the time lives in `tenant_settings` where somebody can change it,
-- and it starts at three o'clock because that is the time asked for.
--
-- `social_channel_slots` is left exactly where it is. Nothing is
-- deleted, and a table with no rows in it costs nothing.
-- =============================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS social_queue_time TIME NOT NULL DEFAULT '15:00';

COMMENT ON COLUMN tenant_settings.social_queue_time IS
  'What time of day the social queue puts a post out. Asked for as 3pm.';

CREATE OR REPLACE FUNCTION content_next_slot(
  p_channel UUID,
  p_after   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  zone    TEXT;
  at_time TIME;
  from_   TIMESTAMPTZ := COALESCE(p_after, NOW());
  day     DATE;
  cand    TIMESTAMPTZ;
  i       INTEGER;
BEGIN
  SELECT timezone INTO zone FROM social_channels WHERE id = p_channel;
  IF zone IS NULL THEN
    RAISE EXCEPTION 'there is no channel with that id';
  END IF;

  SELECT t.social_queue_time INTO at_time FROM tenant_settings t LIMIT 1;
  at_time := COALESCE(at_time, TIME '15:00');

  day := (from_ AT TIME ZONE zone)::DATE;

  -- A year of looking. A planner with something on every day for a year
  -- has no free day, and answering null is how the screen says so
  -- rather than silently landing on a day that is already busy.
  FOR i IN 0..365 LOOP
    cand := ((day + i) + at_time) AT TIME ZONE zone;
    CONTINUE WHEN cand <= from_;

    -- A variant going out on that day, on any channel.
    CONTINUE WHEN EXISTS (
      SELECT 1
        FROM social_post_variants v
        JOIN social_posts p ON p.id = v.post_id
       WHERE v.state IN ('pending', 'scheduled', 'publishing')
         AND v.scheduled_at IS NOT NULL
         AND p.deleted_at IS NULL
         AND (v.scheduled_at AT TIME ZONE zone)::DATE = day + i);

    -- Or a post itself dated that day, which is how one with no
    -- per channel times of its own is scheduled.
    CONTINUE WHEN EXISTS (
      SELECT 1
        FROM social_posts p
       WHERE p.deleted_at IS NULL
         AND p.status IN ('scheduled', 'publishing')
         AND (
           (p.scheduled_at IS NOT NULL
             AND (p.scheduled_at AT TIME ZONE zone)::DATE = day + i)
           OR (p.scheduled_at IS NULL AND p.scheduled_date = day + i)
         ));

    RETURN cand;
  END LOOP;

  RETURN NULL;
END;
$fn$;

GRANT EXECUTE ON FUNCTION content_next_slot(UUID, TIMESTAMPTZ) TO authenticated;
