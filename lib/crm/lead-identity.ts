/* =============================================================
   Who a lead is against.

   ---- The bug this exists because of ----

   The tracker named every row like this:

     company_name: l.account?.company_name ?? 'Unknown company'

   A lead with no account is a supported state and has been since
   migration 040: a pitch with nobody named yet, which is what a price
   built in a meeting produces before somebody makes the CRM record. The
   lead carries the company's name itself, precisely so the row still
   reads. That line never looked at it.

   So every such lead sat on the tracker as "Unknown company" with the
   name in the row it was meant to fill. From the business, on a copied
   FleetSmart+ contract: "it doesn't populate any details in the tracker
   and says unknown customer."

   Nothing caught it because `Lead.contact_id` was typed `string` and
   `company_name` was not on the type at all. Reading the right field
   would not have compiled. Both are corrected in `lib/types.ts`.

   ---- Why this is a module and not two lines in the component ----

   Because there are three states, not two, and the third is the one
   that gets forgotten:

     an account, and a name          the ordinary case
     no account, and a name          a pitch to somebody not in the CRM
     no account, and no name         a lead with nothing on it at all

   The last is the only one that is genuinely unknown, and it is the
   only one that should say so.
   ============================================================= */

/** As much of a lead as naming it needs. */
export type Nameable = {
  contact_id: string | null;
  company_name: string | null;
  account?: { company_name: string | null } | null;
};

export const NO_NAME = 'Unknown company';

/**
 * What to put in the Company column.
 *
 * The ACCOUNT's name wins where there is an account. That is the one
 * kept true by `crm_contacts_rename_leads`, so a company renamed in the
 * CRM is renamed on every one of its leads in the same statement, and
 * preferring the lead's copy would show yesterday's name until
 * something happened to touch the row.
 */
export function nameOfLead(l: Nameable): string {
  const account = l.account?.company_name?.trim();
  if (account) return account;
  const carried = l.company_name?.trim();
  if (carried) return carried;
  return NO_NAME;
}

/**
 * Whether the row is anchored to a customer record.
 *
 * Everything that writes something ALONGSIDE the lead needs this:
 * booking a meeting, listing the other pitches to the same firm,
 * editing a phone number. Those all key on the company, and a lead
 * without one has no company to key on.
 *
 * The tracker's Schedule button used to pass `contact_id` straight into
 * the booking modal, which typechecked only because the type said the
 * column could not be null. Booking against a lead with no account
 * would have written a meeting attached to nobody.
 */
export function hasAnAccount(l: Pick<Nameable, 'contact_id'>): l is Nameable & { contact_id: string } {
  return typeof l.contact_id === 'string' && l.contact_id.length > 0;
}

/** Said once, where the thing that needs an account cannot be offered. */
export const NEEDS_AN_ACCOUNT =
  'This lead has no CRM record behind it yet. Pick or create the account and this fills in.';
