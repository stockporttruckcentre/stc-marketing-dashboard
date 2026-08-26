import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Putting work on somebody.

   `work_assign` in migration 058 decides who may do this, and it draws
   a line that matters: picking something up YOURSELF needs work.edit,
   putting it on somebody ELSE needs work.assignOthers, and putting it
   on a department needs work.assignDepartment. Three asks, three
   answers.

   The four assignee columns refuse a direct write, so this is the only
   road in. The screen cannot reach around it.
   ============================================================= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  /* work.edit is the floor: it is what picking up your own work needs.
     Anything beyond that is asked for by the function itself, which is
     the check that actually stops something. */
  const gate = await requireCapability('work.edit');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const kind = String(b.kind ?? '');
  if (!['person', 'department', 'team', 'unassigned'].includes(kind)) {
    return NextResponse.json({ error: 'Say who this is for.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('work_assign', {
    p_task: params.id,
    p_kind: kind,
    p_user: kind === 'person' ? (b.user ?? null) : null,
    p_dept: kind === 'department' ? (b.dept ?? null) : null,
    p_team: kind === 'team' ? (b.team ?? null) : null,
    p_note: b.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
