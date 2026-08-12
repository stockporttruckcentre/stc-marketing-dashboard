-- =============================================================
-- 003_linked_accounts.sql
--
-- Twinned customer records: the same business holding both a sales and
-- leasing account and a maintenance account, because Protean treats them
-- as separate entities.
--
-- THE DECISION, and why it is not the textbook one.
--
-- The tidy answer is a `customers` table above `crm_contacts`, with each
-- customer owning several account records. It is also the wrong move
-- right now: crm_contacts is already doing three jobs, every query and
-- every RLS policy in the app reads from it, and the platform is about
-- to move off Supabase. Restructuring the busiest table in the product
-- immediately before that migration would be reckless.
--
-- So this is a self-reference instead. It is additive, no existing query
-- or policy changes, and it delivers exactly what the meeting asked for:
-- two records that are visibly the same customer. If the customers table
-- is ever built, this column is the map for the backfill.
--
-- Safe to re-run.
-- =============================================================

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS parent_customer_id UUID
  REFERENCES crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_parent
  ON crm_contacts (parent_customer_id) WHERE parent_customer_id IS NOT NULL;

-- One level only. A twin points at the head record; a head record points
-- at nothing. Without this a chain can form and "the same customer" stops
-- having a single answer.
CREATE OR REPLACE FUNCTION enforce_flat_customer_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  grandparent UUID;
BEGIN
  IF NEW.parent_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_customer_id = NEW.id THEN
    RAISE EXCEPTION 'A customer record cannot be linked to itself';
  END IF;

  -- If the target is itself a twin, point at its head instead.
  SELECT parent_customer_id INTO grandparent
  FROM crm_contacts WHERE id = NEW.parent_customer_id;

  IF grandparent IS NOT NULL THEN
    NEW.parent_customer_id := grandparent;
  END IF;

  -- A record with twins of its own cannot become a twin.
  IF EXISTS (SELECT 1 FROM crm_contacts WHERE parent_customer_id = NEW.id) THEN
    RAISE EXCEPTION 'This record already has linked accounts, so it cannot be linked to another';
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS crm_contacts_flat_link ON crm_contacts;
CREATE TRIGGER crm_contacts_flat_link
  BEFORE INSERT OR UPDATE OF parent_customer_id ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_flat_customer_link();
