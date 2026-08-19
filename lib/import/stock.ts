/* =============================================================
   The supplier's stock file, turned into trailers, once.

   This was the body of `commitStockImport` inside `components/StockList`,
   which meant the command bar could load a stock file only if somebody
   wrote the same rules a second time: which columns are real, what a row
   with no stock number means, what status a new unit starts at.

   WHAT IT REFUSES.

   A row with no stock number. That is the dictionary's required field
   and the only thing that identifies a unit. A row without one cannot be
   found again and cannot be matched the next time the supplier sends a
   file, which is the stock list's version of the Unknown customer the
   CRM import was fixed for.

   WHAT IT IGNORES.

   Anything that is not a column the STOCK_TRAILERS dictionary can
   produce. The allowlist is built from the same dictionary the import
   dialog and the sentence reader match against, and the database checks
   it again against `command_writable_columns`, so a hand rolled request
   naming `profit` is refused twice rather than writing a number nobody
   can explain.

   Nothing here decides permission and nothing here writes. Both callers
   gate on `stock.edit` and both hand the records to the database.
   ============================================================= */
import { STOCK_TRAILERS } from './dictionary';

/** Every column the dictionary can legitimately produce. Nothing else lands. */
const ALLOWED = new Set(
  STOCK_TRAILERS.fields.map((f) => f.target).filter((t): t is string => Boolean(t)),
);

/** What a unit nobody has said anything else about is. */
export const DEFAULT_STATUS = 'in_stock';

/** The most rows one file may carry. Split it and import it in parts. */
export const STOCK_CEILING = 5000;

/** The narrowest slice of the client the write needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type StockImportOutcome =
  | { ok: true; inserted: number }
  | { ok: false; why: string };

/**
 * Write the trailers, in one transaction.
 *
 * `command_import_stock` in migration 031, which the command runtime
 * reaches through its capability registry. The screen used to insert
 * straight from the browser, which put the allowlist and the permission
 * in code somebody can edit in a console, and had no answer at all for a
 * failure halfway down a supplier's file.
 */
export async function commitStockImport(
  client: Rpc, rows: Record<string, unknown>[],
): Promise<StockImportOutcome> {
  const { data, error } = await client.rpc('command_import_stock', { p_rows: rows });
  if (error) return { ok: false, why: String((error as { message?: string })?.message ?? error) };

  const body = (data ?? {}) as { inserted?: number };
  return { ok: true, inserted: body.inserted ?? 0 };
}

export type PreparedStock = {
  /** Ready to insert, in file order. */
  records: Record<string, unknown>[];
  /** Rows that had no stock number to identify them by. */
  refused: number;
};

/** Mapped rows, as trailers. */
export function prepareStock(rows: unknown[]): PreparedStock {
  const records: Record<string, unknown>[] = [];
  let refused = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') { refused += 1; continue; }
    const row = raw as Record<string, unknown>;

    const stc = String(row.stc_no ?? '').trim();
    if (!stc) { refused += 1; continue; }

    const rec: Record<string, unknown> = {
      stc_no: stc.slice(0, 120),
      status: DEFAULT_STATUS,
    };

    for (const [key, value] of Object.entries(row)) {
      if (!ALLOWED.has(key)) continue;
      if (key === 'stc_no') continue;
      if (value === null || value === undefined || value === '') continue;
      rec[key] = value;
    }

    records.push(rec);
  }

  return { records, refused };
}
