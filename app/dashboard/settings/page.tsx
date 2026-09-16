import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TABS = ['profile', 'password', 'appearance', 'notifications', 'access'] as const;
type Tab = (typeof TABS)[number];

/* =============================================================
   Your own account. Everybody has one, so nothing here is gated.

   `?tab=` is honoured because three other things link straight into a
   tab of this page: the cog in the notification bell, the command bar's
   `me.profile` and `me.access`, and the Team tab's "Edit my details".
   A link that lands on the wrong tab makes somebody hunt for the thing
   they just clicked towards.

   `account` is still accepted and lands on Profile. It was the name of
   this tab before the screen was rebuilt, and anything anybody has
   bookmarked or pasted into a message still says it.
   ============================================================= */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();

  /* ---- The role they are actually on ----

     From the business, looking at What you can do:

       says tom is on Administrator which is a removed role

     It did. `profiles` has `role_template_id`, a uuid, and no
     `role_template` column at all. The screen asked for
     `profile.role_template`, got undefined every single time, and fell
     through to the legacy `role` column, which says `admin` for
     everybody who was an administrator before role templates existed.
     So it printed a role nobody is on, for everybody.

     Read here rather than in the panel because the page already has a
     server client and a round trip in a client component would draw the
     wrong name first and correct it a moment later. */
  const { data: template } = (profile as { role_template_id?: string | null } | null)?.role_template_id
    ? await supabase
        .from('role_templates')
        .select('name')
        .eq('id', (profile as { role_template_id: string }).role_template_id)
        .maybeSingle()
    : { data: null };

  const asked = searchParams.tab === 'account' ? 'profile' : searchParams.tab;
  const tab: Tab = TABS.includes(asked as Tab) ? (asked as Tab) : 'profile';

  return (
    <SettingsPanel
      profile={profile as Profile}
      roleName={(template as { name: string } | null)?.name ?? null}
      openTab={tab}
    />
  );
}
