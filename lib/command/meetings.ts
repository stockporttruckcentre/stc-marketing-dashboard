/* =============================================================
   Naming a meeting the way people name meetings.

     cancel Friday's site visit
     move my site visit on Friday to 2pm
     the 10am meeting with Dawson tomorrow
     invite Dave to the site visit on Friday

   NOBODY SAYS A MEETING'S TITLE.

   Every other record in this application has a name that gets typed:
   STC143580, Dawson Group, the Fleet Prospects list. A meeting does not.
   It is referred to by when it is, what it is about, and who is in it,
   and the reference is built out of all three at once. "Friday's site
   visit" is a day and a description; "the 10am meeting with Dawson
   tomorrow" is a day, a time and a person.

   So this reads the parts and composes them, rather than matching
   sentences. A day narrows `start_at` to that day, a time narrows it to
   that hour, and every remaining word narrows the title or the
   description. Three parts, in any order, any of them absent.

   SEVERAL MATCHES ASK. NONE SAYS NONE. NEITHER PICKS THE FIRST.

   Nothing here decides that. The reference is a condition and the step
   says `expect: 'one'`, and the resolver this shares with every other
   named record already refuses to choose between two answers. That is
   the point of building a condition rather than a lookup: a meeting
   reference is ambiguous in exactly the way a customer name is, and it
   is answered by the same machinery.

   MOVING ONE IS AN OPERATION, NOT A COLUMN WRITE.

   A meeting has a start and an end, and writing the start alone leaves
   a meeting that finishes before it begins. `command_reschedule_meeting`
   moves both and keeps the length, so "move it to 2pm" means what
   somebody dragging the block across the calendar means.
   ============================================================= */
import type { Cond, Expr, Invoke, Mutate, Step } from './ir/types';
import { capability, entity as entityDef } from './ir/registry';
import { ENTITIES } from './schema';
import { readDate } from './mutate';
import { DELETE_WORDS } from './lifecycle';
import {
  EMPTY_CONTEXT, readContextReference, resolveContext, type CommandContext,
} from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type MeetingPlan = {
  step: Step;
  summary: string;
  requires: string;
  confidence: number;
};

const ENTITY = 'meetings';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Nouns that say "a meeting" and nothing else.
 *
 * These come out of the description, because every meeting is one and
 * matching a title on the word "meeting" narrows nothing. "Visit",
 * "call" and "viewing" stay in: they are what the meeting is, and they
 * are usually the first word of its title.
 */
const GENERIC = ['meeting', 'meetings', 'appointment', 'appointments', 'diary',
                 'calendar', 'event', 'events', 'booking', 'bookings'];

/** Words that are grammar rather than description. */
const FILLER = new Set([
  'a', 'an', 'the', 'my', 'our', 'his', 'her', 'their', 'your', 'this', 'that',
  'on', 'in', 'at', 'for', 'of', 'to', 'from', 'with', 'and', 'is', 'was',
  'please', 'me', 'us', 'it', 'there', 'up', 'off', 'about', 'we', 'i',
  ...GENERIC,
]);

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9:.'’ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/* -------------------------------------------------------------
   The parts
   ------------------------------------------------------------- */

export type DayRead = { from: Date; to: Date; label: string; phrase: string };

/**
 * The day a sentence points at.
 *
 * A bare weekday means the next one, TODAY INCLUDED. "Cancel Friday's
 * site visit" said on the Friday is about today's, and pushing it a week
 * out would cancel the wrong meeting or none at all. "Next Friday" is
 * the one after.
 */
export function readDay(raw: string, now = new Date()): DayRead | null {
  /* The possessive is how people attach a day to a meeting, and it is
     the form a plain word match walks straight past. */
  const t = ` ${raw.toLowerCase().replace(/[’']s\b/g, ' ').replace(/[^a-z0-9/\-. ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

  const span = (start: Date, label: string, phrase: string): DayRead => {
    const from = startOfDay(start);
    const to = new Date(from.getTime());
    to.setDate(to.getDate() + 1);
    return { from, to, label, phrase };
  };

  const shifted = (days: number) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() + days);
    return d;
  };

  if (/ today | tonight /.test(t)) return span(shifted(0), 'today', 'today');
  if (/ tomorrow /.test(t)) return span(shifted(1), 'tomorrow', 'tomorrow');
  if (/ yesterday /.test(t)) return span(shifted(-1), 'yesterday', 'yesterday');

  const weekday = t.match(new RegExp(` (this|next|coming|last|on)? ?(${DAYS.join('|')}) `));
  if (weekday) {
    const target = DAYS.indexOf(weekday[2]);
    const today = startOfDay(now);
    let delta = (target - today.getDay() + 7) % 7;
    if (weekday[1] === 'next' && delta < 7) delta += 7;
    if (weekday[1] === 'last') delta -= 7;
    const at = shifted(delta);
    const name = weekday[2].charAt(0).toUpperCase() + weekday[2].slice(1);
    return span(at, weekday[1] === 'next' ? `next ${name}` : name, weekday[0].trim());
  }

  /* An explicit date, through the reader every other date in this
     application goes through. UK order, because this is a UK yard. */
  const explicit = readDate(raw, now);
  if (explicit) {
    const [y, m, d] = explicit.value.split('-').map(Number);
    return span(new Date(y, m - 1, d), explicit.value, explicit.raw);
  }
  return null;
}

export type TimeRead = { hour: number; minute: number; label: string; phrase: string };

/** "10am", "2 pm", "14:30", "at half past nine" is not read and says so. */
export function readTime(raw: string): TimeRead | null {
  const t = ` ${raw.toLowerCase().replace(/[^a-z0-9: .]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

  const m = t.match(/ (?:at )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm)? /);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = m[3];
  if (hour > 23 || minute > 59) return null;

  /* A bare hour with no am or pm. Nobody books a site visit at three in
     the morning, so a working day is assumed and said out loud in the
     label rather than guessed silently. */
  if (!meridiem && hour < 8) hour += 12;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, label, phrase: m[0].trim() };
}

/* -------------------------------------------------------------
   The reference
   ------------------------------------------------------------- */

export type MeetingReference = {
  where: Cond;
  label: string;
  /** The day it landed on, when the sentence gave one. */
  day: DayRead | null;
  time: TimeRead | null;
  /** What the words said the meeting is about. */
  terms: string[];
};

function textCond(term: string): Cond {
  return {
    kind: 'or',
    of: [
      {
        kind: 'cmp', op: 'contains',
        left: { kind: 'field', of: { entity: ENTITY, field: 'title' } },
        right: { kind: 'literal', value: term },
      },
      {
        kind: 'cmp', op: 'contains',
        left: { kind: 'field', of: { entity: ENTITY, field: 'description' } },
        right: { kind: 'literal', value: term },
      },
    ],
  };
}

/**
 * Which meeting a sentence means, out of its parts.
 *
 * `verbs` are the words that made this an instruction. They come out
 * before the description is read, or "cancel" ends up matching the title
 * of every meeting with the word in it.
 */
export function readMeetingReference(
  raw: string,
  opts: { verbs?: string[]; now?: Date; context?: CommandContext } = {},
): MeetingReference | null {
  const now = opts.now ?? new Date();

  /* THE ONE IN FRONT OF YOU.

     "Cancel this meeting" and "invite Dave to this meeting" name a
     meeting exactly, and they name it with a word rather than a
     description. The screen sends what it has open, and the reference
     is the record itself rather than anything read out of the words. */
  const pointed = readContextReference(raw);
  const fromScreen = pointed
    ? resolveContext(pointed, opts.context ?? EMPTY_CONTEXT, ENTITY)
    : null;
  if (fromScreen) {
    return {
      where: fromScreen.match,
      label: fromScreen.label,
      day: null,
      time: readTime(raw),
      terms: [],
    };
  }

  let rest = ` ${raw} `;
  for (const verb of opts.verbs ?? []) {
    rest = rest.replace(new RegExp(`\\b${escape(verb)}\\b`, 'ig'), ' ');
  }

  const day = readDay(rest, now);
  if (day) rest = rest.replace(new RegExp(escape(day.phrase), 'i'), ' ');

  const time = readTime(rest);
  if (time) rest = rest.replace(new RegExp(escape(time.phrase), 'i'), ' ');

  /* Whatever is left, minus the grammar. Each surviving run of words is
     one thing the meeting has to be about, so "site visit with Dawson"
     asks for both rather than for the sentence as one string: a title
     reading "Site visit, Dawson Group" matches, and it should. */
  const terms: string[] = [];
  let run: string[] = [];
  for (const word of soften(rest).trim().split(/\s+/).filter(Boolean)) {
    const plain = word.replace(/[’']s$/, '');
    /* What is left of a possessive whose day has already been taken out.
       "Friday's site visit" becomes "'s site visit", and an empty word
       kept in the run made the term " site visit", which matches
       nothing because no title has two spaces in it. */
    if (!plain || FILLER.has(plain)) {
      if (run.length) { terms.push(run.join(' ')); run = []; }
      continue;
    }
    run.push(plain);
  }
  if (run.length) terms.push(run.join(' '));

  const conds: Cond[] = [];
  if (day) {
    /* A time narrows the day to the hour it names. Without a day there
       is nothing to narrow: PostgREST cannot ask for an hour of any
       date, so a time on its own is read and then not used, and the
       label does not claim it was. */
    const from = new Date(day.from.getTime());
    const to = new Date(day.to.getTime());
    if (time) {
      from.setHours(time.hour, time.minute, 0, 0);
      to.setTime(from.getTime() + 60 * 60 * 1000);
    }
    conds.push({
      kind: 'cmp', op: 'gte',
      left: { kind: 'field', of: { entity: ENTITY, field: 'start_at' } },
      right: { kind: 'literal', value: from.toISOString() },
    });
    conds.push({
      kind: 'cmp', op: 'lt',
      left: { kind: 'field', of: { entity: ENTITY, field: 'start_at' } },
      right: { kind: 'literal', value: to.toISOString() },
    });
  }
  for (const term of terms) conds.push(textCond(term));

  if (!conds.length) return null;

  const said = [
    terms.length ? `the ${terms.join(' ')}` : 'the meeting',
    day ? `on ${day.label}` : '',
    day && time ? `at ${time.label}` : '',
  ].filter(Boolean).join(' ');

  return {
    where: conds.length === 1 ? conds[0] : { kind: 'and', of: conds },
    label: said,
    day,
    time,
    terms,
  };
}

/* -------------------------------------------------------------
   The sentences
   ------------------------------------------------------------- */

/** Words that mean a meeting is being moved rather than removed. */
const MOVE_WORDS = ['move', 'reschedule', 'rearrange', 'shift', 'push', 'pull',
                    'put back', 'bring forward', 'change', 'switch'];

/** Words that ask somebody along. */
const INVITE_WORDS = ['invite', 'ask', 'add'];

/**
 * A word that says the sentence is about a meeting at all.
 *
 * The entity's own declared nouns, so "visit" and "call" mean here
 * exactly what they mean when somebody asks a question about the diary.
 */
function namesAMeeting(t: string): boolean {
  const nouns = ENTITIES.find((e) => e.id === ENTITY)?.nouns ?? [];
  return nouns.some((n) => t.includes(` ${n} `) || t.includes(` ${n}s `));
}

function selectOf(where: Cond) {
  return {
    op: 'select' as const,
    from: { entity: ENTITY },
    where,
    produces: { kind: 'rows' as const, entity: ENTITY },
  };
}

/**
 * Cancelling a meeting.
 *
 * A deletion, through the same lifecycle permission every other
 * deletion derives: what it takes to delete a meeting, never what it
 * takes to write its title.
 */
function readCancel(
  raw: string, caps: CrmCapabilities | undefined, now: Date, context: CommandContext,
): MeetingPlan | null {
  const t = soften(raw);
  const verb = DELETE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const def = entityDef(ENTITY);
  const requires = def?.deleteRequires;
  if (!requires) return null;
  if (caps && !caps.has(requires)) return null;

  const reference = readMeetingReference(raw, { verbs: [verb], now, context });
  if (!reference) return null;

  const step: Mutate = {
    op: 'delete',
    id: 'm1',
    expect: 'one',
    target: { entity: ENTITY },
    match: selectOf(reference.where),
    produces: { kind: 'rows', entity: ENTITY },
  };

  return {
    step,
    summary: `Cancel ${reference.label}`,
    requires,
    confidence: 13,
  };
}

/**
 * Moving a meeting to another time.
 *
 * The sentence splits at the last "to": everything before it says which
 * meeting, everything after says when. Read the other way round, "move
 * my site visit on Friday to 2pm" looks for a meeting about two o'clock.
 */
function readReschedule(
  raw: string, caps: CrmCapabilities | undefined, now: Date, context: CommandContext,
): MeetingPlan | null {
  const t = soften(raw);
  const verb = MOVE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const cap = capability('meeting.reschedule');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* WHERE THE SENTENCE SPLITS, IF IT SPLITS AT ALL.

     "Move my 3pm meeting tomorrow to 4:30" says which meeting and then
     where it goes. "Move Friday's site visit" says only which meeting,
     and that is a whole instruction with the destination left off
     rather than a sentence nobody can read. */
  const split = raw.toLowerCase().lastIndexOf(' to ');
  const subject = split < 0 ? raw : raw.slice(0, split);
  const destination = split < 0 ? '' : raw.slice(split + 4);

  /* WHICH MEETING IS RECOGNITION. WHERE IT GOES IS AN INPUT.

     A sentence with a move verb and no meeting in it is not this
     operation and comes back null. A sentence with a meeting and no
     destination is this operation, missing one value, and the registry
     asks for it: inventing nine in the morning would move a meeting
     somebody has to be at. */
  const reference = readMeetingReference(subject, { verbs: [verb], now, context });
  if (!reference) return null;

  const time = readTime(destination);

  /* The new day, if the destination named one, and otherwise the day
     the meeting is already on.

     "Move this meeting to 4:30" names a time and no day at all, and the
     day it is already on is not something planning knows: the record
     has not been read yet. So the clock time goes down on its own and
     the operation moves it within its own day, which is what somebody
     dragging the block up the column means. */
  const day = readDay(destination, now) ?? reference.day;

  const at = day && time ? new Date(day.from.getTime()) : null;
  if (at && time) at.setHours(time.hour, time.minute, 0, 0);

  const step: Invoke = {
    op: 'invoke',
    id: 'm1',
    capability: 'meeting.reschedule',
    expect: 'one',
    subject: selectOf(reference.where),
    /* A moment, or a clock time on its own, or neither. The capability
       declares the two as alternatives and asks when neither arrived. */
    args: at
      ? { start: { kind: 'literal', value: at.toISOString() } }
      : time
        ? { time: { kind: 'literal', value: time.label } }
        : {},
    produces: { kind: 'record', entity: ENTITY },
  };

  return {
    step,
    summary: time
      ? (day
          ? `Move ${reference.label} to ${day.label} at ${time.label}`
          : `Move ${reference.label} to ${time.label}`)
      : `Move ${reference.label}`,
    requires: cap.requires,
    confidence: 13,
  };
}

/**
 * Asking somebody to a meeting.
 *
 * The person is named in the words and resolved against `profiles` by
 * the same reference machinery a customer name goes through, so two
 * Daves ask rather than inviting one of them.
 */
function readInvite(
  raw: string, caps: CrmCapabilities | undefined, now: Date, context: CommandContext,
): MeetingPlan | null {
  const t = soften(raw);
  const verb = INVITE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const cap = capability('meeting.invite');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* "invite Dave to the site visit on Friday". Who comes between the
     verb and the meeting; which meeting is everything after "to". */
  const said = raw.match(new RegExp(`\\b${escape(verb)}\\b\\s+(.{2,60}?)\\s+\\bto\\b\\s+(.+)$`, 'i'));
  if (!said) return null;

  const who = said[1].trim().replace(/[.,;]+$/, '');
  const reference = readMeetingReference(said[2], { now, context });
  if (!reference) return null;
  if (!namesAMeeting(soften(said[2]))) return null;

  const step: Invoke = {
    op: 'invoke',
    id: 'm1',
    capability: 'meeting.invite',
    expect: 'one',
    subject: selectOf(reference.where),
    args: {
      who: {
        kind: 'reference',
        entity: 'people',
        where: {
          kind: 'cmp', op: 'contains',
          left: { kind: 'field', of: { entity: 'people', field: 'full_name' } },
          right: { kind: 'literal', value: who },
        },
        select: 'id',
        onAmbiguity: 'ask',
      },
    },
    produces: { kind: 'record', entity: ENTITY },
  };

  return {
    step,
    summary: `Invite ${who} to ${reference.label}`,
    requires: cap.requires,
    confidence: 13,
  };
}

/** Words that book something into a diary. */
const BOOK_WORDS = ['book', 'schedule', 'arrange', 'diarise', 'set up', 'put in',
                    'create', 'add', 'new', 'make'];

/** What a meeting is called when the sentence says what kind it is. */
const KINDS: { words: string[]; title: string }[] = [
  { words: ['site visit', 'visit', 'yard visit'], title: 'Site visit' },
  { words: ['call', 'phone call', 'ring', 'callback', 'call back'], title: 'Call' },
  { words: ['viewing', 'demo', 'demonstration'], title: 'Viewing' },
  { words: ['review', 'catch up', 'catchup'], title: 'Review' },
  { words: ['meeting', 'appointment'], title: 'Meeting' },
];

/**
 * Booking one.
 *
 * "Book a call with Dawson on Friday at 10" is a day, a time, what kind
 * of meeting it is and who it is with, which between them are the whole
 * of a calendar entry. The kind becomes the title and the person becomes
 * the link to the customer record, which is what the calendar screen
 * does when somebody books from a customer.
 *
 * A DAY AND A TIME ARE STILL BOTH REQUIRED, AND THIS IS NOT WHERE THAT
 * IS ENFORCED.
 *
 * "Schedule a call with Dawson next Friday" names the operation, the
 * kind, the customer and the day. It is missing a clock time, and a
 * meeting at a time nobody said is a meeting somebody misses, so it
 * must not run. It used to return null for that, which threw the whole
 * sentence away before anything could ask: the bar said it had not
 * understood a sentence it had understood completely.
 *
 * Returning null means THIS READER DOES NOT RECOGNISE THE OPERATION.
 * A recognised operation with a value missing is a plan without that
 * value, and `meeting.create` declares which of its inputs are
 * required. The registry owns that, not this file.
 */
function readBook(
  raw: string, caps: CrmCapabilities | undefined, now: Date, context: CommandContext,
): MeetingPlan | null {
  const t = soften(raw);
  const verb = BOOK_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const cap = capability('meeting.create');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* The kind is what makes this a meeting rather than a booking of
     something else, so it IS recognition and stays a null. */
  const kind = KINDS.find((k) => k.words.some((w) => t.includes(` ${w} `)));
  if (!kind) return null;

  const day = readDay(raw, now);
  const time = readTime(day ? raw.replace(new RegExp(escape(day.phrase), 'i'), ' ') : raw);

  /* Who it is with. The words after "with" or "for", which is where a
     customer sits in every one of these sentences. */
  const withWhom = raw.match(/\b(?:with|for|to see|and)\s+([A-Za-z0-9&'. -]{2,60}?)\s*(?:\bon\b|\bat\b|\bnext\b|\btomorrow\b|\btoday\b|[.,;]|$)/i)?.[1]
    ?.trim().replace(/[.,;]+$/, '');

  const title = withWhom ? `${kind.title} with ${withWhom}` : kind.title;

  const args: Record<string, Expr> = {
    title: { kind: 'literal', value: title },
  };
  /* WHAT WAS SAID, IN THE WORDS IT WAS SAID IN, AND THE MOMENT ONLY
     ONCE BOTH HALVES ARE THERE.

     The day and the time go down as the person's own words so the
     completion contract can ask for whichever is missing in the same
     terms. The timestamp the database takes is composed here and only
     here, and only when there is something to compose it from. */
  if (day) args.day = { kind: 'literal', value: day.label };
  if (time) args.time = { kind: 'literal', value: time.label };
  if (day && time) {
    const at = new Date(day.from.getTime());
    at.setHours(time.hour, time.minute, 0, 0);
    args.start = { kind: 'literal', value: at.toISOString() };
  }
  /* The customer, when the CRM holds one by that name. Optional, so a
     meeting with somebody who is not a customer is still a meeting. */
  if (withWhom) {
    args.contact = {
      kind: 'reference',
      entity: 'contacts',
      where: {
        kind: 'cmp', op: 'contains',
        left: { kind: 'field', of: { entity: 'contacts', field: 'company_name' } },
        right: { kind: 'literal', value: withWhom },
      },
      select: 'id',
      onAmbiguity: 'ask',
    };
  }

  return {
    step: {
      op: 'invoke',
      id: 'm1',
      capability: 'meeting.create',
      args,
      produces: { kind: 'record', entity: ENTITY },
    },
    summary: `Book ${title}${day ? ` for ${day.label}` : ''}${time ? ` at ${time.label}` : ''}`,
    requires: cap.requires,
    confidence: 13,
  };
}

/** What somebody can say to an invitation. */
const ANSWERS: { action: string; words: string[]; label: string }[] = [
  { action: 'accept', words: ['accept', 'confirm', 'agree to', 'say yes to', 'take'],
    label: 'Accept' },
  { action: 'decline', words: ['decline', 'reject', 'refuse', 'say no to', 'turn down'],
    label: 'Decline' },
  { action: 'withdraw', words: ['withdraw', 'take back', 'uninvite', 'un invite'],
    label: 'Withdraw' },
  { action: 'propose', words: ['propose', 'suggest', 'counter', 'offer', 'ask for'],
    label: 'Suggest another time for' },
];

/**
 * Answering one.
 *
 * The invitation is named by the meeting it is on, because nobody refers
 * to an invitation by anything else. Which invitation on that meeting is
 * yours is a question the database answers: the operation resolves it
 * from the meeting and the caller.
 */
function readAnswer(
  raw: string, caps: CrmCapabilities | undefined, now: Date, context: CommandContext,
): MeetingPlan | null {
  const t = soften(raw);
  const answer = ANSWERS
    .map((a) => ({ a, w: a.words.filter((w) => t.includes(` ${w} `)).sort((x, y) => y.length - x.length)[0] }))
    .filter((x) => !!x.w)
    .sort((x, y) => (y.w as string).length - (x.w as string).length)[0];
  if (!answer?.w) return null;

  const cap = capability('meeting.answer');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* A proposal needs the time being suggested, and it is the time after
     the verb rather than the meeting's own. */
  const proposing = answer.a.action === 'propose';
  const split = proposing ? raw.toLowerCase().lastIndexOf(' for ') : -1;
  const subject = split > 0 ? raw.slice(split + 5) : raw;
  const offer = proposing ? raw.slice(0, split > 0 ? split : undefined) : '';

  const reference = readMeetingReference(subject, { verbs: [answer.w, 'invitation', 'invite'], now, context });
  if (!reference) return null;

  const args: Record<string, Expr> = {
    action: { kind: 'literal', value: answer.a.action },
  };

  /* THE TIME BEING SUGGESTED, WHERE THE SENTENCE SUGGESTED ONE.

     "Propose another time for Friday's meeting" is the whole request
     with the time left off, and it used to be thrown away for that. The
     capability declares the start required only when the answer is a
     proposal, so this hands over what it has and the question is asked
     where every other question is asked. */
  if (proposing) {
    const time = readTime(offer);
    const day = readDay(offer, now);
    if (time && day) {
      const at = new Date(day.from.getTime());
      at.setHours(time.hour, time.minute, 0, 0);
      args.start = { kind: 'literal', value: at.toISOString() };
    }
  }

  return {
    step: {
      op: 'invoke',
      id: 'm1',
      capability: 'meeting.answer',
      expect: 'one',
      subject: selectOf(reference.where),
      args,
      produces: { kind: 'record', entity: ENTITY },
    },
    summary: `${answer.a.label} the invitation to ${reference.label}`,
    requires: cap.requires,
    confidence: 13,
  };
}

/**
 * Anything a sentence asks of a meeting.
 *
 * Cancelling first, because "cancel" is not a word any of the others
 * use, and moving before inviting because "add Dave to Friday's visit"
 * and "move Friday's visit to 2pm" both split on "to".
 */
export function parseMeeting(
  raw: string,
  caps?: CrmCapabilities,
  context: CommandContext = EMPTY_CONTEXT,
  now: Date = new Date(),
): MeetingPlan | null {
  const text = raw.trim();
  if (text.length < 5) return null;
  if (text.endsWith('?')) return null;
  if (/^\s*(how|what|which|who|when|where|why|is there|are there|do we|did we)\b/i.test(text)) return null;

  /* A sentence that never says it is about a meeting is not about one.
     Without this, "move these to Hyde" reads as a reschedule with no
     time in it, and "cancel the Dawson proposal" cancels a meeting. */
  if (!namesAMeeting(soften(text))) return null;

  return readCancel(text, caps, now, context)
    ?? readAnswer(text, caps, now, context)
    ?? readBook(text, caps, now, context)
    ?? readReschedule(text, caps, now, context)
    ?? readInvite(text, caps, now, context);
}
