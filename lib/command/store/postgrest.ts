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
import type {
  ApplyOutcome, Change, Invocation, InvokeOutcome, ReadOutcome, ReadRequest, Store,
} from '../ir/store';

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
/**
 * A condition as one PostgREST filter string.
 *
 * Needed inside `or`, where the branches cannot be separate calls on the
 * builder. PostgREST nests with `and(...)` and `or(...)`, so an `or` over
 * anything more than plain comparisons is expressible after all: the
 * first version of this refused everything but a flat list of them,
 * which is why "sold in the last six months" could not be asked at all
 * once the sale date became two columns and a rule.
 *
 * `null` means this store genuinely cannot express it, and the caller
 * refuses rather than dropping the branch.
 */
function serialise(c: Cond): string | null {
  switch (c.kind) {
    case 'and':
    case 'or': {
      const parts = c.of.map(serialise);
      if (parts.some((p) => p === null)) return null;
      return `${c.kind}(${parts.join(',')})`;
    }
    case 'not': {
      /* Double negation is not negation, and peeling first is what stops
         `not.not.` reaching PostgREST as a column called "not". */
      let inner: Cond = c.of;
      let negate = true;
      while (inner.kind === 'not') { negate = !negate; inner = inner.of; }

      const s = serialise(inner);
      if (s === null) return null;
      if (!negate) return s;

      /* PostgREST negates a nested tree with a `not.` prefix and a
         single column condition with `not` AFTER the column. Writing the
         tree form for a column produced `not.status.eq.proposal`, which
         it reads as a column named "not", and the whole read came back
         as unsupported. */
      if (/^(?:and|or)\(/.test(s)) return `not.${s}`;
      const dot = s.indexOf('.');
      return dot < 0 ? null : `${s.slice(0, dot)}.not.${s.slice(dot + 1)}`;
    }
    case 'cmp': {
      const column = plainField(c.left);
      const value = literalOf(c.right);
      if (column === null || value === undefined) return null;
      switch (c.op) {
        case 'eq': return `${column}.eq.${escape(value)}`;
        case 'neq': return `${column}.neq.${escape(value)}`;
        case 'contains': return `${column}.ilike.*${escape(value)}*`;
        case 'startsWith': return `${column}.ilike.${escape(value)}*`;
        case 'gt': return `${column}.gt.${escape(value)}`;
        case 'gte': return `${column}.gte.${escape(value)}`;
        case 'lt': return `${column}.lt.${escape(value)}`;
        case 'lte': return `${column}.lte.${escape(value)}`;
        default: return null;
      }
    }
    case 'empty': {
      const column = plainField(c.of);
      return column === null ? null : `${column}.is.null`;
    }
    case 'within': {
      const column = plainField(c.of);
      if (column === null || c.period.kind !== 'absolute') return null;
      return `and(${column}.gte.${c.period.from.slice(0, 10)},${column}.lte.${c.period.to.slice(0, 10)})`;
    }
    default: return null;
  }
}

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
      const clauses = c.of.map(serialise);
      const bad = clauses.find((x) => x === null);
      if (bad === null && clauses.some((x) => x === null)) {
        return { q, unsupported: 'an or this cannot express' };
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
    case 'not': {
      /* Negation goes through the same serialiser as an `or` branch,
         because that is the only place PostgREST accepts a condition
         written out rather than built up. `or` over a single member is
         that member. */
      const s = serialise(c);
      if (s === null) return { q, unsupported: 'a negation this cannot express' };
      return { q: q.or(s) };
    }
    case 'in': {
      const column = plainField(c.of);
      if (column === null || !Array.isArray(c.values)) {
        return { q, unsupported: 'an unreadable set membership' };
      }
      const values = c.values.map(literalOf);
      if (values.some((v) => v === undefined)) return { q, unsupported: 'a set with a computed member' };
      return { q: q.in(column, values) };
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

      let q = narrowed.q;
      for (const o of req.orderBy ?? []) {
        q = q.order(o.column, { ascending: o.direction === 'asc', nullsFirst: false });
      }

      /* `range` rather than `limit`, because a page after the first
         needs an offset and PostgREST expresses both as one call. */
      const from = req.offset ?? 0;
      const { data, error } = from
        ? await q.range(from, from + req.limit - 1)
        : await q.limit(req.limit);
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

    /**
     * A business operation, as the database function that performs it.
     *
     * One entry per capability, and the mapping is here rather than in
     * the command layer because which function performs a sale is a
     * property of this database and not of the language. A capability
     * with no function is refused by name rather than by silence.
     */
    async invoke(call: Invocation): Promise<InvokeOutcome> {
      if (!supabase.rpc) return { ok: false, why: 'this client cannot perform operations' };

      const fn = FUNCTIONS[call.capability];
      if (!fn) return { ok: false, why: `nothing in this database performs ${call.capability}` };

      const { data, error } = await supabase.rpc(fn.name, fn.args(call));
      if (error) return { ok: false, why: String((error as { message?: string }).message ?? error) };

      const results = Array.isArray(data) ? data : data == null ? [] : [data];
      return { ok: true, performed: call.subjects.length, results };
    },
  };
}

/**
 * Which database function performs which capability.
 *
 * Every one of these takes the whole set of subjects, because one
 * function is one transaction and calling a single subject function in a
 * loop from here would be several.
 */
const FUNCTIONS: Record<string, { name: string; args: (c: Invocation) => Record<string, unknown> }> = {
  'list.create': {
    name: 'command_create_list',
    args: (c) => ({
      p_name: c.args.name ?? null,
      p_ids: c.subjects,
      p_owner: c.args.actorId ?? null,
    }),
  },
  'deal.markSold': {
    name: 'command_mark_sold_many',
    args: (c) => ({
      p_tracker_ids: c.subjects,
      p_rep_initials: c.args.repInitials ?? 'Unknown',
      p_sale_price: c.args.salePrice ?? null,
      p_dispatch_date: c.args.dispatchDate ?? null,
      p_today: c.args.today ?? null,
    }),
  },
};
