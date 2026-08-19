/* =============================================================
   Turning mapped rows into records, once.

   This was the body of `app/api/crm/import`, which meant the command bar
   could import a file only if somebody wrote the same rules a second
   time: which columns are real, what a missing company name means, where
   a website goes. Two implementations of an import is how one of them
   starts inventing records called Unknown again.

   WHAT IT REFUSES.

   A row with no company name. The old import filled that in with
   "Unknown", which is the single worst thing an import can do: it
   succeeds loudly and leaves rows nobody can identify or clean up.

   WHAT IT IGNORES.

   Anything that is not a column the dictionary can produce. The
   allowlist is built from the same dictionary the mapping screen and the
   sentence reader match against, so a hand rolled request cannot write
   to a column the import was never meant to touch.

   Nothing here decides permission and nothing here writes. Both callers
   gate on `crm.import` and both hand the records to the database.
   ============================================================= */
import { CRM_CONTACTS } from './dictionary';
import { ukToday } from '../format/date';
import type { ContactStatus } from '../types';

const VALID_STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'];

/** Every column the dictionary can legitimately produce. Nothing else lands. */
const ALLOWED = new Set(
  CRM_CONTACTS.fields.map((f) => f.target).filter((t): t is string => Boolean(t)),
);

/** Columns the dictionary names but the contacts table does not hold directly. */
const SYNTHETIC = new Set(['website']);

/** The most rows one file may carry. Split it and import it in parts. */
export const IMPORT_CEILING = 5000;

/** The narrowest slice of the client the write needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type ImportOutcome =
  | { ok: true; inserted: number; listId: string | null }
  | { ok: false; why: string };

/**
 * Write the records, in one transaction.
 *
 * `command_import_contacts` in migration 026, which the command runtime
 * reaches through its capability registry. Both callers land on one
 * transaction, so a database error on row 4,501 leaves zero new
 * customers either way: the route used to insert in chunks of five
 * hundred and report how many had been saved before it failed, which is
 * a different operation with the same name.
 *
 * The screen knows exactly which list is open and says so by id. A
 * sentence knows a name and the function resolves it, exactly, inside
 * the same transaction that does the writing.
 */
export async function commitImport(
  client: Rpc,
  input: { rows: Record<string, unknown>[]; listId?: string | null; listName?: string | null },
): Promise<ImportOutcome> {
  const { data, error } = await client.rpc('command_import_contacts', {
    p_rows: input.rows,
    p_list: input.listName ?? null,
    p_list_id: input.listId ?? null,
  });
  if (error) return { ok: false, why: String((error as { message?: string })?.message ?? error) };

  const body = (data ?? {}) as { inserted?: number; listId?: string };
  return { ok: true, inserted: body.inserted ?? 0, listId: body.listId ?? null };
}

export type PreparedImport = {
  /** Ready to insert, in file order. */
  records: Record<string, unknown>[];
  /** Rows that had no company name to file them under. */
  refused: number;
};

/**
 * Mapped rows, as records.
 *
 * `listId` is optional here because the two callers know it differently:
 * the route has a list open on the screen and the sentence names one by
 * its name, resolved inside the transaction that does the writing.
 */
export function prepareImport(
  rows: unknown[],
  opts: { listId?: string | null; today?: string } = {},
): PreparedImport {
  const records: Record<string, unknown>[] = [];
  let refused = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') { refused += 1; continue; }
    const row = raw as Record<string, unknown>;

    const company = String(row.company_name ?? '').trim();
    if (!company) { refused += 1; continue; }

    const rec: Record<string, unknown> = {
      ...(opts.listId ? { list_id: opts.listId } : {}),
      company_name: company.slice(0, 255),
      source: typeof row.source === 'string' && row.source.trim()
        ? row.source.trim().slice(0, 120)
        : 'Spreadsheet import',
      status: VALID_STATUSES.includes(row.status as ContactStatus)
        ? (row.status as ContactStatus)
        : 'lead',
      date_of_enquiry: row.date_of_enquiry ?? (opts.today ?? ukToday()),
    };

    for (const [key, value] of Object.entries(row)) {
      if (!ALLOWED.has(key) || SYNTHETIC.has(key)) continue;
      if (key in rec) continue;
      if (value === null || value === undefined || value === '') continue;
      rec[key] = value;
    }

    /* A website came through the dictionary as its own field, and the
       table keeps links as one JSON column. */
    if (typeof row.website === 'string' && row.website.trim()) {
      rec.links = [{
        id: crypto.randomUUID(),
        label: 'Website',
        url: row.website.trim(),
        kind: 'website',
      }];
    }

    records.push(rec);
  }

  return { records, refused };
}
