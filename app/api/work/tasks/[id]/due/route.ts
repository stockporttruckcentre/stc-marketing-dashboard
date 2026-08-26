import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Moving a date.

   Setting a date on work nobody handed you is editing. Moving one that
   somebody above you set is not, and `work_set_due` refuses it without
   work.setDue, naming the extension request as the way through. That
   refusal is the feature: a deadline somebody committed to should cost
   a conversation to change, not a click.
   ============================================================= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.edit');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const due = b.due ? new Date(String(b.due)) : null;
  if (b.due && Number.isNaN(due?.getTime())) {
    return NextResponse.json({ error: 'That is not a date.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('work_set_due', {
    p_task: params.id,
    p_due: due ? due.toISOString() : null,
    p_note: b.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
