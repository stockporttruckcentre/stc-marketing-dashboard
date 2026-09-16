-- =============================================================
-- 120. Merging one CRM customer into another, recoverably.
--
-- From the agreed development scope, Task 5:
--
--   Do not build another duplicate-finder as the deliverable. Actually
--   clean the current duplicates. [...] Before deleting a duplicate,
--   move/preserve everything meaningful [...] The cleanup operation
--   must be recoverable/auditable. Do not use a destructive fuzzy-delete
--   loop.
--
-- And from the business, about two of them by name:
--
--   tk components is touchy as it has an open pending fleetsmart
--   contract that can't be affected to be careful with that merge.
--   check if mrk has one open too before doing that.
--
-- ---- Every relationship, found rather than listed ----
--
-- The tables that point at a customer are read out of
-- `pg_constraint` at run time, so a table added next year is moved by
-- this function without anybody remembering to come here. A hand
-- written list is how a merge leaves a customer's meetings behind.
--
-- ---- Nothing is deleted ----
--
-- The duplicate is SOFT deleted, through the same `soft_delete` the
-- rest of the application uses, so it stays readable and restorable. A
-- snapshot of the whole row goes in `crm_merges` beside a count of
-- everything that moved, so the merge can be described afterwards
-- without reading the audit log sideways.
-- =============================================================

CREATE TABLE IF NOT EXISTS crm_merges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id   UUID NOT NULL REFERENCES crm_contacts(id),
  canonical_name TEXT,
  merged_id      UUID NOT NULL,
  merged_name    TEXT,
  /* table.column -> how many rows moved. */
  moved          JSONB NOT NULL DEFAULT '{}'::JSONB,
  /* Which blank fields on the canonical record were filled in, and with
     what. Written down because "we filled in the phone number" is the
     part somebody queries a year later. */
  filled         JSONB NOT NULL DEFAULT '{}'::JSONB,
  /* Anything the merge would not do on its own. */
  warnings       TEXT[] NOT NULL DEFAULT '{}',
  /* The whole duplicate row as it stood, so this is recoverable from
     one place rather than from a reconstruction. */
  snapshot       JSONB,
  merged_by      UUID REFERENCES profiles(id),
  merged_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE crm_merges IS
  'One row per customer merge. What moved, what was filled in, what was flagged, and the '
  'whole duplicate row as it stood. The duplicate itself is soft deleted, never dropped.';

ALTER TABLE crm_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "merges_read" ON crm_merges;
CREATE POLICY "merges_read" ON crm_merges
  FOR SELECT USING (command_may('crm.view'));
GRANT SELECT ON crm_merges TO authenticated;

-- -------------------------------------------------------------
-- Every column in the database that points at a customer.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_customer_references();
CREATE OR REPLACE FUNCTION crm_customer_references()
RETURNS TABLE (table_name TEXT, column_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT c.conrelid::regclass::TEXT, a.attname::TEXT
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE c.contype = 'f'
     AND c.confrelid = 'crm_contacts'::regclass
     /* The self reference is handled separately: a duplicate that is
        somebody's parent has its children re-parented, and a duplicate
        whose parent is the canonical record simply stops existing. */
     AND c.conrelid <> 'crm_contacts'::regclass
     /* ---- And the record of the merges themselves is not moved ----

        `crm_merges.canonical_id` points at a customer, so finding the
        references generically picks it up. Moving it would rewrite
        history: if B was merged into A and A is later merged into C,
        rewriting the first record makes it say B was merged into C,
        which never happened. An audit trail that gets tidied up by
        later events is not an audit trail. */
     AND c.conrelid <> 'crm_merges'::regclass
   ORDER BY 1, 2;
$fn$;

REVOKE ALL ON FUNCTION crm_customer_references() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_customer_references() TO authenticated;

-- -------------------------------------------------------------
-- What a merge WOULD do. Writes nothing.
--
-- The scope asks for the cleanup to be provable before it happens, and
-- the business has asked for one of these to be handled carefully
-- because of a live contract. So this is the thing to run first, and it
-- is the thing the read back file hands over.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_merge_preview(UUID, UUID);
CREATE OR REPLACE FUNCTION crm_merge_preview(p_canonical UUID, p_duplicate UUID)
RETURNS TABLE (what TEXT, detail TEXT, rows_affected INT, needs_a_human BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      RECORD;
  n      INT;
  a_name TEXT;
  b_name TEXT;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Looking at a merge needs access to the CRM.';
  END IF;

  SELECT company_name INTO a_name FROM crm_contacts WHERE id = p_canonical;
  SELECT company_name INTO b_name FROM crm_contacts WHERE id = p_duplicate;

  IF a_name IS NULL THEN
    RETURN QUERY SELECT 'refused'::TEXT,
      'There is no customer with the canonical id given.'::TEXT, 0, TRUE;
    RETURN;
  END IF;
  IF b_name IS NULL THEN
    RETURN QUERY SELECT 'refused'::TEXT,
      'There is no customer with the duplicate id given.'::TEXT, 0, TRUE;
    RETURN;
  END IF;
  IF p_canonical = p_duplicate THEN
    RETURN QUERY SELECT 'refused'::TEXT,
      'The two ids are the same customer.'::TEXT, 0, TRUE;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'keeping'::TEXT, a_name, 0, FALSE;
  RETURN QUERY SELECT 'merging in'::TEXT, b_name, 0, FALSE;

  /* ---- What moves ---- */
  FOR r IN SELECT * FROM crm_customer_references() LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE %I = $1', r.table_name, r.column_name)
      INTO n USING p_duplicate;
    IF n > 0 THEN
      RETURN QUERY SELECT 'moves'::TEXT,
        format('%s rows on %s.%s', n, r.table_name, r.column_name), n, FALSE;
    END IF;
  END LOOP;

  /* ---- The two the business asked about by name ----

     A FleetSmart contract that has been sent and not yet decided is a
     price somebody is holding STC to. Moving which customer it belongs
     to does not change it, and this merge never touches its status, but
     it is flagged so nobody runs the merge without knowing it is there.

     Two live contracts landing on one customer is a different matter,
     and that one needs a person: it is the Gold and Platinum case in
     Task 8, and picking for them here would be exactly the guess this
     function exists to avoid. */
  SELECT COUNT(*) INTO n FROM fleetsmart_contracts
   WHERE account_id IN (p_canonical, p_duplicate)
     AND COALESCE(status, '') NOT IN ('declined', 'withdrawn', 'expired');
  IF n > 0 THEN
    RETURN QUERY SELECT 'fleetsmart'::TEXT,
      format('%s contract(s) not declined across the two. The merge moves them and changes '
             'no status. Check what they are before running it.', n), n, n > 1;
  END IF;

  /* A superseded or withdrawn card is history and not a second truth.
     What matters is how many LIVE cards the pair holds between them. */
  SELECT COUNT(*) INTO n FROM rate_cards
   WHERE contact_id IN (p_canonical, p_duplicate)
     AND status NOT IN ('superseded', 'withdrawn');
  IF n > 1 THEN
    RETURN QUERY SELECT 'rate cards'::TEXT,
      format('%s rate cards across the two. A customer is meant to hold one, so a person '
             'decides which survives. The merge moves them and supersedes nothing.', n), n, TRUE;
  END IF;

  /* ---- What would be filled in ----

     Only where the canonical record is blank. The scope: "Do not
     overwrite a better canonical value with an older blank/stale
     value." */
  FOR r IN
    SELECT k AS field
      FROM unnest(ARRAY['contact_name', 'email', 'phone', 'address', 'location',
                        'notes', 'account_manager', 'assigned_to', 'category']) AS k
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM crm_contacts a, crm_contacts b '
      'WHERE a.id = $1 AND b.id = $2 '
      '  AND COALESCE(BTRIM(a.%I::TEXT), '''') = '''' '
      '  AND COALESCE(BTRIM(b.%I::TEXT), '''') <> ''''', r.field, r.field)
      INTO n USING p_canonical, p_duplicate;
    IF n > 0 THEN
      RETURN QUERY SELECT 'fills in'::TEXT,
        format('%s is blank on the record being kept and set on the duplicate', r.field), 1, FALSE;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_merge_preview(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_merge_preview(UUID, UUID) TO authenticated;

-- -------------------------------------------------------------
-- Doing it.
--
-- Everything moves, the duplicate is soft deleted, and one row records
-- what happened. Nothing is dropped and no status on any contract is
-- touched.
--
-- `p_force` is for the two cases the preview marks as needing a human:
-- more than one live FleetSmart contract, or more than one rate card,
-- across the pair. Without it the merge refuses those and says why.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_merge(
  p_canonical UUID,
  p_duplicate UUID,
  p_force     BOOLEAN DEFAULT FALSE
)
RETURNS crm_merges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r        RECORD;
  n        INT;
  moved    JSONB := '{}'::JSONB;
  filled   JSONB := '{}'::JSONB;
  warns    TEXT[] := '{}';
  snap     JSONB;
  a_name   TEXT;
  b_name   TEXT;
  result   crm_merges;
  field    TEXT;
  newval   TEXT;
BEGIN
  /* Merging customers is not a read. It is the same authority as
     deleting one, because that is what it does to the duplicate. */
  IF NOT command_may('crm.delete') THEN
    RAISE EXCEPTION
      'Merging two customers needs the right to delete one. Ask an administrator.';
  END IF;

  IF p_canonical = p_duplicate THEN
    RAISE EXCEPTION 'Those are the same customer.';
  END IF;

  SELECT company_name INTO a_name FROM crm_contacts WHERE id = p_canonical AND deleted_at IS NULL;
  SELECT company_name INTO b_name FROM crm_contacts WHERE id = p_duplicate AND deleted_at IS NULL;
  IF a_name IS NULL THEN RAISE EXCEPTION 'The customer to keep does not exist, or is deleted.'; END IF;
  IF b_name IS NULL THEN RAISE EXCEPTION 'The customer to merge in does not exist, or is deleted.'; END IF;

  /* ---- The two the preview flags, refused unless forced ---- */
  SELECT COUNT(*) INTO n FROM fleetsmart_contracts
   WHERE account_id IN (p_canonical, p_duplicate)
     AND COALESCE(status, '') NOT IN ('declined', 'withdrawn', 'expired');
  IF n > 1 AND NOT p_force THEN
    RAISE EXCEPTION
      'These two customers have % FleetSmart contracts between them that are not declined. '
      'Merging would put them both on one customer, and which one is right is not a decision '
      'this function should make. Look at them, then call this again with p_force.', n;
  END IF;
  IF n > 0 THEN
    warns := warns || format('%s live FleetSmart contract(s) moved. No status was changed.', n);
  END IF;

  SELECT COUNT(*) INTO n FROM rate_cards
   WHERE contact_id IN (p_canonical, p_duplicate)
     AND status NOT IN ('superseded', 'withdrawn');
  IF n > 1 AND NOT p_force THEN
    RAISE EXCEPTION
      'These two customers have % rate cards between them. A customer is meant to hold one. '
      'Decide which survives, then call this again with p_force.', n;
  END IF;
  IF n > 1 THEN
    warns := warns || format('%s rate cards now sit on one customer. Nothing was superseded.', n);
  END IF;

  /* ---- The duplicate, whole, before anything happens to it ---- */
  SELECT to_jsonb(c) INTO snap FROM crm_contacts c WHERE c.id = p_duplicate;

  /* ---- Move every reference, found rather than listed ---- */
  FOR r IN SELECT * FROM crm_customer_references() LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.table_name, r.column_name, r.column_name)
      USING p_canonical, p_duplicate;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      moved := moved || jsonb_build_object(format('%s.%s', r.table_name, r.column_name), n);
    END IF;
  END LOOP;

  /* ---- Anything that was the duplicate's child becomes the canonical's ---- */
  UPDATE crm_contacts SET parent_customer_id = p_canonical
   WHERE parent_customer_id = p_duplicate AND id <> p_canonical;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN moved := moved || jsonb_build_object('crm_contacts.parent_customer_id', n); END IF;

  /* And the canonical record must never end up its own parent. */
  UPDATE crm_contacts SET parent_customer_id = NULL
   WHERE id = p_canonical AND parent_customer_id IN (p_canonical, p_duplicate);

  /* ---- Fill in what is blank, and only what is blank ---- */
  FOREACH field IN ARRAY ARRAY['contact_name', 'email', 'phone', 'address', 'location',
                               'notes', 'account_manager', 'assigned_to', 'category'] LOOP
    EXECUTE format(
      'UPDATE crm_contacts a SET %I = b.%I FROM crm_contacts b '
      'WHERE a.id = $1 AND b.id = $2 '
      '  AND COALESCE(BTRIM(a.%I::TEXT), '''') = '''' '
      '  AND COALESCE(BTRIM(b.%I::TEXT), '''') <> '''' '
      'RETURNING a.%I::TEXT', field, field, field, field, field)
      INTO newval USING p_canonical, p_duplicate;
    IF newval IS NOT NULL THEN
      filled := filled || jsonb_build_object(field, newval);
    END IF;
  END LOOP;

  /* ---- The duplicate goes quiet, and stays readable ----

     Soft, through the shared function, so it lands in the audit trail
     and an administrator can put it back. Its name is stamped so the
     row says what happened to it without anybody joining to find out. */
  UPDATE crm_contacts
     SET company_name = company_name || ' (merged into ' || a_name || ')'
   WHERE id = p_duplicate;

  PERFORM soft_delete('crm_contacts', p_duplicate,
    format('Merged into %s.', a_name));

  INSERT INTO crm_merges (canonical_id, canonical_name, merged_id, merged_name,
                          moved, filled, warnings, snapshot, merged_by)
  VALUES (p_canonical, a_name, p_duplicate, b_name,
          moved, filled, warns, snap, current_actor())
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_merge(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_merge(UUID, UUID, BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- Proving it afterwards.
--
-- From the scope: "prove all dependent references have been moved [...]
-- prove no orphaned references remain".
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_merge_leftovers(UUID);
CREATE OR REPLACE FUNCTION crm_merge_leftovers(p_merged UUID)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_left INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r RECORD; n INT;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Checking a merge needs access to the CRM.';
  END IF;

  FOR r IN SELECT * FROM crm_customer_references() LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE %I = $1', r.table_name, r.column_name)
      INTO n USING p_merged;
    IF n > 0 THEN
      RETURN QUERY SELECT r.table_name, r.column_name, n;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_merge_leftovers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_merge_leftovers(UUID) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'a merge moves everything, records itself, and deletes nothing'; END $$;

-- -------------------------------------------------------------
-- Merging a pair without having to work out which one to keep.
--
-- From the business, about the ones they confirmed:
--
--   needs merging into the account with the most action
--
-- and from the scope:
--
--   Where the match is proven, the Protean-bound CRM company should
--   normally be the canonical record.
--
-- Those two can disagree, so the order between them is written down
-- here rather than decided case by case:
--
--   1. The one Protean is bound to. If only one of the pair has a
--      binding, that is the record the money arrives against and it
--      wins, whatever else is on the other one. Nothing is lost by
--      this: everything on the other record moves across.
--   2. Otherwise the one with more hanging off it, counted across
--      every relationship there is.
--   3. Otherwise the older record, because it is the one other people
--      have had longer to link things to.
--
-- It returns which it chose and why, so the choice is reviewable
-- afterwards rather than buried.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_merge_pair(UUID, UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION crm_merge_pair(p_one UUID, p_other UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS TABLE (kept TEXT, merged TEXT, because TEXT, moved JSONB, warnings TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r           RECORD;
  one_bound   INT;
  other_bound INT;
  one_weight  INT;
  other_weight INT;
  one_made    TIMESTAMPTZ;
  other_made  TIMESTAMPTZ;
  keep_id     UUID;
  drop_id     UUID;
  why         TEXT;
  done        crm_merges;
BEGIN
  SELECT COUNT(*) INTO one_bound   FROM protean_accounts WHERE contact_id = p_one   AND NOT ignored;
  SELECT COUNT(*) INTO other_bound FROM protean_accounts WHERE contact_id = p_other AND NOT ignored;

  SELECT COALESCE(SUM(c), 0) INTO one_weight FROM (
    SELECT (SELECT COUNT(*) FROM crm_leads WHERE contact_id = p_one) AS c
    UNION ALL SELECT (SELECT COUNT(*) FROM contact_notes     WHERE contact_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM contact_addresses WHERE contact_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM calendar_events   WHERE contact_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM tasks             WHERE organisation_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM fleetsmart_contracts WHERE account_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM rate_cards        WHERE contact_id = p_one)
    UNION ALL SELECT (SELECT COUNT(*) FROM stock_trailers    WHERE contact_id = p_one)
  ) x;

  SELECT COALESCE(SUM(c), 0) INTO other_weight FROM (
    SELECT (SELECT COUNT(*) FROM crm_leads WHERE contact_id = p_other) AS c
    UNION ALL SELECT (SELECT COUNT(*) FROM contact_notes     WHERE contact_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM contact_addresses WHERE contact_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM calendar_events   WHERE contact_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM tasks             WHERE organisation_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM fleetsmart_contracts WHERE account_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM rate_cards        WHERE contact_id = p_other)
    UNION ALL SELECT (SELECT COUNT(*) FROM stock_trailers    WHERE contact_id = p_other)
  ) x;

  SELECT created_at INTO one_made   FROM crm_contacts WHERE id = p_one;
  SELECT created_at INTO other_made FROM crm_contacts WHERE id = p_other;

  IF one_bound > 0 AND other_bound = 0 THEN
    keep_id := p_one; drop_id := p_other; why := 'Protean is bound to it and not to the other';
  ELSIF other_bound > 0 AND one_bound = 0 THEN
    keep_id := p_other; drop_id := p_one; why := 'Protean is bound to it and not to the other';
  ELSIF one_weight <> other_weight THEN
    IF one_weight > other_weight THEN keep_id := p_one; drop_id := p_other;
    ELSE keep_id := p_other; drop_id := p_one; END IF;
    why := format('more on it: %s against %s', GREATEST(one_weight, other_weight),
                  LEAST(one_weight, other_weight));
  ELSE
    IF COALESCE(one_made, NOW()) <= COALESCE(other_made, NOW()) THEN
      keep_id := p_one; drop_id := p_other;
    ELSE keep_id := p_other; drop_id := p_one; END IF;
    why := 'nothing to choose between them, so the older record';
  END IF;

  SELECT * INTO done FROM crm_merge(keep_id, drop_id, p_force);

  RETURN QUERY SELECT done.canonical_name, done.merged_name, why, done.moved, done.warnings;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_merge_pair(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_merge_pair(UUID, UUID, BOOLEAN) TO authenticated;
