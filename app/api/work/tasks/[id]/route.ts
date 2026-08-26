import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Editing the parts of a task that are not workflow.

   Status, the four assignee columns and the due date are NOT here.
   Those refuse a direct write and go through their own routes, because
   each one carries a rule: what a status may move to, who may put work
   on somebody else, and whose date it is.

   What is left is description, priority, estimate and where the work
   sits in the structure. Ordinary fields, covered by `tasks_update`,
   which already limits editing to somebody involved unless they hold
   work.editAny.
   ============================================================= */

/* An allowlist rather than a passthrough. A route that writes whatever
   arrives is a route that writes `is_sensitive: false` the day somebody
   posts it, and the gated columns would be reachable by name. */
const WRITABLE = new Set([
  'title', 'description', 'priority', 'project_id', 'workstream_id',
  'milestone_id', 'department_id', 'estimate_minutes', 'starts_on',
  'reviewer_id', 'organisation_id', 'person_id', 'lead_id', 'stock_trailer_id',
]);

const PRIORITIES = ['p0', 'p1', 'p2', 'p3'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.edit');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(b)) {
    if (!WRITABLE.has(k)) continue;
    patch[k] = v === '' ? null : v;
  }

  if (typeof patch.title === 'string') {
    const t = patch.title.trim();
    if (!t) return NextResponse.json({ error: 'A task needs a title.' }, { status: 400 });
    patch.title = t;
  }
  if (patch.priority !== undefined && !PRIORITIES.includes(String(patch.priority))) {
    return NextResponse.json({ error: 'Priority is P0 to P3.' }, { status: 400 });
  }
  if (patch.estimate_minutes !== undefined && patch.estimate_minutes !== null) {
    const n = Number(patch.estimate_minutes);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'An estimate is a number of minutes.' }, { status: 400 });
    }
    patch.estimate_minutes = Math.round(n);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from('tasks').update(patch).eq('id', params.id).select('*').single();

  if (error) {
    /* An update that matches no row is the policy refusing, not a
       missing task: RLS makes a row somebody may not edit look absent. */
    if (error.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'You can only change work you raised, were given, or are named on.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
