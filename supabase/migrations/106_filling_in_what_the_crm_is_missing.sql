-- =============================================================
-- 106. Filling in what the CRM is missing, from somebody else's file.
--
-- From the business:
--
--   on the attached spreadsheet is the email addresses, phone numbers
--   and business addresses of the companies in the crm that is missing
--   this data. Any customers on the attached that are not on the crm
--   should not import as new accounts, only update existing records.
--   The name might not be a 1:1 match from the attached to the crm and
--   it needs to get around that without mistake.
--
-- Three requirements, and the third is the whole job:
--
--   1. Fill in blanks. Never overwrite something already there.
--   2. Never create a record. A company on the file and not in the CRM
--      is left alone.
--   3. Match on something other than the name being identical, and be
--      wrong zero times.
--
-- ---- The file has an Alpha column, and that changes everything ----
--
-- `CustomerSite_Maintenance_Listing_Summary.csv` carries the Protean
-- account code. `protean_accounts` has held that code against a CRM
-- record since migration 077, put there by somebody looking at both. So
-- most of this is not name matching at all: it is a key that a person
-- has already confirmed, and it cannot be wrong in the way a name can.
--
-- Names are the fallback, for a row whose account nobody has bound yet.
--
-- ---- How a name match is made safe ----
--
-- Not by being clever. By refusing.
--
--   A name is normalised: lower case, punctuation gone, company suffix
--   gone, "(PRE FUNDED)" and anything else in brackets gone.
--
--   It is used ONLY when it picks out exactly one CRM record. Two
--   matches is not a near miss to be broken by a tiebreak, it is a
--   question, and the answer is to report it.
--
--   It is used ONLY when that name appears once in the file. Thirty
--   names in this file appear more than once, "CASH SALE" and "DAVID
--   FOX" among them, and a name that is ambiguous on the file cannot be
--   made unambiguous by looking at the CRM.
--
--   It is refused below four characters, because "AB" normalised
--   matches things nobody meant.
--
-- ---- Nothing is written that has not been shown ----
--
-- `crm_enrichment_plan` writes nothing and returns a decision per row.
-- `crm_apply_enrichment` recomputes that plan itself rather than
-- accepting one from the browser, and applies only what it decides. A
-- preview computed one way and an import executed another is how a
-- preview ends up lying, which `components/crm/ImportDialog.tsx`
-- already says at length about the insert path.
--
-- ---- Safe to run twice ----
--
-- Both functions replace themselves, and applying twice fills nothing
-- the second time because the first filled it.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. A company name, reduced to the part that identifies it.
--
-- IMMUTABLE, so it can be indexed and so two calls on the same string
-- can never disagree.
--
-- Order matters. Brackets go before punctuation, because "(PRE FUNDED)"
-- has to be removed as a unit rather than turned into "pre funded" and
-- left on the end. Suffixes go last, and repeatedly, because "Holdings
-- UK Ltd" is three of them.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION company_key(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s    TEXT;
  was  TEXT;
  n    INTEGER := 0;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;

  s := lower(btrim(p_name));

  /* Anything in brackets. "(PRE FUNDED)", "(UK)", "(formerly ...)".
     None of it is the company's name and all of it differs between two
     systems that both hold the same customer. */
  s := regexp_replace(s, '\([^)]*\)', ' ', 'g');

  /* A trading name after a slash or "t/a". The part before it is the
     legal entity and is what both systems tend to agree on. */
  s := regexp_replace(s, '\s+t/?a\s+.*$', ' ', 'g');

  /* "and" and "&" are the same word and the two systems disagree about
     which to use often enough to matter. Both go. */
  s := regexp_replace(s, '\s+(and|&)\s+', ' ', 'g');

  /* Punctuation, and then whitespace collapsed. */
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));

  /* Company suffixes, off the end, until there are none left. Looped
     rather than one pass, because "Transport Holdings UK Limited" is
     four words of suffix and one pass would leave three of them. */
  LOOP
    was := s;
    /* `(^|\s+)` and not just `\s+`, so a name that is nothing but a
       suffix reduces to nothing and is refused, rather than surviving
       as the key "ltd" and matching every badly typed record in the
       CRM at once. */
    s := regexp_replace(
      s,
      '(^|\s+)(ltd|limited|plc|llp|lp|inc|incorporated|corp|corporation|'
      || 'co|company|group|holdings|holding|international|intl|uk|gb|'
      || 'the|services|service)$',
      '', 'g');
    s := btrim(s);
    n := n + 1;
    EXIT WHEN s = was OR n > 8;
  END LOOP;

  /* "The Booker Group" and "Booker" should meet. Leading "the" is the
     only leading word worth removing: everything else is the name. */
  s := btrim(regexp_replace(s, '^the\s+', '', 'g'));

  /* And finally the spaces, all of them.

     "A.C.S. Construction" became "a c s construction" when the
     punctuation went, and the other system writes "ACS Construction".
     Joining runs of initials back up was the obvious fix and it was
     fiddly and it was wrong twice: a regex that consumes the space
     between two single letters cannot chain across three of them.

     Removing every space is shorter, does the same job, and also
     catches "Red Line" against "Redline", which is the same firm
     written two ways. Two genuinely different companies whose names
     differ only in where the spaces fall would collide, and that is
     what the "exactly one match" rule is for: a collision is refused
     and reported, not guessed at. */
  s := replace(s, ' ', '');

  RETURN NULLIF(s, '');
END;
$fn$;

COMMENT ON FUNCTION company_key(TEXT) IS
  'A company name reduced to the part that identifies it: brackets, '
  'punctuation, ampersands and company suffixes removed. For comparing '
  'two systems that hold the same customer under slightly different '
  'names. Never for display.';

GRANT EXECUTE ON FUNCTION company_key(TEXT) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_company_key
  ON crm_contacts (company_key(company_name));

-- -------------------------------------------------------------
-- 2. What would happen.
--
-- Writes nothing. One row out per row in, with what it matched, how,
-- and which of the three fields it would fill.
--
-- `p_rows` is the file, as
--   [{"alpha":"BOOKER","name":"Booker Limited","email":"...",
--     "phone":"...","address":"..."}, ...]
--
-- `verdict` is the column to read:
--
--   fill              matched, and there is a blank to fill
--   nothing to add    matched, and it already has everything on offer
--   file has nothing  the row carries no email, phone or address
--   no match          not in the CRM. Left alone, deliberately.
--   ambiguous name    the name picks out more than one CRM record
--   name twice        the name appears more than once in the file
--   name too short    under four characters once normalised
--   two rows disagree two file rows reach the same record with
--                     different values for the same blank field
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_enrichment_plan(p_rows JSONB)
RETURNS TABLE (
  alpha        TEXT,
  file_name    TEXT,
  contact_id   UUID,
  crm_name     TEXT,
  matched_by   TEXT,
  verdict      TEXT,
  fill_email   TEXT,
  fill_phone   TEXT,
  fill_address TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Bringing a file into the CRM needs the import permission.';
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT btrim(COALESCE(r ->> 'alpha', ''))   AS alpha,
           btrim(COALESCE(r ->> 'name', ''))    AS file_name,
           /* Lower cased and only if it looks like an address. A field
              with no @ is not an email and putting it in the email
              column is worse than leaving the column empty. */
           CASE WHEN btrim(COALESCE(r ->> 'email', '')) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                THEN lower(btrim(r ->> 'email')) END AS email,
           NULLIF(btrim(COALESCE(r ->> 'phone', '')), '')   AS phone,
           NULLIF(btrim(COALESCE(r ->> 'address', '')), '') AS address,
           ordinality AS seq
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ordinality)
  ),
  keyed AS (
    SELECT raw.*, company_key(raw.file_name) AS key
      FROM raw
  ),
  /* A name that appears twice in the FILE can never be used to match,
     whatever the CRM says. Counted over the file rather than assumed. */
  name_counts AS (
    SELECT key, count(*) AS times FROM keyed WHERE key IS NOT NULL GROUP BY key
  ),
  /* How many CRM records each normalised name picks out. Two is not a
     near miss, it is a question. */
  crm_counts AS (
    SELECT company_key(c.company_name) AS key, count(*) AS hits
      FROM crm_contacts c
     WHERE company_key(c.company_name) IS NOT NULL
     GROUP BY 1
  ),
  matched AS (
    SELECT k.*,
           COALESCE(byalpha.contact_id, byname.id)                       AS hit,
           CASE WHEN byalpha.contact_id IS NOT NULL THEN 'account code'
                WHEN byname.id IS NOT NULL          THEN 'name'
                ELSE NULL END                                            AS how,
           nc.times AS in_file,
           cc.hits  AS in_crm
      FROM keyed k
      LEFT JOIN name_counts nc ON nc.key = k.key
      LEFT JOIN crm_counts  cc ON cc.key = k.key
      /* 1. The account code, which somebody has already confirmed by
            binding it. Maintenance is the STC division. */
      LEFT JOIN LATERAL (
        SELECT a.contact_id FROM protean_accounts a
         WHERE a.division = 'stc' AND a.alpha = k.alpha
           AND a.contact_id IS NOT NULL AND NOT a.ignored
         LIMIT 1
      ) byalpha ON TRUE
      /* 2. The name, and only where it is unambiguous on both sides. */
      LEFT JOIN LATERAL (
        SELECT c.id FROM crm_contacts c
         WHERE byalpha.contact_id IS NULL
           AND k.key IS NOT NULL
           AND length(k.key) >= 4
           AND COALESCE(nc.times, 0) = 1
           AND COALESCE(cc.hits, 0) = 1
           AND company_key(c.company_name) = k.key
         LIMIT 1
      ) byname ON TRUE
  ),
  /* What each match would actually put in, which is only ever into a
     column that is empty now. */
  proposed AS (
    SELECT m.*,
           c.company_name AS crm_name,
           CASE WHEN NULLIF(btrim(COALESCE(c.email, '')), '') IS NULL   THEN m.email END   AS put_email,
           CASE WHEN NULLIF(btrim(COALESCE(c.phone, '')), '') IS NULL   THEN m.phone END   AS put_phone,
           CASE WHEN NULLIF(btrim(COALESCE(c.address, '')), '') IS NULL THEN m.address END AS put_address
      FROM matched m
      LEFT JOIN crm_contacts c ON c.id = m.hit
  ),
  /* Two file rows can reach one CRM record: two Protean accounts bound
     to the same customer is normal. Agreeing is fine. Disagreeing about
     what goes in the same blank is a question, and both are refused
     rather than one being picked by whichever sorted first. */
  clashes AS (
    SELECT hit
      FROM proposed
     WHERE hit IS NOT NULL
     GROUP BY hit
    HAVING count(DISTINCT put_email)   > 1
        OR count(DISTINCT put_phone)   > 1
        OR count(DISTINCT put_address) > 1
  )
  SELECT p.alpha,
         p.file_name,
         p.hit,
         p.crm_name,
         p.how,
         CASE
           WHEN p.hit IS NULL AND p.key IS NOT NULL AND length(p.key) < 4
             THEN 'name too short'
           WHEN p.hit IS NULL AND COALESCE(p.in_file, 0) > 1
             THEN 'name twice'
           WHEN p.hit IS NULL AND COALESCE(p.in_crm, 0) > 1
             THEN 'ambiguous name'
           WHEN p.hit IS NULL
             THEN 'no match'
           WHEN p.hit IN (SELECT hit FROM clashes)
             THEN 'two rows disagree'
           WHEN p.email IS NULL AND p.phone IS NULL AND p.address IS NULL
             THEN 'file has nothing'
           WHEN p.put_email IS NULL AND p.put_phone IS NULL AND p.put_address IS NULL
             THEN 'nothing to add'
           ELSE 'fill'
         END,
         CASE WHEN p.hit IN (SELECT hit FROM clashes) THEN NULL ELSE p.put_email END,
         CASE WHEN p.hit IN (SELECT hit FROM clashes) THEN NULL ELSE p.put_phone END,
         CASE WHEN p.hit IN (SELECT hit FROM clashes) THEN NULL ELSE p.put_address END
    FROM proposed p
   ORDER BY p.seq;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_enrichment_plan(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_enrichment_plan(JSONB) TO authenticated;

COMMENT ON FUNCTION crm_enrichment_plan(JSONB) IS
  'What filling the CRM in from a file would do. Writes nothing. '
  'Matches on the Protean account code first and on a normalised name '
  'only where it is unambiguous on both sides.';

-- -------------------------------------------------------------
-- 3. Doing it.
--
-- Recomputes the plan rather than taking one. The browser is where the
-- plan is SHOWN and is not where it is decided, so a page left open
-- while somebody else edited a record cannot write a stale answer, and
-- a tampered payload gets the same treatment as an honest one.
--
-- Only rows the plan calls `fill`. Only into columns that are empty.
-- Never an INSERT, so a company on the file and not in the CRM stays
-- off the CRM, which was asked for in as many words.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_apply_enrichment(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  filled   INTEGER := 0;
  emails   INTEGER := 0;
  phones   INTEGER := 0;
  addrs    INTEGER := 0;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Bringing a file into the CRM needs the import permission.';
  END IF;

  /* One statement, no scratch table.

     The first version built a temp table and cleared it with
     `DELETE FROM _enrich;`. Supabase runs with `sql_safe_updates` on,
     which refuses any DELETE or UPDATE without a WHERE clause, so the
     whole thing failed at the point of pressing Apply with "DELETE
     requires a WHERE clause". The disposable Postgres this was written
     against does not have that setting on by default, which is why it
     passed here and failed there. `enrichment-check.sql` turns it on
     now so the next one cannot get through.

     A CTE is the better shape anyway: the plan is computed once, the
     update reads it, and the counts come back out of the same
     statement rather than from a table that has to be kept in step. */
  WITH decided AS (
    SELECT p.contact_id,
           max(p.fill_email)   AS email,
           max(p.fill_phone)   AS phone,
           max(p.fill_address) AS address
      FROM crm_enrichment_plan(p_rows) p
     WHERE p.verdict = 'fill' AND p.contact_id IS NOT NULL
     GROUP BY p.contact_id
  ),
  applied AS (
    /* COALESCE on the EXISTING value, not on the incoming one. The plan
       has already decided the column is empty; this is the second lock
       on the same door, because "never overwrite" is the requirement
       that cannot be got wrong quietly. */
    UPDATE crm_contacts c
       SET email      = COALESCE(NULLIF(btrim(COALESCE(c.email, '')), ''), d.email),
           phone      = COALESCE(NULLIF(btrim(COALESCE(c.phone, '')), ''), d.phone),
           address    = COALESCE(NULLIF(btrim(COALESCE(c.address, '')), ''), d.address),
           updated_at = NOW()
      FROM decided d
     WHERE c.id = d.contact_id
    RETURNING d.email AS put_email, d.phone AS put_phone, d.address AS put_address
  )
  SELECT count(*),
         count(put_email),
         count(put_phone),
         count(put_address)
    INTO filled, emails, phones, addrs
    FROM applied;

  PERFORM audit(
    'update', 'crm_contacts', NULL, 'filled in from a file',
    jsonb_build_object('records', filled, 'emails', emails,
                       'phones', phones, 'addresses', addrs));

  RETURN jsonb_build_object(
    'records', filled, 'emails', emails, 'phones', phones, 'addresses', addrs);
END;
$fn$;

REVOKE ALL ON FUNCTION crm_apply_enrichment(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_apply_enrichment(JSONB) TO authenticated;

COMMENT ON FUNCTION crm_apply_enrichment(JSONB) IS
  'Fills blank email, phone and address on CRM records from a file. '
  'Recomputes the plan rather than taking one. Never inserts, never '
  'overwrites.';

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF company_key('A&A Scaffolding Group Limited (PRE FUNDED)') <> 'aascaffolding' THEN
    RAISE EXCEPTION '106 did not land: company_key gives % for the scaffolders',
      company_key('A&A Scaffolding Group Limited (PRE FUNDED)');
  END IF;
  IF company_key('The Booker Group Ltd') <> company_key('Booker') THEN
    RAISE EXCEPTION '106 did not land: Booker does not meet itself';
  END IF;
  IF company_key('Ltd') IS NOT NULL THEN
    RAISE EXCEPTION '106 did not land: a name that is nothing but a suffix is not a name';
  END IF;
  RAISE NOTICE 'the CRM can be filled in from a file, matched on the account code first';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
