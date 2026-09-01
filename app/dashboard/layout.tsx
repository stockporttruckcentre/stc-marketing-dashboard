import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { NotificationsProvider } from '@/components/notifications/provider';
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

  /* One reading of the bell, above both the sidebar and the top bar.
     Two ways in now, and they must never show different numbers: the
     first time somebody sees a three on one and a two on the other,
     neither is believed again. */
  return (
    <NotificationsProvider>
      <div className="app">
        <Sidebar profile={p} pendingPosts={pendingPosts ?? 0} emblemUrl={emblemUrl} />
        <div className="main">
          <TopBar role={p.role} />
          <main className="page">{children}</main>
        </div>
      </div>
    </NotificationsProvider>
  );
}
