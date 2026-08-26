import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SocialPlanner } from '@/components/SocialPlanner';
import { resolveCapabilities } from '@/lib/platform/permissions/resolve';
import { NotProvisioned, TabShell } from '@/components/kit/primitives';
import type {
  ActivityLine, BoardColumn, Campaign, Channel, LibraryItem,
  Network, Post, Slot, Tag, Template, Variant,
} from '@/lib/content/types';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   The social planner.

   Everything is read here on the server and handed down, so the screen
   draws once with real rows rather than flashing empty and filling in.
   Every read is row level security scoped: the policies in migration
   054 decide what comes back, and this file never second guesses them.

   The capability set is resolved rather than derived from the role
   column, so somebody granted one social capability on their own gets
   the control for it. What actually stops anything is still
   `command_may` inside the write.

   ---- The reads that can fail on an old database ----

   `social_posts` has been here since the first schema. Everything else
   arrives in migrations 054 and 055, which are pasted in by hand. So
   the posts read is the one that decides whether this screen can draw
   at all, and the rest fall back to empty rather than throwing: a
   planner with no channels yet is a planner, and a planner with no
   `social_posts` table is a deployment problem worth saying out loud.
   ============================================================= */

const TABS = [
  'planner', 'calendar', 'list', 'queue', 'library',
  'templates', 'tags', 'channels', 'activity',
] as const;
type Tab = (typeof TABS)[number];

/** Postgres and PostgREST for "that table is not here yet". */
function missingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: { tab?: string; needs?: string; new?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [
    profileRes, postsRes, variantsRes, channelsRes, networksRes,
    slotsRes, columnsRes, templatesRes, campaignsRes, tagsRes,
    libraryRes, activityRes, postTagsRes, capabilities,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('social_posts').select('*')
      .order('scheduled_date', { ascending: true })
      .limit(1000),
    supabase.from('social_post_variants').select('*').order('position'),
    supabase.from('social_channels').select('*')
      .eq('is_active', true).order('position').order('handle'),
    supabase.from('social_networks').select('*')
      .eq('is_active', true).order('position'),
    supabase.from('social_channel_slots').select('*')
      .eq('is_active', true).order('day_of_week').order('at_time'),
    supabase.from('social_board_columns').select('*')
      .eq('is_active', true).order('position'),
    supabase.from('social_templates').select('*')
      .eq('is_active', true).order('name'),
    supabase.from('social_campaigns').select('*')
      .eq('is_active', true).order('starts_on', { ascending: false }),
    supabase.from('social_tags').select('*')
      .eq('is_active', true).order('position').order('name'),
    supabase.from('social_library').select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false }).limit(400),
    /* The timeline for the whole screen, which is the Activity tab. One
       table, shared with every other surface, so "this post took nine
       days and sat with an approver for six" is a query rather than a
       history somebody built here. */
    supabase.from('activity')
      .select('id, at, actor_id, actor_label, verb, subject_type, subject_id, subject_label, summary, metadata, is_system')
      .eq('subject_type', 'social_post')
      .order('at', { ascending: false })
      .limit(200),
    supabase.from('social_post_tags').select('post_id, tag_id'),
    resolveCapabilities(supabase, user.id),
  ]);

  if (missingTable(postsRes.error as { code?: string } | null)) {
    return (
      <TabShell>
        <NotProvisioned
          what="The social planner is built, but its tables are not in this database yet."
          needs="migrations 046 to 060 running against it, which is the SQL handed over in chat"
        />
      </TabShell>
    );
  }

  const profile = (profileRes.data ?? {
    id: user.id,
    email: user.email!,
    full_name: user.email!.split('@')[0],
    role: 'viewer',
    theme: 'dark',
    created_at: new Date().toISOString(),
  }) as Profile;

  const asked = searchParams?.tab;
  const openTab = (TABS as readonly string[]).includes(asked ?? '') ? (asked as Tab) : null;

  return (
    <SocialPlanner
      initialPosts={(postsRes.data ?? []) as unknown as Post[]}
      profile={profile}
      capabilities={[...capabilities.caps]}
      variants={(variantsRes.data ?? []) as Variant[]}
      channels={(channelsRes.data ?? []) as Channel[]}
      networks={(networksRes.data ?? []) as Network[]}
      slots={(slotsRes.data ?? []) as Slot[]}
      columns={(columnsRes.data ?? []) as BoardColumn[]}
      templates={(templatesRes.data ?? []) as Template[]}
      campaigns={(campaignsRes.data ?? []) as Campaign[]}
      tags={(tagsRes.data ?? []) as Tag[]}
      library={(libraryRes.data ?? []) as LibraryItem[]}
      activity={(activityRes.data ?? []) as ActivityLine[]}
      postTags={(postTagsRes.data ?? []) as { post_id: string; tag_id: string }[]}
      openTab={openTab}
      needsReview={searchParams?.needs === 'review'}
      startComposing={searchParams?.new === '1'}
    />
  );
}
