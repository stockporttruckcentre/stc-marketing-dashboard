/* =============================================================
   Winning work is what makes somebody a customer.

   ---- The flow this exists for ----

   From the business, describing how Tom works:

     he has a conversation with a customer, creates a crm record to store
     their details as a prospect, creates a lead for whatever work he's
     trying to win, then when the lead is won he marks it as won, the
     customer now changes to an active account and he can continue from
     there.

   Two columns on `crm_contacts` answer two different questions:

     status        where the furthest deal has got to. Derived from the
                   leads by `crm_account_follows_its_leads`, migration
                   043, and not writable by hand.
     relationship  whether this firm has ever traded with us.

   ---- What changed, and why this file is now three lines ----

   There used to be a THIRD thing: a lead status called `customer`,
   sitting past `won`, and a dialog on the tracker asking whether to
   convert the company at the moment a deal was won. Answering yes set
   the relationship; answering no left it.

   From the business:

     when marking a sales tracker record as Won (just closed) it doesn't
     seem to do much. Then we have a status for Customer, which means
     won anyway. We only need 1 status, Won. This then assumes the
     company is now a customer of ours so anywhere else in the app
     tracking who our customers are will pick this up.

   Both halves of that were true. Nearly every figure in the application
   counted `customer` rather than `won`, so a rep who marked a deal won
   saw nothing move; and being asked a question at the moment of a win
   is one more thing to get wrong.

   So migration 146 took the extra status out and moved the conversion
   into the database, onto the trigger that already watched lead status.
   Winning any deal sets the company's relationship to `existing`, in
   the same transaction, whoever or whatever won it: the tracker, the
   command bar, a FleetSmart+ contract being accepted, an import.

   `winsAProspect` and `convertToCustomer` used to live here. They are
   gone rather than deprecated, because a second way of doing it is how
   two answers to one question start again.
   ============================================================= */
import type { SupabaseClient } from '@supabase/supabase-js';

/** What a record's `relationship` column can say. Migration 004. */
export type Relationship = 'prospect' | 'existing';

/**
 * The relationship on one account, read fresh.
 *
 * The tracker carries a flattened copy of a few account fields on every
 * row, and that copy is as old as the page. The screen uses this to
 * report what winning a deal actually did, rather than to assume it:
 * telling somebody their customer is now an active account when the
 * write was refused is worse than saying nothing.
 */
export async function relationshipOf(
  supabase: SupabaseClient,
  contactId: string,
): Promise<Relationship | null> {
  const { data } = await supabase
    .from('crm_contacts').select('relationship').eq('id', contactId).maybeSingle();
  if (!data) return null;
  return ((data as { relationship: string | null }).relationship ?? 'prospect') as Relationship;
}
