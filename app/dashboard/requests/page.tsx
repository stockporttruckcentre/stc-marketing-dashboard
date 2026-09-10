import { redirect } from 'next/navigation';

/* =============================================================
   Where the Access screen went.

   It was a nineteenth sidebar row, and it was a second copy of a tab
   Admin had carried all along. From the business:

     access tab done meaning what. what is access tab. we were already
     at the sidebar tab limit.

     on admin within the Requests tab. Still bound to notifs. All users
     who can manage a request see Admin with only what they need to
     access on the non-requests tab(s).

   So Admin appears for `admin.users` OR `access.decide`, and its tabs
   are gated one at a time: Sr Sales opens it and finds Requests alone.

   ---- Why this file still exists ----

   Every access notification already sent carries `/dashboard/requests`
   in its link. Those rows are in the database and a migration cannot
   reach into a notification somebody has already been handed. Deleting
   the route would turn each of them into a 404, which is the same fault
   as the dead links the sweep found, introduced deliberately.

   Migration 105 writes the new link for anything raised from here on.
   ============================================================= */
export default function RequestsPage() {
  redirect('/dashboard/admin?tab=requests');
}
