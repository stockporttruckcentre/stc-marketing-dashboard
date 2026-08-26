/* =============================================================
   The one evaluator every saved view runs through.

   Migration 056 stores a view's filter as a JSON tree. This reads it.
   There is exactly one of these, and the screen has no privileged path
   around it, which is the claim the Work tab makes and has to keep:
   anything a view that ships can do, a view somebody builds can do too.

   ---- Why a tree and not a list of conditions ----

   Because the useful filters have brackets in them. "Due this week AND
   (mine OR my department) AND NOT cancelled" cannot be expressed as a
   flat list of ANDs, and every tool that tries ends up with a second,
   secret filter mechanism for the cases the first one cannot reach.

   ---- Why it resolves @me here rather than at save time ----

   A view saying `assignee_id is @me` means something different to each
   person who opens it, and that is the entire reason "My work" is one
   row instead of one row per employee. A shared view keeps working when
   it is handed to somebody else.
   ============================================================= */
import type { FilterNode, FilterLeaf, Task, TaskView } from './types';
import { PRIORITY_RANK, isOverdue } from './types';

/** Who is looking, and what that makes the placeholders mean. */
export type Viewer = {
  userId: string;
  departmentId: string | null;
  teamIds: string[];
  entityIds: string[];
  /** Task ids with an open release request pointed at this person. */
  releaseAskedOfMe?: string[];
};

/* Placeholders that resolve per reader. Anything not in here is taken
   literally, so a filter looking for the word "@me" in a title still
   works. */
function resolve(value: unknown, who: Viewer): unknown {
  if (value === '@me') return who.userId;
  if (value === '@myDepartment') return who.departmentId;
  if (value === '@myTeams') return who.teamIds;
  if (value === '@myEntities') return who.entityIds;
  if (Array.isArray(value)) return value.map((v) => resolve(v, who));
  return value;
}

/* Relative dates, as the strings a person would type into a view.
   "7d" is the next seven days; "-30d" is the last thirty. The sign is
   the direction, which keeps one spelling for both. */
function windowMs(spec: string): number | null {
  const m = /^(-?)(\d+)([dwmh])$/.exec(String(spec));
  if (!m) return null;
  const n = Number(m[2]);
  const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000, m: 2_592_000_000 }[m[3]]!;
  return (m[1] === '-' ? -1 : 1) * n * unit;
}

/* A field's value, including the handful that are computed rather than
   stored. `overdue` and `release_asked_of` are not columns: they are
   questions people filter by, and making them columns would mean
   keeping them true on every write. */
function read(task: Task, field: string, who: Viewer): unknown {
  switch (field) {
    case 'overdue':          return isOverdue(task);
    case 'priority_rank':    return PRIORITY_RANK[task.priority];
    case 'release_asked_of': return (who.releaseAskedOfMe ?? []).includes(task.id) ? who.userId : null;
    case 'has_parent':       return task.parent_id != null;
    case 'assignee':         return task.assignee_id ?? task.assignee_dept_id ?? task.assignee_team_id;
    default:                 return (task as unknown as Record<string, unknown>)[field];
  }
}

function toTime(v: unknown): number | null {
  if (v == null) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

function leaf(task: Task, node: FilterLeaf, who: Viewer, now: number): boolean {
  const actual = read(task, node.field, who);
  const wanted = resolve(node.value, who);

  switch (node.op) {
    case 'isSet':    return actual != null && actual !== '';
    case 'isNotSet': return actual == null || actual === '';
    case 'is':       return actual === wanted;
    case 'isNot':    return actual !== wanted;

    case 'in':       return Array.isArray(wanted) && wanted.includes(actual as never);
    case 'notIn':    return Array.isArray(wanted) && !wanted.includes(actual as never);

    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(wanted ?? '').toLowerCase());

    case 'gt':  return Number(actual) >   Number(wanted);
    case 'gte': return Number(actual) >=  Number(wanted);
    case 'lt':  return Number(actual) <   Number(wanted);
    case 'lte': return Number(actual) <=  Number(wanted);

    case 'before': {
      const at = toTime(actual);
      if (at == null) return false;
      return at < (wanted === 'now' ? now : toTime(wanted) ?? now);
    }
    case 'after': {
      const at = toTime(actual);
      if (at == null) return false;
      return at > (wanted === 'now' ? now : toTime(wanted) ?? now);
    }
    case 'within': {
      const at = toTime(actual);
      if (at == null) return false;
      const span = windowMs(String(wanted));
      if (span == null) return false;
      /* A negative span looks backward, a positive one forward, and
         both are inclusive of now. */
      return span < 0 ? at >= now + span && at <= now : at >= now && at <= now + span;
    }
    default: return false;
  }
}

/** Does this task belong in this view. */
export function matches(task: Task, node: FilterNode, who: Viewer, now = Date.now()): boolean {
  if ('all' in node) return node.all.every((n) => matches(task, n, who, now));
  if ('any' in node) return node.any.length === 0 || node.any.some((n) => matches(task, n, who, now));
  if ('not' in node) return !matches(task, node.not, who, now);
  return leaf(task, node as FilterLeaf, who, now);
}

/* Sorting. Priority sorts by rank rather than by the string, or P10
   would come between P1 and P2 the day somebody adds one. Nulls sort
   last in both directions, because a task with no due date is not
   more urgent than one due today. */
function compare(a: Task, b: Task, field: string, dir: 'asc' | 'desc', who: Viewer): number {
  const av = field === 'priority' ? PRIORITY_RANK[a.priority] : read(a, field, who);
  const bv = field === 'priority' ? PRIORITY_RANK[b.priority] : read(b, field, who);

  const aEmpty = av == null || av === '';
  const bEmpty = bv == null || bv === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let n: number;
  if (typeof av === 'number' && typeof bv === 'number') n = av - bv;
  else if (typeof av === 'boolean' && typeof bv === 'boolean') n = Number(av) - Number(bv);
  else {
    const at = toTime(av); const bt = toTime(bv);
    n = at != null && bt != null ? at - bt : String(av).localeCompare(String(bv));
  }
  return dir === 'desc' ? -n : n;
}

export function applyView(tasks: Task[], view: TaskView, who: Viewer, now = Date.now()): Task[] {
  const showDone = view.options?.showDone === true;
  return tasks
    .filter((t) => matches(t, view.filter, who, now))
    /* A view that does not ask for finished work does not get it, even
       when its own filter would have let it through. This is the switch
       people reach for first and it should not need editing a tree. */
    .filter((t) => showDone || (t.status !== 'done' && t.status !== 'cancelled')
                || (view.filter as { all?: unknown[] }).all?.some(
                     (n) => typeof n === 'object' && n !== null
                         && (n as FilterLeaf).field === 'status'))
    .sort((a, b) => {
      for (const s of view.sort) {
        const n = compare(a, b, s.field, s.dir, who);
        if (n !== 0) return n;
      }
      return (a.ref ?? '').localeCompare(b.ref ?? '');
    });
}

/** What a group of tasks is called, for a board column or a list section. */
export function groupKey(task: Task, by: string, who: Viewer): string {
  switch (by) {
    case 'none':       return '';
    case 'status':     return task.status;
    case 'priority':   return task.priority;
    case 'assignee':   return task.assignee_id ?? task.assignee_dept_id ?? '__unassigned';
    case 'project':    return task.project_id ?? '__none';
    case 'department': return task.assignee_dept_id ?? task.department_id ?? '__none';
    case 'due': {
      if (!task.due_at) return 'someday';
      const days = Math.floor((new Date(task.due_at).getTime() - Date.now()) / 86_400_000);
      if (days < 0) return 'overdue';
      if (days === 0) return 'today';
      if (days <= 7) return 'this_week';
      if (days <= 30) return 'this_month';
      return 'later';
    }
    default: return String(read(task, by, who) ?? '__none');
  }
}

/** The order due-date groups are shown in, which is not alphabetical. */
export const DUE_GROUP_ORDER = ['overdue', 'today', 'this_week', 'this_month', 'later', 'someday'];
export const DUE_GROUP_LABEL: Record<string, string> = {
  overdue: 'Overdue', today: 'Today', this_week: 'This week',
  this_month: 'This month', later: 'Later', someday: 'No date',
};
