import { redirect } from 'next/navigation';
import { guardRoute } from '@/lib/platform/permissions/route-guard';
import { NoAccess } from '@/components/platform/NoAccess';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsHub } from '@/components/analytics/legacy/AnalyticsHub';

export const dynamic = 'force-dynamic';

/* =============================================================
   Analytics.

   From the business:

     sales team wants analytics page rolling back. Take that page only
     from a788cc9, don't roll anything else back.

   So this is the screen exactly as it stood at a788cc9. Nothing about
   it is a rebuild or a reinterpretation: `components/analytics/legacy/`
   already held a byte for byte copy of that page, kept when the hub was
   rewritten precisely so it could be put back, and the only difference
   between those files and the ones in that commit is the folder the
   imports name.

   ---- What went, and what did not ----

   The landing and the six drill-downs are still in the repository and
   still build. They are not routed to. Bringing them back is a change
   to this one file plus the seven route files that went with it, which
   is the whole point of leaving the code where it is.

   `/dashboard/analytics/targets` STAYS. It is not part of this page and
   never was: it is the administrators' screen for setting what a
   division is measured against, asked for separately, reached from the
   command bar by typing "set a target", and the old page has no way of
   editing a target at all. Rolling it back would remove something
   nobody asked to lose.

   ---- Nothing else moved ----

   No migration is reverted. Every RPC this page calls
   (`division_revenue`, `division_by_month`, `division_pipeline`,
   `division_customers`, and the finance helpers behind the detail) is
   still there, and the ones added since only added.
   ============================================================= */
export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* `analytics.view`, not `crm.view`. Analytics and Reports were gated
     on the same capability, so there was no way to grant one and
     withhold the other, and the office administrators need exactly
     that: "run reports ... No analytics tab". Migration 103. */
  const verdict = await guardRoute(supabase, '/dashboard/analytics');
  if (verdict.state !== 'allowed') return <NoAccess verdict={verdict} page="Analytics" />;

  return <AnalyticsHub />;
}
