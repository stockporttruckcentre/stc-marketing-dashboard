import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Setting what a division is measured against.

   Its own capability rather than `crm.edit`, and its own route rather
   than a column write, because a target is not data about the business:
   it is the line the business is judged against. The people who read it
   and the person who moves it are different people, and an MD who can
   see he is behind should not be able to move the line.

   `analytics_set_target` in migration 100 holds the rule and checks the
   role itself, so a caller that got past this guard some other way is
   still refused by Postgres. The guard is here as well because a
   refusal from a route is a sentence somebody can act on and a refusal
   from row level security is an error code.
   ============================================================= */
export async function POST(req: NextRequest) {
  const gate = await requireCapability('analytics.targets');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const month = typeof b.month === 'string' ? b.month : null;
  const division = typeof b.division === 'string' && b.division ? b.division : null;
  const amount = Number(b.amount);

  if (!month || !/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Which month?' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'A target is a number, or nought to clear it.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('analytics_set_target', {
    p_month: month, p_division: division, p_amount: amount,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const said = data as { ok: boolean; why?: string };
  if (!said?.ok) return NextResponse.json({ error: said?.why ?? 'That did not go through.' }, { status: 403 });
  return NextResponse.json(said);
}

/* =============================================================
   Reading the targets back

   The hub asks for these inside its one big `/api/analytics` call,
   which is right for a page that draws them on a chart. The targets
   screen is not that page: it edits a financial year, twelve months at
   a time, and it needs the figures again after every save.

   Same function, same gate. `analytics_targets_by_month` returns the
   group row and the per division rows together, with a null division
   meaning the group.
   ============================================================= */
export async function GET() {
  const gate = await requireCapability('analytics.targets');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .rpc('analytics_targets_by_month', { p_months: 36 });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    targets: (data ?? []) as { month: string; division: string | null; target: number }[],
  });
}
