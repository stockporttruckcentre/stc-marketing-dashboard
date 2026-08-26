import { GuestAnswer } from '@/components/calendar/guest-answer';

export const dynamic = 'force-dynamic';

/* =============================================================
   Where a guest answers.

   Public, because the person reading it is a customer with no account
   here and no reason to have one. The token in the address is the whole
   of what says who they are, and `calendar_guest_answer` in migration
   062 is what checks it: this page holds no session and asks for none.

   ---- What it deliberately does not show ----

   Anything about STC beyond the meeting. Not the other people on it,
   not the customer record, not the note somebody wrote for colleagues,
   not a way into anything else. A link that arrived in an inbox is not
   a way into the CRM, and the function behind this returns the meeting
   and the organiser's name and stops.

   ---- Why it is in the kit ----

   It is the only screen a customer of STC will ever see, so it is the
   one that has to look like the company. The kit is what the company
   looks like now.
   ============================================================= */

export default function InvitationPage({ params }: { params: { token: string } }) {
  return <GuestAnswer token={params.token} />;
}
