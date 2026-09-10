import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { screenCapabilities } from '@/lib/platform/permissions/resolve';
import { ReportsHub } from '@/components/ReportsHub';
import { reportBySlug } from '@/lib/reports/catalogue';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Reports.

   Below Diary in Workspace, which is where the business put it: a
   report is something you run before a meeting, next to the diary that
   told you the meeting was happening.

   Nothing about WHO SEES WHAT is decided here or in the builder. Every
   query a report makes runs as the reader, so row level security answers
   it once: a rep running the bi-weekly report sees their own pipeline in
   it, the sales director sees everybody's, and neither of them needed a
   branch in the report code to make that true.

   The one thing this page decides is whether to offer the person filter
   at all. A list of colleagues is itself information, and a rep has no
   reason to receive one from this screen, so the names are only fetched
   for somebody who may already look at other people's work.
   ============================================================= */
export default async function ReportsPage({
  searchParams,
}: { searchParams?: { report?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  const profile = profileRow as Profile | null;
  const caps = await screenCapabilities(supabase, profile, user.id);

  if (!caps.has('reports.view')) redirect('/dashboard');

  const { data: people } = caps.has('crm.viewOthers')
    ? await supabase.from('profiles').select('id, full_name, email').order('full_name')
    : { data: null };

  /* `?report=<slug>` opens straight onto one, which is how every
     command bar entry reaches its own report. A slug naming nothing
     opens the catalogue rather than an error: a stale link in somebody's
     message should land them on the list, not on a dead end. */
  const asked = searchParams?.report?.trim() || null;

  return (
    <ReportsHub
      people={(people ?? []) as { id: string; full_name: string | null; email: string | null }[]}
      mayExport={caps.has('reports.export')}
      initial={asked && reportBySlug(asked) ? asked : null}
    />
  );
}
