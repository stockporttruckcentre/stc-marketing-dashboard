import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Asking to be let off a task.

   The request goes to whoever assigned it. Everything about who that
   is, whether the work is actually yours to hand back, and whether you
   already have a request open on it, is decided by
   `work_request_release` in migration 058.
   ============================================================= */
const ASKS = new Set(['cancel', 'reassign', 'extend', 'declassify']);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.requestRelease');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const ask = String(body.ask ?? '');
  if (!ASKS.has(ask)) {
    return NextResponse.json({ error: 'Ask to cancel it, pass it on, or move the date.' }, { status: 400 });
  }
  if (!String(body.reason ?? '').trim()) {
    return NextResponse.json({ error: 'Say why. A request with no reason cannot be answered.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('work_request_release', {
    p_task: params.id,
    p_ask: ask,
    p_reason: String(body.reason),
    p_to_user: body.suggestUser ?? null,
    p_to_dept: body.suggestDept ?? null,
    p_to_team: body.suggestTeam ?? null,
    p_due: body.due ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
