import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { screenCapabilities } from './resolve';
import type { Capabilities, Capability } from './catalog';

/* =============================================================
   The gate on a whole screen.

   The sidebar hides what somebody may not open. That is presentation
   and it is not a gate: the address bar is still there, a bookmark
   still works, and a link in a Teams message from a colleague who does
   have the screen still opens it.

   Half the dashboard had no server side check at all and relied on the
   sidebar not offering the row. Analytics and Reports had one and it
   read `crm.view`, which is now the wrong question: the office
   administrators were given Reports and refused Analytics, and until
   migration 103 there was no way to say that because both screens
   asked the same thing.

   ---- What this does not do ----

   It does not authorize anything. Every read behind these screens goes
   through row level security and every write through `command_may()`
   in the same transaction, and those remain the authority. This is so
   that somebody who cannot use a screen is sent back to their dashboard
   rather than shown an empty one, which reads as a fault in the
   product.
   ============================================================= */

/**
 * Resolve what this person may do, and send them home if they may not
 * open this screen.
 *
 * Returns the whole set, because a screen that has just asked one
 * question almost always has more to ask, and asking twice is a second
 * round trip for an answer that cannot have changed in between.
 */
export async function requirePage(
  supabase: SupabaseClient,
  capability: Capability,
  profile?: { role?: string | null } | null,
): Promise<Capabilities> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let who = profile;
  if (who === undefined) {
    const { data } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    who = data as { role?: string | null } | null;
  }

  const caps = await screenCapabilities(supabase, who ?? null, user.id);
  if (!caps.has(capability)) redirect('/dashboard');
  return caps;
}
