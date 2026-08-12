/* =============================================================
   Dates, always in UK time.

   The bug this exists to stop: `toLocaleString('en-GB')` formats in
   whatever timezone the code happens to be running in. In the browser
   that is the user's, which looks right. On the server it is the host's,
   which on Vercel is UTC, so an export generated at 17:06 BST was
   stamped 16:06 and nobody could tell whether the clock or the data was
   wrong.

   Every date shown to a person goes through here. The zone is pinned
   rather than inherited, so it stays correct when this moves onto your
   own servers, whatever those are set to, and it handles the BST and GMT
   switch on its own.

   The business is in Stockport. There is no second timezone to support,
   and if that ever changes this is the one file that needs to know.
   ============================================================= */

export const UK = 'Europe/London';

type In = Date | string | number | null | undefined;

function toDate(v: In): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 17 August 2026 */
export function ukDate(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-GB', { timeZone: UK, day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** 17 Aug 2026 */
export function ukDateShort(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-GB', { timeZone: UK, day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** 17 Aug 2026, 17:06 */
export function ukDateTime(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleString('en-GB', {
    timeZone: UK, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '';
}

/** Monday 17 August 2026, 17:06. For anything with a sense of occasion. */
export function ukDateTimeLong(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleString('en-GB', {
    timeZone: UK, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '';
}

/** Mon 17 Aug, 17:06. The compact form for lists and rows. */
export function ukDayTime(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleString('en-GB', {
    timeZone: UK, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }) : '';
}

/** 17:06 */
export function ukTime(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleTimeString('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit' }) : '';
}

/**
 * Today, Yesterday, 3d ago, then a date. Used where recency matters more
 * than the exact stamp. Day boundaries are counted in UK time, so
 * something logged at 00:30 BST reads as today rather than yesterday.
 */
export function ukRelativeDay(v: In): string {
  const d = toDate(v);
  if (!d) return '';
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: UK });   // yyyy-mm-dd
  const days = Math.round(
    (Date.parse(key(new Date())) - Date.parse(key(d))) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days}d ago`;
  return ukDateShort(d);
}

/** yyyy-mm-dd in UK time, for date columns. Not the UTC slice of an ISO string. */
export function ukDateInput(v: In): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-CA', { timeZone: UK }) : '';
}

/** Today as yyyy-mm-dd in UK time. */
export function ukToday(): string {
  return ukDateInput(new Date());
}
