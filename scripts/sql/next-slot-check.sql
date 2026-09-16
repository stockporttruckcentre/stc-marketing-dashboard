-- =============================================================
-- The queue: the next available day where nothing is scheduled, at 3pm.
--
-- From the business:
--
--   'next free slot' in socials, have this push it to the next
--   available day where nothing is scheduled, at 3pm.
--
-- Seven words of that are load bearing and each one is asserted below:
-- NEXT (not today if today is gone), AVAILABLE DAY (a whole day, not a
-- time of day), NOTHING IS SCHEDULED (anywhere, not on this channel),
-- and 3PM (the setting, not a number typed into a function).
--
-- It is driven against real PostgreSQL rather than reasoned about,
-- because the old rule read a table nobody had filled in and the
-- control did nothing at all while every screen looked right.
--
-- Run with `npm run check:next-slot`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('dd000000-0000-0000-0000-000000000001', 'slot.writer@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO social_channels (id, network_key, handle, display_name, state, timezone) VALUES
  ('dd000000-0000-0000-0000-0000000000c1', 'linkedin', 'slot_a', 'Channel A', 'connected', 'Europe/London'),
  ('dd000000-0000-0000-0000-0000000000c2', 'x',        'slot_b', 'Channel B', 'connected', 'Europe/London')
ON CONFLICT DO NOTHING;

-- An empty planner, so what is asserted is the rule rather than
-- whatever else the fixtures left lying about.
DELETE FROM social_post_variants;
DELETE FROM social_posts;

-- -------------------------------------------------------------
-- 1. An empty planner: the first day whose three o'clock is still to
--    come, which is today until three o'clock and tomorrow after it.
-- -------------------------------------------------------------
DO $$
DECLARE
  zone TEXT := 'Europe/London';
  at_time TIME := (SELECT social_queue_time FROM tenant_settings LIMIT 1);
  want DATE;
  got TIMESTAMPTZ;
BEGIN
  want := CASE WHEN (NOW() AT TIME ZONE zone)::TIME < at_time
               THEN (NOW() AT TIME ZONE zone)::DATE
               ELSE (NOW() AT TIME ZONE zone)::DATE + 1 END;

  got := content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW());
  IF got IS NULL THEN
    RAISE EXCEPTION 'an empty planner has no free day';
  END IF;
  IF (got AT TIME ZONE zone)::DATE <> want THEN
    RAISE EXCEPTION 'an empty planner offered % and the first free day is %',
      (got AT TIME ZONE zone)::DATE, want;
  END IF;
  IF (got AT TIME ZONE zone)::TIME <> at_time THEN
    RAISE EXCEPTION 'it offered % rather than %', (got AT TIME ZONE zone)::TIME, at_time;
  END IF;
  IF got <= NOW() THEN
    RAISE EXCEPTION 'it offered a time that has already been';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 2. The time comes out of the setting, so somebody can change it
--    without a developer. This is the whole reason it is a column.
-- -------------------------------------------------------------
DO $$
DECLARE got TIMESTAMPTZ;
BEGIN
  UPDATE tenant_settings SET social_queue_time = TIME '09:30';
  got := content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW());
  IF (got AT TIME ZONE 'Europe/London')::TIME <> TIME '09:30' THEN
    RAISE EXCEPTION 'the setting says 09:30 and the queue offered %',
      (got AT TIME ZONE 'Europe/London')::TIME;
  END IF;
  UPDATE tenant_settings SET social_queue_time = TIME '15:00';
END $$;

-- -------------------------------------------------------------
-- 3. A day with something on it is not a day where nothing is
--    scheduled, and it is a WHOLE day that goes, not one time on it.
-- -------------------------------------------------------------
DO $$
DECLARE
  zone TEXT := 'Europe/London';
  first_ TIMESTAMPTZ;
  second TIMESTAMPTZ;
  post UUID;
BEGIN
  first_ := content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW());

  INSERT INTO social_posts (id, content, status, scheduled_at, scheduled_date, created_by, author_id)
  VALUES (gen_random_uuid(), 'Takes the day', 'scheduled', first_,
          (first_ AT TIME ZONE zone)::DATE, 'Slot Writer',
          'dd000000-0000-0000-0000-000000000001')
  RETURNING id INTO post;

  second := content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW());
  IF second IS NULL THEN
    RAISE EXCEPTION 'one post filled the whole year';
  END IF;
  IF (second AT TIME ZONE zone)::DATE <= (first_ AT TIME ZONE zone)::DATE THEN
    RAISE EXCEPTION 'the day already has a post on it and the queue offered % again', second;
  END IF;
  IF (second AT TIME ZONE zone)::DATE <> (first_ AT TIME ZONE zone)::DATE + 1 THEN
    RAISE EXCEPTION 'it skipped past the next clear day to %', second;
  END IF;

  -- -----------------------------------------------------------
  -- 4. On ANY channel. "Nothing is scheduled" was asked for as a
  --    property of the day, not of one account.
  -- -----------------------------------------------------------
  IF (content_next_slot('dd000000-0000-0000-0000-0000000000c2', NOW()) AT TIME ZONE zone)::DATE
     = (first_ AT TIME ZONE zone)::DATE THEN
    RAISE EXCEPTION 'a second channel was offered a day that already has a post on it';
  END IF;

  -- -----------------------------------------------------------
  -- 5. A variant carrying its own time takes the day too, which is how
  --    a post going out at different times per channel is scheduled.
  -- -----------------------------------------------------------
  INSERT INTO social_post_variants (post_id, channel_id, scheduled_at, state)
  VALUES (post, 'dd000000-0000-0000-0000-0000000000c2', second, 'scheduled');

  IF (content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW()) AT TIME ZONE zone)::DATE
     <= (second AT TIME ZONE zone)::DATE THEN
    RAISE EXCEPTION 'a variant on % did not take that day', second;
  END IF;

  -- -----------------------------------------------------------
  -- 6. A draft is not scheduled, so it does not hold a day hostage.
  --
  --    Written as a fresh row rather than by moving the last one back,
  --    because `social_posts.status` is closed by a trigger: it changes
  --    through `content_submit` and the rest, never by writing the
  --    column. That is migration 055 doing its job on a check.
  -- -----------------------------------------------------------
  DELETE FROM social_post_variants;
  DELETE FROM social_posts;
  INSERT INTO social_posts (content, status, scheduled_at, scheduled_date, created_by, author_id)
  VALUES ('Still a draft', 'draft', first_, (first_ AT TIME ZONE zone)::DATE,
          'Slot Writer', 'dd000000-0000-0000-0000-000000000001');

  IF (content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW()) AT TIME ZONE zone)::DATE
     <> (first_ AT TIME ZONE zone)::DATE THEN
    RAISE EXCEPTION 'a draft kept its day, and a draft is not scheduled';
  END IF;

  -- -----------------------------------------------------------
  -- 7. Nor does one somebody deleted.
  -- -----------------------------------------------------------
  DELETE FROM social_posts;
  INSERT INTO social_posts (content, status, scheduled_at, scheduled_date, created_by, author_id, deleted_at)
  VALUES ('Deleted', 'scheduled', first_, (first_ AT TIME ZONE zone)::DATE,
          'Slot Writer', 'dd000000-0000-0000-0000-000000000001', NOW());

  IF (content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW()) AT TIME ZONE zone)::DATE
     <> (first_ AT TIME ZONE zone)::DATE THEN
    RAISE EXCEPTION 'a deleted post kept its day';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 8. A year with something on every day has no free day, and saying so
--    is better than landing on a day that is already busy.
-- -------------------------------------------------------------
DO $$
DECLARE
  zone TEXT := 'Europe/London';
  day DATE := (NOW() AT TIME ZONE zone)::DATE;
  i INTEGER;
BEGIN
  DELETE FROM social_post_variants;
  DELETE FROM social_posts;
  FOR i IN 0..366 LOOP
    INSERT INTO social_posts (content, status, scheduled_at, scheduled_date, created_by, author_id)
    VALUES ('Busy', 'scheduled', ((day + i) + TIME '15:00') AT TIME ZONE zone,
            day + i, 'Slot Writer', 'dd000000-0000-0000-0000-000000000001');
  END LOOP;

  IF content_next_slot('dd000000-0000-0000-0000-0000000000c1', NOW()) IS NOT NULL THEN
    RAISE EXCEPTION 'every day of the year is taken and the queue offered one anyway';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 9. A channel that does not exist is an error, not a silent null.
-- -------------------------------------------------------------
DO $$
BEGIN
  PERFORM content_next_slot('dd000000-0000-0000-0000-00000000dead', NOW());
  RAISE EXCEPTION 'a channel that does not exist was given a time';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'there is no channel with that id' THEN
    RAISE;
  END IF;
END $$;

ROLLBACK;
