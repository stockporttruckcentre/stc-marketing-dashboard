import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { AdminPanel } from '@/components/AdminPanel';

export const dynamic = 'force-dynamic';

/* =============================================================
   Who gets through this door.

   This page used to read `profile.role !== 'admin'` and redirect. That
   is the same hard coded route migration 068 was about: an
   administrator whose access comes from a role template rather than the
   legacy column was bounced off their own screen, and nothing on the
   page could tell them why.

   So the question is asked once, of `command_may('admin.users')`, which
   resolves an override, then a template, then the legacy role, inside
   the database, in the same place every write on this screen is
   checked.

   The redirect is a courtesy rather than the defence. Somebody who got
   here anyway would find `team_directory()` withholding the permission
   counts and every write function refusing them by name.
   ============================================================= */
export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* ---- Two doors into one screen ----

     `admin.users` opens People. `access.decide` opens Requests. Sr
     Sales holds the second and not the first, on purpose: running a
     department is not the same as being able to edit accounts.

     Both are asked here so the panel can draw only the tabs the person
     actually holds, and somebody with neither is still sent away. The
     redirect stays a courtesy rather than the defence: every write on
     this screen is refused by name inside the database. */
  const [{ data: mayManage }, { data: mayDecide }, { data: mayEditRoles }] = await Promise.all([
    supabase.rpc('command_may', { p_capability: 'admin.users' }),
    supabase.rpc('command_may', { p_capability: 'access.decide' }),
    /* Reading what a role can do needs only `admin.users`. CHANGING it
       needs `admin.roles`, which is a different job: putting Dean on Sr
       Sales is one person, deciding what Sr Sales means is all of
       them. */
    supabase.rpc('command_may', { p_capability: 'admin.roles' }),
  ]);

  /* The directory is still open to them, so there is somewhere honest
     to send anybody who arrives here without either permission. */
  if (mayManage !== true && mayDecide !== true) redirect('/dashboard/team');

  /* The roles somebody can be put on, read here rather than in the
     panel so the list is the same on first paint as it is after. A
     select that fills in a moment later moves under the pointer. */
  const { data: templates } = await supabase
    .from('role_templates')
    .select('slug, name, description')
    .eq('is_active', true)
    .order('sort_order');

  return (
    /* `useSearchParams` inside the panel reads `?person=`, and Next
       requires a boundary around a client component that does. */
    <Suspense fallback={null}>
      <AdminPanel
        selfId={user.id}
        mayManage={mayManage === true}
        mayDecide={mayDecide === true}
        mayEditRoles={mayEditRoles === true}
        templates={(templates ?? []) as { slug: string; name: string; description: string | null }[]}
      />
    </Suspense>
  );
}
