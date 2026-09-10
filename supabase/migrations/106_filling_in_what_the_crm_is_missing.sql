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
--   same customer as another row
--                     this customer has more than one account code on
--                     the file, and another of its rows is the one
--                     supplying the values. Not a refusal.
-- -------------------------------------------------------------
/* Dropped first, because this returns a TABLE and `CREATE OR REPLACE`
   cannot change one: Postgres answers "cannot change return type of
   existing function ... Row type defined by OUT parameters is
   different". Adding `fill_city` to the column list is exactly that.

   It failed on the live database and passed every check here, because
   the disposable server is built from nothing every time and had never
   seen the older shape. `bundle-twice-check` did not catch it either:
   it applies this file twice over a base that never had the old
   version, so the second pass is replacing a function that already
   matches.

   `npm run check:migrations` is the guard for the class. */
DROP FUNCTION IF EXISTS crm_enrichment_plan(JSONB);

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
  fill_contact TEXT,
  fill_address TEXT,
  /* Carried through so `crm_apply_enrichment` can put it on the address
     row. The map falls back to the city when it cannot geocode the full
     address, so it earns its place. */
  fill_city    TEXT
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
           /* The first thing in the cell that is an email address.

              Not the whole cell. `crm_contacts.email` is one address
              and things send to it, so "no email on file" must not go
              in. But four rows of `Dean_Customers.xlsx` carry two,
              written "armtransportltd@gmail.com,
              l.walker@armtransport.co.uk", and an anchored match on the
              whole cell rejects those as well, which loses an address
              we have rather than refusing one we do not.

              So: pull the first address out of whatever the cell says.
              A cell with no address in it still yields nothing, which
              is the case that mattered. The second address is not
              thrown away, it is in the file, and if a second email
              column is ever wanted it is a column, not a guess made
              here. */
           (regexp_match(lower(btrim(COALESCE(r ->> 'email', ''))),
                         '[^@[:space:],;/<>()]+@[^@[:space:],;/<>()]+\.[a-z]{2,}'))[1] AS email,
           /* Only if there is a phone number in it.

              Thirteen rows of `Dean_Customers.xlsx` have a note in the
              Contact Number column instead: "mot/tacho only customer -
              Sam Clayton will have the contact details for this, have
              never contacted them before." Written into `phone` that
              breaks the dial link, the export and every place a number
              is expected to be a number.

              The cell is kept WHOLE when it does carry one, because
              twenty three rows read "Office: 0161 ... / Mobile: 07..."
              and a person reading the field wants both. Nine digits is
              the shortest a UK number gets, so it is the test, and it
              is a fact about telephone numbers rather than a threshold
              picked to suit this file. */
           CASE WHEN length(regexp_replace(
                       COALESCE((regexp_match(btrim(COALESCE(r ->> 'phone', '')),
                                              '\+?[0-9][0-9 ()./-]{7,}[0-9]'))[1], ''),
                       '[^0-9]', '', 'g')) >= 9
                THEN NULLIF(btrim(r ->> 'phone'), '') END AS phone,
           /* The person, as one string. `crm_contacts.contact_name` is
              a single free text field and the drawer edits it as one,
              so "Alan & Ian Edwards" goes in exactly as typed. There is
              no people table to split them into and inventing one to
              hold twenty three rows would be the tail wagging the dog. */
           /* ---- And the word somebody writes for "nobody" ----

              "n/a" is not a person. Neither is a dash or a question
              mark. That is a closed list of ways of writing "I have not
              got one", and each of them is worse in the field than the
              field being empty, because empty is what the CRM already
              means by "we do not know who to ask for".

              Nothing else is filtered. "Mahmood Khan (owner) / Aamna
              Raza (Transport Manager)" is fifty three characters and is
              two real people, so a length test would have thrown away a
              right answer to catch a wrong one. Where the cell holds a
              note rather than a name, it goes in as the note, because
              that is what somebody chose to write in the column headed
              Contact Name and this is not the place to overrule them. */
           CASE WHEN lower(btrim(COALESCE(r ->> 'contact', ''))) NOT IN (
                       '', 'n/a', 'n\a', 'na', 'none', 'no contact', 'no contacts',
                       'unknown', 'tbc', 'tba', '-', '--', '?', 'x')
                THEN NULLIF(btrim(r ->> 'contact'), '') END AS contact,
           NULLIF(btrim(COALESCE(r ->> 'address', '')), '') AS address,
           /* Worked out in the browser by `extractCityFromAddress`,
              which has the list of UK cities in it. Recomputing it here
              would be a second implementation of the same idea, and the
              two would disagree the first time somebody edited one. */
           NULLIF(btrim(COALESCE(r ->> 'city', '')), '')    AS city,
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
           CASE WHEN NULLIF(btrim(COALESCE(c.contact_name, '')), '') IS NULL
                THEN m.contact END AS put_contact,
           /* ---- Where an address actually lives ----

              `contact_addresses`, one row per site, one of them
              primary. `crm_contacts.address` is a SHADOW of the primary
              one, kept up to date by `contact_addresses_sync` in one
              direction only.

              The first version wrote the shadow. So the record's
              Addresses panel, which reads the real table, went on saying
              "No address saved", and running the file a second time said
              "nothing to add" because the shadow was now full. Reported
              as: "It found ipsum and said nothing to add, but the
              address is missing from the crm record." Exactly right, and
              the fault was writing to the wrong place.

              So the question is whether the customer has an address ROW,
              and the shadow column is not consulted at all. A record
              carrying only the old single field counts as having no
              address, which is what the drawer already tells people:
              "One address on the old single field. Adding it properly
              lets a customer have more than one site." */
           CASE WHEN NOT EXISTS (
                  SELECT 1 FROM contact_addresses a
                   WHERE a.contact_id = c.id
                     AND a.deleted_at IS NULL
                     AND btrim(COALESCE(a.address, '')) <> ''
                )
                /* ---- Never overwrite, including here ----

                   A record with no address row but something in the old
                   single field already HAS an address. It is in the
                   wrong place, which is a repair, not a blank.

                   So the shadow wins over the file when it is there.
                   That covers both cases with one rule: a record the
                   broken version filled has the file's own address in
                   the shadow and comes out the same either way, and a
                   record that had a hand typed address before any of
                   this keeps it. */
                THEN COALESCE(NULLIF(btrim(COALESCE(c.address, '')), ''), m.address)
                END AS put_address
      FROM matched m
      LEFT JOIN crm_contacts c ON c.id = m.hit
  ),
  /* ---- Two file rows reaching one CRM record ----

     Normal, and not a problem. A customer with two Protean accounts is
     the ordinary case: Ipsum is IPSUM and IPSUM01, one for the water
     business in Chorley and one for the infrastructure vehicles in
     Glasgow, both bound to the one customer record.

     The first version treated that as a contradiction and refused
     everything for that customer, including the email address only one
     of the rows had. So Ipsum came back "two rows disagree" and nothing
     went in, and so did every other firm with a second account code.
     That was a design mistake, not a typo: two rows disagreeing about
     which SITE to record is a data question, and it was being handled
     as though it were a question about WHICH COMPANY.

     Which company is already settled by the time we get here. So the
     rows are ranked and the best value for each FIELD is taken, in a
     stated order rather than by luck:

       1. The row whose own name reduces to the same thing as the
          customer record's name. That row is literally about this
          record: "Ipsum Water England & Wales" on the file against
          "Ipsum Water England & Wales" in the CRM.
       2. Otherwise a row matched by account code beats one matched by
          name.
       3. Otherwise the earlier row in the file.

     Per field, so a row that loses the address can still supply the
     email nobody else has. No identity can be got wrong by any of this,
     because every row being ranked has already resolved to the same
     customer. */
  ranked AS (
    SELECT p.*,
           ROW_NUMBER() OVER (
             PARTITION BY p.hit
             ORDER BY (company_key(p.crm_name) IS NOT DISTINCT FROM p.key) DESC,
                      (p.how = 'account code') DESC,
                      p.seq
           ) AS rank
      FROM proposed p
  ),
  chosen AS (
    SELECT r.hit,
           (array_agg(r.put_email   ORDER BY r.rank) FILTER (WHERE r.put_email   IS NOT NULL))[1] AS email,
           (array_agg(r.put_phone   ORDER BY r.rank) FILTER (WHERE r.put_phone   IS NOT NULL))[1] AS phone,
           (array_agg(r.put_contact ORDER BY r.rank) FILTER (WHERE r.put_contact IS NOT NULL))[1] AS contact,
           (array_agg(r.put_address ORDER BY r.rank) FILTER (WHERE r.put_address IS NOT NULL))[1] AS address,
           /* The city that came with the winning address, and not the
              highest ranked city on its own: a town from one row against
              a street from another is a nonsense.

              Null where the address being written is the promoted shadow
              rather than the file's, because the city the browser worked
              out belongs to the file's text. The map geocodes from the
              address itself when there is no city, so nothing is lost. */
           (array_agg(CASE WHEN r.put_address = r.address THEN r.city END
                      ORDER BY r.rank) FILTER (WHERE r.put_address IS NOT NULL))[1] AS city
      FROM ranked r
     WHERE r.hit IS NOT NULL
     GROUP BY r.hit
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
           /* Not the row that speaks for this customer. Said plainly
              rather than hidden, because somebody looking for Ipsum
              wants to find both of its lines and see what happened. */
           WHEN p.rank > 1
             THEN 'same customer as another row'
           WHEN p.email IS NULL AND p.phone IS NULL AND p.address IS NULL
                AND p.contact IS NULL
                AND NOT EXISTS (SELECT 1 FROM chosen c
                                 WHERE c.hit = p.hit
                                   AND (c.email IS NOT NULL OR c.phone IS NOT NULL
                                        OR c.address IS NOT NULL OR c.contact IS NOT NULL))
             THEN 'file has nothing'
           WHEN NOT EXISTS (SELECT 1 FROM chosen c
                             WHERE c.hit = p.hit
                               AND (c.email IS NOT NULL OR c.phone IS NOT NULL
                                    OR c.address IS NOT NULL OR c.contact IS NOT NULL))
             THEN 'nothing to add'
           ELSE 'fill'
         END,
         /* The chosen value, attributed to the row that speaks for the
            customer, because the record gets one email, one phone and
            one address whichever line supplied them. */
         CASE WHEN p.rank = 1 THEN (SELECT c.email   FROM chosen c WHERE c.hit = p.hit) END,
         CASE WHEN p.rank = 1 THEN (SELECT c.phone   FROM chosen c WHERE c.hit = p.hit) END,
         CASE WHEN p.rank = 1 THEN (SELECT c.contact FROM chosen c WHERE c.hit = p.hit) END,
         CASE WHEN p.rank = 1 THEN (SELECT c.address FROM chosen c WHERE c.hit = p.hit) END,
         CASE WHEN p.rank = 1 THEN (SELECT c.city    FROM chosen c WHERE c.hit = p.hit) END
    FROM ranked p
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
  people   INTEGER := 0;
  addrs    INTEGER := 0;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Bringing a file into the CRM needs the import permission.';
  END IF;

  /* One statement, no scratch table.

     The first version built a temp table and cleared it with
     a bare DELETE against it. Supabase preloads `pg_safeupdate`, which
     refuses any DELETE or UPDATE that does not say which rows and
     answers "DELETE requires a WHERE clause", so the whole thing failed
     at the point of pressing Apply. The disposable Postgres this was
     written against does not have that extension, which is why it
     passed thirty one assertions here and failed there.

     `enrichment-check.sql` cannot install the extension, so it asserts
     the rule statically over every plpgsql function instead.

     A CTE is the better shape anyway: the plan is computed once, the
     update reads it, and the counts come back out of the same
     statement rather than from a table that has to be kept in step. */
  /* ---- Two writes, because an address is not a column ----

     Email and phone are columns on `crm_contacts`. An address is a ROW
     in `contact_addresses`, and `crm_contacts.address` is only a shadow
     of the primary one that `contact_addresses_sync` maintains.

     Writing the shadow, which is what the first version did, leaves the
     record's Addresses panel empty and the shadow full, so the next run
     reports "nothing to add" about an address nobody can see. Inserting
     the row and letting the existing trigger update the shadow is the
     way round that works, and it is also how the drawer does it.

     The plan already decided the customer has no address row, so this
     inserts rather than updates and marks it primary.

     "Location" and "Addresses" are the same thing and must not coexist:
     the primary address row is the one, and the sync trigger is what
     puts it on the customer record for the grid. Any record left with a
     value in the old single field and no row gets that value promoted
     to a proper row here, which is the repair. */
  /* Dropped first, because ON COMMIT DROP is the END of the
     transaction and not the end of this call. Two presses of Apply
     inside one transaction found that: the second answered "relation
     _decided already exists". The dialog does one press per request so
     it would not have hit it, and a check that only ever calls a
     function once would not have found it either. */
  DROP TABLE IF EXISTS _decided;
  CREATE TEMP TABLE _decided ON COMMIT DROP AS
  SELECT p.contact_id,
         max(p.fill_email)   AS email,
         max(p.fill_phone)   AS phone,
         max(p.fill_contact) AS contact,
         max(p.fill_address) AS address,
         max(p.fill_city)    AS city
    FROM crm_enrichment_plan(p_rows) p
   WHERE p.verdict = 'fill' AND p.contact_id IS NOT NULL
   GROUP BY p.contact_id;

  /* The address rows first, so the sync trigger has already put the
     shadow column in step before anything reads it back. */
  WITH put AS (
    INSERT INTO contact_addresses (contact_id, label, address, city, is_primary)
    SELECT d.contact_id, 'Head office', d.address, d.city, TRUE
      FROM _decided d
     WHERE d.address IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO addrs FROM put;

  WITH done AS (
    /* COALESCE on the EXISTING value, not on the incoming one. The plan
       has already decided the column is empty; this is the second lock
       on the same door, because "never overwrite" is the requirement
       that cannot be got wrong quietly. */
    UPDATE crm_contacts c
       SET email        = COALESCE(NULLIF(btrim(COALESCE(c.email, '')), ''), d.email),
           phone        = COALESCE(NULLIF(btrim(COALESCE(c.phone, '')), ''), d.phone),
           contact_name = COALESCE(NULLIF(btrim(COALESCE(c.contact_name, '')), ''), d.contact),
           updated_at   = NOW()
      FROM _decided d
     WHERE c.id = d.contact_id
    RETURNING d.email AS put_email, d.phone AS put_phone, d.contact AS put_contact
  )
  SELECT count(*), count(put_email), count(put_phone), count(put_contact)
    INTO filled, emails, phones, people
    FROM done;

  PERFORM audit(
    'update', 'crm_contacts', NULL, 'filled in from a file',
    jsonb_build_object('records', filled, 'emails', emails, 'phones', phones,
                       'people', people, 'addresses', addrs));

  RETURN jsonb_build_object(
    'records', filled, 'emails', emails, 'phones', phones,
    'people', people, 'addresses', addrs);
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
