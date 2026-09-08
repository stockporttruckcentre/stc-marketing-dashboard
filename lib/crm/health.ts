/* =============================================================
   Where an account stands, in one place.

   From the business:

     Red Amber Green system needs adding to CRM drawer to add
     complaints/slowness. When marked Amber - potential issue,
     slowness/etc. Add a button to alert the account manager(s) manually
     with the reason. Red would alert them automatically.

   The database half is migration 099. This is the vocabulary the
   screens share, so the drawer, the grid and the reports cannot
   disagree about what amber means or which colour it is.
   ============================================================= */
import type { Tone } from '@/components/kit/primitives';

export type Health = 'green' | 'amber' | 'red';

export const HEALTH_LEVELS: Health[] = ['green', 'amber', 'red'];

export const HEALTH_LABEL: Record<Health, string> = {
  green: 'Fine',
  amber: 'Watch',
  red: 'Problem',
};

/**
 * What each level is for, in the words the business used for it.
 *
 * On the control itself rather than in a help page. The difference
 * between amber and red is a judgement somebody makes in four seconds
 * while a customer is still on the phone, and the only place a
 * definition helps is next to the button.
 */
export const HEALTH_BLURB: Record<Health, string> = {
  green: 'Nothing outstanding',
  amber: 'Slowness, a niggle, something to watch',
  red: 'A complaint, or something that will cost us the account',
};

/* Red is the danger token and amber is warning, which is the kit's own
   pair for exactly this. Green is `success` rather than a green of its
   own: the four rules say red points at the one important thing, and a
   grid where every fine account glows is a grid where the red ones do
   not stand out. */
export const HEALTH_TONE: Record<Health, Tone> = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
};

/**
 * How the dot column sorts.
 *
 * Worst first, because that is the only order anybody wants when they
 * click that header: "show me what is wrong" is the question, and a
 * sort that opens with two hundred fine accounts has not answered it.
 * Ascending in this list is descending in severity, deliberately, so
 * the first click on the header does the useful thing.
 */
export const HEALTH_ORDER: Health[] = ['red', 'amber', 'green'];

export function healthRank(h: Health | null | undefined): number {
  const at = HEALTH_ORDER.indexOf((h ?? 'green') as Health);
  return at === -1 ? HEALTH_ORDER.length : at;
}

/** The cooldown before a chase goes out, in WORKING days. Migration 099. */
export const CHASE_AFTER_WORKING_DAYS: Record<Exclude<Health, 'green'>, number> = {
  red: 3,
  amber: 7,
};

/**
 * Working days between two dates, England and Wales.
 *
 * The same rule as `working_days_since` in migration 099, in TypeScript,
 * so a screen can say "chase due in two days" without a round trip. The
 * database is the authority on whether a chase actually goes out; this
 * is for telling somebody what is about to happen.
 *
 * The holidays are passed in rather than hardcoded here. There is one
 * list, it is a table, and a second copy in a bundle that ships to the
 * browser is a second list to keep in step.
 */
export function workingDaysBetween(
  from: Date,
  to: Date,
  holidays: ReadonlySet<string>,
): number {
  let days = 0;
  const at = new Date(from);
  at.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);

  /* From the day AFTER it happened, which is what anybody in an office
     means: something raised on Friday afternoon is one working day old
     on Monday, not two. */
  at.setDate(at.getDate() + 1);
  while (at <= end) {
    const day = at.getDay();
    const iso = at.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidays.has(iso)) days += 1;
    at.setDate(at.getDate() + 1);
  }
  return days;
}

/** One line for the drawer: how long it has been, and what happens next. */
export function chaseWords(
  level: Health,
  workingDaysQuiet: number,
): string {
  if (level === 'green') return '';
  const due = CHASE_AFTER_WORKING_DAYS[level];
  const left = due - workingDaysQuiet;
  if (left <= 0) {
    return `Quiet ${workingDaysQuiet} working day${workingDaysQuiet === 1 ? '' : 's'}. `
      + 'A chase is due: the account managers get a notification and a task.';
  }
  if (left === 1) return 'A chase goes out tomorrow unless something moves.';
  return `A chase goes out in ${left} working days unless something moves.`;
}
