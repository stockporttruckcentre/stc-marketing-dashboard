/* =============================================================
   Reading a diary entry off the wire.

   Shared by the create and the save routes rather than exported from
   one of them, because Next treats every export from a route file as a
   route field and a helper living there fails the build.

   Everything is coerced rather than trusted. What comes back is a row
   the table will accept and a list of people to ask, kept apart because
   they are two writes: the event, then the invitations.

   ---- The two attendee lists are not the same list ----

   `attendees` on the row is who is on it, as names, and it is what the
   existing calendar and the CRM's schedule button have always written.
   `invite` is the subset of them with an account here, who therefore
   get a real invitation they can accept or decline.

   Somebody typed in as a name with no account stays in the JSONB list
   and gets no invitation, because there is nothing to send one to. That
   is not a gap: a customer's transport manager belongs on the meeting
   and does not belong in this application.
   ============================================================= */
import type { CalendarEventAttendee, CalendarVisibility } from '@/lib/types';

const VISIBILITIES: CalendarVisibility[] = ['private', 'team', 'specific'];

/** Six colours, and nothing else gets written into the column. */
export const EVENT_COLOURS = [
  '#CF2417', '#5B8DEF', '#2ECC71', '#F5A623', '#A065FF', '#06B6D4',
] as const;

export type EventRow = {
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  color: string;
  contact_id: string | null;
  attendees: CalendarEventAttendee[];
  visibility: CalendarVisibility;
  visible_to: string[];
};

function text(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function uuid(v: unknown): string | null {
  const s = text(v, 40);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/** An ISO instant, or null. Never an invalid date reaching the column. */
function instant(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readAttendee(raw: unknown): CalendarEventAttendee | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const name = text(a.name, 120);
  const email = text(a.email, 160);
  if (!name && !email) return null;
  const id = uuid(a.user_id);
  return {
    ...(id ? { user_id: id } : {}),
    name: name || email,
    ...(email ? { email } : {}),
  };
}

export function readEventBody(
  body: unknown,
  /* Who is doing this. Needed only so they are not invited to their own
     meeting: see the bottom of this function. */
  actorId: string,
): { row: EventRow; invite: string[] } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Nothing arrived to save.' };
  const b = body as Record<string, unknown>;

  const title = text(b.title, 200);
  if (!title) return { error: 'Give it a title, so it reads as something in a list.' };

  const startAt = instant(b.start_at);
  if (!startAt) return { error: 'Say when it is.' };

  const allDay = b.all_day === true;
  let endAt = allDay ? null : instant(b.end_at);

  /* An entry that finishes before it starts lays out as a negative
     block and reads as a fault in the calendar rather than a typo in
     the form. Half an hour is what the command bar books when nobody
     says, so it is what this falls back to as well. */
  if (endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    endAt = new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString();
  }

  const attendees = Array.isArray(b.attendees)
    ? b.attendees.map(readAttendee).filter((a): a is CalendarEventAttendee => a !== null).slice(0, 50)
    : [];

  const visibility = VISIBILITIES.includes(b.visibility as CalendarVisibility)
    ? (b.visibility as CalendarVisibility)
    : 'private';

  const visibleTo = Array.isArray(b.visible_to)
    ? (b.visible_to.map(uuid).filter(Boolean) as string[]).slice(0, 50)
    : [];

  const colour = text(b.color, 9).toUpperCase();

  const row: EventRow = {
    title,
    description: text(b.description, 2000) || null,
    start_at: startAt,
    end_at: endAt,
    all_day: allDay,
    color: (EVENT_COLOURS as readonly string[]).includes(colour) ? colour : EVENT_COLOURS[0],
    contact_id: uuid(b.contact_id),
    attendees,
    visibility,
    /* Named people only mean anything on a specific event. Left on a
       private one they would be a list nothing reads, which is the sort
       of stale data somebody later mistakes for a permission. */
    visible_to: visibility === 'specific' ? visibleTo : [],
  };

  /* Who actually gets asked.
     
     Deduplicated, because the same person picked twice is one
     invitation and the UNIQUE constraint on `calendar_invites` would
     refuse the second anyway.

     And never the organiser. The compose form puts whoever is booking
     it on the attendee list, which is right: they are on the meeting.
     Sending them an invitation to it is not. `command_meeting_invite`
     sets `awaiting` to the person asked, so booking something for
     yourself put a meeting into your own "waiting on you" count, with a
     notification telling you that you had invited yourself. */
  const invite = [...new Set(
    attendees.map((a) => a.user_id).filter((id): id is string => Boolean(id)),
  )].filter((id) => id !== actorId);

  return { row, invite };
}
