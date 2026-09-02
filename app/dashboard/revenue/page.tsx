import { redirect } from 'next/navigation';

/* Revenue is two screens now, one per division, so the bare path sends
   people to the bigger of the two rather than showing a third page that
   exists only to hold two links. */
export default function RevenueIndex() {
  redirect('/dashboard/revenue/stc');
}
