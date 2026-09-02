/* =============================================================
   How far back an export goes.

   Pulled out of the wizard because it is arithmetic on dates that ends
   up in a spreadsheet a finance team acts on, and arithmetic on dates
   inside a component is arithmetic nothing can check.

   ---- What a period does and does not do ----

   It filters the ROWS: which invoices, which jobs. It does NOT change
   what "this year" means. Every revenue figure on the screen is
   measured from the start of the company's year, and a three month
   export showing a three month "year to date" is two people quoting
   different numbers from the same file.
   ============================================================= */

export type PeriodKey = 'fy' | '3' | '6' | '12' | 'all';

export const PERIODS: { key: PeriodKey; label: string; months: number | null }[] = [
  { key: 'fy', label: 'This financial year to date', months: null },
  { key: '3', label: 'The last 3 months', months: 3 },
  { key: '6', label: 'The last 6 months', months: 6 },
  { key: '12', label: 'The last 12 months', months: 12 },
  { key: 'all', label: 'Everything we hold', months: 0 },
];

export type Window = { from: string | null; to: string; label: string };

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const nice = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

/**
 * The window a period means, said out loud before anything is exported.
 *
 * `from` of null means everything we hold, which is different from a
 * window that happens to start at the beginning: one is "no filter" and
 * the other is a filter that lets everything through today and will not
 * next year.
 */
export function exportWindow(
  period: PeriodKey,
  fyStarted: string | null,
  today: Date = new Date(),
): Window {
  const spec = PERIODS.find((p) => p.key === period) ?? PERIODS[0]!;
  const to = iso(today);

  if (spec.months === 0) return { from: null, to, label: 'everything we hold' };

  if (spec.months === null) {
    return {
      from: fyStarted,
      to,
      label: fyStarted ? `${nice(fyStarted)} to today` : 'this year',
    };
  }

  /* Calendar months back, not thirty day blocks. "The last 3 months" on
     31 May means from 28 February, because a person asking for three
     months means three months and not ninety days.
     
     Setting the month on a 31st rolls into the next month when the
     target is shorter, so the day is pinned first. */
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  from.setMonth(from.getMonth() - spec.months);
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  from.setDate(Math.min(today.getDate(), lastDay));

  return { from: iso(from), to, label: `${nice(iso(from))} to today` };
}

/** Whether a date falls inside a window. No date means it is not filtered out. */
export function inWindow(d: string | null | undefined, w: Window): boolean {
  if (!d) return true;
  if (w.from && d < w.from) return false;
  if (w.to && d > w.to) return false;
  return true;
}
