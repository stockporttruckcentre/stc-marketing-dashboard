import { createClient } from '@/lib/supabase/server';
import { requirePage } from '@/lib/platform/permissions/page';
import { NoAccess } from '@/components/platform/NoAccess';
import { BrandKit } from '@/components/BrandKit';
import type { BrandAsset, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const { caps, verdict } = await requirePage(supabase, '/dashboard/brand', profile as { role?: string | null } | null);
  if (verdict.state !== 'allowed') return <NoAccess verdict={verdict} page="the brand kit" />;
  const { data: assets } = await supabase
    .from('brand_assets').select('*').order('category, name');
  /* brand.manage, not the old role names. The register describes it as
     "Add, replace or remove brand assets" and it governed nothing here
     until migration 141 put it on the write policy too. */
  return (
    <BrandKit
      initialAssets={(assets ?? []) as BrandAsset[]}
      role={(profile as Profile)?.role ?? 'viewer'}
      caps={[...caps]}
    />
  );
}
