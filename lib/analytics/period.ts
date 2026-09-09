/* =============================================================
   Which days a figure covers, and which days it is compared against.

   From the design:

     One sticky control bar drives every chart on the page, because the
     commonest mistake on an analytics screen is reading a number from
     the wrong period.

   That sentence is the whole reason this file exists separately from
   the screen. Period arithmetic is where analytics pages go quietly
   wrong, and it goes wrong in ways nobody notices for a month: a
   comparison that is one day longer than the window, a quarter that
   starts in the wrong month, a "last year" that lands on a different
   weekday and moves a Monday's invoicing out of the range.

   So it is pure functions over dates, with no React and no database
   near it, and `npm run check:analytics` asserts every case rather than
   the screen being eyeballed once.

   ---- The part month guard ----

   The design calls for it by name and it is the single most valuable
   thing here:

     September is 9 days in. Comparisons are trimmed to the first 9 days
     of August so the shape is honest, and every chart says so in its
     footnote.

   Without it, day nine of a month is compared against a whole previous
   month and the page says the business has collapsed. Every morning,
   for the first three weeks of every month, on the screen the MD opens
   first.
   ============================================================= */

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

/** What the current window is measured against. */
export type CompareMode = 'previous' | 'lastyear' | 'target';

export type Window = { from: string; to: string };

export type Period = {
  kind: PeriodKind;
  /** The window being looked at. ISO dates, inclusive at both ends. */
  window: Window;
  /** What it is compared against. Absent when comparing to target. */
  compare: Window | null;
  mode: CompareMode;
  /** Whether the comparison was cut short to match a part period. */
  trimmed: boolean;
  /** How many days each window covers. Equal unless trimming is off. */
  days: number;
  compareDays: number;
};

const DAY = 86_400_000;

/* -------------------------------------------------------------
   Dates as days, not as instants.

   Everything here works in UTC on date-only values. A period boundary
   computed in local time moves by an hour twice a year, and the day it
   moves is the day a month's revenue lands in the wrong month.
   ------------------------------------------------------------- */
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function asDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

export function addDays(s: string, n: number): string {
  return iso(new Date(asDate(s).getTime() + n * DAY));
}

export function addMonths(s: string, n: number): string {
  const d = asDate(s);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  /* Clamped to the end of the shorter month rather than rolling into
     the next one. 31 January minus one month is 31 December in every
     naive implementation and 28 February in every correct one, and the
     naive answer silently double counts a day. */
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last),
  )));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((asDate(b).getTime() - asDate(a).getTime()) / DAY) + 1;
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: string): string {
  const d = asDate(s);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** The quarter a date sits in, as calendar quarters. */
export function startOfQuarter(s: string): string {
  const d = asDate(s);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
}

/**
 * The financial year a date sits in. April to April.
 *
 * Migration 082 established this and every revenue figure in the
 * application already uses it. A calendar year here would put the
 * Analytics hub and the Revenue tab a quarter apart on the same day,
 * which is worse than either being wrong on its own.
 */
export function startOfFinancialYear(s: string): string {
  const d = asDate(s);
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return iso(new Date(Date.UTC(year, 3, 1)));
}

/* -------------------------------------------------------------
   Building a period
   ------------------------------------------------------------- */

/**
 * The window a kind implies, ending today.
 *
 * "Month" means the month so far, not the last thirty days. Somebody
 * asking how the month is going means the calendar month, and a
 * rolling thirty days answers a question nobody asked and cannot be
 * compared against a target that is set per month.
 */
export function windowFor(kind: Exclude<PeriodKind, 'custom'>, today: string): Window {
  if (kind === 'month') return { from: startOfMonth(today), to: today };
  if (kind === 'quarter') return { from: startOfQuarter(today), to: today };
  return { from: startOfFinancialYear(today), to: today };
}

/**
 * What the window is compared against.
 *
 * `trim` is the part month guard. On, the comparison covers the same
 * NUMBER OF DAYS as the window: nine days of September against the
 * first nine days of August. Off, it covers the whole previous period,
 * which is the honest way to ask "how did last month finish" and the
 * dishonest way to ask "how are we doing".
 */
export function comparisonFor(
  kind: PeriodKind, w: Window, mode: CompareMode, trim: boolean,
): Window | null {
  if (mode === 'target') return null;

  if (mode === 'lastyear') {
    const from = addMonths(w.from, -12);
    const to = trim ? addDays(from, daysBetween(w.from, w.to) - 1) : addMonths(w.to, -12);
    return { from, to };
  }

  /* Previous period. The step back is the period's own unit, not its
     length in days: a month back from 1 September is 1 August, and 31
     days back is 1 August in one month and 2 August in another. */
  if (kind === 'month') {
    const from = addMonths(w.from, -1);
    const to = trim ? earlier(addDays(from, daysBetween(w.from, w.to) - 1), endOfMonth(from))
      : endOfMonth(from);
    return { from, to };
  }
  /* Quarters and years are clamped to the day before this window
     starts, and that clamp is not belt and braces: a 92 day quarter
     trimmed against a 90 day one runs two days into the CURRENT
     quarter, and a leap financial year does the same against an
     ordinary one. Both were in this file until a 400 day sweep in
     `npm run check:analytics` found them. A comparison that overlaps
     the window counts the same revenue on both sides and reports growth
     of nought on the two best days of the quarter. */
  if (kind === 'quarter' || kind === 'year') {
    const from = addMonths(w.from, kind === 'quarter' ? -3 : -12);
    const before = addDays(w.from, -1);
    const to = trim ? earlier(addDays(from, daysBetween(w.from, w.to) - 1), before) : before;
    return { from, to };
  }

  /* A custom range has no unit, so the only meaning "previous" can
     carry is the same number of days immediately before it. Trimming
     does not apply: it is already exactly as long. */
  const length = daysBetween(w.from, w.to);
  const to = addDays(w.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/** The whole period, assembled. One object, so nothing can disagree. */
export function buildPeriod(args: {
  kind: PeriodKind;
  today: string;
  /** Only for `kind: 'custom'`. */
  from?: string;
  to?: string;
  mode: CompareMode;
  trim: boolean;
}): Period {
  const window = args.kind === 'custom'
    ? { from: args.from ?? startOfMonth(args.today), to: args.to ?? args.today }
    : windowFor(args.kind, args.today);

  const compare = comparisonFor(args.kind, window, args.mode, args.trim);

  /* "Trimmed" is only true where trimming actually changed something.
     A window that is a whole month compared against a whole month has
     nothing to warn anybody about, and a footnote on every chart saying
     so is a footnote people stop reading. */
  const full = comparisonFor(args.kind, window, args.mode, false);
  const trimmed = Boolean(args.trim && compare && full && compare.to !== full.to);

  return {
    kind: args.kind,
    window,
    compare,
    mode: args.mode,
    trimmed,
    days: daysBetween(window.from, window.to),
    compareDays: compare ? daysBetween(compare.from, compare.to) : 0,
  };
}

/* -------------------------------------------------------------
   Saying it out loud
   ------------------------------------------------------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "1 to 9 September 2026", or "9 September 2026" for a single day. */
/**
 * The tab's own name for the window, which has to say when it is not
 * the whole thing.
 *
 * A tab reading "Month" beside a range reading "1 to 9 September" is
 * the page telling somebody it is broken. It is not: month to date is
 * what the design asks for, and comparing nine days against a whole
 * August is the mistake the part month guard exists to prevent. But
 * the reader has to be told that in the label rather than left to work
 * it out from two numbers that do not agree.
 */
export function periodWords(p: Period): string {
  if (p.kind === 'custom') return 'Custom range';
  const whole = { month: 'This month', quarter: 'This quarter', year: 'This financial year' }[p.kind];
  const partial = { month: 'Month to date', quarter: 'Quarter to date', year: 'Year to date' }[p.kind];
  return isComplete(p.window, p.kind) ? whole : partial;
}

/** Does this window run to the end of its own month, quarter or year? */
export function isComplete(w: Window, kind: PeriodKind): boolean {
  if (kind === 'custom') return true;
  if (kind === 'month') return w.to === endOfMonth(w.from);
  if (kind === 'quarter') return w.to === addDays(addMonths(startOfQuarter(w.from), 3), -1);
  return w.to === addDays(addMonths(startOfFinancialYear(w.from), 12), -1);
}

export function windowWords(w: Window): string {
  const a = asDate(w.from);
  const b = asDate(w.to);
  if (w.from === w.to) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()} to ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} to ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()} to `
    + `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

/** The label on the comparison toggle: "Compare to August". */
export function compareWords(p: Period): string {
  if (p.mode === 'target') return 'Against target';
  if (!p.compare) return 'No comparison';
  if (p.mode === 'lastyear') return `Against ${asDate(p.compare.from).getUTCFullYear()}`;
  const m = asDate(p.compare.from);
  if (p.kind === 'month') return `Against ${MONTHS[m.getUTCMonth()]}`;
  return `Against ${windowWords(p.compare)}`;
}

/**
 * The footnote every chart carries when the comparison was cut short.
 *
 * Said in days rather than in dates, because "the first 9 days" is what
 * makes the trim understandable and "1 to 9 August" is what makes it
 * look like an arbitrary range somebody chose.
 */
export function trimWords(p: Period): string | null {
  if (!p.trimmed || !p.compare) return null;
  const m = asDate(p.compare.from);
  return `${p.days} days in. The comparison is the first ${p.days} days of `
    + `${MONTHS[m.getUTCMonth()]}, so the shape is like for like.`;
}
