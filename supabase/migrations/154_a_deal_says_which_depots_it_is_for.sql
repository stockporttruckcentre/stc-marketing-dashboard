-- =============================================================
-- 154. A deal says which depot or depots the work is for.
--
-- From the business:
--
--   on the proposal builder make it so i can choose the depot(s) the
--   work is for. Then when we run a report on open pipeline we can
--   filter by depot
--
-- ---- Why a table, when the names were already in the code ----
--
-- Two lists of depots existed and neither was right.
--
--   `lib/command/lexicon.ts` has nine, with their common misspellings,
--   so the command bar understands "carigton". It is a PARSING aid and
--   was never meant to be the register of sites.
--
--   `lib/types.ts` has six, each mapped to the city Lusha indexes, for
--   the company finder. IT DOES NOT INCLUDE CARRINGTON, which is where
--   874 of the 1,800 units on the stock list sit.
--
-- A third list typed here would be a third thing to be wrong. So the
-- names are seeded from the parsing list, which is the wider of the two
-- and is already what the bar answers to, and they live in a table from
-- now on so that opening a depot or closing one is something the
-- business does rather than something a developer deploys.
--
-- NOTHING IS INVENTED. Every name below is one the application already
-- knew. `sort_order` follows how much stock actually sits at each,
-- read off `stock_trailers.location`, so the picker opens with
-- Carrington at the top rather than alphabetically with Atherton.
--
-- ---- Why an array on the deal and not a join table ----
--
-- A deal has a handful of depots and nothing hangs off the pairing:
-- there is no date, no note and no order to it. A join table would be
-- three more objects, a policy of its own and a second thing to keep in
-- step, to record what `UUID[]` records exactly. The GIN index below is
-- what makes "every open deal touching Carrington" a fast question.
-- =============================================================

CREATE TABLE IF NOT EXISTS depots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  /* Closed rather than deleted. A depot that shuts still has to name
     itself on every deal that was ever for it. */
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_depots_name ON depots (lower(BTRIM(name)));

COMMENT ON TABLE depots IS
  'The sites this business works out of. Seeded from the names the command bar '
  'already understood, so nothing here is a new list. Closed rather than deleted, '
  'because a depot that shuts still has to name itself on the deals it was for.';

ALTER TABLE depots ENABLE ROW LEVEL SECURITY;

/* Anybody signed in may read them: a deal that names a depot nobody can
   read is a deal nobody can read. Changing them is an admin act. */
DROP POLICY IF EXISTS "depots_select" ON depots;
CREATE POLICY "depots_select" ON depots FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "depots_write" ON depots;
CREATE POLICY "depots_write" ON depots
  FOR ALL USING (NOT viewing_as_somebody() AND command_may('admin.settings'))
  WITH CHECK (NOT viewing_as_somebody() AND command_may('admin.settings'));

DROP TRIGGER IF EXISTS depots_touch ON depots;
CREATE TRIGGER depots_touch BEFORE UPDATE ON depots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

/* The nine the command bar already answers to, in the order the stock
   list says they matter. Idempotent: running this again renames
   nothing and adds nothing. */
INSERT INTO depots (name, slug, sort_order) VALUES
  ('Carrington', 'carrington', 10),
  ('Bredbury',   'bredbury',   20),
  ('Dukinfield', 'dukinfield', 30),
  ('Atherton',   'atherton',   40),
  ('Hyde',       'hyde',       50),
  ('Haydock',    'haydock',    60),
  ('Birkenhead', 'birkenhead', 70),
  ('Stockport',  'stockport',  80),
  ('Renbury',    'renbury',    90)
ON CONFLICT (slug) DO NOTHING;

-- -------------------------------------------------------------
-- Which depots a deal is for.
-- -------------------------------------------------------------
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS depot_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN crm_leads.depot_ids IS
  'Which of our sites the work is for. Empty means nobody has said, which is a '
  'different answer from every site: a report filtered to Carrington does not '
  'include a deal that has never been asked.';

CREATE INDEX IF NOT EXISTS idx_leads_depots ON crm_leads USING GIN (depot_ids);

-- -------------------------------------------------------------
-- Setting them, in one call, with the same rule as pricing.
--
-- Every depot named has to be a real, open one, or the whole call is
-- refused. A deal quietly holding an id that matches nothing is a deal
-- that vanishes from every filter and appears in no report.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS lead_depots_set(UUID, UUID[]);
CREATE OR REPLACE FUNCTION lead_depots_set(p_lead UUID, p_depots UUID[])
RETURNS TABLE (depot_id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE asked INT; found INT; wanted UUID[];
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying which depots a deal is for needs permission to edit the CRM.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm_leads l
     WHERE l.id = p_lead
       AND (l.owner_id = auth.uid()
            OR auth.uid() = ANY (l.shared_with)
            OR l.created_by = auth.uid()
            OR command_may('crm.viewOthers'))
  ) THEN
    RAISE EXCEPTION 'That deal is not yours to change.';
  END IF;

  /* The same id twice is one depot, and the order is the register's,
     not the order somebody happened to tick them in. */
  SELECT COALESCE(array_agg(d.id ORDER BY d.sort_order, d.name), '{}')
    INTO wanted
    FROM depots d
   WHERE d.id = ANY (COALESCE(p_depots, '{}'));

  asked := COALESCE(array_length(
    ARRAY(SELECT DISTINCT unnest(COALESCE(p_depots, '{}'))), 1), 0);
  found := COALESCE(array_length(wanted, 1), 0);
  IF found <> asked THEN
    RAISE EXCEPTION
      'Asked for % depot(s) and % of them are on the register; nothing has been changed.',
      asked, found;
  END IF;

  UPDATE crm_leads
     SET depot_ids = wanted, last_activity_at = NOW()
   WHERE id = p_lead;

  RETURN QUERY
  SELECT d.id, d.name FROM depots d
   WHERE d.id = ANY (wanted)
   ORDER BY d.sort_order, d.name;
END;
$fn$;

REVOKE ALL ON FUNCTION lead_depots_set(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead_depots_set(UUID, UUID[]) TO authenticated;

-- -------------------------------------------------------------
-- The open pipeline, by depot.
--
-- The report builder could group this in TypeScript, and for a hundred
-- rows it would be right. It asks the database because the question
-- somebody types is "what is open at Carrington", the array is indexed
-- for exactly that, and pulling five thousand leads into a browser to
-- count them is how the old analytics screen got slow.
--
-- A deal for two depots counts ONCE UNDER EACH, and the function says
-- so by also returning the row that has never been asked. Those two
-- facts together are why the columns do not add up to the pipeline
-- total, and a report that does not say that is a report somebody
-- queries.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS open_pipeline_by_depot(TEXT[], UUID);
CREATE OR REPLACE FUNCTION open_pipeline_by_depot(
  p_types TEXT[] DEFAULT NULL, p_person UUID DEFAULT NULL
)
RETURNS TABLE (
  depot_id   UUID,
  depot_name TEXT,
  sort_order INTEGER,
  deals      INTEGER,
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
  WITH open_deals AS (
    SELECT l.id, l.estimated_value, l.depot_ids
      FROM crm_leads l
     WHERE l.status IN ('lead', 'contacted', 'quoted')
       AND (p_types IS NULL OR l.type = ANY (p_types))
       AND (p_person IS NULL OR l.owner_id = p_person)
  )
  SELECT d.id, d.name, d.sort_order,
         COUNT(o.id)::INTEGER,
         COALESCE(SUM(o.estimated_value), 0)::NUMERIC
    FROM depots d
    LEFT JOIN open_deals o ON d.id = ANY (o.depot_ids)
   WHERE d.is_active
   GROUP BY d.id, d.name, d.sort_order

  UNION ALL

  /* The ones nobody has said. Named rather than dropped, because a
     filter that silently loses two thirds of the pipeline is a filter
     that gets believed. */
  SELECT NULL::UUID, 'No depot said'::TEXT, 9999,
         COUNT(*)::INTEGER, COALESCE(SUM(o.estimated_value), 0)::NUMERIC
    FROM open_deals o
   WHERE COALESCE(array_length(o.depot_ids, 1), 0) = 0

   ORDER BY 3, 2;
END;
$fn$;

REVOKE ALL ON FUNCTION open_pipeline_by_depot(TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_pipeline_by_depot(TEXT[], UUID) TO authenticated;

COMMENT ON FUNCTION open_pipeline_by_depot(TEXT[], UUID) IS
  'Open deals and their estimated value per depot, plus the ones nobody has said '
  'a depot for. A deal for two depots counts once under each, so the rows do not '
  'add up to the pipeline total and the report says so.';

DO $$ BEGIN
  RAISE NOTICE 'a deal can say which depots it is for, and the pipeline can be read by depot';
END $$;
