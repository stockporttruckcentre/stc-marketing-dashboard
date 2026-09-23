/* =============================================================
   The hire a trailer deal is, in the words the business uses for it.

   ---- Where these came from ----

   From the business, listing what a trailer deal's drawer has to hold:

     Date the equipment went on hire & estimated Off hire date; Term
     length; Rate £; Service cycle; [...] NET/NET / R&M / Full R&M +
     Tyres as a drop down box

   The three cover levels are theirs, spelled as they spelled them. The
   slugs underneath are ours, so the wording on the screen can be
   corrected without a migration and without every existing row having
   to be rewritten to match.

   ---- Why the service cycle is a suggestion and not an enum ----

   A service cycle is an interval, and the interval a customer is on is
   whatever was agreed with them: six weekly, thirteen weekly, 25,000km,
   "in line with their own schedule". A fixed list would be wrong the
   first week somebody agreed something not on it, and a wrong list is
   worse than free text because the person typing has to pick the
   nearest lie.

   So it is free text with the common ones offered, which is what the
   `what` field on a maintenance lead already does.
   ============================================================= */
import type { MaintenanceCover } from '@/lib/types';

/** In the order the business listed them. */
export const MAINTENANCE_COVERS: MaintenanceCover[] = ['net_net', 'rm', 'full_rm_tyres'];

export const COVER_LABEL: Record<MaintenanceCover, string> = {
  net_net:       'NET/NET',
  rm:            'R&M',
  full_rm_tyres: 'Full R&M + Tyres',
};

export const COVER_HINT: Record<MaintenanceCover, string> = {
  net_net:       'They carry the maintenance. We hire the equipment and nothing else.',
  rm:            'Repair and maintenance included. Tyres are theirs.',
  full_rm_tyres: 'Repair, maintenance and tyres, all in the rate.',
};

/**
 * The cover level in words, or the honest blank.
 *
 * A deal nobody has been asked about reads "Not set yet" rather than
 * defaulting to NET/NET, because the cheapest cover is exactly the one
 * a wrong default would quietly put on an order form.
 */
export function coverLabel(v: MaintenanceCover | string | null | undefined): string | null {
  if (!v) return null;
  return COVER_LABEL[v as MaintenanceCover] ?? String(v);
}

/** The intervals people actually agree, offered rather than enforced. */
export const SERVICE_CYCLES = [
  '6 weekly',
  '8 weekly',
  '10 weekly',
  '13 weekly',
  '26 weekly',
  'Annual',
  'In line with their own schedule',
];

/**
 * A term in months, said the way somebody would say it.
 *
 *   12  -> "12 months"
 *   24  -> "24 months (2 years)"
 *   18  -> "18 months"
 *
 * The years are in brackets rather than instead, because a contract is
 * written in months and the months are the number on the paperwork.
 */
export function termLabel(months: number | null | undefined): string | null {
  if (months == null || !Number.isFinite(months) || months <= 0) return null;
  const n = Math.round(months);
  if (n % 12 === 0 && n >= 24) return `${n} months (${n / 12} years)`;
  if (n === 12) return '12 months (1 year)';
  return `${n} month${n === 1 ? '' : 's'}`;
}

/**
 * The term the two dates imply, in whole months.
 *
 * Offered as a fill-in when somebody has entered the dates and not the
 * term. It is NOT written on their behalf: a term of 11 months because
 * the off hire estimate is three days early is the kind of quiet wrong
 * number that ends up on an order form.
 */
export function termFromDates(
  onHire: string | null | undefined,
  offHire: string | null | undefined,
): number | null {
  if (!onHire || !offHire) return null;
  const a = new Date(onHire);
  const b = new Date(offHire);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b < a) return null;
  const months = (b.getFullYear() - a.getFullYear()) * 12
    + (b.getMonth() - a.getMonth())
    + (b.getDate() >= a.getDate() ? 0 : -1);
  return months > 0 ? months : null;
}

/** A vendor's address on one line, skipping the parts nobody filled in. */
export function vendorAddress(v: {
  address_line1?: string | null; address_line2?: string | null;
  city?: string | null; postcode?: string | null;
} | null | undefined): string | null {
  if (!v) return null;
  const parts = [v.address_line1, v.address_line2, v.city, v.postcode]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
