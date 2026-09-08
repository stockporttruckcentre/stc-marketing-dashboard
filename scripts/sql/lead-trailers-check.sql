-- =============================================================
-- A lead can quote more than one trailer, and everything that used to
-- read one still reads the right one.
--
-- From the business:
--
--   If you're quoting certain trailers from our stock list it needs
--   reflecting in the system. You should be able to search for trailers
--   by different variants to find the correct one(s) for the lead, and
--   move one to an existing lead from the stock page itself.
--
-- Migration 097 adds `crm_lead_trailers` and makes
-- `crm_leads.stock_trailer_id` derived from it. That second half is
-- where the risk is: eleven readers depend on that column and none of
-- them was changed, so what has to be proved is not "the new table
-- works" but "the old column still means what those readers think".
--
-- Run with `npm run check:lead-trailers`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

-- A customer, a quote, and three units in the yard.
DO $$
DECLARE c UUID; l UUID; a UUID; b UUID; d UUID;
BEGIN
  INSERT INTO crm_contacts (company_name, status) VALUES ('Quote Test Haulage','lead') RETURNING id INTO c;
  INSERT INTO crm_leads (contact_id, type, status) VALUES (c,'trailer_sales','quoted') RETURNING id INTO l;
  INSERT INTO stock_trailers (stc_no, status, category, location)
    VALUES ('STC900101','in_stock','Curtainsider','Carrington') RETURNING id INTO a;
  INSERT INTO stock_trailers (stc_no, status, category, location)
    VALUES ('STC900102','in_stock','Curtainsider','Carrington') RETURNING id INTO b;
  INSERT INTO stock_trailers (stc_no, status, category, location)
    VALUES ('STC900103','in_stock','Fridge','Bredbury') RETURNING id INTO d;

  PERFORM set_config('t.lead', l::TEXT, FALSE);
  PERFORM set_config('t.a', a::TEXT, FALSE);
  PERFORM set_config('t.b', b::TEXT, FALSE);
  PERFORM set_config('t.d', d::TEXT, FALSE);
END $$;

-- -------------------------------------------------------------
-- 1. Several units on one quote
-- -------------------------------------------------------------
DO $$
DECLARE
  l UUID := current_setting('t.lead')::UUID;
  a UUID := current_setting('t.a')::UUID;
  b UUID := current_setting('t.b')::UUID;
  d UUID := current_setting('t.d')::UUID;
BEGIN
  PERFORM crm_attach_trailer(l, a, 'the one they saw');
  PERFORM crm_attach_trailer(l, b, NULL);
  PERFORM crm_attach_trailer(l, d, NULL);

  PERFORM pg_temp.must('a quote holds three units',
    (SELECT COUNT(*) = 3 FROM crm_lead_trailers WHERE lead_id = l));

  PERFORM pg_temp.must('in the order they were added, not sorted by anything else',
    (SELECT array_agg(position ORDER BY position) = ARRAY[0,1,2]
       FROM crm_lead_trailers WHERE lead_id = l));

  PERFORM pg_temp.must('and the note on a unit is kept',
    (SELECT note = 'the one they saw' FROM crm_lead_trailers
      WHERE lead_id = l AND stock_trailer_id = a));

  PERFORM pg_temp.must('the same unit twice is still one unit',
    (SELECT COUNT(*) = 3 FROM crm_lead_trailers WHERE lead_id = l))
    FROM (SELECT crm_attach_trailer(l, a, NULL)) AS again;
END $$;

-- -------------------------------------------------------------
-- 2. The old column still means what its readers think
--
-- Eleven of them, and the one that matters most is the sold warning:
-- it asks "which deal is this unit on" and it must not start answering
-- with a unit that is third on somebody's quote.
-- -------------------------------------------------------------
DO $$
DECLARE
  l UUID := current_setting('t.lead')::UUID;
  a UUID := current_setting('t.a')::UUID;
  b UUID := current_setting('t.b')::UUID;
BEGIN
  PERFORM pg_temp.must('the lead points at the first unit on the quote',
    (SELECT stock_trailer_id = a FROM crm_leads WHERE id = l));

  PERFORM crm_detach_trailer(l, a);

  PERFORM pg_temp.must('removing the first promotes the second',
    (SELECT stock_trailer_id = b FROM crm_leads WHERE id = l));

  PERFORM crm_detach_trailer(l, b);
  PERFORM crm_detach_trailer(l, current_setting('t.d')::UUID);

  PERFORM pg_temp.must('and a quote with no units names none',
    (SELECT stock_trailer_id IS NULL FROM crm_leads WHERE id = l));
END $$;

-- -------------------------------------------------------------
-- 3. Attaching a unit is work on the quote
--
-- The trigger from 096 watches `crm_leads`. This write is to another
-- table, so it would not see it, and a rep who spent a morning putting
-- four units on a quote would have a lead that had not moved since it
-- was raised.
-- -------------------------------------------------------------
DO $$
DECLARE
  l UUID := current_setting('t.lead')::UUID;
  a UUID := current_setting('t.a')::UUID;
BEGIN
  UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;
  PERFORM crm_attach_trailer(l, a, NULL);

  PERFORM pg_temp.must('attaching a unit moves the last activity date',
    (SELECT last_activity_at > NOW() - INTERVAL '1 minute' FROM crm_leads WHERE id = l));

  UPDATE crm_leads SET last_activity_at = NOW() - INTERVAL '14 days' WHERE id = l;
  PERFORM crm_detach_trailer(l, a);

  PERFORM pg_temp.must('and so does taking one off',
    (SELECT last_activity_at > NOW() - INTERVAL '1 minute' FROM crm_leads WHERE id = l));
END $$;

-- -------------------------------------------------------------
-- 4. Whose quotes a unit is on
--
-- The stock page's question. It used to be asked of
-- `stock_trailer_id`, so a unit second on a quote read as free.
-- -------------------------------------------------------------
DO $$
DECLARE
  l UUID := current_setting('t.lead')::UUID;
  a UUID := current_setting('t.a')::UUID;
  b UUID := current_setting('t.b')::UUID;
BEGIN
  PERFORM crm_attach_trailer(l, a, NULL);
  PERFORM crm_attach_trailer(l, b, NULL);

  PERFORM pg_temp.must('the first unit shows as on a quote',
    (SELECT COUNT(*) = 1 FROM crm_trailer_on_leads WHERE stock_trailer_id = a));

  PERFORM pg_temp.must('and so does the second, which is the whole point',
    (SELECT COUNT(*) = 1 FROM crm_trailer_on_leads WHERE stock_trailer_id = b));

  PERFORM pg_temp.must('a unit on nobody''s quote says so',
    (SELECT COUNT(*) = 0 FROM crm_trailer_on_leads
      WHERE stock_trailer_id = current_setting('t.d')::UUID));
END $$;

-- -------------------------------------------------------------
-- 5. A quote thrown away takes its links and nothing else
--
-- Dropping a lead must not touch the stock. The trailers stay in the
-- yard; only the fact that somebody was quoting them goes.
-- -------------------------------------------------------------
DO $$
DECLARE
  l UUID := current_setting('t.lead')::UUID;
  a UUID := current_setting('t.a')::UUID;
BEGIN
  DELETE FROM crm_leads WHERE id = l;

  PERFORM pg_temp.must('deleting a lead removes its links',
    (SELECT COUNT(*) = 0 FROM crm_lead_trailers WHERE lead_id = l));

  PERFORM pg_temp.must('and leaves the trailers in stock',
    EXISTS (SELECT 1 FROM stock_trailers WHERE id = a));
END $$;

-- -------------------------------------------------------------
-- 6. Everything that was linked before is linked now
--
-- The backfill. A lead naming a trailer today must have a row on the
-- new table, or the first screen somebody opens will say the quote has
-- no units on it.
-- -------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.must('no lead names a trailer the join table has not heard of',
    NOT EXISTS (
      SELECT 1 FROM crm_leads l
       WHERE l.stock_trailer_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM crm_lead_trailers t
            WHERE t.lead_id = l.id AND t.stock_trailer_id = l.stock_trailer_id)));
END $$;

ROLLBACK;
