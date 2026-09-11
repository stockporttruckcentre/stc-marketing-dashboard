import type { SupabaseClient } from '@supabase/supabase-js';
import { NAV_ITEMS } from '@/lib/nav';
import type { CrmCapability } from '@/lib/crm/permissions';
import { mayOpen, type Verdict } from './page-guard';

/* =============================================================
   One declaration decides both the menu row and the page guard.

   From the business, after an evening locked out:

     "the next time this happens" shouldn't exist, if permissions are
     done right it's impossible to happen again.

   The sidebar and the pages used to each carry their own idea of what a
   screen needs. `lib/nav.ts` said Revenue needed `revenue.view`, and
   `revenue/screen.tsx` separately said the same thing, and nothing made
   them agree. Two copies of one rule always drift, and the ways they
   drifted were:

     a row offered on one capability, refused by the page on another
     a row hidden by the menu, wide open to anybody who typed the address
     a page with a guard nothing in the menu reflected

   All three of those existed in this application. The audit found eight
   screens of the second kind, where hiding the row was the ONLY thing
   stopping somebody, and the address bar walked straight past it.

   So there is one declaration now, in `lib/nav.ts`, and both the menu
   and the page read it. `guardRoute` is how a page reads it. Nothing is
   repeated, so nothing can disagree, and adding a screen without
   deciding its permission is not possible: there is nowhere to put it
   except the one place the menu already looks.

   `npm run check:permission-wiring` holds that shut.
   ============================================================= */

/**
 * What a route needs, from the single place it is written down.
 *
 * An empty list means everybody signed in, which is a real answer and a
 * deliberate one: the dashboard, settings and the diary are open to
 * anybody with an account, and `lib/nav.ts` says so in as many words.
 */
export function requirementFor(href: string): CrmCapability[] {
  const row = NAV_ITEMS.find((i) => i.href === href);
  if (!row) return [];
  if (row.anyOf) return row.anyOf;
  return row.capability ? [row.capability] : [];
}

/**
 * May this person open this route.
 *
 * Any ONE of the capabilities is enough, which is what `anyOf` means in
 * the menu and therefore what it has to mean here: Admin opens for
 * whoever runs a department as well as for whoever administers
 * accounts, and the two see different tabs once inside.
 *
 * A failed lookup is never treated as a refusal. See `page-guard.ts`
 * for why that distinction is the whole point.
 */
export async function guardRoute(
  supabase: SupabaseClient,
  href: string,
): Promise<Verdict> {
  const needs = requirementFor(href);
  if (needs.length === 0) return { state: 'allowed' };

  let lastRefusal: Verdict | null = null;
  for (const capability of needs) {
    const verdict = await mayOpen(supabase, capability);
    /* One yes is enough. */
    if (verdict.state === 'allowed') return verdict;
    /* A broken lookup stops everything immediately: asking the
       remaining capabilities would fail the same way, and reporting a
       refusal when the system is down is the lie this all exists to
       stop. */
    if (verdict.state === 'failed') return verdict;
    lastRefusal = verdict;
  }
  return lastRefusal ?? { state: 'refused', capability: needs[0]! };
}
