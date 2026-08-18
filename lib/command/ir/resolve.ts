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
import type { Expr, Mutate, Plan, Select } from './types';
import { entity as entityDef, field as fieldDef } from './registry';
import type { Store } from './store';

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

/** One row a reference could have meant. */
export type ReferenceCandidate = { id: string; label: string; value: unknown };

/**
 * What became of one symbolic reference.
 *
 * Four outcomes, and the two failures that used to be one are the
 * point. "Dave" matching nobody is a mistake in the instruction and
 * there is nothing to ask about. "Dave" matching two people is a
 * question with two answers, and the interface can only ask it if the
 * answers come back. Collapsing both into "ambiguous" left the caller
 * unable to tell an empty list from a choice.
 */
export type ReferenceOutcome =
  | { state: 'resolved'; at: string; entity: string; id: string; value: unknown }
  | { state: 'no match'; at: string; entity: string; why: string }
  | { state: 'ambiguous'; at: string; entity: string; why: string; candidates: ReferenceCandidate[] }
  | { state: 'unresolvable'; at: string; entity: string; why: string };

export type Resolution =
  | {
      ok: true;
      stepId: string;
      rows: ResolvedRow[];
      references: ResolvedReference[];
      /** Every field read or written, which is what the hash covers. */
      fields: string[];
      hash: string;
    }
  | {
      ok: false;
      stepId: string;
      reason: 'nothing matched' | 'ambiguous' | 'unresolvable';
      why: string;
      /** For an ambiguous SELECTION: the rows it could have meant. */
      candidates?: ResolvedRow[];
      /** For an ambiguous REFERENCE: which one, and what it could mean. */
      reference?: ReferenceOutcome;
    };

/* Where the rows come from is a `Store`, which knows nothing about how
   they are stored. See `lib/command/ir/store.ts`. */

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
/**
 * One reference, looked up.
 *
 * Exported because an OPERATION can take one as an argument. "Invite
 * Dave to the site visit on Friday" carries "the person whose name
 * contains Dave", and resolving it a second way inside the invoke
 * resolver would be a second answer to what "several Daves" means.
 */
export async function resolveReference(
  store: Store, e: Extract<Expr, { kind: 'reference' }>, at: string,
): Promise<ReferenceOutcome> {
  const def = entityDef(e.entity);
  if (!def) return { state: 'unresolvable', at, entity: e.entity, why: `nothing here holds ${e.entity}` };

  const title = def.titleField ?? null;
  const read = await store.read({
    table: def.table,
    columns: [...new Set(['id', e.select, ...(title ? [title] : [])])],
    where: e.where,
    limit: 50,
  });
  if (!read.ok) {
    return {
      state: 'unresolvable', at, entity: e.entity,
      why: read.reason === 'unsupported'
        ? `that needs ${read.why}, which cannot be looked up`
        : read.why,
    };
  }
  const rows = read.rows;

  if (!rows.length) {
    return { state: 'no match', at, entity: e.entity, why: `no ${def.labelOne} here matches that` };
  }
  if (rows.length > 1 && e.onAmbiguity !== 'all') {
    return {
      state: 'ambiguous', at, entity: e.entity,
      why: `${rows.length} ${def.label} match that, so it is not clear which was meant`,
      candidates: rows.map((r) => ({
        id: String(r.id),
        label: labelOf(r, title),
        value: r[e.select],
      })),
    };
  }
  return { state: 'resolved', at, entity: e.entity, id: String(rows[0].id), value: rows[0][e.select] };
}

async function resolveReferences(
  store: Store, m: Mutate,
): Promise<{ ok: true; refs: ResolvedReference[] } | { ok: false; outcome: ReferenceOutcome }> {
  const refs: ResolvedReference[] = [];

  const lookup = (e: Extract<Expr, { kind: 'reference' }>, at: string) =>
    resolveReference(store, e, at);

  /** Every reference inside one expression, in the order they appear. */
  const walk = async (e: Expr, at: string): Promise<ReferenceOutcome | null> => {
    if (e.kind === 'binary') {
      return (await walk(e.left, `${at}.left`)) ?? (await walk(e.right, `${at}.right`));
    }
    if (e.kind === 'shift') return walk(e.of, `${at}.of`);
    if (e.kind !== 'reference') return null;

    const outcome = await lookup(e, at);
    if (outcome.state !== 'resolved') return outcome;
    refs.push({ at, entity: outcome.entity, id: outcome.id, value: outcome.value });
    return null;
  };

  for (const [i, a] of (m.set ?? []).entries()) {
    const problem = await walk(a.to, `set[${i}].to`);
    if (problem) return { ok: false, outcome: problem };
  }
  return { ok: true, refs };
}

export type ResolveOptions = {
  store: Store;
  /**
   * Which step to resolve.
   *
   * Required. A plan is a program and may hold several mutations, and
   * a resolver that picked the first one silently carried out part of a
   * command while reporting the whole of it. Choosing is the caller's
   * job, and `orchestrate.ts` is what does the choosing for a whole
   * plan.
   */
  stepId: string;
  /**
   * How many rows to read before giving up.
   *
   * A guard on this function's own memory, not a rule about how large a
   * command may be. Whether a large change is allowed is execution
   * policy and lives in `orchestrate.ts`: the language must be able to
   * represent a change to a thousand records whatever policy then says
   * about running it.
   */
  readCap?: number;
  /**
   * The rows each earlier step resolved to.
   *
   * What lets a step say "the ones the last step touched" rather than
   * repeating its condition. Filled in by `resolveProgramme` as it goes,
   * which is the only place the answer exists.
   */
  resolvedIds?: Map<string, string[]>;
};

/**
 * Find the rows one step is about, and what they currently hold.
 *
 * Refuses rather than narrows. A sentence that named one record and
 * found six comes back as `ambiguous` with all six, and the caller asks.
 * Nothing here decides whether a large change is allowed: the language
 * has to be able to represent a change to a thousand records, and
 * whether it runs is execution policy.
 */
export async function resolveMutation(
  plan: Plan, opts: ResolveOptions,
): Promise<Resolution> {
  const stepId = opts.stepId;
  const store = opts.store;
  const step = plan.steps.find((s) => s.id === stepId) as Mutate | undefined;
  type Failure = Extract<Resolution, { ok: false }>;
  const fail = (reason: Failure['reason'], why: string, extra: Partial<Failure> = {}): Failure =>
    ({ ok: false, stepId, reason, why, ...extra });

  if (!step) return fail('unresolvable', `this plan has no step "${stepId}"`);
  if (step.op !== 'update' && step.op !== 'delete') {
    return fail('unresolvable', `step "${stepId}" changes no existing rows`);
  }

  const def = entityDef(step.target.entity);
  if (!def) return fail('unresolvable', `nothing here holds ${step.target.entity}`);

  /* WHICH ROWS, INCLUDING "THE ONES THE LAST STEP TOUCHED".
     A step can name an earlier step's result rather than a condition:
     "create a lead and put it on Fleet Prospects" is one intention, and
     the second half has no condition of its own. Resolution is
     sequential, so by the time this runs the earlier step's rows are
     known and the reference becomes a selection by id.

     A reference to a step whose rows are NOT known is a reference to
     something that has not happened, which is refused rather than
     guessed at. */
  let match = step.match;
  if (match && !('op' in match) && 'ref' in match) {
    const from = (match as { step: string }).step;
    const ids = opts.resolvedIds?.get(from);
    if (!ids) {
      return fail('unresolvable',
        `step "${stepId}" is about what "${from}" produces, and that has not been worked out yet`);
    }
    if (!ids.length) {
      return fail('nothing matched', `"${from}" matched no records, so there is nothing to change`);
    }
    match = {
      op: 'select',
      from: { entity: step.target.entity },
      where: {
        kind: 'in',
        of: { kind: 'field', of: { entity: step.target.entity, field: 'id' } },
        values: ids.map((id) => ({ kind: 'literal' as const, value: id })),
      },
      produces: { kind: 'rows', entity: step.target.entity },
    };
  }
  if (!match || !('op' in match)) {
    return fail('unresolvable', `step "${stepId}" does not say which rows`);
  }

  /* References first. A value that cannot be resolved means the write
     has no value, and finding that out after reading ten thousand rows
     helps nobody. */
  const refs = await resolveReferences(opts.store, step);
  if (!refs.ok) {
    const o = refs.outcome;
    /* `resolved` never reaches here, and the four states map onto three
       reasons without either failure losing its own meaning. */
    return fail(
      o.state === 'no match' ? 'nothing matched'
        : o.state === 'ambiguous' ? 'ambiguous' : 'unresolvable',
      o.state === 'resolved' ? 'that reference resolved' : o.why,
      { reference: o },
    );
  }

  const fields = fieldsTouched(step);
  const title = def.titleField ?? null;

  /* A ceiling on what this function reads into memory, not a ceiling on
     what may be asked for. Reaching it is reported so the caller knows
     the set is bigger than what came back. */
  const readCap = opts.readCap ?? 5_000;
  const read = await store.read({
    table: def.table,
    columns: [...new Set(['id', ...(title ? [title] : []), ...fields])],
    where: (match as Select).where ?? { kind: 'and', of: [] },
    limit: readCap + 1,
  });
  if (!read.ok) {
    return fail('unresolvable',
      read.reason === 'unsupported' ? `this selection needs ${read.why}` : read.why);
  }

  const found = read.rows;
  if (found.length > readCap) {
    return fail('unresolvable',
      `that is more than ${readCap.toLocaleString('en-GB')} records, which is more than can be read at once`);
  }

  const rows: ResolvedRow[] = found.map((r) => ({
    id: String(r.id),
    label: labelOf(r, title),
    before: Object.fromEntries(fields.map((f) => [f, r[f] ?? null])),
  }));

  if (!rows.length) return fail('nothing matched', 'nothing here matches that');

  /* WHAT THE SENTENCE SAID, against what was found. */
  if (step.expect === 'one' && rows.length > 1) {
    return fail('ambiguous',
      `that names ${rows.length} records, and the instruction was about one`,
      { candidates: rows.slice(0, 25) });
  }

  return {
    ok: true,
    stepId,
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
