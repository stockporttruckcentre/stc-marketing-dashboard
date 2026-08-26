'use client';

/* =============================================================
   Six ways to look at the same rows.

   Each one takes the tasks a view has already filtered and sorted, and
   decides only how to draw them. None of them filters, and that is the
   point: change the view and every layout changes with it, so switching
   from a board to a table never silently shows you a different set of
   work.

   All six are drawn from `components/kit` and semantic tokens. Density
   is the kit's: 36px rows, 14px base, 1px rules carrying the structure
   and elevation kept for the things that genuinely float.
   ============================================================= */
import type React from 'react';
import { Fragment, useMemo, useState } from 'react';
import type { Task, TaskView, Person, Entity } from '@/lib/work/types';
import { STATUS_ORDER, STATUS_LABEL, OPEN_STATUSES, isOverdue } from '@/lib/work/types';
import { groupKey, DUE_GROUP_ORDER, DUE_GROUP_LABEL, type Viewer } from '@/lib/work/filter';
import { Bar, Button, Label } from '@/components/kit/primitives';
import { Who, StatusPill, Priority, Due, Empty, EntityChip, Tail, Avatar, initials } from './parts';

export type LayoutProps = {
  tasks: Task[];
  view: TaskView;
  who: Viewer;
  people: Map<string, Person>;
  departments: Map<string, string>;
  entities: Map<string, Entity>;
  projects: Map<string, string>;
  onOpen: (t: Task) => void;
  onMove: (t: Task, toStatus: string, position: number) => void;
  /* An empty state without something to do about it is a dead end, and
     the kit says every one of them carries an action. Absent when the
     person looking cannot raise work, because an action that refuses is
     worse than no action. */
  onNew: (() => void) | null;
  /* What is narrowing the view beyond its own filter, and how to undo
     it. The kit's second kind of empty state names the filter and
     offers to clear it, because "nothing here" plus an unnoticed filter
     is how people conclude the data is missing. */
  narrowed: string | null;
  onClear: (() => void) | null;
  busy: string | null;
};

const SCROLL: React.CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto' };
const PANEL: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', display: 'flex', flexDirection: 'column',
  flex: 1, minHeight: 0, overflow: 'hidden',
};

/* What a group is called. Kept here rather than in each layout so a
   board column and a list section that group the same way say the same
   word. */
function groupLabel(key: string, by: string, ctx: LayoutProps): string {
  if (by === 'status') return STATUS_LABEL[key as keyof typeof STATUS_LABEL] ?? key;
  if (by === 'due') return DUE_GROUP_LABEL[key] ?? key;
  if (by === 'priority') return key.toUpperCase();
  if (by === 'assignee') {
    if (key === '__unassigned') return 'Unassigned';
    return ctx.people.get(key)?.full_name ?? ctx.departments.get(key) ?? 'Somebody';
  }
  if (by === 'project') return key === '__none' ? 'No project' : ctx.projects.get(key) ?? 'A project';
  if (by === 'department') return key === '__none' ? 'No department' : ctx.departments.get(key) ?? 'A department';
  return key || 'All';
}

/* The order groups appear in. Alphabetical is wrong for every one of
   these: a board reading Backlog, Blocked, Done, In progress teaches
   nothing about how work moves. */
function groupOrder(keys: string[], by: string): string[] {
  if (by === 'status') return STATUS_ORDER.filter((s) => keys.includes(s));
  if (by === 'due') return DUE_GROUP_ORDER.filter((k) => keys.includes(k));
  if (by === 'priority') return ['p0', 'p1', 'p2', 'p3'].filter((k) => keys.includes(k));
  return [...keys].sort();
}

function group(tasks: Task[], by: string, who: Viewer): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = groupKey(t, by, who);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return m;
}

/** The heading over a board column or a list section. The kit's label step. */
function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 32, padding: '0 12px', flex: 'none',
      borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)',
    }}>
      <Label>{label}</Label>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
      }}>{count}</span>
    </div>
  );
}

/* ---------------- board ---------------- */
export function BoardLayout(p: LayoutProps) {
  const [over, setOver] = useState<string | null>(null);
  const by = p.view.group_by === 'none' ? 'status' : p.view.group_by;
  const groups = useMemo(() => group(p.tasks, by, p.who), [p.tasks, by, p.who]);

  /* A board grouped by status shows every column the work can be in,
     including the empty ones, because an empty In review column is
     information and a missing one is a puzzle. */
  const keys = by === 'status'
    ? (p.view.options?.showDone ? STATUS_ORDER : OPEN_STATUSES)
    : groupOrder([...groups.keys()], by);

  return (
    <div style={{ ...SCROLL, display: 'flex', gap: 10, alignItems: 'stretch', paddingBottom: 4 }}>
      {keys.map((key) => {
        const list = groups.get(key) ?? [];
        const dropping = over === key;
        return (
          <div
            key={key}
            onDragOver={(e) => { e.preventDefault(); setOver(key); }}
            onDragLeave={() => setOver((o) => (o === key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              const t = p.tasks.find((x) => x.id === id);
              if (t) p.onMove(t, key, list.length);
            }}
            style={{
              width: 262, flex: 'none', display: 'flex', flexDirection: 'column',
              background: dropping ? 'var(--bg-subtle)' : 'var(--surface)',
              border: `1px solid ${dropping ? 'var(--border-emphasis)' : 'var(--border)'}`,
              borderRadius: 'var(--r-md)', overflow: 'hidden',
            }}
          >
            <GroupHead label={groupLabel(key, by, p)} count={list.length} />
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              padding: 8, display: 'flex', flexDirection: 'column', gap: 7,
            }}>
              {list.map((t) => (
                <div key={t.id} style={{ opacity: p.busy === t.id ? 0.5 : 1 }}>
                  <Card task={t} ctx={p} />
                </div>
              ))}
              {list.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '10px 4px' }}>
                  {by === 'status' && key === 'backlog'
                    ? 'Nothing waiting to be picked up.'
                    : 'Nothing here.'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({ task, ctx }: { task: Task; ctx: LayoutProps }) {
  const late = isOverdue(task);
  const entity = task.owning_entity_id ? ctx.entities.get(task.owning_entity_id) : null;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      }}
      onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onClick={() => ctx.onOpen(task)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 7, width: '100%', textAlign: 'left',
        padding: '10px 11px', cursor: 'grab',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${late ? 'var(--danger)' : 'var(--border-emphasis)'}`,
        borderRadius: 'var(--r)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.06em', color: 'var(--text-subtle)',
        }}>{task.ref}</span>
        <Priority p={task.priority} />
        {entity && <EntityChip code={entity.code} entities={ctx.entities} />}
      </span>
      <span style={{
        fontSize: 13, fontWeight: 500, color: 'var(--text)',
        lineHeight: 1.4, letterSpacing: '-0.01em',
      }}>{task.title}</span>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 8,
        justifyContent: 'space-between', minWidth: 0,
      }}>
        {task.assignee_kind !== 'unassigned'
          ? <Who task={task} people={ctx.people} departments={ctx.departments} />
          : <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Unassigned</span>}
        <Due task={task} />
      </span>
      {task.blocked_reason && (
        <span style={{ fontSize: 11.5, color: 'var(--warning)', lineHeight: 1.4 }}>
          {task.blocked_reason}
        </span>
      )}
    </button>
  );
}

/* ---------------- table ---------------- */
const COLUMN_LABEL: Record<string, string> = {
  ref: 'Ref', title: 'Task', assignee: 'Who', status: 'Status', priority: 'Pri',
  due_at: 'Due', original_due_at: 'First due', project: 'Project',
  blocked_since: 'Stuck since', blocked_reason: 'Blocked on', waiting_on: 'Waiting on',
  completed_at: 'Finished', estimate_minutes: 'Estimate', department: 'Department',
  labels: 'Labels',
};

const TH: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 1,
  textAlign: 'left', padding: '0 12px', height: 34,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  padding: '0 12px', height: 36, borderBottom: '1px solid var(--border)',
  fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap',
};

export function TableLayout(p: LayoutProps) {
  const by = p.view.group_by;
  const groups = useMemo(() => group(p.tasks, by, p.who), [p.tasks, by, p.who]);
  const keys = groupOrder([...groups.keys()], by);
  const cols = p.view.fields.length ? p.view.fields : ['ref', 'title', 'assignee', 'status', 'due_at'];

  if (!p.tasks.length) return <ViewEmpty view={p.view} onNew={p.onNew} narrowed={p.narrowed} onClear={p.onClear} />;

  return (
    <div style={PANEL}>
      <div style={SCROLL}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={TH}>{COLUMN_LABEL[c] ?? c}</th>)}</tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <Fragment key={key}>
                {by !== 'none' && (
                  <tr>
                    <td colSpan={cols.length} style={{ padding: 0 }}>
                      <GroupHead label={groupLabel(key, by, p)} count={(groups.get(key) ?? []).length} />
                    </td>
                  </tr>
                )}
                {(groups.get(key) ?? []).map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => p.onOpen(t)}
                    style={{ cursor: 'pointer', opacity: p.busy === t.id ? 0.5 : 1 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {cols.map((c) => <td key={c} style={TD}>{cell(t, c, p)}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Tail count={p.tasks.length} view={p.view.name} onNew={p.onNew} />
    </div>
  );
}

function shortDate(v: string | null): React.ReactNode {
  if (!v) return '';
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
    </span>
  );
}

function cell(t: Task, field: string, p: LayoutProps): React.ReactNode {
  switch (field) {
    case 'ref': return (
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.06em', color: 'var(--text-subtle)',
      }}>{t.ref}</span>
    );
    case 'title': return (
      <span style={{ fontWeight: 500, color: 'var(--text)' }}>{t.title}</span>
    );
    case 'assignee': return <Who task={t} people={p.people} departments={p.departments} />;
    case 'status':   return <StatusPill status={t.status} />;
    case 'priority': return <Priority p={t.priority} />;
    case 'due_at':   return <Due task={t} />;
    case 'project':  return t.project_id ? (p.projects.get(t.project_id) ?? '') : '';
    case 'department': return t.assignee_dept_id ? (p.departments.get(t.assignee_dept_id) ?? '') : '';
    case 'estimate_minutes':
      return t.estimate_minutes
        ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t.estimate_minutes / 60)}h</span>
        : '';
    case 'blocked_since':   return shortDate(t.blocked_since);
    case 'completed_at':    return shortDate(t.completed_at);
    case 'original_due_at': return shortDate(t.original_due_at);
    case 'labels':          return '';
    default:
      return String((t as unknown as Record<string, unknown>)[field] ?? '');
  }
}

/* ---------------- list ---------------- */
export function ListLayout(p: LayoutProps) {
  const by = p.view.group_by;
  const groups = useMemo(() => group(p.tasks, by, p.who), [p.tasks, by, p.who]);
  const keys = groupOrder([...groups.keys()], by);

  if (!p.tasks.length) return <ViewEmpty view={p.view} onNew={p.onNew} narrowed={p.narrowed} onClear={p.onClear} />;

  return (
    <div style={PANEL}>
      <div style={SCROLL}>
        {keys.map((key) => (
          <div key={key}>
            {by !== 'none' && (
              <GroupHead label={groupLabel(key, by, p)} count={(groups.get(key) ?? []).length} />
            )}
            {(groups.get(key) ?? []).map((t) => (
              <button
                key={t.id}
                onClick={() => p.onOpen(t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  minHeight: 40, padding: '6px 12px', cursor: 'pointer',
                  background: 'transparent', border: 0,
                  borderBottom: '1px solid var(--border)',
                  opacity: p.busy === t.id ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Priority p={t.priority} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.01em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.title}</span>
                  <span style={{
                    fontSize: 11.5, color: 'var(--text-subtle)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {t.ref}{t.blocked_reason ? `. ${t.blocked_reason}` : ''}
                  </span>
                </span>
                <Who task={t} people={p.people} departments={p.departments} />
                <StatusPill status={t.status} />
                <Due task={t} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <Tail count={p.tasks.length} view={p.view.name} onNew={p.onNew} />
    </div>
  );
}

/* ---------------- calendar ---------------- */
export function CalendarLayout(p: LayoutProps & { month: Date; onMonth: (d: Date) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const cells = useMemo(() => {
    const first = new Date(p.month.getFullYear(), p.month.getMonth(), 1);
    /* Weeks start Monday, which is how a working week reads. */
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return d;
    });
  }, [p.month]);

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of p.tasks) {
      if (!t.due_at) continue;
      const k = new Date(t.due_at).toISOString().slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [p.tasks]);

  return (
    <div style={{
      ...PANEL,
      display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
      gridAutoRows: 'minmax(88px, 1fr)', gap: 0, overflow: 'auto',
    }}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div key={d} style={{
          height: 30, display: 'flex', alignItems: 'center', padding: '0 9px',
          background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
        }}>{d}</div>
      ))}
      {cells.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const outside = d.getMonth() !== p.month.getMonth();
        const list = byDay.get(key) ?? [];
        const isToday = d.getTime() === today.getTime();
        return (
          <div key={key} style={{
            display: 'flex', flexDirection: 'column', gap: 3, padding: 6, minWidth: 0,
            borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            background: outside ? 'var(--surface-sunken)' : 'var(--surface)',
          }}>
            <span style={{
              alignSelf: 'flex-start',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 20, height: 20, padding: '0 5px', borderRadius: 'var(--r-full)',
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              background: isToday ? 'var(--accent)' : 'transparent',
              color: isToday ? 'var(--accent-fg)' : outside ? 'var(--text-subtle)' : 'var(--text-muted)',
            }}>{d.getDate()}</span>
            {list.slice(0, 4).map((t) => (
              <button
                key={t.id}
                onClick={() => p.onOpen(t)}
                title={t.title}
                style={{
                  textAlign: 'left', width: '100%', padding: '2px 6px', cursor: 'pointer',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                  borderLeft: `2px solid ${isOverdue(t) ? 'var(--danger)' : 'var(--border-emphasis)'}`,
                  background: 'var(--bg-subtle)', color: 'var(--text)',
                  fontFamily: 'var(--inter)', fontSize: 11, lineHeight: 1.5,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{t.title}</button>
            ))}
            {list.length > 4 && (
              <span style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>
                {list.length - 4} more
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- timeline ---------------- */
export function TimelineLayout(p: LayoutProps) {
  const dated = p.tasks.filter((t) => t.due_at);
  if (!dated.length) {
    return (
      <Empty
        title="Nothing here has a date yet"
        body="A timeline needs start and due dates. Open a task and give it one, and it appears here in order."
        action={p.onNew
          ? <Button size="sm" variant="primary" onClick={p.onNew}>Raise a task with a date</Button>
          : undefined}
      />
    );
  }

  /* The window is the work itself, not a fixed quarter: a plan that
     runs eight weeks should not be drawn across a year of empty space. */
  const times = dated.flatMap((t) => [
    t.starts_on ? new Date(t.starts_on).getTime() : new Date(t.due_at!).getTime(),
    new Date(t.due_at!).getTime(),
  ]);
  const min = Math.min(...times, Date.now());
  const max = Math.max(...times, Date.now() + 86_400_000 * 7);
  const span = Math.max(max - min, 86_400_000);

  const ticks = 6;
  const tickLabels = Array.from({ length: ticks }, (_, i) =>
    new Date(min + (span / ticks) * i).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));

  return (
    <div style={PANEL}>
      <div style={SCROLL}>
        <div style={{
          display: 'flex', alignItems: 'stretch', height: 32, flex: 'none',
          position: 'sticky', top: 0, zIndex: 1,
          background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ width: 230, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <Label>Task</Label>
          </div>
          <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            {tickLabels.map((l, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '0 8px',
                borderLeft: '1px solid var(--border)',
                fontSize: 11, color: 'var(--text-subtle)',
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              }}>{l}</div>
            ))}
          </div>
        </div>

        {dated.map((t) => {
          const from = t.starts_on ? new Date(t.starts_on).getTime() : new Date(t.due_at!).getTime();
          const to = new Date(t.due_at!).getTime();
          const left = ((Math.min(from, to) - min) / span) * 100;
          /* A task with no start is a point in time, so it still needs
             enough width to be clickable. */
          const width = Math.max(((Math.abs(to - from)) / span) * 100, 1.4);
          const late = isOverdue(t);
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', minHeight: 36,
              borderBottom: '1px solid var(--border)',
            }}>
              <div title={t.title} style={{
                width: 230, flex: 'none', padding: '0 12px', fontSize: 12.5, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{t.title}</div>
              <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 36 }}>
                <button
                  onClick={() => p.onOpen(t)}
                  title={`${t.ref}: ${t.title}`}
                  aria-label={`${t.ref}: ${t.title}`}
                  style={{
                    position: 'absolute', top: 12, height: 12, cursor: 'pointer',
                    left: `${left}%`, width: `${width}%`, minWidth: 8,
                    borderRadius: 'var(--r-full)', border: 0,
                    background: late ? 'var(--danger)' : 'var(--primary)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <Tail count={dated.length} view={p.view.name} onNew={p.onNew} />
    </div>
  );
}

/* ---------------- workload ---------------- */
export function WorkloadLayout(p: LayoutProps) {
  const horizon = Number(p.view.options?.horizonDays ?? 14);

  const rows = useMemo(() => {
    const m = new Map<string, { open: number; late: number; minutes: number }>();
    const until = Date.now() + horizon * 86_400_000;
    for (const t of p.tasks) {
      if (t.due_at && new Date(t.due_at).getTime() > until) continue;
      const key = t.assignee_id ?? t.assignee_dept_id ?? '__unassigned';
      const row = m.get(key) ?? { open: 0, late: 0, minutes: 0 };
      row.open += 1;
      if (isOverdue(t)) row.late += 1;
      /* Work with no estimate still takes time. Counting it as nothing
         makes the busiest people look idle, so an hour is assumed and
         said so in the caption. */
      row.minutes += t.estimate_minutes ?? 60;
      m.set(key, row);
    }
    return [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  }, [p.tasks, horizon]);

  if (!rows.length) return <ViewEmpty view={p.view} onNew={p.onNew} narrowed={p.narrowed} onClear={p.onClear} />;
  const most = Math.max(...rows.map(([, r]) => r.minutes), 1);

  return (
    <div style={PANEL}>
      <div style={{
        padding: '9px 14px', flex: 'none',
        fontSize: 11.5, color: 'var(--text-subtle)',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)',
      }}>
        Next {horizon} days. Work with no estimate counts as one hour.
      </div>
      <div style={SCROLL}>
        {rows.map(([key, r]) => {
          const name = p.people.get(key)?.full_name
            ?? p.departments.get(key)
            ?? (key === '__unassigned' ? 'Unassigned' : 'Somebody');
          const hours = Math.round(r.minutes / 60);
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              minHeight: 44, padding: '8px 14px', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: 190, flex: 'none', minWidth: 0,
              }}>
                {key === '__unassigned' ? <Avatar name="?" /> : <Avatar name={name} />}
                <span style={{
                  fontSize: 12.5, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{name}</span>
              </span>

              {/* Two bars, stacked in one track: what is late, and the
                  rest. The split is the whole point of the row, and it
                  is the one place on this screen where a hue means
                  something. */}
              <span
                title={`${r.open} open, ${r.late} overdue`}
                style={{ flex: 1, minWidth: 60, display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <Bar value={r.minutes} max={most} tone={r.late ? 'danger' : 'info'} />
                {r.late > 0 && (
                  <Bar value={(r.late / Math.max(r.open, 1)) * r.minutes} max={most} tone="danger" />
                )}
              </span>

              <span style={{ width: 96, flex: 'none', textAlign: 'right' }}>
                <span style={{
                  display: 'block', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
                }}>{hours}h</span>
                <span style={{
                  display: 'block', fontSize: 10.5,
                  color: r.late ? 'var(--danger)' : 'var(--text-subtle)',
                }}>
                  {r.open} open{r.late ? `, ${r.late} late` : ''}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* The filtered empty state the kit asks for: it names the view somebody
   is looking through, because "nothing here" plus an unnoticed filter
   is how people conclude the data is missing. */
function ViewEmpty({ view, onNew, narrowed, onClear }: {
  view: TaskView; onNew: (() => void) | null;
  narrowed: string | null; onClear: (() => void) | null;
}) {
  /* Two different empty states, and telling them apart is the whole
     point. A view with nothing in it wants somebody to raise work. A
     view narrowed to nothing wants the narrowing named and undone, and
     offering "raise the first one" there sends somebody to create a
     task that would not show up either. */
  if (narrowed) {
    return (
      <Empty
        title="Nothing matches what you have narrowed this to"
        body={`${view.name} has work in it. ${narrowed}`}
        action={onClear
          ? <Button size="sm" variant="primary" onClick={onClear}>Clear that</Button>
          : undefined}
      />
    );
  }
  return (
    <Empty
      title={`Nothing matches ${view.name}`}
      body={view.description
        ? `${view.description} Nothing meets that right now. Pick another view, or change what this one holds.`
        : 'Nothing meets this view right now. Pick another view, or change what this one holds.'}
      action={onNew
        ? <Button size="sm" variant="primary" onClick={onNew}>Raise the first one</Button>
        : undefined}
    />
  );
}

/* `initials` is re-exported so the hub can label a rail row without
   reaching past this file into parts.tsx for one helper. */
export { initials };
