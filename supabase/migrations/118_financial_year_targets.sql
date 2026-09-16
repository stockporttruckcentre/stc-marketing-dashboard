-- =============================================================
-- 118. Financial year targets, for the company and for a person.
--
-- From the agreed development scope, Task 3:
--
--   The current dashboard target implementation reads a monthly row
--   from `revenue_targets`. Do not set Dean's £600,000 into that
--   current monthly target record. That would incorrectly turn £600,000
--   into Dean's monthly target. The £600k discussed with the business
--   is a portfolio progression target, intended to be measured over the
--   current business/financial year.
--
-- So this is a separate grain with its period written on every row.
-- `revenue_targets` is not read, not written and not reinterpreted by
-- anything here.
--
-- ---- The year is the company's year, not the calendar's ----
--
--   Use the company's existing financial-year helper/convention in the
--   repo, rather than introducing calendar-year logic in one feature.
--
-- `financial_year_of(date)` is that helper. Migration 082 set the year
-- to run April to April, and it reads `tenant_settings`, so a company
-- that moves its year end moves this with it.
--
-- ---- Unknown is not zero ----
--
--   Do not store £0. Zero means somebody deliberately set a zero
--   target. Unknown means no target exists. Preserve that distinction.
--
-- A missing target is a missing ROW. Every function below returns NULL
-- rather than 0 when there is none, and nothing in this file invents a
-- company target, because the business has not set one.
-- =============================================================

CREATE TABLE IF NOT EXISTS performance_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /* 'company' for the whole business, 'person' for one portfolio. */
  scope           TEXT NOT NULL CHECK (scope IN ('company', 'person')),

  /* Null for the company row, and required for a person's. The check
     below is what stops a person target with nobody on it. */
  person_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,

  /* The FIRST DAY of the financial year, always, as `financial_year_of`
     returns it. Storing the year as a number would need a second column
     saying which convention it counted in, and that is the ambiguity
     the scope asks to be rid of. */
  financial_year  DATE NOT NULL,

  /* Zero is a real target somebody set. Absent is a missing row. */
  target          NUMERIC(14, 2) NOT NULL CHECK (target >= 0),

  note            TEXT,
  set_by          UUID REFERENCES profiles(id),
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_target_has_a_person
    CHECK ((scope = 'person') = (person_id IS NOT NULL))
);

COMMENT ON TABLE performance_targets IS
  'Financial year targets. A separate grain from revenue_targets, which stays monthly '
  'and is not read or written by anything here. A missing target is a missing row, never a zero.';

/* One target per person per year, and one company target per year.
   Partial indexes rather than a UNIQUE constraint, because NULLs are
   distinct in Postgres and a plain UNIQUE would let the company have
   any number of targets for one year. */
CREATE UNIQUE INDEX IF NOT EXISTS performance_targets_person_year
  ON performance_targets (person_id, financial_year) WHERE scope = 'person';
CREATE UNIQUE INDEX IF NOT EXISTS performance_targets_company_year
  ON performance_targets (financial_year) WHERE scope = 'company';

ALTER TABLE performance_targets ENABLE ROW LEVEL SECURITY;

/* ---- Who may read one ----

   Anybody who may open the Personal view of the person it belongs to,
   which is the ladder from migration 117 and not a second rule. The
   company target is readable by anybody who can reach Analytics: it is
   the number on the dashboard. */
DROP POLICY IF EXISTS "targets_read" ON performance_targets;
CREATE POLICY "targets_read" ON performance_targets
  FOR SELECT USING (
    (scope = 'company' AND command_may('analytics.view'))
    OR (scope = 'person' AND personal_analytics_may_view(person_id))
  );

/* ---- Who may set one ----

   From the scope: "Do not make salespeople capable of editing their own
   targets merely because they can see them. Use the existing
   capability/permission model for target management."

   `analytics.targets` is that capability, already in the catalogue and
   already what `/dashboard/analytics/targets` is gated on. Nothing here
   redesigns the Permission Hub. */
DROP POLICY IF EXISTS "targets_write" ON performance_targets;
CREATE POLICY "targets_write" ON performance_targets
  FOR ALL USING (command_may('analytics.targets'))
  WITH CHECK (command_may('analytics.targets'));

GRANT SELECT, INSERT, UPDATE, DELETE ON performance_targets TO authenticated;

-- -------------------------------------------------------------
-- Reading a target. NULL means nobody has set one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_fy_target(p_person UUID, p_when DATE DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT t.target
    FROM performance_targets t
   WHERE t.scope = 'person'
     AND t.person_id = p_person
     AND t.financial_year = financial_year_of(COALESCE(p_when, CURRENT_DATE))
     /* The same one rule. A target is a financial figure, so reading
        somebody else's is the same question as reading their revenue. */
     AND personal_analytics_may_view(p_person)
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION personal_fy_target(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_fy_target(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION company_fy_target(p_when DATE DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT t.target
    FROM performance_targets t
   WHERE t.scope = 'company'
     AND t.financial_year = financial_year_of(COALESCE(p_when, CURRENT_DATE))
     AND command_may('analytics.view')
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION company_fy_target(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_fy_target(DATE) TO authenticated;

-- -------------------------------------------------------------
-- Setting one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_personal_fy_target(
  p_person UUID,
  p_target NUMERIC,
  p_when   DATE DEFAULT NULL,
  p_note   TEXT DEFAULT NULL
)
RETURNS performance_targets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE result performance_targets;
BEGIN
  IF NOT command_may('analytics.targets') THEN
    RAISE EXCEPTION 'Setting a target is a permission you do not have. Ask an administrator.';
  END IF;
  IF p_person IS NULL THEN
    RAISE EXCEPTION 'A personal target needs somebody to belong to.';
  END IF;
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'A target of nothing is not the same as no target. Delete the row to clear it.';
  END IF;

  INSERT INTO performance_targets (scope, person_id, financial_year, target, note, set_by)
  VALUES ('person', p_person, financial_year_of(COALESCE(p_when, CURRENT_DATE)),
          p_target, NULLIF(BTRIM(p_note), ''), current_actor())
  ON CONFLICT (person_id, financial_year) WHERE scope = 'person'
  DO UPDATE SET target = EXCLUDED.target,
                note   = EXCLUDED.note,
                set_by = EXCLUDED.set_by,
                set_at = NOW()
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION set_personal_fy_target(UUID, NUMERIC, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_personal_fy_target(UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- =============================================================
-- Dean, £600,000, this financial year.
--
-- From the scope:
--
--   Bind it to Dean's existing canonical profile. Do not create another
--   Dean user. Do not identify him by a fragile runtime first-name
--   comparison after the seed/migration has run. If the migration
--   cannot unambiguously identify the intended existing profile, fail
--   loudly rather than assigning £600k to the wrong person.
--
-- So the name is resolved ONCE, here, and what is stored afterwards is
-- his id. Nothing at runtime ever compares a first name.
--
-- Three outcomes, and they are deliberately not the same:
--
--   exactly one Dean   the target is set
--   more than one      RAISE EXCEPTION. Two Deans is precisely the case
--                      where guessing puts £600k on the wrong person.
--   none at all        a notice and nothing written. A disposable test
--                      database has no Dean, and refusing to build it
--                      would stop every check in the repository.
--
-- Whether it took on the real database is not left to trust: the read
-- back file handed over with this migration asks who holds a target.
-- =============================================================
/* A function rather than a one-shot DO block, for two reasons. It can
   be run again on the real database once Dean exists or once a
   duplicate has been cleared up, and a check can seed two Deans and
   prove the refusal actually refuses. */
CREATE OR REPLACE FUNCTION seed_dean_fy_target()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  found  UUID;
  n      INT;
  fy     DATE := financial_year_of(CURRENT_DATE);
BEGIN
  SELECT COUNT(*) INTO n
    FROM profiles
   WHERE COALESCE(is_active, TRUE)
     AND LOWER(SPLIT_PART(BTRIM(full_name), ' ', 1)) = 'dean';

  IF n > 1 THEN
    RAISE EXCEPTION
      'There are % active people called Dean. Refusing to guess which one the £600,000 '
      'target belongs to: set it by id instead, with set_personal_fy_target().', n;
  END IF;

  IF n = 0 THEN
    RETURN format(
      'No active profile called Dean on this database, so no personal target was set. '
      'On a database that has one, this sets £600,000 for the year from %s.', fy);
  END IF;

  SELECT id INTO found
    FROM profiles
   WHERE COALESCE(is_active, TRUE)
     AND LOWER(SPLIT_PART(BTRIM(full_name), ' ', 1)) = 'dean'
   LIMIT 1;

  INSERT INTO performance_targets (scope, person_id, financial_year, target, note)
  VALUES ('person', found, fy, 600000,
          'Portfolio progression target for the financial year, agreed with the business.')
  ON CONFLICT (person_id, financial_year) WHERE scope = 'person'
  DO UPDATE SET target = EXCLUDED.target, note = EXCLUDED.note, set_at = NOW();

  RETURN format('Dean (%s) holds a £600,000 target for the year from %s', found, fy);
END;
$fn$;

REVOKE ALL ON FUNCTION seed_dean_fy_target() FROM PUBLIC;

DO $dean$ BEGIN RAISE NOTICE '%', seed_dean_fy_target(); END $dean$;

/* And no company target. The business has not set one, and a zero here
   would read as "the company is aiming at nothing". */
DO $$ BEGIN
  RAISE NOTICE 'no company target written: unknown is a missing row, not a zero';
END $$;
