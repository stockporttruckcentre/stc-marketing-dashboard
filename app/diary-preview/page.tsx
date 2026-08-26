'use client';

/* =============================================================
   Diary preview harness. Development only.

   The same harness as `app/uikit-preview`, and for the same reason its
   header gives: a screen that owns its own Supabase client cannot be
   opened without credentials, so it gets judged by reading the code,
   and the code reads fine right up until you see it.

   This renders the real `DiaryScreen`, the real `WorkDiary` and the
   real `EntryDrawer` against fabricated rows. Nothing here is a mock of
   the UI. It is the UI, with rows made up.

   `notFound()` in production, so it is never reachable on a deployment.
   ============================================================= */
import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import type { CalendarEvent } from '@/lib/types';
import { diaryCounts, filterDiary, toEntries, type DiaryInvite, type DiaryPerson } from '@/lib/calendar/diary';
import { dayKey } from '@/lib/calendar/grid';
import type { EventKind } from '@/lib/calendar/kind';
import {
  DiaryScreen, entriesInView, type ViewKind, type Whose,
} from '@/components/calendar/screen';
import {
  EntryDrawer, blankDraft, draftFor, type Draft,
} from '@/components/calendar/drawer';
import { WorkDiary } from '@/components/work/diary';
import { Tabs } from '@/components/kit/primitives';
import { Sidebar } from '@/components/Sidebar';
import type { Profile } from '@/lib/types';

/* The real application shell around it, because the width the diary
   actually gets is 248px of sidebar and 56px of page padding narrower
   than the window, and every judgement about whether it fits has to be
   made at that width rather than at the window's. */
const viewer: Profile = {
  id: '00000000-0000-0000-0000-0000000000a1',
  email: 'alex@stc-uk.com', full_name: 'Alex Ellis',
  role: 'admin', theme: 'dark', created_at: '',
};

const ME = '00000000-0000-0000-0000-0000000000a1';
const TOM = '00000000-0000-0000-0000-0000000000a2';
const DAVE = '00000000-0000-0000-0000-0000000000a3';
const RAMA = '00000000-0000-0000-0000-0000000000a4';

const people: DiaryPerson[] = [
  { id: ME, full_name: 'Alex Ellis', email: 'alex@stc-uk.com' },
  { id: TOM, full_name: 'Tom Moore', email: 'tom@stc-uk.com' },
  { id: DAVE, full_name: 'Dave Sherratt', email: 'dave@stc-uk.com' },
  { id: RAMA, full_name: 'Rama Patel', email: 'rama@stc-uk.com' },
];

const companies = [
  { id: 'c1', company_name: 'Dawson Group' },
  { id: 'c2', company_name: 'Bredbury Haulage' },
  { id: 'c3', company_name: 'SMH Transport' },
  { id: 'c4', company_name: 'Wincanton North' },
  { id: 'c5', company_name: 'Manchester and District Commercial Vehicle Rentals Limited' },
];

/* Deliberately awkward.

   A long title, a longer one, and one that is a single unbroken word,
   because a word with no spaces in it cannot be wrapped and is what
   actually pushes a column wider. Plus five things on one day, which is
   what makes a month cell decide what to hide. Anything that looks
   right against this looks right against real rows. */
const TITLES: [string, string | null, string[]][] = [
  ['Call Dawson Group about the curtainsider quote and the refurb', 'c1', []],
  ['Site visit, Carrington yard, walk the whole fleet with the transport manager and the workshop foreman', 'c2', [TOM]],
  ['PMI inspection C123456', null, []],
  ['Meeting with SMH Transport, FleetSmart+ handover', 'c3', [TOM, DAVE]],
  ['Ring Wincanton back about the tri axle', 'c4', []],
  ['Quarterly review', null, [TOM, DAVE, RAMA]],
  ['Chase the Bredbury proposal', 'c2', []],
  ['MOT booked, KX21 ABC', null, []],
  ['Reminder: send the FleetSmart quote', null, []],
  ['Catch up with Dave', null, [DAVE]],
  ['Call Rama about the flyer artwork', null, []],
  ['Depot visit, Haydock', null, [DAVE]],
  ['Callaboutthereplacementcurtainsiderquotationandrefurbishmentschedule', 'c1', []],
  ['Meeting', 'c3', [TOM]],
  ['Site visit', null, []],
];

const COLOURS = ['#CF2417', '#5B8DEF', '#2ECC71', '#F5A623', '#A065FF', '#06B6D4'];

/* Spread across the month either side of today, at a realistic density:
   a couple of quiet days, one day with five things on it. */
const OFFSETS = [-9, -4, -1, 0, 0, 0, 1, 2, 2, 5, 9, 16, 0, 0, 1];
const HOURS = [9, 10, 11, 8, 13, 16, 9, 14, 10, 11, 15, 9, 7, 17, 12];

function at(days: number, hour: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0).toISOString();
}

const events: CalendarEvent[] = TITLES.map(([title, contact, guests], i) => ({
  id: `e${i}`,
  title,
  description: i % 3 === 0 ? 'Bring the spec sheet and last year’s invoice volume.' : null,
  start_at: at(OFFSETS[i], HOURS[i]),
  end_at: at(OFFSETS[i], HOURS[i] + 1),
  all_day: false,
  color: COLOURS[i % COLOURS.length],
  created_by: i % 4 === 0 ? TOM : ME,
  contact_id: contact,
  attendees: [
    { user_id: i % 4 === 0 ? TOM : ME, name: i % 4 === 0 ? 'Tom Moore' : 'Alex Ellis' },
    ...guests.map((g) => ({ user_id: g, name: people.find((p) => p.id === g)!.full_name! })),
  ],
  visibility: i % 5 === 0 ? 'private' : 'team',
  visible_to: [],
  created_at: '',
  updated_at: '',
}));

/* One of each standing, so every state on the attendee row is on the
   screen at once rather than one at a time. */
const invites: DiaryInvite[] = [
  { id: 'i1', event_id: 'e1', user_id: TOM, invited_by: ME, status: 'accepted',
    proposed_start_at: null, proposed_end_at: null, awaiting: null, rounds: 1, note: null, responded_at: null },
  { id: 'i2', event_id: 'e3', user_id: TOM, invited_by: ME, status: 'declined',
    proposed_start_at: null, proposed_end_at: null, awaiting: null, rounds: 1, note: 'On leave.', responded_at: null },
  { id: 'i3', event_id: 'e3', user_id: DAVE, invited_by: ME, status: 'proposed',
    proposed_start_at: at(3, 14), proposed_end_at: at(3, 15), awaiting: ME, rounds: 2, note: 'Thursday suits better.', responded_at: null },
  { id: 'i4', event_id: 'e5', user_id: ME, invited_by: TOM, status: 'pending',
    proposed_start_at: null, proposed_end_at: null, awaiting: ME, rounds: 0, note: null, responded_at: null },
  { id: 'i5', event_id: 'e5', user_id: DAVE, invited_by: TOM, status: 'accepted',
    proposed_start_at: null, proposed_end_at: null, awaiting: null, rounds: 1, note: null, responded_at: null },
  { id: 'i6', event_id: 'e9', user_id: DAVE, invited_by: ME, status: 'pending',
    proposed_start_at: null, proposed_end_at: null, awaiting: DAVE, rounds: 0, note: null, responded_at: null },
];

export default function DiaryPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const [tab, setTab] = useState<'diary' | 'work'>('diary');
  const [view, setView] = useState<ViewKind>('month');
  const [cursor, setCursor] = useState(new Date());
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [whose, setWhose] = useState<Whose>('everything');
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ event: CalendarEvent | null; draft: Draft } | null>(null);

  const ctx = useMemo(() => ({
    meId: ME,
    invites,
    people: new Map(people.map((p) => [p.id, p])),
    companies: new Map(companies.map((c) => [c.id, c.company_name])),
  }), []);

  const entries = useMemo(() => toEntries(events, ctx), [ctx]);
  const shown = useMemo(
    () => filterDiary(entries, { kinds, onlyMine: whose === 'mine', search }),
    [entries, kinds, whose, search],
  );
  const inView = useMemo(() => entriesInView(shown, view, cursor), [shown, view, cursor]);
  const counts = useMemo(() => diaryCounts(entries, ME), [entries]);
  const perKind = useMemo(() => {
    const map = new Map<EventKind, number>();
    for (const e of entries) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return map;
  }, [entries]);

  return (
    <div className="app">
      <Sidebar profile={viewer} pendingPosts={0} emblemUrl={null} />
      <div className="main">
        <div style={{
          height: 52, flex: 'none', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16,
        }}>
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Workspace / Diary</span>
          <span style={{ flex: 1 }} />
          <div className="kit" style={{ width: 300 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'diary' as const, label: 'Diary screen' },
                { key: 'work' as const, label: 'Work tab diary' },
              ]}
            />
          </div>
        </div>
        <main className="page">
      {tab === 'diary' ? (
        <DiaryScreen
          entries={inView}
          counts={counts}
          perKind={perKind}
          view={view}
          cursor={cursor}
          search={search}
          kinds={kinds}
          whose={whose}
          note={note}
          canBook
          onView={setView}
          onCursor={setCursor}
          onSearch={setSearch}
          onKinds={setKinds}
          onWhose={setWhose}
          onNote={setNote}
          onOpen={(e) => setOpen({ event: e.event, draft: draftFor(e.event) })}
          onCompose={(day) => setOpen({ event: null, draft: blankDraft(day, ME, 'Alex Ellis') })}
          drawer={open && (
            <EntryDrawer
              event={open.event}
              draft={open.draft}
              people={people}
              companies={companies}
              meId={ME}
              may={() => true}
              onClose={() => setOpen(null)}
              onSaved={(m) => { setNote(m); setOpen(null); }}
              onDeleted={(m) => { setNote(m); setOpen(null); }}
            />
          )}
        />
      ) : (
        <div className="kit" style={{
          height: 'calc(100vh - 132px)', minHeight: 520,
          display: 'flex', flexDirection: 'column', gap: 12, background: 'transparent',
        }}>
          <WorkDiary
            events={events}
            invites={invites}
            people={people}
            companies={companies}
            meId={ME}
          />
        </div>
      )}

        </main>
      </div>
    </div>
  );
}
