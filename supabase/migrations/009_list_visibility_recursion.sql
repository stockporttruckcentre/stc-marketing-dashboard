-- =============================================================
-- The list visibility policies refer to each other in a circle.
--
-- Reading a contact consults `crm_lists`. Reading a list consults
-- `crm_list_members`. Reading a member consults `crm_lists`. Postgres
-- stops the second time it is asked to expand a policy for a relation it
-- is already expanding one for, and the query fails outright with
--
--   infinite recursion detected in policy for relation "crm_lists"
--
-- This is not a small annoyance. It is a security policy that cannot be
-- evaluated, which means the rows it protects cannot be read at all
-- through any path that goes near a list, and it has been in the
-- repository's SQL since `list_id` was added to contacts.
--
-- `is_list_member_safe()` is the answer the schema was already written
-- around: `notes_select` and `notes_insert` in `schema.sql` call it, and
-- it is defined nowhere in this repository, which is why a fresh run of
-- `schema.sql` fails partway. `migrations/001_dashboard.sql` says so in
-- its own header. This adds it.
--
-- WHY A SECURITY DEFINER FUNCTION IS THE RIGHT SHAPE HERE.
--
-- "Are you a member of this list" is not a question whose answer should
-- depend on which membership rows you are allowed to see. Asking it
-- through row level security is what creates the circle, and it also
-- makes the answer subtly wrong: a policy that hides a membership row
-- from you turns "you are a member" into "you are not". The question is
-- about one user and one list, the function takes exactly that, and it
-- can return nothing else.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE.
--
-- The visibility rules themselves. A contact with no list is visible, a
-- contact in a global list is visible, a contact in a list you own is
-- visible, and a contact in a list you were added to is visible.
-- Everything else stays hidden. This is a repair to policies that cannot
-- run, not a widening of who can see what.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The helper the schema already assumes exists
-- -------------------------------------------------------------
--
-- STABLE and SECURITY DEFINER: it reads `crm_list_members` as the owner,
-- so it does not consult `members_all` and cannot re-enter the circle.
-- `search_path` is pinned because a SECURITY DEFINER function that
-- resolves its own table names through the caller's search path is a way
-- in.
CREATE OR REPLACE FUNCTION is_list_member_safe(p_list_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crm_list_members m
    WHERE m.list_id = p_list_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION is_list_member_safe(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_list_member_safe(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 2. The two policies that close the circle
-- -------------------------------------------------------------
--
-- Only the membership test changes in each. Every other clause is
-- exactly what it was, because the point is that these policies start
-- working, not that they start meaning something different.

-- A list is visible if it is global, or yours, or you were added to it.
-- The last clause used to read `crm_list_members` directly, which
-- consulted `members_all`, which read `crm_lists`, which is where the
-- circle closed.
DROP POLICY IF EXISTS "lists_select" ON crm_lists;
CREATE POLICY "lists_select" ON crm_lists FOR SELECT USING (
  is_global = TRUE
  OR owner_id = auth.uid()
  OR is_list_member_safe(crm_lists.id)
);

-- A contact is visible if it is in no list, or in a list you can see.
-- Same three tests on the list, same helper, and the `list_id IS NULL`
-- case is untouched.
DROP POLICY IF EXISTS "crm_select" ON crm_contacts;
CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    list_id IS NULL
    OR EXISTS (
      SELECT 1 FROM crm_lists l
      WHERE l.id = crm_contacts.list_id
        AND (l.is_global = TRUE
             OR l.owner_id = auth.uid()
             OR is_list_member_safe(l.id))
    )
  )
);
