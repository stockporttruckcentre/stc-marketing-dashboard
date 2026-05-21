import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Mark a tracker row as sold AND propagate to the linked stock_trailer.
 *
 * Body: { tracker_id, sale_price, profit?, commission?, dispatch_date? }
 *
 * RLS handles ownership — the user can only update tracker rows in lists they own,
 * and stock_trailers updates are permitted for admin/marketer/sales.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    tracker_id?: string;
    sale_price?: number;
    profit?: number;
    commission?: number;
    dispatch_date?: string;
  };
  if (!body.tracker_id) return NextResponse.json({ error: 'tracker_id required' }, { status: 400 });

  // Read the tracker row
  const { data: row, error: readErr } = await supabase
    .from('crm_contacts').select('*').eq('id', body.tracker_id).single();
  if (readErr || !row) return NextResponse.json({ error: readErr?.message || 'tracker row not found' }, { status: 404 });

  // Compute commission if not provided (default 10% of profit)
  const profit = body.profit ?? row.profit ?? null;
  const rate = row.commission_rate ?? 0.10;
  const commission = body.commission ?? (profit != null ? Number((Number(profit) * rate).toFixed(2)) : null);

  // Get the user's display name for sales_rep on the stock_trailer
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
  const repName = (profile as any)?.full_name?.split(' ').map((p: string) => p[0]).join('') || (profile as any)?.full_name || 'Unknown';

  // 1) Update the tracker row
  const today = new Date().toISOString().slice(0, 10);
  const trackerUpdate: any = {
    status: 'customer',
    sale_price: body.sale_price ?? row.sale_price,
    profit,
    commission,
    order_date: row.order_date ?? today,
  };
  if (body.dispatch_date) trackerUpdate.dispatch_date = body.dispatch_date;
  const { error: tErr } = await supabase.from('crm_contacts').update(trackerUpdate).eq('id', body.tracker_id);
  if (tErr) return NextResponse.json({ error: `tracker update failed: ${tErr.message}` }, { status: 500 });

  // 2) Cascade to stock_trailer if linked
  let stockUpdated = false;
  if (row.stock_trailer_id) {
    const stockUpdate: any = {
      status: 'sold',
      customer: row.company_name,
      sales_rep: repName,
      sales_price: body.sale_price ?? row.sale_price,
      profit,
      order_date: trackerUpdate.order_date,
    };
    if (body.dispatch_date) stockUpdate.dispatch_date = body.dispatch_date;
    const { error: sErr } = await supabase.from('stock_trailers').update(stockUpdate).eq('id', row.stock_trailer_id);
    if (sErr) {
      return NextResponse.json({ error: `tracker updated, but stock_trailer update failed: ${sErr.message}`, partial: true }, { status: 500 });
    }
    stockUpdated = true;
  }

  // 3) Cascade to OTHER reps' tracker rows linked to the same stock trailer (first-to-sell rule):
  // their status becomes 'customer' too, but we do NOT touch their sale_price / commission /
  // dispatch_date - those stay null since they didn't make the sale. This keeps the dataset
  // honest: only the seller has commission; everyone else sees 'this is sold now'.
  let cascadedOthers = 0;
  if (row.stock_trailer_id) {
    const { data: others, error: cErr } = await supabase
      .from('crm_contacts')
      .update({ status: 'customer' })
      .eq('stock_trailer_id', row.stock_trailer_id)
      .neq('id', body.tracker_id)
      .not('status', 'eq', 'customer')
      .select('id');
    if (!cErr && others) cascadedOthers = others.length;
  }

  return NextResponse.json({ ok: true, commission, stockUpdated, stock_trailer_id: row.stock_trailer_id, cascadedOthers });
}
