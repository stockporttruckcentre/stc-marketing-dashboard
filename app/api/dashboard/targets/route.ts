import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/* =============================================================
   The financial year targets, for the dashboard.

   From the agreed development scope, Task 4:

     Use the same target and actual definitions as Personal Analytics.
     There must not be one calculation on the dashboard and another in
     Analytics.

   So this route does no arithmetic. It calls `personal_overview`, the
   same function the Personal Analytics screen calls, and hands back the
   row. A figure that disagrees between the two screens would have to
   come from the database disagreeing with itself.

   It is a route rather than a browser query because that is this
   dashboard's rule, written down in docs/dashboard-upgrade-plan.md.

   ---- What is deliberately absent ----

   A company target. The business has not set one, so `company.target`
   is null and the screen says "Not set". There is no progress bar
   against it, because progress against nothing is not nought per cent.
   ============================================================= */

/** A database that has not had migration 117 or 118 pasted in yet. */
function notThereYet(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42883' || code === '42P01' || code === '42703';
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: eligible, error: eligErr } = await supabase.rpc('personal_analytics_eligible');
  if (eligErr && notThereYet(eligErr)) {
    return NextResponse.json({
      ok: true,
      available: false,
      needs: 'migration 117 and 118, which are the SQL handed over in chat',
    });
  }

  const canPersonal = eligible === true;

  /* Only ever about the person signed in. A manager who wants somebody
     else's figures opens Personal Analytics and switches there, where
     the ladder is already enforced. A dashboard that took a person
     parameter would be a second door onto the same data. */
  const [{ data: personalRows }, { data: companyTarget }] = await Promise.all([
    canPersonal
      ? supabase.rpc('personal_overview', { p_person: user.id, p_when: null })
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.rpc('company_fy_target', { p_when: null }),
  ]);

  const personal = ((personalRows ?? []) as Record<string, unknown>[])[0] ?? null;

  /* The company's own revenue this year, where the divisions can answer
     it. Shown beside "Not set" rather than instead of it: what the
     company has billed is a fact, and having no target is a different
     fact. */
  const { data: divisions } = await supabase.rpc('division_revenue', { p_upto: null });
  const rows = (divisions ?? []) as { this_year: number | string }[];
  const companyActual = rows.length
    ? rows.reduce((n, d) => n + Number(d.this_year || 0), 0)
    : null;

  return NextResponse.json({
    ok: true,
    available: true,
    canPersonal,
    personal,
    company: {
      /* Null, and the screen must print "Not set" for it. */
      target: companyTarget == null ? null : Number(companyTarget),
      actual: companyActual,
    },
  });
}
