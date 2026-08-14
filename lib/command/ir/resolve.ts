/* =============================================================
   Turning a plan into the rows it is actually about.

   Planning is deliberately ignorant of the database. It knows the
   sentence said "the profile named Dave" and does not know which
   profile that is, because finding out is a question for the data and
   not for the words. This is where that question gets asked.

   THE TWO HASHES DO DIFFERENT JOBS.

     planHash        what the sentence MEANS
     resolutionHash  which actual objects that meaning found, and what
                     they currently hold

   Both have to survive from preview to confirmation. The first catches
   a sentence that came to mean something else. The second catches the
   rows moving underneath it: somebody else changed the price, a trailer
   arrived at Hyde, the customer whose name matched was renamed.

   `set retail price to NBV plus 20%` is the case that shows why the
   second cannot be a list of ids. Nothing about the ids changes when
   the NBV changes, and the number that would be written changes
   completely. So the hash covers every field the mutation READS as well
   as every field it writes, and every reference it resolved.

   CARDINALITY IS NOT A ROW COUNT.

   The plan already said whether the sentence named one row or many.
   This compares what it found against what was said, and never the
   other way round. Forty matches for a sentence that named one customer
   is a question to ask, not permission to write forty.
   ============================================================= */
import { createHash } from 'crypto';
import type { Cond, Expr, Mutate, Plan, Select } from './types';
import { entity as entityDef, field as fieldDef } from './registry';

/* -------------------------------------------------------------
   What comes back
   ------------------------------------------------------------- */

export type ResolvedRow = {
  id: string;
  /** How the row names itself to a person. */
  label: string;
  /** Every field this mutation reads or writes, as it stands now. */
  before: Record<string, unknown>;
};

export type ResolvedReference = {
  /** Where in the plan it appeared, so a preview can point at it. */
  at: string;
  entity: string;
  /** The row it named, so drift can tell "Dave" changing from "Dave" leaving. */
  id: string;
  value: unknown;
};

export type Resolution =
  | {
      ok: true;
      rows: ResolvedRow[];
      references: ResolvedReference[];
      /** Every field read or written, which is what the hash covers. */
      fields: string[];
      hash: string;
    }
  | {
      ok: false;
      reason: 'nothing matched' | 'ambiguous' | 'unresolvable';
      why: string;
      /** For `ambiguous`: the rows it could have meant. Never one of them. */
      candidates?: ResolvedRow[];
    };

/** The slice of Supabase this needs, so nothing here imports a client. */
export type Queryable = { from: (table: string) => any };

/* -------------------------------------------------------------
   Which fields the mutation touches
   ------------------------------------------------------------- */

/**
 * Every column whose value takes part.
 *
 * Written fields, and every field READ by the expressions that produce
 * the new values. Reading only the written ones is what would let
 * `retail price = nbv * 1.2` drift silently: nothing about the retail
 * price changed between preview and confirmation, and the answer did.
 */
export function fieldsTouched(m: Mutate): string[] {
  const out = new Set<string>();

  const fromExpr = (e: Expr): void => {
    switch (e.kind) {
      case 'field':
        if (!('via' in e.of)) out.add(e.of.field);
        return;
      case 'binary': fromExpr(e.left); fromExpr(e.right); return;
      case 'shift': fromExpr(e.of); return;
      case 'duration': fromExpr(e.from); fromExpr(e.to); return;
      case 'agg': if (e.of) fromExpr(e.of); return;
      case 'window': fromExpr(e.of); return;
      case 'case':
        e.when.forEach((w) => fromExpr(w.then));
        if (e.else) fromExpr(e.else);
        return;
      default: return;
    }
  };

  for (const a of m.set ?? []) {
    out.add(a.field.field);
    fromExpr(a.to);
  }
  return [...out].sort();
}

/* -------------------------------------------------------------
   Conditions, as a query
   ------------------------------------------------------------- */

const escape = (v: unknown) => String(v).replace(/[,()]/g, '');

function plainField(e: Expr): string | null {
  return e.kind === 'field' && !('via' in e.of) ? e.of.field : null;
}
function literalOf(e: Expr): string | number | boolean | null | undefined {
  return e.kind === 'literal' ? e.value : undefined;
}

/**
 * Narrow a PostgREST query by a condition.
 *
 * Only the shapes a plan can currently contain. Anything else refuses,
 * rather than being quietly dropped: a filter that vanishes turns "the
 * sold ones at Hyde" into "everything", which is the single most
 * dangerous way for a write to go wrong.
 */
function applyCond(q: any, c: Cond): { q: any; unsupported?: string } {
  switch (c.kind) {
    case 'and': {
      let out = q;
      for (const inner of c.of) {
        const step = applyCond(out, inner);
        if (step.unsupported) return step;
        out = step.q;
      }
      return { q: out };
    }
    case 'or': {
      /* Every branch has to be a simple comparison for PostgREST's `or`
         to express it. That is what the adapter produces. */
      const clauses: string[] = [];
      for (const b of c.of) {
        if (b.kind !== 'cmp') return { q, unsupported: `or over ${b.kind}` };
        const column = plainField(b.left);
        const value = literalOf(b.right);
        if (column === null || value === undefined) return { q, unsupported: 'or over an unreadable comparison' };
        clauses.push(b.op === 'contains'
          ? `${column}.ilike.%${escape(value)}%`
          : `${column}.eq.${escape(value)}`);
      }
      return { q: q.or(clauses.join(',')) };
    }
    case 'cmp': {
      const column = plainField(c.left);
      const value = literalOf(c.right);
      if (column === null || value === undefined) return { q, unsupported: 'an unreadable comparison' };
      switch (c.op) {
        case 'eq': return { q: q.eq(column, value) };
        case 'neq': return { q: q.neq(column, value) };
        case 'contains': return { q: q.ilike(column, `%${escape(value)}%`) };
        case 'startsWith': return { q: q.ilike(column, `${escape(value)}%`) };
        case 'gt': return { q: q.gt(column, value) };
        case 'gte': return { q: q.gte(column, value) };
        case 'lt': return { q: q.lt(column, value) };
        case 'lte': return { q: q.lte(column, value) };
        default: return { q, unsupported: `the ${c.op} comparison` };
      }
    }
    case 'empty': {
      const column = plainField(c.of);
      if (column === null) return { q, unsupported: 'an unreadable emptiness test' };
      return { q: q.or(`${column}.is.null,${column}.eq.`) };
    }
    case 'within': {
      const column = plainField(c.of);
      if (column === null || c.period.kind !== 'absolute') {
        return { q, unsupported: 'that period' };
      }
      return { q: q.gte(column, c.period.from.slice(0, 10)).lte(column, c.period.to.slice(0, 10)) };
    }
    default:
      return { q, unsupported: `the ${c.kind} condition` };
  }
}

/* -------------------------------------------------------------
   Resolving
   ------------------------------------------------------------- */

function labelOf(row: Record<string, unknown>, title: string | null): string {
  const v = title ? row[title] : null;
  return v == null || v === '' ? String(row.id) : String(v);
}

/**
 * Resolve every reference in a mutation's expressions.
 *
 * A reference names a row and does not say which. Several matches is
 * the thing that must never be silently narrowed: the policy on the
 * reference decides, and there is no policy that means "pick one".
 */
async function resolveReferences(
  supabase: Queryable, m: Mutate,
): Promise<{ ok: true; refs: ResolvedReference[] } | { ok: false; reason: Resolution extends { ok: false } ? never : never; why: string; ambiguous: boolean; candidates?: ResolvedRow[] }> {
  const refs: ResolvedReference[] = [];

  const walk = async (e: Expr, at: string): Promise<string | null> => {
    if (e.kind === 'binary') {
      return (await walk(e.left, `${at}.left`)) ?? (await walk(e.right, `${at}.right`));
    }
    if (e.kind === 'shift') return walk(e.of, `${at}.of`);
    if (e.kind !== 'reference') return null;

    const def = entityDef(e.entity);
    if (!def) return `nothing here holds ${e.entity}`;

    const title = def.titleField ?? null;
    const columns = [...new Set(['id', e.select, ...(title ? [title] : [])])].join(', ');
    let q = supabase.from(def.table).select(columns);
    const narrowed = applyCond(q, e.where);
    if (narrowed.unsupported) return `${at} needs ${narrowed.unsupported}, which cannot be looked up`;
    q = narrowed.q;

    const { data, error } = await q.limit(50);
    if (error) return `${at} could not be looked up: ${error.message ?? error}`;
    const rows = (data ?? []) as Record<string, unknown>[];

    if (!rows.length) return `nothing here is called that`;
    if (rows.length > 1 && e.onAmbiguity !== 'all') {
      return `more than one ${def.labelOne} matches, so it is not clear which was meant`;
    }
    refs.push({
      at, entity: e.entity, id: String(rows[0].id), value: rows[0][e.select],
    });
    return null;
  };

  for (const [i, a] of (m.set ?? []).entries()) {
    const problem = await walk(a.to, `set[${i}].to`);
    if (problem) return { ok: false, reason: undefined as never, why: problem, ambiguous: true };
  }
  return { ok: true, refs };
}

export type ResolveOptions = {
  supabase: Queryable;
  /** How many rows a bulk write may touch before it is refused. */
  limit?: number;
};

/**
 * Find the rows a plan is about, and what they currently hold.
 *
 * Refuses rather than narrows. A sentence that named one record and
 * found six comes back as `ambiguous` with all six, and the caller asks.
 */
export async function resolveMutation(
  plan: Plan, opts: ResolveOptions,
): Promise<Resolution> {
  const step = plan.steps.find((s) => s.op === 'update' || s.op === 'delete') as Mutate | undefined;
  if (!step || step.op === 'create') {
    return { ok: false, reason: 'unresolvable', why: 'this plan changes no existing rows' };
  }

  const def = entityDef(step.target.entity);
  if (!def) return { ok: false, reason: 'unresolvable', why: `nothing here holds ${step.target.entity}` };

  const match = step.match;
  if (!match || !('op' in match)) {
    return { ok: false, reason: 'unresolvable', why: 'this plan does not say which rows' };
  }

  /* References first. A value that cannot be resolved means the write
     has no value, and finding that out after selecting ten thousand
     rows helps nobody. */
  const refs = await resolveReferences(opts.supabase, step);
  if (!refs.ok) return { ok: false, reason: 'ambiguous', why: refs.why };

  const fields = fieldsTouched(step);
  const title = def.titleField ?? null;
  const columns = [...new Set(['id', ...(title ? [title] : []), ...fields])].join(', ');

  let q = opts.supabase.from(def.table).select(columns);
  const narrowed = applyCond(q, (match as Select).where ?? { kind: 'and', of: [] });
  if (narrowed.unsupported) {
    return { ok: false, reason: 'unresolvable', why: `this selection needs ${narrowed.unsupported}` };
  }
  q = narrowed.q;

  const cap = opts.limit ?? 500;
  const { data, error } = await q.limit(cap + 1);
  if (error) return { ok: false, reason: 'unresolvable', why: String(error.message ?? error) };

  const found = (data ?? []) as Record<string, unknown>[];
  const rows: ResolvedRow[] = found.map((r) => ({
    id: String(r.id),
    label: labelOf(r, title),
    before: Object.fromEntries(fields.map((f) => [f, r[f] ?? null])),
  }));

  if (!rows.length) {
    return { ok: false, reason: 'nothing matched', why: 'nothing here matches that' };
  }

  /* WHAT THE SENTENCE SAID, against what was found. */
  if (step.expect === 'one' && rows.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      why: `that names ${rows.length} records, and the instruction was about one`,
      candidates: rows.slice(0, 25),
    };
  }
  if (step.expect === 'many' && rows.length > cap) {
    return {
      ok: false,
      reason: 'unresolvable',
      why: `that is more than ${cap} records, which is more than this will change at once`,
    };
  }

  return {
    ok: true,
    rows,
    references: refs.refs,
    fields,
    hash: resolutionHash(rows, refs.refs, fields),
  };
}

/* -------------------------------------------------------------
   The drift fingerprint
   ------------------------------------------------------------- */

function canonical(x: unknown): string {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/**
 * Everything the preview was built from.
 *
 * The rows, in a stable order, with every field the mutation reads or
 * writes, and every reference it resolved with the row it landed on. A
 * fingerprint over ids alone would miss the whole class of change that
 * makes a preview a lie: the values moving while the selection stays
 * the same.
 */
export function resolutionHash(
  rows: ResolvedRow[], references: ResolvedReference[], fields: string[],
): string {
  const body = canonical({
    fields: [...fields].sort(),
    rows: rows
      .map((r) => ({ id: r.id, before: r.before }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    references: references
      .map((r) => ({ at: r.at, entity: r.entity, id: r.id, value: r.value }))
      .sort((a, b) => a.at.localeCompare(b.at)),
  });
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
