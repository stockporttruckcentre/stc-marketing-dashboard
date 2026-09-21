import type { BatchResult } from './rpc';

/* ---- What happened to this file, in a sentence ----

   From the business, reading "New 0, Updated 382, Left out 0" after
   importing a file for the second time:

     The message in the app says all 382 invoices ignored, clearly a
     broken notification. These things need fixing if they're broken,
     not just explaining to me.

   The figures were accurate and unreadable. "Updated" is what the
   database did; it is not what a person needs to know, and next to a
   zero in "New" it reads as the import having refused the file.

   So the figures stay, and a sentence goes above them saying which of
   the four things actually happened. */
export function whatHappened(r: BatchResult, kind: 'invoices' | 'open_jobs', earlier: string | null): string {
  const n = (v: number) => v.toLocaleString('en-GB');
  const thing = kind === 'invoices' ? 'invoice' : 'job';
  const plural = kind === 'invoices' ? 'invoices' : 'jobs';

  if (r.rows_new === 0 && r.rows_updated > 0) {
    return `Every one of these ${n(r.rows_updated)} ${plural} was already on the system`
      + `${earlier ? `, from the import at ${earlier}` : ''}. Nothing was added and nothing `
      + `was duplicated. Their figures were refreshed from this file.`;
  }
  if (r.rows_new > 0 && r.rows_updated > 0) {
    return `${n(r.rows_new)} ${r.rows_new === 1 ? `${thing} was` : `${plural} were`} new. `
      + `${n(r.rows_updated)} ${r.rows_updated === 1 ? 'was' : 'were'} already on the system, `
      + `so ${r.rows_updated === 1 ? 'it was' : 'they were'} refreshed rather than added again. `
      + `That is normal when a file covers dates you have already loaded.`;
  }
  if (r.rows_new > 0) {
    return `All ${n(r.rows_new)} ${plural} were new to the system.`;
  }
  return `None of the ${n(r.rows_skipped)} ${r.rows_skipped === 1 ? 'row' : 'rows'} in this file `
    + `could be used. A row is left out when it has no ${thing} number, no account code, `
    + `no date or no figure on it.`;
}

