import { createClient } from '@/lib/supabase/server';
import { SocialPlanner } from '@/components/SocialPlanner';
import type { SocialPost, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user!.id).single();
  const { data: posts } = await supabase
    .from('social_posts').select('*').order('scheduled_date', { ascending: true });

  return (
    <SocialPlanner
      initialPosts={(posts ?? []) as SocialPost[]}
      profile={profile as Profile}
    />
  );
}
