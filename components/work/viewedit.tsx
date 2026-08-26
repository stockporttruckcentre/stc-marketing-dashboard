'use client';

/* =============================================================
   Building a view.

   A hundred people run a hundred workflows in one tool because the view
   is data rather than code, so a view somebody builds here is exactly
   as capable as one that ships: same filter grammar, same layouts, same
   grouping, same columns.

   The filter is built from rows rather than typed, because the grammar
   is a tree and nobody should have to know that. Each row is one
   condition and they are joined with AND, which covers almost every
   view anybody actually wants. The stored shape is the full tree, so a
   view built by hand in SQL still reads back correctly here.
   ============================================================= */
import { useState } from 'react';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { TaskView, FilterNode, FilterLeaf, Person, Layout } from '@/lib/work/types';
import { STATUS_ORDER, STATUS_LABEL } from '@/lib/work/types';
import { Alert, Button, Chip, IconButton, Label } from '@/components/kit/primitives';
import { Drawer, Field, Select, Split, TextInput } from '@/components/kit/forms';

/* What a view can be filtered on, and how each one is answered. Held
   here rather than derived, because the evaluator in lib/work/filter.ts
   knows some computed fields that are not columns, and a picker built
   from the column list would silently miss them. */
const FIELDS: { key: string; label: string; kind: 'status' | 'priority' | 'person' | 'flag' | 'date' | 'text' }[] = [
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'priority', label: 'Priority', kind: 'priority' },
  { key: 'assignee', label: 'Who has it', kind: 'person' },
  { key: 'created_by', label: 'Who raised it', kind: 'person' },
  { key: 'delegated_by', label: 'Who assigned it', kind: 'person' },
  { key: 'reviewer_id', label: 'Reviewer', kind: 'person' },
  { key: 'overdue', label: 'Overdue', kind: 'flag' },
  { key: 'is_sensitive', label: 'Marked sensitive', kind: 'flag' },
  { key: 'has_parent', label: 'Is a subtask', kind: 'flag' },
  { key: 'due_at', label: 'Due date', kind: 'date' },
  { key: 'title', label: 'Title', kind: 'text' },
];

const OPS: Record<string, { key: FilterLeaf['op']; label: string }[]> = {
  status:   [{ key: 'is', label: 'is' }, { key: 'isNot', label: 'is not' }, { key: 'in', label: 'is any of' }],
  priority: [{ key: 'is', label: 'is' }, { key: 'isNot', label: 'is not' }],
  person:   [{ key: 'is', label: 'is' }, { key: 'isNot', label: 'is not' }, { key: 'isSet', label: 'is anybody' }, { key: 'isNotSet', label: 'is nobody' }],
  flag:     [{ key: 'is', label: 'is' }],
  date:     [{ key: 'before', label: 'is before' }, { key: 'after', label: 'is after' }, { key: 'within', label: 'is within' }, { key: 'isSet', label: 'is set' }, { key: 'isNotSet', label: 'is not set' }],
  text:     [{ key: 'contains', label: 'contains' }],
};

const COLUMNS = [
  'ref', 'title', 'assignee', 'status', 'priority', 'due_at', 'original_due_at',
  'project', 'department', 'blocked_reason', 'blocked_since', 'waiting_on',
  'estimate_minutes', 'completed_at',
];
const COLUMN_LABEL: Record<string, string> = {
  ref: 'Ref', title: 'Task', assignee: 'Who', status: 'Status', priority: 'Priority',
  due_at: 'Due', original_due_at: 'First due', project: 'Project', department: 'Department',
  blocked_reason: 'Blocked on', blocked_since: 'Stuck since', waiting_on: 'Waiting on',
  estimate_minutes: 'Estimate', completed_at: 'Finished',
};

/** Read a stored tree back into the flat rows the editor draws. */
function toRows(node: FilterNode | null | undefined): FilterLeaf[] {
  if (!node) return [];
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.all)) return (n.all as FilterNode[]).flatMap(toRows);
  if (Array.isArray(n.any)) return (n.any as FilterNode[]).flatMap(toRows);
  if (n.not) return [];
  return typeof n.field === 'string' ? [node as FilterLeaf] : [];
}

export function ViewEditor({
  base, mode, people, busy, error, onClose, onSave,
}: {
  base: TaskView;
  /** `new` saves a copy. `this` writes back over the view being looked at. */
  mode: 'new' | 'this';
  people: Person[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, mode: 'new' | 'this') => Promise<boolean>;
}) {
  const [name, setName] = useState(mode === 'new' ? `${base.name} (copy)` : base.name);
  const [description, setDescription] = useState(base.description ?? '');
  const [layout, setLayout] = useState<Layout>(base.layout);
  const [groupBy, setGroupBy] = useState(base.group_by);
  const [rows, setRows] = useState<FilterLeaf[]>(() => toRows(base.filter));
  const [fields, setFields] = useState<string[]>(
    base.fields?.length ? base.fields : ['ref', 'title', 'assignee', 'status', 'due_at'],
  );
  const [sortField, setSortField] = useState(base.sort?.[0]?.field ?? 'due_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(base.sort?.[0]?.dir ?? 'asc');

  const kindOf = (field: string) => FIELDS.find((f) => f.key === field)?.kind ?? 'text';

  function setRow(i: number, patch: Partial<FilterLeaf>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  return (
    <Drawer
      eyebrow={mode === 'new' ? 'New view' : 'Editing'}
      title={mode === 'new' ? 'Build a view' : base.name}
      icon={<SlidersHorizontal size={18} />}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button
            size="sm" variant="primary" disabled={busy || !name.trim()}
            onClick={() => onSave({
              name: name.trim(),
              description: description.trim() || null,
              layout,
              group_by: groupBy,
              sort: [{ field: sortField, dir: sortDir }],
              filter: { all: rows.filter((r) => r.field && r.op) },
              fields,
              options: base.options ?? {},
            }, mode)}
          >
            {busy ? 'Saving' : mode === 'new' ? 'Save it to my rail' : 'Save the changes'}
          </Button>
          <Button size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Never mind
          </Button>
        </>
      }
    >
      <Field label="Name in the rail">
        <TextInput value={name} onChange={setName} />
      </Field>
      <Field label="One line saying what it is for">
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder="Everything on the workshop, soonest first."
        />
      </Field>

      <Split>
        <Field label="Layout">
          <Select value={layout} onChange={(v) => setLayout(v as Layout)}>
            <option value="list">List</option>
            <option value="board">Board</option>
            <option value="table">Table</option>
            <option value="calendar">Calendar</option>
            <option value="timeline">Timeline</option>
            <option value="workload">Workload</option>
          </Select>
        </Field>
        <Field label="Grouped by">
          <Select value={groupBy} onChange={setGroupBy}>
            <option value="status">Status</option>
            <option value="assignee">Who has it</option>
            <option value="priority">Priority</option>
            <option value="project">Project</option>
            <option value="department">Department</option>
            <option value="due">When it is due</option>
            <option value="none">Not grouped</option>
          </Select>
        </Field>
        <Field label="Sorted by">
          <Select value={sortField} onChange={setSortField}>
            <option value="due_at">Due date</option>
            <option value="priority">Priority</option>
            <option value="created_at">When it was raised</option>
            <option value="updated_at">When it last changed</option>
            <option value="title">Title</option>
            <option value="board_position">Board order</option>
          </Select>
        </Field>
        <Field label="Order">
          <Select value={sortDir} onChange={(v) => setSortDir(v as 'asc' | 'desc')}>
            <option value="asc">Soonest or lowest first</option>
            <option value="desc">Latest or highest first</option>
          </Select>
        </Field>
      </Split>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <Label>What is in it</Label>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            every condition has to be true
          </span>
        </div>

        {rows.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            No conditions, so this view holds everything you can see.
          </div>
        )}

        {rows.map((r, i) => {
          const kind = kindOf(r.field);
          const needsValue = r.op !== 'isSet' && r.op !== 'isNotSet';
          const listed = r.op === 'in' || r.op === 'notIn';
          const chosen = Array.isArray(r.value) ? (r.value as unknown[]).map(String) : [];
          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: '10px 11px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select
                    value={r.field}
                    onChange={(v) => {
                      const k = kindOf(v);
                      setRow(i, { field: v, op: OPS[k][0].key, value: undefined });
                    }}
                  >
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </Select>
                </div>
                <div style={{ width: 130, flex: 'none' }}>
                  <Select
                    value={r.op}
                    onChange={(v) => {
                      const op = v as FilterLeaf['op'];
                      const wasList = r.op === 'in' || r.op === 'notIn';
                      const isList = op === 'in' || op === 'notIn';
                      setRow(i, { op, value: wasList === isList ? r.value : (isList ? [] : undefined) });
                    }}
                  >
                    {OPS[kind].map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </Select>
                </div>
                <IconButton
                  label="Remove this condition"
                  onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>

              {/* `is any of` holds a list, and a single select would read
                  one back as the string "blocked,waiting_external" and
                  match no option: the row would look empty while the
                  view worked. So the control follows the operator, and
                  the list one is chips rather than a native multiple
                  select, which nobody can operate without being told to
                  hold a modifier key. */}
              {needsValue && kind === 'status' && listed && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {STATUS_ORDER.map((st) => {
                    const on = chosen.includes(st);
                    return (
                      <Chip
                        key={st}
                        active={on}
                        onClick={() => setRow(i, {
                          value: on ? chosen.filter((x) => x !== st) : [...chosen, st],
                        })}
                      >{STATUS_LABEL[st]}</Chip>
                    );
                  })}
                </div>
              )}
              {needsValue && kind === 'status' && !listed && (
                <Select value={String(r.value ?? '')} onChange={(v) => setRow(i, { value: v })}>
                  <option value="">Pick one</option>
                  {STATUS_ORDER.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                </Select>
              )}
              {needsValue && kind === 'priority' && (
                <Select value={String(r.value ?? '')} onChange={(v) => setRow(i, { value: v })}>
                  <option value="">Pick one</option>
                  <option value="p0">P0</option><option value="p1">P1</option>
                  <option value="p2">P2</option><option value="p3">P3</option>
                </Select>
              )}
              {needsValue && kind === 'person' && (
                <Select value={String(r.value ?? '')} onChange={(v) => setRow(i, { value: v })}>
                  <option value="">Pick one</option>
                  {/* `@me` is resolved per reader, so a view shared with a
                      department shows each person their own work rather
                      than the author's. */}
                  <option value="@me">Whoever is looking</option>
                  <option value="@myDepartment">Anybody in their department</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </Select>
              )}
              {needsValue && kind === 'flag' && (
                <Select
                  value={String(r.value ?? 'true')}
                  onChange={(v) => setRow(i, { value: v === 'true' })}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              )}
              {needsValue && kind === 'date' && (
                <TextInput
                  value={String(r.value ?? '')}
                  onChange={(v) => setRow(i, { value: v })}
                  placeholder={r.op === 'within' ? '7d, or -30d for the past' : 'today, or 2027-01-27'}
                />
              )}
              {needsValue && kind === 'text' && (
                <TextInput value={String(r.value ?? '')} onChange={(v) => setRow(i, { value: v })} />
              )}
            </div>
          );
        })}

        <div>
          <Button
            size="sm" variant="secondary"
            onClick={() => setRows((r) => [...r, { field: 'status', op: 'is', value: 'in_progress' }])}
          >
            <Plus size={13} /> Add a condition
          </Button>
        </div>
      </div>

      {layout === 'table' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Label>Columns</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COLUMNS.map((c) => (
              <Chip
                key={c}
                active={fields.includes(c)}
                onClick={() => setFields((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]))}
              >{COLUMN_LABEL[c] ?? c}</Chip>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            The ones you tap are the ones shown, in the order you tap them.
          </span>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Drawer>
  );
}
