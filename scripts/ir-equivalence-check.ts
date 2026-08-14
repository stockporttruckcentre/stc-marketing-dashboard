/* =============================================================
   Does the canonical IR carry everything the old plan carried?

   The adapter is only worth landing if crossing into the IR loses
   nothing and invents nothing. This builds ONE canonical description of
   what a sentence means from the original `QueryPlan`, builds a second
   one independently by reading the adapted `Select` back out, and
   compares the two objects for deep equality.

   WHY A PROJECTION RATHER THAN A LIST OF ASSERTIONS.

   The previous version of this file asked a few dozen separate
   questions per sentence, and a large total of passing assertions read
   as proof when it was not. Several of those questions could not fail.
   `new Set(fields).size >= 0` is true of every set there has ever been.
   Others were satisfied by a near miss: "this filter's value appears
   somewhere in the tree" passes when the value landed on the wrong
   column, and "the period survives" passes when the dates are wrong.

   Deep equality on a complete projection has neither weakness. Anything
   dropped, anything altered and anything invented is a difference in
   the object, and a difference is a failure. There is no partial credit
   and no assertion that cannot fail.

   WHAT IS NORMALISED, AND WHY THAT IS NOT CHEATING.

   Only orderings that carry no meaning, and encodings of one meaning:

     - conjoined filters are sorted, because `a and b` is `b and a`
     - columns and values inside one filter are sorted, for the same
       reason
     - `ilike` and a one-branch `anyOf` both project to `contains`,
       because a substring test on one column with one value is what
       both of them are
     - `present` and a negated `empty` both project to `present`,
       because "has a value" is what both of them are

   Nothing else is smoothed over. The operator, the exact column, every
   value, negation, the exact period bounds, the date the period is
   measured against, grouping, ordering, limit, scope, the comparison
   dimension AND its values, and the exact semantics of a derived
   attribute are all compared as they are.

     npm run check:ir
   ============================================================= */
import { parseQuery, type QueryPlan } from '../lib/command/query';
import { adaptQueryPlan } from '../lib/command/ir/adapt';
import { validate, derivedRequirements } from '../lib/command/ir/validate';
import type { Cond, Expr, Select, EntityRef } from '../lib/command/ir/types';
import type { How } from '../lib/command/grammar';
import { BODY_TYPES, DEPOTS, STATE_PHRASES } from '../lib/command/lexicon';
import { ENTITIES } from '../lib/command/schema';
import { loadSampleVocabulary } from './sample-vocabulary';

loadSampleVocabulary();

/* =============================================================
   The canonical description of a sentence's meaning.
   ============================================================= */

type FilterFact = {
  op: 'eq' | 'contains' | 'gte' | 'lte' | 'empty' | 'present' | string;
  columns: string[];
  values: string[];
  negate: boolean;
};

type Semantics = {
  entity: string;
  measure: 'count' | 'sum' | 'avg' | 'list';
  amount: string | null;
  derived: { id: string; from: string; how: How } | null;
  filters: FilterFact[];
  period: { from: string; to: string; column: string } | null;
  groupBy: string | null;
  order: { column: string; direction: string } | null;
  limit: number | null;
  compare: { column: string; values: string[] } | null;
  scope: 'actor' | 'all';
  /** rows, scalar or series. Part of the meaning, not decoration. */
  yields: string;
};

const sortFacts = (fs: FilterFact[]) =>
  fs.slice().sort((a, b) => (a.op + a.columns.join() + a.values.join() + a.negate)
    .localeCompare(b.op + b.columns.join() + b.values.join() + b.negate));

/** Stable JSON, so key order cannot make two equal objects differ. */
function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/* =============================================================
   Side one: straight off the QueryPlan.
   ============================================================= */

function fromQueryPlan(p: QueryPlan): Semantics {
  const filters: FilterFact[] = p.filters.map((f) => {
    const columns = (f.columns?.length ? f.columns : [f.column]).slice().sort();
    const many = (f.values?.length ? f.values : [f.value]).map(String);
    let negate = !!f.negate;
    let op: string;
    let values: string[];

    switch (f.op) {
      case 'eq': op = 'eq'; values = [String(f.value)]; break;
      case 'ilike': op = 'contains'; values = [String(f.value)]; break;
      case 'anyOf': op = 'contains'; values = many; break;
      case 'gte': op = 'gte'; values = [String(Number(f.value))]; break;
      case 'lte': op = 'lte'; values = [String(Number(f.value))]; break;
      case 'empty':
        op = negate ? 'present' : 'empty'; values = []; negate = false; break;
      case 'present':
        op = negate ? 'empty' : 'present'; values = []; negate = false; break;
      default: op = `unhandled:${f.op}`; values = many;
    }
    return { op, columns, values: values.slice().sort(), negate };
  });

  const periodColumn = p.rangeColumn ?? p.entity.dateColumn;
  const aggregated = p.measure !== 'list';
  const grouped = !!p.groupBy || !!p.compare;

  return {
    entity: p.entity.id,
    measure: p.measure as Semantics['measure'],
    amount: p.amountColumn ?? null,
    derived: p.derived ? { id: p.derived.id, from: p.derived.from, how: p.derived.how } : null,
    filters: sortFacts(filters),
    period: p.range && periodColumn
      ? { from: p.range.from, to: p.range.to, column: periodColumn }
      : null,
    groupBy: p.groupBy?.column ?? null,
    order: p.order ? { column: p.order.column, direction: p.order.direction } : null,
    limit: p.limit ?? null,
    compare: p.compare ? { column: p.compare.column, values: p.compare.values.map(String) } : null,
    scope: p.scope === 'mine' ? 'actor' : 'all',
    yields: aggregated ? (grouped ? 'series' : 'scalar') : 'rows',
  };
}

/* =============================================================
   Side two: recovered from the IR by walking it.

   Nothing here consults the QueryPlan. If the adapter wrote a value
   onto the wrong column, this reads the wrong column back and the
   comparison fails, which is the entire purpose.
   ============================================================= */

/** Peel `not` nodes, counting parity. Double negation is not negation. */
function peel(c: Cond): { inner: Cond; negate: boolean } {
  let inner = c;
  let negate = false;
  while (inner.kind === 'not') { negate = !negate; inner = inner.of; }
  return { inner, negate };
}

function plainField(e: Expr): string | null {
  return e.kind === 'field' && !('via' in e.of) ? e.of.field : null;
}

function literal(e: Expr): string | null {
  return e.kind === 'literal' ? String(e.value) : null;
}

/** Top level conjuncts. A single condition is a conjunction of one. */
function conjuncts(c: Cond | undefined): Cond[] {
  if (!c) return [];
  return c.kind === 'and' ? c.of.flatMap(conjuncts) : [c];
}

type Recovered = { filters: FilterFact[]; period: Semantics['period'] };

function recoverConditions(where: Cond | undefined): Recovered {
  const filters: FilterFact[] = [];
  let period: Semantics['period'] = null;

  for (const raw of conjuncts(where)) {
    const { inner, negate } = peel(raw);

    if (inner.kind === 'within') {
      const column = plainField(inner.of);
      if (!column || inner.period.kind !== 'absolute' || negate) {
        filters.push({ op: 'unreadable:within', columns: [String(column)], values: [], negate });
        continue;
      }
      if (period) {
        filters.push({ op: 'duplicate:within', columns: [column], values: [], negate: false });
        continue;
      }
      period = { from: inner.period.from, to: inner.period.to, column };
      continue;
    }

    if (inner.kind === 'empty') {
      const column = plainField(inner.of);
      filters.push({
        op: negate ? 'present' : 'empty',
        columns: [column ?? 'unreadable'], values: [], negate: false,
      });
      continue;
    }

    if (inner.kind === 'cmp') {
      const column = plainField(inner.left);
      const value = literal(inner.right);
      if (column === null || value === null) {
        filters.push({ op: `unreadable:cmp.${inner.op}`, columns: [], values: [], negate });
        continue;
      }
      filters.push({ op: inner.op, columns: [column], values: [value], negate });
      continue;
    }

    if (inner.kind === 'or') {
      /* The adapter spreads one idea over columns times values. Reading
         it back as distinct columns and distinct values only recovers
         the original if the branches really are that rectangle, so the
         count is checked rather than assumed. */
      const columns = new Set<string>();
      const values = new Set<string>();
      let readable = true;
      let op: string | null = null;
      for (const b of inner.of) {
        if (b.kind !== 'cmp') { readable = false; break; }
        const column = plainField(b.left);
        const value = literal(b.right);
        if (column === null || value === null) { readable = false; break; }
        if (op !== null && op !== b.op) { readable = false; break; }
        op = b.op;
        columns.add(column);
        values.add(value);
      }
      if (!readable || columns.size * values.size !== inner.of.length) {
        filters.push({ op: 'unreadable:or', columns: [], values: [], negate });
        continue;
      }
      filters.push({
        op: op ?? 'unreadable:or',
        columns: [...columns].sort(),
        values: [...values].sort(),
        negate,
      });
      continue;
    }

    filters.push({ op: `unreadable:${inner.kind}`, columns: [], values: [], negate });
  }

  return { filters: sortFacts(filters), period };
}

function recoverDerived(select: Select): Semantics['derived'] {
  for (const c of select.select ?? []) {
    const e = c.expr.kind === 'agg' && c.expr.of ? c.expr.of : c.expr;
    if (e.kind === 'duration') {
      const fromField = plainField(e.from);
      const toField = plainField(e.to);
      const fromNow = e.from.kind === 'context' && e.from.slot === 'now';
      const toNow = e.to.kind === 'context' && e.to.slot === 'now';
      if (fromNow && toField) return { id: c.as, from: toField, how: 'days until' };
      if (toNow && fromField) return { id: c.as, from: fromField, how: 'days since' };
      return { id: c.as, from: 'unreadable', how: 'days since' };
    }
    if (e.kind === 'binary' && e.op === '/') {
      const left = plainField(e.left);
      return { id: c.as, from: left ?? 'unreadable', how: 'ratio' };
    }
  }
  return null;
}

function fromIR(select: Select): Semantics {
  const { filters, period } = recoverConditions(select.where);
  const columns = select.select ?? [];
  const agg = columns.map((c) => c.expr).find((e) => e.kind === 'agg');

  const measure: Semantics['measure'] =
    !agg || agg.kind !== 'agg' ? 'list'
      : agg.fn === 'count' ? 'count'
        : agg.fn === 'avg' ? 'avg'
          : agg.fn === 'sum' ? 'sum'
            : 'list';

  /* The measured column, whether it is what an aggregate reduces or a
     plain projection on a list. Both are "which number this question is
     about", and only reading the aggregate missed the second. */
  const amount = (agg && agg.kind === 'agg' && agg.of ? plainField(agg.of) : null)
    ?? columns.map((c) => c.expr).reduce<string | null>((found, e) =>
      found ?? (e.kind === 'agg' ? null : plainField(e)), null);

  const groupBy = select.shape?.groupBy?.[0];
  const order = select.shape?.orderBy?.[0];
  const compare = select.shape?.compare;

  return {
    entity: (select.from as EntityRef).entity,
    measure,
    amount,
    derived: recoverDerived(select),
    filters,
    period,
    groupBy: groupBy ? plainField(groupBy) : null,
    order: order
      ? { column: plainField(order.by) ?? 'unreadable', direction: order.direction }
      : null,
    limit: select.shape?.limit ?? null,
    compare: compare && 'by' in compare
      ? {
          column: plainField(compare.by) ?? 'unreadable',
          values: (compare.values ?? []).map((v) => literal(v) ?? 'unreadable'),
        }
      : null,
    scope: select.scope?.kind === 'actor' ? 'actor' : 'all',
    yields: select.produces?.kind ?? 'none',
  };
}

/* =============================================================
   The comparison.
   ============================================================= */

let checked = 0, failed = 0;
const failures: string[] = [];
const ok = (sentence: string, what: string, cond: boolean, detail = '') => {
  checked++;
  if (cond) return;
  failed++;
  if (failures.length < 20) {
    failures.push(`  "${sentence}"\n    ${what}${detail ? `\n${detail}` : ''}`);
  }
};

/** The first line on which two canonical objects differ. */
function difference(a: Semantics, b: Semantics): string {
  const lines: string[] = [];
  for (const k of Object.keys(a).sort() as (keyof Semantics)[]) {
    const left = canonical(a[k]);
    const right = canonical(b[k]);
    if (left !== right) lines.push(`      ${k}\n        plan: ${left}\n        ir:   ${right}`);
  }
  return lines.join('\n');
}

function compare(sentence: string, p: QueryPlan): void {
  const { select, plan, lost } = adaptQueryPlan(p);

  ok(sentence, 'the adapter recorded nothing as lost', lost.length === 0,
    `      ${lost.map((l) => `${l.part}: ${l.why}`).join('; ')}`);

  const want = fromQueryPlan(p);
  const got = fromIR(select);
  ok(sentence, 'the meaning recovered from the IR is identical to the meaning of the plan',
    canonical(want) === canonical(got), difference(want, got));

  const problems = validate(plan).filter((x) => x.severity === 'fatal');
  ok(sentence, 'the adapted plan validates', problems.length === 0,
    `      ${problems.map((x) => `${x.at}: ${x.what}`).join('; ')}`);

  ok(sentence, 'the plan declares what it needs', derivedRequirements(plan).length > 0);

  ok(sentence, 'every unmet part of the request crossed over',
    plan.unmet.filter((u) => u.part === 'reader').length === (p.unmet ?? []).length);
}

/* -------------------------------------------------------------
   Sentences, generated the same way the existing checks generate.
   ------------------------------------------------------------- */
const BODIES = Object.keys(BODY_TYPES);
const DEPOT_WORDS = Object.keys(DEPOTS);
const STATES = STATE_PHRASES.flatMap((p) => p.words);
const MEASURES = ['how many', 'list', 'total value of', 'average profit on'];
const PERIODS = ['', ' this week', ' last month', ' this year', ' in the past 30 days'];
const SHAPES = ['', ' by make', ' by depot', ' cheapest first', ' newest first'];

const sentences = new Set<string>();

for (const m of MEASURES) {
  for (const b of BODIES) {
    for (const s of STATES) sentences.add(`${m} ${b} trailers ${s}`);
  }
}
for (const b of BODIES) {
  for (const d of DEPOT_WORDS) {
    for (const p of PERIODS) sentences.add(`how many ${b} trailers at ${d}${p}`);
  }
}
for (const b of BODIES) {
  for (const sh of SHAPES) sentences.add(`list ${b} trailers in stock${sh}`);
}
for (const e of ENTITIES) {
  for (const f of e.filters) {
    for (const w of Object.keys(f.vocabulary ?? {})) {
      sentences.add(`how many ${w} ${e.label}`);
      sentences.add(`list ${w} ${e.label}`);
    }
  }
  for (const a of e.amounts) {
    sentences.add(`total ${a.words[0]} on ${e.label}`);
    sentences.add(`average ${a.words[0]} on ${e.label}`);
  }
  for (const d of e.dimensions) sentences.add(`${e.label} by ${d.words[0]}`);
}
for (const d of DEPOT_WORDS) {
  sentences.add(`trailers at ${d} with no retail price`);
  sentences.add(`trailers at ${d} under 5k`);
  sentences.add(`trailers at ${d} excluding sold ones`);
}
/* Sentences that carry a derived attribute, a comparison or both, so
   those paths are compared rather than merely present in the types. */
for (const d of DEPOT_WORDS) {
  sentences.add(`stock age of trailers at ${d}`);
  sentences.add(`how many trailers at ${d} by stock age`);
  sentences.add(`average stock age of trailers at ${d}`);
  sentences.add(`days until mot on trailers at ${d}`);
  sentences.add(`margin percentage on sold trailers at ${d}`);
  for (const e of DEPOT_WORDS) {
    if (e !== d) sentences.add(`how many trailers at ${d} versus ${e}`);
  }
}
for (const b of BODIES) {
  sentences.add(`how long since we spoke to contacts about ${b} trailers`);
  sentences.add(`list ${b} trailers by stock age oldest first`);
}

/* ------------------------------------------------------------- */

let planned = 0;
let identical = 0;
for (const s of sentences) {
  const p = parseQuery(s);
  if (!p) continue;
  planned++;
  const before = failed;
  compare(s, p);
  if (failed === before) identical++;
}

console.log(`\n  ${sentences.size.toLocaleString('en-GB')} sentences generated, `
  + `${planned.toLocaleString('en-GB')} produced a QueryPlan.`);
console.log(`  ${identical.toLocaleString('en-GB')}/${planned.toLocaleString('en-GB')} `
  + `crossed into the IR with an identical canonical meaning.`);
console.log(`  ${(checked - failed).toLocaleString('en-GB')}/${checked.toLocaleString('en-GB')} `
  + `checks hold (${planned.toLocaleString('en-GB')} deep-equality comparisons `
  + `plus validation, requirements and unmet carriage).\n`);

if (failures.length) {
  console.log('  first differences:');
  for (const f of failures) console.log(f);
  console.log();
}
if (failed) process.exitCode = 1;
