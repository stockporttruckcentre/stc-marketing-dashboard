/* =============================================================
   Work, as the screen sees it.

   Mirrors migration 056. Where a name differs from the column it came
   from, the column is named in a comment, because a type that quietly
   renames its own table is how a field ends up written to nothing.

   Three names differ from the package this came in with, and all three
   are because the record they point at is different here. The package's
   `opportunity_id` pointed at an `opportunities` table; this CRM keeps
   one customer in `crm_contacts` and unlimited pitches against them in
   `crm_leads`, so it is `lead_id`. `stock_trailer_id` is new, because at
   a truck dealership a great deal of the work is about one trailer.
   `is_mnpi` became `is_sensitive`: STC is not a listed company, so the
   flag means commercially sensitive rather than market moving.
   ============================================================= */

export type TaskStatus =
  | 'backlog' | 'ready' | 'in_progress' | 'blocked'
  | 'waiting_external' | 'in_review' | 'done' | 'cancelled';

export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type AssigneeKind = 'person' | 'department' | 'team' | 'unassigned';
export type DelegationAsk = 'cancel' | 'reassign' | 'extend' | 'declassify';
export type DelegationState = 'open' | 'granted' | 'refused' | 'withdrawn';
export type Layout = 'board' | 'table' | 'list' | 'calendar' | 'timeline' | 'workload';

/* The order work moves in. Used for board columns and for anything that
   has to sort by how far along something is, which no alphabetical sort
   of the status name gets right. */
export const STATUS_ORDER: TaskStatus[] = [
  'backlog', 'ready', 'in_progress', 'blocked',
  'waiting_external', 'in_review', 'done', 'cancelled',
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  waiting_external: 'Waiting on somebody outside',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};

/* Which statuses count as work that is still live. One definition, so
   a count on a tab and the rows inside it cannot disagree. */
export const OPEN_STATUSES: TaskStatus[] =
  STATUS_ORDER.filter((s) => s !== 'done' && s !== 'cancelled');

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  p0: 'P0', p1: 'P1', p2: 'P2', p3: 'P3',
};

/* P0 is the only priority that gets a hue, and it gets the danger
   token rather than a red of its own. The kit's first rule: red points
   at the single most important thing, and "this one is on fire" is
   that. Everything else steps down the ink ramp, so a wall of P2s
   reads as a wall of work rather than a wall of colour. */
export const PRIORITY_TONE: Record<TaskPriority, string> = {
  p0: 'var(--danger)',
  p1: 'var(--text)',
  p2: 'var(--text-muted)',
  p3: 'var(--text-subtle)',
};

export type Task = {
  id: string;
  ref: string | null;
  title: string;
  description: string | null;

  project_id: string | null;
  workstream_id: string | null;
  milestone_id: string | null;
  department_id: string | null;
  parent_id: string | null;

  assignee_kind: AssigneeKind;
  assignee_id: string | null;
  assignee_dept_id: string | null;
  assignee_team_id: string | null;
  reviewer_id: string | null;
  approver_id: string | null;
  delegated_by: string | null;
  delegated_at: string | null;

  status: TaskStatus;
  priority: TaskPriority;

  starts_on: string | null;
  due_at: string | null;
  original_due_at: string | null;
  estimate_minutes: number | null;
  spent_minutes: number;

  blocked_reason: string | null;
  blocked_since: string | null;
  waiting_on: string | null;

  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  cancelled_reason: string | null;

  /* What the work is about. Every one is a foreign key, which is the
     point: a link that cannot be joined cannot answer a question. */
  organisation_id: string | null;
  person_id: string | null;
  lead_id: string | null;
  stock_trailer_id: string | null;
  meeting_id: string | null;
  content_post_id: string | null;

  source: string;
  batch_id: string | null;
  recurrence_id: string | null;
  board_position: number;

  owning_entity_id: string | null;
  classification: string;
  is_sensitive: boolean;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string; key: string; name: string; description: string | null;
  owner_id: string | null; sponsor_id: string | null; department_id: string | null;
  status: string; priority: TaskPriority;
  health: 'unknown' | 'on_track' | 'at_risk' | 'off_track';
  health_note: string | null;
  starts_on: string | null; target_on: string | null; completed_on: string | null;
  is_public: boolean; public_name: string | null;
  color: string | null; archived_at: string | null;
  owning_entity_id: string | null;
};

export type Milestone = {
  id: string; project_id: string; workstream_id: string | null;
  title: string; public_title: string | null; owner_id: string | null;
  status: string; target_on: string | null; actual_on: string | null;
  is_public: boolean; position: number;
};

export type TaskView = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  owner_id: string | null;
  is_system: boolean;
  layout: Layout;
  group_by: string;
  sub_group_by: string | null;
  sort: { field: string; dir: 'asc' | 'desc' }[];
  filter: FilterNode;
  fields: string[];
  options: Record<string, unknown>;
  position: number;
};

export type DelegationRequest = {
  id: string; task_id: string;
  asked_by: string; asked_of: string | null;
  ask: DelegationAsk; reason: string;
  suggest_kind: AssigneeKind | null;
  suggest_user: string | null; suggest_dept: string | null; suggest_team: string | null;
  suggest_due: string | null;
  state: DelegationState;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  created_at: string;
};

export type Person = {
  id: string; full_name: string; email: string | null; role: string;
  department_id: string | null; department_name: string | null;
  primary_entity_id: string | null;
  primary_entity_code: string | null;
  primary_entity_name: string | null;
  entity_ids: string[];
  is_cross_entity: boolean;
};

export type Entity = { id: string; code: string; name: string; ticker: string | null };
export type Department = { id: string; name: string; entity_id: string | null };

/* ---- the filter grammar, as migration 056 documents it ---- */

export type FilterLeaf = {
  field: string;
  op: 'is' | 'isNot' | 'in' | 'notIn' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
    | 'isSet' | 'isNotSet' | 'before' | 'after' | 'within';
  value?: unknown;
};
export type FilterNode =
  | { all: FilterNode[] }
  | { any: FilterNode[] }
  | { not: FilterNode }
  | FilterLeaf;

/** What a task is worth, for sorting by how urgent it is. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function isOverdue(t: Task, now = new Date()): boolean {
  if (!t.due_at) return false;
  if (t.status === 'done' || t.status === 'cancelled') return false;
  return new Date(t.due_at) < now;
}

/** How long something has been stuck, in whole days. */
export function stuckDays(t: Task, now = new Date()): number | null {
  if (!t.blocked_since) return null;
  return Math.floor((now.getTime() - new Date(t.blocked_since).getTime()) / 86_400_000);
}

/** Hours, from the minutes the column holds. Never a bare decimal. */
export function hoursFrom(minutes: number | null | undefined): string | null {
  if (minutes == null) return null;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}
