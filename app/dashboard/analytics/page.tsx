import { redirect } from 'next/navigation';
import { guardRoute } from '@/lib/platform/permissions/route-guard';
import { NoAccess } from '@/components/platform/NoAccess';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsHub } from '@/components/analytics/legacy/AnalyticsHub';
import { COMPANY, scopeFromQuery, type Scope, type Viewable } from '@/lib/analytics/scope';

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
/* =============================================================
   Personal, the fifth scope, and where it is decided.

   From the agreed development scope, Task 1:

     This must be enforced server-side. Hiding the person selector in
     React is not permission enforcement. Any API/RPC/query accepting a
     selected person must independently validate that the signed-in
     actor is authorised to view that person.

   So the address bar is read HERE, on the server, and the person it
   names is put to `personal_analytics_may_view` before the page is
   drawn. A `sales_rep` who types a colleague's UUID into the query
   string gets their own Personal view, because that is the only one
   they are allowed, and no request for anybody else's figures is ever
   made on their behalf.

   The list of people they may open comes from the same database
   function the rule is made of, so the selector cannot offer somebody
   the rule would then refuse. Every figure behind it asks again.
   ============================================================= */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { scope?: string | string[]; person?: string | string[] };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* `analytics.view`, not `crm.view`. Analytics and Reports were gated
     on the same capability, so there was no way to grant one and
     withhold the other, and the office administrators need exactly
     that: "run reports ... No analytics tab". Migration 103. */
  const verdict = await guardRoute(supabase, '/dashboard/analytics');
  if (verdict.state !== 'allowed') return <NoAccess verdict={verdict} page="Analytics" />;

  /* Whether Personal exists for this person at all. Not `analytics.view`:
     the scope names five role templates and says in as many words that
     Finance, Marketing, Admin Operations, HR, Department Manager and
     Read Only do not get Personal even though they can open Analytics. */
  const { data: eligible } = await supabase.rpc('personal_analytics_eligible');
  const canPersonal = eligible === true;

  const { data: peopleRows } = canPersonal
    ? await supabase.rpc('personal_analytics_people')
    : { data: [] };
  const people = (peopleRows ?? []) as Viewable[];

  const asked = scopeFromQuery(searchParams);
  let scope: Scope = asked;

  if (asked.kind === 'personal') {
    if (!canPersonal) {
      /* Personal is not theirs. The rest of Analytics still is, so they
         land on the company rather than on a refusal. */
      scope = COMPANY;
    } else if (asked.person && asked.person !== user.id) {
      /* THE TAMPERED LINK. Asked of the database rather than of the
         list above, because the list is a convenience and this is the
         rule. A no puts them on their own Personal view, which is the
         one thing they are certainly allowed. */
      const { data: mayView } = await supabase.rpc('personal_analytics_may_view', {
        p_person: asked.person,
      });
      scope = { kind: 'personal', person: mayView === true ? asked.person : user.id };
    } else {
      /* `?scope=personal` with nobody named is "whoever is signed in",
         which is what Task 4's dashboard link writes. */
      scope = { kind: 'personal', person: user.id };
    }
  }

  return (
    <AnalyticsHub
      initialScope={scope}
      canPersonal={canPersonal}
      people={people}
      selfId={user.id}
    />
  );
}
