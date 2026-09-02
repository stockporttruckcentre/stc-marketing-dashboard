-- =============================================================
-- 083. Revenue belongs to a division.
--
-- From the business:
--
--   Tom wants Revenue to be a dropdown nav item with 2 pages, one for
--   STC, one for S&L Rental ... if I import sales for a customer in the
--   CRM, it should be able to determine if it's maintenance(stc),
--   trailer sales or rental. How it does that i'm unsure as we
--   specifically kept the type field out of the CRM because you could
--   have a lead open to sell trailers to a customer and another lead to
--   carry out mots for them too which crosses two divisions.
--
-- ---- The answer to that question ----
--
-- There is no field on the customer, and there does not need to be.
-- Every piece of money already knows which division it came from,
-- because it came out of that division's system:
--
--   a maintenance invoice   ->  STC
--   a rental invoice        ->  Rental
--   a stock_trailers sale   ->  Trailer Sales
--   a lead                  ->  already carries its own type
--
-- So a customer's divisions are DERIVED from their money rather than
-- declared on their record, and a haulier we sell trailers to and also
-- MOT appears in both columns because they genuinely are in both. A
-- field would have forced a choice that is not real.
--
-- ---- And why this is not just a label column ----
--
-- It is part of the KEY, and the rental export is what proves it.
-- Comparing the two files, five account codes appear in both and two of
-- them are different companies:
--
--   ALLIANCE   rental: Alliance Flooring Distribution Ltd
--   ALLIANCE   stc:    Alliance Automotive UK CV Ltd
--
-- Two systems, two code spaces, no coordination between them. Keyed on
-- `alpha` alone, importing rental would put Alliance Flooring's
-- revenue onto Alliance Automotive's CRM record, silently, permanently,
-- and it would happen on the first import.
--
-- Invoice numbers do not collide TODAY: nought overlaps across 20,817
-- STC and 2,988 rental documents. That is luck, not design. Rental
-- numbers are small sequential integers, currently under 3,000, and
-- STC's are around 296,000. They are counting towards each other. A key
-- that is unique by coincidence is a key that fails on a date nobody
-- has written down.
--
-- ---- What stays the same ----
--
-- One CRM record per customer. Booker is `BOOKER` in both systems and
-- is one company: two accounts, two divisions, one record, and the
-- record adds them up. That is the same shape as the two Holman
-- accounts and it already works.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The divisions.
--
-- A table rather than an enum, because trailer sales already exist in
-- `stock_trailers` and will want a row here without a migration to add
-- one, and because the label belongs next to the key rather than in
-- every screen that prints it.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divisions (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  /* Where its money comes from, for the note on screen. */
  source     TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO divisions (slug, name, source, sort_order) VALUES
  ('stc',     'STC',           'Protean maintenance invoicing', 1),
  ('trailer', 'Trailer Sales', 'The stock list',                2),
  ('rental',  'S&L Rental',    'Rental invoicing',              3)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, source = EXCLUDED.source, sort_order = EXCLUDED.sort_order;

ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS divisions_read ON divisions;
CREATE POLICY divisions_read ON divisions FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON divisions FROM anon, authenticated;
REVOKE SELECT ON divisions FROM anon;

-- -------------------------------------------------------------
-- 2. Division onto the three revenue tables.
--
-- Everything already there came out of Protean maintenance, so it is
-- `stc`. The default exists only for that backfill and is dropped
-- straight afterwards: a division has to be stated by whoever is
-- importing, and a column that quietly defaults to STC is how rental
-- revenue ends up counted as maintenance.
-- -------------------------------------------------------------
ALTER TABLE protean_accounts  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'stc';
ALTER TABLE protean_invoices  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'stc';
ALTER TABLE protean_open_jobs ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'stc';
ALTER TABLE protean_imports   ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'stc';

ALTER TABLE protean_accounts  ALTER COLUMN division DROP DEFAULT;
ALTER TABLE protean_invoices  ALTER COLUMN division DROP DEFAULT;
ALTER TABLE protean_open_jobs ALTER COLUMN division DROP DEFAULT;
ALTER TABLE protean_imports   ALTER COLUMN division DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'protean_accounts_division_fkey') THEN
    ALTER TABLE protean_accounts ADD CONSTRAINT protean_accounts_division_fkey
      FOREIGN KEY (division) REFERENCES divisions (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'protean_imports_division_fkey') THEN
    ALTER TABLE protean_imports ADD CONSTRAINT protean_imports_division_fkey
      FOREIGN KEY (division) REFERENCES divisions (slug);
  END IF;
END $$;

-- -------------------------------------------------------------
-- 3. The keys.
--
-- `alpha` alone stops being unique and (division, alpha) takes over.
-- Same for the invoice and the job. The foreign keys follow, so an
-- invoice can only ever reach an account in its own division and the
-- Alliance case becomes impossible rather than merely unlikely.
-- -------------------------------------------------------------
DO $$
BEGIN
  /* Invoices and jobs point at accounts, so their constraints go
     first and come back last. */
  ALTER TABLE protean_invoices  DROP CONSTRAINT IF EXISTS protean_invoices_alpha_fkey;
  ALTER TABLE protean_open_jobs DROP CONSTRAINT IF EXISTS protean_open_jobs_alpha_fkey;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'protean_accounts_pkey' AND conkey = ARRAY[
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid = 'protean_accounts'::regclass AND attname = 'alpha')]::SMALLINT[]) THEN
    ALTER TABLE protean_accounts DROP CONSTRAINT protean_accounts_pkey;
    ALTER TABLE protean_accounts ADD PRIMARY KEY (division, alpha);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'protean_invoices_pkey' AND conkey = ARRAY[
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid = 'protean_invoices'::regclass AND attname = 'invoice_no')]::SMALLINT[]) THEN
    ALTER TABLE protean_invoices DROP CONSTRAINT protean_invoices_pkey;
    ALTER TABLE protean_invoices ADD PRIMARY KEY (division, invoice_no);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'protean_open_jobs_pkey' AND conkey = ARRAY[
                (SELECT attnum FROM pg_attribute
                  WHERE attrelid = 'protean_open_jobs'::regclass AND attname = 'job_no')]::SMALLINT[]) THEN
    ALTER TABLE protean_open_jobs DROP CONSTRAINT protean_open_jobs_pkey;
    ALTER TABLE protean_open_jobs ADD PRIMARY KEY (division, job_no);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'protean_invoices_account_fkey') THEN
    ALTER TABLE protean_invoices ADD CONSTRAINT protean_invoices_account_fkey
      FOREIGN KEY (division, alpha) REFERENCES protean_accounts (division, alpha) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'protean_open_jobs_account_fkey') THEN
    ALTER TABLE protean_open_jobs ADD CONSTRAINT protean_open_jobs_account_fkey
      FOREIGN KEY (division, alpha) REFERENCES protean_accounts (division, alpha) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_protean_accounts_division ON protean_accounts (division);
CREATE INDEX IF NOT EXISTS idx_protean_invoices_division ON protean_invoices (division, tax_point DESC);
CREATE INDEX IF NOT EXISTS idx_protean_jobs_division ON protean_open_jobs (division) WHERE still_open;

-- -------------------------------------------------------------
-- 4. Which divisions a customer is in.
--
-- Derived, never declared. This is the answer to the question the
-- business asked: a customer is in a division because money from that
-- division landed on them, not because somebody chose a value from a
-- list. Trailer sales come from the stock list, which is a different
-- table and joins by name, so it is counted here too.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION customer_divisions(p_contact UUID)
RETURNS TABLE (division TEXT, name TEXT, net NUMERIC, invoices INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing which divisions a customer buys from needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         count(i.invoice_no)::INTEGER
    FROM divisions d
    JOIN protean_accounts a ON a.division = d.slug
                           AND a.contact_id = p_contact AND NOT a.ignored
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   GROUP BY d.slug, d.name, d.sort_order
  HAVING count(i.invoice_no) > 0
   ORDER BY d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION customer_divisions(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. Did it land.
-- -------------------------------------------------------------
DO $$
DECLARE cols INTEGER;
BEGIN
  SELECT count(*) INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'division'
     AND table_name IN ('protean_accounts','protean_invoices','protean_open_jobs','protean_imports');
  IF cols <> 4 THEN
    RAISE EXCEPTION 'revenue is not keyed by division: % of 4 tables carry it', cols;
  END IF;
  RAISE NOTICE 'ok  revenue is keyed by division, so two systems can use the same account code for different companies';
END $$;
