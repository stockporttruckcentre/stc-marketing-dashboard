'use client';

/* =============================================================
   Work.

   ---- What this is for ----

   A task here carries an owning company, a sensitivity and the record
   it is about, because the work at a truck dealership is nearly always
   about something: a trailer, a customer, a pitch. "Get STC145505
   photographed" is not a line on a list, it is a job attached to a unit
   in the stock table, and when the unit sells the job should be
   findable from it.

   Delegation can be refused. Work handed down that cannot be handed
   back is an instruction, and people route around instructions by doing
   nothing. Asking to be let off is a record here with an addressee and
   an answer.

   And the view is data, not code. Every view in the rail, including the
   twelve that ship, is a row in `task_views`. There is no code path
   that renders one of them specially, which is what makes a view
   somebody builds exactly as capable as one that came with it.

   Everything on this screen is drawn from `components/kit`. The package
   this came in with brought its own stylesheet; none of it is here.
   ============================================================= */
import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Columns3, Table2, List as ListIcon, CalendarDays, GanttChart, Gauge,
  ChevronLeft, ChevronRight, Search, SlidersHorizontal, ListChecks,
} from 'lucide-react';
import type {
  Task, TaskView, Person, Entity, DelegationRequest, Layout,
} from '@/lib/work/types';
import { applyView, type Viewer } from '@/lib/work/filter';
import { isOverdue } from '@/lib/work/types';
import {
  Alert, Badge, Button, Chip, IconButton, Label, RecordHead, SearchInput,
  StatStrip, TabShell, Tabs,
} from '@/components/kit/primitives';
import { Select } from '@/components/kit/forms';
import {
  BoardLayout, TableLayout, ListLayout, CalendarLayout, TimelineLayout, WorkloadLayout,
  type LayoutProps,
} from '@/components/work/layouts';
import { TaskDrawer, type Move } from '@/components/work/drawer';
import { Compose, type NewTask } from '@/components/work/compose';
import { ViewEditor } from '@/components/work/viewedit';
import { Empty } from '@/components/work/parts';
import { WorkDiary } from '@/components/work/diary';
import type { CalendarEvent } from '@/lib/types';
import type { DiaryInvite, DiaryPerson } from '@/lib/calendar/diary';
import { diaryCounts, toEntries } from '@/lib/calendar/diary';

const LAYOUTS: { key: Layout; label: string; Icon: typeof Columns3 }[] = [
  { key: 'board', label: 'Board', Icon: Columns3 },
  { key: 'table', label: 'Table', Icon: Table2 },
  { key: 'list', label: 'List', Icon: ListIcon },
  { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { key: 'timeline', label: 'Timeline', Icon: GanttChart },
  { key: 'workload', label: 'Workload', Icon: Gauge },
];

const GROUPINGS = [
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Who has it' },
  { key: 'priority', label: 'Priority' },
  { key: 'project', label: 'Project' },
  { key: 'department', label: 'Department' },
  { key: 'due', label: 'When it is due' },
  { key: 'none', label: 'Not grouped' },
];

/* How the command bar addresses a view. It sends `?view=my-work` rather
   than a uuid, because a uuid differs per installation and an action in
   `actions.ts` is one line of code shared by all of them. */
export function viewSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function WorkHub({
  initialTasks, views, people, departments, entities, projects, customers, trailers,
  requests, viewer, capabilities, multiEntity, openView, openTab,
  diaryEvents, diaryInvites, diaryPeople,
}: {
  initialTasks: Task[];
  views: TaskView[];
  people: Person[];
  departments: { id: string; name: string }[];
  entities: Entity[];
  projects: { id: string; name: string }[];
  customers: { id: string; company_name: string | null }[];
  trailers: { id: string; stc_no: string | null }[];
  requests: DelegationRequest[];
  viewer: Viewer;
  capabilities: string[];
  /** Whether this person works for more than one company. */
  multiEntity: boolean;
  /** The `?view=` slug the command bar arrived with, if any. */
  openView: string | null;
  /** `?tab=diary` from the command bar, so a sentence can land on it. */
  openTab: 'tasks' | 'diary';
  /* Everything booked anywhere in the application. Read on the server
     alongside the tasks so the tab draws once with real rows rather
     than flashing an empty diary and filling it in. */
  diaryEvents: CalendarEvent[];
  diaryInvites: DiaryInvite[];
  diaryPeople: DiaryPerson[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  /* Two halves of "what is on me": the work, and what is booked.
     One tab rather than a saved view, because the diary is not a task
     list filtered differently, it is a different table. */
  const [tab, setTab] = useState<'tasks' | 'diary'>(openTab);
  const [viewId, setViewId] = useState(() => {
    const wanted = openView ? views.find((v) => viewSlug(v.name) === openView) : null;
    return (wanted ?? views[0])?.id ?? '';
  });
  /* Layout and grouping are overridden per session without saving, so
     somebody can look at a shared view another way without changing it
     for everybody. Saving is a deliberate act. */
  const [layoutOverride, setLayoutOverride] = useState<Layout | null>(null);
  const [groupOverride, setGroupOverride] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [month, setMonth] = useState(() => new Date());
  const [open, setOpen] = useState<Task | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [editingView, setEditingView] = useState<'new' | 'this' | null>(null);
  /* Views arrive from the server, and a view somebody saves has to
     appear in the rail without a reload, so they are held here too. */
  const [allViews, setAllViews] = useState(views);

  const may = useCallback((c: string) => capabilities.includes(c), [capabilities]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const view = useMemo(() => {
    const v = allViews.find((x) => x.id === viewId) ?? allViews[0];
    if (!v) return null;
    return {
      ...v,
      layout: layoutOverride ?? v.layout,
      group_by: groupOverride ?? v.group_by,
    };
  }, [allViews, viewId, layoutOverride, groupOverride]);

  /* One pipeline: the view filters and sorts, then the two controls
     above the list narrow it further. Search and the company switcher
     are deliberately NOT part of the saved filter, because they are
     things people do for a moment rather than things they mean to keep. */
  const shown = useMemo(() => {
    if (!view) return [];
    let out = applyView(tasks, view, viewer);
    if (entityFilter !== 'all') {
      out = out.filter((t) => t.owning_entity_id === entityFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((t) =>
        t.title.toLowerCase().includes(q)
        || (t.ref ?? '').toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q));
    }
    return out;
  }, [tasks, view, viewer, search, entityFilter]);

  /* What is narrowing the list beyond the view itself, said in words.
     The two controls above the list are the ones people forget they
     touched, and a filter somebody cannot see is a filter that gets
     blamed on the data. */
  const narrowed = useMemo(() => {
    const bits: string[] = [];
    if (search.trim()) bits.push(`Nothing in it has "${search.trim()}" in the title, the ref or the detail.`);
    if (entityFilter !== 'all') {
      const name = entities.find((e) => e.id === entityFilter)?.name ?? 'one company';
      bits.push(`You are filtered to ${name} only.`);
    }
    return bits.length ? bits.join(' ') : null;
  }, [search, entityFilter, entities]);

  /* The diary's own numbers, off the same module the diary screen
     reads, so the count on the tab and the count on that screen are
     the same number by construction. */
  const diary = useMemo(() => diaryCounts(
    toEntries(diaryEvents, {
      meId: viewer.userId,
      invites: diaryInvites,
      people: new Map(diaryPeople.map((p) => [p.id, p])),
      companies: new Map(customers.map((c) => [c.id, c.company_name ?? 'Unnamed'])),
    }),
    viewer.userId,
  ), [diaryEvents, diaryInvites, diaryPeople, customers, viewer.userId]);

  /* The numbers across the top. Counted here from the same rows the
     list draws, so a figure saying seven can never sit above four. */
  const stats = useMemo(() => {
    const mine = tasks.filter((t) => t.assignee_id === viewer.userId
      && t.status !== 'done' && t.status !== 'cancelled');
    return {
      mine: mine.length,
      overdue: mine.filter((t) => isOverdue(t)).length,
      stuck: mine.filter((t) => t.status === 'blocked' || t.status === 'waiting_external').length,
      givenOut: tasks.filter((t) => t.delegated_by === viewer.userId
        && t.status !== 'done' && t.status !== 'cancelled').length,
      onMe: tasks.filter((t) =>
        (t.reviewer_id === viewer.userId || t.approver_id === viewer.userId) && t.status === 'in_review',
      ).length + (viewer.releaseAskedOfMe ?? []).length,
    };
  }, [tasks, viewer]);

  /* The count beside each view in the rail. Same evaluator the list
     runs, so a badge saying 7 can never sit above 4 rows. */
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of allViews) m.set(v.id, applyView(tasks, v, viewer).length);
    return m;
  }, [allViews, tasks, viewer]);

  const openTask = useCallback(async (t: Task) => {
    setOpen(t);
    setMoves([]);
    try {
      const res = await fetch(`/api/work/tasks/${t.id}/moves`);
      if (res.ok) setMoves(await res.json());
    } catch { /* the drawer still opens; it just offers no moves */ }
  }, []);

  const call = useCallback(async (url: string, body: unknown) => {
    setBusy(open?.id ?? 'x');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(json.error ?? 'That did not go through.'); return null; }
      return json;
    } finally {
      setBusy(null);
    }
  }, [open]);

  const move = useCallback(async (t: Task, to: string, reason?: string) => {
    const before = tasks;
    /* Moved on screen first so a board drag does not stutter, and put
       back if the database refuses. */
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status: to as Task['status'] } : x)));
    const out = await call(`/api/work/tasks/${t.id}/move`, { to, reason });
    if (!out) { setTasks(before); return; }
    setTasks((all) => all.map((x) => (x.id === t.id ? out : x)));
    if (open?.id === t.id) { setOpen(out); openTask(out); }
  }, [tasks, call, open, openTask]);

  /* Every write comes back with the row the database now holds, and
     that row replaces the one on screen. Patching the local copy with
     what was SENT would leave the screen showing a value a trigger had
     already changed: the ref, the entity stamp, the completed_at that
     comes with a move to done. */
  const absorb = useCallback((row: Task | null) => {
    if (!row) return;
    setTasks((all) => (all.some((x) => x.id === row.id)
      ? all.map((x) => (x.id === row.id ? row : x))
      : [row, ...all]));
    setOpen((o) => (o && o.id === row.id ? row : o));
  }, []);

  const create = useCallback(async (t: NewTask, andAnother: boolean) => {
    setComposeError(null);
    setBusy('new');
    try {
      const res = await fetch('/api/work/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...t,
          /* Hours on the form, minutes in the column. The form asks in
             the unit people think in and converts here rather than
             asking somebody to do arithmetic. */
          estimate_minutes: t.estimate_minutes ? Math.round(Number(t.estimate_minutes) * 60) : null,
          due_at: t.due_at || null,
          starts_on: t.starts_on || null,
          project_id: t.project_id || null,
          organisation_id: t.organisation_id || null,
          stock_trailer_id: t.stock_trailer_id || null,
          owning_entity_id: t.owning_entity_id || null,
          assignee_id: t.assignee_id || null,
          assignee_dept_id: t.assignee_dept_id || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setComposeError(json.error ?? 'That did not save.'); return false; }
      absorb(json as Task);
      if (!andAnother) setComposing(false);
      setNote(`Raised ${(json as Task).ref ?? 'the task'}.`);
      return true;
    } finally {
      setBusy(null);
    }
  }, [absorb]);

  const assign = useCallback(async (kind: string, id: string | null) => {
    if (!open) return;
    const body: Record<string, unknown> = { kind };
    if (kind === 'person') body.user = id;
    if (kind === 'department') body.dept = id;
    absorb(await call(`/api/work/tasks/${open.id}/assign`, body));
  }, [open, call, absorb]);

  const setDue = useCallback(async (due: string | null) => {
    if (!open) return;
    absorb(await call(`/api/work/tasks/${open.id}/due`, { due }));
  }, [open, call, absorb]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    if (!open) return;
    setBusy(open.id);
    try {
      const res = await fetch(`/api/work/tasks/${open.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(json.error ?? 'That did not save.'); return; }
      absorb(json as Task);
    } finally {
      setBusy(null);
    }
  }, [open, absorb]);

  const saveView = useCallback(async (payload: Record<string, unknown>, mode: 'new' | 'this') => {
    /* Writing back over a view needs a view to write back over. Saving
       a new one does not, which is what makes the builder reachable on
       an installation that has none. */
    if (mode === 'this' && !view) return false;
    setBusy('view');
    try {
      const res = await fetch(
        mode === 'new' ? '/api/work/views' : `/api/work/views/${view!.id}`,
        {
          method: mode === 'new' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(json.error ?? 'That view did not save.'); return false; }
      const saved = json as TaskView;
      setAllViews((all) => (all.some((v) => v.id === saved.id)
        ? all.map((v) => (v.id === saved.id ? saved : v))
        : [...all, saved]));
      setViewId(saved.id);
      /* The overrides were the whole point of saving, so they stop
         being overrides once they are the view. */
      setLayoutOverride(null); setGroupOverride(null);
      setEditingView(null);
      setNote(mode === 'new' ? `Saved. ${saved.name} is in your rail.` : 'Saved.');
      return true;
    } finally {
      setBusy(null);
    }
  }, [view]);

  if (!view) {
    /* No views at all means the seed did not run. The screen still has
       to be usable, so the builder opens against a view that exists
       only in memory: the same editor, the same save, and the result is
       an ordinary row like every other view. */
    const scratch: TaskView = {
      id: '', name: 'My work', description: null, icon: null, owner_id: viewer.userId,
      is_system: false, layout: 'list', group_by: 'status', sub_group_by: null,
      sort: [{ field: 'due_at', dir: 'asc' }],
      filter: { all: [{ field: 'assignee', op: 'is', value: '@me' }] },
      fields: ['ref', 'title', 'assignee', 'status', 'due_at'], options: {}, position: 10,
    };
    return (
      <TabShell>
        <Empty
          title="No views yet"
          body="Work is shown through saved views, and this installation has none. Twelve ship with it, seeded by migration 056."
          action={may('work.views')
            ? <Button size="sm" variant="primary" onClick={() => setEditingView('new')}>
                Build the first one
              </Button>
            : undefined}
        />
        {editingView && (
          <ViewEditor
            base={scratch} mode="new" people={people}
            busy={busy === 'view'} error={null}
            onClose={() => setEditingView(null)}
            onSave={(payload) => saveView(payload, 'new')}
          />
        )}
      </TabShell>
    );
  }

  const layoutProps: LayoutProps = {
    tasks: shown, view, who: viewer,
    people: peopleById, departments: deptById, entities: entityById, projects: projectById,
    onOpen: openTask,
    onMove: (t, to) => move(t, to),
    onNew: may('work.create') ? () => { setComposeError(null); setComposing(true); } : null,
    narrowed,
    onClear: narrowed ? () => { setSearch(''); setEntityFilter('all'); } : null,
    busy,
  };

  const mine = allViews.filter((v) => !v.is_system);
  const system = allViews.filter((v) => v.is_system);
  const openRequests = open ? requests.filter((r) => r.task_id === open.id) : [];

  const railItem = (v: TaskView) => (
    <button
      key={v.id}
      onClick={() => { setViewId(v.id); setLayoutOverride(null); setGroupOverride(null); }}
      title={v.description ?? undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        height: 30, padding: '0 9px', cursor: 'pointer', borderRadius: 'var(--r)',
        border: '1px solid transparent',
        background: v.id === viewId ? 'var(--bg-subtle)' : 'transparent',
        borderColor: v.id === viewId ? 'var(--border-emphasis)' : 'transparent',
        color: v.id === viewId ? 'var(--text)' : 'var(--text-muted)',
        fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: v.id === viewId ? 600 : 500,
      }}
    >
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{v.name}</span>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        fontVariantNumeric: 'tabular-nums',
        color: v.id === viewId ? 'var(--accent)' : 'var(--text-subtle)',
      }}>{counts.get(v.id) ?? 0}</span>
    </button>
  );

  return (
    <TabShell>
      <RecordHead
        icon={<ListChecks size={20} />}
        title="Work"
        badges={tab === 'tasks'
          ? (
            <>
              <Badge tone="neutral" dot>{view.name}</Badge>
              {stats.overdue > 0 && <Badge tone="danger">{stats.overdue} overdue</Badge>}
            </>
          )
          : (diary.waitingOnMe > 0
            ? <Badge tone="warning" dot>{diary.waitingOnMe} waiting on you</Badge>
            : undefined)}
        sub={tab === 'tasks'
          ? (
            <>
              Tasks, delegation and projects across the business.
              {' '}{shown.length} of {tasks.length} shown.
            </>
          )
          : 'Every call, meeting, visit and inspection booked anywhere in the application.'}
        actions={tab === 'tasks' && may('work.create')
          ? <Button size="sm" variant="primary"
              onClick={() => { setComposeError(null); setComposing(true); }}>
              <Plus size={13} /> New task
            </Button>
          : undefined}
      />

      {/* Two halves of the same question. The counts are on the tabs so
          somebody can see there are five calls booked without having to
          open the half that would tell them. */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'tasks' as const, label: 'Tasks', count: stats.mine },
          { key: 'diary' as const, label: 'Meetings and calls', count: diary.ahead },
        ]}
      />

      {tab === 'diary' && (
        <WorkDiary
          events={diaryEvents}
          invites={diaryInvites}
          people={diaryPeople}
          companies={customers}
          meId={viewer.userId}
        />
      )}

      {tab === 'tasks' && (
      <StatStrip items={[
        { label: 'On me', value: stats.mine, note: 'still open' },
        { label: 'Overdue', value: stats.overdue, note: 'past the date' },
        { label: 'Stuck', value: stats.stuck, note: 'blocked or waiting' },
        { label: 'Given out', value: stats.givenOut, note: 'on other people' },
        { label: 'Waiting on me', value: stats.onMe, note: 'to review or answer' },
      ]} />
      )}

      {note && (
        <Alert tone="info">
          <span style={{ flex: 1 }}>{note}</span>
          <Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>
        </Alert>
      )}

      {tab === 'tasks' && (
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <nav
          aria-label="Saved views"
          style={{
            width: 196, flex: 'none', display: 'flex', flexDirection: 'column', gap: 3,
            padding: 9, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <div style={{ padding: '3px 3px 5px' }}><Label>Views</Label></div>
          {system.map(railItem)}
          {mine.length > 0 && (
            <div style={{ padding: '9px 3px 5px' }}><Label>Mine</Label></div>
          )}
          {mine.map(railItem)}
          {may('work.views') && (
            <div style={{ marginTop: 9 }}>
              <Button size="sm" variant="secondary" style={{ width: '100%' }}
                onClick={() => setEditingView('new')}>
                <Plus size={13} /> New view
              </Button>
            </div>
          )}
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* One toolbar, like the CRM pipeline's: what the view is,
              then the things that narrow it, then how it is drawn. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
            padding: '10px 14px', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', border: '1px solid var(--border)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14,
                letterSpacing: '-0.02em', color: 'var(--text)',
              }}>{view.name}</div>
              {view.description && (
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{view.description}</div>
              )}
            </div>

            <span style={{ flex: 1 }} />

            {/* Only drawn for somebody who works for both companies.
                Offering an STC Sales and Leasing filter to somebody who
                is only on STC is offering something that would always
                come back empty. */}
            {multiEntity && (
              <div style={{ width: 168 }}>
                <Select value={entityFilter} onChange={setEntityFilter}>
                  <option value="all">Both companies</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} only</option>
                  ))}
                </Select>
              </div>
            )}

            <div style={{ width: 210, maxWidth: '100%' }}>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Find a task"
                icon={<Search size={14} />}
              />
            </div>

            <div style={{ width: 176 }}>
              <Select value={view.group_by} onChange={setGroupOverride}>
                {GROUPINGS.map((g) => (
                  <option key={g.key} value={g.key}>Group: {g.label}</option>
                ))}
              </Select>
            </div>

            <div role="group" aria-label="Layout" style={{ display: 'flex', gap: 5 }}>
              {LAYOUTS.map(({ key, label, Icon }) => (
                <Chip
                  key={key}
                  active={view.layout === key}
                  title={label}
                  onClick={() => setLayoutOverride(key)}
                >
                  <Icon size={13} /> {label}
                </Chip>
              ))}
            </div>

            {may('work.views') && (
              <IconButton
                label="Customise this view"
                onClick={() => setEditingView(
                  view.is_system && !may('work.manageSystemViews') ? 'new' : 'this',
                )}
              >
                <SlidersHorizontal size={13} />
              </IconButton>
            )}
          </div>

          {view.layout === 'calendar' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 14px', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', border: '1px solid var(--border)',
            }}>
              <IconButton label="Previous month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <ChevronLeft size={14} />
              </IconButton>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                minWidth: 148, color: 'var(--text)',
              }}>
                {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </div>
              <IconButton label="Next month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <ChevronRight size={14} />
              </IconButton>
              <Button size="sm" variant="secondary" onClick={() => setMonth(new Date())}>Today</Button>
            </div>
          )}

          {/* A view being looked at differently from how it was saved.
              Said out loud, with the way to keep it, because the other
              option is somebody rebuilding the same arrangement every
              morning without realising it could be kept. */}
          {(layoutOverride || groupOverride) && may('work.views') && (
            <Alert tone="info">
              <span style={{ flex: 1 }}>
                You are looking at {view.name} your own way rather than how it was saved.
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEditingView('new')}>
                Keep this as a new view
              </Button>
              {(!view.is_system || may('work.manageSystemViews')) && (
                <Button size="sm" variant="secondary" onClick={() => setEditingView('this')}>
                  Save it over {view.name}
                </Button>
              )}
              <Button size="sm" variant="ghost"
                onClick={() => { setLayoutOverride(null); setGroupOverride(null); }}>
                Put it back
              </Button>
            </Alert>
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {view.layout === 'board'    && <BoardLayout {...layoutProps} />}
            {view.layout === 'table'    && <TableLayout {...layoutProps} />}
            {view.layout === 'list'     && <ListLayout {...layoutProps} />}
            {view.layout === 'timeline' && <TimelineLayout {...layoutProps} />}
            {view.layout === 'workload' && <WorkloadLayout {...layoutProps} />}
            {view.layout === 'calendar' && (
              <CalendarLayout {...layoutProps} month={month} onMonth={setMonth} />
            )}
          </div>
        </div>
      </div>
      )}

      {open && (
        <TaskDrawer
          task={open}
          moves={moves}
          requests={openRequests}
          people={peopleById}
          departments={deptById}
          entities={entityById}
          projects={projectById}
          customers={customers}
          trailers={trailers}
          meId={viewer.userId}
          may={may}
          canDecide={openRequests.some((r) => r.asked_of === viewer.userId)
                     || may('work.forceRelease')}
          busy={busy === open.id}
          onAssign={assign}
          onDue={setDue}
          onPatch={patch}
          onClose={() => setOpen(null)}
          onMove={(to, reason) => move(open, to, reason)}
          onAsk={async (ask, reason, suggestUser, due) => {
            const out = await call(`/api/work/tasks/${open.id}/release`, {
              ask, reason, suggestUser, due,
            });
            if (out) setNote('Sent. Whoever assigned it will see it on their Waiting for me view.');
          }}
          onDecide={async (id, grant, decisionNote) => {
            const out = await call(`/api/work/release/${id}`, { grant, note: decisionNote });
            if (out) {
              setNote(grant ? 'Granted, and the task has been updated.' : 'Refused.');
              setOpen(null);
              /* Granting APPLIES the ask in the same transaction, so the
                 row on screen is now wrong in a way a reload would fix
                 and a guess would not. */
              if (grant) window.location.reload();
            }
          }}
        />
      )}

      {composing && (
        <Compose
          people={people}
          departments={departments}
          projects={projects}
          entities={entities}
          customers={customers}
          trailers={trailers}
          meId={viewer.userId}
          may={may}
          multiEntity={multiEntity}
          busy={busy === 'new'}
          error={composeError}
          onClose={() => setComposing(false)}
          onSave={create}
        />
      )}

      {editingView && (
        <ViewEditor
          base={view}
          mode={editingView}
          people={people}
          busy={busy === 'view'}
          error={null}
          onClose={() => setEditingView(null)}
          onSave={saveView}
        />
      )}
    </TabShell>
  );
}
