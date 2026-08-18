import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { commitStockImport } from '@/lib/import/stock';
import rows from './rows.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * DEVELOPER MAINTENANCE, AND IT SAYS SO.
 *
 * A one-off import of 110 rows from Tom's stock workbook, bundled as
 * `rows.json` beside this file. It is not a product operation: nothing
 * in the application links to it, the data it loads is fixed at the
 * moment it was written, and loading a supplier's file is now
 * `stock.import`, which reads whatever file somebody attaches.
 *
 * It stays because it has not been run against every environment yet,
 * and it goes through the same atomic write as everything else. It used
 * to insert in chunks of a hundred and report how many landed before a
 * chunk failed, which leaves a half loaded stock list nobody can undo.
 *
 * Gated on `stock.edit` through the shared guard rather than by reading
 * `profiles.role` here, which is the check every other route makes.
 */
export async function POST() {
  const gate = await requireCapability('stock.edit');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

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

  // 2. Every row or none, through the operation the stock screen uses.
  const done = await commitStockImport(supabase, toInsert as Record<string, unknown>[]);
  if (!done.ok) {
    return NextResponse.json({
      ok: false, inserted: 0, skipped, totalIncoming: incoming.length, error: done.why,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    inserted: done.inserted,
    skipped,
    totalIncoming: incoming.length,
  });
}
