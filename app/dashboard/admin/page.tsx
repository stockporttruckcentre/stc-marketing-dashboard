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

  const { data: mayManage } = await supabase.rpc('command_may', { p_capability: 'admin.users' });
  /* The directory is still open to them, so there is somewhere honest
     to send anybody who arrives here without the permission. */
  if (mayManage !== true) redirect('/dashboard/team');

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
        templates={(templates ?? []) as { slug: string; name: string; description: string | null }[]}
      />
    </Suspense>
  );
}
