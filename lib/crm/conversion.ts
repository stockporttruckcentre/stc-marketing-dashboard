/* =============================================================
   A prospect becomes a customer when you win something.

   ---- The flow this exists for ----

   From the business, describing how Tom works:

     he has a conversation with a customer, creates a crm record to store
     their details as a prospect, creates a lead for whatever work he's
     trying to win, then when the lead is won he marks it as won, the
     customer now changes to an active account and he can continue from
     there.

   Two columns on `crm_contacts` answer two different questions and the
   application was only moving one of them:

     status        where the furthest deal has got to. Derived from the
                   leads by `crm_account_follows_its_leads`, migration
                   043, and not writable by hand.
     relationship  whether this firm has ever traded with us. Written by
                   hand, and by that same trigger, but only at the moment
                   a lead reaches `customer`.

   So marking a lead `won` moved the account's status to won and left the
   relationship saying prospect. The record every report and every filter
   reads as "not a customer yet" was a firm that had just agreed a deal.
   `won` is the word a rep uses at the moment of the handshake; `customer`
   is where the record gets to weeks later once the thing is delivered.
   Waiting for the second one is what lost the conversion.

   ---- Why it asks rather than doing it ----

   Because "won" is sometimes provisional and the person marking it is
   the only one who knows. A verbal yes on a quote gets marked won and
   occasionally comes back. Converting the account silently would move
   a firm into the customer base on somebody's optimism, and moving it
   back is not a button anybody wants to look for.

   The ask happens once per lead, at the moment it is won, and only when
   the account is still a prospect. Answering no leaves them a prospect
   and the Relationship control on the record does it later.
   ============================================================= */
import type { SupabaseClient } from '@supabase/supabase-js';

/** What a record's `relationship` column can say. Migration 004. */
export type Relationship = 'prospect' | 'existing';

/**
 * Should winning this lead offer to convert the customer.
 *
 * Only on the way IN to won. A lead that is already won and gets its
 * value corrected is not a fresh handshake, and being asked the same
 * question every time you touch the row is how people learn to dismiss
 * dialogs without reading them.
 */
export function winsAProspect(
  before: string | null | undefined,
  after: string | null | undefined,
  relationship: string | null | undefined,
): boolean {
  if (after !== 'won') return false;
  if (before === 'won') return false;
  return (relationship ?? 'prospect') === 'prospect';
}

/**
 * Make them an active account.
 *
 * Only `relationship`. The account's `status` is derived from its leads
 * and writing it here would be overwritten by the trigger on the next
 * lead change, which is worse than not writing it: it would look right
 * until it silently was not.
 */
export async function convertToCustomer(
  supabase: SupabaseClient,
  contactId: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const { error } = await supabase
    .from('crm_contacts')
    .update({ relationship: 'existing' })
    .eq('id', contactId);
  if (error) return { ok: false, why: error.message };
  return { ok: true };
}

/**
 * The relationship on one account, read fresh.
 *
 * The tracker carries a flattened copy of a few account fields on every
 * row, and that copy is as old as the page. Asking the question at the
 * moment it matters costs one round trip and is the difference between
 * offering to convert somebody who was converted an hour ago by
 * somebody else.
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
