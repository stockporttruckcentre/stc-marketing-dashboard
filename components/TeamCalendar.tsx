'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CalendarEvent } from '@/lib/types';
import {
  diaryCounts, filterDiary, toEntries,
  type DiaryEntry, type DiaryGuest, type DiaryInvite, type DiaryPerson,
} from '@/lib/calendar/diary';
import { addDays, dayKey, startOfMonth } from '@/lib/calendar/grid';
import type { EventKind } from '@/lib/calendar/kind';
import {
  DiaryScreen, entriesInView, type ViewKind, type Whose,
} from '@/components/calendar/screen';
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
  initialEvents, initialInvites, initialGuests, people, companies, userId, myName,
  capabilities, openEventId, openView,
}: {
  initialEvents: CalendarEvent[];
  initialInvites: DiaryInvite[];
  /** Everybody on a meeting who does not work here. Migration 062. */
  initialGuests: DiaryGuest[];
  people: Person[];
  companies: Company[];
  userId: string;
  myName: string;
  capabilities: string[];
  /** `?event=` from an invitation link or the Work tab's diary. */
  openEventId: string | null;
  /** `?view=` from the command bar. The month unless a sentence said otherwise. */
  openView: ViewKind;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const may = useCallback((c: string) => capabilities.includes(c), [capabilities]);
  const canBook = may('crm.delegate');

  const [events, setEvents] = useState(initialEvents);
  const [invites, setInvites] = useState(initialInvites);
  const [guests, setGuests] = useState(initialGuests);
  const [view, setView] = useState<ViewKind>(openView);
  const [cursor, setCursor] = useState(new Date());
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [whose, setWhose] = useState<Whose>('everything');
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
    () => toEntries(events, {
      meId: userId, invites, guests, people: peopleById, companies: companiesById,
    }),
    [events, invites, guests, peopleById, companiesById, userId],
  );

  const shown = useMemo(() => filterDiary(entries, {
    kinds,
    onlyMine: whose === 'mine',
    search,
  }), [entries, kinds, whose, search]);

  /* The agenda looks forward, because "what is next" is the question it
     answers. The month and the week show what they show. One function,
     shared with the preview harness, so what gets looked at and what
     ships are the same arithmetic. */
  const inView = useMemo(() => entriesInView(shown, view, cursor), [shown, view, cursor]);

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

    const [eventsRes, invitesRes, guestsRes] = await Promise.all([
      supabase.from('calendar_events').select('*')
        .gte('start_at', from).lt('start_at', to).order('start_at'),
      supabase.from('calendar_invites')
        .select('id, event_id, user_id, invited_by, status, proposed_start_at, proposed_end_at, awaiting, rounds, note, responded_at'),
      supabase.from('calendar_guests')
        .select('id, event_id, email, name, status, proposed_start_at, proposed_end_at, rounds, note, responded_at, seen_at, invited_by'),
    ]);

    setEvents((eventsRes.data ?? []) as CalendarEvent[]);
    setInvites((invitesRes.data ?? []) as DiaryInvite[]);
    setGuests((guestsRes.data ?? []) as DiaryGuest[]);
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
      /* A guest answering is somebody else's browser writing, so it has
         to arrive here the same way a colleague's answer does. That is
         the whole of "others on the meeting see the update". */
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_guests' },
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

  return (
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
      canBook={canBook}
      onView={setView}
      onCursor={setCursor}
      onSearch={setSearch}
      onKinds={setKinds}
      onWhose={setWhose}
      onNote={setNote}
      onOpen={openEntry}
      onCompose={compose}
      drawer={open && (
        <EntryDrawer
          event={open.event}
          draft={open.draft}
          people={people}
          companies={companies}
          guests={guests.filter((g) => g.event_id === open.event?.id)}
          meId={userId}
          may={may}
          onClose={() => setOpen(null)}
          onSaved={(message) => { setNote(message); setOpen(null); void reload(); }}
          onDeleted={(message) => { setNote(message); setOpen(null); void reload(); }}
        />
      )}
    />
  );
}
