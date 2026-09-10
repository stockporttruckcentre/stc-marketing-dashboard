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

   Reading revenue is `revenue.view` and importing is `revenue.import`,
   both of which used to be `crm.view` and `crm.import`.

   That was a fiction and migration 103 is where it stopped being one.
   From the business, describing the office administrators: "see the
   revenue tab entirely and import but no export". They hold neither
   CRM capability and should not: importing invoicing has nothing to do
   with bulk loading customers, and reading what a haulier has spent is
   not the same right as opening their record and editing it.

   Migration 104 repoints the five Protean import functions to match, so
   the tab this decides to draw and the function behind it now ask the
   same question. The tab is still only a courtesy: every write function
   asks for itself, inside the transaction.
   ============================================================= */
export async function revenueScreen(division: Division, divisionName: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'revenue.view' });
  if (mayRead !== true) redirect('/dashboard');

  const { data: mayImport } = await supabase.rpc('command_may', { p_capability: 'revenue.import' });

  return (
    <RevenuePanel
      mayImport={mayImport === true}
      division={division}
      divisionName={divisionName}
    />
  );
}
