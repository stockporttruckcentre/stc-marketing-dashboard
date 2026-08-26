/* =============================================================
   What sort of thing is in the diary.

   `calendar_events` holds one row whatever it is: a call to chase a
   quote, a site visit, an inspection booking, a reminder to send
   something. There is no `kind` column and there deliberately is not
   one, because every existing row would need backfilling from the same
   words this reads, and a column that is derived and stored is a column
   that goes stale the first time somebody edits a title.

   So the kind is worked out from what is on the row, in one place, and
   the calendar and the Work tab both call it. Two screens deciding
   separately what counts as a call is two screens that will one day
   disagree about the same meeting.

   ---- The order matters ----

   The title is read first, because somebody who wrote "call Dawson
   about the quote" meant a call whether or not they linked the account.
   Only when the title says nothing does the shape of the row decide: a
   customer on it makes it a meeting, several people on it makes it a
   meeting, and anything else is an appointment in somebody's own diary.
   ============================================================= */
import type { Tone } from '@/components/kit/primitives';

export type EventKind = 'call' | 'meeting' | 'visit' | 'inspection' | 'reminder' | 'appointment';

export const EVENT_KINDS: EventKind[] = [
  'call', 'meeting', 'visit', 'inspection', 'reminder', 'appointment',
];

export const KIND_LABEL: Record<EventKind, string> = {
  call: 'Call',
  meeting: 'Meeting',
  visit: 'Site visit',
  inspection: 'Inspection',
  reminder: 'Reminder',
  appointment: 'Appointment',
};

/**
 * Short, for a filter chip.
 *
 * Six chips at their full names came to 612px of a bar that had 448px
 * for them at 1280, so the last two scrolled out of sight and the one
 * on the edge was cut through the middle of a word. These are the same
 * six words a person would say out loud anyway: nobody asks to see the
 * site visits when the column already says visits.
 */
export const KIND_CHIP: Record<EventKind, string> = {
  call: 'Calls',
  meeting: 'Meetings',
  visit: 'Visits',
  inspection: 'Checks',
  reminder: 'Reminders',
  appointment: 'Other',
};

/** Plural, for a count above a list. */
export const KIND_PLURAL: Record<EventKind, string> = {
  call: 'Calls',
  meeting: 'Meetings',
  visit: 'Site visits',
  inspection: 'Inspections',
  reminder: 'Reminders',
  appointment: 'Appointments',
};

/**
 * The tone each kind carries.
 *
 * Rule one of the kit: navy acts, red points. None of these is an
 * action, so none of them is red. A call is the one worth picking out
 * because a call not made is the commonest thing to let slip, and it
 * takes `accent` for that reason and no other.
 */
export const KIND_TONE: Record<EventKind, Tone> = {
  call: 'accent',
  meeting: 'info',
  visit: 'success',
  inspection: 'warning',
  reminder: 'neutral',
  appointment: 'neutral',
};

/* The words that decide it. Kept as sets of stems rather than whole
   phrases: a lookup table of titles goes stale the day somebody types
   "ring" instead of "call", and nobody writes titles the same way
   twice. */
const WORDS: { kind: EventKind; stems: string[] }[] = [
  /* "Chase" is a call rather than a reminder on purpose. Chasing a
     quote is picking the phone up; the reminder stems below are the
     ones about a date rather than about ringing somebody. */
  { kind: 'call', stems: ['call', 'phone', 'ring', 'dial', 'zoom', 'chase'] },
  { kind: 'visit', stems: ['visit', 'site', 'depot', 'drop in'] },
  { kind: 'inspection', stems: ['inspection', 'pmi', 'mot', 'service', 'loler', 'rbt', 'tacho'] },
  { kind: 'reminder', stems: ['reminder', 'remind', 'deadline', 'due'] },
  { kind: 'meeting', stems: ['meeting', 'meet', 'catch up', 'review', 'demo', 'pitch', 'handover'] },
];

export type KindInput = {
  title?: string | null;
  contact_id?: string | null;
  attendees?: unknown;
};

/** What this row is. See the header for why the title wins. */
export function eventKind(e: KindInput): EventKind {
  const title = (e.title ?? '').toLowerCase();

  if (title) {
    for (const { kind, stems } of WORDS) {
      /* On a word boundary, so "recall" is not a call and "services"
         still is an inspection. */
      if (stems.some((s) => new RegExp(`\\b${s}\\b`).test(title))) return kind;
    }
  }

  const attendees = Array.isArray(e.attendees) ? e.attendees : [];
  if (e.contact_id) return 'meeting';
  if (attendees.length > 1) return 'meeting';
  return 'appointment';
}

/**
 * Whether this is the sort of thing the Work tab's diary lists.
 *
 * Everything except a reminder, which is a note to self rather than
 * something in anybody's diary, and would fill a shared list with
 * things nobody else can act on.
 */
export function isDiaryKind(kind: EventKind): boolean {
  return kind !== 'reminder';
}
