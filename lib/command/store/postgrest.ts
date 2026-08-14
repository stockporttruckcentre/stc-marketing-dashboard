/* =============================================================
   The current database, behind the store contract.

   Everything that knows this is Supabase lives here. The condition tree
   becomes a PostgREST query, and a set of changes becomes one call to
   `command_apply`, which is one plpgsql function and therefore one
   transaction. Above this file the language knows only `read` and
   `apply`.

   That boundary is the point. The plan is that this access layer gets
   replaced, and when it does the command language, its validation, its
   permission contracts and its orchestration semantics should not
   notice. A second implementation of `Store` is the whole migration.

   WHAT THIS DOES NOT WIDEN.

   Row level security still applies to every read and every write here.
   `command_apply` is SECURITY INVOKER, so a row the caller cannot update
   on their own is a row this cannot update either. What the database
   enforces and what the application authorises are two different
   boundaries, and this file is on the near side of the first.
   ============================================================= */
import type { Cond, Expr } from '../ir/types';
import type { ApplyOutcome, Change, ReadOutcome, ReadRequest, Store } from '../ir/store';

/** The slice of the client this needs, so nothing here imports one. */
export type Queryable = {
  from: (table: string) => any;
  rpc?: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

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
export function applyCond(q: any, c: Cond): { q: any; unsupported?: string } {
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

/**
 * The store, over the client this application currently has.
 *
 * One call to `command_apply` per command, never one per change.
 * Several PostgREST updates are several transactions, so a command whose
 * third statement fails has already changed the CRM twice, and undoing
 * that from application code means compensating updates that can
 * themselves fail.
 */
export function postgrestStore(supabase: Queryable): Store {
  return {
    async read(req: ReadRequest): Promise<ReadOutcome> {
      const narrowed = applyCond(
        supabase.from(req.table).select(req.columns.join(', ')),
        req.where,
      );
      if (narrowed.unsupported) return { ok: false, reason: 'unsupported', why: narrowed.unsupported };

      const { data, error } = await narrowed.q.limit(req.limit);
      if (error) {
        return { ok: false, reason: 'failed', why: String((error as { message?: string }).message ?? error) };
      }
      return { ok: true, rows: (data ?? []) as Record<string, unknown>[] };
    },

    async apply(changes: Change[]): Promise<ApplyOutcome> {
      if (!supabase.rpc) {
        return { ok: false, why: 'this client cannot apply changes atomically' };
      }
      const { data, error } = await supabase.rpc('command_apply', { p_changes: changes });
      if (error) return { ok: false, why: String((error as { message?: string }).message ?? error) };

      const changed = typeof data === 'number' ? data
        : Array.isArray(data) ? data.length
          : (data as { changed?: number } | null)?.changed ?? changes.length;
      return { ok: true, changed };
    },
  };
}
