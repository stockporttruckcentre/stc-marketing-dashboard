import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { fetchNews, storeNews } from '@/lib/news/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

/**
 * Refresh the industry news.
 *
 * The feed list, the age cutoff and the write are `lib/news/refresh.ts`,
 * which the command bar's `news.refresh` capability reaches too. The
 * list IS the operation: which publications count and how old a story
 * may be, and a second copy of it would drift the first time somebody
 * added a publication on one side.
 *
 * This route is the button on the news screen.
 */
export async function POST() {
  /* This one deletes. Any signed in user could purge every row older
     than the cutoff and every row from one publication. */
  const gate = await requireCapability('marketing.edit');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const { records, report } = await fetchNews();
  const done = await storeNews(supabase, records);
  if (!done.ok) return NextResponse.json({ error: done.why, debug: report }, { status: 500 });

  return NextResponse.json({
    added: done.added,
    purged: done.purged,
    sources: report.filter((d) => d.itemCount > 0).length,
    debug: report,
  });
}
