import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import rows from './rows.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One-off import: 110 Sold-list rows from Tom's stock workbook
 * where dispatch_date >= 2026-01-01.
 * Dedupes by stc_no — only inserts rows that don't already exist as 'sold'.
 * Admin role required.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((profile as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  // 1. Get existing sold stc_no values to dedupe
  const { data: existing } = await supabase
    .from('stock_trailers').select('stc_no').eq('status', 'sold');
  const existingSet = new Set((existing ?? []).map((r: any) => String(r.stc_no)));

  const incoming = rows as any[];
  const toInsert = incoming.filter(r => !existingSet.has(String(r.stc_no)));
  const skipped = incoming.length - toInsert.length;

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped, totalIncoming: incoming.length, msg: 'all rows already exist' });
  }

  // 2. Bulk insert in chunks of 100
  const CHUNK = 100;
  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    const { error, count } = await supabase.from('stock_trailers').insert(slice, { count: 'exact' });
    if (error) {
      errors.push(`chunk ${i}: ${error.message}`);
    } else {
      inserted += count ?? slice.length;
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    inserted,
    skipped,
    totalIncoming: incoming.length,
    errors: errors.length ? errors : undefined,
  });
}
