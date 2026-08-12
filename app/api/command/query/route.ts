import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ENTITIES } from '@/lib/command/schema';

export const dynamic = 'force-dynamic';

/**
 * Runs a composed query.
 *
 * Every column comes from the dictionary in lib/command/schema, never
 * from the request, so an unexpected filter key is dropped rather than
 * reaching the database. Values are still passed as parameters through
 * the Supabase builder.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as any;
  const entity = ENTITIES.find((e) => e.id === body.entityId);
  if (!entity) return NextResponse.json({ error: 'unknown entity' }, { status: 400 });

  const measure: string = ['count', 'sum', 'avg', 'list'].includes(body.measure) ? body.measure : 'count';

  // Only columns the dictionary knows about.
  const allowedFilterColumns = new Set(entity.filters.map((f) => f.column));
  const allowedAmounts = new Set(entity.amounts.map((a) => a.column));
  const allowedDimensions = new Set(entity.dimensions.map((d) => d.column));

  const amountColumn = allowedAmounts.has(body.amountColumn) ? body.amountColumn : null;
  const groupColumn = body.groupBy && allowedDimensions.has(body.groupBy.column) ? body.groupBy.column : null;

  // Which columns to pull. Enough to render a row, plus whatever is measured.
  const cols = new Set<string>(['id', entity.titleColumn, ...entity.subtitleColumns]);
  if (amountColumn) cols.add(amountColumn);
  if (groupColumn) cols.add(groupColumn);
  if (entity.dateColumn) cols.add(entity.dateColumn);

  // `any` deliberately: chaining a dozen conditional filters makes the
  // builder's generic depth blow past what tsc will follow.
  let q: any = supabase.from(entity.table).select(Array.from(cols).join(', '));

  // Scope. "Mine" means rows on the caller's own tracker list.
  if (body.scope === 'mine' && entity.table === 'crm_contacts') {
    const { data: list } = await supabase.from('crm_lists').select('id')
      .eq('owner_id', user.id).eq('is_global', false)
      .ilike('name', '%Sales tracker%').limit(1).maybeSingle();
    if (list) q = q.eq('list_id', (list as any).id);
  }
  if (body.scope === 'mine' && entity.table === 'calendar_events') {
    q = q.eq('created_by', user.id);
  }
  // A deal is a tracker row; a contact is a CRM record. Same table, so the
  // deals view has to exclude rows that are only sitting in the global list.
  if (entity.id === 'deals' && body.scope !== 'mine') {
    q = q.not('list_id', 'is', null);
  }

  for (const f of (body.filters ?? [])) {
    if (!allowedFilterColumns.has(f.column)) continue;
    if (f.op === 'eq') q = q.eq(f.column, f.value);
    else q = q.ilike(f.column, `%${f.value}%`);
  }

  if (body.range && entity.dateColumn) {
    const from = String(body.range.from).slice(0, 10);
    const to = String(body.range.to).slice(0, 10);
    q = q.gte(entity.dateColumn, from).lte(entity.dateColumn, to);
  }

  // Supabase caps a page at 1000 rows, so page through for honest totals.
  const rows: any[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const num = (r: any) => Number(amountColumn ? r[amountColumn] : 0) || 0;

  // ---- grouped ----
  if (groupColumn) {
    const buckets = new Map<string, { key: string; count: number; total: number }>();
    for (const r of rows) {
      const k = (r[groupColumn] ?? 'Not set') || 'Not set';
      const b = buckets.get(k) ?? { key: k, count: 0, total: 0 };
      b.count += 1; b.total += num(r);
      buckets.set(k, b);
    }
    const groups = Array.from(buckets.values())
      .sort((a, b) => (measure === 'count' ? b.count - a.count : b.total - a.total))
      .slice(0, 12);
    return NextResponse.json({
      ok: true, kind: 'grouped', measure, entity: entity.label,
      amountLabel: body.amountLabel ?? null,
      groupLabel: body.groupBy.label,
      total: rows.length,
      groups,
      summary: body.summary,
      href: '/dashboard' + (entity.table === 'stock_trailers' ? '/sales' : entity.table === 'crm_contacts' ? '/leads' : '/calendar'),
    });
  }

  // ---- single figure ----
  if (measure === 'count' || !amountColumn) {
    return NextResponse.json({
      ok: true, kind: 'number', measure: 'count', entity: entity.label,
      value: rows.length, summary: body.summary,
      sample: rows.slice(0, 5).map((r) => ({
        id: r.id,
        title: r[entity.titleColumn] ?? '(no name)',
        sub: entity.subtitleColumns.map((c) => r[c]).filter(Boolean).join(' · '),
      })),
      href: entity.hrefFor ? undefined : undefined,
      listHref: entity.table === 'stock_trailers' ? '/dashboard/sales'
              : entity.table === 'crm_contacts' ? '/dashboard/leads' : '/dashboard/calendar',
    });
  }

  const values = rows.map(num);
  const total = values.reduce((a, b) => a + b, 0);
  const withValue = values.filter((v) => v !== 0).length;

  return NextResponse.json({
    ok: true, kind: 'number', measure, entity: entity.label,
    amountLabel: body.amountLabel ?? null,
    value: measure === 'avg' ? (withValue ? total / withValue : 0) : total,
    rowCount: rows.length,
    withValue,
    money: true,
    summary: body.summary,
    listHref: entity.table === 'stock_trailers' ? '/dashboard/sales'
            : entity.table === 'crm_contacts' ? '/dashboard/leads' : '/dashboard/calendar',
  });
}
