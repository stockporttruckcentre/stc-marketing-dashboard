import { createClient } from '@/lib/supabase/server';
import { requirePage } from '@/lib/platform/permissions/page';
import { NoAccess } from '@/components/platform/NoAccess';
import { CompanyFinder } from '@/components/CompanyFinder';
import type { CrmList } from '@/lib/types';
import './finder.css';

export const dynamic = 'force-dynamic';

export default async function FinderPage() {
  const supabase = createClient();
  const { verdict } = await requirePage(supabase, '/dashboard/finder');
  if (verdict.state !== 'allowed') return <NoAccess verdict={verdict} page="the company finder" />;
  const { data: lists } = await supabase.from('crm_lists').select('*').order('is_global', { ascending: false }).order('created_at', { ascending: true });
  return <CompanyFinder lists={(lists ?? []) as CrmList[]} />;
}
