import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
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

  const p = (profile as Profile) ?? {
    id: user.id,
    email: user.email!,
    full_name: user.email!.split('@')[0],
    role: 'viewer' as const,
    created_at: new Date().toISOString(),
  };

  return (
    <div className="app" data-theme={p.theme ?? "dark"} suppressHydrationWarning>
      <Sidebar profile={p} pendingPosts={pendingPosts ?? 0} />
      <div className="main">
        <TopBar />
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
