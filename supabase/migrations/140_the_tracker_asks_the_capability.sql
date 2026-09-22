-- =============================================================
-- 140. The Sales Tracker asks the capability, not the ownership alone.
--
-- Two findings from the audit, both verified in 040 before a line was
-- changed.
--
-- REVOKING EDIT AND DELETE CHANGED NOTHING ON YOUR OWN LEADS.
--
--   leads_update  USING (owner_id = auth.uid() OR ... OR current_role_safe() = 'admin')
--   leads_delete  USING (owner_id = auth.uid() OR current_role_safe() = 'admin')
--
-- Ownership alone, and a legacy role name. Take `crm.edit` off somebody
-- on the Roles tab and they carry on editing every lead they own. Take
-- `crm.delete` off them and they carry on deleting. The Roles tab was
-- drawing controls over a database that was not listening.
--
-- GRANTING crm.viewOthers SHOWED AN EMPTY TRACKER.
--
--   leads_select  USING (owner_id = ... OR shared_with OR created_by
--                        OR current_role_safe() = 'admin')
--
-- The colleague picker appeared, because the page asks the capability.
-- The rows did not, because the database asked whether you were an
-- admin. A newly authorised manager opened a colleague's tracker and
-- saw nothing, which reads as "this person has no work on".
--
-- ---- What ownership still means ----
--
-- Ownership is NOT being replaced by the capability, it is being
-- joined to it. `crm.edit` says you may edit; ownership says which
-- rows. Somebody with `crm.viewOthers` can now READ a colleague's
-- tracker without gaining any right to change it, which is the whole
-- point of a viewing right.
--
-- `crm.assign` is what lets somebody change a row they do not own,
-- because handing an account about is the thing that capability
-- exists for.
--
-- And every write says AND NOT viewing_as_somebody(), for the reason
-- 139 exists: the tracker grid writes straight from the browser.
-- =============================================================

DROP POLICY IF EXISTS "leads_select" ON crm_leads;
CREATE POLICY "leads_select" ON crm_leads
  FOR SELECT USING (
    command_may('crm.view')
    AND (
      owner_id = auth.uid()
      OR auth.uid() = ANY (shared_with)
      OR created_by = auth.uid()
      /* Reading somebody else's book is its own right, and it is the
         one the page already asks for before it draws the picker.

         crm.viewGlobal is DELIBERATELY NOT HERE. It means "see the
         whole company list, not only their own accounts", which is
         about organisations. Every sales_rep holds it and none of them
         holds crm.viewOthers, which is exactly the distinction the
         role templates draw: sr_sales sees colleagues' books, a rep
         does not. Adding viewGlobal here would have opened every
         rep's tracker to every other rep, a privacy regression on the
         policy this replaces, and check:tracker-rights caught it. */
      OR command_may('crm.viewOthers')
    )
  );

DROP POLICY IF EXISTS "leads_insert" ON crm_leads;
CREATE POLICY "leads_insert" ON crm_leads
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND command_may('crm.create')
    AND NOT viewing_as_somebody()
  );

DROP POLICY IF EXISTS "leads_update" ON crm_leads;
CREATE POLICY "leads_update" ON crm_leads
  FOR UPDATE USING (
    command_may('crm.edit')
    AND NOT viewing_as_somebody()
    AND (
      owner_id = auth.uid()
      OR auth.uid() = ANY (shared_with)
      /* Changing a row that is not yours is what crm.assign is for. */
      OR command_may('crm.assign')
    )
  ) WITH CHECK (
    command_may('crm.edit')
    AND NOT viewing_as_somebody()
    AND (
      owner_id = auth.uid()
      OR auth.uid() = ANY (shared_with)
      OR command_may('crm.assign')
    )
  );

DROP POLICY IF EXISTS "leads_delete" ON crm_leads;
CREATE POLICY "leads_delete" ON crm_leads
  FOR DELETE USING (
    command_may('crm.delete')
    AND NOT viewing_as_somebody()
    AND (owner_id = auth.uid() OR command_may('crm.assign'))
  );

DO $$ BEGIN
  RAISE NOTICE 'the tracker reads crm.viewOthers and writes only with crm.edit or crm.delete';
END $$;
