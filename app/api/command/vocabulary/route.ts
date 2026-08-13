import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ENTITIES } from '@/lib/command/schema';

export const dynamic = 'force-dynamic';

/**
 * The values the database actually holds, for the columns an entity
 * declares as free text.
 *
 * This is how the bar knows DAF is a make without anybody writing a list
 * of manufacturers. A word in `stock_trailers.make` IS a make, and the
 * day somebody stocks a Chereau the bar understands it with no change to
 * any file.
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

  const out: Record<string, Record<string, { value: string; rows: number }[]>> = {};

  for (const entity of ENTITIES) {
    const columns = entity.filters.filter((f) => f.freeText).map((f) => f.column);
    if (!columns.length) continue;

    /* One read per entity rather than one per column. Distinct values
       are counted here instead of in the database because PostgREST has
       no group-by, and the alternative is a view per column. */
    const { data, error } = await supabase
      .from(entity.table)
      .select(columns.join(', '))
      .limit(20_000);
    if (error || !data) continue;

    const counts: Record<string, Map<string, number>> = {};
    for (const c of columns) counts[c] = new Map();
    for (const row of data as any[]) {
      for (const c of columns) {
        const v = String(row[c] ?? '').trim();
        if (v.length < 2 || v.length > 60) continue;
        counts[c].set(v, (counts[c].get(v) ?? 0) + 1);
      }
    }

    out[entity.id] = {};
    for (const c of columns) {
      out[entity.id][c] = [...counts[c].entries()]
        .map(([value, rows]) => ({ value, rows }))
        /* Commonest first, capped. A column with ten thousand distinct
           customer names does not need all of them in the browser to
           make the common ones reachable. */
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 1200);
    }
  }

  return NextResponse.json({ ok: true, vocabulary: out });
}
