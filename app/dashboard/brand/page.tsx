import { createClient } from '@/lib/supabase/server';
import { BrandKit } from '@/components/BrandKit';
import type { BrandAsset, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const { data: assets } = await supabase
    .from('brand_assets').select('*').order('category, name');
  return <BrandKit initialAssets={(assets ?? []) as BrandAsset[]} role={(profile as Profile)?.role ?? 'viewer'} />;
}
