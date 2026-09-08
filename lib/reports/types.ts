/* =============================================================
   What a report is, as data.

   Every report in this application produces the same shape, and the one
   renderer draws it. That is the whole design, and it is the reason
   there can be nine reports rather than two:

     a report is a title, a period, and a list of sections
     a section is a heading and one of four kinds of content
     nothing in a report knows how it will be drawn

   So the screen, the print stylesheet and the Word export each read the
   shape once, and adding a tenth report is a function that returns
   sections rather than a tenth component with its own layout, its own
   table styling and its own way of being slightly wrong on paper.

   ---- Why four kinds and not more ----

   Because a meeting is read out loud. Figures, a table, a list of
   things somebody has to act on, and a paragraph of context cover
   everything the business asked for, and a fifth kind is a fifth thing
   to make look right in Word.
   ============================================================= */

export type Money = number;

/** A row of headline figures. What a section opens with. */
export type StatSection = {
  kind: 'stats';
  id: string;
  title: string;
  note?: string;
  stats: {
    label: string;
    value: string;
    /** The line under it: what it is measured against. */
    sub?: string;
    /** Up is not always good, so the direction and the reading are separate. */
    direction?: 'up' | 'down' | 'flat';
    good?: boolean;
  }[];
};

/** A table. Columns carry their own alignment so print and Word agree. */
export type TableSection = {
  kind: 'table';
  id: string;
  title: string;
  note?: string;
  columns: { key: string; label: string; align?: 'left' | 'right'; width?: number }[];
  rows: Record<string, string | number | null>[];
  /** Shown instead of an empty table. Never a blank box. */
  empty?: string;
};

/** Things somebody has to do something about. The meeting's spine. */
export type ListSection = {
  kind: 'list';
  id: string;
  title: string;
  note?: string;
  items: {
    title: string;
    detail?: string;
    meta?: string;
    /* Draws a coloured marker. Only where it means something: a red
       customer, an overdue task. Not decoration. */
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }[];
  empty?: string;
};

/** A paragraph. For the framing sentence at the top of a section. */
export type NoteSection = {
  kind: 'note';
  id: string;
  title?: string;
  text: string;
};

export type Section = StatSection | TableSection | ListSection | NoteSection;

export type Report = {
  slug: string;
  title: string;
  /** What it covers, in words. "Two weeks to 8 September, all divisions." */
  subtitle: string;
  generatedAt: string;
  /** Echoed back so the paper says what it was run for. */
  filters: ReportFilters;
  sections: Section[];
};

/* =============================================================
   What somebody can narrow a report to.

   From the business:

     Have options when running reports to include/exclude divisions and
     data types. E.g. i may want to run a report of top and bottom
     customers but only for rentals, or just export a report of dean's
     won leads in the past 2 weeks but only for maintenance.

   Four axes, and each one is in that sentence: division, period,
   person, and which sections to include.
   ============================================================= */

export type Division = 'stc' | 'trailer' | 'rental';

export type Period =
  | 'week' | 'fortnight' | 'month' | 'quarter' | 'fy' | 'year';

export type ReportFilters = {
  /** Empty means every division. Not "none": nobody runs a report of nothing. */
  divisions: Division[];
  period: Period;
  /** A profile id, or null for everybody. */
  person: string | null;
  /** Section ids to leave out. Empty means the whole report. */
  exclude: string[];
};

export const DIVISION_LABEL: Record<Division, string> = {
  stc: 'STC',
  trailer: 'Trailer Sales',
  rental: 'Rentals',
};

export const PERIOD_LABEL: Record<Period, string> = {
  week: 'The last week',
  fortnight: 'The last two weeks',
  month: 'The last month',
  quarter: 'The last quarter',
  fy: 'This financial year',
  year: 'The last twelve months',
};

/** How many days back each period reaches. The financial year is its own case. */
export const PERIOD_DAYS: Record<Exclude<Period, 'fy'>, number> = {
  week: 7,
  fortnight: 14,
  month: 30,
  quarter: 91,
  year: 365,
};

/**
 * When the period starts.
 *
 * The financial year runs April to April here, which migration 082
 * established and every revenue figure in the application already uses.
 * A report that used a calendar year would disagree with the Revenue tab
 * on the same day, which is worse than either being wrong on its own.
 */
export function periodStart(period: Period, now = new Date()): Date {
  if (period === 'fy') {
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(Date.UTC(year, 3, 1));
  }
  const from = new Date(now);
  from.setDate(from.getDate() - PERIOD_DAYS[period]);
  from.setHours(0, 0, 0, 0);
  return from;
}

/** The line under a report's title. */
export function coverWords(filters: ReportFilters, now = new Date()): string {
  const when = PERIOD_LABEL[filters.period];
  const where = filters.divisions.length === 0 || filters.divisions.length === 3
    ? 'all divisions'
    : filters.divisions.map((d) => DIVISION_LABEL[d]).join(' and ');
  const to = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${when} to ${to}, ${where}`;
}
