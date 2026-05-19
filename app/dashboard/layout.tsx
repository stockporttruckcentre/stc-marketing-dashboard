import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { Nav } from '@/components/Nav';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const { data: lusha } = await supabase
    .from('lusha_credits')
    .select('balance')
    .limit(1)
    .single();

  const p = (profile as Profile) ?? {
    id: user.id,
    email: user.email!,
    full_name: user.email!.split('@')[0],
    role: 'viewer' as const,
    created_at: new Date().toISOString(),
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header profile={p} lushaBalance={lusha?.balance ?? 0} />
      <Nav role={p.role} />
      <main className="flex-1 max-w-screen-3xl w-full mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
