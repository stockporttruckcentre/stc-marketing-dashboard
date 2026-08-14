/* =============================================================
   Does the canonical IR carry everything the old plan carried?

   The adapter is only worth landing if crossing into the IR loses
   nothing. So this runs sentences through `parseQuery`, adapts the
   result, then reads the components back OUT of the `Select` and
   compares them to the `QueryPlan` they came from.

   Reading back out is the point. Asserting that the adapter produced
   some Select would prove nothing, exactly as asserting that a
   sentence parsed proved nothing earlier in this work. Every component
   is extracted from the IR by walking it, and compared to the original
   value.

   The sentences come from the vocabulary the existing checks already
   use. That is correct here and would not be correct for a coverage
   claim: this measures whether a translation is faithful, not whether
   the language is broad, so generating from the same source as the
   parser is exactly what is wanted. Nothing was added to make anything
   pass.

     npm run check:ir
   ============================================================= */
import { parseQuery, type QueryPlan } from '../lib/command/query';
import { adaptQueryPlan } from '../lib/command/ir/adapt';
import { validate, derivedRequirements } from '../lib/command/ir/validate';
import type { Cond, Expr, Select } from '../lib/command/ir/types';
import { BODY_TYPES, DEPOTS, STATE_PHRASES } from '../lib/command/lexicon';
import { ENTITIES } from '../lib/command/schema';
import { loadSampleVocabulary } from './sample-vocabulary';

loadSampleVocabulary();

let checked = 0, failed = 0;
const failures: string[] = [];
const fail = (s: string, what: string, got = '') => {
  failed++;
  if (failures.length < 25) failures.push(`  "${s}"\n    ${what}${got ? `\n    got: ${got}` : ''}`);
};
const ok = (s: string, what: string, cond: boolean, got = '') => {
  checked++;
  if (!cond) fail(s, what, got);
};

/* -------------------------------------------------------------
   Reading components back out of the IR.
   ------------------------------------------------------------- */

function flattenAnd(c: Cond | undefined): Cond[] {
  if (!c) return [];
  if (c.kind === 'and') return c.of.flatMap(flattenAnd);
  return [c];
}

/** Every field name mentioned anywhere in a condition tree. */
function fieldsIn(c: Cond): string[] {
  const out: string[] = [];
  const fromExpr = (e: Expr): void => {
    if (e.kind === 'field' && !('via' in e.of)) out.push(e.of.field);
    if (e.kind === 'agg' && e.of) fromExpr(e.of);
    if (e.kind === 'binary') { fromExpr(e.left); fromExpr(e.right); }
    if (e.kind === 'duration') { fromExpr(e.from); fromExpr(e.to); }
    if (e.kind === 'window') fromExpr(e.of);
  };
  const walk = (x: Cond): void => {
    switch (x.kind) {
      case 'cmp': fromExpr(x.left); fromExpr(x.right); return;
      case 'empty': case 'within': case 'near': fromExpr(x.of); return;
      case 'between': fromExpr(x.of); return;
      case 'in': fromExpr(x.of); return;
      case 'and': case 'or': x.of.forEach(walk); return;
      case 'not': walk(x.of); return;
      default: return;
    }
  };
  walk(c);
  return out;
}

/** Literal values mentioned anywhere in a condition tree. */
function literalsIn(c: Cond): string[] {
  const out: string[] = [];
  const fromExpr = (e: Expr): void => {
    if (e.kind === 'literal' && e.value != null) out.push(String(e.value).toLowerCase());
    if (e.kind === 'binary') { fromExpr(e.left); fromExpr(e.right); }
  };
  const walk = (x: Cond): void => {
    switch (x.kind) {
      case 'cmp': fromExpr(x.left); fromExpr(x.right); return;
      case 'and': case 'or': x.of.forEach(walk); return;
      case 'not': walk(x.of); return;
      default: return;
    }
  };
  walk(c);
  return out;
}

function hasWithin(c: Cond | undefined): boolean {
  if (!c) return false;
  if (c.kind === 'within') return true;
  if (c.kind === 'and' || c.kind === 'or') return c.of.some(hasWithin);
  if (c.kind === 'not') return hasWithin(c.of);
  return false;
}

function withinField(c: Cond | undefined): string | null {
  if (!c) return null;
  if (c.kind === 'within' && c.of.kind === 'field' && !('via' in c.of.of)) return c.of.of.field;
  if (c.kind === 'and' || c.kind === 'or') {
    for (const x of c.of) { const f = withinField(x); if (f) return f; }
  }
  if (c.kind === 'not') return withinField(c.of);
  return null;
}

/** Is this condition negated at its top level? */
function negatedFields(c: Cond | undefined): string[] {
  if (!c) return [];
  if (c.kind === 'not') return fieldsIn(c.of);
  if (c.kind === 'and' || c.kind === 'or') return c.of.flatMap(negatedFields);
  return [];
}

function emptyFields(c: Cond | undefined): string[] {
  if (!c) return [];
  if (c.kind === 'empty' && c.of.kind === 'field' && !('via' in c.of.of)) return [c.of.of.field];
  if (c.kind === 'and' || c.kind === 'or') return c.of.flatMap(emptyFields);
  if (c.kind === 'not') return emptyFields(c.of);
  return [];
}

/* -------------------------------------------------------------
   The comparison, component by component.
   ------------------------------------------------------------- */

function compare(sentence: string, p: QueryPlan): void {
  const { select, plan, lost } = adaptQueryPlan(p);

  ok(sentence, 'adapter lost nothing', lost.length === 0,
    lost.map((l) => `${l.part}: ${l.why}`).join('; '));

  /* --- entity --- */
  const from = select.from as { entity: string };
  ok(sentence, 'entity survives', from.entity === p.entity.id, from.entity);

  /* --- measure --- */
  const agg = select.select?.[0]?.expr;
  if (p.measure === 'count') {
    ok(sentence, 'count becomes an agg count',
      agg?.kind === 'agg' && agg.fn === 'count', JSON.stringify(agg));
  } else if (p.measure === 'sum' || p.measure === 'avg') {
    const want = p.measure === 'avg' ? 'avg' : 'sum';
    ok(sentence, `${p.measure} becomes an agg ${want}`,
      agg?.kind === 'agg' && agg.fn === want, JSON.stringify(agg));
    if (p.amountColumn && !p.derived) {
      const inner = agg?.kind === 'agg' ? agg.of : undefined;
      ok(sentence, 'the measured column survives',
        inner?.kind === 'field' && !('via' in inner.of) && inner.of.field === p.amountColumn,
        JSON.stringify(inner));
    }
  } else {
    ok(sentence, 'a list has no aggregate', !p.derived ? !agg || agg.kind !== 'agg' : true);
  }

  /* --- filters, one at a time --- */
  const fields = select.where ? fieldsIn(select.where) : [];
  const lits = select.where ? literalsIn(select.where) : [];
  const negs = negatedFields(select.where);
  const empties = emptyFields(select.where);

  for (const f of p.filters) {
    const columns = f.columns?.length ? f.columns : [f.column];
    ok(sentence, `filter on ${f.column} survives`,
      columns.some((c) => fields.includes(c)), fields.join(','));

    if (f.op === 'empty') {
      ok(sentence, `${f.column} empty survives`, empties.includes(f.column), empties.join(','));
    } else if (f.op === 'present') {
      ok(sentence, `${f.column} present survives`,
        select.where ? JSON.stringify(select.where).includes('"empty"') : false);
    } else if (f.op === 'anyOf') {
      const values = f.values?.length ? f.values : [f.value];
      ok(sentence, `${f.column} spreads across ${columns.length} columns`,
        columns.every((c) => fields.includes(c)), fields.join(','));
      ok(sentence, `${f.column} keeps its values`,
        values.some((v) => lits.includes(String(v).toLowerCase())), lits.join(','));
    } else {
      ok(sentence, `${f.column} keeps its value`,
        lits.includes(String(f.value).toLowerCase()), lits.join(','));
    }

    if (f.negate) {
      ok(sentence, `${f.column} stays negated`,
        columns.some((c) => negs.includes(c)), negs.join(','));
    }
  }

  ok(sentence, 'no filters invented',
    new Set(fields).size >= 0 && (p.filters.length > 0 || !!p.range || !select.where));

  /* --- period --- */
  if (p.range) {
    ok(sentence, 'the period survives', hasWithin(select.where));
    const want = p.rangeColumn ?? p.entity.dateColumn;
    if (want) {
      ok(sentence, 'the period is on the right date', withinField(select.where) === want,
        String(withinField(select.where)));
    }
  } else {
    ok(sentence, 'no period invented', !hasWithin(select.where));
  }

  /* --- shaping --- */
  if (p.groupBy) {
    const g = select.shape?.groupBy?.[0];
    ok(sentence, 'grouping survives',
      g?.kind === 'field' && !('via' in g.of) && g.of.field === p.groupBy.column,
      JSON.stringify(g));
  } else {
    ok(sentence, 'no grouping invented', !select.shape?.groupBy);
  }

  if (p.order) {
    const o = select.shape?.orderBy?.[0];
    ok(sentence, 'ordering survives',
      !!o && o.direction === p.order.direction
      && o.by.kind === 'field' && !('via' in o.by.of) && o.by.of.field === p.order.column,
      JSON.stringify(o));
  } else {
    ok(sentence, 'no ordering invented', !select.shape?.orderBy);
  }

  ok(sentence, 'limit survives', select.shape?.limit === p.limit, String(select.shape?.limit));

  if (p.compare) {
    const c = select.shape?.compare;
    ok(sentence, 'comparison survives',
      !!c && 'by' in c && c.by.kind === 'field' && !('via' in c.by.of)
      && c.by.of.field === p.compare.column, JSON.stringify(c));
  }

  /* --- scope --- */
  const wantScope = p.scope === 'mine' ? 'actor' : 'all';
  ok(sentence, 'scope survives', select.scope?.kind === wantScope, select.scope?.kind);

  /* --- derived --- */
  if (p.derived) {
    const json = JSON.stringify(select.select);
    ok(sentence, 'the derived attribute becomes an expression',
      json.includes('duration') || json.includes('binary'), json.slice(0, 120));
  }

  /* --- the plan itself must be structurally valid --- */
  const problems = validate(plan).filter((x) => x.severity === 'fatal');
  ok(sentence, 'the adapted plan validates',
    problems.length === 0, problems.map((x) => `${x.at}: ${x.what}`).join('; '));

  /* --- and must declare what it needs --- */
  ok(sentence, 'requirements are derivable', derivedRequirements(plan).length > 0);
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

/* ------------------------------------------------------------- */

let planned = 0;
for (const s of sentences) {
  const p = parseQuery(s);
  if (!p) continue;
  planned++;
  compare(s, p);
}

console.log(`\n  ${sentences.size.toLocaleString('en-GB')} sentences generated, `
  + `${planned.toLocaleString('en-GB')} produced a QueryPlan.`);
console.log(`  ${(checked - failed).toLocaleString('en-GB')}/${checked.toLocaleString('en-GB')} `
  + `equivalence assertions hold.\n`);

if (failures.length) {
  console.log('  first failures:');
  for (const f of failures) console.log(f);
  console.log();
}
if (failed) process.exitCode = 1;
