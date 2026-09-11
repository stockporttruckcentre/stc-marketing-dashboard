import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { screenCapabilities } from './resolve';
import { requirementFor } from './route-guard';
import { mayOpen, type Verdict } from './page-guard';
import type { Capabilities } from './catalog';

/* =============================================================
   The gate on a whole screen.

   The sidebar hides what somebody may not open. That is presentation
   and it is not a gate: the address bar is still there, a bookmark
   still works, and a link in a Teams message from a colleague who does
   have the screen still opens it. The audit found eight screens where
   hiding the row was the only thing stopping anybody.

   ---- Two things changed after the evening this was rewritten ----

   1. IT DOES NOT REDIRECT ANY MORE.

      It used to end `if (!caps.has(capability)) redirect('/dashboard')`.
      That treats three different situations as one: the person is
      refused, the lookup failed, or the capability does not exist. All
      three silently dumped somebody on the dashboard, which from the
      outside is indistinguishable from the page being deleted. From the
      business, of exactly that:

        if i manually type /dashboard/revenue in the url it takes me to
        /dashboard/ like the page is just gone

      It returns a verdict now, and the caller draws `<NoAccess>`, which
      says which of the three it was.

   2. IT DOES NOT TAKE A CAPABILITY ANY MORE.

      It reads the requirement from `lib/nav.ts`, the same declaration
      the sidebar reads. A page and its menu row cannot name different
      capabilities, because there is only one name and both read it.
      That is what makes "the row is there and the page throws me out"
      impossible rather than merely unlikely.

   ---- What this still does not do ----

   It does not authorize anything. Every read behind these screens goes
   through row level security and every write through `command_may()` in
   the same transaction, and those remain the authority. This is so that
   somebody who cannot use a screen is told so, rather than shown an
   empty one, which reads as a fault in the product.
   ============================================================= */

export type PageAccess = {
  /** Everything this person may do, for the screen to draw itself with. */
  caps: Capabilities;
  /** Whether the screen may be drawn at all, and if not, why not. */
  verdict: Verdict;
  userId: string;
};

/**
 * Resolve what this person may do, and whether this route opens.
 *
 * `href` is the route as `lib/nav.ts` writes it, which is what ties the
 * guard to the menu row. A route the navigation does not mention needs
 * no capability and says so by returning allowed.
 */
export async function requirePage(
  supabase: SupabaseClient,
  href: string,
  profile?: { role?: string | null } | null,
): Promise<PageAccess> {
  const { data: { user } } = await supabase.auth.getUser();
  /* Not signed in is the one case that still redirects, because there
     is nothing to explain: the answer is the login screen. */
  if (!user) redirect('/login');

  let who = profile;
  if (who === undefined) {
    const { data } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    who = data as { role?: string | null } | null;
  }

  const caps = await screenCapabilities(supabase, who ?? null, user.id);
  const needs = requirementFor(href);

  if (needs.length === 0) return { caps, verdict: { state: 'allowed' }, userId: user.id };

  /* ---- Asked of the database, not of the set ----

     `caps` is built from `capability_report`, and a page guard has to
     agree with the writes behind it, which ask `command_may`. They are
     two functions over the same rules, so they agree unless something
     is wrong, and when something IS wrong this is where it shows rather
     than three screens later. A failed lookup is never a refusal. */
  let refusal: Verdict | null = null;
  for (const capability of needs) {
    const verdict = await mayOpen(supabase, capability);
    if (verdict.state === 'allowed') return { caps, verdict, userId: user.id };
    if (verdict.state === 'failed') return { caps, verdict, userId: user.id };
    refusal = verdict;
  }
  return { caps, verdict: refusal ?? { state: 'refused', capability: needs[0]! }, userId: user.id };
}
