-- =============================================================
-- 157. One record per company, enforced rather than intended.
--
-- From the business:
--
--   the duplication engine you need to build must take a minimum of
--   4-straight-hours of testing end to end [...] The app must FORCE
--   reject duplications, if I try to manually add an account it must
--   force me to confirm it is in fact not a duplicate, when importing
--   it must reject accounts that are similar to others and confirm
--   whether to merge or create new
--
-- and, naming the thing that decides it:
--
--   the whole idea for an ALPHA code is that it tells you whether it's
--   a unique entry or not [...] Only sage doesn't provide that data,
--   all protean imports do and you were assigning these to CRM records
--   at one point as the main identifier.
--
-- =============================================================
-- WHAT WAS ACTUALLY THERE BEFORE THIS
-- =============================================================
--
-- Three separate duplicate checks, no two of them the same, and not one
-- of them able to stop anything:
--
--   CrmWorkspace.tsx          ilike('company_name', name), exact
--   lib/import/plan.ts        fold(), lowercase and punctuation only
--   protean_allocate_...()    lower(BTRIM(name))
--
-- `company_key()`, the fold that handles Ltd, Limited, brackets, "t/a",
-- ampersands and spacing, was used by NONE of them. Five database
-- functions insert into `crm_contacts` and not one called it:
-- command_import_contacts, make_customer_for_trailer,
-- protean_allocate_invoicing_types, protean_make_customer,
-- protean_make_customer_for_work. There was no unique index on the
-- name either. So "Biffa" and "Biffa Waste Services Ltd" were two
-- records, and the browser's check was a suggestion that every server
-- path walked straight past.
--
-- =============================================================
-- WHY A NAME CAN NEVER DECIDE IT, WITH THE EVIDENCE
-- =============================================================
--
-- Measured across all 888 live records, trigram similarity on the
-- folded name puts real duplicates and genuinely different firms in the
-- same band:
--
--   0.813  Dillion Whittle / Dillion Whitle            SAME FIRM
--   0.786  Caddow Wood / Cadowood Forestry             SAME FIRM
--   0.773  Byrne Civil Solutions / Byrne Civil Solutons SAME FIRM
--   0.667  A.M Transport / ABM Transport               DIFFERENT FIRMS
--   0.667  JS Transport / K.J.S. Transport Services    DIFFERENT FIRMS
--   0.625  RBC Logistics / KBC Logistics               DIFFERENT FIRMS
--   0.625  GEM Logistics / GEB Logistics               DIFFERENT FIRMS
--
-- There is no threshold that separates those. A name comparison can
-- only ever ASK. So this never merges on a name and never refuses on a
-- name alone: it refuses and asks, and remembers the answer.
--
-- =============================================================
-- WHAT DOES DECIDE IT: THE ALPHA, WITH ONE EXCEPTION
-- =============================================================
--
-- Protean gives every account a code. Two records on the same code are
-- the same account. Sage does not give one, so a Sage-only record has
-- no such proof and falls through to the asking.
--
-- THE EXCEPTION, and it is the whole reason this is not two lines:
-- 38 of the 395 accounts are marked `is_invoicing_type`. Those are the
-- PAYERS, not the customers: Cash Sale, Allianz Claims, Solus, Control
-- Expert, Lombard, Close Brothers, Propel, BPCE, Siemens Financial and
-- the rest of the leasing book. Their code says who sent the money. It
-- says nothing about whose lorry it was.
--
-- CASHSALE alone carries 2,607 invoices. Treating it as identity would
-- make every cash customer in the business one company. So only a
-- NON-invoicing account code is identity here, and that is what
-- `contact_identity_alphas()` returns.
--
-- =============================================================
-- THE LADDER
-- =============================================================
--
--   1. share a non-invoicing (division, alpha)   SAME, certain
--   2. hold different ones in the same division  DIFFERENT, certain
--   3. identical email address                   SAME
--   4. identical company_key                     SAME
--   5. word prefix, shared words, similarity,
--      or the same phone number                  MAYBE, ask a person
--
-- Rule 2 beats rules 3, 4 and 5. That is what stops the engine asking
-- about Chartrange Limited and Chartrange Enviro Limited forever: they
-- hold two account codes and the business has said they are two
-- accounts for two reasons.
--
-- Rule 1 beats everything, including rule 2, because one record cannot
-- both share a code and not share it, and a shared code is the stronger
-- statement.
-- =============================================================

/* Trigram similarity, which is what makes "is this nearly that name" a
   question the database can answer quickly. It lives in `extensions` on
   Supabase; the schema is created here so that the disposable test
   server, which has no such convention, builds the same shape. */
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO PUBLIC;

/* Wrapped, so that nothing else in this codebase has to know which
   schema the extension landed in. */
CREATE OR REPLACE FUNCTION name_similarity(a TEXT, b TEXT)
RETURNS REAL
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
  SELECT CASE WHEN a IS NULL OR b IS NULL THEN 0::REAL ELSE similarity(a, b) END;
$fn$;

COMMENT ON FUNCTION name_similarity(TEXT, TEXT) IS
  'Trigram similarity between two folded names, 0 to 1. Wrapped so the rest of the '
  'codebase does not have to know which schema pg_trgm landed in.';

-- -------------------------------------------------------------
-- The folded name, WITH its word boundaries kept.
--
-- `company_key()` ends by removing every space, which is right for an
-- exact comparison and useless for "is this name the start of that
-- one". "AC Group" folds to `ac`, which is the start of `acrolift`,
-- `access` and `actransport`, and a prefix rule on the spaceless key
-- offers all three.
--
-- So this is company_key up to, but not including, that last step, plus
-- two joins that the space removal used to do by accident:
--
--   runs of single letters     "A.C.S. Construction" -> "acs construction"
--   a lone possessive s        "Richardson's Commercials" -> "richardsons commercials"
--
-- Both are cases where two systems write the same firm differently and
-- the difference is not a word.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION company_words(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s   TEXT;
  was TEXT;
  n   INTEGER := 0;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;

  s := lower(btrim(p_name));
  s := regexp_replace(s, '\([^)]*\)', ' ', 'g');
  s := regexp_replace(s, '\s+t/?a\s+.*$', ' ', 'g');
  s := regexp_replace(s, '\s+(and|&)\s+', ' ', 'g');
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));

  LOOP
    was := s;
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

  s := btrim(regexp_replace(s, '^the\s+', '', 'g'));

  /* A lone "s" belongs to the word in front of it. Done before the
     single letter run join, because otherwise "richardson s" would be
     read as a run and left alone. */
  LOOP
    was := s;
    s := regexp_replace(s, '([a-z0-9]{2,}) s( |$)', '\1s\2', 'g');
    EXIT WHEN s = was;
  END LOOP;

  /* Runs of two or more single letters join up, so that "A.C.S.
     Construction" and "ACS Construction" are the same two words.

     Walked rather than replaced, because a regex that consumes the
     space between two single letters cannot then chain onto a third:
     "a c s construction" came out as "ac s construction", which is
     neither of the two spellings anybody writes. A run of exactly one
     single letter is left where it is: "A C Transport" joining to
     "ac transport" is right, "J Smith" collapsing is not. */
  DECLARE
    w   TEXT[] := string_to_array(s, ' ');
    out TEXT[] := '{}';
    run TEXT;
    i   INT := 1;
    len INT := COALESCE(array_length(w, 1), 0);
  BEGIN
    WHILE i <= len LOOP
      IF length(w[i]) = 1 THEN
        run := '';
        WHILE i <= len AND length(w[i]) = 1 LOOP
          run := run || w[i];
          i := i + 1;
        END LOOP;
        out := out || run;
      ELSE
        out := out || w[i];
        i := i + 1;
      END IF;
    END LOOP;
    s := array_to_string(out, ' ');
  END;

  RETURN NULLIF(btrim(regexp_replace(s, '\s+', ' ', 'g')), '');
END;
$fn$;

COMMENT ON FUNCTION company_words(TEXT) IS
  'The same fold as company_key but keeping word boundaries, so that "is this name '
  'the start of that one" can be asked about whole words. company_key removes every '
  'space, which makes "AC Group" the start of "Acrolift", "Access" and "AC Transport".';

-- -------------------------------------------------------------
-- The account codes that identify a company.
--
-- An `is_invoicing_type` account is a payer, not a customer. CASHSALE
-- carries 2,607 invoices on its own; reading it as identity would make
-- every cash customer one company.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION contact_identity_alphas(p_contact UUID)
RETURNS TABLE (division TEXT, alpha TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT a.division, a.alpha
    FROM protean_accounts a
   WHERE a.contact_id = p_contact
     AND NOT COALESCE(a.is_invoicing_type, FALSE);
$fn$;

COMMENT ON FUNCTION contact_identity_alphas(UUID) IS
  'The Protean account codes that say WHO this is, which excludes the invoicing '
  'types: Cash Sale, the insurers and the leasing book all pay on behalf of other '
  'people and their code says who sent the money, not whose lorry it was.';

REVOKE ALL ON FUNCTION contact_identity_alphas(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contact_identity_alphas(UUID) TO authenticated;

-- -------------------------------------------------------------
-- An email reduced to something comparable.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION email_key(p_email TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $fn$
  SELECT NULLIF(lower(btrim(p_email)), '');
$fn$;

/* A phone number is the digits. Everything else is how somebody chose
   to lay it out, and the same number arrives as "0161 483 0000",
   "+441614830000" and "0161-483-0000" from three systems. */
CREATE OR REPLACE FUNCTION phone_key(p_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $fn$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'),
      '^(\+44|0044)', '0'),
    '');
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'the identity keys are in place';
END $$;

-- =============================================================
-- HOW TWO NAMES ARE RELATED
--
-- Pure, so it can be asserted on its own against every real pair in the
-- CRM without seeding a database. Returns one of:
--
--   exact    the same company_key. "Stagecoach" and "Stagecoach Services Ltd"
--   prefix   one name's words begin the other's. "Stotts Tours" in "Stotts Tours Oldham"
--   shared   they share their first two or more words. "Sprint Shift CVH" and "Sprint Shift NW"
--   similar  close enough on trigrams. "Byrne Civil Solutions" and "Byrne Civil Solutons"
--   NULL     nothing worth asking about
--
-- ---- The two guards, and what each one is for ----
--
-- THE SHARED WORDS MUST CONTAIN A REAL WORD. At least one of them has
-- to be four characters or more. Without it, "AC Group" folds to the
-- single word `ac` and is the prefix of `ac transport`, and every firm
-- whose name starts with two initials gets offered against every other
-- one. Four is not a taste: it is the shortest length at which the
-- shared part of these 888 names stops being an abbreviation.
--
-- THE SIMILARITY FLOOR IS 0.55, and it is a floor on ASKING, never on
-- deciding. 0.55 is where "Byrne Civil Solutions" meets "Byrne Civil
-- Solutons", which is the closest real duplicate in the CRM that no
-- other rule catches. Genuinely different firms sit above it too, as
-- the banner explains, and that is fine: the cost of being asked once
-- is one press, and the answer is remembered forever. The cost of not
-- being asked is a second record that never goes away.
-- =============================================================
CREATE OR REPLACE FUNCTION name_relationship(a_name TEXT, b_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  ak   TEXT := company_key(a_name);
  bk   TEXT := company_key(b_name);
  aw   TEXT[];
  bw   TEXT[];
  shrt INT;
  shared INT := 0;
  i    INT;
  meaty BOOLEAN := FALSE;
BEGIN
  IF ak IS NULL OR bk IS NULL THEN RETURN NULL; END IF;
  IF ak = bk THEN RETURN 'exact'; END IF;

  aw := string_to_array(company_words(a_name), ' ');
  bw := string_to_array(company_words(b_name), ' ');
  shrt := LEAST(COALESCE(array_length(aw, 1), 0), COALESCE(array_length(bw, 1), 0));

  i := 1;
  WHILE i <= shrt AND aw[i] = bw[i] LOOP
    IF length(aw[i]) >= 4 THEN meaty := TRUE; END IF;
    shared := i;
    i := i + 1;
  END LOOP;

  IF meaty THEN
    IF shared = shrt THEN RETURN 'prefix'; END IF;
    IF shared >= 2 THEN RETURN 'shared'; END IF;
  END IF;

  IF name_similarity(ak, bk) >= 0.55 THEN RETURN 'similar'; END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION name_relationship(TEXT, TEXT) IS
  'How two company names are related: exact, prefix, shared, similar, or nothing. '
  'Never decides that two firms are the same, only that a person should be asked.';

-- =============================================================
-- WHAT SOMEBODY HAS ALREADY DECIDED
--
-- The engine asks once. "RBC Logistics and KBC Logistics are two
-- companies" is answered by a person, written down here, and never
-- asked again. Without this the confirm step becomes noise and people
-- learn to press through it, which is worse than not asking.
--
-- Keyed on the two company_keys rather than on two record ids, so that
-- the decision survives one of the records being merged away and
-- applies the next time somebody types the same name.
-- =============================================================
CREATE TABLE IF NOT EXISTS crm_duplicate_decisions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_low    TEXT NOT NULL,
  key_high   TEXT NOT NULL,
  /* Only ever 'different'. The engine records that somebody said these
     are two companies; it does not need a row to record that they are
     the same, because being the same means one of them stops existing. */
  verdict    TEXT NOT NULL DEFAULT 'different' CHECK (verdict = 'different'),
  why        TEXT,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (key_low < key_high),
  UNIQUE (key_low, key_high)
);

COMMENT ON TABLE crm_duplicate_decisions IS
  'Pairs of company names a person has looked at and said are two different firms. '
  'Keyed on the folded names, not the record ids, so the answer survives a merge and '
  'applies the next time somebody types it.';

ALTER TABLE crm_duplicate_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "duplicate_decisions_select" ON crm_duplicate_decisions;
CREATE POLICY "duplicate_decisions_select" ON crm_duplicate_decisions
  FOR SELECT USING (command_may('crm.view'));

CREATE OR REPLACE FUNCTION crm_decision_says_different(a_key TEXT, b_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM crm_duplicate_decisions d
     WHERE d.key_low  = LEAST(a_key, b_key)
       AND d.key_high = GREATEST(a_key, b_key));
$fn$;

REVOKE ALL ON FUNCTION crm_decision_says_different(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_decision_says_different(TEXT, TEXT) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'names can be compared and a decision about two of them can be remembered';
END $$;

-- =============================================================
-- THE CANDIDATES, AND THE VERDICT ON EACH
--
-- One function. Everything that can create a company asks this and
-- nothing forms its own opinion, which is the whole difference between
-- this and the three disagreeing checks it replaces.
--
-- It answers about a name that may not exist yet, so it takes the
-- fields rather than a record id. `p_alphas` is what Protean said about
-- the thing being created, as [{"division":"stc","alpha":"STOBARTS"}].
-- An import has it. A person typing a name into the CRM does not, and
-- that is the difference between proof and a question.
-- =============================================================
DROP FUNCTION IF EXISTS crm_identity_candidates(TEXT, TEXT, TEXT, JSONB, UUID);
CREATE OR REPLACE FUNCTION crm_identity_candidates(
  p_name   TEXT,
  p_email  TEXT DEFAULT NULL,
  p_phone  TEXT DEFAULT NULL,
  p_alphas JSONB DEFAULT '[]'::JSONB,
  p_exclude UUID DEFAULT NULL
)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  verdict      TEXT,
  because      TEXT,
  relationship TEXT,
  invoices     INTEGER,
  spend        NUMERIC,
  leads        INTEGER,
  owner        TEXT,
  settled      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  key   TEXT := company_key(p_name);
  mail  TEXT := email_key(p_email);
  fone  TEXT := phone_key(p_phone);
  mine  JSONB := COALESCE(p_alphas, '[]'::JSONB);
BEGIN
  IF key IS NULL THEN
    /* A name that folds to nothing is "Ltd", "The", or punctuation. It
       cannot be compared and it should not be a record either, but
       refusing that is the caller's job, not this function's. */
    RETURN;
  END IF;

  RETURN QUERY
  WITH theirs AS (
    SELECT c.id, c.company_name AS nm, c.relationship AS rel,
           company_key(c.company_name) AS k,
           email_key(c.email) AS mk,
           phone_key(c.phone) AS pk
      FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND (p_exclude IS NULL OR c.id <> p_exclude)
  ), judged AS (
    SELECT t.*,
           EXISTS (
             SELECT 1 FROM contact_identity_alphas(t.id) ia
              JOIN LATERAL jsonb_to_recordset(mine) AS m(division TEXT, alpha TEXT)
                ON m.division = ia.division AND m.alpha = ia.alpha
           ) AS shares_alpha,
           EXISTS (
             SELECT 1 FROM contact_identity_alphas(t.id) ia
              JOIN LATERAL jsonb_to_recordset(mine) AS m(division TEXT, alpha TEXT)
                ON m.division = ia.division AND m.alpha <> ia.alpha
           ) AS conflicting_alpha,
           name_relationship(p_name, t.nm) AS nr
      FROM theirs t
  )
  SELECT
    j.id,
    j.nm,
    CASE
      /* 1. Protean says it is the same account. Nothing outranks this. */
      WHEN j.shares_alpha THEN 'same'
      /* 2. Protean says it is not. This is what stops the engine asking
            about Chartrange Limited and Chartrange Enviro forever. */
      WHEN j.conflicting_alpha THEN 'different'
      /* 3. and 4. One address, or one folded name, is one company. */
      WHEN mail IS NOT NULL AND j.mk = mail THEN 'same'
      WHEN j.k = key THEN 'same'
      /* 5. Everything else is a question for a person. */
      WHEN j.nr IS NOT NULL OR (fone IS NOT NULL AND j.pk = fone) THEN 'maybe'
      ELSE 'unrelated'
    END,
    CASE
      WHEN j.shares_alpha THEN 'they are on the same Protean account'
      WHEN j.conflicting_alpha THEN 'they hold different Protean accounts in the same division'
      WHEN mail IS NOT NULL AND j.mk = mail THEN 'the same email address is on both'
      WHEN j.k = key THEN 'the same company name, once Ltd and punctuation are set aside'
      WHEN j.nr = 'prefix' THEN 'one name is the start of the other'
      WHEN j.nr = 'shared' THEN 'the names start with the same words'
      WHEN j.nr = 'similar' THEN 'the names are nearly the same'
      WHEN fone IS NOT NULL AND j.pk = fone THEN 'the same phone number is on both'
      ELSE NULL
    END,
    j.rel,
    (SELECT count(*)::INTEGER FROM protean_invoices i WHERE i.contact_id = j.id),
    (SELECT COALESCE(ROUND(SUM(i.net), 2), 0) FROM protean_invoices i WHERE i.contact_id = j.id),
    (SELECT count(*)::INTEGER FROM crm_leads l WHERE l.contact_id = j.id),
    (SELECT p.full_name FROM crm_leads l JOIN profiles p ON p.id = l.owner_id
      WHERE l.contact_id = j.id ORDER BY l.updated_at DESC LIMIT 1),
    crm_decision_says_different(key, j.k)
  FROM judged j
  WHERE j.shares_alpha
     OR j.conflicting_alpha
     OR (mail IS NOT NULL AND j.mk = mail)
     OR j.k = key
     OR j.nr IS NOT NULL
     OR (fone IS NOT NULL AND j.pk = fone)
  ORDER BY 3, 2;
END;
$fn$;

COMMENT ON FUNCTION crm_identity_candidates(TEXT, TEXT, TEXT, JSONB, UUID) IS
  'Every existing record that might be this company, and what the evidence says: '
  'same, different or maybe. The one opinion in the application. Everything that can '
  'create a company asks this and nothing forms its own.';

REVOKE ALL ON FUNCTION crm_identity_candidates(TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_identity_candidates(TEXT, TEXT, TEXT, JSONB, UUID) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the application has one opinion about whether two records are one company';
END $$;

-- =============================================================
-- THE REFUSAL, ON THE TABLE ITSELF
--
-- From the business:
--
--   The app must FORCE reject duplications
--
-- A gate that callers are asked to use is a gate that some caller will
-- not use, and five database functions plus two API routes plus the
-- grid all insert into this table today. So the refusal lives on the
-- table, where PostgREST, a direct INSERT, an import, a trigger and a
-- migration all meet it.
--
--   verdict 'same'   refused, and there is no way to override it.
--                    The answer is to open the record that exists.
--
--   verdict 'maybe'  refused UNTIL a person has said the two are
--                    different firms, which is written to
--                    `crm_duplicate_decisions` and never asked again.
--
-- ---- What it deliberately does not do ----
--
-- It does not look at the records already here. The CRM holds 30 pairs
-- that share a company_key, put there before any of this existed, and
-- refusing to let anybody edit them would make the duplicates
-- permanent. So the check runs when a record's IDENTITY changes, which
-- is its name or its email, and an ordinary edit to a phone number or
-- an owner passes straight through.
-- =============================================================
CREATE OR REPLACE FUNCTION crm_refuse_a_second_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  hit RECORD;
BEGIN
  /* A record on its way out is not a company anybody is creating. */
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  /* Only when the identity moves. Everything else about a record can be
     edited freely, including on the pairs that were here first. */
  IF TG_OP = 'UPDATE'
     AND company_key(NEW.company_name) IS NOT DISTINCT FROM company_key(OLD.company_name)
     AND email_key(NEW.email) IS NOT DISTINCT FROM email_key(OLD.email)
     AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF company_key(NEW.company_name) IS NULL THEN
    RAISE EXCEPTION
      '% is not a company name. It is punctuation, or a company suffix with no company in front of it.',
      COALESCE('"' || NEW.company_name || '"', 'A blank');
  END IF;

  SELECT * INTO hit
    FROM crm_identity_candidates(NEW.company_name, NEW.email, NULL, '[]'::JSONB, NEW.id) c
   WHERE c.verdict = 'same'
   ORDER BY c.invoices DESC
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      '% is already in the CRM as "%", because %. Open that record rather than starting a second one.',
      NEW.company_name, hit.company_name, hit.because
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT * INTO hit
    FROM crm_identity_candidates(NEW.company_name, NEW.email, NEW.phone, '[]'::JSONB, NEW.id) c
   WHERE c.verdict = 'maybe' AND NOT c.settled
   ORDER BY c.invoices DESC
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      '% looks like "%", because %. Say which it is: open that record, or confirm they are two different firms.',
      NEW.company_name, hit.company_name, hit.because
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS crm_contacts_one_per_company ON crm_contacts;
CREATE TRIGGER crm_contacts_one_per_company
  BEFORE INSERT OR UPDATE OF company_name, email ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_refuse_a_second_record();

-- =============================================================
-- SAYING THEY ARE TWO DIFFERENT FIRMS
--
-- The only way past a `maybe`. Written down against the folded names,
-- so it survives a merge and applies the next time somebody types it.
-- =============================================================
CREATE OR REPLACE FUNCTION crm_say_they_are_different(
  p_name TEXT, p_other UUID, p_why TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  a TEXT := company_key(p_name);
  b TEXT;
  n TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying two companies are different needs permission to edit the CRM.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  SELECT company_key(c.company_name), c.company_name INTO b, n
    FROM crm_contacts c WHERE c.id = p_other AND c.deleted_at IS NULL;
  IF b IS NULL THEN
    RAISE EXCEPTION 'The record being compared against is not in the CRM.';
  END IF;
  IF a IS NULL THEN
    RAISE EXCEPTION '% is not a company name.', COALESCE('"' || p_name || '"', 'A blank');
  END IF;
  IF a = b THEN
    RAISE EXCEPTION
      'Those are the same name once Ltd and punctuation are set aside, so they cannot be two firms. "%" is already here.',
      n;
  END IF;

  INSERT INTO crm_duplicate_decisions (key_low, key_high, why, decided_by)
  VALUES (LEAST(a, b), GREATEST(a, b), p_why, auth.uid())
  ON CONFLICT (key_low, key_high) DO NOTHING;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_say_they_are_different(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_say_they_are_different(TEXT, UUID, TEXT) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the table itself refuses a second record for a company it already holds';
END $$;

-- =============================================================
-- ADDING A COMPANY
--
-- From the business:
--
--   if I try to manually add an account it must force me to confirm it
--   is in fact not a duplicate
--
-- This REPORTS rather than throws, because the screen has to draw the
-- record it found: its spend, its owner, its leads, so that the person
-- answering has something to answer with. The table's own trigger is
-- what throws, and it is still there underneath this: a caller that
-- ignores the report and inserts anyway is refused by the table.
--
-- Three answers:
--
--   created    nothing else is this company
--   joined     it is already here; the existing record is returned and
--              put on the list, and nothing new was made
--   confirm    one or more records might be it, and a person has to say
--
-- `p_confirmed` is the ids a person has looked at and called different
-- firms. Each one is written to `crm_duplicate_decisions` before the
-- insert, so the answer holds for good and the trigger lets it through.
-- =============================================================
DROP FUNCTION IF EXISTS crm_contact_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], JSONB);
CREATE OR REPLACE FUNCTION crm_contact_create(
  p_name         TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_email        TEXT DEFAULT NULL,
  p_phone        TEXT DEFAULT NULL,
  p_location     TEXT DEFAULT NULL,
  p_relationship TEXT DEFAULT 'prospect',
  p_source       TEXT DEFAULT 'manual',
  p_assigned_to  TEXT DEFAULT NULL,
  p_list         UUID DEFAULT NULL,
  p_confirmed    UUID[] DEFAULT '{}',
  p_alphas       JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE (
  decision   TEXT,
  contact_id UUID,
  message    TEXT,
  candidates JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  same   RECORD;
  asks   JSONB;
  made   UUID;
  who    UUID;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Adding a company needs permission to edit the CRM.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;
  IF company_key(p_name) IS NULL THEN
    RAISE EXCEPTION
      '% is not a company name. It is punctuation, or a company suffix with no company in front of it.',
      COALESCE('"' || p_name || '"', 'A blank');
  END IF;

  /* Whatever a person has already settled goes down before anything is
     judged, so that the judgement below sees it. */
  FOREACH who IN ARRAY COALESCE(p_confirmed, '{}'::UUID[]) LOOP
    PERFORM crm_say_they_are_different(p_name, who, 'confirmed while adding the company');
  END LOOP;

  -- ---- 1. Is it already here? ----
  SELECT * INTO same
    FROM crm_identity_candidates(p_name, p_email, p_phone, p_alphas, NULL) c
   WHERE c.verdict = 'same'
   ORDER BY c.invoices DESC
   LIMIT 1;

  IF FOUND THEN
    IF p_list IS NOT NULL THEN
      INSERT INTO crm_list_contacts (list_id, contact_id)
      VALUES (p_list, same.contact_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN QUERY SELECT
      'joined'::TEXT,
      same.contact_id,
      format('%s is already in the CRM as "%s", because %s. That record is on this list now and nothing new was made.',
             p_name, same.company_name, same.because),
      '[]'::JSONB;
    RETURN;
  END IF;

  -- ---- 2. Is there anything a person has to look at? ----
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::JSONB) INTO asks
    FROM crm_identity_candidates(p_name, p_email, p_phone, p_alphas, NULL) c
   WHERE c.verdict = 'maybe' AND NOT c.settled;

  IF jsonb_array_length(asks) > 0 THEN
    RETURN QUERY SELECT
      'confirm'::TEXT,
      NULL::UUID,
      format('%s of the records already here could be this company. Say which before it is created.',
             jsonb_array_length(asks)),
      asks;
    RETURN;
  END IF;

  -- ---- 3. Nothing else is this company. ----
  INSERT INTO crm_contacts (
    company_name, contact_name, email, phone, location,
    relationship, source, status, assigned_to)
  VALUES (
    BTRIM(p_name), NULLIF(BTRIM(p_contact_name), ''), NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(p_phone), ''), NULLIF(BTRIM(p_location), ''),
    COALESCE(p_relationship, 'prospect'), COALESCE(p_source, 'manual'),
    'lead', NULLIF(BTRIM(p_assigned_to), ''))
  RETURNING id INTO made;

  IF p_list IS NOT NULL THEN
    INSERT INTO crm_list_contacts (list_id, contact_id) VALUES (p_list, made)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT
    'created'::TEXT, made,
    format('%s added. Nothing else in the CRM is this company.', BTRIM(p_name)),
    '[]'::JSONB;
END;
$fn$;

COMMENT ON FUNCTION crm_contact_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], JSONB) IS
  'The one way to add a company. Answers created, joined or confirm, and reports the '
  'records a person has to look at rather than throwing, so the screen can draw them. '
  'The table''s own trigger still refuses anything that ignores the answer.';

REVOKE ALL ON FUNCTION crm_contact_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_contact_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], JSONB) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'there is one way to add a company, and it asks before it makes a second one';
END $$;

-- =============================================================
-- FINDING THE COMPANY, FOR EVERYTHING THAT USED TO GUESS
--
-- Five database functions created companies before this migration and
-- not one of them called `company_key`:
--
--   command_import_contacts            no check at all
--   make_customer_for_trailer          lower(btrim(name))
--   protean_allocate_invoicing_types   lower(btrim(name))
--   protean_make_customer              no check at all
--   protean_make_customer_for_work     no check at all
--
-- They all call this now. It returns the one record the evidence says
-- is this company, or NULL. It never returns a `maybe`, because a
-- background job must not choose between two firms.
-- =============================================================
CREATE OR REPLACE FUNCTION crm_find_the_company(
  p_name TEXT, p_email TEXT DEFAULT NULL, p_alphas JSONB DEFAULT '[]'::JSONB)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT c.contact_id
    FROM crm_identity_candidates(p_name, p_email, NULL, p_alphas, NULL) c
   WHERE c.verdict = 'same'
   ORDER BY c.invoices DESC, c.company_name
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION crm_find_the_company(TEXT, TEXT, JSONB) IS
  'The record the evidence says is this company, or nothing. Never a maybe: a '
  'background job must not choose between two firms.';

REVOKE ALL ON FUNCTION crm_find_the_company(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_find_the_company(TEXT, TEXT, JSONB) TO authenticated;

-- =============================================================
-- THE ALLOCATION THAT MADE 413 RECORDS IN ONE RUN
--
-- On 21 September at 16:06 this function created 413 customer records
-- in 71 seconds. 17 of them already had a record in the CRM under a
-- name this matcher could not see: Stotts Tours Oldham against Stotts
-- Tours, Biffa Municipal Ltd against a record somebody had deleted
-- sixteen minutes earlier.
--
-- Three things were wrong and all three are fixed here:
--
--   1. `lower(BTRIM(name))` instead of the identity ladder, so anything
--      but a character for character match was a new company.
--
--   2. It CREATED on a miss, silently, with no name on the report of
--      which ones were new. The business's own words: "the whole task
--      end to end, migration to CURRENT ACCOUNTS ONLY". So it does not
--      create any more unless it is asked to, and what it could not
--      place is returned by name instead of invented.
--
--   3. `ON CONFLICT DO UPDATE SET contact_id = EXCLUDED.contact_id`
--      overwrote a binding a person had made by hand. That is how a
--      record deleted on the Monday was back sixteen minutes later. A
--      site somebody has already bound is left exactly as it is.
-- =============================================================
DROP FUNCTION IF EXISTS protean_allocate_invoicing_types();
DROP FUNCTION IF EXISTS protean_allocate_invoicing_types(BOOLEAN);
CREATE OR REPLACE FUNCTION protean_allocate_invoicing_types(
  p_create_missing BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  placed          INTEGER,
  customers_made  INTEGER,
  no_name         INTEGER,
  left_for_a_human INTEGER,
  already_bound   INTEGER,
  value           NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  r      RECORD;
  who    UUID;
  held   UUID;
  n      INT;
  n_put  INT := 0;
  n_new  INT := 0;
  n_none INT := 0;
  n_wait INT := 0;
  n_kept INT := 0;
  total  NUMERIC := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Allocating cash sales needs permission to edit the CRM.';
  END IF;
  IF p_create_missing AND NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Creating the customers it cannot place needs permission to create CRM records.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  FOR r IN
    SELECT i.division, i.alpha, BTRIM(i.site_name) AS site,
           count(*) AS n, SUM(i.net) AS net
      FROM protean_invoices i
      JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha AND a.is_invoicing_type
     WHERE i.contact_id IS NULL
     GROUP BY i.division, i.alpha, BTRIM(i.site_name)
  LOOP
    IF r.site IS NULL OR r.site = '' THEN
      n_none := n_none + r.n;
      CONTINUE;
    END IF;

    /* A site a person has already said whose it is. Left alone, and the
       invoices go where that person said. */
    SELECT s.contact_id INTO held FROM protean_cash_sites s
     WHERE s.division = r.division AND s.alpha = r.alpha AND s.site_name = r.site;

    IF held IS NOT NULL THEN
      who := held;
      n_kept := n_kept + 1;
    ELSE
      who := crm_find_the_company(r.site);

      IF who IS NULL THEN
        IF NOT p_create_missing THEN
          /* Named rather than invented. */
          n_wait := n_wait + 1;
          CONTINUE;
        END IF;
        INSERT INTO crm_contacts (company_name, source, status, relationship)
        VALUES (r.site, 'protean', 'won', 'cash_only')
        RETURNING id INTO who;
        n_new := n_new + 1;
      END IF;

      INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id, bound_by, bound_at)
      VALUES (r.division, r.alpha, r.site, who, auth.uid(), NOW())
      ON CONFLICT (division, alpha, site_name) DO NOTHING;
    END IF;

    UPDATE protean_invoices i SET contact_id = who
     WHERE i.division = r.division AND i.alpha = r.alpha
       AND BTRIM(i.site_name) = r.site AND i.contact_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;

    n_put := n_put + n;
    total := total + COALESCE(r.net, 0);
  END LOOP;

  RETURN QUERY SELECT n_put, n_new, n_none, n_wait, n_kept, ROUND(total, 2);
END;
$fn$;

COMMENT ON FUNCTION protean_allocate_invoicing_types(BOOLEAN) IS
  'Puts cash sales on the customer whose site name is on the invoice, through the '
  'identity ladder. Creates nothing unless asked, never overwrites a binding a person '
  'made, and returns how many it left for a human rather than inventing them.';

REVOKE ALL ON FUNCTION protean_allocate_invoicing_types(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_allocate_invoicing_types(BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- And the queue it now produces instead of records.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_unplaced_cash_sites()
RETURNS TABLE (
  division   TEXT,
  alpha      TEXT,
  site_name  TEXT,
  invoices   INTEGER,
  net        NUMERIC,
  looks_like TEXT,
  looks_like_id UUID,
  because    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The unplaced cash sales need access to the CRM.';
  END IF;

  RETURN QUERY
  WITH waiting AS (
    SELECT i.division AS d, i.alpha AS a, BTRIM(i.site_name) AS s,
           count(*)::INTEGER AS n, ROUND(SUM(i.net), 2) AS money
      FROM protean_invoices i
      JOIN protean_accounts ac
        ON ac.division = i.division AND ac.alpha = i.alpha AND ac.is_invoicing_type
     WHERE i.contact_id IS NULL
       AND COALESCE(BTRIM(i.site_name), '') <> ''
     GROUP BY 1, 2, 3
  )
  SELECT w.d, w.a, w.s, w.n, w.money,
         guess.company_name, guess.contact_id, guess.because
    FROM waiting w
    LEFT JOIN LATERAL (
      SELECT c.company_name, c.contact_id, c.because
        FROM crm_identity_candidates(w.s, NULL, NULL, '[]'::JSONB, NULL) c
       WHERE c.verdict IN ('same', 'maybe')
       ORDER BY CASE c.verdict WHEN 'same' THEN 0 ELSE 1 END, c.invoices DESC
       LIMIT 1
    ) guess ON TRUE
   ORDER BY w.money DESC NULLS LAST;
END;
$fn$;

COMMENT ON FUNCTION protean_unplaced_cash_sites() IS
  'Cash sales nobody has said whose they are, with the CRM record each one looks like '
  'and why. What the allocation used to invent a company for.';

REVOKE ALL ON FUNCTION protean_unplaced_cash_sites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_unplaced_cash_sites() TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the allocation that made 413 records now names what it cannot place';
END $$;

-- =============================================================
-- THE IMPORT, WHICH NOW ASKS BEFORE IT WRITES
--
-- From the business:
--
--   when importing it must reject accounts that are similar to others
--   and confirm whether to merge or create new (which is does now but
--   clearly it's unwired)
--
-- It was unwired in the most literal way. `lib/import/plan.ts` worked
-- the duplicates out IN THE BROWSER, from a list of existing rows it
-- had been handed, using `fold()`, which is lowercase and punctuation
-- and nothing else. Then `command_import_contacts` built a raw INSERT
-- per row and ran it, having never asked anything. The review screen
-- and the import were two different pieces of software agreeing by
-- coincidence.
--
-- Now there is one pass over the rows, in the database, against the
-- same ladder everything else uses, and it happens BEFORE anything is
-- written:
--
--   same, and nothing said      the existing record joins the list.
--                               No second record, no question.
--   maybe, and nothing said     the whole import stops and reports
--                               every row like it, with the record it
--                               looks like and why.
--   a decision for that row     carried out: attach to that record, or
--                               create having recorded that they are
--                               two different firms.
--
-- Nothing is written until every row has an answer, which is the same
-- all or nothing rule migration 026 gave it.
-- =============================================================
DROP FUNCTION IF EXISTS command_import_contacts(JSONB, TEXT, UUID);
DROP FUNCTION IF EXISTS command_import_contacts(JSONB, TEXT, UUID, JSONB);
CREATE OR REPLACE FUNCTION command_import_contacts(
  p_rows JSONB, p_list TEXT DEFAULT NULL, p_list_id UUID DEFAULT NULL,
  p_decisions JSONB DEFAULT '[]'::JSONB)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  list     UUID;
  matches  INTEGER;
  names    TEXT;
  wanted   INTEGER;
  made     INTEGER := 0;
  joined   INTEGER := 0;
  row_in   JSONB;
  allowed  TEXT[];
  columns  TEXT[];
  values   TEXT[];
  key      TEXT;
  stmt     TEXT;
  fresh    UUID;
  ids      UUID[] := ARRAY[]::UUID[];
  i        INTEGER;
  nm       TEXT;
  em       TEXT;
  ph       TEXT;
  said     JSONB;
  hit      UUID;
  asks     JSONB := '[]'::JSONB;
  plan     JSONB := '[]'::JSONB;
  other    UUID;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'you do not have crm.import';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'nothing said what to import';
  END IF;

  wanted := jsonb_array_length(p_rows);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'that file had no rows this could file under a company name';
  END IF;
  IF wanted > 5000 THEN
    RAISE EXCEPTION 'that is % rows, which is more than 5000. Split the file and import it in parts', wanted;
  END IF;

  IF p_list_id IS NOT NULL THEN
    SELECT id INTO list FROM crm_lists WHERE id = p_list_id;
    IF list IS NULL THEN
      RAISE EXCEPTION 'that list is not there';
    END IF;
  ELSIF COALESCE(btrim(p_list), '') <> '' THEN
    SELECT COUNT(*) INTO matches FROM crm_lists WHERE name ILIKE btrim(p_list);
    IF matches = 0 THEN
      RAISE EXCEPTION 'there is no list called %', p_list;
    END IF;
    IF matches > 1 THEN
      SELECT string_agg(name, ', ') INTO names FROM crm_lists WHERE name ILIKE btrim(p_list);
      RAISE EXCEPTION
        '% lists match %, so it is not clear which one: %', matches, p_list, names;
    END IF;
    SELECT id INTO list FROM crm_lists WHERE name ILIKE btrim(p_list);
  ELSE
    SELECT COUNT(*) INTO matches FROM crm_lists WHERE is_global = TRUE;
    IF matches = 0 THEN
      RAISE EXCEPTION 'there is no global list for imported customers to go on';
    END IF;
    IF matches > 1 THEN
      RAISE EXCEPTION 'there is more than one global list, so it is not clear where these go';
    END IF;
    SELECT id INTO list FROM crm_lists WHERE is_global = TRUE;
  END IF;

  -- ---------------------------------------------------------
  -- PASS ONE. Judge every row. Write nothing.
  -- ---------------------------------------------------------
  FOR i IN 0 .. wanted - 1 LOOP
    row_in := p_rows -> i;
    nm := btrim(COALESCE(row_in ->> 'company_name', ''));
    em := row_in ->> 'email';
    ph := row_in ->> 'phone';

    IF nm = '' THEN
      RAISE EXCEPTION 'a row with no company name reached the database; nothing has been imported';
    END IF;
    IF company_key(nm) IS NULL THEN
      RAISE EXCEPTION
        'row % is called "%", which is punctuation or a company suffix with no company in front of it; nothing has been imported',
        i + 1, nm;
    END IF;

    SELECT d INTO said FROM jsonb_array_elements(COALESCE(p_decisions, '[]'::JSONB)) d
     WHERE (d ->> 'row')::INTEGER = i LIMIT 1;

    /* A person said attach this row to that record. */
    IF said IS NOT NULL AND said ->> 'action' = 'attach' THEN
      plan := plan || jsonb_build_object('row', i, 'do', 'attach', 'id', said ->> 'contact_id');
      CONTINUE;
    END IF;

    /* Already here on the evidence. Joined, never duplicated, and no
       question asked: there is nothing for a person to decide. */
    hit := crm_find_the_company(nm, em);
    IF hit IS NOT NULL THEN
      plan := plan || jsonb_build_object('row', i, 'do', 'attach', 'id', hit);
      CONTINUE;
    END IF;

    /* A person said create it, and named what it is not. */
    IF said IS NOT NULL AND said ->> 'action' = 'create' THEN
      plan := plan || jsonb_build_object('row', i, 'do', 'create',
                                         'different_from', COALESCE(said -> 'different_from', '[]'::JSONB));
      CONTINUE;
    END IF;

    /* Anything left that looks like something is a question. */
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::JSONB) INTO said
      FROM crm_identity_candidates(nm, em, ph, '[]'::JSONB, NULL) c
     WHERE c.verdict = 'maybe' AND NOT c.settled;

    IF jsonb_array_length(said) > 0 THEN
      asks := asks || jsonb_build_object('row', i, 'company_name', nm, 'candidates', said);
    ELSE
      plan := plan || jsonb_build_object('row', i, 'do', 'create', 'different_from', '[]'::JSONB);
    END IF;
  END LOOP;

  IF jsonb_array_length(asks) > 0 THEN
    RETURN jsonb_build_object(
      'needs', asks, 'inserted', 0, 'attached', 0, 'listId', list, 'ids', '[]'::JSONB,
      'message', format('%s of the %s rows look like companies already in the CRM. Say which before any of it is imported.',
                        jsonb_array_length(asks), wanted));
  END IF;

  -- ---------------------------------------------------------
  -- PASS TWO. Carry the plan out, all of it or none.
  -- ---------------------------------------------------------
  SELECT array_agg(column_name) INTO allowed
    FROM command_writable_columns WHERE table_name = 'crm_contacts';
  allowed := allowed || ARRAY['list_id', 'links'];

  FOR i IN 0 .. jsonb_array_length(plan) - 1 LOOP
    said   := plan -> i;
    row_in := p_rows -> (said ->> 'row')::INTEGER;

    IF said ->> 'do' = 'attach' THEN
      INSERT INTO crm_list_contacts (list_id, contact_id)
      VALUES (list, (said ->> 'id')::UUID)
      ON CONFLICT DO NOTHING;
      ids := ids || (said ->> 'id')::UUID;
      joined := joined + 1;
      CONTINUE;
    END IF;

    /* Everything a person called a different firm goes down first, so
       the table's own refusal sees it. */
    FOR other IN SELECT (value #>> '{}')::UUID FROM jsonb_array_elements(said -> 'different_from') LOOP
      PERFORM crm_say_they_are_different(
        row_in ->> 'company_name', other, 'confirmed during an import');
    END LOOP;

    columns := ARRAY['list_id'];
    values  := ARRAY[quote_literal(list)];

    FOR key IN SELECT jsonb_object_keys(row_in)
    LOOP
      IF NOT (key = ANY(allowed)) THEN
        RAISE EXCEPTION 'the import tried to write %, which is not a column it may write', key;
      END IF;
      IF key = 'list_id' THEN CONTINUE; END IF;

      columns := columns || key;
      values := values || CASE
        WHEN jsonb_typeof(row_in -> key) IN ('object', 'array')
          THEN quote_literal(row_in -> key) || '::JSONB'
        WHEN jsonb_typeof(row_in -> key) = 'null' THEN 'NULL'
        ELSE quote_literal(row_in ->> key)
      END;
    END LOOP;

    stmt := format('INSERT INTO crm_contacts (%s) VALUES (%s) RETURNING id',
      array_to_string(ARRAY(SELECT quote_ident(c) FROM unnest(columns) AS c), ', '),
      array_to_string(values, ', '));
    EXECUTE stmt INTO fresh;
    ids := ids || fresh;
    made := made + 1;
  END LOOP;

  IF made + joined <> wanted THEN
    RAISE EXCEPTION
      'expected to account for % rows but accounted for %; nothing has been changed',
      wanted, made + joined;
  END IF;

  RETURN jsonb_build_object(
    'inserted', made, 'attached', joined, 'listId', list,
    'ids', to_jsonb(ids), 'needs', '[]'::JSONB,
    'message', format('%s added, %s already in the CRM and now on this list.', made, joined));
END;
$fn$;

DO $$ BEGIN
  RAISE NOTICE 'the import asks before it writes, and asks the same question everything else asks';
END $$;

-- =============================================================
-- THE OTHER THREE CREATORS
--
-- Same change to each: find through the ladder, and where the ladder
-- finds the company, use that record instead of making a second one.
-- Bodies otherwise unchanged from migrations 077, 086 and 092.
-- =============================================================
CREATE OR REPLACE FUNCTION public.make_customer_for_trailer(
  p_name TEXT, p_contact UUID DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  name  TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  made  UUID;
  moved INTEGER := 0;
  bound INTEGER := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Making a customer needs permission to edit the CRM.';
  END IF;
  IF name IS NULL THEN
    RAISE EXCEPTION 'A customer needs a name.';
  END IF;
  IF company_key(name) IS NULL THEN
    RAISE EXCEPTION '"%" is not a company name.', name;
  END IF;

  made := crm_find_the_company(name);

  IF made IS NULL THEN
    INSERT INTO crm_contacts (company_name, source, status)
    VALUES (name, 'trailer_sales', 'won')
    RETURNING id INTO made;
  END IF;

  UPDATE stock_trailers SET contact_id = made
   WHERE contact_id IS NULL AND lower(btrim(customer)) = lower(name);
  GET DIAGNOSTICS moved = ROW_COUNT;

  UPDATE protean_accounts SET contact_id = made
   WHERE contact_id IS NULL
     AND division = 'trailer'
     AND lower(btrim(protean_name)) = lower(name);
  GET DIAGNOSTICS bound = ROW_COUNT;

  PERFORM audit('update', 'crm_contacts', made, name,
                jsonb_build_object('from', 'trailer sales',
                                   'trailers_linked', moved,
                                   'accounts_linked', bound));

  RETURN made;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.protean_make_customer(
  p_division TEXT, p_alpha TEXT, p_name TEXT DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE acc RECORD; made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;

  SELECT * INTO acc FROM protean_accounts
   WHERE division = p_division AND alpha = p_alpha;
  IF acc.alpha IS NULL THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;
  IF acc.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'That account is already a customer in the CRM.';
  END IF;

  clean := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), acc.protean_name);

  /* The account code being opened is evidence about who this is, so it
     is passed in: if some other record already holds it, this is that
     record and not a new one. */
  made := crm_find_the_company(
    clean, NULL,
    jsonb_build_array(jsonb_build_object('division', p_division, 'alpha', p_alpha)));

  IF made IS NULL THEN
    INSERT INTO crm_contacts (company_name, source, status, relationship)
    VALUES (clean, 'protean', 'won', 'existing')
    RETURNING id INTO made;
  END IF;

  PERFORM protean_bind(p_division, p_alpha, made);
  RETURN made;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.protean_make_customer_for_work(
  p_division TEXT, p_name TEXT)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;
  clean := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF clean IS NULL THEN
    RAISE EXCEPTION 'That work has no customer name on it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs
                  WHERE division = p_division
                    AND lower(btrim(protean_name)) = lower(clean)
                    AND alpha IS NULL AND contact_id IS NULL AND still_open) THEN
    RAISE EXCEPTION 'No unplaced % work is under that name.', p_division;
  END IF;

  made := crm_find_the_company(clean);

  IF made IS NULL THEN
    INSERT INTO crm_contacts (company_name, source, status, relationship)
    VALUES (clean, 'protean', 'won', 'existing')
    RETURNING id INTO made;
  END IF;

  PERFORM protean_place_open_work(p_division, clean, made);
  RETURN made;
END;
$fn$;

-- =============================================================
-- WHAT IS ALREADY HERE
--
-- The refusal is about new records. It says nothing about the 30 pairs
-- that were put here before it existed, and merging those is a decision
-- with money on it, so it is a report and not a migration.
-- =============================================================
CREATE OR REPLACE FUNCTION crm_duplicates_here()
RETURNS TABLE (
  a_id UUID, a_name TEXT, a_invoices INTEGER, a_spend NUMERIC, a_leads INTEGER,
  b_id UUID, b_name TEXT, b_invoices INTEGER, b_spend NUMERIC, b_leads INTEGER,
  verdict TEXT, because TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The duplicate report needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.id, a.company_name,
         (SELECT count(*)::INTEGER FROM protean_invoices i WHERE i.contact_id = a.id),
         (SELECT COALESCE(ROUND(SUM(i.net), 2), 0) FROM protean_invoices i WHERE i.contact_id = a.id),
         (SELECT count(*)::INTEGER FROM crm_leads l WHERE l.contact_id = a.id),
         c.contact_id, c.company_name, c.invoices, c.spend, c.leads,
         c.verdict, c.because
    FROM crm_contacts a
    JOIN LATERAL crm_identity_candidates(a.company_name, a.email, a.phone, '[]'::JSONB, a.id) c
      ON c.verdict IN ('same', 'maybe') AND NOT c.settled
   WHERE a.deleted_at IS NULL
     AND a.id < c.contact_id
   ORDER BY CASE c.verdict WHEN 'same' THEN 0 ELSE 1 END, 4 DESC;
END;
$fn$;

COMMENT ON FUNCTION crm_duplicates_here() IS
  'Every pair of live records the identity ladder says is one company, or might be, '
  'with the money and the leads on each side. A report, because merging two records '
  'with money on both is a decision and not a migration.';

REVOKE ALL ON FUNCTION crm_duplicates_here() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_duplicates_here() TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'every creator goes through the ladder, and what was already here is a report';
END $$;
