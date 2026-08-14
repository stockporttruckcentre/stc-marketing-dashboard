import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildVocabulary } from '@/lib/command/server/vocabulary';

export const dynamic = 'force-dynamic';

/**
 * The values the database actually holds, for the columns an entity
 * declares as free text.
 *
 * This is how the bar knows DAF is a make without anybody writing a
 * list of manufacturers. A word in `stock_trailers.make` IS a make, and
 * the day somebody stocks a Chereau the bar understands it with no
 * change to any file.
 *
 * The building is in `lib/command/server/vocabulary.ts` because the
 * server planner needs the same values. Two functions that read the
 * same columns the same way are two functions that eventually stop
 * agreeing, and when they stopped agreeing the browser and the server
 * read one sentence as two different questions.
 *
 * Only declared free text columns are read, so the response can never
 * widen what is filterable. Values only, never row contents: a make and
 * a depot name are not private, and nothing here returns a price, a
 * customer's detail or a row a caller could not already list.
 */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ ok: true, vocabulary: await buildVocabulary(supabase) });
}
