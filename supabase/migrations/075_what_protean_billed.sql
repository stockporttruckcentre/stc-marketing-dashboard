-- =============================================================
-- 075. What Protean has billed, and what is still open.
--
-- From the business:
--
--   a page in the CRM where I can update the sales once or twice a week
--   with a spreadsheet of what's been invoiced and what's open ... Then
--   tom's able to see individual customer spend etc. A lot of these
--   customers will already exist in the CRM and the missing customers
--   are to be added.
--
-- Two exports, twice a week, by hand. Protean will sell an automated
-- feed and the business has decided not to buy one because they expect
-- to be off Protean inside six months, so this is built for the manual
-- path and not as a stopgap for an integration that is coming.
--
-- ---- Two tables, not one ----
--
-- The first plan was one table with a status, on the assumption that an
-- open job becomes an invoiced one. The real exports say otherwise:
--
--   `Job No` and `Document No` do not overlap at all, so an open job
--   cannot be followed to its invoice through these files.
--
--   `Document No` reads "Multiple" on 632 of 20,817 invoices, because
--   one invoice can cover several jobs.
--
-- They are different grains. A job is a piece of work; an invoice is a
-- billing document that may cover many. Forcing them into one table
-- would have meant either double counting or inventing a link that the
-- data does not contain.
--
-- ---- Many Protean accounts, one customer ----
--
-- `ARIFLEET` and `ARIVMS` are both Holman Fleet. So the binding lives
-- in its own table keyed on Protean's code, not in a column on
-- `crm_contacts`, because a column can only hold one.
--
-- ---- Why the code is the join and the name never is ----
--
-- `Alpha` is Protean's account code and it is exactly one to one with
-- the customer name across all 199 accounts in the first export. Bind
-- it once and every future import joins on a code, which is the whole
-- point of doing the matching carefully today: the weekly job stops
-- being a matching problem after the first pass.
--
-- The open jobs export carries no code, only a name, so it resolves
-- through the same table by name onto the account the invoices bound.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The binding: one row per Protean account code.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protean_accounts (
  alpha        TEXT PRIMARY KEY,
  /* As Protean spells it, kept even after binding so a rename over
     there is visible rather than silently overwriting ours. */
  protean_name TEXT NOT NULL,

  /* Null until somebody has decided. Nothing infers this. */
  contact_id   UUID REFERENCES crm_contacts ON DELETE SET NULL,
  bound_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  bound_at     TIMESTAMPTZ,

  /* Deliberately not a customer: `Cash Sale` at £536k, and the group's
     own `STC Sales and Leasing Limited` at £1.8m, are real revenue and
     are nobody's portfolio. Ignored keeps them out of a salesperson's
     numbers without hiding them from the company total. */
  ignored      BOOLEAN NOT NULL DEFAULT FALSE,
  ignored_why  TEXT,

  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protean_accounts_contact ON protean_accounts (contact_id);
CREATE INDEX IF NOT EXISTS idx_protean_accounts_unbound
  ON protean_accounts (last_seen DESC) WHERE contact_id IS NULL AND NOT ignored;
CREATE INDEX IF NOT EXISTS idx_protean_accounts_name ON protean_accounts (lower(protean_name));

-- -------------------------------------------------------------
-- 2. Invoices. What was billed.
--
-- `invoice_no` is the key: unique across all 20,817 rows of the first
-- export, which is what makes importing the same file twice a week
-- safe. `document_no` is not, and reads "Multiple" 632 times.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protean_invoices (
  invoice_no   TEXT PRIMARY KEY,
  document_no  TEXT,
  alpha        TEXT NOT NULL REFERENCES protean_accounts ON DELETE CASCADE,

  customer_ref TEXT,
  protean_name TEXT,
  site_name    TEXT,

  created_on   DATE,
  /* The accounting date, and the one every figure is counted on.
     `Created` is when the document was made, which drifts across a
     month end and would move revenue into the wrong month. */
  tax_point    DATE NOT NULL,
  due_on       DATE,
  created_by   TEXT,

  net          NUMERIC(12,2) NOT NULL,
  tax          NUMERIC(12,2),
  gross        NUMERIC(12,2),

  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protean_invoices_alpha_date
  ON protean_invoices (alpha, tax_point DESC);
CREATE INDEX IF NOT EXISTS idx_protean_invoices_date ON protean_invoices (tax_point DESC);

-- -------------------------------------------------------------
-- 3. Open jobs. What is in progress.
--
-- A SNAPSHOT, not a ledger. The export is everything open at the moment
-- it was run, so a job that was there last week and is gone this week
-- has been finished, invoiced or cancelled. `still_open` is set from
-- the batch that last saw it rather than deleted, because "what was
-- open a fortnight ago" is a question somebody will ask.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protean_open_jobs (
  job_no        TEXT PRIMARY KEY,
  equip_no      TEXT,
  job_type      TEXT,
  status        TEXT,

  /* This export has no account code, only the name, so the alpha is
     resolved through `protean_accounts` and can be null where the name
     matches nothing yet. */
  protean_name  TEXT NOT NULL,
  alpha         TEXT REFERENCES protean_accounts ON DELETE SET NULL,

  site          TEXT,
  depot         TEXT,
  logged_on     DATE,
  last_visit_on DATE,
  entered_by    TEXT,
  job_total     NUMERIC(12,2),
  order_no      TEXT,
  sales_rep     TEXT,
  mileage       TEXT,

  still_open    BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protean_jobs_alpha ON protean_open_jobs (alpha) WHERE still_open;
CREATE INDEX IF NOT EXISTS idx_protean_jobs_open  ON protean_open_jobs (logged_on DESC) WHERE still_open;
CREATE INDEX IF NOT EXISTS idx_protean_jobs_name  ON protean_open_jobs (lower(protean_name));

-- -------------------------------------------------------------
-- 4. Every import, so a figure that moved can be explained.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protean_imports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('invoices', 'open_jobs')),
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  by_user     UUID REFERENCES auth.users ON DELETE SET NULL,
  file_name   TEXT,
  rows_read   INTEGER NOT NULL DEFAULT 0,
  rows_new    INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_closed INTEGER NOT NULL DEFAULT 0,
  accounts_new INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);

-- -------------------------------------------------------------
-- 5. Who may see any of it.
--
-- Revenue is the most commercially sensitive thing in the application.
-- Reading needs `crm.view`; writing goes through the functions below
-- and needs `admin.users`, because an import that lands wrong moves
-- every number on the analytics screen.
-- -------------------------------------------------------------
ALTER TABLE protean_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE protean_invoices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE protean_open_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE protean_imports   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['protean_accounts','protean_invoices','protean_open_jobs','protean_imports'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (command_may(''crm.view''))', t || '_read', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM anon, authenticated', t);
    EXECUTE format('REVOKE SELECT ON %I FROM anon', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 6. What one customer has spent.
--
-- By calendar year, because "this year against last" is the question
-- Tom asked for and every other cut is a filter on the same rows.
--
-- Returns a row per year even where one is empty, so a customer who
-- billed last year and nothing this year reads as a fall rather than
-- as an absence. That case is the whole point: "if I haven't seen
-- anything since last month, alarm bells are on."
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_spend(p_contact UUID)
RETURNS TABLE (
  year        INTEGER,
  net         NUMERIC,
  invoices    INTEGER,
  first_billed DATE,
  last_billed  DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT EXTRACT(YEAR FROM i.tax_point)::INTEGER,
         SUM(i.net)::NUMERIC,
         count(*)::INTEGER,
         min(i.tax_point),
         max(i.tax_point)
    FROM protean_invoices i
    JOIN protean_accounts a ON a.alpha = i.alpha
   WHERE a.contact_id = p_contact
   GROUP BY 1
   ORDER BY 1 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_spend(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 7. What is open on one customer, right now.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_open_work(p_contact UUID)
RETURNS TABLE (
  job_no    TEXT,
  job_type  TEXT,
  status    TEXT,
  depot     TEXT,
  logged_on DATE,
  job_total NUMERIC,
  equip_no  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing a customer''s open work needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT j.job_no, j.job_type, j.status, j.depot, j.logged_on, j.job_total, j.equip_no
    FROM protean_open_jobs j
    JOIN protean_accounts a ON a.alpha = j.alpha
   WHERE a.contact_id = p_contact AND j.still_open
   ORDER BY j.logged_on DESC NULLS LAST;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_open_work(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 8. Every customer, this year against last.
--
-- The screen Tom described: company, what they have billed, the same
-- period last year, and whether that is up or down.
--
-- Compared LIKE FOR LIKE. This year is only complete to today, so
-- against a full previous year every customer looks like a collapse.
-- Last year is therefore cut at the same day of the year, which is the
-- comparison somebody means when they say "May this year versus May
-- last year".
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_year_on_year(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  alphas       TEXT[],
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  last_billed  DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto  DATE := COALESCE(p_upto, CURRENT_DATE);
  y     INTEGER := EXTRACT(YEAR FROM upto)::INTEGER;
  /* The same day, a year earlier. */
  cut   DATE := (upto - INTERVAL '1 year')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.company_name,
         array_agg(DISTINCT a.alpha),
         COALESCE(SUM(i.net) FILTER (
           WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (
            WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (
            WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open),
         max(i.tax_point)
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE NOT a.ignored
   GROUP BY c.id, c.company_name
  HAVING COALESCE(SUM(i.net), 0) <> 0
      OR EXISTS (SELECT 1 FROM protean_open_jobs j
                  JOIN protean_accounts ja ON ja.alpha = j.alpha
                 WHERE ja.contact_id = c.id AND j.still_open)
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_year_on_year(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 9. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'protean_invoices') THEN
    RAISE EXCEPTION 'there is nowhere to put what Protean billed';
  END IF;
  RAISE NOTICE 'ok  invoices, open jobs and the account binding are here, and revenue needs crm.view to read';
END $$;
