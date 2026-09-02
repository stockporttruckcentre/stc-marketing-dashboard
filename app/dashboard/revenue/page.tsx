import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RevenuePanel } from '@/components/RevenuePanel';

export const dynamic = 'force-dynamic';

/* =============================================================
   Who gets through this door.

   Reading revenue is `crm.view`, which is the same permission that
   opens a customer record, because what a company has spent is on that
   record anyway and gating the two differently would be a fiction.

   Importing is `crm.import`, asked separately and passed down so the
   Import tab is not drawn for somebody who would be refused at the
   database. The tab is a courtesy: every write function asks the same
   question again for itself.
   ============================================================= */
export default async function RevenuePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  const { data: mayImport } = await supabase.rpc('command_may', { p_capability: 'crm.import' });

  return <RevenuePanel mayImport={mayImport === true} />;
}
