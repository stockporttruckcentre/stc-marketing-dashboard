-- =============================================================
-- 149. The CRM picks a division, the way the tracker does.
--
-- From the business:
--
--   CRM: top of crm have a rental/maint/ts picker like tracker
--
-- ---- What a customer's division is ----
--
-- There is a `crm_contacts.side` column, from the original unified
-- tracker work. It holds two values, `trailer_sales` and `maintenance`,
-- defaults to trailer_sales on every row ever inserted, has no rental,
-- and no screen has ever read it. Filtering on it would put every
-- customer under Trailer Sales and call it a feature.
--
-- "like tracker" settles it. The tracker's picker is over
-- `crm_leads.type`, the three divisions a DEAL is in, so this is over
-- the same column: a customer is in Maintenance if somebody is working
-- a maintenance deal with them.
--
-- That is deliberately not "which division invoices them", which is
-- `protean_invoices.division` and is what the revenue and analytics
-- screens use. The two answer different questions. A haulier the
-- workshop bills every month and nobody is pitching to is in the
-- revenue tab's Maintenance and not in this one, because this one is
-- about who is being worked.
--
-- ---- Whose deals count ----
--
-- Everybody's. SECURITY DEFINER, gated on `crm.view`, for the same
-- reason `customer_tracker_entries` is: the CRM is the shared book. A
-- customer would otherwise drop out of a rep's Maintenance filter
-- because the only maintenance deal on them is on somebody else's
-- tracker, which is the opposite of what a division filter is for.
--
-- No figures come back from this, only which divisions have a deal, so
-- it says nothing `crm.dealValues` is there to withhold.
-- =============================================================

DROP FUNCTION IF EXISTS crm_contact_divisions(UUID[]);
CREATE OR REPLACE FUNCTION crm_contact_divisions(p_contacts UUID[] DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID,
  lead_types TEXT[],
  open_deals INT,
  total_deals INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT l.contact_id,
         array_agg(DISTINCT l.type ORDER BY l.type),
         COUNT(*) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INT,
         COUNT(*)::INT
    FROM crm_leads l
   WHERE l.contact_id IS NOT NULL
     AND (p_contacts IS NULL OR l.contact_id = ANY (p_contacts))
     AND command_may('crm.view')
   GROUP BY l.contact_id;
$fn$;

REVOKE ALL ON FUNCTION crm_contact_divisions(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_contact_divisions(UUID[]) TO authenticated;

COMMENT ON FUNCTION crm_contact_divisions(UUID[]) IS
  'Which of the three divisions each customer has a deal in, from crm_leads.type, '
  'counting everybody''s deals rather than only the caller''s, because the CRM is '
  'the shared book. Not the same question as which division invoices them: that is '
  'protean_invoices.division, and the revenue screens ask it there.';
