import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { guardRoute } from '@/lib/platform/permissions/route-guard';
import { NoAccess } from '@/components/platform/NoAccess';
import { AdminPanel } from '@/components/AdminPanel';

export const dynamic = 'force-dynamic';

/* =============================================================
   Who gets through this door.

   This page used to read `profile.role !== 'admin'` and redirect. That
   is the same hard coded route migration 068 was about: an
   administrator whose access comes from a role template rather than the
   legacy column was bounced off their own screen, and nothing on the
   page could tell them why.

   Then it asked `command_may` twice itself and sent anybody without
   either to the directory. That was better, and still wrong in the way
   that cost an evening: the rule was written down HERE as well as in
   `lib/nav.ts`, so the menu row and the door were two copies of one
   sentence and nothing made them agree.

   `guardRoute` reads the requirement out of `lib/nav.ts` by route. The
   row says `anyOf: ['admin.users', 'access.decide']` and this door asks
   exactly that, because it is the same list. Nothing is repeated, so
   nothing can drift.

   The door is a courtesy rather than the defence. Somebody who got here
   anyway would find `team_directory()` withholding the permission
   counts and every write function refusing them by name.
   ============================================================= */
export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* ---- Two doors into one screen ----

     `admin.users` opens People. `access.decide` opens Requests. Sr
     Sales holds the second and not the first, on purpose: running a
     department is not the same as being able to edit accounts. The nav
     row carries both, and one of them is enough to be let in. */
  const verdict = await guardRoute(supabase, '/dashboard/admin');
  if (verdict.state !== 'allowed') return <NoAccess verdict={verdict} page="the Admin hub" />;

  /* ---- Held, not gated ----

     These three are read so the panel can draw only the tabs and
     controls the person actually holds. They decide what is on the
     screen, never whether the screen opens: that was settled above, in
     one place, by the declaration the menu reads. */
  const [{ data: mayManage }, { data: mayDecide }, { data: mayEditRoles }] = await Promise.all([
    supabase.rpc('command_may', { p_capability: 'admin.users' }),
    supabase.rpc('command_may', { p_capability: 'access.decide' }),
    /* Reading what a role can do needs only `admin.users`. CHANGING it
       needs `admin.roles`, which is a different job: putting Dean on Sr
       Sales is one person, deciding what Sr Sales means is all of them. */
    supabase.rpc('command_may', { p_capability: 'admin.roles' }),
  ]);

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
