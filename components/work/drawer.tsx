'use client';

/* =============================================================
   One task, in full.

   The panel is where the thing that makes this not a to-do list lives:
   if somebody above you put this on you, you cannot simply drop it, and
   you should not have to do it badly either. You ask, in the open, and
   the person who assigned it answers.

   Drawn with the kit's `Drawer`, the same component the CRM record and
   the tracker's lead editor open in, so a record over a table is one
   shape across the product rather than three that drifted.
   ============================================================= */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  AlertTriangle, CornerUpLeft, Clock, UserMinus, MessageSquare, ListChecks,
} from 'lucide-react';
import type {
  Task, Person, Entity, DelegationRequest, DelegationAsk,
} from '@/lib/work/types';
import { STATUS_LABEL } from '@/lib/work/types';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { Drawer, Field, Select, Split, TextArea, TextInput } from '@/components/kit/forms';
import { Who, StatusPill, Priority, Due, EntityChip, Avatar } from './parts';

export type Move = { to_status: string; label: string; needs_reason: boolean; blocked_by: number };
export type Comment = {
  id: string; task_id: string; author_id: string | null; body: string;
  reply_to: string | null; created_at: string; edited_at: string | null;
};

/** A titled block inside the drawer. Rules, not shadows. */
function Sect({ title, icon, count, children }: {
  title: string; icon?: ReactNode; count?: number; children: ReactNode;
}) {
  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)', padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon && <span style={{ color: 'var(--text-subtle)', display: 'flex' }}>{icon}</span>}
        <Label>{title}</Label>
        {count != null && (
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
            color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
          }}>{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A read only pair, for a field this person cannot change. */
function Kv({ k, v, hint }: { k: string; v: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{k}</span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{v}</span>
      {hint && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{hint}</span>}
    </div>
  );
}

const ASK_WORDS: Record<DelegationAsk, string> = {
  cancel: 'cancel this',
  reassign: 'pass this on',
  extend: 'move the date',
  declassify: 'lower the sensitivity',
};

export function TaskDrawer({
  task, moves, requests, people, departments, entities, projects, customers, trailers,
  meId, may, canDecide, onClose, onMove, onAsk, onDecide, onAssign, onDue, onPatch, busy,
}: {
  task: Task;
  moves: Move[];
  requests: DelegationRequest[];
  people: Map<string, Person>;
  departments: Map<string, string>;
  entities: Map<string, Entity>;
  projects: Map<string, string>;
  customers: { id: string; company_name: string | null }[];
  trailers: { id: string; stc_no: string | null }[];
  meId: string;
  may: (c: string) => boolean;
  /** Whether the person looking is the one being asked. */
  canDecide: boolean;
  onClose: () => void;
  onMove: (to: string, reason?: string) => void;
  onAsk: (ask: DelegationAsk, reason: string, suggestUser?: string, due?: string) => void;
  onDecide: (requestId: string, grant: boolean, note?: string) => void;
  onAssign: (kind: string, id: string | null) => void;
  onDue: (due: string | null) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [asking, setAsking] = useState<DelegationAsk | null>(null);
  const [reason, setReason] = useState('');
  const [passTo, setPassTo] = useState('');
  const [newDue, setNewDue] = useState('');

  /* Held locally so typing is local and leaving the field is the save.
     Keyed off the task so opening a different one starts from its own
     values rather than the last one's. */
  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.description ?? '');
  useEffect(() => {
    setTitle(task.title);
    setDetail(task.description ?? '');
  }, [task.id, task.title, task.description]);

  /* Notes load when the drawer opens rather than with the page. A
     hundred tasks on screen is a hundred threads nobody asked for. */
  const [notes, setNotes] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    setNotes(null); setDraft('');
    fetch(`/api/work/tasks/${task.id}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (live) setNotes(rows as Comment[]); })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [task.id]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/work/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const row = (await res.json()) as Comment;
        setNotes((n) => [...(n ?? []), row]);
        setDraft('');
      }
    } finally {
      setSending(false);
    }
  }

  /* Whether this person may change the assignee at all. The database
     decides for real; this decides whether to draw a control that would
     only ever refuse. Picking work up yourself is always allowed. */
  const canReassign = may('work.assignOthers') || may('work.reassign');
  const canEdit = may('work.edit');
  const closed = task.status === 'done' || task.status === 'cancelled';
  const locked = closed || !canEdit;

  const open = requests.filter((r) => r.state === 'open');
  const entity = task.owning_entity_id ? entities.get(task.owning_entity_id) : null;
  const delegator = task.delegated_by ? people.get(task.delegated_by) : null;

  return (
    <Drawer
      eyebrow={task.ref ?? 'Task'}
      title={task.title}
      icon={<ListChecks size={18} />}
      onClose={onClose}
      footer={
        /* Only the moves that will actually work. An action that
           appears and then refuses teaches people the tool is
           unreliable, so the list comes from the database. */
        moves.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            Nothing you can move this to right now.
          </span>
        ) : (
          <>
            {moves.map((m) => (
              <Button
                key={m.to_status}
                size="sm"
                variant={m.to_status === 'done' ? 'primary' : 'secondary'}
                disabled={busy || (m.blocked_by > 0 && (m.to_status === 'in_progress' || m.to_status === 'done'))}
                title={m.blocked_by > 0 ? `${m.blocked_by} task(s) have to finish first` : undefined}
                onClick={() => {
                  const why = m.needs_reason
                    ? window.prompt(m.to_status === 'blocked' ? 'What is it blocked on?' : 'Why?')
                    : undefined;
                  if (m.needs_reason && !why) return;
                  onMove(m.to_status, why ?? undefined);
                }}
              >{m.label}</Button>
            ))}
          </>
        )
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Priority p={task.priority} />
        <StatusPill status={task.status} />
        {entity && <EntityChip code={entity.code} entities={entities} />}
        {task.is_sensitive && (
          <span title="Commercially sensitive. Only people cleared for it can open this.">
            <Badge tone="danger" dot>Sensitive</Badge>
          </span>
        )}
        {delegator && (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginLeft: 'auto' }}>
            Given to you by {delegator.full_name}
            {task.delegated_at
              ? ` on ${new Date(task.delegated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : ''}
          </span>
        )}
      </div>

      {/* An open request comes first, above everything. A question
          somebody is waiting on is not a footnote. */}
      {open.map((r) => (
        <Sect key={r.id} title="Somebody has asked to be let off this" icon={<CornerUpLeft size={12} />}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {people.get(r.asked_by)?.full_name ?? 'Somebody'} asked to{' '}
            <strong style={{ color: 'var(--text)' }}>{ASK_WORDS[r.ask]}</strong>
            {r.asked_of ? `, and asked ${people.get(r.asked_of)?.full_name ?? 'somebody'}` : ''}.
          </div>
          <Alert tone="warning">{r.reason}</Alert>
          {r.suggest_user && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Suggested: {people.get(r.suggest_user)?.full_name ?? 'somebody else'}
            </div>
          )}
          {r.suggest_due && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Asked for: {new Date(r.suggest_due).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
            </div>
          )}
          {canDecide ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="primary" disabled={busy}
                onClick={() => onDecide(r.id, true)}>Grant it</Button>
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => onDecide(r.id, false)}>Refuse</Button>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              Waiting on {r.asked_of ? people.get(r.asked_of)?.full_name ?? 'somebody' : 'a decision'}.
            </div>
          )}
        </Sect>
      ))}

      {/* What it is. Both fields save when they are left, not on every
          keystroke: a separate edit mode for one line of text is a mode
          people forget they are in. */}
      <Sect title="What it is">
        {locked ? (
          <>
            <Kv k="Task" v={task.title} />
            {task.description && (
              <p style={{
                margin: 0, fontSize: 13, lineHeight: 1.6,
                color: 'var(--text-muted)', whiteSpace: 'pre-wrap',
              }}>{task.description}</p>
            )}
          </>
        ) : (
          <>
            <Field label="What needs doing">
              <TextInput
                value={title}
                onChange={setTitle}
                onCommit={(v) => {
                  const t = v.trim();
                  if (t && t !== task.title) onPatch({ title: t });
                  else setTitle(task.title);
                }}
              />
            </Field>
            <Field
              label="Detail"
              hint="What done looks like, and anything the person picking this up will not already know."
            >
              <TextArea
                value={detail}
                onChange={setDetail}
                rows={3}
                onCommit={(v) => {
                  const t = v.trim();
                  if (t !== (task.description ?? '')) onPatch({ description: t || null });
                }}
              />
            </Field>
          </>
        )}
      </Sect>

      {(task.blocked_reason || task.waiting_on) && (
        <Sect title="Why it is stuck" icon={<AlertTriangle size={12} />}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
            {task.blocked_reason ?? task.waiting_on}
          </p>
          {task.blocked_since && (
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              Stuck for {Math.floor((Date.now() - new Date(task.blocked_since).getTime()) / 86_400_000)} days.
            </div>
          )}
        </Sect>
      )}

      {/* Where it sits, and mostly changeable from here. Each control
          saves on change: a panel with six fields and one Save button is
          a panel where five edits are lost when somebody closes it. What
          a person cannot change is drawn as text rather than as a
          control that would refuse. */}
      <Sect title="Where it sits">
        <Split>
          {locked ? (
            <Kv k="Assigned to" v={<Who task={task} people={people} departments={departments} />} />
          ) : (
            <Field label="Assigned to">
              <Select
                value={task.assignee_kind === 'person' ? (task.assignee_id ?? '')
                  : task.assignee_kind === 'department' ? `d:${task.assignee_dept_id}`
                  : ''}
                onChange={(v) => {
                  if (!v) onAssign('unassigned', null);
                  else if (v.startsWith('d:')) onAssign('department', v.slice(2));
                  else onAssign('person', v);
                }}
              >
                <option value="">Nobody</option>
                <option value={meId}>Me</option>
                {canReassign && [...people.values()].filter((p) => p.id !== meId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.is_cross_entity && p.primary_entity_name ? ` (${p.primary_entity_name})` : ''}
                  </option>
                ))}
                {may('work.assignDepartment') && [...departments.entries()].map(([id, name]) => (
                  <option key={id} value={`d:${id}`}>{name} (department)</option>
                ))}
              </Select>
            </Field>
          )}

          {locked ? (
            <Kv k="Due" v={<Due task={task} />} />
          ) : (
            <Field
              label="Due"
              /* The refusal this control will hit, said before it hits
                 it. A date somebody above you set is theirs. */
              hint={task.delegated_by && task.delegated_by !== meId && !may('work.setDue')
                ? `This date is ${delegator?.full_name ?? 'the person who assigned it'}'s. Ask for more time below.`
                : undefined}
            >
              <TextInput
                type="date"
                value={task.due_at ? new Date(task.due_at).toISOString().slice(0, 10) : ''}
                onChange={(v) => onDue(v || null)}
              />
            </Field>
          )}

          {locked ? (
            <Kv k="Project" v={task.project_id ? projects.get(task.project_id) ?? 'A project' : 'None'} />
          ) : (
            <Field label="Project">
              <Select value={task.project_id ?? ''} onChange={(v) => onPatch({ project_id: v || null })}>
                <option value="">None</option>
                {[...projects.entries()].map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </Select>
            </Field>
          )}

          {locked ? (
            <Kv k="Priority" v={<Priority p={task.priority} />} />
          ) : (
            <Field label="Priority">
              <Select value={task.priority} onChange={(v) => onPatch({ priority: v })}>
                <option value="p0">P0, drop everything</option>
                <option value="p1">P1, this week</option>
                <option value="p2">P2, normal</option>
                <option value="p3">P3, when there is room</option>
              </Select>
            </Field>
          )}

          <Kv k="Status" v={STATUS_LABEL[task.status]} />

          {task.reviewer_id && (
            <Kv k="Reviewer" v={people.get(task.reviewer_id)?.full_name ?? 'Somebody'} />
          )}
          {task.original_due_at && task.due_at && task.original_due_at !== task.due_at && (
            <Kv
              k="First due"
              v={new Date(task.original_due_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
            />
          )}
        </Split>
      </Sect>

      {/* What the work is about. Both are foreign keys rather than text,
          which is what lets somebody ask what is still outstanding on
          one trailer or one account and get an answer instead of a
          search. Drawn whether or not either is set, because a section
          that appears only once there is something in it is a section
          nobody discovers. */}
      <Sect title="What it is about">
        <Split>
          {locked ? (
            <Kv
              k="Customer"
              v={task.organisation_id
                ? customers.find((c) => c.id === task.organisation_id)?.company_name ?? 'An account'
                : 'Not about one customer'}
            />
          ) : (
            <Field label="Customer" hint="The account in the CRM this is for.">
              <Select
                value={task.organisation_id ?? ''}
                onChange={(v) => onPatch({ organisation_id: v || null })}
              >
                <option value="">Not about one customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name ?? 'Unnamed account'}</option>
                ))}
              </Select>
            </Field>
          )}

          {locked ? (
            <Kv
              k="Trailer"
              v={task.stock_trailer_id
                ? trailers.find((t) => t.id === task.stock_trailer_id)?.stc_no ?? 'A trailer'
                : 'Not about one trailer'}
            />
          ) : (
            <Field label="Trailer" hint="The unit in the stock list this is about.">
              <Select
                value={task.stock_trailer_id ?? ''}
                onChange={(v) => onPatch({ stock_trailer_id: v || null })}
              >
                <option value="">Not about one trailer</option>
                {trailers.map((t) => (
                  <option key={t.id} value={t.id}>{t.stc_no ?? 'No stock number'}</option>
                ))}
              </Select>
            </Field>
          )}
        </Split>
      </Sect>

      {/* Asking to be let off. Only offered when somebody else put the
          work on you: there is nobody to ask about work you raised
          yourself, and offering it would be nonsense. */}
      {task.delegated_by && !closed && (
        <Sect title="This is not mine to do">
          {!asking ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={() => setAsking('reassign')}>
                <CornerUpLeft size={13} /> Ask to pass it on
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAsking('extend')}>
                <Clock size={13} /> Ask for more time
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAsking('cancel')}>
                <UserMinus size={13} /> Ask to cancel it
              </Button>
            </div>
          ) : (
            <>
              <Field label={`Why. ${delegator?.full_name ?? 'Whoever assigned it'} sees this.`}>
                <TextArea
                  value={reason}
                  onChange={setReason}
                  rows={3}
                  placeholder="Say what is in the way. A reason is what makes this answerable."
                />
              </Field>
              {asking === 'reassign' && (
                <Field label="Who should have it">
                  <Select value={passTo} onChange={setPassTo}>
                    <option value="">Let them decide</option>
                    {[...people.values()].map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                        {p.is_cross_entity && p.primary_entity_name ? ` (${p.primary_entity_name})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {asking === 'extend' && (
                <Field label="The date you can do">
                  <TextInput type="date" value={newDue} onChange={setNewDue} />
                </Field>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="sm" variant="primary"
                  disabled={busy || !reason.trim() || (asking === 'extend' && !newDue)}
                  onClick={() => {
                    onAsk(asking, reason.trim(), passTo || undefined,
                          newDue ? new Date(newDue).toISOString() : undefined);
                    setAsking(null); setReason(''); setPassTo(''); setNewDue('');
                  }}
                >Send the request</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Never mind</Button>
              </div>
            </>
          )}
        </Sect>
      )}

      {/* What was said about this. The reason a date moved, or why
          something sat blocked for nine days, is the first thing anybody
          asks and the last thing anybody can find. Kept on the task, it
          is still here when the person who wrote it has left. */}
      <Sect title="Notes" icon={<MessageSquare size={12} />} count={notes?.length}>
        {notes === null && (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Reading the thread.</div>
        )}

        {notes?.map((n) => {
          const who = n.author_id ? people.get(n.author_id) : null;
          return (
            <div key={n.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <Avatar name={who?.full_name ?? '?'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    {who?.full_name ?? 'Somebody'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div style={{
                  fontSize: 12.5, color: 'var(--text-muted)',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}>{n.body}</div>
              </div>
            </div>
          );
        })}

        {notes?.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Nothing said yet. The first note is usually why this exists.
          </div>
        )}

        <Field label="Add a note">
          <TextArea
            value={draft}
            onChange={setDraft}
            rows={2}
            placeholder="What changed, what you found, what you are waiting on."
          />
        </Field>
        <div>
          <Button size="sm" variant="primary" disabled={sending || !draft.trim()} onClick={send}>
            {sending ? 'Posting' : 'Post it'}
          </Button>
        </div>
      </Sect>
    </Drawer>
  );
}
