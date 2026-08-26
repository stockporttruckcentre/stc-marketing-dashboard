/* =============================================================
   Laying a month, a week and an agenda out.

   Pure functions over dates, with no React and no Supabase in them, so
   the arithmetic that decides which column Tuesday is in can be
   asserted rather than looked at. `npm run check:calendar` does exactly
   that, across every month for twenty years and both clock changes.

   ---- Why the header is not a separate thing ----

   The old calendar drew the weekday names in one CSS grid and the days
   in another, both `repeat(7, 1fr)`. A `1fr` track is
   `minmax(auto, 1fr)`, so a cell holding a long meeting title pushed
   its own column wider, the header could not push back, and every
   column after it drifted. Tuesday's name sat over Wednesday's dates.

   The fix is structural rather than a width: one grid holds the names
   and the days, so there are seven tracks in total and nothing can
   disagree about where they are. `WEEKDAYS` below is the order they go
   in, and it is exported rather than written out at the call site so a
   screen cannot label the columns in a different order from the one
   `monthGrid` fills them in.

   ---- Everything is local time ----

   `toISOString()` is UTC, and between the last Sunday in March and the
   last Sunday in October the United Kingdom is an hour ahead of it. A
   meeting at half past midnight on the 5th is "the 4th" in UTC, so a
   calendar keyed on the ISO string puts it in yesterday's box twice a
   year. `dayKey` builds the key out of the local parts instead.
   ============================================================= */

/** Monday first, because a working week starts on a Monday. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The same seven, spelled out, for a screen wide enough to say them. */
export const WEEKDAYS_LONG = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

/** `2026-08-26`, from the local parts rather than from UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Which of the seven columns a date belongs in. Monday is 0. */
export function columnOf(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** The Monday on or before this date. */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -columnOf(d));
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isToday(d: Date): boolean {
  return sameDay(d, new Date());
}

/**
 * Every cell in the month view, in reading order.
 *
 * Always a whole number of weeks, always starting on a Monday, with the
 * days either side of the month included rather than left blank: a
 * meeting on the 1st of next month is worth seeing from the end of this
 * one, and an empty box teaches nobody anything.
 *
 * The guarantee this makes, and the one the check asserts, is that
 * `cells[i]` is in column `i % 7`, and that column is `columnOf` of
 * that date. Everything else about the month view follows from it.
 */
export function monthGrid(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  const last = endOfMonth(cursor);
  const lead = columnOf(first);

  const cells: Date[] = [];
  for (let i = lead; i > 0; i--) cells.push(addDays(first, -i));
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  }
  /* Out to a whole week, and never a trailing row that is entirely next
     month: six rows of a five row month is an empty stripe at the
     bottom that looks like a rendering fault. */
  while (cells.length % 7 !== 0) cells.push(addDays(cells[cells.length - 1], 1));
  return cells;
}

/** The seven days of the week containing this date, Monday first. */
export function weekGrid(cursor: Date): Date[] {
  const monday = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** A run of days from today, for the agenda. */
export function daysFrom(start: Date, count: number): Date[] {
  const from = startOfDay(start);
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/* ---------- saying when something is, in words ---------- */

export function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function weekLabel(d: Date): string {
  const monday = startOfWeek(d);
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const left = monday.toLocaleDateString('en-GB',
    sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const right = sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${left} to ${right} ${sunday.getFullYear()}`;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Today, tomorrow, yesterday, or the day itself.
 *
 * A list of dates where three quarters of them say "26 Aug" makes
 * somebody work out which one is today. Naming the two that matter
 * means the rest can be read past.
 */
export function relativeDay(d: Date, now = new Date()): string {
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** How long something runs for, said the way somebody would say it. */
export function durationLabel(startAt: string, endAt: string | null): string | null {
  if (!endAt) return null;
  const mins = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}
