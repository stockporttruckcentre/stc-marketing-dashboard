/* =============================================================
   Reading a spreadsheet, the same way twice.

   The dialog hands Papa a File and the command runtime hands it the text
   of one. Those are two calls with the same settings, and the settings
   matter: a header row with trailing spaces is the normal case for an
   Excel export, and a parser configured one way in the browser and
   another on the server would disagree about what the columns are
   called.
   ============================================================= */
import Papa from 'papaparse';

/** What both callers pass. Excel exports carry trailing spaces on headers. */
export const CSV_OPTIONS = {
  header: true as const,
  skipEmptyLines: 'greedy' as const,
  transformHeader: (h: string) => h.trim(),
};

export type ParsedSheet =
  | { ok: true; rows: Record<string, unknown>[]; headers: string[] }
  | { ok: false; why: string };

/** Rows that are entirely blank are not rows. */
export function usableRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
}

/**
 * A sheet, from its text.
 *
 * Used where the file arrives as content rather than as a handle: the
 * command runtime is given the text of what somebody attached, and it
 * has to reach the same columns the dialog would have reached.
 */
export function readSheet(text: string): ParsedSheet {
  const res = Papa.parse<Record<string, unknown>>(text, CSV_OPTIONS);
  const rows = usableRows((res.data ?? []) as Record<string, unknown>[]);
  const headers = (res.meta?.fields ?? []).filter((h) => h && h.trim() !== '');

  if (!headers.length || !rows.length) {
    return {
      ok: false,
      why: 'that file has no readable header row and rows underneath it. '
        + 'If it came from Excel, save it as CSV first.',
    };
  }
  return { ok: true, rows, headers };
}
