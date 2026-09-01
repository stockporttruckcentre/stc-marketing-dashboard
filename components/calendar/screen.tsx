'use client';

import { useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Search,
} from 'lucide-react';
import type { DiaryEntry } from '@/lib/calendar/diary';
import { addDays, dayKey, monthGrid, monthLabel, startOfDay, startOfWeek, weekLabel } from '@/lib/calendar/grid';
import { EVENT_KINDS, KIND_CHIP, KIND_PLURAL, type EventKind } from '@/lib/calendar/kind';
import {
  Alert, Badge, Button, Chip, IconButton, RecordHead, SearchInput, TabShell, Tabs,
} from '@/components/kit/primitives';
import { AgendaView, MonthView, WeekView } from './views';

/* =============================================================
   The diary, as a screen.

   Split from `components/TeamCalendar.tsx` so it can be looked at.

   The comment at the top of `app/uikit-preview/page.tsx` says why, and
   it was written about exactly this failure: "that is how a page ends
   up with three stacked toolbars and a table squeezed into half the
   window: every piece is defensible on its own and the whole is not."
   A screen that owns its own Supabase client cannot be rendered without
   credentials, so it gets judged by reading the code, and the code
   reads fine right up until you see it.

   So the reads, the realtime subscription and the writes stay in
   `TeamCalendar`, and everything that draws is here, taking rows. It is
   the same split the preview harness already relies on for the CRM.

   ---- What is fixed in the layout ----

   Five things sit above the grid: the head, the numbers, the bar, the
   chips, and sometimes a notice. `TabShell` is a fixed height, so
   whatever is left over is what the month has to fit into, and a month
   is six rows of cells that each wanted a minimum height. On a laptop
   that came to more than the space there was, and the grid pushed out
   through the bottom of the shell.

   The month now sizes its own rows off how many rows it has and lets
   them shrink, with a scrollbar as the last resort rather than the
   first thing that happens.
   ============================================================= */

export type ViewKind = 'month' | 'week' | 'agenda';
export type Whose = 'everything' | 'mine';

export type DiaryCounts = {
  today: number; thisWeek: number; calls: number; meetings: number;
  waitingOnMe: number; ahead: number;
};

export function DiaryScreen({
  entries, counts, perKind, view, cursor, search, kinds, whose, note, canBook,
  onView, onCursor, onSearch, onKinds, onWhose, onNote, onOpen, onCompose, drawer,
}: {
  /** Already filtered and already narrowed to what this view shows. */
  entries: DiaryEntry[];
  counts: DiaryCounts;
  perKind: Map<EventKind, number>;
  view: ViewKind;
  cursor: Date;
  search: string;
  kinds: EventKind[];
  whose: Whose;
  note: string | null;
  canBook: boolean;
  onView: (v: ViewKind) => void;
  onCursor: (d: Date) => void;
  onSearch: (v: string) => void;
  onKinds: (v: EventKind[]) => void;
  onWhose: (v: Whose) => void;
  onNote: (v: string | null) => void;
  onOpen: (entry: DiaryEntry) => void;
  onCompose: (day: string, toggle?: boolean) => void;
  /** The entry drawer, when one is open. Owned by whoever can save. */
  drawer?: React.ReactNode;
}) {
  const narrowed = useMemo(() => {
    const bits: string[] = [];
    if (kinds.length) bits.push(`only ${kinds.map((k) => KIND_PLURAL[k].toLowerCase()).join(' and ')}`);
    if (whose === 'mine') bits.push('only what you are on');
    if (search.trim()) bits.push(`only what mentions "${search.trim()}"`);
    return bits.length ? bits.join(', ') : null;
  }, [kinds, whose, search]);

  const step = (by: -1 | 1) => {
    onCursor(view === 'week'
      ? addDays(cursor, by * 7)
      : new Date(cursor.getFullYear(), cursor.getMonth() + by, 1));
  };

  const label = view === 'week' ? weekLabel(cursor) : monthLabel(cursor);
  const viewProps = { entries, cursor, onOpen, onCompose, canCompose: canBook };

  return (
    <TabShell>
      <RecordHead
        icon={<CalendarDays size={20} />}
        title="Diary"
        badges={<>
          {counts.waitingOnMe > 0 && (
            <Badge tone="warning" dot>{counts.waitingOnMe} waiting on you</Badge>
          )}
          <Badge tone="neutral" dot>{counts.today} today</Badge>
          <Badge tone="neutral">{counts.thisWeek} this week</Badge>
        </>}
        sub="Every call, meeting, visit and inspection booked anywhere in the business."
        /* Which view you are in is not a filter, so it does not belong
           in the bar of filters. It sits by the primary action, where
           it has room at any width and does not compete with the six
           kind chips for the same line. That is also what stopped the
           bar overflowing at 1024, where the tabs ran 129px off the
           right hand edge and read as the calendar overlapping itself. */
        actions={
          <>
            <Tabs
              value={view}
              onChange={onView}
              tabs={[
                { key: 'month' as const, label: 'Month' },
                { key: 'week' as const, label: 'Week' },
                { key: 'agenda' as const, label: 'Next', count: counts.ahead },
              ]}
            />
            {canBook && (
              <Button variant="accent" onClick={() => onCompose(dayKey(new Date()))}>
                <Plus size={14} /> Book something
              </Button>
            )}
          </>
        }
      />

      {/* No strip of numbers here, and that is a decision rather than a
          saving. Three of its five figures are the counts already on
          the kind chips below, and the other two are on the head. On a
          1280 laptop the head, a strip and a bar came to 304px before
          the month started, which left six week rows sharing 388px and
          a calendar that read as squashed into the bottom of the page.

          The Work tab's diary keeps its strip: it is a list, it has the
          room, and the numbers are the reason somebody opens it. */}

      {note && (
        <Alert tone="success">
          <span style={{ flex: 1 }}>{note}</span>
          <Button size="sm" variant="ghost" onClick={() => onNote(null)}>Dismiss</Button>
        </Alert>
      )}

      {/* ---- one bar: where you are, what narrows it, how it is drawn ----

          One rather than two. The kind chips used to be a second row
          underneath this, which is the stacked toolbar the preview
          harness was built to catch: two full width bars above a grid
          that then had nowhere left to go. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        /* Never. A wrapping toolbar is a toolbar whose height depends
           on the window, and every pixel it grows comes off the
           calendar underneath it. At 1032px, which is what a 1280
           laptop leaves after the sidebar and the page padding, this
           bar wrapped onto a second line and pushed the month down by
           43px. The chips scroll instead. */
        flexWrap: 'nowrap',
        padding: '8px 11px', borderRadius: 'var(--r-md)', flex: 'none',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
          <IconButton label={view === 'week' ? 'The week before' : 'The month before'}
            onClick={() => step(-1)}>
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton label={view === 'week' ? 'The week after' : 'The month after'}
            onClick={() => step(1)}>
            <ChevronRight size={14} />
          </IconButton>
          <Button size="sm" variant="secondary" onClick={() => onCursor(new Date())}>Today</Button>
        </div>

        {/* A fixed width, sized for the longest label there is.
            "24 to 30 Aug 2026" is wider than "August 2026", so on the
            week view the label pushed the tabs onto a second line and
            the bar became two bars. A width means the bar is the same
            shape whichever view is on, and nothing moves when you step
            through the months. */}
        {view !== 'agenda' && (
          <div style={{
            width: 152, flex: 'none',
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
            letterSpacing: '-0.02em', color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{label}</div>
        )}

        <span style={{
          width: 1, height: 20, background: 'var(--border)', flex: 'none',
        }} />

        {/* The chips, inline. A diary is read by kind, so these are the
            filter people reach for, and they belong next to the search
            rather than in a row of their own. */}
        {/* Scrolls when it has to, and says so.

            Without the mask the chip on the edge is cut through the
            middle of a word, which reads as a rendering fault rather
            than as "there is more this way". The fade is only painted
            where there is something to scroll to. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          minWidth: 0, flexShrink: 1, overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)',
        }}>
          <Chip active={kinds.length === 0} onClick={() => onKinds([])}>All</Chip>
          {/* Whose, as a chip rather than a dropdown. It is a yes or no,
              and a 132px select for a yes or no was 132px the chips
              needed more. */}
          <Chip
            active={whose === 'mine'}
            onClick={() => onWhose(whose === 'mine' ? 'everything' : 'mine')}
          >Only mine</Chip>
          <span style={{ width: 1, height: 18, background: 'var(--border)', flex: 'none' }} />
          {EVENT_KINDS.filter((k) => k !== 'reminder').map((k) => (
            <Chip
              key={k}
              active={kinds.includes(k)}
              count={perKind.get(k) ?? 0}
              empty={(perKind.get(k) ?? 0) === 0}
              onClick={() => onKinds(kinds.includes(k)
                ? kinds.filter((x) => x !== k)
                : [...kinds, k])}
            >{KIND_CHIP[k]}</Chip>
          ))}
        </div>

        <span style={{ flex: 1, minWidth: 8 }} />

        <div style={{ width: 178, flex: 'none' }}>
          <SearchInput
            value={search} onChange={onSearch}
            placeholder="Title, customer, person"
            icon={<Search size={14} />}
          />
        </div>

      </div>

      {narrowed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
          fontSize: 11.5, color: 'var(--text-subtle)',
        }}>
          <span style={{ flex: 1 }}>Showing {narrowed}.</span>
          <Button size="sm" variant="ghost"
            onClick={() => { onKinds([]); onWhose('everything'); onSearch(''); }}>
            Show everything
          </Button>
        </div>
      )}

      {view === 'month' && <MonthView {...viewProps} />}
      {view === 'week' && <WeekView {...viewProps} />}
      {view === 'agenda' && <AgendaView {...viewProps} />}

      {drawer}
    </TabShell>
  );
}

/** Which entries a view is actually showing. Exported so the preview and the screen agree. */
export function entriesInView(all: DiaryEntry[], view: ViewKind, cursor: Date): DiaryEntry[] {
  if (view === 'agenda') {
    const today = startOfDay(new Date()).getTime();
    return all.filter((e) => startOfDay(e.start).getTime() >= today);
  }
  if (view === 'week') {
    const from = startOfWeek(cursor).getTime();
    const to = addDays(startOfWeek(cursor), 7).getTime();
    return all.filter((e) => e.start.getTime() >= from && e.start.getTime() < to);
  }
  const cells = monthGrid(cursor);
  const from = cells[0].getTime();
  const to = addDays(cells[cells.length - 1], 1).getTime();
  return all.filter((e) => e.start.getTime() >= from && e.start.getTime() < to);
}
