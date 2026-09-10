import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { NotificationsProvider } from '@/components/notifications/provider';
import { screenCapabilities } from '@/lib/platform/permissions/resolve';
import { viewingAs } from '@/lib/platform/permissions/view-as';
import { ViewingAsBanner } from '@/components/admin/view-as';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();

  const { count: pendingPosts } = await supabase
    .from('social_posts').select('*', { count: 'exact', head: true })
    .eq('status', 'pending_review');

  // Sidebar emblem URL. Look up the most recent emblem, the no-text logo, from brand_assets.
  const { data: emblemRow } = await supabase
    .from('brand_assets')
    .select('url')
    .or('name.ilike.%emblem%,name.ilike.%no text%,name.ilike.%notext%,url.ilike.%emblem%,url.ilike.%notext%,url.ilike.%no_text%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const emblemUrl: string | null = emblemRow?.url ?? null;

  const p = (profile as Profile) ?? {
    id: user.id,
    email: user.email!,
    full_name: user.email!.split('@')[0],
    role: 'viewer' as const,
    created_at: new Date().toISOString(),
  };

  /* ---- What this person may actually do ----

     Resolved here, once, and handed down. The sidebar and the command
     bar both used to work it out from `p.role`, and that column has
     four values and knows nothing about the eleven role templates. STC
     Admin sits on `viewer` there and holds `revenue.import` through
     their template: derived from the column, the sidebar hid Revenue
     from the one person whose job it is.

     `screenCapabilities` is the same merge `lib/api/guard.ts` performs
     on every write route, so what the sidebar draws and what the route
     behind it allows cannot disagree. */
  /* ---- View as ----

     Null in the ordinary case, and everything below behaves exactly as
     it did. When it is set, the capabilities are resolved for THEM, so
     the sidebar, the tabs and every gated button are the ones they
     would see. `viewingAs` re-asks `admin.users` on every load, so this
     cannot outlive the permission that allows it.

     The rows stay yours: row level security reads `auth.uid()` and no
     cookie can move that. The banner says so, on every screen, and
     writes are refused for as long as it is up. */
  const asSomeoneElse = await viewingAs(supabase);

  const { data: theirProfile } = asSomeoneElse
    ? await supabase.from('profiles').select('*').eq('id', asSomeoneElse.userId).single()
    : { data: null };

  const caps = [...await screenCapabilities(
    supabase,
    (theirProfile as Profile) ?? p,
    asSomeoneElse?.userId ?? user.id,
  )];

  /* And what that role is CALLED. The footer printed `p.role`, which is
     the four value column: a Developer read "admin", an office
     administrator read "viewer", and neither is their job. */
  const { data: roleRow } = p.role_template_id
    ? await supabase.from('role_templates').select('name').eq('id', p.role_template_id).maybeSingle()
    : { data: null };
  const roleName = asSomeoneElse
    ? asSomeoneElse.roleName
    : ((roleRow as { name?: string } | null)?.name ?? null);

  /* One reading of the bell, above both the sidebar and the top bar.
     Two ways in now, and they must never show different numbers: the
     first time somebody sees a three on one and a two on the other,
     neither is believed again. */
  return (
    <NotificationsProvider>
      <div className="app">
        <Sidebar profile={p} caps={caps} roleName={roleName} pendingPosts={pendingPosts ?? 0} emblemUrl={emblemUrl} />
        <div className="main">
          {asSomeoneElse && (
            <ViewingAsBanner name={asSomeoneElse.fullName} roleName={asSomeoneElse.roleName} />
          )}
          <TopBar role={p.role} caps={caps} />
          <main className="page">{children}</main>
        </div>
      </div>
    </NotificationsProvider>
  );
}
