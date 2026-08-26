/* =============================================================
   The diary, as one list.

   Everything booked anywhere in the application lands in
   `calendar_events`: the CRM's schedule button, the command bar's "book
   a call with Dawson on Friday", the calendar's own compose form. What
   there was not, until now, was anywhere that showed all of it at once.
   The calendar drew a month, and the Work tab did not know the diary
   existed.

   So this is the shared read. One projection, one grouping, one set of
   words for what a row is, used by both screens, because a Work tab
   that counted meetings differently from the calendar would be a Work
   tab nobody trusted the second they disagreed.

   ---- Who is on it ----

   Two answers, and both matter. `attendees` is the JSONB list the forms
   have always written: names, sometimes with a user id. `calendar_invites`
   is migration 006: one row per person, with where they stand. The
   first is who was meant to be there and the second is who has said
   they will.

   `attendeesOf` merges them, invite first, so a person who has declined
   shows as declined rather than as a name in a list. An event with no
   invites behaves exactly as it did before, which is what makes this
   safe to put in front of rows booked last year.
   ============================================================= */
import type { CalendarEvent, CalendarEventAttendee, InviteStatus } from '@/lib/types';
import { dayKey, startOfDay } from './grid';
import { eventKind, isDiaryKind, type EventKind } from './kind';

export type DiaryInvite = {
  id: string;
  event_id: string;
  user_id: string;
  invited_by: string | null;
  status: InviteStatus;
  proposed_start_at: string | null;
  proposed_end_at: string | null;
  awaiting: string | null;
  rounds: number;
  note: string | null;
  responded_at: string | null;
};

export type DiaryPerson = { id: string; full_name: string | null; email: string | null };

/** One person on one event, however they got there. */
export type DiaryAttendee = {
  key: string;
  name: string;
  email: string | null;
  userId: string | null;
  /** Null where they are a name on the row and were never actually asked. */
  status: InviteStatus | null;
  inviteId: string | null;
  /** True where the meeting is waiting on this person to answer. */
  awaited: boolean;
  organiser: boolean;
};

export const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Not answered',
  accepted: 'Coming',
  declined: 'Not coming',
  proposed: 'Suggested another time',
};

/** What one row is, with everything a list needs to draw it. */
export type DiaryEntry = {
  event: CalendarEvent;
  kind: EventKind;
  start: Date;
  end: Date | null;
  dayKey: string;
  attendees: DiaryAttendee[];
  /** The customer, where the event is against one. */
  company: string | null;
  /** True where the person reading it is waiting to answer. */
  needsMyAnswer: boolean;
  mine: boolean;
};

export type DiaryContext = {
  meId: string;
  invites: DiaryInvite[];
  people: Map<string, DiaryPerson>;
  companies: Map<string, string>;
};

function nameOf(people: Map<string, DiaryPerson>, id: string | null): string | null {
  if (!id) return null;
  const p = people.get(id);
  return p?.full_name || p?.email || null;
}

/**
 * Everybody on one event, invites first.
 *
 * The organiser is included even when nobody invited them, because they
 * are on it by definition and a meeting listing two attendees for a
 * three person meeting is a meeting somebody turns up to alone.
 */
export function attendeesOf(
  event: CalendarEvent,
  ctx: Pick<DiaryContext, 'invites' | 'people'>,
): DiaryAttendee[] {
  const out: DiaryAttendee[] = [];
  const seen = new Set<string>();

  if (event.created_by) {
    seen.add(event.created_by);
    out.push({
      key: event.created_by,
      name: nameOf(ctx.people, event.created_by) ?? 'Whoever booked it',
      email: ctx.people.get(event.created_by)?.email ?? null,
      userId: event.created_by,
      status: 'accepted',
      inviteId: null,
      awaited: false,
      organiser: true,
    });
  }

  for (const i of ctx.invites) {
    if (i.event_id !== event.id) continue;
    if (seen.has(i.user_id)) continue;
    seen.add(i.user_id);
    out.push({
      key: i.user_id,
      name: nameOf(ctx.people, i.user_id) ?? 'Somebody',
      email: ctx.people.get(i.user_id)?.email ?? null,
      userId: i.user_id,
      status: i.status,
      inviteId: i.id,
      awaited: i.awaiting === i.user_id && (i.status === 'pending' || i.status === 'proposed'),
      organiser: false,
    });
  }

  /* The JSONB list last, and only for anybody not already accounted
     for. These are the rows booked before invitations existed, plus
     anybody outside the business who has an email and no account. */
  const listed = (Array.isArray(event.attendees) ? event.attendees : []) as CalendarEventAttendee[];
  for (const [index, a] of listed.entries()) {
    if (a.user_id && seen.has(a.user_id)) continue;
    if (a.user_id) seen.add(a.user_id);
    out.push({
      key: a.user_id ?? `listed-${index}-${a.email ?? a.name}`,
      name: a.name || a.email || 'Somebody',
      email: a.email ?? null,
      userId: a.user_id ?? null,
      status: null,
      inviteId: null,
      awaited: false,
      organiser: false,
    });
  }

  return out;
}

/** One event, read into everything a list or a card needs. */
export function toEntry(event: CalendarEvent, ctx: DiaryContext): DiaryEntry {
  const attendees = attendeesOf(event, ctx);
  const start = new Date(event.start_at);
  return {
    event,
    kind: eventKind(event),
    start,
    end: event.end_at ? new Date(event.end_at) : null,
    dayKey: dayKey(start),
    attendees,
    company: event.contact_id ? ctx.companies.get(event.contact_id) ?? null : null,
    needsMyAnswer: attendees.some((a) => a.userId === ctx.meId && a.awaited),
    mine: event.created_by === ctx.meId
      || attendees.some((a) => a.userId === ctx.meId),
  };
}

export function toEntries(events: CalendarEvent[], ctx: DiaryContext): DiaryEntry[] {
  return events
    .map((e) => toEntry(e, ctx))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ---------- the Work tab's list ---------- */

export type DiaryFilter = {
  /** Which kinds to keep. Empty means all of them. */
  kinds?: EventKind[];
  /** Only what this person is on. */
  onlyMine?: boolean;
  /** Only what is still to come. */
  fromToday?: boolean;
  /** Title, company or attendee name. */
  search?: string;
};

export function filterDiary(entries: DiaryEntry[], f: DiaryFilter): DiaryEntry[] {
  const today = startOfDay(new Date()).getTime();
  const q = (f.search ?? '').trim().toLowerCase();

  return entries.filter((e) => {
    if (!isDiaryKind(e.kind)) return false;
    if (f.kinds && f.kinds.length && !f.kinds.includes(e.kind)) return false;
    if (f.onlyMine && !e.mine) return false;
    if (f.fromToday && startOfDay(e.start).getTime() < today) return false;
    if (q) {
      const hay = [
        e.event.title,
        e.event.description ?? '',
        e.company ?? '',
        ...e.attendees.map((a) => a.name),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The same list, in the day headings a diary is read under. */
export function groupByDay(entries: DiaryEntry[]): { key: string; date: Date; entries: DiaryEntry[] }[] {
  const days = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const list = days.get(e.dayKey);
    if (list) list.push(e);
    else days.set(e.dayKey, [e]);
  }
  return [...days.entries()]
    .map(([key, list]) => ({ key, date: startOfDay(list[0].start), entries: list }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * The numbers above the list, counted off the rows the list draws.
 *
 * `isDiaryKind` first, and that is not a detail. Without it a reminder
 * counted towards "this week" and then did not appear in the list
 * underneath, so the strip said four and four rows were not there. A
 * figure that sits above a list has to be a count of that list.
 */
export function diaryCounts(entries: DiaryEntry[], meId: string) {
  const today = startOfDay(new Date()).getTime();
  const week = today + 7 * 86_400_000;
  const listed = entries.filter((e) => isDiaryKind(e.kind));
  const ahead = listed.filter((e) => startOfDay(e.start).getTime() >= today);

  return {
    total: listed.length,
    ahead: ahead.length,
    today: listed.filter((e) => startOfDay(e.start).getTime() === today).length,
    thisWeek: ahead.filter((e) => startOfDay(e.start).getTime() < week).length,
    calls: ahead.filter((e) => e.kind === 'call').length,
    meetings: ahead.filter((e) => e.kind === 'meeting' || e.kind === 'visit').length,
    waitingOnMe: listed.filter((e) => e.needsMyAnswer).length,
    mine: ahead.filter((e) => e.event.created_by === meId || e.mine).length,
  };
}
