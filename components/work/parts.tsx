'use client';

/* =============================================================
   The small pieces every Work layout shares.

   One definition each, because a status chip that looks different on
   the board from the table is the fastest way to make a product feel
   like several products.

   Built from `components/kit` and semantic tokens only, like the rest of
   the tab. The package this came in with shipped its own stylesheet;
   none of it is used here. `GridBadge` is the kit's status vocabulary at
   the height a 36px row can hold, and it is what the CRM pipeline and
   the tracker already draw, so a status reads the same on all three.
   ============================================================= */
import type { ReactNode } from 'react';
import type { Task, TaskStatus, TaskPriority, Person, Entity } from '@/lib/work/types';
import { STATUS_LABEL, PRIORITY_TONE, isOverdue } from '@/lib/work/types';
import { Badge, EmptyState, GridBadge, Button, type Tone } from '@/components/kit/primitives';

/* Which statuses take a hue and which stay as ink.

   The kit's first rule decides this rather than taste. Red points at
   one thing, so only "this is stuck" and "this missed its date" get
   warmth. Everything else is a position in a process, and colouring
   eight positions eight ways makes a board that shouts at every
   column and therefore at none. */
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  backlog: 'neutral',
  ready: 'neutral',
  in_progress: 'info',
  blocked: 'warning',
  waiting_external: 'warning',
  in_review: 'info',
  done: 'success',
  cancelled: 'neutral',
};

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
}

/** A person, at the size a row can hold. Panton, because it is a label. */
export function Avatar({ name, title }: { name: string; title?: string }) {
  return (
    <span
      title={title ?? name}
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, flex: 'none', borderRadius: 'var(--r-full)',
        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
        color: 'var(--text-muted)', fontFamily: 'var(--panton)', fontWeight: 700,
        fontSize: 9.5, letterSpacing: '0.02em',
      }}
    >{initials(name)}</span>
  );
}

/** Who has it, in as few characters as the column allows. */
export function Who({ task, people, departments }: {
  task: Task;
  people: Map<string, Person>;
  departments: Map<string, string>;
}) {
  if (task.assignee_kind === 'person' && task.assignee_id) {
    const p = people.get(task.assignee_id);
    const name = p?.full_name ?? 'Somebody';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <Avatar name={name} />
        <span style={{
          fontSize: 12.5, color: 'var(--text)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</span>
        {/* Somebody at the other company. Work that crosses between STC
            and STC Sales and Leasing is normal and should be obvious
            rather than silent. */}
        {p?.is_cross_entity && p.primary_entity_name && (
          <Badge tone="neutral">{p.primary_entity_name}</Badge>
        )}
      </span>
    );
  }
  if (task.assignee_kind === 'department' && task.assignee_dept_id) {
    return (
      <span title="Aimed at a department, not yet at a person">
        <Badge tone="neutral">{departments.get(task.assignee_dept_id) ?? 'A department'}</Badge>
      </span>
    );
  }
  if (task.assignee_kind === 'team') {
    return <Badge tone="neutral">A team</Badge>;
  }
  return <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Unassigned</span>;
}

/** Which company a record belongs to. Never the chrome, never a chart. */
export function EntityChip({ code, entities }: { code: string; entities?: Map<string, Entity> }) {
  const name = entities
    ? [...entities.values()].find((e) => e.code === code)?.name ?? code.toUpperCase()
    : code.toUpperCase();
  return <Badge tone="neutral">{name}</Badge>;
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return <GridBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</GridBadge>;
}

export function Priority({ p }: { p: TaskPriority }) {
  return (
    <span style={{
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
      letterSpacing: '0.08em', color: PRIORITY_TONE[p], flex: 'none',
    }}>{p.toUpperCase()}</span>
  );
}

/** A due date, and whether it has been missed. */
export function Due({ task }: { task: Task }) {
  /* The lone glyph is the "no value here" marker CLAUDE.md carves out.
     Written as the character rather than the entity, which is the form
     the dash check recognises. */
  if (!task.due_at) return <span style={{ color: 'var(--text-subtle)' }}>{'—'}</span>;
  const late = isOverdue(task);
  const d = new Date(task.due_at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const label =
    days === 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : days === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums', fontSize: 12.5,
      color: late ? 'var(--danger)' : 'var(--text-muted)',
      fontWeight: late ? 600 : 400, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

/* The kit's empty state: say what the thing is, why it is empty, and
   the one action that fills it. Never the words "no data". */
export function Empty({ title, body, action }: {
  title: string; body: string; action?: ReactNode;
}) {
  return <EmptyState what={title} why={body} action={action} />;
}

/**
 * The end of a short list.
 *
 * A panel that fills the screen is right for a work tool: the rail rule
 * runs the full height and the box is finished. What is wrong is the
 * space under four rows being nothing at all, which reads as the rest
 * having failed to load.
 *
 * So the leftover space says what it is. It collapses to nothing the
 * moment the rows fill the panel, because a flex child with no room
 * takes none.
 */
export function Tail({ count, view, onNew }: {
  count: number; view: string; onNew: (() => void) | null;
}) {
  if (count === 0) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', flexWrap: 'wrap',
    }}>
      <span style={{ height: 1, width: 26, background: 'var(--border)', flex: 'none' }} />
      <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
        {count === 1
          ? `One thing in ${view}. That is all of it.`
          : `${count} things in ${view}. That is all of it.`}
      </span>
      {onNew && (
        <Button size="sm" variant="secondary" onClick={onNew}>Raise another</Button>
      )}
    </div>
  );
}
