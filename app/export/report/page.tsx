import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { buildReport } from '@/lib/reports/build';
import { docxHref, fromParams, slugFromParams } from '@/lib/reports/link';
import { ReportPage } from '@/components/reports/ReportPage';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The printable copy of a report.
 *
 * Built here rather than fetched by the browser, so the page arrives
 * complete. A print dialogue opened over a page still waiting for its
 * data prints the spinner, which is exactly the class of bug the
 * business was describing when they asked for the exports to be checked.
 *
 * The filters come out of the URL through the same reader the Word route
 * uses, so a link that prints one thing cannot download another.
 */
export default async function ReportExportPage({
  searchParams,
}: { searchParams?: Record<string, string | string[] | undefined> }) {
  const params = searchParams ?? {};
  const slug = slugFromParams(params);
  if (!slug) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  const caps = capabilitiesFor((profileRow as Profile | null) ?? { role: 'viewer' });
  if (!caps.has('crm.view')) redirect('/dashboard');

  const filters = fromParams(slug, params);
  const made = await buildReport(supabase as never, slug, filters);
  if ('error' in made) notFound();

  return <ReportPage report={made} docxUrl={docxHref(slug, filters)} />;
}
