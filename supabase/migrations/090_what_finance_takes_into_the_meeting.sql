-- =============================================================
-- 090. What finance takes into the meeting.
--
-- From the business:
--
--   the bottom bar graph is blinding and you've removed all the logic
--   that tracked individual deals etc. There's not enough information
--   on that analytics hub for our finance team to go in a meeting with
--   the MD and be able to outline everything happening in the company.
--
-- Both halves of that are fair, and the second is mine. The three
-- division columns in 088 answer "how big is each part of it", which is
-- the first question and not the only one. Everything the old screen
-- knew about individual deals and individual people went with the
-- rewrite, and nothing replaced it.
--
-- ---- What somebody standing in front of an MD is actually asked ----
--
-- Not "what did we turn over". They already have that on the slide.
-- The questions that follow it are always the same six, and each one
-- here is a function:
--
--   which deals                  trailer_deals
--   who is selling               sales_by_person
--   what is coming               pipeline_by_stage
--   who is growing, who is going customer_movement
--   how exposed are we           revenue_concentration
--   how old is the open work     open_work_ageing
--
-- and one more that is not a question until the numbers are challenged:
--
--   why does the sum of the customers not equal the total
--                                division_reconciliation
--
-- That last one is the difference between a figure somebody can defend
-- and a figure somebody has to take away and check. £536k of Cash Sale
-- and £1.8m on the group's own leasing company are real revenue sitting
-- on no customer's record, and a screen that quietly drops them is
-- lying, while a screen that quietly includes them cannot be reconciled
-- against any per customer report. So it carries both and says so.
--
-- ---- Everything takes p_upto ----
--
-- A board pack is "as at" a date, and it has to still say the same
-- thing next week. Every function here takes the date the year is being
-- read to, defaulting to today, so a figure quoted in a meeting can be
-- reproduced afterwards.
--
-- ---- Rep names, and why this does not try to be clever ----
--
-- `stock_trailers.sales_rep` is free text typed by whoever closed the
-- deal. `crm_leads` has an `owner_id` pointing at a real login and a
-- `rep_initials` that does not. There is no key joining them, and the
-- old screen carried a hand written list of aliases plus a similarity
-- match to paper over it.
--
-- That list went stale the first time somebody joined, and a similarity
-- match on people's names puts one person's commission on another
-- person's row. So this groups on the name as written, normalised for
-- case and spacing and nothing else, and says plainly which rows it
-- could tie to a login. A name that appears twice, spelled two ways, is
-- shown twice: that is a data entry problem on the stock list, and
-- showing it is how it gets fixed rather than hidden.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Which deals.
--
-- The individual trailer sales, which is the only division where a deal
-- is a thing you can point at. An STC invoice is one of nine thousand
-- and nobody asks about one; a trailer is a unit with a chassis number
-- and a margin, and it gets asked about by name.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION trailer_deals(
  p_upto DATE DEFAULT NULL, p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  id           UUID,
  stc_no       TEXT,
  what         TEXT,
  customer     TEXT,
  contact_id   UUID,
  sales_rep    TEXT,
  sold         DATE,
  new_or_used  TEXT,
  sales_price  NUMERIC,
  cost         NUMERIC,
  profit       NUMERIC,
  profit_pct   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Trailer sales need access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT t.id,
         t.stc_no,
         btrim(concat_ws(' ', t.year::TEXT, t.make, t.model)),
         /* The CRM's spelling where the trailer has been linked to a
            record, and the typed one where it has not. Which of the two
            it is matters, so `contact_id` comes back as well: a name
            with no record behind it cannot be clicked and should not
            pretend it can. */
         COALESCE(c.company_name, t.customer),
         t.contact_id,
         NULLIF(btrim(COALESCE(t.sales_rep, '')), ''),
         sold_on(t),
         t.new_or_used,
         t.sales_price,
         /* What it stood us in. `total_nbv` is the book value with the
            refurb in it; `nbv` is before. Prefer the total, because the
            margin below is calculated after refurb. */
         COALESCE(t.total_nbv, t.nbv),
         t.profit,
         /* Recomputed rather than read. `profit_pct` is a column on the
            spreadsheet this came from and is only as right as the last
            person to edit it. */
         CASE WHEN COALESCE(t.sales_price, 0) <> 0
              THEN round((t.profit / t.sales_price) * 100, 1)
              ELSE NULL END
    FROM stock_trailers t
    LEFT JOIN crm_contacts c ON c.id = t.contact_id
   WHERE t.status = 'sold'
     AND sold_on(t) >= fy
     AND sold_on(t) <= upto
   ORDER BY sold_on(t) DESC NULLS LAST, t.sales_price DESC NULLS LAST
   LIMIT GREATEST(1, p_limit);
END;
$fn$;

GRANT EXECUTE ON FUNCTION trailer_deals(DATE, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- 2. Who is selling.
--
-- Two sources that do not join, reported side by side rather than
-- added together: trailers off the stock list, and leads off the CRM.
-- Adding them would double count the trailer sale that also has a lead
-- against it, and there is no reliable way to tell which those are.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_by_person(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  person         TEXT,
  /* True where that name matches somebody who can sign in. A name that
     does not is not wrong, it is somebody who left or somebody typed
     differently on the stock list, and either way it is worth seeing. */
  has_login      BOOLEAN,
  trailers       INTEGER,
  trailer_value  NUMERIC,
  trailer_margin NUMERIC,
  leads_open     INTEGER,
  pipeline_value NUMERIC,
  leads_won      INTEGER,
  /* What is RECORDED as commission on the leads, and nothing else.
     The old screen showed a commission figure worked out in the browser
     as ten per cent of profit on every trailer. That rate is not in the
     data anywhere, it was a constant in a React component, and a number
     invented in the browser is the worst kind to put in front of an MD:
     it looks like a fact and cannot be traced to anything.
     `crm_leads.commission` is a real column somebody filled in. Where
     nobody has, this is nought and the screen says the figure is only
     as complete as the leads. */
  commission     NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Sales by person needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH
  /* One row per person per source, keyed on the name lowercased and
     squeezed. Nothing fuzzier than that: see the header. */
  from_stock AS (
    SELECT lower(btrim(t.sales_rep))                   AS key,
           min(btrim(t.sales_rep))                     AS shown,
           count(*)::INTEGER                           AS trailers,
           COALESCE(SUM(t.sales_price), 0)::NUMERIC    AS value,
           COALESCE(SUM(t.profit), 0)::NUMERIC         AS margin
      FROM stock_trailers t
     WHERE t.status = 'sold'
       AND NULLIF(btrim(COALESCE(t.sales_rep, '')), '') IS NOT NULL
       AND sold_on(t) >= fy AND sold_on(t) <= upto
     GROUP BY 1
  ),
  from_leads AS (
    SELECT lower(btrim(COALESCE(p.full_name, p.email, l.rep_initials))) AS key,
           min(btrim(COALESCE(p.full_name, p.email, l.rep_initials)))   AS shown,
           count(*) FILTER (WHERE l.status NOT IN ('customer', 'lost'))::INTEGER AS open,
           COALESCE(SUM(l.estimated_value)
                    FILTER (WHERE l.status NOT IN ('customer', 'lost')), 0)::NUMERIC AS pipeline,
           count(*) FILTER (
             WHERE l.status IN ('won', 'customer')
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) >= fy
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) <= upto
           )::INTEGER AS won,
           COALESCE(SUM(l.commission) FILTER (
             WHERE l.status IN ('won', 'customer')
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) >= fy
               AND COALESCE(l.dispatch_date, l.order_date,
                            l.last_activity_at::DATE, l.date_of_enquiry) <= upto
           ), 0)::NUMERIC AS commission
      FROM crm_leads l
      LEFT JOIN profiles p ON p.id = l.owner_id
     WHERE COALESCE(p.full_name, p.email, l.rep_initials) IS NOT NULL
     GROUP BY 1
  ),
  everyone AS (
    SELECT key FROM from_stock UNION SELECT key FROM from_leads
  )
  SELECT COALESCE(s.shown, d.shown),
         EXISTS (SELECT 1 FROM profiles pr
                  WHERE lower(btrim(COALESCE(pr.full_name, pr.email))) = e.key),
         COALESCE(s.trailers, 0),
         COALESCE(s.value, 0),
         COALESCE(s.margin, 0),
         COALESCE(d.open, 0),
         COALESCE(d.pipeline, 0),
         COALESCE(d.won, 0),
         COALESCE(d.commission, 0)
    FROM everyone e
    LEFT JOIN from_stock s ON s.key = e.key
    LEFT JOIN from_leads d ON d.key = e.key
   ORDER BY COALESCE(s.value, 0) DESC, COALESCE(d.pipeline, 0) DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION sales_by_person(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 3. What is coming.
--
-- Every stage against every division, including the empty ones. A
-- funnel with a missing rung reads as a funnel that skips a step, and
-- "no quotes out" is a finding rather than an absence.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION pipeline_by_stage()
RETURNS TABLE (
  division   TEXT,
  name       TEXT,
  sort_order INTEGER,
  stage      TEXT,
  stage_at   INTEGER,
  leads      INTEGER,
  value      NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The pipeline needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH stages(stage, stage_at) AS (
    VALUES ('lead', 1), ('contacted', 2), ('quoted', 3),
           ('won', 4), ('customer', 5), ('lost', 6)
  ),
  /* The lead type and the division slug are the same three things
     under two names. Mapped here rather than renamed in the data,
     because `crm_leads.type` is what the tracker tabs are built on. */
  mapped(kind, slug) AS (
    VALUES ('maintenance', 'stc'), ('trailer_sales', 'trailer'), ('rental', 'rental')
  )
  SELECT d.slug, d.name, d.sort_order, s.stage, s.stage_at,
         count(l.id)::INTEGER,
         COALESCE(SUM(l.estimated_value), 0)::NUMERIC
    FROM divisions d
    CROSS JOIN stages s
    JOIN mapped m ON m.slug = d.slug
    LEFT JOIN crm_leads l ON l.type = m.kind AND l.status = s.stage
   GROUP BY d.slug, d.name, d.sort_order, s.stage, s.stage_at
   ORDER BY d.sort_order, s.stage_at;
END;
$fn$;

GRANT EXECUTE ON FUNCTION pipeline_by_stage() TO authenticated;

-- -------------------------------------------------------------
-- 4. Who is growing, and who is going.
--
-- The whole company on one list rather than three, because a haulier
-- who has moved their maintenance elsewhere and started renting from us
-- is not a riser and not a faller, and looking at either division alone
-- says the wrong thing about them.
--
-- Trailer sales are deliberately excluded from the comparison. A
-- customer who bought a trailer last year and not this one has not
-- fallen away; they have a trailer. Comparing a lumpy capital purchase
-- year on year manufactures alarm.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION customer_movement(
  p_upto DATE DEFAULT NULL, p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  change_pct   NUMERIC,
  /* Which of the two Protean divisions this customer trades in, so a
     faller can be chased by whoever it belongs to. */
  divisions    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Customer movement needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH per_customer AS (
    SELECT a.contact_id,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS then_,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs
      FROM protean_accounts a
      JOIN protean_invoices i
        ON i.division = a.division AND i.alpha = a.alpha
      JOIN divisions d ON d.slug = a.division
     WHERE a.contact_id IS NOT NULL
       AND NOT a.ignored
     GROUP BY a.contact_id
  )
  SELECT p.contact_id, c.company_name, p.now_, p.then_,
         (p.now_ - p.then_)::NUMERIC,
         /* Null rather than infinity where there was nothing to grow
            from. A customer who billed nothing last year and £40k this
            year has not grown by any percentage, they are new, and the
            screen says that instead of printing a number nobody can
            use. */
         CASE WHEN p.then_ > 0
              THEN round(((p.now_ - p.then_) / p.then_) * 100, 1)
              ELSE NULL END,
         p.divs
    FROM per_customer p
    JOIN crm_contacts c ON c.id = p.contact_id
   /* Both ends of the list, not the top of it. A mover is a mover in
      either direction and finance wants both halves. */
   WHERE p.now_ <> p.then_
   ORDER BY abs(p.now_ - p.then_) DESC
   LIMIT GREATEST(1, p_limit);
END;
$fn$;

GRANT EXECUTE ON FUNCTION customer_movement(DATE, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- 5. How exposed are we.
--
-- The question an MD asks straight after a good revenue number, and
-- the one a screen of totals cannot answer: how much of it is one
-- customer. Three bands, because "the top ten are half our income" is a
-- sentence somebody can act on and a Gini coefficient is not.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_concentration(
  p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  customers   INTEGER,
  billed      NUMERIC,
  top_1       NUMERIC,
  top_5       NUMERIC,
  top_10      NUMERIC,
  biggest     TEXT,
  average     NUMERIC,
  /* The middle customer, which is the honest "typical" when one account
     is twenty times the next. An average alone reads as though every
     customer spends the average. */
  median      NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Revenue concentration needs access to the CRM.';
  END IF;

  RETURN QUERY
  /* `spend` rather than `billed`, and `firm` rather than `company_name`.
     Both of the obvious names collide with an OUT parameter of this
     function, and plpgsql resolves the collision by raising "column
     reference is ambiguous" rather than by picking one. */
  WITH per_customer AS (
    SELECT c.company_name AS firm,
           SUM(i.net)::NUMERIC AS spend
      FROM protean_accounts a
      JOIN protean_invoices i
        ON i.division = a.division AND i.alpha = a.alpha
      JOIN crm_contacts c ON c.id = a.contact_id
     WHERE a.contact_id IS NOT NULL
       AND NOT a.ignored
       AND (p_division IS NULL OR a.division = p_division)
       AND i.tax_point >= fy AND i.tax_point <= upto
     GROUP BY c.company_name
    HAVING SUM(i.net) > 0
  ),
  ranked AS (
    SELECT pc.firm, pc.spend,
           row_number() OVER (ORDER BY pc.spend DESC) AS place
      FROM per_customer pc
  )
  SELECT count(*)::INTEGER,
         COALESCE(SUM(r.spend), 0)::NUMERIC,
         COALESCE(SUM(r.spend) FILTER (WHERE r.place <= 1), 0)::NUMERIC,
         COALESCE(SUM(r.spend) FILTER (WHERE r.place <= 5), 0)::NUMERIC,
         COALESCE(SUM(r.spend) FILTER (WHERE r.place <= 10), 0)::NUMERIC,
         max(r.firm) FILTER (WHERE r.place = 1),
         COALESCE(round(avg(r.spend), 2), 0)::NUMERIC,
         COALESCE(round(
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.spend)::NUMERIC, 2), 0)
    FROM ranked r;
END;
$fn$;

GRANT EXECUTE ON FUNCTION revenue_concentration(DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 6. How old is the open work.
--
-- Work in progress, by how long it has been sitting. A single
-- "£414,740 open" is a number; the same figure split by age is a
-- conversation about the four jobs that have been on the ramps since
-- March.
--
-- Dated on `logged_on`, which is when the job was raised. `first_seen`
-- is when our import first noticed it and would make every job look a
-- fortnight old.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION open_work_ageing(
  p_division TEXT DEFAULT NULL, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division  TEXT,
  name      TEXT,
  band      TEXT,
  band_at   INTEGER,
  jobs      INTEGER,
  value     NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Open work needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH bands(band, band_at, lo, hi) AS (
    VALUES ('Up to 30 days', 1, 0,   30),
           ('31 to 60',      2, 31,  60),
           ('61 to 90',      3, 61,  90),
           ('Over 90 days',  4, 91,  99999),
           ('No date',       5, -1,  -1)
  )
  SELECT d.slug, d.name, b.band, b.band_at,
         count(j.job_no)::INTEGER,
         COALESCE(SUM(j.job_total), 0)::NUMERIC
    FROM divisions d
    CROSS JOIN bands b
    LEFT JOIN protean_open_jobs j
      ON j.division = d.slug
     AND j.still_open
     AND CASE
           WHEN b.band_at = 5 THEN j.logged_on IS NULL
           ELSE j.logged_on IS NOT NULL
                AND (upto - j.logged_on) BETWEEN b.lo AND b.hi
         END
   WHERE d.slug IN ('stc', 'rental')
     AND (p_division IS NULL OR d.slug = p_division)
   GROUP BY d.slug, d.name, d.sort_order, b.band, b.band_at
   ORDER BY d.sort_order, b.band_at;
END;
$fn$;

GRANT EXECUTE ON FUNCTION open_work_ageing(TEXT, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 7. Why the customers do not add up to the total.
--
-- Every division's invoicing split three ways: what sits on a customer
-- record, what sits on a Protean account nobody has placed yet, and
-- what sits on an account deliberately set aside as not a customer.
--
-- The three add to the division total exactly. That is the point: a
-- finance team asked to reconcile a dashboard against a per customer
-- report needs the difference named, not discovered.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION division_reconciliation(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division      TEXT,
  name          TEXT,
  sort_order    INTEGER,
  billed        NUMERIC,
  on_customers  NUMERIC,
  unattributed  NUMERIC,
  unattributed_n INTEGER,
  set_aside     NUMERIC,
  set_aside_n   INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reconciling revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NOT NULL AND NOT a.ignored), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NULL AND NOT a.ignored), 0)::NUMERIC,
         count(DISTINCT a.alpha) FILTER (
           WHERE a.contact_id IS NULL AND NOT a.ignored)::INTEGER,
         COALESCE(SUM(i.net) FILTER (WHERE a.ignored), 0)::NUMERIC,
         count(DISTINCT a.alpha) FILTER (WHERE a.ignored)::INTEGER
    FROM divisions d
    LEFT JOIN protean_invoices i
      ON i.division = d.slug AND i.tax_point >= fy AND i.tax_point <= upto
    LEFT JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   WHERE d.slug IN ('stc', 'rental')
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_reconciliation(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 8. Did it land.
-- -------------------------------------------------------------
DO $$
DECLARE missing TEXT := '';
BEGIN
  FOREACH missing IN ARRAY ARRAY[
    'trailer_deals', 'sales_by_person', 'pipeline_by_stage',
    'customer_movement', 'revenue_concentration', 'open_work_ageing',
    'division_reconciliation'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = missing
    ) THEN
      RAISE EXCEPTION '090 did not land: % is not there', missing;
    END IF;
  END LOOP;
END $$;
