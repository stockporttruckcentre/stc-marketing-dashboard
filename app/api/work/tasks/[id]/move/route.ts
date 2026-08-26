import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Moving a task from one status to another.

   One route for every move, because they all have the same shape. Which
   moves are legal, and what each one costs, is `task_transitions` in
   migration 058, so this file does not hold a second copy of the rules
   that would drift from the first.

   `work.edit` is the floor. Anything a particular move needs on top of
   that is asked for in the database, which is the check that actually
   stops something: this one exists to produce a sentence a person can
   read rather than a raw exception.
   ============================================================= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.edit');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? '');
  if (!to) return NextResponse.json({ error: 'Say which status to move it to.' }, { status: 400 });

  const { data, error } = await gate.supabase.rpc('work_move', {
    p_task: params.id,
    p_to: to,
    p_reason: body.reason ?? null,
    p_note: body.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
