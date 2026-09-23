-- =============================================================
-- 147. EVERY TRACKER ENTRY, ON THE CUSTOMER'S OWN RECORD.
--
-- From the business:
--
--   all tracker entries app-wide should show at the top of a customer's
--   CRM tab. Currently it says searching for open work, but it never
--   finds any. Not finding leads or contracts or open trailer sales
--   stuff, etc.
--
-- ---- Why it found nothing ----
--
-- The screen asked one question: `crm_leads WHERE contact_id = this`.
-- That is the right question for a lead RAISED on the record. It is the
-- wrong question for most of what is actually on the trackers, because
-- `crm_leads.contact_id` is NULLABLE (migration 040, line 102) and
-- three things routinely leave it empty:
--
--   * an import, which writes a company NAME and no account
--   * a lead raised before the customer existed as a record
--   * a lead whose customer was later merged away, so its `contact_id`
--     points at a record that is no longer the live one
--
-- `lib/crm/lead-identity.ts` already names the first of those: "three
-- states, not two: an account, no account with a name, and nothing at
-- all". The customer card was treating the second state as the third.
--
-- ---- AND THE SECOND STATE DID NOT EXIST, BECAUSE A TRIGGER ATE IT ----
--
-- `crm_lead_carries_its_company`, migration 040, keeps the company's
-- name on the lead in step with the record:
--
--   SELECT company_name INTO NEW.company_name
--     FROM crm_contacts WHERE id = NEW.contact_id;
--
-- In plpgsql a SELECT INTO that matches NO ROWS sets the target to
-- NULL. So on any lead with no `contact_id`, which is every lead raised
-- without a customer record and every lead an import writes by name,
-- this cleared the company name on the way in.
--
-- A tracker entry with no account and no name is not attached to
-- anything and cannot be attached to anything. That is the state the
-- CRM card was being asked to find, and it is why "it never finds any"
-- was not a display problem.
--
-- The trigger is fixed below. NAMES ALREADY LOST CANNOT BE RECOVERED
-- from these rows, because the only place the name was written is the
-- column that was emptied. Where a lead still has its stock unit or its
-- FleetSmart+ contract, the customer is reachable through those.
--
-- ---- What this finds ----
--
-- One function, four ways a tracker entry belongs to a customer:
--
--   1. it points straight at them
--   2. it points at a record that was MERGED into them
--   3. it points at a company twinned with them, which is how the same
--      business holds a sales account and a maintenance account
--   4. it points at nothing, and its company name reduces to the same
--      key as theirs, using the same `company_key` the Protean matching
--      already uses for exactly this
--
-- The fourth says so on the row, with `matched_by = 'name'`, because a
-- guess presented as a fact is how the last version of this went wrong.
--
-- It also carries what the deal IS rather than only its title: the
-- stock unit on a trailer sale, the FleetSmart+ contract behind a
-- maintenance deal, and whose tracker it sits on. "Not finding leads or
-- contracts or open trailer sales stuff" is one list, not three.
--
-- ---- WHO SEES WHAT, IN THREE TIERS ----
--
-- From the business, asked directly:
--
--   yes everyone can see open deals but only sales/bd/md/dev roles can
--   see the value of those deals at the top of the crm drawer, others
--   just see there's a lead and what the lead is for but cannot click
--   in to it. Only people with access to click in to that lead are able
--   to (so sr sales who can see others' trackers and leads, BD, MD,
--   dev, the person who owns the lead)
--
-- So three answers, not one:
--
--   THAT it exists   anybody who may open the CRM at all. Every entry
--                    on the customer, whoever owns it.
--   WHAT it is worth `crm.dealValues`, added below. Without it the
--                    figures come back NULL from the DATABASE, not
--                    blanked by the browser: a number the browser never
--                    receives is a number nobody can read off the page.
--   OPENING it       the person who owns it, anybody it is shared with,
--                    or `crm.viewOthers`. Reported as `may_open` so the
--                    screen offers the button to exactly the people the
--                    lead itself would let in.
--
-- That is why this is SECURITY DEFINER and gated on `crm.view` rather
-- than SECURITY INVOKER: `leads_select` hides other people's rows
-- outright, which is right for the tracker and wrong here, where the
-- instruction is that everybody sees a deal exists. The redaction above
-- is what replaces it, and it is stricter about the figures than the
-- tracker's policy ever was.
-- =============================================================

-- -------------------------------------------------------------
-- The capability that decides whether the figures come back.
--
-- `crm.dealValues` itself is declared in migration 053, which IS the
-- register, and granted by migration 103, which is generated from
-- `lib/platform/permissions/roles.ts`. Neither can be written here:
-- 103 refuses to grant a capability the register has not declared, and
-- it runs before this file.
--
-- It is in `SALES_DOES`, which is what sales, Sr Sales and Business
-- Development are built from, and in `EVERYTHING`, which is the
-- administrator, the developer and the managing director. That is the
-- six the business named. Marketing and the office administrators keep
-- the CRM and do not get the money.
--
-- Two things belong here, both about accounts the eleven roles do not
-- cover.
--
-- The `administrator` template predates them and is still on accounts.
-- It holds every other CRM capability including `crm.viewOthers`, so
-- withholding this one would leave an administrator able to open
-- somebody's deal and unable to see what it is worth.
--
-- And the legacy role column, for an account on no template at all.
-- -------------------------------------------------------------
INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT t.id, 'crm.dealValues', 'company'
  FROM role_templates t
 WHERE t.slug = 'administrator'
ON CONFLICT DO NOTHING;

INSERT INTO command_capability_roles (capability, role)
SELECT 'crm.dealValues', r FROM unnest(ARRAY['admin', 'sales']) r
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------
-- The trigger that emptied the name. One line: only take the name
-- from a record when there IS a record.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_lead_carries_its_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  /* A lead with no customer record keeps the name it was given. It used
     to lose it, because SELECT INTO with no rows writes NULL, and a
     tracker entry with neither an account nor a name cannot be found by
     anything. */
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_name INTO NEW.company_name
    FROM crm_contacts WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS customer_tracker_entries(UUID);
CREATE OR REPLACE FUNCTION customer_tracker_entries(p_contact UUID)
RETURNS TABLE (
  id              UUID,
  company_name    TEXT,
  type            TEXT,
  status          TEXT,
  what            TEXT,
  estimated_value NUMERIC,
  sale_price      NUMERIC,
  order_date      DATE,
  date_of_enquiry DATE,
  last_activity_at TIMESTAMPTZ,
  owner_id        UUID,
  owner_name      TEXT,
  stock_id        UUID,
  stock_no        TEXT,
  contract_id     UUID,
  contract_ref    TEXT,
  contract_status TEXT,
  matched_by      TEXT,
  may_open        BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH me AS (
    SELECT c.id, c.company_name, company_key(c.company_name) AS key
      FROM crm_contacts c
     WHERE c.id = p_contact
       /* The one gate on seeing anything at all. */
       AND command_may('crm.view')
  ),
  /* Every record that IS this customer: themselves, anything merged
     into them, and the twin they are linked to either way round. */
  family AS (
    SELECT id FROM me
    UNION
    SELECT m.merged_id FROM crm_merges m JOIN me ON m.canonical_id = me.id
    UNION
    SELECT c.id FROM crm_contacts c JOIN me ON c.parent_customer_id = me.id
    UNION
    SELECT c.parent_customer_id FROM crm_contacts c JOIN me ON c.id = me.id
     WHERE c.parent_customer_id IS NOT NULL
  ),
  mine AS (
    SELECT l.*, 'record'::TEXT AS how
      FROM crm_leads l
     WHERE l.contact_id IN (SELECT id FROM family WHERE id IS NOT NULL)

    UNION ALL

    /* Raised against a name and never bound to a record. Found the same
       way the Protean matching finds them, so the customer card and the
       revenue screen agree about who is who. */
    SELECT l.*, 'name'::TEXT
      FROM crm_leads l, me
     WHERE l.contact_id IS NULL
       AND me.key IS NOT NULL
       AND company_key(l.company_name) = me.key
  )
  SELECT DISTINCT ON (l.id)
         l.id,
         l.company_name,
         l.type,
         l.status,
         l.what,
         /* The figures, or nothing at all. Redacted here rather than in
            the browser: a number that never leaves the database cannot
            be read off the page by somebody who opens the inspector. */
         CASE WHEN command_may('crm.dealValues') THEN l.estimated_value END,
         CASE WHEN command_may('crm.dealValues') THEN l.sale_price      END,
         l.order_date,
         l.date_of_enquiry,
         l.last_activity_at,
         l.owner_id,
         COALESCE(p.full_name, p.email)                        AS owner_name,
         s.id                                                  AS stock_id,
         s.stc_no                                              AS stock_no,
         f.id                                                  AS contract_id,
         f.ref                                                 AS contract_ref,
         f.status                                              AS contract_status,
         l.how                                                 AS matched_by,
         /* Exactly who the lead itself would let in. */
         (l.owner_id = auth.uid()
          OR auth.uid() = ANY (COALESCE(l.shared_with, ARRAY[]::UUID[]))
          OR l.created_by = auth.uid()
          OR command_may('crm.viewOthers'))                     AS may_open
    FROM mine l
    LEFT JOIN profiles p            ON p.id = l.owner_id
    LEFT JOIN stock_trailers s      ON s.id = l.stock_trailer_id
    LEFT JOIN fleetsmart_contracts f ON f.lead_id = l.id
   ORDER BY l.id,
            /* The record match wins over the name match where both
               somehow find the same row. */
            (l.how = 'record') DESC;
$fn$;

REVOKE ALL ON FUNCTION customer_tracker_entries(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_tracker_entries(UUID) TO authenticated;

COMMENT ON FUNCTION customer_tracker_entries(UUID) IS
  'Every tracker entry that belongs to one customer, however it is attached: '
  'straight at them, through a merge, through their twin, or by company name '
  'where the lead was never bound to a record. Rows found by name say so. '
  'Everybody with crm.view sees that a deal exists; only crm.dealValues gets the '
  'figures, and may_open says who may open it.';

-- -------------------------------------------------------------
-- And the repair, which is a separate act.
--
-- Reading a lead by name is right for a screen and wrong as a permanent
-- state: a lead with no account does not appear in the customer's
-- value, does not follow them through a merge, and does not update
-- their status. This binds the ones where there is EXACTLY ONE live
-- customer with that key, and refuses every ambiguous one.
--
-- Idempotent, called by hand, and NOTHING IS DELETED: it only fills in
-- a `contact_id` that was empty.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_bind_orphan_leads(BOOLEAN);
CREATE OR REPLACE FUNCTION crm_bind_orphan_leads(p_dry_run BOOLEAN DEFAULT TRUE)
RETURNS TABLE (bound INT, ambiguous INT, no_match INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE l RECORD; hit UUID; n INT; b INT := 0; a INT := 0; m INT := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Binding orphan tracker entries to customers needs permission to edit the CRM.';
  END IF;

  FOR l IN
    SELECT id, company_name FROM crm_leads
     WHERE contact_id IS NULL AND COALESCE(BTRIM(company_name), '') <> ''
  LOOP
    SELECT count(*), (array_agg(c.id ORDER BY c.created_at))[1] INTO n, hit
      FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND company_key(c.company_name) IS NOT NULL
       AND company_key(c.company_name) = company_key(l.company_name);

    IF n = 1 THEN
      IF NOT p_dry_run THEN
        UPDATE crm_leads SET contact_id = hit WHERE id = l.id;
      END IF;
      b := b + 1;
    ELSIF n > 1 THEN
      a := a + 1;
    ELSE
      m := m + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT b, a, m;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_bind_orphan_leads(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_bind_orphan_leads(BOOLEAN) TO authenticated;
