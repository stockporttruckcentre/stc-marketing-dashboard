'use client';

/* =============================================================
   Raising work.

   Two halves, deliberately. The top is the part somebody fills in every
   time: what it is, who it is for, when it is due. The bottom is
   everything else, folded away, because a form that asks eleven
   questions to capture "ring Kinaxia back about the curtainsiders" is a
   form people stop using by Thursday.

   The company selector only appears for somebody who works for both STC
   and STC Sales and Leasing. For everybody else the database stamps
   their company and asking would be a question with one answer.
   ============================================================= */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { Person, Entity, TaskPriority, AssigneeKind } from '@/lib/work/types';
import { Alert, Button, Label } from '@/components/kit/primitives';
import { Checkbox, Drawer, Field, Select, Split, TextArea, TextInput } from '@/components/kit/forms';

export type NewTask = {
  title: string;
  description: string;
  assignee_kind: AssigneeKind;
  assignee_id: string;
  assignee_dept_id: string;
  priority: TaskPriority;
  status: string;
  due_at: string;
  starts_on: string;
  estimate_minutes: string;
  project_id: string;
  organisation_id: string;
  stock_trailer_id: string;
  owning_entity_id: string;
  classification: string;
  is_sensitive: boolean;
};

const BLANK: NewTask = {
  title: '', description: '',
  assignee_kind: 'unassigned', assignee_id: '', assignee_dept_id: '',
  priority: 'p2', status: 'backlog',
  due_at: '', starts_on: '', estimate_minutes: '',
  project_id: '', organisation_id: '', stock_trailer_id: '',
  owning_entity_id: '', classification: 'internal', is_sensitive: false,
};

export function Compose({
  people, departments, projects, entities, customers, trailers,
  meId, may, multiEntity, busy, error, onClose, onSave,
}: {
  people: Person[];
  departments: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  entities: Entity[];
  customers: { id: string; company_name: string | null }[];
  trailers: { id: string; stc_no: string | null }[];
  meId: string;
  may: (c: string) => boolean;
  multiEntity: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (t: NewTask, andAnother: boolean) => Promise<boolean>;
}) {
  const [t, setT] = useState<NewTask>(BLANK);
  const [more, setMore] = useState(false);
  const set = <K extends keyof NewTask>(k: K, v: NewTask[K]) => setT((x) => ({ ...x, [k]: v }));

  /* Who this can go to. Somebody without work.assignOthers can still
     raise work, but only for themselves, so the picker says that rather
     than offering names that would be refused on save. */
  const canGiveOut = may('work.assignOthers');
  const canGiveDept = may('work.assignDepartment');

  /* What would be refused, refused before it is sent. A button that
     posts and comes back with an error is a button that taught nothing. */
  const ready = t.title.trim()
    && (t.assignee_kind !== 'person' || !!t.assignee_id)
    && (t.assignee_kind !== 'department' || !!t.assignee_dept_id);

  async function submit(andAnother: boolean) {
    const ok = await onSave(t, andAnother);
    if (ok && andAnother) {
      setT({ ...BLANK, owning_entity_id: t.owning_entity_id, project_id: t.project_id });
    }
  }

  return (
    <Drawer
      eyebrow="New"
      title="Raise a task"
      icon={<Plus size={18} />}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button size="sm" variant="primary" disabled={busy || !ready} onClick={() => submit(false)}>
            {busy ? 'Raising' : 'Raise it'}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy || !ready} onClick={() => submit(true)}>
            Raise and start another
          </Button>
          <Button size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Never mind
          </Button>
        </>
      }
    >
      <Field label="What needs doing">
        <TextInput
          value={t.title}
          onChange={(v) => set('title', v)}
          placeholder="Book STC145505 in for its MOT"
        />
      </Field>

      <Field
        label="Detail, if it needs any"
        hint="What done looks like, and anything the person picking this up will not already know."
      >
        <TextArea value={t.description} onChange={(v) => set('description', v)} rows={3} />
      </Field>

      <Split>
        <Field label="For">
          <Select value={t.assignee_kind} onChange={(v) => set('assignee_kind', v as AssigneeKind)}>
            <option value="unassigned">Nobody yet</option>
            <option value="person">A person</option>
            {canGiveDept && <option value="department">A whole department</option>}
          </Select>
        </Field>

        {t.assignee_kind === 'person' && (
          <Field
            label="Person"
            hint={canGiveOut
              ? undefined
              : 'You can raise work for yourself. Putting it on somebody else needs the assign permission.'}
          >
            <Select value={t.assignee_id} onChange={(v) => set('assignee_id', v)}>
              <option value="">Pick somebody</option>
              <option value={meId}>Me</option>
              {canGiveOut && people.filter((p) => p.id !== meId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.department_name ? `, ${p.department_name}` : ''}
                  {p.is_cross_entity && p.primary_entity_name ? ` (${p.primary_entity_name})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {t.assignee_kind === 'department' && (
          <Field
            label="Department"
            hint="Nobody owns it until somebody in that department picks it up."
          >
            <Select value={t.assignee_dept_id} onChange={(v) => set('assignee_dept_id', v)}>
              <option value="">Pick one</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        )}

        <Field label="Due">
          <TextInput type="date" value={t.due_at} onChange={(v) => set('due_at', v)} />
        </Field>

        <Field label="Priority">
          <Select value={t.priority} onChange={(v) => set('priority', v as TaskPriority)}>
            <option value="p0">P0, drop everything</option>
            <option value="p1">P1, this week</option>
            <option value="p2">P2, normal</option>
            <option value="p3">P3, when there is room</option>
          </Select>
        </Field>
      </Split>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        aria-expanded={more}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
          background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
          color: 'var(--text-muted)',
        }}
      >
        {more ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Label>Everything else</Label>
      </button>

      {more && (
        <>
          <Split>
            <Field label="Start it at">
              <Select value={t.status} onChange={(v) => set('status', v)}>
                <option value="backlog">Backlog</option>
                <option value="ready">Ready to pick up</option>
                <option value="in_progress">Already underway</option>
              </Select>
            </Field>

            <Field label="Project">
              <Select value={t.project_id} onChange={(v) => set('project_id', v)}>
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>

            <Field label="Not before">
              <TextInput type="date" value={t.starts_on} onChange={(v) => set('starts_on', v)} />
            </Field>

            <Field label="Estimate, in hours">
              <TextInput type="number" value={t.estimate_minutes} onChange={(v) => set('estimate_minutes', v)} />
            </Field>

            {/* What the work is about. Both are foreign keys, which is
                the point: a link that can be joined is what lets
                somebody ask what is outstanding on one trailer or one
                customer and get an answer. */}
            <Field label="Customer" hint="The account in the CRM this is for.">
              <Select value={t.organisation_id} onChange={(v) => set('organisation_id', v)}>
                <option value="">Not about one customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name ?? 'Unnamed account'}</option>
                ))}
              </Select>
            </Field>

            <Field label="Trailer" hint="The unit in the stock list this is about.">
              <Select value={t.stock_trailer_id} onChange={(v) => set('stock_trailer_id', v)}>
                <option value="">Not about one trailer</option>
                {trailers.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.stc_no ?? 'No stock number'}</option>
                ))}
              </Select>
            </Field>

            {multiEntity && (
              <Field label="Company">
                <Select value={t.owning_entity_id} onChange={(v) => set('owning_entity_id', v)}>
                  <option value="">My main company</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
            )}

            <Field label="Sensitivity">
              <Select value={t.classification} onChange={(v) => set('classification', v)}>
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </Select>
            </Field>
          </Split>

          <Checkbox
            checked={t.is_sensitive}
            onChange={(v) => set('is_sensitive', v)}
            label="This is commercially sensitive"
            hint="Only people cleared for it can open it. Mark it when the work itself would matter to a competitor or to a customer: pricing on a fleet deal, a margin, an acquisition."
          />
        </>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Drawer>
  );
}
