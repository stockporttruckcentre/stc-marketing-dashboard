/* =============================================================
   Sentences nobody wrote down, about this business.

   The rule that makes this test worth running: NOTHING IN THIS FILE MAY
   BE ADDED TO A LEXICON. If a sentence only works after its own words
   are typed into a table, it proves nothing, because the next sentence
   will not be in that table either.

   The first version of this file failed a different way, and it is
   worth saying how, because it is the same class of mistake as the bug
   it was written to catch.

   The ten sentences it used came from outside and were about TRUCKS.
   Rigids, 6x2 axle configurations, mileage, DAF and Volvo. STC sells
   TRAILERS. There is no rigid, no 6x2 and no mileage column in this
   application and there never should be, and the real make column holds
   Don Bur, Tiger, SDC, Dennison, Cartwright, Krone, Montracon, Gray &
   Adams and Schmitz. So the engine was being driven, and scored,
   against a business that does not exist. It passed, which was worse
   than failing: a benchmark measuring the wrong thing tells you the
   work is done when it is not.

   These are STC sentences. Every noun in them is something this
   application holds, taken from the schema and from the real stock rows
   in app/api/admin/import-sold-2026. None of them appears in any
   lexicon, test or example.

   The criterion is per component. A sentence is broken into the
   independent facts a person reads in it, and each is checked on its
   own:

     carried   the plan expresses it
     dropped   the plan ignored it and answered anyway
     inverted  the plan expresses its opposite

   Dropped is the failure that matters, because a dropped constraint
   returns a bigger answer that still looks like an answer. Inverted is
   worse again. The last case in this file is deliberately impossible
   and asserts the engine says so rather than answering anyway.

     npm run check:litmus
   ============================================================= */
import { parseQuery, type QueryPlan } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { readGrammar, type Operation } from '../lib/command/grammar';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary, sampleSize } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });

/* The values the real database holds, which the app loads for itself on
   first paint. Read from STC's own stock rows, not written by hand. */
loadSampleVocabulary();

/* -------------------------------------------------------------
   What the engine produced, in one shape.
   ------------------------------------------------------------- */
type Reading = {
  sentence: string;
  plan: QueryPlan | null;
  ops: Operation[];
  editOffered: string | null;
};

function run(sentence: string): Reading {
  const plan = parseQuery(sentence);
  const { operations } = readGrammar(sentence);
  const edit = parseEdit(sentence, caps);
  return {
    sentence, plan, ops: operations,
    editOffered: edit ? (edit.field?.label ?? 'a field') : null,
  };
}

/* -------------------------------------------------------------
   The checks a component can make.
   ------------------------------------------------------------- */
const has = {
  entity: (id: string) => (r: Reading) => r.plan?.entity.id === id,

  measure: (m: string) => (r: Reading) => r.plan?.measure === m,

  filter: (column: string, value?: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) =>
      (f.column === column || f.columns?.includes(column))
      && f.negate !== true
      && (value === undefined
        || f.value.toLowerCase().includes(value.toLowerCase())
        || !!f.values?.some((v) => v.toLowerCase().includes(value.toLowerCase())))),

  /* Present AND inverted. Checking only that a filter is absent passes
     when the whole sentence was ignored, which is how an earlier run of
     this reported three inversions as correct. */
  filterNot: (column: string, value: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) =>
      f.column === column
      && f.value.toLowerCase().includes(value.toLowerCase())
      && f.negate === true),

  empty: (column: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) => f.column === column && f.op === 'empty'),

  compareOn: (column: string) => (r: Reading) => r.plan?.compare?.column === column,

  groupBy: (column: string) => (r: Reading) => r.plan?.groupBy?.column === column,

  range: () => (r: Reading) => !!r.plan?.range,
  rangeOn: (column: string) => (r: Reading) => r.plan?.rangeColumn === column,

  order: (direction: 'asc' | 'desc', column?: string) => (r: Reading) =>
    r.plan?.order?.direction === direction
    && (column === undefined || r.plan?.order?.column === column),

  limit: (n: number) => (r: Reading) => r.plan?.limit === n,

  derive: (id: string) => (r: Reading) => r.plan?.derived?.id === id,

  amount: (column: string) => (r: Reading) => r.plan?.amountColumn === column,

  scope: (s: 'mine' | 'all') => (r: Reading) => r.plan?.scope === s,

  /** It admitted it could not do something. */
  saidSo: (about?: string) => (r: Reading) =>
    (r.plan?.unmet ?? []).some((u) => !about || u.toLowerCase().includes(about.toLowerCase())),

  noEditOffered: () => (r: Reading) => r.editOffered === null,

  not: (f: (r: Reading) => boolean) => (r: Reading) => !f(r),
};

type Component = { fact: string; check: (r: Reading) => boolean };
type Case = { sentence: string; why?: string; components: Component[] };

/* -------------------------------------------------------------
   The sentences. Every one about something STC actually has.
   ------------------------------------------------------------- */
const CASES: Case[] = [
  {
    sentence: 'show the five cheapest curtainsiders currently in stock',
    components: [
      { fact: 'trailers', check: has.entity('trailers') },
      { fact: 'curtainsider, a body type', check: has.filter('model', 'curtainsider') },
      { fact: 'in stock', check: has.filter('status', 'in_stock') },
      { fact: 'cheapest, so ascending on price', check: has.order('asc', 'sales_price') },
      { fact: 'five of them', check: has.limit(5) },
    ],
  },
  {
    sentence: 'which Schmitz trailers have been here longest',
    components: [
      { fact: 'Schmitz, a real make', check: has.filter('make', 'schmitz') },
      { fact: 'stock age, computed from the date in', check: has.derive('stock_age') },
      { fact: 'longest, so the earliest arrivals first', check: has.order('asc', 'received_date') },
    ],
  },
  {
    sentence: 'stock at Carrington with no retail price',
    components: [
      { fact: 'trailers', check: has.entity('trailers') },
      { fact: 'Carrington, a depot', check: has.filter('location', 'carrington') },
      { fact: 'retail price is empty', check: has.empty('retail_price') },
      { fact: 'a list, not a total of the prices', check: has.not(has.measure('sum')) },
      { fact: 'no offer to write the field', check: has.noEditOffered() },
    ],
  },
  {
    sentence: 'trailers with refurb over £2k excluding sold ones',
    components: [
      { fact: 'refurb cost over £2,000', check: has.filter('refurb_costs') },
      { fact: 'excluding, an inversion', check: (r) => r.ops.some((o) => o.op === 'negate') },
      { fact: 'and sold is inverted, not merely absent', check: has.filterNot('status', 'sold') },
    ],
  },
  {
    sentence: 'average profit on sold trailers this year',
    components: [
      { fact: 'an average', check: has.measure('avg') },
      { fact: 'profit, not sale price', check: has.amount('profit') },
      { fact: 'sold', check: has.filter('status', 'sold') },
      { fact: 'this year, a period', check: has.range() },
    ],
  },
  {
    sentence: 'compare Don Bur and Krone average profit',
    components: [
      { fact: 'a comparison on the make column', check: has.compareOn('make') },
      { fact: 'grouped by make rather than narrowed to one',
        check: (r) => has.groupBy('make')(r) && !has.filter('make')(r) },
      { fact: 'an average', check: has.measure('avg') },
      { fact: 'profit', check: has.amount('profit') },
    ],
  },
  {
    sentence: 'customers with more than 20 trucks and no email',
    why: 'trucks here is the numeric fleet field on a customer, not a vehicle record',
    components: [
      { fact: 'customers, not trailers', check: has.entity('contacts') },
      { fact: 'email is empty', check: has.empty('email') },
      { fact: 'not answered as a total', check: has.not(has.measure('sum')) },
    ],
  },
  {
    sentence: 'social posts awaiting approval',
    components: [
      { fact: 'social posts, not trailers', check: has.entity('posts') },
      { fact: 'awaiting approval, a status', check: has.filter('status', 'pending_review') },
    ],
  },
  {
    sentence: 'trailers booked in between May and July, newest first',
    components: [
      { fact: 'between May and July, a range', check: has.range() },
      { fact: 'booked in, so the date it arrived', check: has.rangeOn('received_date') },
      { fact: 'newest first, descending', check: has.order('desc') },
      { fact: 'and not cut down to one', check: has.not(has.limit(1)) },
    ],
  },
  {
    sentence: 'how many flatbeds at Bredbury by sales rep',
    components: [
      { fact: 'a count', check: has.measure('count') },
      { fact: 'flatbed, a body type', check: has.filter('model', 'flatbed') },
      { fact: 'Bredbury, a depot', check: has.filter('location', 'bredbury') },
      { fact: 'by rep, a breakdown', check: has.groupBy('sales_rep') },
    ],
  },
  {
    sentence: 'the dearest Tiger box van Lucy sold at Dukinfield',
    components: [
      { fact: 'Tiger, a real make', check: has.filter('make', 'tiger') },
      { fact: 'box van, a body type', check: has.filter('model', 'box') },
      { fact: 'Lucy, a real rep', check: has.filter('sales_rep', 'lucy') },
      { fact: 'Dukinfield, a depot', check: has.filter('location', 'dukinfield') },
      { fact: 'sold', check: has.filter('status', 'sold') },
      { fact: 'dearest, so descending on price', check: has.order('desc', 'sales_price') },
      { fact: 'just the one', check: has.limit(1) },
    ],
  },
  {
    sentence: 'how many 6x2s have we got at Carrington',
    why: 'deliberately impossible: there is no 6x2 in this business and no such column',
    components: [
      { fact: 'Carrington is still understood', check: has.filter('location', 'carrington') },
      { fact: 'and it says it could not place "6x2"', check: has.saidSo('6x2') },
    ],
  },
];

/* ------------------------------------------------------------- */

if (!sampleSize()) {
  console.log('\n  No real stock rows found, so the vocabulary is empty.');
  console.log('  Expect the make, model, depot and rep facts below to fail.\n');
}

let carried = 0, dropped = 0;
const results: { sentence: string; ok: boolean }[] = [];

console.log(`\n  ${CASES.length} sentences about STC, none of them in any lexicon.`);
console.log(`  Values read from ${sampleSize()} real stock rows.\n`);

for (const c of CASES) {
  const r = run(c.sentence);
  const checked = c.components.map((comp) => ({ comp, ok: comp.check(r) }));
  const ok = checked.every((x) => x.ok);
  results.push({ sentence: c.sentence, ok });

  console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${c.sentence}"`);
  if (c.why) console.log(`          (${c.why})`);
  for (const { comp, ok: cok } of checked) {
    if (cok) { carried++; console.log(`          ok    ${comp.fact}`); }
    else { dropped++; console.log(`          DROP  ${comp.fact}`); }
  }
  console.log(`          plan: ${r.plan ? r.plan.summary : 'none'}`
    + (r.plan ? `  (confidence ${r.plan.confidence})` : ''));
  for (const u of r.plan?.unmet ?? []) console.log(`          said: ${u}`);
  console.log();
}

const passed = results.filter((x) => x.ok).length;
console.log(`  ${passed}/${CASES.length} sentences fully understood.`);
console.log(`  ${carried}/${carried + dropped} individual facts carried, ${dropped} dropped.\n`);
if (passed < CASES.length) process.exitCode = 1;
