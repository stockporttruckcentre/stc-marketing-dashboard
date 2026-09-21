-- =============================================================
-- 128. No last year, no movement. Not a rise of everything.
--
-- From the business, reading the screen:
--
--   Up on last year  +£8k
--   £8k so far, Not known to the same point last year
--
--   it's like it's picking up "last year" as "this year"
--
-- It was not. There is no won work on the tracker dated into last
-- financial year, so `last_year_won` is NULL, which is correct and is
-- what the note said. Then 126 did this:
--
--   ROUND(COALESCE(now_won, 0) - COALESCE(was_won, 0), 2)
--
-- and turned that NULL into a nought, so the change came out as the
-- whole of this year and the tile read as growth of exactly everything
-- he has sold. The figure was right and the sentence was a lie.
--
-- That is the rule this product is built on, broken by the person who
-- wrote it down:
--
--   Unknown figures must be null/not known, never zero.
--
-- A percentage of nothing was already refused. A difference from
-- nothing has to be refused the same way. Nought last year and nothing
-- known about last year are different sentences, and only one of them
-- supports the word "up".
--
-- So: no last year figure, no change figure. The screen says there is
-- nothing to compare with instead of inventing a rise.
-- =============================================================
DROP FUNCTION IF EXISTS personal_overview(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_overview(p_person UUID, p_when DATE DEFAULT NULL)
RETURNS TABLE (
  person_id        UUID,
  full_name        TEXT,
  financial_year   DATE,
  fy_target        NUMERIC,
  target_revenue   NUMERIC,
  trailer_revenue  NUMERIC,
  open_pipeline    NUMERIC,
  open_deals       INT,
  won_deals        INT,
  lost_deals       INT,
  customers        INT,
  unpriced         INT,
  won_undated      INT,
  achieved         NUMERIC,
  to_go            NUMERIC,
  won_to_date      NUMERIC,
  last_year_won    NUMERIC,
  won_change       NUMERIC,
  won_change_pct   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto    DATE := COALESCE(p_when, CURRENT_DATE);
  fy      DATE := financial_year_of(upto);
  fy0     DATE := (fy - INTERVAL '1 year')::DATE;
  cut     DATE := (upto - INTERVAL '1 year')::DATE;
  target  NUMERIC;
  tgt_rev NUMERIC;
  trl_rev NUMERIC;
  now_won NUMERIC;
  was_won NUMERIC;
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  SELECT personal_fy_target(p_person, p_when) INTO target;

  SELECT SUM(p.won_total) FILTER (WHERE p.lead_type <> 'trailer_sales'),
         SUM(p.won_total) FILTER (WHERE p.lead_type = 'trailer_sales')
    INTO tgt_rev, trl_rev
    FROM personal_pipeline(p_person, p_when) p;

  SELECT w.target_revenue INTO now_won FROM personal_won_between(p_person, fy,  upto) w;
  SELECT w.target_revenue INTO was_won FROM personal_won_between(p_person, fy0, cut)  w;

  RETURN QUERY
  SELECT
    p_person,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = p_person),
    fy,
    target,
    tgt_rev,
    trl_rev,
    (SELECT SUM(x.open_total) FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.open_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.lost_count), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COUNT(DISTINCT l.contact_id)::INT
       FROM crm_leads l WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL),
    (SELECT COALESCE(SUM(x.unpriced), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    (SELECT COALESCE(SUM(x.won_undated), 0)::INT FROM personal_pipeline(p_person, p_when) x),
    CASE WHEN target IS NULL OR target = 0 THEN NULL
         ELSE ROUND((COALESCE(tgt_rev, 0) / target) * 100, 1) END,
    CASE WHEN target IS NULL THEN NULL
         ELSE ROUND(target - COALESCE(tgt_rev, 0), 2) END,
    now_won,
    was_won,
    /* THE FIX. Nothing known about last year is not a starting point of
       nought, so there is no difference to report. Where last year IS
       known, this year not existing is a genuine fall to nought and is
       reported as one. */
    CASE WHEN was_won IS NULL THEN NULL
         ELSE ROUND(COALESCE(now_won, 0) - was_won, 2) END,
    CASE WHEN COALESCE(was_won, 0) > 0
         THEN ROUND(((COALESCE(now_won, 0) - was_won) / was_won) * 100, 1)
         ELSE NULL END;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_overview(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_overview(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'no figure for last year means no change figure, rather than a rise of everything';
END $$;
