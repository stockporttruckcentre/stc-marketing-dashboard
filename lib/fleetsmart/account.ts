/* =============================================================
   What the CRM already knows about a customer, on its way into a
   contract.

   Picking an account in the builder used to fill three things: the
   company name, the contact name and `crm_contacts.location`. That last
   one is a town, so the Address box came out reading "Stockport" and
   somebody typed the rest of it by hand, on every contract, for a
   customer whose address is already on file.

   ---- Three places an address can be, in order ----

   1. `contact_addresses`, the primary row. Structured, geocoded, and the
      one the CRM record itself shows. `address` and `city` are separate
      columns there, so they are joined back into one block here.
   2. `crm_contacts.address`, free text, from before there was a table
      for it.
   3. `crm_contacts.location`, which is a town and is the last resort
      rather than the answer.

   The best one that is actually filled in wins. Nothing invents a
   postcode and nothing overwrites something already typed into the
   builder, because a contract prints what is in the box.

   ---- Why this is a module and not four lines in the wizard ----

   The same fill runs from the page's server read and from the picker's
   click, and a second copy is how one of them ends up a field behind.
   ============================================================= */

/** One account as the builder's picker sees it. */
export type PickableAccount = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  location: string | null;
  /** Free text address on the account itself. */
  address: string | null;
  email: string | null;
  phone: string | null;
  /** The primary row from `contact_addresses`, where there is one. */
  primary_address: string | null;
  primary_city: string | null;
};

/** The narrow account columns the builder needs, as a PostgREST select.

   No company number: the CRM has no column for one. It stays a typed
   field on the builder, and adding the column later is the only change
   needed to fill it from here as well. */
export const ACCOUNT_COLUMNS =
  'id, company_name, contact_name, location, address, email, phone';

/**
 * The best address the CRM holds for this account, as a block ready to
 * print, or an empty string when it holds none.
 *
 * Lines rather than commas: the contract sets it in a block, and a
 * postcode on its own line is how an address is written on a letter.
 */
export function addressOf(a: PickableAccount): string {
  const structured = [a.primary_address, a.primary_city]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);

  if (structured.length > 0) {
    /* `address` on that table is often already multi-line. Splitting and
       rejoining drops the blank lines a paste leaves behind and stops
       the city being repeated where somebody typed it into both. */
    const lines = structured
      .join('\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    return lines.filter((l) => {
      const key = l.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join('\n');
  }

  if ((a.address ?? '').trim()) return (a.address as string).trim();
  return (a.location ?? '').trim();
}

/**
 * What picking this account fills in, given what is already typed.
 *
 * Every field falls back to what is there rather than replacing it, so
 * somebody who typed an address and then attached an account keeps their
 * address. Picking a second account over the first is the one case where
 * that reads oddly, and it is the right trade: losing typing is worse
 * than keeping a stale line somebody can see and change.
 */
export function fillFrom(a: PickableAccount, current: {
  customerName: string;
  customerContact: string;
  customerAddress: string;
}): {
  customerName: string;
  customerContact: string;
  customerAddress: string;
} {
  return {
    customerName: a.company_name?.trim() || current.customerName,
    customerContact: a.contact_name?.trim() || current.customerContact,
    customerAddress: addressOf(a) || current.customerAddress,
  };
}

/**
 * A one line summary of what the builder just filled in, for the line
 * under the picker.
 *
 * Somebody who cannot see what was taken from the CRM checks every
 * field by hand anyway, which is the time this was supposed to save.
 */
export function filledWords(a: PickableAccount): string {
  const got: string[] = [];
  if (a.company_name?.trim()) got.push('name');
  if (a.contact_name?.trim()) got.push('contact');
  if (addressOf(a)) got.push('address');
  if (a.email?.trim()) got.push('email');
  if (a.phone?.trim()) got.push('phone');

  if (got.length === 0) return 'The CRM holds nothing else about them, so the rest is typed.';
  if (got.length === 1) return `Filled the ${got[0]} from the CRM.`;
  return `Filled the ${got.slice(0, -1).join(', ')} and ${got[got.length - 1]} from the CRM.`;
}
