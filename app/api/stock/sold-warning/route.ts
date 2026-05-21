import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Given a stock trailer being moved AWAY from 'sold', return any tracker entries where it
 * is marked 'customer' or 'won' (i.e. an actual sale was logged). Used to warn the user
 * about the consequences before they change the trailer's status.
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
      SELECT cc.sale_price, cc.commission, cc.dispatch_date, cc.order_date, cc.status,
             p.full_name, p.email
      FROM crm_contacts cc
      JOIN crm_lists l ON cc.list_id = l.id
      JOIN profiles p ON l.owner_id = p.id
      WHERE cc.stock_trailer_id = ${body.stock_trailer_id}
        AND cc.status IN ('customer','won')`;
    return NextResponse.json({
      soldEntries: rows.map(r => ({
        owner_name: r.full_name || r.email,
        owner_first: (r.full_name || r.email || 'Someone').split(' ')[0],
        sale_price: r.sale_price,
        commission: r.commission,
        order_date: r.order_date,
        dispatch_date: r.dispatch_date,
      })),
    });
  } finally { await sql.end({ timeout: 2 }); }
}
