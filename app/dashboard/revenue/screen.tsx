import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RevenuePanel } from '@/components/RevenuePanel';
import type { Division } from '@/lib/protean/rpc';

/* =============================================================
   One screen per division, from one place.

   Two pages that differ by two strings are two pages that drift: the
   day somebody fixes a redirect or a permission on one of them, the
   other still has the old behaviour and nobody looks.

   ---- Who gets through this door ----

   Reading revenue is `crm.view`, the same permission that opens a
   customer record, because what a company has spent is on that record
   anyway and gating the two differently would be a fiction.

   Importing is `crm.import`, asked separately and passed down so the
   Import tab is not drawn for somebody who would be refused at the
   database. The tab is a courtesy: every write function asks the same
   question again for itself.
   ============================================================= */
export async function revenueScreen(division: Division, divisionName: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  const { data: mayImport } = await supabase.rpc('command_may', { p_capability: 'crm.import' });

  return (
    <RevenuePanel
      mayImport={mayImport === true}
      division={division}
      divisionName={divisionName}
    />
  );
}
