import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function pick(row: any, names: string[]): any {
  for (const n of names) {
    const k = Object.keys(row).find(k => k.trim().toLowerCase() === n.toLowerCase());
    if (k && row[k] !== '' && row[k] != null) return row[k];
  }
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });

  const records = rows.map((r) => {
    const status = String(pick(r, ['status']) ?? 'available').toLowerCase();
    const safeStatus = ['available','reserved','sold'].includes(status) ? status : 'available';
    return {
      external_id:  String(pick(r, ['id','ref','reference','stock_id','external_id']) ?? '').trim() || null,
      make:         String(pick(r, ['make','manufacturer']) ?? '').trim() || 'Unknown',
      model:        String(pick(r, ['model','type']) ?? '').trim() || 'Unknown',
      year:         Number(pick(r, ['year','yr'])) || new Date().getFullYear(),
      price:        Number(String(pick(r, ['price','asking_price','£','sale_price']) ?? '0').replace(/[^\d.]/g, '')) || 0,
      status:       safeStatus,
      location:     String(pick(r, ['location','depot','site']) ?? '').trim() || '',
      description:  pick(r, ['description','notes','spec','specification']) || null,
    };
  });

  let upserted = 0;
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    // Upsert by external_id where present
    const withId = chunk.filter(r => r.external_id);
    const withoutId = chunk.filter(r => !r.external_id);

    if (withId.length) {
      const { error, count } = await supabase
        .from('trailer_sales')
        .upsert(withId, { onConflict: 'external_id', count: 'exact' });
      if (error) return NextResponse.json({ error: error.message, upserted }, { status: 500 });
      upserted += count ?? withId.length;
    }
    if (withoutId.length) {
      const { error, count } = await supabase
        .from('trailer_sales')
        .insert(withoutId, { count: 'exact' });
      if (error) return NextResponse.json({ error: error.message, upserted }, { status: 500 });
      upserted += count ?? withoutId.length;
    }
  }

  return NextResponse.json({ upserted });
}
