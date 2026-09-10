import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/* =============================================================
   Looking at the application as somebody else.

   From the business:

     Create a "View as" button in admin so I can view the app as any
     user and see it exactly as they do while i'm testing perms

   ---- What this does, exactly ----

   It changes WHOSE CAPABILITIES the interface is drawn from. The
   sidebar, every gated button, every tab and every screen that asks
   `caps.has(...)` answers for the chosen person instead of for you.
   That is the layer permissions are tested at, and it is the layer that
   was wrong when the sidebar offered STC Admin a Revenue tab they could
   not open.

   ---- What it does NOT do, and why saying so matters ----

   It does not change who the database thinks you are. Row level
   security reads `auth.uid()`, which comes from the signed in session,
   and nothing a browser sends can change that. So the ROWS on screen
   are still the rows you can see, not the rows they can see. A rep who
   would find their tracker holding nine leads may show yours.

   That limit is not a bug to work around. Working around it would mean
   holding a second session for another person, which is a real account
   takeover with a friendly name on it. The honest thing is to say which
   half is faithful, which is what the banner does.

   ---- And nothing is written while it is on ----

   Every write would go in under YOUR name while the screen says
   somebody else's, and an audit trail that says Alex did a thing Dean
   appeared to do is worse than no audit trail. So `requireCapability`
   refuses anything that is not a read for as long as the cookie is set,
   and the banner says so before you find out by pressing a button.
   ============================================================= */

/** Session cookie. Deliberately not persisted: it ends with the browser. */
export const VIEW_AS_COOKIE = 'stc_view_as';

export type ViewingAs = {
  /** The person whose capabilities the interface is drawn from. */
  userId: string;
  fullName: string;
  email: string;
  roleName: string | null;
};

/**
 * Who the interface should be drawn for, or null for the ordinary case.
 *
 * Re-checks `admin.users` on EVERY call rather than trusting the cookie.
 * A cookie is a thing the browser sends, so it is a request and not a
 * fact: somebody whose administrator permission was taken away an hour
 * ago must stop viewing as other people at once, not when they happen
 * to clear their cookies.
 */
export async function viewingAs(supabase: SupabaseClient): Promise<ViewingAs | null> {
  const wanted = cookies().get(VIEW_AS_COOKIE)?.value;
  if (!wanted) return null;

  const { data: mayManage } = await supabase.rpc('command_may', { p_capability: 'admin.users' });
  if (mayManage !== true) return null;

  const { data: them } = await supabase
    .from('profiles')
    .select('id, full_name, email, role_template_id')
    .eq('id', wanted)
    .maybeSingle();
  if (!them) return null;

  const row = them as {
    id: string; full_name: string | null; email: string | null; role_template_id: string | null;
  };

  let roleName: string | null = null;
  if (row.role_template_id) {
    const { data: tpl } = await supabase
      .from('role_templates').select('name').eq('id', row.role_template_id).maybeSingle();
    roleName = (tpl as { name?: string } | null)?.name ?? null;
  }

  return {
    userId: row.id,
    fullName: row.full_name ?? row.email ?? 'Somebody',
    email: row.email ?? '',
    roleName,
  };
}

/**
 * The same question for a route handler, which only needs the id.
 *
 * Separate from `viewingAs` because a route that is about to refuse a
 * write does not need a name to refuse it, and reading two more tables
 * to say no is two reads nobody uses.
 */
export async function viewingAsId(supabase: SupabaseClient): Promise<string | null> {
  const wanted = cookies().get(VIEW_AS_COOKIE)?.value;
  if (!wanted) return null;
  const { data: mayManage } = await supabase.rpc('command_may', { p_capability: 'admin.users' });
  return mayManage === true ? wanted : null;
}
