-- =============================================================
-- 045. Anybody who may edit the CRM may put a company on it.
--
-- Migration 040 moved list membership into `crm_list_contacts` and gave
-- the table the policy the OLD lists had: you may write a membership
-- for a list you own, or one shared with you, or if you are an admin.
--
-- That is the right rule for a private list and the wrong one for the
-- shared pipeline, which nobody owns. `crm_lists` seeds it with a null
-- `owner_id`, so every branch of that policy is false for everybody
-- except an admin, and a salesman doing the most ordinary thing on the
-- tab could not do it:
--
--   new row violates row-level security policy for table "crm_list_contacts"
--
-- Adding a customer, importing a spreadsheet and putting an existing
-- company onto the list all failed the same way. While membership was a
-- column this could not happen: it was covered by `crm_update`, which
-- has always let sales and marketing edit the CRM. Moving membership to
-- its own table moved it out from under that policy, and nothing put it
-- back.
--
-- WHO MAY DO WHAT, WRITTEN OUT.
--
--   the shared pipeline   admin, sales and marketing may ADD a company
--                         only an admin may take one OFF
--   a private list        its owner, anybody it is shared with, admin
--
-- The asymmetry on the pipeline is deliberate. It is the business's
-- record of every account, and one person tidying their own view should
-- not be able to remove a customer from everybody else's. Adding is
-- ordinary work; removing is not.
-- =============================================================

DROP POLICY IF EXISTS "list_contacts_write" ON crm_list_contacts;

/* Putting a company on a list. */
DROP POLICY IF EXISTS "list_contacts_insert" ON crm_list_contacts;
CREATE POLICY "list_contacts_insert" ON crm_list_contacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm_lists l
       WHERE l.id = list_id
         AND (
           /* The shared pipeline: the same people `crm_update` lets
              edit a company may add one to it. */
           (l.is_global AND current_role_safe() IN ('admin', 'sales', 'marketer'))
           OR l.owner_id = auth.uid()
           OR is_list_member_safe(l.id)
           OR current_role_safe() = 'admin'
         )
    )
  );

/* Changing a membership row in place, which nothing does today: a
   membership is two ids and a stamp. Held to the same rule as adding
   one so it cannot become a way around either. */
DROP POLICY IF EXISTS "list_contacts_update" ON crm_list_contacts;
CREATE POLICY "list_contacts_update" ON crm_list_contacts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM crm_lists l
       WHERE l.id = list_id
         AND (l.owner_id = auth.uid() OR is_list_member_safe(l.id)
              OR current_role_safe() = 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm_lists l
       WHERE l.id = list_id
         AND (l.owner_id = auth.uid() OR is_list_member_safe(l.id)
              OR current_role_safe() = 'admin')
    )
  );

/* Taking a company off a list.

   Off the shared pipeline is an admin's decision, because it is the
   business's record of the account and taking it off takes it off for
   everybody. Off a private list is whoever the list belongs to. */
DROP POLICY IF EXISTS "list_contacts_delete" ON crm_list_contacts;
CREATE POLICY "list_contacts_delete" ON crm_list_contacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM crm_lists l
       WHERE l.id = list_id
         AND (
           CASE WHEN l.is_global THEN current_role_safe() = 'admin'
                ELSE l.owner_id = auth.uid() OR is_list_member_safe(l.id)
                     OR current_role_safe() = 'admin'
           END
         )
    )
  );

-- -------------------------------------------------------------
-- Notes are read through the same rule as the company they are on
--
-- `notes_select` reads `crm_contacts.list_id`, which stopped meaning
-- anything in migration 040. It has not leaked a note: the condition
-- also has to find the contact, and finding one goes through
-- `crm_select`, which does the real work. But it is a rule written
-- against a column that no longer answers the question, sitting one
-- edit away from being the only thing holding it up.
--
-- Said once, in the place that already knows the answer.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "notes_select" ON contact_notes;
CREATE POLICY "notes_select" ON contact_notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = contact_notes.contact_id)
  );

-- -------------------------------------------------------------
-- A note is written by whoever says they wrote it
--
-- `notes_insert` had no check at all, so the author of a note was
-- whatever the browser sent. A note is the record of who said what to
-- a customer and when, and one that can be signed with somebody else's
-- name is not a record of anything.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "notes_insert" ON contact_notes;
CREATE POLICY "notes_insert" ON contact_notes
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = contact_notes.contact_id)
  );
