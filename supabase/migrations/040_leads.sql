-- =============================================================
-- 040. A lead is its own thing, and a customer is one record.
--
-- THE PROBLEM THIS FIXES.
--
-- A company's list membership is one column, `crm_contacts.list_id`, so
-- a row belongs to exactly one list. The CRM pipeline reads the global
-- list. Each person's sales tracker is a private list of their own. Put
-- those together and a company that is on the pipeline and on two
-- people's trackers has to exist as three rows, because that is the only
-- thing the schema can say.
--
-- So the duplicates are not bad data entry. They are the schema being
-- asked a question it has no way to answer. `crm_list_members` looks
-- like it should have solved this and does not: it is (list_id,
-- user_id), which is who may SEE a list, not which companies are ON one.
--
-- The meeting left this open. Section 2 of `docs/source/crm-page-scope.md`
-- lists, under decisions still needed:
--
--   How to visualise the same account in two tabs, one record with two
--   flags, or two linked records?
--
-- Migration 003 answered it as two linked records, which is where the
-- three Dawsons came from. The business has since answered it the other
-- way, and this is that answer: Dawson is Dawson whatever work is being
-- pitched for. One account. The pitches hang off it.
--
-- WHAT CHANGES.
--
--   crm_leads          a lead, owned by a person, against an account
--   crm_list_contacts  which accounts are on which list, many to many
--
-- `crm_contacts` becomes the account book and nothing else. Everything
-- that describes a pitch rather than a company moves onto the lead:
-- the enquiry date, what they want, the value, the action, the order and
-- dispatch dates, the sale price, the profit and the commission.
--
-- Which means the third tab Tom asked for is a value rather than a
-- schema change. `side` was a column on the company with two values it
-- could ever hold. `type` is a column on the lead with three.
--
-- HOW THE EXISTING ROWS ARE SORTED, AND WHY IT IS NOT A GUESS.
--
-- Every row already carries the answer in `list_id`:
--
--   on the global list        this is the account
--   on a personal tracker     this is a lead, and the list's owner owns it
--
-- So for each company: the row on the global list becomes the account,
-- and every row sitting on somebody's tracker becomes a lead owned by
-- that somebody. Where a company was only ever on trackers and never
-- reached the pipeline, which is the Dawson case the business raised,
-- the oldest row is promoted to be the account and still yields its
-- lead, so nothing is invented and nothing is dropped.
--
-- Children move before anything is deleted: addresses, notes, ownership,
-- dashboard actions, meetings and parent links all follow the surviving
-- account. Nothing is deleted whose children have not already moved.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Which accounts are on which list
--
-- The join table the schema always needed. A company can now be on the
-- pipeline and on three trackers without being four companies.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_list_contacts (
  list_id    UUID REFERENCES crm_lists    ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE NOT NULL,
  added_by   UUID REFERENCES auth.users   ON DELETE SET NULL,
  added_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_list_contacts_contact ON crm_list_contacts (contact_id);

-- -------------------------------------------------------------
-- 2. The lead
--
-- One row per pitch. A customer can have several open at once, because
-- two people can be quoting the same firm for different work, which is
-- the case that made the old shape impossible.
--
-- `shared_with` is the second half of that: a lead worked by two people
-- appears on both their trackers without being two leads. An array
-- rather than another join table because it is read on every tracker
-- query and is never more than a handful of people.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The account this is a pitch to. One account, many leads.
  --
  -- Null only where there is genuinely no customer yet: a unit sent from
  -- stock to somebody's tracker is "I am trying to sell this trailer"
  -- before it is a pitch to anybody. That used to be expressed by
  -- inventing a company called "Lead STC12345" in the CRM, which is a
  -- phantom account nobody asked for. A lead with no customer named is
  -- the honest version of the same thing, and naming one later is
  -- filling in a column rather than merging two records.
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE,

  -- Whose tracker it sits on. Not the account owner: anybody can raise
  -- a lead against any account in the CRM and hand it to somebody else
  -- as they create it.
  owner_id UUID REFERENCES auth.users ON DELETE SET NULL,

  -- People working it alongside the owner. It shows on their trackers
  -- too, and they can edit it.
  shared_with UUID[] DEFAULT '{}'::UUID[] NOT NULL,

  -- The three tabs. Rental and leasing is here from the start rather
  -- than being a fourth thing bolted on, because a lead type is a value
  -- now and no longer a column that has to be widened.
  type TEXT NOT NULL DEFAULT 'trailer_sales'
    CHECK (type IN ('trailer_sales', 'maintenance', 'rental')),

  -- Where the pitch stands. Same words the tracker tabs already use, so
  -- nothing has to be relearned.
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead', 'contacted', 'quoted', 'won', 'customer', 'lost')),

  -- What is being pitched.
  what             TEXT,
  requirement      TEXT,
  new_or_used      TEXT,
  estimated_value  NUMERIC,
  date_of_enquiry  DATE,

  -- What happens next, and when it last moved. `last_activity_at` is
  -- what the inactive prospect nudge reads.
  action           TEXT,
  next_action      TEXT,
  last_activity_at TIMESTAMPTZ,

  -- The sale, once there is one.
  stock_trailer_id UUID REFERENCES stock_trailers ON DELETE SET NULL,
  order_date       DATE,
  dispatch_date    DATE,
  sale_price       NUMERIC,
  profit           NUMERIC,
  profit_pct       NUMERIC,
  commission       NUMERIC,
  commission_rate  NUMERIC,
  rep_initials     TEXT,

  notes      TEXT,

  /* The customer's name, kept here as well as on the account.
  
     A copy, deliberately. Every question anybody asks about a pitch
     names the company in the same breath, "how many Dawson deals",
     "Dawson's open leads", and a lead's company is one join away.
     Answering it by joining means the query layer has to learn to
     join for one filter; answering it by carrying the name means a
     trigger keeps two strings in step, both ways, and every export,
     search and count keeps working unchanged.
  
     Kept honest by `crm_lead_carries_its_company`, so a company
     renamed in the CRM is renamed on its leads in the same statement.
     Nothing writes it by hand, which is why it is not writable. */
  company_name TEXT,

  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_contact ON crm_leads (contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_owner   ON crm_leads (owner_id, type, status);
CREATE INDEX IF NOT EXISTS idx_leads_shared  ON crm_leads USING GIN (shared_with);
CREATE INDEX IF NOT EXISTS idx_leads_open
  ON crm_leads (last_activity_at) WHERE status NOT IN ('customer', 'lost');

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_crm_leads_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_crm_leads_updated_at BEFORE UPDATE ON crm_leads
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- -------------------------------------------------------------
-- 3. Sorting what is already there
--
-- Runs once. The guard is the join table being empty: if this has
-- already been done, running the file again does nothing, which is what
-- lets the whole migration bundle stay safe to re-run.
-- -------------------------------------------------------------
DO $$
DECLARE
  moved_leads   INTEGER := 0;
  merged_rows   INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM crm_list_contacts) THEN
    RAISE NOTICE 'crm_list_contacts already populated, leaving the data alone';
    RETURN;
  END IF;

  -- Which row survives as the account, per company.
  --
  -- The row on the global list if there is one, because that is the
  -- pipeline entry and is what people have been treating as the account.
  -- Otherwise the oldest, which for a company that only ever reached
  -- somebody's tracker is the first time anybody here heard of them.
  CREATE TEMP TABLE survivor ON COMMIT DROP AS
  SELECT DISTINCT ON (LOWER(BTRIM(c.company_name)))
         LOWER(BTRIM(c.company_name)) AS key,
         c.id
    FROM crm_contacts c
    LEFT JOIN crm_lists l ON l.id = c.list_id
   ORDER BY LOWER(BTRIM(c.company_name)),
            COALESCE(l.is_global, FALSE) DESC,
            c.created_at ASC,
            c.id ASC;

  CREATE INDEX ON survivor (id);

  -- Every list any copy sat on, recorded against the SURVIVOR rather
  -- than against the copy.
  --
  -- Writing it against the copy is the obvious way and is wrong: the
  -- copies are deleted at the end of this block and the membership rows
  -- cascade away with them, so a company on the pipeline and two
  -- trackers would come out of the merge on whichever single list its
  -- surviving row happened to hold. Mapping to the survivor here is what
  -- makes one account genuinely appear in three places.
  INSERT INTO crm_list_contacts (list_id, contact_id)
  SELECT c.list_id, s.id
    FROM crm_contacts c
    JOIN survivor s ON s.key = LOWER(BTRIM(c.company_name))
   WHERE c.list_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Every row that sat on somebody's tracker becomes that person's lead,
  -- including a surviving row that was itself on a tracker. A row on the
  -- global list carries no pitch and yields no lead.
  INSERT INTO crm_leads (
    contact_id, owner_id, type, status, what, requirement, new_or_used,
    estimated_value, date_of_enquiry, action, next_action, last_activity_at,
    stock_trailer_id, order_date, dispatch_date, sale_price, profit,
    profit_pct, commission, commission_rate, rep_initials, notes,
    created_at, updated_at)
  SELECT s.id,
         l.owner_id,
         CASE WHEN c.side = 'maintenance' THEN 'maintenance' ELSE 'trailer_sales' END,
         c.status,
         c.what, c.requirement, c.new_or_used,
         c.estimated_value, c.date_of_enquiry, c.action, c.next_action,
         COALESCE(c.last_activity_at, c.updated_at),
         c.stock_trailer_id, c.order_date, c.dispatch_date, c.sale_price,
         c.profit, c.profit_pct, c.commission, c.commission_rate,
         c.initials, c.notes,
         c.created_at, c.updated_at
    FROM crm_contacts c
    JOIN crm_lists l ON l.id = c.list_id AND l.is_global = FALSE
    JOIN survivor s  ON s.key = LOWER(BTRIM(c.company_name));

  GET DIAGNOSTICS moved_leads = ROW_COUNT;

  -- The children of a row that is about to go follow the survivor.
  --
  -- Ownership first, because its primary key is (contact_id, user_id)
  -- and the same person may own two copies of the same company.
  INSERT INTO account_ownership (contact_id, user_id, role_on_account, assigned_at)
  SELECT s.id, a.user_id, a.role_on_account, a.assigned_at
    FROM account_ownership a
    JOIN crm_contacts c ON c.id = a.contact_id
    JOIN survivor s     ON s.key = LOWER(BTRIM(c.company_name))
   WHERE a.contact_id <> s.id
  ON CONFLICT (contact_id, user_id) DO NOTHING;

  -- Addresses, notes, actions and meetings just repoint. An address
  -- arriving as a second primary is demoted first, because the table has
  -- a trigger that allows one and would otherwise reject the move.
  UPDATE contact_addresses a SET is_primary = FALSE
    FROM crm_contacts c, survivor s
   WHERE a.contact_id = c.id
     AND s.key = LOWER(BTRIM(c.company_name))
     AND a.contact_id <> s.id
     AND EXISTS (SELECT 1 FROM contact_addresses p
                  WHERE p.contact_id = s.id AND p.is_primary);

  UPDATE contact_addresses a SET contact_id = s.id
    FROM crm_contacts c, survivor s
   WHERE a.contact_id = c.id AND s.key = LOWER(BTRIM(c.company_name))
     AND a.contact_id <> s.id;

  UPDATE contact_notes n SET contact_id = s.id
    FROM crm_contacts c, survivor s
   WHERE n.contact_id = c.id AND s.key = LOWER(BTRIM(c.company_name))
     AND n.contact_id <> s.id;

  UPDATE dashboard_actions d SET contact_id = s.id
    FROM crm_contacts c, survivor s
   WHERE d.contact_id = c.id AND s.key = LOWER(BTRIM(c.company_name))
     AND d.contact_id <> s.id;

  UPDATE calendar_events e SET contact_id = s.id
    FROM crm_contacts c, survivor s
   WHERE e.contact_id = c.id AND s.key = LOWER(BTRIM(c.company_name))
     AND e.contact_id <> s.id;

  -- A record pointing at a doomed row as its parent points at the
  -- survivor instead, and a record that would end up its own parent
  -- simply stops having one.
  UPDATE crm_contacts x SET parent_customer_id = s.id
    FROM crm_contacts c, survivor s
   WHERE x.parent_customer_id = c.id AND s.key = LOWER(BTRIM(c.company_name))
     AND x.parent_customer_id <> s.id;
  UPDATE crm_contacts SET parent_customer_id = NULL WHERE parent_customer_id = id;

  -- The account keeps the fullest version of the company's own details,
  -- because the pipeline row is often the thinnest and a tracker row may
  -- be where somebody actually typed the phone number.
  UPDATE crm_contacts a SET
    contact_name = COALESCE(a.contact_name, b.contact_name),
    email        = COALESCE(a.email,        b.email),
    phone        = COALESCE(a.phone,        b.phone),
    location     = COALESCE(a.location,     b.location),
    address      = COALESCE(a.address,      b.address),
    fleet_size   = COALESCE(a.fleet_size,   b.fleet_size),
    trucks       = COALESCE(a.trucks,       b.trucks),
    trailers     = COALESCE(a.trailers,     b.trailers),
    vans         = COALESCE(a.vans,         b.vans),
    employee_count = COALESCE(a.employee_count, b.employee_count),
    turnover     = COALESCE(a.turnover,     b.turnover),
    description  = COALESCE(a.description,  b.description),
    account_manager = COALESCE(a.account_manager, b.account_manager),
    category     = COALESCE(a.category,     b.category),
    vehicles     = COALESCE(a.vehicles,     b.vehicles),
    links        = CASE WHEN COALESCE(jsonb_array_length(a.links), 0) = 0
                        THEN b.links ELSE a.links END
    FROM (
      SELECT s.id AS keep, c.*
        FROM crm_contacts c
        JOIN survivor s ON s.key = LOWER(BTRIM(c.company_name))
       WHERE c.id <> s.id
    ) b
   WHERE a.id = b.keep;

  -- Now the copies can go. Their children left before they did.
  DELETE FROM crm_contacts c
   USING survivor s
   WHERE s.key = LOWER(BTRIM(c.company_name)) AND c.id <> s.id;

  GET DIAGNOSTICS merged_rows = ROW_COUNT;

  RAISE NOTICE 'leads created: %, duplicate accounts merged away: %',
    moved_leads, merged_rows;
END $$;

-- -------------------------------------------------------------
-- 4. Who can see a lead
--
-- Your own, one you are sharing, and anybody whose portfolio you are
-- allowed to see. That last one is the difference between a sales role
-- and an admin: a rep sees their tracker, an admin sees every tracker,
-- which is what makes "click the customer and see every open lead"
-- work for one and not the other.
-- -------------------------------------------------------------
ALTER TABLE crm_leads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_list_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select" ON crm_leads;
CREATE POLICY "leads_select" ON crm_leads
  FOR SELECT USING (
    owner_id = auth.uid()
    OR auth.uid() = ANY (shared_with)
    OR created_by = auth.uid()
    OR current_role_safe() = 'admin'
  );

DROP POLICY IF EXISTS "leads_insert" ON crm_leads;
CREATE POLICY "leads_insert" ON crm_leads
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "leads_update" ON crm_leads;
CREATE POLICY "leads_update" ON crm_leads
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR auth.uid() = ANY (shared_with)
    OR current_role_safe() = 'admin'
  ) WITH CHECK (
    owner_id = auth.uid()
    OR auth.uid() = ANY (shared_with)
    OR current_role_safe() = 'admin'
  );

DROP POLICY IF EXISTS "leads_delete" ON crm_leads;
CREATE POLICY "leads_delete" ON crm_leads
  FOR DELETE USING (owner_id = auth.uid() OR current_role_safe() = 'admin');

-- List membership follows the list, which already knows who may see it.
DROP POLICY IF EXISTS "list_contacts_select" ON crm_list_contacts;
CREATE POLICY "list_contacts_select" ON crm_list_contacts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM crm_lists l
             WHERE l.id = list_id
               AND (l.is_global OR l.owner_id = auth.uid()
                    OR is_list_member_safe(l.id)))
  );

DROP POLICY IF EXISTS "list_contacts_write" ON crm_list_contacts;
CREATE POLICY "list_contacts_write" ON crm_list_contacts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM crm_lists l
             WHERE l.id = list_id
               AND (l.owner_id = auth.uid() OR is_list_member_safe(l.id)
                    OR current_role_safe() = 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM crm_lists l
             WHERE l.id = list_id
               AND (l.owner_id = auth.uid() OR is_list_member_safe(l.id)
                    OR current_role_safe() = 'admin'))
  );

-- -------------------------------------------------------------
-- 5. An account is visible if it is on a list you can see
--
-- Same rule as before in words, but read through the join table so a
-- company on both the pipeline and your tracker is one company.
-- -------------------------------------------------------------
-- The lookup has to be SECURITY DEFINER, and this is not a detail.
--
-- Asking the question inline reads `crm_list_contacts`, which has row
-- level security of its own, so a person who cannot see the list cannot
-- see the membership row either. The policy then finds no memberships,
-- concludes the contact is on no list, and shows it to them. The rule
-- inverts: the better hidden the list, the more visible its contacts.
--
-- This is the same trap migration 009 fixed for `is_list_member_safe`,
-- arriving one table further out. "Which lists is this contact on" is
-- not a question whose answer should depend on which membership rows
-- the asker is allowed to read.
CREATE OR REPLACE FUNCTION crm_contact_on_a_list_you_can_see(p_contact UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
           SELECT 1 FROM crm_list_contacts WHERE contact_id = p_contact
         )
      OR EXISTS (
           SELECT 1
             FROM crm_list_contacts lc
             JOIN crm_lists l ON l.id = lc.list_id
            WHERE lc.contact_id = p_contact
              AND (l.is_global
                   OR l.owner_id = auth.uid()
                   OR EXISTS (SELECT 1 FROM crm_list_members m
                               WHERE m.list_id = l.id AND m.user_id = auth.uid()))
         );
$$;

DROP POLICY IF EXISTS "crm_select" ON crm_contacts;
CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (
  auth.role() = 'authenticated'
  AND crm_contact_on_a_list_you_can_see(crm_contacts.id)
);

GRANT EXECUTE ON FUNCTION crm_contact_on_a_list_you_can_see(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. `list_id` cannot be allowed to mean nothing while it still exists
--
-- The column stays for now, because dropping it in the same breath as
-- introducing the join table would take every screen down with it. That
-- leaves a hole worth naming: the policy above reads membership, and a
-- contact with no membership rows is visible to everybody, exactly as a
-- contact with no list always has been. So anything still writing
-- `list_id` and nothing else would quietly publish a private record.
--
-- This keeps the two in step until the column goes. Writing `list_id`
-- records the membership as well, so a row cannot exist on a private
-- list by one route and be invisible to the rule by the other.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_list_id_follows_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.list_id IS NOT NULL THEN
    INSERT INTO crm_list_contacts (list_id, contact_id)
    VALUES (NEW.list_id, NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_contacts_list_membership ON crm_contacts;
CREATE TRIGGER crm_contacts_list_membership
  AFTER INSERT OR UPDATE OF list_id ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_list_id_follows_membership();

-- -------------------------------------------------------------
-- 7. The company's name, on the lead, kept true
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_lead_carries_its_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT company_name INTO NEW.company_name
    FROM crm_contacts WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_carry_company ON crm_leads;
CREATE TRIGGER crm_leads_carry_company
  BEFORE INSERT OR UPDATE OF contact_id ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_lead_carries_its_company();

CREATE OR REPLACE FUNCTION crm_rename_reaches_its_leads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE crm_leads SET company_name = NEW.company_name
   WHERE contact_id = NEW.id AND company_name IS DISTINCT FROM NEW.company_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_contacts_rename_leads ON crm_contacts;
CREATE TRIGGER crm_contacts_rename_leads
  AFTER UPDATE OF company_name ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_rename_reaches_its_leads();

UPDATE crm_leads l SET company_name = c.company_name
  FROM crm_contacts c
 WHERE c.id = l.contact_id AND l.company_name IS DISTINCT FROM c.company_name;

CREATE INDEX IF NOT EXISTS idx_leads_company ON crm_leads (LOWER(company_name));

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_leads         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_list_contacts TO authenticated;
