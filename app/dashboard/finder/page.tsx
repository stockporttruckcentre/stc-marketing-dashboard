import { createClient } from '@/lib/supabase/server';
import { CompanyFinder } from '@/components/CompanyFinder';
import type { CrmList } from '@/lib/types';
import './finder.css';

export const dynamic = 'force-dynamic';

export default async function FinderPage() {
  const supabase = createClient();
  const { data: lists } = await supabase.from('crm_lists').select('*').order('is_global', { ascending: false }).order('created_at', { ascending: true });
  return <CompanyFinder lists={(lists ?? []) as CrmList[]} />;
}
