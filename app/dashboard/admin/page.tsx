import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AdminPanel } from '@/components/AdminPanel';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const p = profile as Profile | null;
  if (p?.role !== 'admin') redirect('/dashboard');

  const { data: team } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
  return <AdminPanel team={(team ?? []) as Profile[]} selfId={user!.id} />;
}
