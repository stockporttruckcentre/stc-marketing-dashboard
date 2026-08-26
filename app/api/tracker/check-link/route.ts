import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Returns who has the given stock trailer on their Sales tracker.
 * Uses service-role DB connection so it can cross RLS boundaries — but only returns
 * minimal info (owner first name + status). Tracker contents stay private.
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
      -- Who is chasing this unit. Owner is a column on the deal now, so
      -- there is no list in the middle of the question.
      SELECT cc.id AS tracker_row_id, cc.status, cc.sale_price, cc.commission,
             cc.dispatch_date, cc.owner_id,
             p.full_name, p.email
      FROM crm_leads cc
      JOIN profiles p ON cc.owner_id = p.id
      WHERE cc.stock_trailer_id = ${body.stock_trailer_id}`;
    const me = rows.find(r => r.owner_id === user.id);
    const others = rows.filter(r => r.owner_id !== user.id);
    return NextResponse.json({
      myEntry: me ? { tracker_row_id: me.tracker_row_id, status: me.status, sale_price: me.sale_price, commission: me.commission, dispatch_date: me.dispatch_date } : null,
      othersEntries: others.map(r => ({
        owner_name: (r.full_name || r.email || 'Someone').split(' ')[0],
        status: r.status,
        sale_price: r.sale_price,
        dispatch_date: r.dispatch_date,
      })),
    });
  } finally { await sql.end({ timeout: 2 }); }
}
