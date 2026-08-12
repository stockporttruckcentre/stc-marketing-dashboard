import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Company-wide figures for the exec dashboard.
 *
 * This cannot be a browser query and it cannot use the normal Supabase
 * client. Each rep's pipeline lives in a private crm_lists row, and the
 * crm_select policy only returns lists that are global, owned by the
 * caller, or shared with them. An exec is meant not to see them.
 *
 * So this crosses row-level security on purpose, using the same direct
 * connection as /api/stock/sold-info and /api/tracker/check-link, and it
 * keeps their discipline: aggregates only, no rows, and no commission.
 * Commission is a private figure between a rep and their own tracker.
 */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    return NextResponse.json({
      available: false,
      needs: 'POSTGRES_URL to be set. The exec view aggregates across every rep\'s private tracker, which the normal client cannot see.',
    });
  }

  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    // Pipeline and closed revenue per rep, keyed on who owns the tracker
    // list rather than any of the four free-text rep columns.
    const perRep = await sql<any[]>`
      SELECT p.id                                             AS user_id,
             COALESCE(p.full_name, p.email)                   AS rep,
             COUNT(*) FILTER (WHERE cc.status IN ('contacted','quoted'))            AS open_deals,
             COALESCE(SUM(cc.estimated_value) FILTER (WHERE cc.status IN ('contacted','quoted')), 0) AS open_value,
             COUNT(*) FILTER (WHERE cc.status = 'customer' AND cc.order_date >= ${yearStart})        AS won_ytd,
             COALESCE(SUM(cc.sale_price) FILTER (WHERE cc.status = 'customer' AND cc.order_date >= ${yearStart}), 0)  AS revenue_ytd,
             COALESCE(SUM(cc.sale_price) FILTER (WHERE cc.status = 'customer' AND cc.order_date >= ${monthStart}), 0) AS revenue_mtd
      FROM crm_lists l
      JOIN profiles p     ON p.id = l.owner_id
      JOIN crm_contacts cc ON cc.list_id = l.id
      WHERE l.is_global = FALSE AND l.name ILIKE '%Sales tracker%'
      GROUP BY p.id, p.full_name, p.email
      ORDER BY revenue_ytd DESC`;

    const totals = perRep.reduce((acc, r) => ({
      openDeals:  acc.openDeals + Number(r.open_deals),
      openValue:  acc.openValue + Number(r.open_value),
      revenueYtd: acc.revenueYtd + Number(r.revenue_ytd),
      revenueMtd: acc.revenueMtd + Number(r.revenue_mtd),
    }), { openDeals: 0, openValue: 0, revenueYtd: 0, revenueMtd: 0 });

    // Company target, if one has been loaded. user_id NULL means company-wide.
    let target: { available: true; mtd: number | null; ytd: number | null } | { available: false; needs: string };
    try {
      const rows = await sql<any[]>`
        SELECT period_month, target_amount FROM revenue_targets
        WHERE user_id IS NULL AND period_month >= ${yearStart}`;
      const mtd = rows.find((r) => new Date(r.period_month).getTime() === monthStart.getTime());
      target = {
        available: true,
        mtd: mtd ? Number(mtd.target_amount) : null,
        ytd: rows.length ? rows.reduce((s, r) => s + Number(r.target_amount), 0) : null,
      };
    } catch {
      target = { available: false, needs: 'the revenue_targets table' };
    }

    return NextResponse.json({
      available: true,
      totals,
      perRep: perRep.map((r) => ({
        rep: r.rep,
        openDeals: Number(r.open_deals),
        openValue: Number(r.open_value),
        wonYtd: Number(r.won_ytd),
        revenueYtd: Number(r.revenue_ytd),
        revenueMtd: Number(r.revenue_mtd),
      })),
      target,
      // Protean feeds these. Nothing in the schema can answer them yet.
      yoyAlerts: { available: false, needs: 'the Protean nightly feed' },
      invoiceVolume: { available: false, needs: 'the Protean nightly feed. There is no invoice data in the database at all' },
      weeklyDigest: { available: false, needs: 'the Friday digest job, which does not exist yet' },
    });
  } catch (e: any) {
    return NextResponse.json({ available: false, needs: `a working database connection (${e.message})` });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
