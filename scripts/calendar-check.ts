/* =============================================================
   The calendar's arithmetic.

   The reported bug was "the day labels do not line up with their
   actual days". Two things could cause that and only one of them was
   true, so both are asserted here rather than one of them being fixed
   and hoped about.

     the layout   the names were their own `repeat(7, 1fr)` grid above
                  the days. A `1fr` track is `minmax(auto, 1fr)`, so a
                  cell holding a long meeting title widened its own
                  column and everything after it drifted. Fixed
                  structurally in `components/calendar/views.tsx`: one
                  grid holds the names and the days, and the tracks are
                  `minmax(0, 1fr)`.

     the grid     `monthGrid` could have been filling the cells in the
                  wrong order. It was not, and this file is what keeps
                  it that way: every month for twenty years, asserted
                  cell by cell.

   The month view labels its columns from `WEEKDAYS` and fills them from
   `monthGrid`, both out of `lib/calendar/grid.ts`. As long as cell `i`
   is really in column `i % 7` and that column is really `columnOf` of
   the date in it, the name over a date is the name of that date's day.
   That is the invariant below.

   Run with `npm run check:calendar`.
   ============================================================= */
import {
  WEEKDAYS, WEEKDAYS_LONG, addDays, columnOf, dayKey, daysFrom, durationLabel,
  endOfMonth, monthGrid, relativeDay, startOfDay, startOfMonth, startOfWeek, weekGrid,
} from '../lib/calendar/grid';
import { EVENT_KINDS, KIND_LABEL, KIND_PLURAL, KIND_TONE, eventKind } from '../lib/calendar/kind';
import {
  attendeesOf, diaryCounts, filterDiary, groupByDay, toEntries,
  type DiaryInvite, type DiaryPerson,
} from '../lib/calendar/diary';
import { readEventBody } from '../lib/calendar/wire';
import type { CalendarEvent } from '../lib/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(what: string, holds: boolean, detail = ''): void {
  if (holds) { pass++; return; }
  fail++;
  failures.push(`${what}${detail ? `  (${detail})` : ''}`);
}

/* =============================================================
   1. Every cell is under its own weekday name.

   Twenty years of months, every cell in every one of them. This is the
   assertion the reported bug is about: if it ever fails, a date is in a
   column whose header says a different day.
   ============================================================= */
{
  let cells = 0;
  let wrongColumn = 0;
  let wrongName = 0;

  for (let year = 2015; year <= 2035; year++) {
    for (let month = 0; month < 12; month++) {
      const grid = monthGrid(new Date(year, month, 1));

      for (let i = 0; i < grid.length; i++) {
        cells++;
        const d = grid[i];
        /* The date really sits in the column the grid puts it in. */
        if (columnOf(d) !== i % 7) wrongColumn++;
        /* And the name over that column is the name of that day. */
        const named = WEEKDAYS_LONG[i % 7];
        const real = d.toLocaleDateString('en-GB', { weekday: 'long' });
        if (named !== real) wrongName++;
      }
    }
  }

  ok(`every one of ${cells.toLocaleString('en-GB')} cells is in its own column`, wrongColumn === 0,
    `${wrongColumn} were not`);
  ok('every cell sits under the name of its own day', wrongName === 0, `${wrongName} did not`);
  ok('the short and long weekday names are in the same order',
    WEEKDAYS.every((short, i) => WEEKDAYS_LONG[i].startsWith(short)));
}

/* =============================================================
   2. The month grid holds the whole month, and nothing sideways.
   ============================================================= */
for (let year = 2024; year <= 2030; year++) {
  for (let month = 0; month < 12; month++) {
    const cursor = new Date(year, month, 1);
    const grid = monthGrid(cursor);
    const label = `${year}-${String(month + 1).padStart(2, '0')}`;

    ok(`${label}: a whole number of weeks`, grid.length % 7 === 0, `${grid.length} cells`);
    ok(`${label}: starts on a Monday`, columnOf(grid[0]) === 0);

    /* Every day of the month is in there exactly once. A month that
       loses a day, or shows the 14th twice, is the other shape this
       bug takes. */
    const wanted = endOfMonth(cursor).getDate();
    const inMonth = grid.filter((d) => d.getMonth() === month && d.getFullYear() === year);
    ok(`${label}: all ${wanted} days are there`, inMonth.length === wanted, `${inMonth.length} found`);
    ok(`${label}: no day twice`, new Set(inMonth.map(dayKey)).size === wanted);

    /* Consecutive, with no gap and no repeat across the boundaries. */
    let consecutive = true;
    for (let i = 1; i < grid.length; i++) {
      if (dayKey(addDays(grid[i - 1], 1)) !== dayKey(grid[i])) consecutive = false;
    }
    ok(`${label}: every cell is the day after the one before it`, consecutive);

    /* And never a whole trailing row of next month, which draws as an
       empty stripe and reads as a rendering fault. */
    const lastRow = grid.slice(-7);
    ok(`${label}: the last row is not entirely next month`,
      lastRow.some((d) => d.getMonth() === month));
  }
}

/* =============================================================
   3. British Summer Time.

   `toISOString()` is UTC, and from the last Sunday in March to the last
   Sunday in October the United Kingdom is an hour ahead of it. A
   calendar keyed on the ISO date puts anything before 1am into
   yesterday's box for seven months of the year. `dayKey` reads the
   local parts instead, and this is the assertion that says so.
   ============================================================= */
{
  /* Half past midnight on the 5th of June, which is 23:30 on the 4th
     in UTC. */
  const summerMorning = new Date(2026, 5, 5, 0, 30);
  ok('half past midnight in June is the 5th, not the 4th',
    dayKey(summerMorning) === '2026-06-05',
    `got ${dayKey(summerMorning)}, and the ISO string says ${summerMorning.toISOString().slice(0, 10)}`);

  /* The clocks go forward on 29 March 2026 and back on 25 October. */
  for (const [y, m, d] of [[2026, 2, 29], [2026, 9, 25], [2027, 2, 28], [2027, 9, 31]] as const) {
    const day = new Date(y, m, d, 12, 0);
    const grid = monthGrid(day);
    const found = grid.filter((c) => dayKey(c) === dayKey(day));
    ok(`the clock change on ${dayKey(day)} is in the grid exactly once`, found.length === 1,
      `${found.length} cells`);
    ok(`and in the right column on ${dayKey(day)}`,
      grid.indexOf(found[0]) % 7 === columnOf(day));
  }

  /* A week that contains a clock change is still seven days. */
  for (const [y, m, d] of [[2026, 2, 29], [2026, 9, 25]] as const) {
    const week = weekGrid(new Date(y, m, d));
    ok(`the week of ${y}-${m + 1}-${d} is seven days`, week.length === 7);
    ok(`and starts on a Monday`, columnOf(week[0]) === 0);
    ok(`and every one of them is a different day`,
      new Set(week.map(dayKey)).size === 7);
  }

  /* And a run of days across one does not skip or repeat. */
  const run = daysFrom(new Date(2026, 2, 26), 8);
  ok('eight days across the spring clock change are eight different days',
    new Set(run.map(dayKey)).size === 8);
  ok('and the last of them is the 2nd of April',
    dayKey(run[7]) === '2026-04-02', `got ${dayKey(run[7])}`);
}

/* =============================================================
   4. The week starts on a Monday, whichever day you ask from.
   ============================================================= */
for (let i = 0; i < 400; i++) {
  const d = addDays(new Date(2026, 0, 1), i);
  const monday = startOfWeek(d);
  ok(`the week of ${dayKey(d)} starts on a Monday`, columnOf(monday) === 0);
  ok(`and ${dayKey(d)} is inside it`,
    weekGrid(d).some((x) => dayKey(x) === dayKey(d)));
}

/* =============================================================
   5. What sort of thing is in the diary.

   The titles are the ones somebody actually types. A calendar that
   calls "Call Dawson about the quote" a meeting is a calendar whose
   call list is empty.
   ============================================================= */
for (const [title, want] of [
  ['Call Dawson about the trailer quote', 'call'],
  ['Ring Tom back', 'call'],
  ['Chase the Wilsons proposal', 'call'],
  ['Teams call with Gareth', 'call'],
  ['Site visit, Carrington depot', 'visit'],
  ['Visit Bay Freight', 'visit'],
  ['Drop in at the Trafford yard', 'visit'],
  ['PMI inspection, C123456', 'inspection'],
  ['MOT booked for KX21 ABC', 'inspection'],
  ['Tacho calibration', 'inspection'],
  ['Reminder: send the FleetSmart quote', 'reminder'],
  ['Contract deadline', 'reminder'],
  ['Meeting with Dawson Group', 'meeting'],
  ['Catch up with Dave', 'meeting'],
  ['Quarterly review', 'meeting'],
  ['Handover, STC145505', 'meeting'],
] as [string, string][]) {
  ok(`"${title}" is a ${want}`, eventKind({ title }) === want,
    `got ${eventKind({ title })}`);
}

/* A word inside a longer word is not that word. This is what the word
   boundary in the matcher is for, and it is the sort of thing that only
   shows up when somebody books a recall. */
ok('"Recall the Wilsons unit" is not a call', eventKind({ title: 'Recall the Wilsons unit' }) !== 'call');
ok('"Website review" is still a meeting', eventKind({ title: 'Website review' }) === 'meeting');

/* With nothing in the title, the shape of the row decides. */
ok('a customer on it with a plain title makes it a meeting',
  eventKind({ title: 'Dawson', contact_id: 'x' }) === 'meeting');
ok('several people on it makes it a meeting',
  eventKind({ title: 'Thursday', attendees: [{ name: 'A' }, { name: 'B' }] }) === 'meeting');
ok('one person and nothing else is an appointment',
  eventKind({ title: 'Dentist', attendees: [{ name: 'A' }] }) === 'appointment');
ok('nothing at all is an appointment', eventKind({}) === 'appointment');

/* Every kind has words for it, and none of them is red. Rule one of
   the kit: red points at the one thing that matters, and six coloured
   labels is six things shouting. */
for (const k of EVENT_KINDS) {
  ok(`${k} has a label`, Boolean(KIND_LABEL[k]) && Boolean(KIND_PLURAL[k]));
  ok(`${k} has a tone`, Boolean(KIND_TONE[k]));
}
ok('exactly one kind carries the accent',
  EVENT_KINDS.filter((k) => KIND_TONE[k] === 'accent').length === 1);

/* =============================================================
   6. Who is on a meeting.

   Three sources: whoever booked it, the invitations, and the JSONB list
   the old forms wrote. The last of those is why every existing row has
   to keep working.
   ============================================================= */
{
  const ORG = '00000000-0000-0000-0000-000000000001';
  const TOM = '00000000-0000-0000-0000-000000000002';
  const DAVE = '00000000-0000-0000-0000-000000000003';

  const people = new Map<string, DiaryPerson>([
    [ORG, { id: ORG, full_name: 'Alex', email: 'alex@example.test' }],
    [TOM, { id: TOM, full_name: 'Tom', email: 'tom@example.test' }],
    [DAVE, { id: DAVE, full_name: 'Dave', email: 'dave@example.test' }],
  ]);

  const event = {
    id: 'e1', title: 'Meeting with Dawson', description: null,
    start_at: new Date(2026, 5, 5, 10, 0).toISOString(),
    end_at: new Date(2026, 5, 5, 11, 0).toISOString(),
    all_day: false, color: '#CF2417', created_by: ORG, contact_id: 'c1',
    attendees: [
      { user_id: ORG, name: 'Alex' },
      { user_id: TOM, name: 'Tom' },
      { name: 'Transport manager', email: 'tm@dawson.test' },
    ],
    visibility: 'team' as const, visible_to: [],
    created_at: '', updated_at: '',
  } satisfies CalendarEvent;

  /* A row booked before invitations existed. Everybody on it is a name
     with no standing, which is the truth: nobody was ever asked. */
  const before = attendeesOf(event, { invites: [], people });
  ok('an old row lists everybody on it', before.length === 3, `${before.length}`);
  ok('the organiser is marked as such', before[0].organiser && before[0].userId === ORG);
  ok('nobody else on an old row has a standing',
    before.slice(1).every((a) => a.status === null));
  ok('and the outside person is still on it',
    before.some((a) => a.name === 'Transport manager' && a.userId === null));

  const invites: DiaryInvite[] = [
    {
      id: 'i1', event_id: 'e1', user_id: TOM, invited_by: ORG, status: 'accepted',
      proposed_start_at: null, proposed_end_at: null, awaiting: null, rounds: 1,
      note: null, responded_at: null,
    },
    {
      id: 'i2', event_id: 'e1', user_id: DAVE, invited_by: ORG, status: 'pending',
      proposed_start_at: null, proposed_end_at: null, awaiting: DAVE, rounds: 0,
      note: null, responded_at: null,
    },
  ];

  const after = attendeesOf(event, { invites, people });
  ok('an invitation replaces the name in the list rather than doubling it',
    after.filter((a) => a.userId === TOM).length === 1);
  ok('and carries the standing', after.find((a) => a.userId === TOM)?.status === 'accepted');
  ok('somebody invited who was never in the list is on it',
    after.some((a) => a.userId === DAVE));
  ok('the person being waited on is marked',
    after.find((a) => a.userId === DAVE)?.awaited === true);
  ok('and nobody else is', after.filter((a) => a.awaited).length === 1);
  ok('the outside person survives the merge',
    after.some((a) => a.name === 'Transport manager'));
  ok('everybody appears exactly once',
    new Set(after.map((a) => a.key)).size === after.length);

  /* Whose answer the whole thing is waiting on, from the point of view
     of the person reading it. */
  const ctx = { meId: DAVE, invites, people, companies: new Map([['c1', 'Dawson Group']]) };
  const [entry] = toEntries([event], ctx);
  ok('Dave is told the meeting is waiting on him', entry.needsMyAnswer);
  ok('and the customer is named on it', entry.company === 'Dawson Group');
  ok('and it counts as his', entry.mine);

  const asAlex = toEntries([event], { ...ctx, meId: ORG })[0];
  ok('the organiser is not waiting on themselves', !asAlex.needsMyAnswer);

  const stranger = '00000000-0000-0000-0000-000000000009';
  const asStranger = toEntries([event], { ...ctx, meId: stranger })[0];
  ok('somebody not on it is not waiting on anything', !asStranger.needsMyAnswer);
  ok('and it is not theirs', !asStranger.mine);
}

/* =============================================================
   7. The list the Work tab draws.
   ============================================================= */
{
  const ME = '00000000-0000-0000-0000-00000000000a';
  const base = {
    description: null, end_at: null, all_day: false, color: '#CF2417',
    contact_id: null, attendees: [], visibility: 'team' as const, visible_to: [],
    created_at: '', updated_at: '',
  };
  const at = (days: number, hour: number) => {
    const d = startOfDay(new Date());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour).toISOString();
  };

  const events: CalendarEvent[] = [
    { ...base, id: '1', title: 'Call Dawson', start_at: at(0, 10), created_by: ME },
    { ...base, id: '2', title: 'Call Wilsons', start_at: at(2, 9), created_by: 'other' },
    { ...base, id: '3', title: 'Site visit, Carrington', start_at: at(3, 13), created_by: ME },
    { ...base, id: '4', title: 'Meeting with Bay Freight', start_at: at(9, 11), created_by: 'other' },
    { ...base, id: '5', title: 'Reminder: send the quote', start_at: at(1, 8), created_by: ME },
    { ...base, id: '6', title: 'Call last week', start_at: at(-6, 15), created_by: ME },
  ];

  const ctx = { meId: ME, invites: [], people: new Map(), companies: new Map() };
  const entries = toEntries(events, ctx);

  ok('the entries come back in time order',
    entries.every((e, i) => i === 0 || entries[i - 1].start <= e.start));

  const all = filterDiary(entries, {});
  ok('a reminder is not in the diary list', !all.some((e) => e.event.id === '5'));
  ok('and everything else is', all.length === 5);

  const ahead = filterDiary(entries, { fromToday: true });
  ok('from today drops what has already happened', !ahead.some((e) => e.event.id === '6'));
  ok('and keeps today itself', ahead.some((e) => e.event.id === '1'));

  const calls = filterDiary(entries, { kinds: ['call'] });
  ok('filtering to calls gives the calls', calls.every((e) => e.kind === 'call'));
  ok('and all of them', calls.length === 3);

  const mine = filterDiary(entries, { onlyMine: true });
  ok('only mine is only what I booked or am on',
    mine.every((e) => e.event.created_by === ME));

  const found = filterDiary(entries, { search: 'carrington' });
  ok('search finds it whatever the case', found.length === 1 && found[0].event.id === '3');

  const groups = groupByDay(ahead);
  ok('the days come back in order',
    groups.every((g, i) => i === 0 || groups[i - 1].date <= g.date));
  ok('every entry ends up in exactly one day',
    groups.reduce((n, g) => n + g.entries.length, 0) === ahead.length);

  const counts = diaryCounts(entries, ME);
  ok('today counts one', counts.today === 1, `${counts.today}`);
  ok('this week counts what is inside seven days', counts.thisWeek === 3, `${counts.thisWeek}`);
  /* Four ahead rather than five: the reminder is not in the diary, and
     the strip has to count what the list under it shows. */
  ok('the meeting nine days out is ahead but not this week',
    counts.ahead === 4 && counts.thisWeek < counts.ahead, `${counts.ahead} ahead`);
  ok('the strip counts exactly what the list draws',
    counts.ahead === filterDiary(entries, { fromToday: true }).length);
  ok('and nothing on the strip counts a reminder',
    counts.total === filterDiary(entries, {}).length);
  ok('calls ahead are counted', counts.calls === 2, `${counts.calls}`);
  ok('meetings and visits ahead are counted', counts.meetings === 2, `${counts.meetings}`);
}

/* =============================================================
   8. What the wire will accept.
   ============================================================= */
{
  /* Whoever is booking it. Everything below is read as them, which is
     what lets the "never invite the organiser" rule be asserted. */
  const ACTOR = '00000000-0000-0000-0000-0000000000ff';
  const good = readEventBody({
    title: '  Call Dawson  ',
    start_at: '2026-06-05T10:00:00.000Z',
    end_at: '2026-06-05T11:00:00.000Z',
    color: '#CF2417',
    attendees: [
      { user_id: '00000000-0000-0000-0000-000000000002', name: 'Tom' },
      { name: 'Transport manager', email: 'tm@dawson.test' },
      { name: '' },
    ],
    visibility: 'specific',
    visible_to: ['00000000-0000-0000-0000-000000000003', 'not-a-uuid'],
  }, ACTOR);
  ok('a good body is read', !('error' in good));
  if (!('error' in good)) {
    ok('the title is trimmed', good.row.title === 'Call Dawson');
    ok('an attendee with no name and no email is dropped', good.row.attendees.length === 2);
    ok('only the person with an account is invited', good.invite.length === 1);
    ok('a value that is not a uuid is not a person', good.row.visible_to.length === 1);
  }

  ok('a body with no title is refused', 'error' in readEventBody({ start_at: '2026-06-05T10:00:00Z' }, ACTOR));
  ok('a body with no start is refused', 'error' in readEventBody({ title: 'Call' }, ACTOR));
  ok('a start that is not a date is refused',
    'error' in readEventBody({ title: 'Call', start_at: 'next tuesday-ish' }, ACTOR));

  const backwards = readEventBody({
    title: 'Call', start_at: '2026-06-05T10:00:00Z', end_at: '2026-06-05T09:00:00Z',
  }, ACTOR);
  ok('an end before the start is pushed out rather than stored', !('error' in backwards));
  if (!('error' in backwards)) {
    ok('and lands half an hour after it',
      backwards.row.end_at === '2026-06-05T10:30:00.000Z', String(backwards.row.end_at));
  }

  const invented = readEventBody({
    title: 'Call', start_at: '2026-06-05T10:00:00Z', color: '#123456', visibility: 'everybody',
  }, ACTOR);
  ok('a colour nobody offers becomes the first one', !('error' in invented));
  if (!('error' in invented)) {
    ok('and it is the STC red', invented.row.color === '#CF2417');
    ok('a visibility nobody offers becomes private', invented.row.visibility === 'private');
  }

  const priv = readEventBody({
    title: 'Call', start_at: '2026-06-05T10:00:00Z',
    visibility: 'private', visible_to: ['00000000-0000-0000-0000-000000000003'],
  }, ACTOR);
  ok('named people on a private entry are dropped',
    !('error' in priv) && priv.row.visible_to.length === 0);

  const twice = readEventBody({
    title: 'Call', start_at: '2026-06-05T10:00:00Z',
    attendees: [
      { user_id: '00000000-0000-0000-0000-000000000002', name: 'Tom' },
      { user_id: '00000000-0000-0000-0000-000000000002', name: 'Tom again' },
    ],
  }, ACTOR);
  ok('the same person picked twice is one invitation',
    !('error' in twice) && twice.invite.length === 1);

  /* Nobody invites themselves. The compose form puts whoever is booking
     it on the attendee list, which is right, and sending them an
     invitation to it is not: `command_meeting_invite` sets `awaiting`
     to the person asked, so it put a meeting somebody had just booked
     into their own "waiting on you" count. */
  const self = readEventBody({
    title: 'Call Dawson', start_at: '2026-06-05T10:00:00Z',
    attendees: [
      { user_id: ACTOR, name: 'Me' },
      { user_id: '00000000-0000-0000-0000-000000000002', name: 'Tom' },
    ],
  }, ACTOR);
  ok('booking something does not invite you to it', !('error' in self));
  if (!('error' in self)) {
    ok('and only the other person is asked',
      self.invite.length === 1 && self.invite[0] === '00000000-0000-0000-0000-000000000002');
    ok('while you stay on the attendee list',
      self.row.attendees.some((a) => a.user_id === ACTOR));
  }

  const alone = readEventBody({
    title: 'Dentist', start_at: '2026-06-05T10:00:00Z',
    attendees: [{ user_id: ACTOR, name: 'Me' }],
  }, ACTOR);
  ok('something booked only for yourself asks nobody',
    !('error' in alone) && alone.invite.length === 0);
}

/* =============================================================
   9. Saying when something is, in words.
   ============================================================= */
{
  const today = new Date();
  ok('today is Today', relativeDay(today, today) === 'Today');
  ok('tomorrow is Tomorrow', relativeDay(addDays(today, 1), today) === 'Tomorrow');
  ok('yesterday is Yesterday', relativeDay(addDays(today, -1), today) === 'Yesterday');
  ok('three days out is a weekday name',
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/
      .test(relativeDay(addDays(today, 3), today)));
  ok('a fortnight out is a date', /\d/.test(relativeDay(addDays(today, 14), today)));

  ok('half an hour reads as thirty minutes',
    durationLabel('2026-06-05T10:00:00Z', '2026-06-05T10:30:00Z') === '30 min');
  ok('an hour reads as an hour',
    durationLabel('2026-06-05T10:00:00Z', '2026-06-05T11:00:00Z') === '1 hr');
  ok('ninety minutes reads as an hour and a half',
    durationLabel('2026-06-05T10:00:00Z', '2026-06-05T11:30:00Z') === '1 hr 30 min');
  ok('no end is no length', durationLabel('2026-06-05T10:00:00Z', null) === null);
  ok('an end before the start is no length',
    durationLabel('2026-06-05T10:00:00Z', '2026-06-05T09:00:00Z') === null);
}

/* Nothing in the diary's own vocabulary throws on an empty list, which
   is what every one of these screens draws on its first day. */
{
  const empty = toEntries([], { meId: 'x', invites: [], people: new Map(), companies: new Map() });
  ok('an empty diary is an empty list', empty.length === 0);
  ok('and groups into nothing', groupByDay(empty).length === 0);
  const c = diaryCounts(empty, 'x');
  ok('and counts nothing', c.today === 0 && c.ahead === 0 && c.waitingOnMe === 0);
  ok('and a month of nothing is still a month',
    monthGrid(startOfMonth(new Date())).length % 7 === 0);
}

console.log(`\n${pass.toLocaleString('en-GB')}/${(pass + fail).toLocaleString('en-GB')} holding`);
if (failures.length) {
  console.log('\nfirst failures:');
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
}
if (fail) process.exit(1);
