import type { CompareMode, Period, PeriodKind } from './period';

/* =============================================================
   What the Analytics hub is, as data.

   One shape, filled by the route and drawn by the screen, so that every
   device on the page reads a figure somebody else computed rather than
   totalling rows in a browser. The old page did the second thing, which
   is why it could only ever answer questions about trailer sales: the
   Protean invoices are twenty thousand rows and were never going to
   travel.

   ---- Every figure carries where it came from ----

   `Figure` is the type that makes the design's "explain this number"
   panel possible, and it is deliberately not just a number:

     A non-technical user needs two things from every figure: a way to
     see what is behind it, and a plain answer to "where does this come
     from".

   So a figure knows its value, what it is measured against, and the
   sentence that says what it counts and what it excludes. A figure
   without that sentence cannot be put on this page.
   ============================================================= */

export type DivisionSlug = 'stc' | 'trailer' | 'rental';

/** Where a number came from, in words a person can check. */
export type Provenance = {
  /** "Invoices in Protean with a tax point in the window." */
  counts: string;
  /** "Credit notes, and anything not yet invoiced." Null where nothing is left out. */
  excludes: string | null;
  /** "protean_invoices, imported weekly." */
  source: string;
  /** Who is allowed to change the underlying data. */
  changedBy: string;
};

/** A number, what it is measured against, and what it means. */
export type Figure = {
  label: string;
  value: number;
  /** How to render it. Money is the common case; a rate is a percentage. */
  unit: 'money' | 'count' | 'percent' | 'days';
  /** The same measure over the comparison window. Null when there is none. */
  was: number | null;
  /** What was promised. Null where no target is set. */
  target: number | null;
  /** One line under the figure: "Month to date against August". */
  note: string;
  /** Up is not always good, so direction and reading are separate. */
  goodWhen: 'up' | 'down';
  provenance: Provenance;
};

/* -------------------------------------------------------------
   The sections
   ------------------------------------------------------------- */

export type DivisionRow = {
  division: DivisionSlug;
  name: string;
  revenue: number;
  was: number;
  target: number | null;
  deals: number;
  customers: number;
  /** Only trailer sales records a cost. Null means unknown, never zero. */
  margin: number | null;
  /** The three or four lines under a scorecard, already worded. */
  detail: { label: string; value: string; bad?: boolean }[];
};

export type MonthPoint = {
  month: string;
  stc: number;
  trailer: number;
  rental: number;
  target: number | null;
};

export type PersonRow = {
  id: string;
  name: string;
  initials: string;
  /** Their busiest division in the window, for the chip on the row. */
  division: DivisionSlug | null;
  leads: number;
  quoted: number;
  won: number;
  wonValue: number;
  wasValue: number;
  openValue: number;
  /** Won as a share of leads raised. */
  conversion: number;
};

export type SourceFlow = {
  source: string;
  leads: number;
  /** Won, split by the division the lead was for. */
  won: Record<DivisionSlug, number>;
  lost: number;
  open: number;
  value: number;
};

export type StockUnit = {
  id: string;
  ref: string;
  what: string;
  days: number;
  /** Margin left as a share of the asking price. Null when no cost is known. */
  marginPct: number | null;
  price: number;
  location: string | null;
};

export type ContractBook = {
  /** One point per month: the book's weekly value split by tier. */
  months: { month: string; silver: number; gold: number; platinum: number }[];
  mix: { tier: 'Silver' | 'Gold' | 'Platinum'; contracts: number; weekly: number }[];
  /** Contracts still live n months after the month they started. */
  cohorts: { month: string; signed: number; live: (number | null)[] }[];
  thisWeek: number;
  annualised: number;
  addedThisPeriod: number;
  contracts: number;
};

/** Something only a decision can fix. The right column of the verdict band. */
export type Decision = {
  what: string;
  tone: 'danger' | 'warning' | 'info';
  /** Where to go and do something about it. */
  href: string | null;
};

/**
 * A part of the page that has no data behind it yet.
 *
 * Named rather than hidden, and named precisely. The alternative is a
 * chart of zeroes, and a zero on this page is a claim about the
 * business. Every one of these says what would have to exist.
 */
export type NotWired = {
  what: string;
  why: string;
  needs: string;
};

export type Analytics = {
  period: Period;
  generatedAt: string;
  /** The sentence at the top. Written from the figures, never typed. */
  verdict: string;
  decisions: Decision[];
  headline: Figure[];
  divisions: DivisionRow[];
  months: MonthPoint[];
  people: PersonRow[];
  sources: SourceFlow[];
  stock: StockUnit[];
  book: ContractBook | null;
  /** Top customers by revenue in the window, across every division. */
  customers: { name: string; revenue: number; was: number; division: DivisionSlug }[];
  notWired: NotWired[];
};


/* -------------------------------------------------------------
   What the whole hub is filtered by.

   Moved here from `AnalyticsHub` when the page was split into a
   landing and six drill-downs. Seven screens now share one filter
   shape, and a second declaration of it would be a second idea of
   what a period is.
   ------------------------------------------------------------- */
export type Filters = {
  kind: PeriodKind;
  from: string;
  to: string;
  mode: CompareMode;
  trim: boolean;
  divisions: DivisionSlug[];
  person: string | null;
};
