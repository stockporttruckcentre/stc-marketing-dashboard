import { redirect } from 'next/navigation';

/* =============================================================
   Signing yourself up is closed.

   Accounts are asked for on the sign in page and made by an
   administrator. Leaving this route open would have made the approval
   gate a suggestion: anybody with the URL could still create their own
   account, and the whole point of asking first is that a stranger does
   not end up holding one.

   A redirect rather than a delete, because the address has been in
   circulation and a 404 tells somebody the application is broken
   rather than telling them where to go. The Request access link is on
   the page they land on.
   ============================================================= */
export default function SignupClosed() {
  redirect('/login');
}
