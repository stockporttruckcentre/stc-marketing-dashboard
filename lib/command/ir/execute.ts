/* =============================================================
   The narrow compatibility layer between the canonical IR and the
   executor that already exists.

   The read executor in `app/api/command/query/route.ts` was written
   against `QueryPlan` and works. Rewriting it in the same change that
   moves the application onto the IR would mean changing the meaning and
   the machinery at once, with no way to tell which one caused a
   difference. So the executor stays, and this reads the canonical
   `Select` and produces the shape it already consumes.

   The DIRECTION is the point:

     legacy reader -> canonical IR -> this -> executor

   and not

     canonical IR alongside, while the application keeps deciding
     from QueryPlan

   Nothing downstream of `planCommand` sees a `QueryPlan` again. This
   file takes a `Select` and could not consult one if it wanted to,
   which is enforced by the argument type rather than by intention.

   When the executor is rewritten against `Select` directly, this file
   is deleted and nothing else changes.
   ============================================================= */
import type { Cond, Expr, Plan, Select, Step, EntityRef } from './types';
import { capability, destination } from './registry';

/* =============================================================
   Reading a Select back into the executor's wire shape
   ============================================================= */

/** The body `app/api/command/query/route.ts` accepts. */
export type QueryPayload = {
  entityId: string;
  measure: 'count' | 'sum' | 'avg' | 'list';
  amountColumn: string | null;
  amountLabel: string | null;
  filters: {
    column: string; op: string; value: string;
    columns?: string[]; values?: string[]; negate?: boolean;
  }[];
  groupBy: { column: string; label: string } | null;
  range: { from: string; to: string } | null;
  rangeColumn: string | null;
  scope: 'mine' | 'all';
  order: { column: string; direction: 'asc' | 'desc'; label: string } | null;
  limit: number | null;
  derived: { id: string; from: string; how: string; label: string } | null;
  compare: { column: string; values: string[] } | null;
  summary: string;
};

function plainField(e: Expr): string | null {
  return e.kind === 'field' && !('via' in e.of) ? e.of.field : null;
}

function literal(e: Expr): string | null {
  return e.kind === 'literal' && e.value != null ? String(e.value) : null;
}

function conjuncts(c: Cond | undefined): Cond[] {
  if (!c) return [];
  return c.kind === 'and' ? c.of.flatMap(conjuncts) : [c];
}

/** Peel `not` nodes, counting parity. Double negation is not negation. */
function peel(c: Cond): { inner: Cond; negate: boolean } {
  let inner = c;
  let negate = false;
  while (inner.kind === 'not') { negate = !negate; inner = inner.of; }
  return { inner, negate };
}

/**
 * How a derived attribute is worked out, read back off the expression.
 *
 * The executor takes a name and a `how`, because it does the
 * subtraction on the rows. The IR holds the subtraction itself, so this
 * reads the shape and reports which of the three it is.
 */
function readDerived(select: Select): QueryPayload['derived'] {
  for (const c of select.select ?? []) {
    const e = c.expr.kind === 'agg' && c.expr.of ? c.expr.of : c.expr;
    if (e.kind === 'duration') {
      const fromField = plainField(e.from);
      const toField = plainField(e.to);
      if (e.from.kind === 'context' && e.from.slot === 'now' && toField) {
        return { id: c.as, from: toField, how: 'days until', label: c.as };
      }
      if (e.to.kind === 'context' && e.to.slot === 'now' && fromField) {
        return { id: c.as, from: fromField, how: 'days since', label: c.as };
      }
    }
    if (e.kind === 'binary' && e.op === '/') {
      const left = plainField(e.left);
      if (left) return { id: c.as, from: left, how: 'ratio', label: c.as };
    }
  }
  return null;
}

/**
 * Presentation the executor echoes back, carried separately.
 *
 * The summary and the labels are not meaning and are deliberately not
 * in the IR. They travel beside it so the answer still reads the way it
 * always did, and nothing decides anything from them.
 */
export type Presentation = {
  summary: string;
  amountLabel?: string | null;
  groupLabel?: string | null;
  orderLabel?: string | null;
  derivedLabel?: string | null;
};

export function selectToQueryPayload(select: Select, p: Presentation): QueryPayload {
  const filters: QueryPayload['filters'] = [];
  let range: QueryPayload['range'] = null;
  let rangeColumn: string | null = null;

  for (const raw of conjuncts(select.where)) {
    const { inner, negate } = peel(raw);

    if (inner.kind === 'within') {
      const column = plainField(inner.of);
      if (column && inner.period.kind === 'absolute') {
        range = { from: inner.period.from, to: inner.period.to };
        rangeColumn = column;
      }
      continue;
    }

    if (inner.kind === 'empty') {
      const column = plainField(inner.of);
      /* `not empty` is `present`. The executor has both operators, so
         the negation is spent here rather than passed on. */
      if (column) filters.push({ column, op: negate ? 'present' : 'empty', value: '' });
      continue;
    }

    if (inner.kind === 'cmp') {
      const column = plainField(inner.left);
      const value = literal(inner.right);
      if (column === null || value === null) continue;
      const op = inner.op === 'contains' ? 'ilike' : inner.op;
      filters.push({ column, op, value, ...(negate ? { negate: true } : {}) });
      continue;
    }

    if (inner.kind === 'or') {
      /* One idea spread across the columns that carry it. The executor
         calls this `anyOf` and wants the columns and the values, which
         are the distinct field names and literals of the branches. */
      const columns: string[] = [];
      const values: string[] = [];
      let readable = true;
      for (const b of inner.of) {
        if (b.kind !== 'cmp') { readable = false; break; }
        const column = plainField(b.left);
        const value = literal(b.right);
        if (column === null || value === null) { readable = false; break; }
        if (!columns.includes(column)) columns.push(column);
        if (!values.includes(value)) values.push(value);
      }
      if (!readable || !columns.length || !values.length) continue;
      filters.push({
        column: columns[0], op: 'anyOf', value: values[0], columns, values,
        ...(negate ? { negate: true } : {}),
      });
      continue;
    }
  }

  const columns = select.select ?? [];
  const agg = columns.map((c) => c.expr).find((e) => e.kind === 'agg');
  const measure: QueryPayload['measure'] =
    !agg || agg.kind !== 'agg' ? 'list'
      : agg.fn === 'count' ? 'count'
        : agg.fn === 'avg' ? 'avg'
          : agg.fn === 'sum' ? 'sum' : 'list';

  /* The measured column, whether an aggregate reduces it or a list
     simply shows it. */
  const amountColumn =
    (agg && agg.kind === 'agg' && agg.of ? plainField(agg.of) : null)
    ?? columns.map((c) => c.expr).reduce<string | null>(
      (found, e) => found ?? (e.kind === 'agg' ? null : plainField(e)), null);

  const groupBy = select.shape?.groupBy?.[0];
  const order = select.shape?.orderBy?.[0];
  const compare = select.shape?.compare;
  const derived = readDerived(select);

  return {
    entityId: (select.from as EntityRef).entity,
    measure,
    amountColumn,
    amountLabel: p.amountLabel ?? null,
    filters,
    groupBy: groupBy && plainField(groupBy)
      ? { column: plainField(groupBy) as string, label: p.groupLabel ?? plainField(groupBy) as string }
      : null,
    range,
    rangeColumn,
    scope: select.scope?.kind === 'actor' ? 'mine' : 'all',
    order: order && plainField(order.by)
      ? {
          column: plainField(order.by) as string,
          direction: order.direction,
          label: p.orderLabel ?? plainField(order.by) as string,
        }
      : null,
    limit: select.shape?.limit ?? null,
    derived: derived ? { ...derived, label: p.derivedLabel ?? derived.label } : null,
    compare: compare && 'by' in compare && plainField(compare.by)
      ? {
          column: plainField(compare.by) as string,
          values: (compare.values ?? []).map((v) => literal(v) ?? ''),
        }
      : null,
    summary: p.summary,
  };
}

/* =============================================================
   Can this application actually carry this plan out?

   Separate from "is it valid" and separate from "is this person
   allowed". A capability can be representable in the IR, permitted for
   the actor, and still impossible because nothing performs it.
   `rows.email` is exactly that today: a real capability, gated by a
   real permission, with no handler behind it.

   Offering it anyway is how a command bar teaches people it is
   unreliable, which is the same failure as offering an action somebody
   is not allowed to run.
   ============================================================= */

export type Unavailable = {
  step: number;
  /** The registry capability that is missing, or a description of what is. */
  need: string;
  why: 'nothing performs it' | 'nothing is registered to perform it';
};

/** Which registry capabilities a step needs in order to run at all. */
function capabilitiesForStep(s: Step): { ids: string[]; unregistered: string[] } {
  switch (s.op) {
    case 'select': return { ids: ['data.read'], unregistered: [] };
    case 'update': return { ids: ['record.updateField'], unregistered: [] };
    /* Nothing in the registry declares `operates: 'create'` or
       `'delete'`, so no canonical executor performs either yet. Saying
       so is the honest answer while the mutation readers are still
       unmigrated. */
    case 'create': return { ids: [], unregistered: ['a create'] };
    case 'delete': return { ids: [], unregistered: ['a delete'] };
    case 'invoke': return { ids: [s.capability], unregistered: [] };
    case 'emit': {
      const ids: string[] = [];
      if (s.output.kind === 'file') ids.push('rows.export');
      const dest = destination(s.to.kind);
      if (dest?.capability) ids.push(dest.capability);
      return { ids, unregistered: [] };
    }
    default: return { ids: [], unregistered: [] };
  }
}

export function executability(plan: Plan): { executable: boolean; missing: Unavailable[] } {
  const missing: Unavailable[] = [];
  plan.steps.forEach((s, step) => {
    const { ids, unregistered } = capabilitiesForStep(s);
    for (const need of unregistered) {
      missing.push({ step, need, why: 'nothing is registered to perform it' });
    }
    for (const id of ids) {
      const cap = capability(id);
      if (!cap) { missing.push({ step, need: id, why: 'nothing is registered to perform it' }); continue; }
      if (!cap.handler) missing.push({ step, need: id, why: 'nothing performs it' });
    }
  });
  return { executable: missing.length === 0, missing };
}
