import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/guard';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Given a stock trailer being moved AWAY from 'sold', return any tracker entries where it
 * is marked 'customer' or 'won' (i.e. an actual sale was logged). Used to warn the user
 * about the consequences before they change the trailer's status.
 *
 * This crosses row level security over a direct postgres connection, so
 * what it returns has to be chosen deliberately rather than selected
 * with a star. It used to include `commission`, which is somebody
 * else's pay: sold-info and check-link both cross the same boundary and
 * both withhold it, and the exec view exists partly to say commission
 * stays between a rep and their own tracker. This one disagreed with all
 * three. The sale price stays, because the warning is about a sale being
 * undone and the price is what makes that real.
 */
export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const body = await req.json().catch(() => ({})) as { stock_trailer_id?: string };
  if (!body.stock_trailer_id) return NextResponse.json({ error: 'stock_trailer_id required' }, { status: 400 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  const sql = postgres(url!, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const rows = await sql<any[]>`
      -- Anybody who has this unit down as sold. Owner is on the deal.
      SELECT cc.sale_price, cc.dispatch_date, cc.order_date, cc.status,
             p.id AS owner_id, p.full_name, p.email
      FROM crm_leads cc
      JOIN profiles p ON cc.owner_id = p.id
      WHERE cc.stock_trailer_id = ${body.stock_trailer_id}
        AND cc.status IN ('customer','won')`;
    return NextResponse.json({
      soldEntries: rows.map(r => ({
        owner_name: r.full_name || r.email,
        owner_first: (r.full_name || r.email || 'Someone').split(' ')[0],
        sale_price: r.sale_price,
        order_date: r.order_date,
        dispatch_date: r.dispatch_date,
      })),
    });
  } finally { await sql.end({ timeout: 2 }); }
}
