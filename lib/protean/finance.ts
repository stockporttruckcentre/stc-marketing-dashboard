import type { SupabaseClient } from '@supabase/supabase-js';
import { readable, type DivisionFilter } from './rpc';

/* =============================================================
   The seven reads behind the Analytics hub.

   From the business:

     There's not enough information on that analytics hub for our
     finance team to go in a meeting with the MD and be able to outline
     everything happening in the company.

   These sit apart from `rpc.ts` because they answer a different kind of
   question. Everything in there is "what did this customer spend" or
   "what did this division bill", read one record at a time on a screen
   somebody is working in. These are the whole company at once, read
   once, to be talked about.

   ---- Every one of them takes an as-at date ----

   A board pack is dated, and the number quoted on Tuesday has to still
   be the number on Friday. `upto` is passed all the way through to the
   database, where the financial year is worked out from it, so a figure
   read at a date is reproducible at that date.
   ============================================================= */

type Db = SupabaseClient;

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/** An individual trailer sale. The only division where a deal has a name. */
export type Deal = {
  id: string;
  stc_no: string | null;
  what: string | null;
  customer: string | null;
  contact_id: string | null;
  sales_rep: string | null;
  sold: string | null;
  new_or_used: string | null;
  sales_price: number | null;
  cost: number | null;
  profit: number | null;
  profit_pct: number | null;
};

export async function trailerDeals(db: Db, upto?: string, limit = 200): Promise<Deal[]> {
  const { data, error } = await db.rpc('trailer_deals', {
    p_upto: upto ?? null, p_limit: limit,
  });
  if (error) throw readable(error);
  return rows<Deal>(data);
}

/**
 * One row per person, from two sources that are never added together.
 *
 * A trailer sale often has a lead against it as well. Summing the two
 * would count that person's month twice, and there is no key saying
 * which sales and which leads are the same deal, so the screen shows
 * them side by side and lets a human read across.
 */
export type Person = {
  person: string;
  has_login: boolean;
  trailers: number;
  trailer_value: number;
  trailer_margin: number;
  leads_open: number;
  pipeline_value: number;
  leads_won: number;
  /** As recorded on the leads. Never worked out from a rate held in the browser. */
  commission: number;
};

export async function salesByPerson(db: Db, upto?: string): Promise<Person[]> {
  const { data, error } = await db.rpc('sales_by_person', { p_upto: upto ?? null });
  if (error) throw readable(error);
  return rows<Person>(data);
}

/** Every stage against every division, including the stages nobody is at. */
export type Stage = {
  division: string;
  name: string;
  sort_order: number;
  stage: string;
  stage_at: number;
  leads: number;
  value: number;
};

export async function pipelineByStage(db: Db): Promise<Stage[]> {
  const { data, error } = await db.rpc('pipeline_by_stage');
  if (error) throw readable(error);
  return rows<Stage>(data);
}

/** Risers and fallers, the two Protean divisions netted together. */
export type Mover = {
  contact_id: string | null;
  company_name: string;
  this_year: number;
  last_year: number;
  change: number;
  /** Null where there was nothing to grow from. A new customer has no percentage. */
  change_pct: number | null;
  divisions: string | null;
};

export async function customerMovement(db: Db, upto?: string, limit = 12): Promise<Mover[]> {
  const { data, error } = await db.rpc('customer_movement', {
    p_upto: upto ?? null, p_limit: limit,
  });
  if (error) throw readable(error);
  return rows<Mover>(data);
}

/** How much of the income is how few customers. */
export type Concentration = {
  customers: number;
  billed: number;
  top_1: number;
  top_5: number;
  top_10: number;
  biggest: string | null;
  average: number;
  median: number;
};

export async function concentration(
  db: Db, division: DivisionFilter = null, upto?: string,
): Promise<Concentration | null> {
  const { data, error } = await db.rpc('revenue_concentration', {
    p_upto: upto ?? null, p_division: division,
  });
  if (error) throw readable(error);
  return rows<Concentration>(data)[0] ?? null;
}

/** Work in progress by how long it has been sitting. */
export type AgeBand = {
  division: string;
  name: string;
  band: string;
  band_at: number;
  jobs: number;
  value: number;
};

export async function openWorkAgeing(
  db: Db, division: DivisionFilter = null, upto?: string,
): Promise<AgeBand[]> {
  const { data, error } = await db.rpc('open_work_ageing', {
    p_division: division, p_upto: upto ?? null,
  });
  if (error) throw readable(error);
  return rows<AgeBand>(data);
}

/**
 * Why the customer list does not add up to the division total.
 *
 * The three parts sum to the whole exactly. That is the point: without
 * it, a finance team reconciling this screen against a per customer
 * report finds a difference and has to go looking for what it is.
 */
export type Reconciliation = {
  division: string;
  name: string;
  sort_order: number;
  billed: number;
  on_customers: number;
  unattributed: number;
  unattributed_n: number;
  set_aside: number;
  set_aside_n: number;
};

export async function reconciliation(db: Db, upto?: string): Promise<Reconciliation[]> {
  const { data, error } = await db.rpc('division_reconciliation', { p_upto: upto ?? null });
  if (error) throw readable(error);
  return rows<Reconciliation>(data);
}

/* -------------------------------------------------------------
   The stage names, in the words the tracker already uses.
   ------------------------------------------------------------- */
export const STAGE_LABEL: Record<string, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  customer: 'Customer',
  lost: 'Lost',
};

/**
 * The stages that are still in play.
 *
 * `won` is deliberately included and `customer` is not. A deal marked
 * won has not been invoiced yet, so it is still money coming; one
 * marked customer has landed and is already in the revenue figures
 * above, and counting it again as pipeline would show it twice.
 */
export const OPEN_STAGES = new Set(['lead', 'contacted', 'quoted', 'won']);

/* -------------------------------------------------------------
   The seven views, and the two bits of month arithmetic behind the
   table on the first one.

   Here rather than in the component because they are the parts that
   can be wrong without looking wrong. A month table that quietly
   starts in January on an April year is a correct looking table of the
   wrong months, and nobody reading it in a meeting would catch it.
   ------------------------------------------------------------- */

export type AnalyticsView =
  'overview' | 'deals' | 'people' | 'pipeline' | 'customers' | 'work' | 'reconcile';

export const VIEWS: { key: AnalyticsView; label: string }[] = [
  { key: 'overview', label: 'Month by month' },
  { key: 'deals', label: 'Trailer deals' },
  { key: 'people', label: 'Who is selling' },
  { key: 'pipeline', label: 'What is coming' },
  { key: 'customers', label: 'Customers' },
  { key: 'work', label: 'Open work' },
  { key: 'reconcile', label: 'Reconciliation' },
];

/** `?view=deals` from the command bar, and anything else is the overview. */
export function viewFrom(said: string | null | undefined): AnalyticsView {
  return VIEWS.some((v) => v.key === said) ? (said as AnalyticsView) : 'overview';
}

/**
 * Which of the months on hand belong to the year being read.
 *
 * The chart carries two years so the comparison is visible. The table
 * carries one, because a table somebody reads out loud in a meeting is
 * twice as long and half as useful with last year interleaved.
 *
 * The year began at the LAST month in the range whose month number is
 * the financial year's start. The range always ends in the month being
 * read to, so the most recent April is the April the year running began
 * in, whether that falls in this calendar year or the one before.
 *
 * With no financial year known, the last twelve. That is a guess and it
 * is the right guess: it is a year, ending where the data ends.
 */
export function monthsOfTheYear(months: string[], yearStart?: number): string[] {
  const keys = [...new Set(months)].sort();
  if (!yearStart) return keys.slice(-12);
  const began = [...keys].reverse().find((k) => Number(k.slice(5, 7)) === yearStart);
  return began ? keys.filter((k) => k >= began) : keys.slice(-12);
}

/**
 * The same month a year earlier, as a key.
 *
 * String arithmetic on purpose. `new Date(...).setFullYear(y - 1)` is
 * the same answer for eleven months of the year and a different one for
 * the twenty ninth of February, and every key here is the first of a
 * month, so a Date is a way to be wrong once every four years for no
 * benefit.
 */
export function sameMonthLastYear(month: string): string {
  return `${Number(month.slice(0, 4)) - 1}-${month.slice(5, 7)}-01`;
}
