'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CalendarEvent } from '@/lib/types';
import {
  diaryCounts, filterDiary, toEntries,
  type DiaryEntry, type DiaryInvite, type DiaryPerson,
} from '@/lib/calendar/diary';
import {
  addDays, dayKey, monthGrid, monthLabel, startOfDay, startOfMonth, startOfWeek, weekLabel,
} from '@/lib/calendar/grid';
import { EVENT_KINDS, KIND_PLURAL, type EventKind } from '@/lib/calendar/kind';
import {
  Alert, Badge, Button, Chip, IconButton, RecordHead, SearchInput, StatStrip, TabShell, Tabs,
} from '@/components/kit/primitives';
import { Select } from '@/components/kit/forms';
import { AgendaView, MonthView, WeekView } from '@/components/calendar/views';
import {
  EntryDrawer, blankDraft, draftFor, type Company, type Draft, type Person,
} from '@/components/calendar/drawer';

/* =============================================================
   The diary.

   ---- What this replaces ----

   A month grid, a seven day strip underneath it, and a form. It worked
   and it looked like a month grid and a form. Three things were wrong
   with it beyond the look:

   The weekday names sat in their own CSS grid above the days, so a long
   meeting title widened its column and every name after it drifted off
   its day. That is fixed in `components/calendar/views.tsx`, where the
   names are now the first row of the same grid.

   Clicking a meeting opened a form that could change a title and a
   colour. Who was on it was a read only list of names, and the
   invitation tables that migration 006 added had never been read by any
   screen. That is `components/calendar/drawer.tsx`.

   And there was one way to look at it. A month is for orientation. The
   view somebody works from in the morning is a list of what is next,
   and there was not one.

   ---- Three views, one set of rows ----

   Month, week and agenda are three renderings of the same filtered
   list, so a count on the strip and the number of things on the screen
   can never disagree. The filters sit above all three and say out loud
   when they are hiding something.
   ============================================================= */

export function TeamCalendar({
  initialEvents, initialInvites, people, companies, userId, myName, capabilities,
  openEventId, openView,
}: {
  initialEvents: CalendarEvent[];
  initialInvites: DiaryInvite[];
  people: Person[];
  companies: Company[];
  userId: string;
  myName: string;
  capabilities: string[];
  /** `?event=` from an invitation link or the Work tab's diary. */
  openEventId: string | null;
  /** `?view=` from the command bar. The month unless a sentence said otherwise. */
  openView: 'month' | 'week' | 'agenda';
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const may = useCallback((c: string) => capabilities.includes(c), [capabilities]);
  const canBook = may('crm.delegate');

  const [events, setEvents] = useState(initialEvents);
  const [invites, setInvites] = useState(initialInvites);
  const [view, setView] = useState<'month' | 'week' | 'agenda'>(openView);
  const [cursor, setCursor] = useState(new Date());
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [whose, setWhose] = useState<'everything' | 'mine'>('everything');
  const [open, setOpen] = useState<{ event: CalendarEvent | null; draft: Draft } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p as DiaryPerson])),
    [people],
  );
  const companiesById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.company_name ?? 'Unnamed'])),
    [companies],
  );

  /* Everything the screen draws, in one pipeline. The three views are
     renderings of `shown`, so the strip and the grid cannot disagree
     about how many meetings there are on Thursday. */
  const entries = useMemo(
    () => toEntries(events, { meId: userId, invites, people: peopleById, companies: companiesById }),
    [events, invites, peopleById, companiesById, userId],
  );

  const shown = useMemo(() => filterDiary(entries, {
    kinds,
    onlyMine: whose === 'mine',
    search,
  }), [entries, kinds, whose, search]);

  /* The agenda looks forward, because "what is next" is the question it
     answers. The month and the week show what they show. */
  const inView = useMemo(() => {
    if (view === 'agenda') {
      const today = startOfDay(new Date()).getTime();
      return shown.filter((e) => startOfDay(e.start).getTime() >= today);
    }
    if (view === 'week') {
      const from = startOfWeek(cursor).getTime();
      const to = addDays(startOfWeek(cursor), 7).getTime();
      return shown.filter((e) => e.start.getTime() >= from && e.start.getTime() < to);
    }
    const cells = monthGrid(cursor);
    const from = cells[0].getTime();
    const to = addDays(cells[cells.length - 1], 1).getTime();
    return shown.filter((e) => e.start.getTime() >= from && e.start.getTime() < to);
  }, [shown, view, cursor]);

  const counts = useMemo(() => diaryCounts(entries, userId), [entries, userId]);
  const perKind = useMemo(() => {
    const map = new Map<EventKind, number>();
    for (const e of entries) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return map;
  }, [entries]);

  /* ---- reading ---- */

  /**
   * A window wide enough for whichever view is showing.
   *
   * The agenda looks months ahead and the month view looks at one
   * month, so the read is the wider of the two rather than the month
   * the cursor is on. Reading only the visible month is what used to
   * make the seven day strip go empty at the end of a month.
   */
  const reload = useCallback(async () => {
    const from = startOfMonth(addDays(startOfMonth(cursor), -1)).toISOString();
    const to = addDays(startOfMonth(cursor), 120).toISOString();

    const [eventsRes, invitesRes] = await Promise.all([
      supabase.from('calendar_events').select('*')
        .gte('start_at', from).lt('start_at', to).order('start_at'),
      supabase.from('calendar_invites')
        .select('id, event_id, user_id, invited_by, status, proposed_start_at, proposed_end_at, awaiting, rounds, note, responded_at'),
    ]);

    setEvents((eventsRes.data ?? []) as CalendarEvent[]);
    setInvites((invitesRes.data ?? []) as DiaryInvite[]);
  }, [supabase, cursor]);

  useEffect(() => { void reload(); }, [reload]);

  /* Somebody else booking something, or answering an invitation, shows
     up without a reload. The whole list is read back rather than the
     one row patched, because accepting a proposal moves the meeting and
     a patched copy would show the old time. */
  useEffect(() => {
    const channel = supabase
      .channel('diary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' },
        () => { void reload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_invites' },
        () => { void reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, reload]);

  /* An invitation email, a notification, or the Work tab's diary sends
     somebody to `?event=`. Opening it here is what makes those links
     lead somewhere rather than to the month it happens to be. */
  useEffect(() => {
    if (!openEventId) return;
    const found = events.find((e) => e.id === openEventId);
    if (!found) return;
    setOpen({ event: found, draft: draftFor(found) });
    setCursor(new Date(found.start_at));
    router.replace('/dashboard/calendar');
  }, [openEventId, events, router]);

  /* ---- moving about ---- */

  const step = useCallback((by: -1 | 1) => {
    setCursor((c) => (view === 'week' ? addDays(c, by * 7) : new Date(c.getFullYear(), c.getMonth() + by, 1)));
  }, [view]);

  const openEntry = useCallback((entry: DiaryEntry) => {
    setNote(null);
    setOpen({ event: entry.event, draft: draftFor(entry.event) });
  }, []);

  const compose = useCallback((day: string) => {
    if (!canBook) return;
    setNote(null);
    setOpen({ event: null, draft: blankDraft(day, userId, myName) });
  }, [canBook, userId, myName]);

  const narrowed = useMemo(() => {
    const bits: string[] = [];
    if (kinds.length) bits.push(`only ${kinds.map((k) => KIND_PLURAL[k].toLowerCase()).join(' and ')}`);
    if (whose === 'mine') bits.push('only what you are on');
    if (search.trim()) bits.push(`only what mentions "${search.trim()}"`);
    return bits.length ? bits.join(', ') : null;
  }, [kinds, whose, search]);

  const label = view === 'week' ? weekLabel(cursor) : monthLabel(cursor);
  const viewProps = {
    entries: inView,
    cursor,
    onOpen: openEntry,
    onCompose: compose,
    canCompose: canBook,
  };

  return (
    <TabShell>
      <RecordHead
        icon={<CalendarDays size={20} />}
        title="Diary"
        badges={<>
          {counts.waitingOnMe > 0 && (
            <Badge tone="warning" dot>
              {counts.waitingOnMe} waiting on you
            </Badge>
          )}
          {counts.today > 0 && <Badge tone="neutral" dot>{counts.today} today</Badge>}
        </>}
        sub="Every call, meeting, visit and inspection booked anywhere in the business."
        actions={canBook
          ? (
            <Button variant="accent" onClick={() => compose(dayKey(new Date()))}>
              <Plus size={14} /> Book something
            </Button>
          )
          : undefined}
      />

      <StatStrip items={[
        { label: 'Today', value: counts.today, note: 'in the diary' },
        { label: 'This week', value: counts.thisWeek, note: 'next seven days' },
        { label: 'Calls', value: counts.calls, note: 'still to make' },
        { label: 'Meetings', value: counts.meetings, note: 'and visits ahead' },
        { label: 'Waiting on you', value: counts.waitingOnMe, note: 'to answer' },
      ]} />

      {note && (
        <Alert tone="success">
          <span style={{ flex: 1 }}>{note}</span>
          <Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>
        </Alert>
      )}

      {/* ---- the bar: where you are, then what narrows it ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        padding: '9px 12px', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <IconButton label={view === 'week' ? 'The week before' : 'The month before'}
            onClick={() => step(-1)}>
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton label={view === 'week' ? 'The week after' : 'The month after'}
            onClick={() => step(1)}>
            <ChevronRight size={14} />
          </IconButton>
          <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>Today</Button>
        </div>

        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
          letterSpacing: '-0.02em', color: 'var(--text)', minWidth: 168,
          /* The agenda is not a month, so labelling it with one would be
             saying something untrue about what is on the screen. */
          visibility: view === 'agenda' ? 'hidden' : 'visible',
        }}>{label}</div>

        <span style={{ flex: 1 }} />

        <div style={{ width: 200, maxWidth: '100%' }}>
          <SearchInput
            value={search} onChange={setSearch}
            placeholder="Title, customer or person"
            icon={<Search size={14} />}
          />
        </div>

        <div style={{ width: 150 }}>
          <Select value={whose} onChange={(v) => setWhose(v as 'everything' | 'mine')}>
            <option value="everything">Everything</option>
            <option value="mine">Only mine</option>
          </Select>
        </div>

        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { key: 'month' as const, label: 'Month' },
            { key: 'week' as const, label: 'Week' },
            { key: 'agenda' as const, label: 'What is next', count: counts.ahead },
          ]}
        />
      </div>

      {/* ---- the kinds, as chips, because a diary is read by kind ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={kinds.length === 0} onClick={() => setKinds([])}>
          Everything
        </Chip>
        {EVENT_KINDS.filter((k) => k !== 'reminder').map((k) => (
          <Chip
            key={k}
            active={kinds.includes(k)}
            count={perKind.get(k) ?? 0}
            empty={(perKind.get(k) ?? 0) === 0}
            onClick={() => setKinds(kinds.includes(k)
              ? kinds.filter((x) => x !== k)
              : [...kinds, k])}
          >{KIND_PLURAL[k]}</Chip>
        ))}

        <span style={{ flex: 1 }} />

        {narrowed && (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Showing {narrowed}.{' '}
            <button
              type="button"
              onClick={() => { setKinds([]); setWhose('everything'); setSearch(''); }}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--text-muted)', font: 'inherit', textDecoration: 'underline',
              }}
            >Show everything</button>
          </span>
        )}
      </div>

      {view === 'month' && <MonthView {...viewProps} />}
      {view === 'week' && <WeekView {...viewProps} />}
      {view === 'agenda' && <AgendaView {...viewProps} />}

      {open && (
        <EntryDrawer
          event={open.event}
          draft={open.draft}
          people={people}
          companies={companies}
          meId={userId}
          may={may}
          onClose={() => setOpen(null)}
          onSaved={(message) => { setNote(message); setOpen(null); void reload(); }}
          onDeleted={(message) => { setNote(message); setOpen(null); void reload(); }}
        />
      )}
    </TabShell>
  );
}
