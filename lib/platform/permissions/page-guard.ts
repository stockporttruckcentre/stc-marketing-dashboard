import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrmCapability } from '@/lib/crm/permissions';

/* =============================================================
   Whether a page may be opened, and when it may not, WHY.

   ---- The evening this exists because of ----

   From the business, with the managing director stood behind them:

     i cant get on the analytics page too whats happening [...] I cannot
     open any of the fucking pages in the app, i am locked out of my own
     app, every page.

   Four pages guard themselves, and all four did the same thing:

     const { data: may } = await supabase.rpc('command_may', { ... });
     if (may !== true) redirect('/dashboard');

   Read that carefully. `data` is null when the call FAILS as well as
   when the answer is no, and `null !== true`. So a database that
   refused the person and a database that could not be asked at all
   produced the identical outcome: a silent bounce to the dashboard,
   with nothing said, nothing logged, and no way to tell the two apart
   from the outside.

   That is why an hour went into granting permissions that were never
   the problem. The screen could not say "you do not have this" versus
   "I could not find out", so neither could anybody looking at it.

   ---- What this returns instead ----

   Three outcomes, not two:

     allowed   the person holds it. Draw the page.
     refused   the database answered, and the answer was no.
     failed    the database could not answer, and here is what it said.

   A refusal is a normal fact about permissions and the caller may send
   somebody away for it. A failure is a broken system, and the caller
   must NOT dress it up as a refusal: it says so on screen, with the
   reason, so the next evening like that one lasts a minute.
   ============================================================= */

export type Verdict =
  | { state: 'allowed' }
  | { state: 'refused'; capability: CrmCapability }
  | { state: 'failed'; capability: CrmCapability; because: string };

/**
 * Ask the database whether this person holds a capability.
 *
 * `command_may` resolves an override, then the role template, then the
 * legacy role, inside the database, in the same place every write on
 * every screen is checked. Asking it here is what keeps a page and the
 * writes behind it agreeing.
 */
export async function mayOpen(
  supabase: SupabaseClient,
  capability: CrmCapability,
): Promise<Verdict> {
  const { data, error } = await supabase.rpc('command_may', { p_capability: capability });

  if (error) {
    /* Not a refusal. Something is wrong with the lookup itself: the
       function is missing, the signed-in account cannot execute it, or
       the request carried no session. Each of those is a different
       repair and none of them is "grant them the permission", which is
       the wrong tree a whole evening was spent barking up. */
    return { state: 'failed', capability, because: error.message };
  }

  /* A successful call that answers anything other than true or false is
     also not a refusal. `command_may` returns a boolean, so null here
     means the row came back empty, which happens when the function
     exists under a different signature. */
  if (data === true) return { state: 'allowed' };
  if (data === false) return { state: 'refused', capability };
  return {
    state: 'failed',
    capability,
    because: `command_may('${capability}') returned ${JSON.stringify(data)} instead of true or false. `
      + 'The function is probably a different one from the one this build expects.',
  };
}

/**
 * The same question against an already resolved set.
 *
 * `screenCapabilities` builds that set from `capability_report`, which
 * is the same resolution `command_may` performs, so the two agree. It
 * carries no failure state of its own, which is why it is kept separate
 * rather than folded in: a page that guards on a set cannot tell a
 * missing capability from a failed lookup, and should say so.
 */
export function mayOpenFromSet(
  caps: { has: (c: CrmCapability) => boolean },
  capability: CrmCapability,
): Verdict {
  return caps.has(capability) ? { state: 'allowed' } : { state: 'refused', capability };
}
