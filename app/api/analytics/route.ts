import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { buildPeriod, type CompareMode, type PeriodKind, iso } from '@/lib/analytics/period';
import {
  ageingBands, contractBook, decisionsFrom, divisionRows, headlineFigures,
  monthPoints, peopleRows, sourceFlows, stockUnits, verdictSentence,
  type ContractRow, type LeadRow, type MonthRow, type TrailerRow, type WindowRow,
} from '@/lib/analytics/shape';
import type { Analytics, DivisionSlug, NotWired } from '@/lib/analytics/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Everything the Analytics hub draws, in one request.

   ---- Why one request and not eight ----

   Because the page compares. Eight requests can straddle an import: the
   revenue call reads the figures before this morning's Protean load and
   the people call reads them after, and the screen then shows a
   conversion rate against a revenue figure from a different minute.
   One request, one moment.

   ---- Where each figure comes from ----

   Money is aggregated in Postgres and everything else is aggregated
   here, and that split is deliberate rather than lazy:

     PROTEAN is twenty thousand invoices and rising. It never leaves the
     database. `analytics_window` and `division_by_month` do the sums.

     LEADS, STOCK AND CONTRACTS are hundreds of rows, they carry row
     level security that decides what a rep may see, and the shapes the
     design asks for are awkward joins and easy loops. They come back as
     rows and `lib/analytics/shape.ts` folds them, where the folding can
     be asserted by `npm run check:analytics` without a database.

   ---- What is deliberately absent ----

   The design has a rentals utilisation section and a per asset hire
   timeline. There is no fleet table and no hire table in this
   application: rentals reaches us as invoices out of Sage and nothing
   else. Rather than draw a chart of zeroes, the response carries a
   `notWired` list naming exactly what is missing and what it would
   need. A zero on this page is a claim about the business.
   ============================================================= */

const KINDS: PeriodKind[] = ['month', 'quarter', 'year', 'custom'];
const MODES: CompareMode[] = ['previous', 'lastyear', 'target'];
const DIVISIONS: DivisionSlug[] = ['stc', 'trailer', 'rental'];

export async function POST(req: NextRequest) {
  const gate = await requireCapability('crm.view');
  if (!gate.ok) return gate.response;
  const db = gate.supabase;

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;

  const today = typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today)
    ? b.today : iso(new Date());
  const kind = KINDS.includes(b.kind as PeriodKind) ? (b.kind as PeriodKind) : 'month';
  const mode = MODES.includes(b.mode as CompareMode) ? (b.mode as CompareMode) : 'previous';
  const trim = b.trim !== false;

  const period = buildPeriod({
    kind,
    today,
    from: typeof b.from === 'string' ? b.from : undefined,
    to: typeof b.to === 'string' ? b.to : undefined,
    mode,
    trim,
  });

  /* Which divisions the reader has narrowed to. Empty and all three are
     the same request, and the empty form is what the screen sends when
     nothing is picked. */
  const asked = Array.isArray(b.divisions) ? b.divisions.map(String) : [];
  const only = DIVISIONS.filter((d) => asked.includes(d));
  const narrowed = only.length > 0 && only.length < DIVISIONS.length;

  /* One person, when the reader has drilled into somebody. Narrows the
     lead side of the page only: an invoice in Protean does not carry a
     salesperson, so narrowing revenue by person would silently answer a
     different question. The screen says so. */
  const person = typeof b.person === 'string' && b.person ? b.person : null;

  const cw = period.compare ?? period.window;

  /* ---- Money, from the database ---- */
  const [windowRes, monthsRes, targetsRes] = await Promise.all([
    db.rpc('analytics_window', {
      p_from: period.window.from,
      p_to: period.window.to,
      p_compare_from: cw.from,
      p_compare_to: cw.to,
    }),
    db.rpc('division_by_month', { p_months: 24, p_upto: period.window.to }),
    db.rpc('analytics_targets_by_month', { p_months: 24 }),
  ]);

  if (windowRes.error) {
    return NextResponse.json(
      { error: windowRes.error.message, where: 'analytics_window' },
      { status: 400 },
    );
  }

  const allDivisions = divisionRows((windowRes.data ?? []) as unknown as WindowRow[]);
  const divisions = narrowed ? allDivisions.filter((d) => only.includes(d.division)) : allDivisions;

  const months = monthPoints(
    (monthsRes.data ?? []) as unknown as MonthRow[],
    (targetsRes.data ?? []) as { month: string; division: string | null; target: number }[],
  );

  /* ---- Leads, stock and contracts, as rows ---- */
  const [leadRes, peopleRes, stockRes, bookRes] = await Promise.all([
    db.from('crm_leads')
      .select('id, owner_id, type, status, estimated_value, sale_price, order_date, created_at, '
        + 'account:crm_contacts ( source )')
      .limit(20000),
    db.from('profiles').select('id, full_name'),
    db.from('stock_trailers')
      .select('id, stc_no, make, model, category, status, location, retail_price, sales_price, '
        + 'total_nbv, nbv, created_at, order_date')
      .limit(5000),
    db.from('fleetsmart_contracts')
      .select('id, plan, status, monthly_total, annual_total, starts_on, created_at, decided_at')
      .limit(5000),
  ]);

  const names = new Map<string, string>(
    ((peopleRes.data ?? []) as { id: string; full_name: string | null }[])
      .map((p) => [p.id, p.full_name ?? 'Somebody']),
  );

  const leads = ((leadRes.data ?? []) as any[])
    .map((l): LeadRow => ({
      id: l.id,
      owner_id: l.owner_id,
      type: l.type,
      status: l.status,
      estimated_value: l.estimated_value,
      sale_price: l.sale_price,
      order_date: l.order_date,
      created_at: l.created_at,
      contact_source: l.account?.source ?? null,
    }))
    .filter((l) => !narrowed || only.includes(leadDivision(l.type)))
    .filter((l) => !person || l.owner_id === person);

  const people = peopleRows(leads, names, period);
  const sources = sourceFlows(leads, period);

  const stock = (!narrowed || only.includes('trailer'))
    ? stockUnits((stockRes.data ?? []) as unknown as TrailerRow[], period.window.to)
    : [];

  const book = (!narrowed || only.includes('stc'))
    ? contractBook((bookRes.data ?? []) as unknown as ContractRow[], period)
    : null;

  /* ---- Top customers, from whichever divisions are in scope ---- */
  const customers = await topCustomers(db, period, only, narrowed);

  const headline = headlineFigures({ divisions, people, book, period });
  const verdict = verdictSentence(divisions, period);
  const decisions = decisionsFrom({ divisions, stock, people, book });

  const notWired: NotWired[] = [];
  if (!narrowed || only.includes('rental')) {
    notWired.push({
      what: 'Rentals utilisation and the per asset hire timeline',
      why: 'Rentals reaches this application as invoices out of Sage and nothing else. There is '
        + 'no record here of which trailers are on the hire fleet or which days each one was out, '
        + 'so utilisation, idle days and the timeline cannot be worked out.',
      needs: 'A hire fleet and a hire booking per asset, imported the way the invoices already are. '
        + 'Everything else on the rentals side is drawn from the invoices and is live.',
    });
  }
  notWired.push({
    what: 'A group gross margin',
    why: 'Only trailer sales records what a thing cost. STC invoices and rental invoices carry a '
      + 'net figure and no cost, so a margin across the group would be a trailer margin with two '
      + 'thirds of the revenue quietly left out of the denominator.',
    needs: 'A cost or a labour recovery figure against Protean jobs. Trailer margin is real and '
      + 'is shown on its own.',
  });

  const out: Analytics = {
    period,
    generatedAt: new Date().toISOString(),
    verdict,
    decisions,
    headline,
    divisions,
    months,
    people,
    sources,
    stock,
    book,
    customers,
    notWired,
  };

  return NextResponse.json({ ...out, bands: ageingBands(stock) });
}

function leadDivision(type: string | null): DivisionSlug {
  if (type === 'maintenance') return 'stc';
  if (type === 'rental') return 'rental';
  return 'trailer';
}

/**
 * Who spent the most in the window.
 *
 * Protean names rather than CRM accounts, because a customer that has
 * not been matched to a CRM record still spent the money and leaving
 * them out would make the total on this table disagree with the total
 * above it.
 */
async function topCustomers(
  db: any, period: { window: { from: string; to: string }; compare: { from: string; to: string } | null },
  only: DivisionSlug[], narrowed: boolean,
): Promise<Analytics['customers']> {
  const wanted = narrowed ? only : DIVISIONS;
  const proteanSide = wanted.filter((d) => d !== 'trailer');
  if (proteanSide.length === 0) return [];

  const compare = period.compare ?? period.window;
  let q = db.from('protean_invoices')
    .select('protean_name, net, tax_point, division')
    .gte('tax_point', compare.from < period.window.from ? compare.from : period.window.from)
    .lte('tax_point', period.window.to)
    .limit(50000);
  if (proteanSide.length < 2) q = q.eq('division', proteanSide[0]);

  const { data, error } = await q;
  if (error) return [];

  const by = new Map<string, { name: string; revenue: number; was: number; division: DivisionSlug }>();
  for (const r of (data ?? []) as any[]) {
    const name = (r.protean_name ?? '').trim() || 'Unnamed account';
    const key = `${r.division}:${name}`;
    const at = by.get(key) ?? { name, revenue: 0, was: 0, division: r.division as DivisionSlug };
    const on = String(r.tax_point).slice(0, 10);
    if (on >= period.window.from && on <= period.window.to) at.revenue += Number(r.net) || 0;
    else if (on >= compare.from && on <= compare.to) at.was += Number(r.net) || 0;
    by.set(key, at);
  }

  return [...by.values()]
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12);
}
