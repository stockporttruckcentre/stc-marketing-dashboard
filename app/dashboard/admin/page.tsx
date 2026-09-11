import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { AdminPanel } from '@/components/AdminPanel';
import { visibleSections } from '@/lib/nav';
import { screenCapabilities } from '@/lib/platform/permissions/resolve';
import { viewingAs } from '@/lib/platform/permissions/view-as';
import { initials } from '@/components/admin/roles/model';
import type { Profile } from '@/lib/types';

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
  const [{ data: mayManage }, { data: mayDecide }] = await Promise.all([
    supabase.rpc('command_may', { p_capability: 'admin.users' }),
    supabase.rpc('command_may', { p_capability: 'access.decide' }),
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

  /* ---- The Roles screen draws its own navigation ----

     The kit for that tab draws the application's sidebar inside the
     screen, and the handoff fixes it at 218px. Its rows are bound to
     the real ones: the sections this person can reach, resolved the
     same way the sidebar resolves them (for the person being viewed
     as, when somebody is), and the name and role of whoever that is. */
  const asSomeoneElse = await viewingAs(supabase);
  const whoId = asSomeoneElse?.userId ?? user.id;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', whoId).maybeSingle();
  const caps = await screenCapabilities(supabase, (profile as Profile | null), whoId);
  const nav = visibleSections((c) => caps.has(c)).map((s) => ({
    label: s.label,
    items: s.items.map((i) => ({ label: i.label, icon: i.icon, active: i.href === '/dashboard/admin' })),
  }));
  const meName = (profile as { full_name?: string | null } | null)?.full_name ?? user.email ?? 'Somebody';
  const { data: myRole } = (profile as { role_template_id?: string | null } | null)?.role_template_id
    ? await supabase.from('role_templates').select('name')
        .eq('id', (profile as { role_template_id: string }).role_template_id).maybeSingle()
    : { data: null };
  const me = {
    initials: initials(meName),
    name: meName,
    role: asSomeoneElse?.roleName ?? (myRole as { name?: string } | null)?.name ?? '',
  };

  return (
    /* `useSearchParams` inside the panel reads `?person=`, and Next
       requires a boundary around a client component that does. */
    <Suspense fallback={null}>
      <AdminPanel
        selfId={user.id}
        mayManage={mayManage === true}
        mayDecide={mayDecide === true}
        nav={nav}
        me={me}
        templates={(templates ?? []) as { slug: string; name: string; description: string | null }[]}
      />
    </Suspense>
  );
}
