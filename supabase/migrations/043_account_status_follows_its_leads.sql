-- =============================================================
-- 043. A company's status is what its leads say it is.
--
-- From the business, describing how this was always meant to work:
--
--   the moment you open a new lead on the tracker for a company in the
--   CRM its status dynamically changes based on the reason for the lead
--   and also the status of the lead
--
-- It could not work while a lead and a company were the same row,
-- because there was nothing to derive it from. Now there is.
--
-- WHY THIS ALSO SETTLES AN AMBIGUITY.
--
-- Both tables carry `status`, so "set status on Dawson to quoted" had
-- two readings and the command bar answered neither: a sentence naming
-- a company and a deal state matched a company column and a lead column
-- equally well, and refusing is what a tie does. Deriving one of them
-- means there is only one status anybody can set, which is the lead's,
-- and it is the one they meant.
--
-- THE ORDER.
--
-- A company is as far along as its furthest lead. One won deal makes
-- them a customer whatever else is still being chased, and a company is
-- only lost when everything is: a lost quote is not a lost customer
-- while somebody else is still quoting them.
-- =============================================================

CREATE OR REPLACE FUNCTION crm_account_status_from_leads(p_contact UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT l.status
       FROM crm_leads l
      WHERE l.contact_id = p_contact
      ORDER BY CASE l.status
                 WHEN 'customer'  THEN 6
                 WHEN 'won'       THEN 5
                 WHEN 'quoted'    THEN 4
                 WHEN 'contacted' THEN 3
                 WHEN 'lead'      THEN 2
                 WHEN 'lost'      THEN 1
                 ELSE 0
               END DESC,
               l.updated_at DESC
      LIMIT 1),
    -- No leads at all is not a state a lead can put them in. They are a
    -- company somebody has entered and nobody has pitched to yet.
    'lead');
$$;

CREATE OR REPLACE FUNCTION crm_account_follows_its_leads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target UUID;
  state  TEXT;
BEGIN
  target := COALESCE(NEW.contact_id, OLD.contact_id);
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  state := crm_account_status_from_leads(target);

  UPDATE crm_contacts
     SET status = state,
         -- Winning work is what makes somebody an existing customer.
         -- It never goes back the other way: they traded with us once
         -- and a later lost quote does not undo that.
         relationship = CASE WHEN state = 'customer' THEN 'existing'
                             ELSE COALESCE(relationship, 'prospect') END,
         last_activity_at = NOW()
   WHERE id = target
     AND status IS DISTINCT FROM state;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_set_account_status ON crm_leads;
CREATE TRIGGER crm_leads_set_account_status
  AFTER INSERT OR UPDATE OF status, contact_id OR DELETE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_account_follows_its_leads();

-- Bring every account that already has leads into line, so the column
-- means the same thing on day one as it will on day two.
UPDATE crm_contacts c
   SET status = crm_account_status_from_leads(c.id)
 WHERE EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id = c.id)
   AND c.status IS DISTINCT FROM crm_account_status_from_leads(c.id);

GRANT EXECUTE ON FUNCTION crm_account_status_from_leads(UUID) TO authenticated;
