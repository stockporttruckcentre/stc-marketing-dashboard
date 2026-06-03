import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Fetch ALL sold rows
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('stock_trailers').select('sales_rep, dispatch_date, status, sales_price, profit').eq('status', 'sold').range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Group by rep
  const byRep: Record<string, { all: number; ytd: number; ytdRev: number; ytdProfit: number; nullDates: number; nullPrice: number }> = {};
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  for (const r of all) {
    const key = r.sales_rep || '(null)';
    if (!byRep[key]) byRep[key] = { all: 0, ytd: 0, ytdRev: 0, ytdProfit: 0, nullDates: 0, nullPrice: 0 };
    byRep[key].all++;
    if (!r.dispatch_date) byRep[key].nullDates++;
    if (r.sales_price == null) byRep[key].nullPrice++;
    if (r.dispatch_date) {
      const d = new Date(r.dispatch_date);
      if (d >= yearStart) {
        byRep[key].ytd++;
        byRep[key].ytdRev += Number(r.sales_price || 0);
        byRep[key].ytdProfit += Number(r.profit || 0);
      }
    }
  }

  return NextResponse.json({ totalSold: all.length, byRep });
}
