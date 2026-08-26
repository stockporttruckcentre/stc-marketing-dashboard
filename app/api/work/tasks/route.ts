import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Raising work.

   The insert goes straight at the table, which is deliberate. The
   `tasks_insert` policy in migration 056 is the rule, and it is more
   exact than a wrapper function would be: raising work for yourself
   needs work.create, putting it on somebody else needs
   work.assignOthers, and putting it on a department needs
   work.assignDepartment. Three different answers to three different
   asks, decided in one place.

   `ref`, `owning_entity_id` and `board_position` are all filled by
   triggers. Sending them from here would be the screen guessing at
   values the database already knows.
   ============================================================= */

const KINDS = ['person', 'department', 'team', 'unassigned'];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
/* Work can be raised straight into any of these. The rest are arrived
   at by moving, which is what `task_transitions` governs, so offering
   them here would be a second set of rules to keep in step. */
const OPENING = ['backlog', 'ready', 'in_progress'];

export async function POST(req: NextRequest) {
  const gate = await requireCapability('work.create');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));

  const title = String(b.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'Give it a title.' }, { status: 400 });
  if (title.length > 300) {
    return NextResponse.json({ error: 'That title is too long for a task.' }, { status: 400 });
  }

  const kind = KINDS.includes(b.assignee_kind) ? b.assignee_kind : 'unassigned';

  /* The four assignee columns have to agree with the kind, and the table
     enforces it. Saying so here turns a raw constraint name into a
     sentence, which is the difference between a form somebody can fix
     and a form somebody gives up on. */
  if (kind === 'person' && !b.assignee_id) {
    return NextResponse.json({ error: 'Pick who this is for, or leave it unassigned.' }, { status: 400 });
  }
  if (kind === 'department' && !b.assignee_dept_id) {
    return NextResponse.json({ error: 'Pick a department, or leave it unassigned.' }, { status: 400 });
  }
  if (kind === 'team' && !b.assignee_team_id) {
    return NextResponse.json({ error: 'Pick a team, or leave it unassigned.' }, { status: 400 });
  }
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'p2';
  const status = OPENING.includes(b.status) ? b.status : 'backlog';

  /* The three assignee ids the kind does not need are nulled rather
     than passed through. Sending a stale id alongside a changed kind is
     the obvious way for a form to break that CHECK constraint. */
  const row: Record<string, unknown> = {
    title,
    description: b.description ? String(b.description).trim() || null : null,
    priority,
    status,
    assignee_kind: kind,
    assignee_id: kind === 'person' ? (b.assignee_id ?? null) : null,
    assignee_dept_id: kind === 'department' ? (b.assignee_dept_id ?? null) : null,
    assignee_team_id: kind === 'team' ? (b.assignee_team_id ?? null) : null,
    due_at: b.due_at ? new Date(String(b.due_at)).toISOString() : null,
    starts_on: b.starts_on ? String(b.starts_on).slice(0, 10) : null,
    estimate_minutes: Number.isFinite(Number(b.estimate_minutes)) && Number(b.estimate_minutes) > 0
      ? Math.round(Number(b.estimate_minutes)) : null,
    project_id: b.project_id || null,
    department_id: b.department_id || null,
    parent_id: b.parent_id || null,
    /* What the work is about. A task raised from a customer, a pitch or
       a trailer keeps the link, which is what lets somebody ask what is
       outstanding on STC145505 and get an answer. */
    organisation_id: b.organisation_id || null,
    lead_id: b.lead_id || null,
    stock_trailer_id: b.stock_trailer_id || null,
    classification: b.classification ?? 'internal',
    is_sensitive: b.is_sensitive === true,
    created_by: gate.user.id,
    source: 'manual',
  };

  /* Only sent when somebody who works for both companies picked one.
     Left off, the trigger stamps their main company, which is the right
     answer for everybody else. */
  if (b.owning_entity_id) row.owning_entity_id = b.owning_entity_id;

  /* Work put on somebody else is delegated work, and that is what makes
     it refusable later. Work you raise for yourself is not: there is
     nobody to ask. */
  if (kind === 'person' && b.assignee_id && b.assignee_id !== gate.user.id) {
    row.delegated_by = gate.user.id;
    row.delegated_at = new Date().toISOString();
  }
  if (kind === 'department' || kind === 'team') {
    row.delegated_by = gate.user.id;
    row.delegated_at = new Date().toISOString();
  }

  const { data, error } = await gate.supabase.from('tasks').insert(row).select('*').single();
  if (error) return NextResponse.json({ error: readable(error.message) }, { status: 400 });
  return NextResponse.json(data);
}

/** Turn a policy refusal into something a person can act on. */
function readable(message: string): string {
  if (/row-level security|violates row-level/i.test(message)) {
    return 'You cannot put work on somebody else. Raise it for yourself, or ask an administrator for that permission.';
  }
  if (/tasks_assignee_agrees/i.test(message)) {
    return 'Pick who this is for, or leave it unassigned.';
  }
  return message;
}
