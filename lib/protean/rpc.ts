/* =============================================================
   The revenue screen's side of the database.

   Every call here is an RPC, because 075 revoked direct writes on all
   four Protean tables from `authenticated`. That is not ceremony: an
   import landing wrong moves every figure on the analytics screen and
   in a board meeting, so there is exactly one way in and it checks a
   capability first.

   The shapes below are the function signatures written out. They are
   worth keeping honest by hand for the same reason the RPC contract
   check exists: a column renamed in a migration and not here is a
   `undefined` on a screen rather than an error anywhere.
   ============================================================= */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvoiceRow, OpenJobRow } from '@/lib/protean/import';

export type YearOnYear = {
  contact_id: string;
  company_name: string;
  alphas: string[];
  this_year: number;
  last_year: number;
  change: number;
  open_jobs: number;
  open_value: number;
  last_billed: string | null;
};

export type GroupRevenue = {
  group_id: string;
  group_name: string;
  customers: number;
  accounts: number;
  this_year: number;
  last_year: number;
  change: number;
  open_jobs: number;
  open_value: number;
  last_billed: string | null;
};

export type GroupLine = {
  alpha: string;
  protean_name: string;
  contact_id: string;
  company_name: string;
  this_year: number;
  last_year: number;
  change: number;
  open_jobs: number;
  open_value: number;
  last_billed: string | null;
};

export type Waiting = {
  alpha: string;
  protean_name: string;
  invoices: number;
  net: number;
  first_billed: string | null;
  last_billed: string | null;
  open_jobs: number;
};

export type AccountLine = {
  alpha: string;
  protean_name: string;
  ignored: boolean;
  invoices: number;
  net: number;
  first_billed: string | null;
  last_billed: string | null;
  open_jobs: number;
  open_value: number;
};

export type BatchResult = {
  rows_read: number;
  rows_new: number;
  rows_updated: number;
  rows_skipped: number;
  accounts_new?: number;
  rows_unmatched?: number;
};

type Db = SupabaseClient<any, any, any>;

const rows = <T>(data: unknown): T[] => (data ?? []) as T[];

export async function yearOnYear(db: Db, upto?: string): Promise<YearOnYear[]> {
  const { data, error } = await db.rpc('protean_year_on_year', { p_upto: upto ?? null });
  if (error) throw new Error(error.message);
  return rows<YearOnYear>(data);
}

export async function groupRevenue(db: Db, upto?: string): Promise<GroupRevenue[]> {
  const { data, error } = await db.rpc('group_revenue', { p_upto: upto ?? null });
  if (error) throw new Error(error.message);
  return rows<GroupRevenue>(data);
}

export async function groupBreakdown(db: Db, group: string, upto?: string): Promise<GroupLine[]> {
  const { data, error } = await db.rpc('group_breakdown', { p_group: group, p_upto: upto ?? null });
  if (error) throw new Error(error.message);
  return rows<GroupLine>(data);
}

export type CustomerSpend = {
  accounts: number;
  this_year: number;
  last_year: number;
  change: number;
  financial_year: number;
  fy_started: string;
  lifetime: number;
  invoices: number;
  first_billed: string | null;
  last_billed: string | null;
  open_jobs: number;
  open_value: number;
  oldest_open: string | null;
  group_id: string | null;
  group_name: string | null;
};

/**
 * Everything the customer record shows, in one call.
 *
 * A drawer opening five round trips draws in five stages, and a figure
 * that lands after the one beside it gets read as the one beside it.
 * The three detail functions below are for when somebody opens the
 * detail, not for the headline.
 *
 * Returns a row for a customer with no Protean account at all, so the
 * record can say "nothing billed" rather than having to tell an empty
 * result apart from a failed one.
 */
export async function customerSpend(db: Db, contact: string): Promise<CustomerSpend | null> {
  const { data, error } = await db.rpc('protean_customer', {
    p_contact: contact, p_upto: null,
  });
  if (error) throw new Error(error.message);
  return rows<CustomerSpend>(data)[0] ?? null;
}

export type OpenWork = {
  job_no: string;
  job_type: string | null;
  status: string | null;
  depot: string | null;
  logged_on: string | null;
  job_total: number | null;
  equip_no: string | null;
};

export async function openWorkFor(db: Db, contact: string): Promise<OpenWork[]> {
  const { data, error } = await db.rpc('protean_open_work', { p_contact: contact });
  if (error) throw new Error(error.message);
  return rows<OpenWork>(data);
}

export type SpendYear = {
  year: number;
  net: number;
  invoices: number;
  first_billed: string | null;
  last_billed: string | null;
};

export async function spendByYear(db: Db, contact: string): Promise<SpendYear[]> {
  const { data, error } = await db.rpc('protean_spend', { p_contact: contact });
  if (error) throw new Error(error.message);
  return rows<SpendYear>(data);
}

export async function accountsOf(db: Db, contact: string): Promise<AccountLine[]> {
  const { data, error } = await db.rpc('protean_accounts_of', { p_contact: contact });
  if (error) throw new Error(error.message);
  return rows<AccountLine>(data);
}

export async function waitingOnUs(db: Db): Promise<Waiting[]> {
  const { data, error } = await db.rpc('protean_to_moderate');
  if (error) throw new Error(error.message);
  return rows<Waiting>(data);
}

export async function bindAccount(db: Db, alpha: string, contact: string | null) {
  const { error } = await db.rpc('protean_bind', { p_alpha: alpha, p_contact: contact });
  if (error) throw new Error(error.message);
}

export async function makeCustomer(db: Db, alpha: string, name?: string): Promise<string> {
  const { data, error } = await db.rpc('protean_make_customer', {
    p_alpha: alpha, p_name: name ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setAside(db: Db, alpha: string, why: string) {
  const { error } = await db.rpc('protean_ignore', { p_alpha: alpha, p_why: why });
  if (error) throw new Error(error.message);
}

export async function nameGroup(db: Db, name: string): Promise<string> {
  const { data, error } = await db.rpc('name_a_group', { p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function putInGroup(db: Db, contact: string, group: string | null) {
  const { error } = await db.rpc('put_in_group', { p_contact: contact, p_group: group });
  if (error) throw new Error(error.message);
}

export async function forgetGroup(db: Db, group: string) {
  const { error } = await db.rpc('forget_group', { p_group: group });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------
   The import itself.

   Open, then batches, then, for a snapshot, finish. `finish` is the
   step that closes jobs the file stopped mentioning, and it is separate
   on purpose: called per batch, the first slice of a file closes every
   job the later slices are about to confirm.
   ------------------------------------------------------------- */

export async function startImport(
  db: Db, kind: 'invoices' | 'open_jobs', fileName: string,
): Promise<string> {
  const { data, error } = await db.rpc('protean_start_import', {
    p_kind: kind, p_file: fileName,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function sendInvoices(
  db: Db, importId: string, batch: InvoiceRow[],
): Promise<BatchResult> {
  const { data, error } = await db.rpc('protean_take_invoices', {
    p_import: importId, p_rows: batch,
  });
  if (error) throw new Error(error.message);
  return (rows<BatchResult>(data)[0]) ?? {
    rows_read: 0, rows_new: 0, rows_updated: 0, rows_skipped: 0, accounts_new: 0,
  };
}

export async function sendOpenJobs(
  db: Db, importId: string, batch: OpenJobRow[],
): Promise<BatchResult> {
  const { data, error } = await db.rpc('protean_take_open_jobs', {
    p_import: importId, p_rows: batch,
  });
  if (error) throw new Error(error.message);
  return (rows<BatchResult>(data)[0]) ?? {
    rows_read: 0, rows_new: 0, rows_updated: 0, rows_skipped: 0, rows_unmatched: 0,
  };
}

export type WouldClose = {
  would_close: number;
  open_now: number;
  in_this_file: number;
  biggest_job: string | null;
  biggest_value: number;
};

/**
 * What finishing this import off would close, before it closes it.
 *
 * The open jobs export is a snapshot, so anything absent from it is
 * treated as finished. That is right for a whole export and disastrous
 * for a partial one, and nothing in the data tells the two apart. So
 * the figure goes on the screen and a person presses the button.
 */
export async function wouldClose(db: Db, importId: string): Promise<WouldClose> {
  const { data, error } = await db.rpc('protean_would_close', { p_import: importId });
  if (error) throw new Error(error.message);
  return (rows<WouldClose>(data)[0]) ?? {
    would_close: 0, open_now: 0, in_this_file: 0, biggest_job: null, biggest_value: 0,
  };
}

export async function closeWhatWentAway(db: Db, importId: string): Promise<number> {
  const { data, error } = await db.rpc('protean_finish_open_jobs', { p_import: importId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/** Batch results, added up, so a file reads as one number. */
export function addUp(all: BatchResult[]): Required<BatchResult> {
  return all.reduce<Required<BatchResult>>((s, r) => ({
    rows_read: s.rows_read + r.rows_read,
    rows_new: s.rows_new + r.rows_new,
    rows_updated: s.rows_updated + r.rows_updated,
    rows_skipped: s.rows_skipped + r.rows_skipped,
    accounts_new: s.accounts_new + (r.accounts_new ?? 0),
    rows_unmatched: s.rows_unmatched + (r.rows_unmatched ?? 0),
  }), {
    rows_read: 0, rows_new: 0, rows_updated: 0, rows_skipped: 0,
    accounts_new: 0, rows_unmatched: 0,
  });
}
