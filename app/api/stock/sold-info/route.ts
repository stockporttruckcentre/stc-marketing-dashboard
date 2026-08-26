import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Returns the canonical sale record for a sold stock trailer.
 * Visible to ANY authenticated user. Commission is INTENTIONALLY never returned here.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { stock_trailer_id?: string };
  if (!body.stock_trailer_id) return NextResponse.json({ error: 'stock_trailer_id required' }, { status: 400 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  const sql = postgres(url!, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const rows = await sql<any[]>`
      -- Who sold it. The deal names its owner, so the list that used to
      -- stand between the two is gone.
      SELECT cc.sale_price, cc.order_date, cc.dispatch_date,
             p.full_name AS sold_by_name, p.email
      FROM crm_leads cc
      JOIN profiles p ON cc.owner_id = p.id
      WHERE cc.stock_trailer_id = ${body.stock_trailer_id}
        AND cc.status = 'customer'
        AND cc.sale_price IS NOT NULL
      ORDER BY cc.dispatch_date DESC NULLS LAST, cc.order_date DESC NULLS LAST
      LIMIT 1`;
    if (!rows.length) return NextResponse.json({ sale: null });
    const r = rows[0];
    const { data: stockRow } = await supabase.from('stock_trailers')
      .select('customer, sales_price, order_date, dispatch_date, sales_rep')
      .eq('id', body.stock_trailer_id).single();
    return NextResponse.json({
      sale: {
        sold_by: r.sold_by_name || r.email,
        customer: (stockRow as any)?.customer || null,
        sale_price: r.sale_price ?? (stockRow as any)?.sales_price ?? null,
        order_date: r.order_date ?? (stockRow as any)?.order_date ?? null,
        dispatch_date: r.dispatch_date ?? (stockRow as any)?.dispatch_date ?? null,
      },
    });
  } finally { await sql.end({ timeout: 2 }); }
}
