import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { ENTITIES } from '@/lib/command/schema';
import { planForExecution } from '@/lib/command/server/planner';
import { vocabularyFor } from '@/lib/command/server/vocabulary';
import { planningToQueryPayload } from '@/lib/command/plan';

export const dynamic = 'force-dynamic';

/**
 * Answers a question, planned canonically, on the reading that was
 * agreed to.
 *
 * The body is the sentence somebody typed and the hash of the meaning
 * they were shown. The plan is built HERE, from the text, through the
 * same `planAuthoritatively` the preview endpoint calls and with the
 * same live vocabulary loaded. A client cannot send a plan: there is no
 * parameter one could arrive through.
 *
 * The hash is not a credential. The plan that runs is the one built
 * here whatever the client sends. What the hash catches is a sentence
 * that honestly means something different now than when it was
 * previewed, because a trailer was sold or a customer was added and a
 * word that named nothing now names a make. That gets previewed again
 * rather than run.
 *
 * Then four gates, in this order:
 *
 *   1  the plan is well formed                validate
 *   2  the actor holds every permission        derivedRequirements
 *   3  something actually performs it          executability
 *   4  the request was understood in full      completion
 *
 * Every column still comes from the dictionary in lib/command/schema,
 * never from the request, so an unexpected filter key is dropped rather
 * than reaching the database. Values are still passed as parameters
 * through the Supabase builder.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  const raw = await req.json().catch(() => ({})) as { text?: unknown; hash?: unknown };
  const text = typeof raw.text === 'string' ? raw.text : '';
  const previewHash = typeof raw.hash === 'string' ? raw.hash : '';
  if (!text.trim()) return NextResponse.json({ error: 'no question' }, { status: 400 });

  const agreement = await planForExecution({
    text,
    previewHash,
    capabilities: caps,
    /* Their vocabulary, not the last person's. */
    vocabulary: vocabularyFor(supabase, user.id),
  });

  if (!agreement.agreed && agreement.reason === 'not understood') {
    return NextResponse.json(
      { error: 'nothing in that question matched anything here' }, { status: 400 });
  }
  if (!agreement.agreed) {
    /* The words mean something else now. The new reading goes back for
       preview: answering the question nobody asked would look exactly
       like answering the one they did. */
    return NextResponse.json({
      error: 'what that means has changed since you typed it',
      restated: true,
      ...agreement.planned.meaning,
    }, { status: 409 });
  }

  const { planning, meaning } = agreement.planned;

  if (meaning.completion === 'refused') {
    return NextResponse.json({ error: 'that plan will not run', problems: meaning.blocked },
      { status: 400 });
  }
  if (!planning.availability.permitted) {
    return NextResponse.json({
      error: 'you do not have access to that',
      missing: planning.availability.missingPermissions,
    }, { status: 403 });
  }
  /* Representable, permitted, and still nothing performs it. Saying so
     is better than a five hundred from a route that was never written. */
  if (!planning.availability.executable) {
    return NextResponse.json({
      error: 'nothing here can carry that out yet',
      missing: planning.availability.unavailable.map((u) => `${u.need}: ${u.why}`),
    }, { status: 501 });
  }

  const payload = planningToQueryPayload(planning);
  if (!payload) return NextResponse.json({ error: 'that plan is not a single read' }, { status: 400 });

  /* Partial is never reported as complete. The answer goes back with
     what could not be read, and the bar shows both. */
  const unresolved = meaning.unresolved;
  const answered = (extra: Record<string, unknown>) => NextResponse.json({
    ok: true,
    hash: meaning.hash,
    complete: meaning.completion === 'complete',
    unresolved,
    ...extra,
  });

  const entity = ENTITIES.find((e) => e.id === payload.entityId);
  if (!entity) return NextResponse.json({ error: 'unknown entity' }, { status: 400 });

  const body = payload;

  const measure = body.measure;

  // Only columns the dictionary knows about.
  const allowedFilterColumns = new Set(entity.filters.map((f) => f.column));
  const allowedAmounts = new Set(entity.amounts.map((a) => a.column));
  const allowedDimensions = new Set(entity.dimensions.map((d) => d.column));

  const amountColumn = body.amountColumn && allowedAmounts.has(body.amountColumn)
    ? body.amountColumn : null;
  const groupColumn = body.groupBy && allowedDimensions.has(body.groupBy.column) ? body.groupBy.column : null;

  /* Every date the entity declares, which is the allowlist for sorting
     and for which date a period is measured against. Same principle as
     the filter columns: named by us, never taken from the request. */
  const allowedDates = new Set([
    ...(entity.dates ?? []).map((d) => d.column),
    ...(entity.dateColumn ? [entity.dateColumn] : []),
  ]);
  const sortable = new Set([...allowedAmounts, ...allowedDates, ...allowedFilterColumns]);

  const orderColumn = body.order && sortable.has(body.order.column) ? body.order.column : null;
  const orderDirection = body.order?.direction === 'asc' ? 'asc' : 'desc';
  const limit = Number.isFinite(Number(body.limit))
    ? Math.min(Math.max(Math.trunc(Number(body.limit)), 1), 500) : null;

  /* A derived attribute is worked out on the rows rather than asked of
     the database, so all it needs is the column it comes from. */
  const derivedFrom = body.derived && sortable.has(body.derived.from) ? body.derived.from : null;
  const rangeColumn = body.rangeColumn && allowedDates.has(body.rangeColumn)
    ? body.rangeColumn : entity.dateColumn;

  // Which columns to pull. Enough to render a row, plus whatever is measured.
  const cols = new Set<string>(['id', entity.titleColumn, ...entity.subtitleColumns]);
  if (amountColumn) cols.add(amountColumn);
  if (groupColumn) cols.add(groupColumn);
  if (entity.dateColumn) cols.add(entity.dateColumn);
  if (orderColumn) cols.add(orderColumn);
  if (derivedFrom) cols.add(derivedFrom);
  if (rangeColumn) cols.add(rangeColumn);

  // `any` deliberately: chaining a dozen conditional filters makes the
  // builder's generic depth blow past what tsc will follow.
  let q: any = supabase.from(entity.table).select(Array.from(cols).join(', '));

  /* SCOPE. "Mine" means the deals I hold.
  
     It used to mean rows on a `crm_lists` row whose name contained
     "Sales tracker", so somebody who renamed their tracker asked "how
     many deals have I got open" and was told none. A lead names its
     owner, and a shared lead is mine as much as one I raised. */
  if (body.scope === 'mine' && entity.table === 'crm_leads') {
    q = q.or(`owner_id.eq.${user.id},shared_with.cs.{${user.id}}`);
  }
  if (body.scope === 'mine' && entity.table === 'crm_contacts') {
    q = q.eq('assigned_to', user.id);
  }
  if (body.scope === 'mine' && entity.table === 'calendar_events') {
    q = q.eq('created_by', user.id);
  }
  /* A deal and a contact were rows of one table, so the deals view had
     to exclude anything sitting only on the global list to avoid
     counting every company as a deal. They are separate tables now and
     every row of `crm_leads` is a deal, so there is nothing to exclude. */

  /* A price bracket lands on an amount column rather than a filter
     column, so the allowlist has to cover both. Still an allowlist: the
     column has to be one this entity declares, whichever list it is in. */
  const allowedAmountColumns = new Set(entity.amounts.map((a) => a.column));
  /* Free text columns a spread filter may reach into. Named here rather
     than taken from the request, so the widening is ours and not the
     caller's. */
  const ENTITY_TEXT_COLUMNS = new Set(['model', 'description', 'category', 'status_text']);

  for (const f of (body.filters ?? [])) {
    const isRange = f.op === 'gte' || f.op === 'lte';
    const isEmpty = f.op === 'empty' || f.op === 'present';
    const allowed = isRange || isEmpty
      ? (allowedAmountColumns.has(f.column) || allowedFilterColumns.has(f.column)
         || allowedDates.has(f.column))
      : allowedFilterColumns.has(f.column);
    if (!allowed) continue;

    /* Negation inverts the one clause it was attached to, never the
       whole query. "Everything except trailers that's available" leaves
       the availability alone, and the plan already worked out which
       filter the word "except" was in front of. */
    const no = f.negate === true;

    /* Empty is not a value, it is the absence of one. A blank text
       column in this database is sometimes NULL and sometimes an empty
       string, and a check for one silently misses the other. */
    if (f.op === 'empty' || f.op === 'present') {
      const wantEmpty = (f.op === 'empty') !== no;
      q = wantEmpty
        ? q.or(`${f.column}.is.null,${f.column}.eq.`)
        : q.not(f.column, 'is', null).neq(f.column, '');
      continue;
    }

    /* anyOf spreads one idea across several columns: a curtainsider is
       recorded in category on some rows and in model on others. Built
       from the entity's own declared columns, never from the request. */
    if (f.op === 'anyOf') {
      const cols = (f.columns ?? [f.column]).filter((c: string) =>
        allowedFilterColumns.has(c) || ENTITY_TEXT_COLUMNS.has(c));
      const vals: string[] = (f.values ?? [f.value]).filter(Boolean);
      if (cols.length && vals.length) {
        const clauses = cols.flatMap((c: string) =>
          vals.map((v: string) => `${c}.ilike.%${String(v).replace(/[,()]/g, '')}%`));
        /* Inverted, "any of these" becomes "none of these", and every
           clause has to fail rather than one. */
        if (no) for (const c of cols) for (const v of vals) {
          q = q.not(c, 'ilike', `%${String(v).replace(/[,()]/g, '')}%`);
        }
        else q = q.or(clauses.join(','));
      }
    }
    else if (f.op === 'gte') {
      const n = Number(f.value);
      if (Number.isFinite(n)) q = no ? q.lt(f.column, n) : q.gte(f.column, n);
    }
    else if (f.op === 'lte') {
      const n = Number(f.value);
      if (Number.isFinite(n)) q = no ? q.gt(f.column, n) : q.lte(f.column, n);
    }
    else if (f.op === 'eq') q = no ? q.neq(f.column, f.value) : q.eq(f.column, f.value);
    else q = no ? q.not(f.column, 'ilike', `%${f.value}%`) : q.ilike(f.column, `%${f.value}%`);
  }

  if (body.range && rangeColumn) {
    const from = String(body.range.from).slice(0, 10);
    const to = String(body.range.to).slice(0, 10);
    q = q.gte(rangeColumn, from).lte(rangeColumn, to);
  }

  /* Sorting happens in the database so a limit means the top of the
     whole set rather than the top of the first page pulled back. */
  if (orderColumn) q = q.order(orderColumn, { ascending: orderDirection === 'asc', nullsFirst: false });

  // Supabase caps a page at 1000 rows, so page through for honest totals.
  const rows: any[] = [];
  /* A sorted question with a limit wants the top few, not everything.
     Paging twenty thousand rows to show five is the same answer and a
     much slower one. */
  const pageCap = orderColumn && limit ? limit : 20_000;
  for (let from = 0; from < pageCap; from += 1000) {
    const size = Math.min(1000, pageCap - from);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < size) break;
  }

  /* A derived attribute is a subtraction, worked out here because no
     column holds it. Stock age is the days since a trailer arrived. */
  const DAY = 86_400_000;
  if (derivedFrom && body.derived) {
    const now = Date.now();
    for (const r of rows) {
      const raw = r[derivedFrom];
      const t = raw ? Date.parse(String(raw)) : NaN;
      r.__derived = !Number.isFinite(t) ? null
        : body.derived.how === 'days until' ? Math.round((t - now) / DAY)
        : body.derived.how === 'days since' ? Math.round((now - t) / DAY)
        : null;
    }
  }

  const num = (r: any) =>
    derivedFrom ? (Number(r.__derived) || 0) : (Number(amountColumn ? r[amountColumn] : 0) || 0);

  // ---- grouped ----
  if (groupColumn) {
    const buckets = new Map<string, { key: string; count: number; total: number }>();
    for (const r of rows) {
      const k = (r[groupColumn] ?? 'Not set') || 'Not set';
      const b = buckets.get(k) ?? { key: k, count: 0, total: 0 };
      b.count += 1; b.total += num(r);
      buckets.set(k, b);
    }
    /* Averaging a group means dividing by how many are in it, not by
       how many rows came back. Summed and averaged answers were the
       same number before this, which nobody would notice on a count. */
    let groups = Array.from(buckets.values()).map((b) => ({
      ...b, total: measure === 'avg' ? (b.count ? b.total / b.count : 0) : b.total,
    }));

    /* Comparing two things shows those two, in the order they were
       asked for, and says nothing about the other forty makes. */
    const wanted: string[] = Array.isArray(body.compare?.values) ? body.compare.values : [];
    if (wanted.length) {
      groups = wanted.map((w) => groups.find(
        (g) => String(g.key).toLowerCase().includes(String(w).toLowerCase()))
        ?? { key: w, count: 0, total: 0 });
    } else {
      groups = groups
        .sort((a, b) => (measure === 'count' ? b.count - a.count : b.total - a.total))
        .slice(0, 12);
    }
    return answered({
      kind: 'grouped', measure, entity: entity.label,
      amountLabel: body.derived?.label ?? body.amountLabel ?? null,
      groupLabel: body.groupBy?.label ?? groupColumn,
      total: rows.length,
      groups,
      money: !body.derived,
      summary: body.summary,
      href: '/dashboard' + (entity.table === 'stock_trailers' ? '/sales' : entity.table === 'crm_contacts' ? '/leads' : '/calendar'),
    });
  }

  const listHref = entity.table === 'stock_trailers' ? '/dashboard/sales'
                 : entity.table === 'crm_contacts' ? '/dashboard/leads'
                 : entity.table === 'social_posts' ? '/dashboard/social' : '/dashboard/calendar';

  /* ---- a handful of rows, in order ----
     "The five cheapest available rigids" is a list of five, and
     answering it with the number five is not the same thing. A sorted
     question with a limit comes back as rows. */
  if (orderColumn && limit) {
    const kept = rows.slice(0, limit);
    return answered({
      kind: 'rows', measure: 'list', entity: entity.label,
      value: kept.length,
      total: rows.length,
      orderLabel: body.order?.label ?? null,
      amountLabel: body.derived?.label ?? body.amountLabel ?? null,
      rows: kept.map((r) => ({
        id: r.id,
        title: r[entity.titleColumn] ?? '(no name)',
        sub: entity.subtitleColumns.map((c) => r[c]).filter(Boolean).join(' · '),
        figure: derivedFrom ? r.__derived
              : orderColumn && allowedAmountColumns.has(orderColumn) ? r[orderColumn]
              : r[orderColumn as string] ?? null,
        money: !derivedFrom && allowedAmountColumns.has(orderColumn),
      })),
      summary: body.summary,
      listHref,
    });
  }

  // ---- single figure ----
  if (measure === 'count' || (!amountColumn && !derivedFrom)) {
    return answered({
      kind: 'number', measure: 'count', entity: entity.label,
      value: rows.length, summary: body.summary,
      sample: rows.slice(0, 5).map((r) => ({
        id: r.id,
        title: r[entity.titleColumn] ?? '(no name)',
        sub: entity.subtitleColumns.map((c) => r[c]).filter(Boolean).join(' · '),
      })),
      listHref,
    });
  }

  const values = rows.map(num);
  const total = values.reduce((a, b) => a + b, 0);
  const withValue = values.filter((v) => v !== 0).length;

  return answered({
    kind: 'number', measure, entity: entity.label,
    amountLabel: body.derived?.label ?? body.amountLabel ?? null,
    value: measure === 'avg' ? (withValue ? total / withValue : 0) : total,
    rowCount: rows.length,
    withValue,
    // Stock age is a number of days. Printing it as pounds was the kind
    // of thing that gets read out in a meeting.
    money: !derivedFrom,
    unit: derivedFrom ? 'days' : null,
    summary: body.summary,
    listHref,
  });
}
