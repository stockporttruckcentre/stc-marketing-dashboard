/* =============================================================
   Running a canonical Select.

   The read executor in `app/api/command/query/route.ts` answers a
   question on screen: it counts, groups, works out a derived attribute
   and hands back something to render. This does one narrower thing and
   does it for anything: given a `Select`, produce the ROWS it describes,
   through the same `Store` a mutation resolves through.

   That is what a file needs. An export is not a second kind of question
   and must never be a second reading of one: the file has to hold
   exactly the rows the selection described, so it is built from the
   selection rather than from a copy of the sentence.

   WHAT IT PROJECTS, AND WHY THAT IS NOT A LIST SOMEBODY MAINTAINS.

   Every column comes from the registry and from the plan:

     the entity's title            what the row is called
     the entity's subtitle columns what it is, at a glance
     every column the SELECTION mentions   so the thing you asked about
                                           is visible in the answer
     every column the ORDER mentions       same reason
     the entity's own amounts and dates    the figures people export for

   Nothing is written down per entity, so an entity added to the
   registry exports without anybody touching this file, and a column
   that stops existing stops being exported.
   ============================================================= */
import type { Cond, Expr, Plan, Select, Source } from './types';
import { entity as entityDef, type FieldDef } from './registry';
import type { Store } from './store';

/* -------------------------------------------------------------
   Following the dataflow back to the rows
   ------------------------------------------------------------- */

/**
 * The selection behind a source, following references through the plan.
 *
 * A `ResultRef` does not have to land on a select. In
 *
 *   find customers with more than 20 trailers,
 *   create a list called Fleet Prospects from them,
 *   export it to Excel
 *
 * "it" is the list, and the list is a record. A file of that record is
 * one row holding a name and a date, which is not what anybody asking
 * that sentence wants. The rows are the ones the list was made from, so
 * a reference to an operation resolves to the operation's SUBJECT.
 *
 * That rule is about the shape of the dataflow and not about lists:
 * "mark them as sold and export it" resolves the same way, through
 * `deal.markSold`, without either step being named here.
 *
 * `null` where the chain does not reach a selection at all, which is a
 * refusal for every caller rather than a licence to read something else.
 */
export function selectBehind(plan: Plan, source: Source | undefined): Select | null {
  const seen = new Set<string>();

  const walk = (s: Source | undefined): Select | null => {
    if (!s) return null;
    if ('op' in s) return s.op === 'select' ? (s as Select) : null;
    if (!('ref' in s)) {
      /* A bare entity: everything in it, which is what "export the
         customers" says when nothing narrowed it. */
      return { op: 'select', from: s };
    }
    if (seen.has(s.step)) return null;
    seen.add(s.step);

    const step = plan.steps.find((x) => x.id === s.step);
    if (!step) return null;
    if (step.op === 'select') return step as Select;
    if (step.op === 'invoke') return walk(step.subject);
    if (step.op === 'update' || step.op === 'delete' || step.op === 'create') return walk(step.match);
    /* An artefact is the rows that went into it. "Export it to Excel
       and share it with Dave" shares the customers, not a spreadsheet
       nobody can grant access to. */
    if (step.op === 'emit') return walk(step.from);
    return null;
  };

  return walk(source);
}

export type ReadRows = {
  entity: string;
  /** Column keys, in the order they should be shown. */
  columns: string[];
  /** Human labels for those columns, from the registry. */
  labels: string[];
  rows: Record<string, unknown>[];
  /** True when the ceiling stopped this short of everything. */
  capped: boolean;
};

export type ReadFailure = { ok: false; why: string };
export type ReadResult = ({ ok: true } & ReadRows) | ReadFailure;

/* -------------------------------------------------------------
   Which columns
   ------------------------------------------------------------- */

/** Every plain field a condition names. */
/**
 * Every column a condition mentions.
 *
 * Exported because a file of "the rows that step touched" is read by
 * id, and the columns the SENTENCE talked about have to survive that:
 * "mark the in stock curtainsiders sold and export the result" wants
 * the status in the file, and the id condition mentions nothing.
 */
export function fieldsInCond(c: Cond, out: Set<string>): void {
  const expr = (e: Expr): void => {
    switch (e.kind) {
      case 'field': if (!('via' in e.of)) out.add(e.of.field); return;
      case 'binary': expr(e.left); expr(e.right); return;
      case 'shift': expr(e.of); return;
      case 'duration': expr(e.from); expr(e.to); return;
      case 'agg': if (e.of) expr(e.of); if (e.where) fieldsInCond(e.where, out); return;
      case 'window': expr(e.of); return;
      case 'case': e.when.forEach((w) => { fieldsInCond(w.if, out); expr(w.then); }); return;
      case 'reference': fieldsInCond(e.where, out); return;
      case 'list': e.of.forEach(expr); return;
      default: return;
    }
  };
  switch (c.kind) {
    case 'and': case 'or': c.of.forEach((x) => fieldsInCond(x, out)); return;
    case 'not': fieldsInCond(c.of, out); return;
    case 'cmp': expr(c.left); expr(c.right); return;
    case 'between': expr(c.of); expr(c.from); expr(c.to); return;
    case 'in': expr(c.of); if (Array.isArray(c.values)) c.values.forEach(expr); return;
    case 'empty': case 'within': expr(c.of); return;
    case 'near': expr(c.of); expr(c.origin); return;
    case 'related': if (c.where) fieldsInCond(c.where, out); return;
    default: return;
  }
}

/**
 * The columns a file should carry for this selection.
 *
 * Derived, never listed. See the header for the five sources and why
 * each one is there.
 */
export function projectionFor(select: Select): { columns: string[]; labels: string[] } | null {
  const id = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  const def = id ? entityDef(id) : null;
  if (!def) return null;

  const known = new Map<string, FieldDef>(def.fields.map((f) => [f.field, f]));
  const wanted = new Set<string>();

  if (def.titleField) wanted.add(def.titleField);
  for (const f of def.subtitleFields) wanted.add(f);

  if (select.where) fieldsInCond(select.where, wanted);
  for (const o of select.shape?.orderBy ?? []) {
    if (o.by.kind === 'field' && !('via' in o.by.of)) wanted.add(o.by.of.field);
  }
  for (const c of select.select ?? []) {
    if (c.expr.kind === 'field' && !('via' in c.expr.of)) wanted.add(c.expr.of.field);
  }

  for (const f of def.fields) {
    if (f.role === 'system') continue;
    if (f.aggregatable || f.kind === 'date') wanted.add(f.field);
  }

  /* Registry order, so two exports of the same entity look the same. */
  const columns = def.fields
    .map((f) => f.field)
    .filter((f) => wanted.has(f) && known.get(f)?.role !== 'system');

  return {
    columns,
    labels: columns.map((c) => known.get(c)?.label ?? c),
  };
}

/* -------------------------------------------------------------
   Running it
   ------------------------------------------------------------- */

export type RunSelectOptions = {
  store: Store;
  /**
   * How many rows to fetch per request.
   *
   * A page size, not a ceiling. The read pages until the pages stop
   * coming, because a selection that matches eight thousand records
   * means eight thousand records: an implementation limit that quietly
   * returns five thousand of them produces an answer that looks
   * complete and is not.
   */
  pageSize?: number;
  /**
   * The most rows this caller will accept, if it has a maximum at all.
   *
   * Absent means no maximum. Present and exceeded means REFUSE, never
   * truncate: the whole point is that the semantic selection and the set
   * that gets acted on or written out are the same set.
   */
  ceiling?: number;
  /**
   * Columns the caller needs that the projection would not include.
   *
   * The projection answers "what should a FILE of this selection show",
   * which is not the same question as "what does this operation need to
   * read off each record". A role change wants the role somebody holds
   * now, and nothing about the selection mentions it.
   */
  extraColumns?: string[];
};

/** Rows per request. Nothing about this number is semantic. */
export const PAGE_SIZE = 1000;

/**
 * Every row a selection describes.
 *
 * Pages until it has them all. `capped` is true only where a ceiling was
 * given AND exceeded, and every caller of this treats that as a refusal
 * rather than as a set to work with.
 */
export async function runSelect(select: Select, opts: RunSelectOptions): Promise<ReadResult> {
  const id = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  const def = id ? entityDef(id) : null;
  if (!def) return { ok: false, why: `nothing here holds ${String(id)}` };

  const projection = projectionFor(select);
  if (!projection) return { ok: false, why: `nothing here holds ${def.id}` };

  const orderBy = (select.shape?.orderBy ?? [])
    .map((o) => (o.by.kind === 'field' && !('via' in o.by.of)
      ? { column: o.by.of.field, direction: o.direction }
      : null))
    .filter((x): x is { column: string; direction: 'asc' | 'desc' } => x !== null);

  /* A limit the SENTENCE asked for is part of the answer: "the five
     cheapest" is five, and "the top 100" is a hundred. A ceiling the
     IMPLEMENTATION imposes is a different thing entirely and is never
     applied by narrowing the answer. */
  const asked = select.shape?.limit;
  const pageSize = Math.max(opts.pageSize ?? PAGE_SIZE, 1);
  const columns = [...new Set(['id', ...projection.columns, ...(opts.extraColumns ?? [])])];
  const where = select.where ?? { kind: 'and' as const, of: [] };

  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  for (;;) {
    /* One past the ceiling, so exceeding it can be reported rather than
       looking like the end of the data. */
    const remainingToAsk = asked != null ? asked - rows.length : Infinity;
    if (remainingToAsk <= 0) break;
    const want = Math.min(pageSize, remainingToAsk === Infinity ? pageSize : remainingToAsk);

    const page = await opts.store.read({
      table: def.table, columns, where, orderBy, limit: want, offset,
    });
    if (!page.ok) {
      return {
        ok: false,
        why: page.reason === 'unsupported' ? `this selection needs ${page.why}` : page.why,
      };
    }

    rows.push(...page.rows);
    if (opts.ceiling != null && rows.length > opts.ceiling) {
      return { ok: true, entity: def.id, columns: projection.columns, labels: projection.labels, rows, capped: true };
    }
    if (page.rows.length < want) break;
    offset += page.rows.length;
  }

  return {
    ok: true,
    entity: def.id,
    columns: projection.columns,
    labels: projection.labels,
    rows,
    capped: false,
  };
}
