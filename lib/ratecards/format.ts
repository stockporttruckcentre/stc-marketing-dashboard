/* =============================================================
   How a rate card's numbers are written down.

   One module, because the screen, the preview and the exported workbook
   all have to say the same thing about the same rate, and three
   implementations of "round it to two decimals" is three answers.
   ============================================================= */

/** Half up to two decimals, at display and at export, per the pack. */
export function round2(n: number): number {
  /* `Math.round` is half up for positives and half DOWN for negatives,
     and a negative rate is refused before it gets here, but the epsilon
     matters for its own reason: 1.005 is stored as 1.00499999... and
     rounds to 1.00 without it. */
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return `£${round2(n).toFixed(2)}`;
}

/** The plain number, for a cell in the workbook rather than a screen. */
export function money2(n: number | null | undefined): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return round2(n);
}

/* ---- Hours, and why they are not always two decimals ----

   The kit's workings column reads "1.85h × £85.00". Those hours were
   back-calculated from the signed KNDS card and rounded to two
   decimals, and at two decimals 1.85 × 85 is 157.25, while the signed
   card says 157.50. Printing the rounded hours beside the right price
   is an arithmetic error on the face of the document: a salesman who
   checks it finds the tool wrong.

   So hours are stored at full precision and printed at the precision
   that actually reproduces the price, up to four decimals. Most rates
   still read 1.20h. The ones that cannot read 1.8529h, which is true,
   rather than 1.85h, which is not. */
export function hours(h: number | null | undefined): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '';
  for (const dp of [2, 3, 4]) {
    const shown = Number(h.toFixed(dp));
    /* Enough decimals that what is printed, times any labour rate,
       lands on the same penny as the stored hours would. */
    if (Math.abs(shown - h) < 0.000005) return `${shown.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '')}h`;
  }
  return `${h.toFixed(4)}h`;
}

/** "1.8529h × £85.00", the workings the kit prints beside a derived rate. */
export function workings(h: number | null, labour: number | null): string {
  if (h === null || labour === null) return '';
  return `${hours(h)} × ${money(labour)}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "2 min ago", for the saved indicator. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The two letter disc on a hub row. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** What a card's status is called on screen. */
export const STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  awaiting: 'Awaiting approval',
  approved: 'Live',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
};

/** The five fields the CRM could not fill in, in the words a person uses. */
export const MISSING_WORDS: Record<string, string> = {
  main_contact: 'Main contact',
  address: 'Address',
  telephone: 'Telephone',
  email: 'Email',
  account_manager: 'Account manager',
};
