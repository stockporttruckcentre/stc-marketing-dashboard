import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Answering a request to be let off a task.

   Granting one APPLIES the outcome in the same transaction: cancelling
   the work, moving it to somebody else, or shifting the date. A request
   marked granted while the task still sits on the same person with the
   same date is the exact failure the whole mechanism exists to stop, so
   the two are never two calls.
   ============================================================= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.decideRelease');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  if (typeof body.grant !== 'boolean') {
    return NextResponse.json({ error: 'Say whether it is granted or refused.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('work_decide_release', {
    p_request: params.id,
    p_grant: body.grant,
    p_note: body.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
