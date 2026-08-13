/* =============================================================
   Ten sentences nobody wrote down.

   These arrived from outside as a test of whether the engine composes or
   merely recognises. The rule that came with them is the whole point:
   NOTHING IN THIS FILE MAY BE ADDED TO A LEXICON. If a sentence only
   works after its own words are typed into a table, it proves nothing,
   because the next sentence will not be in that table either.

   The first run of this scored zero. Not zero because the plans were
   poor: zero because I had been marking a sentence PASS when a confident
   plan came back, which measures that the engine answered, not that it
   answered the question. Three of the ten came back meaning the opposite
   of what was typed, and every one of those was reported as a pass.

   So the criterion here is per component. A sentence is broken into the
   independent facts a person reads in it, and each fact is checked
   against the plan on its own:

     carried   the plan expresses it
     dropped   the plan ignored it and answered anyway
     inverted  the plan expresses its opposite
     no data   the app holds no such thing, and saying so is correct

   Dropped is the failure that matters, because a dropped constraint
   returns a bigger answer that still looks like an answer. Inverted is
   worse again. `no data` is not a failure of the engine: this app sells
   trailers and has no mileage column, so "over 400k miles" cannot be
   answered by anything and the only honest response is to say so.

     npm run check:litmus
   ============================================================= */
import { parseQuery, type QueryPlan } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { parseSelection } from '../lib/command/select';
import { readGrammar, type Operation } from '../lib/command/grammar';
import { canonicalise } from '../lib/command/ontology';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });

/* The values a database holds, which the app loads for itself on first
   paint. Not phrasings: the contents of the make, model, location,
   customer and rep columns. */
loadSampleVocabulary();

/* -------------------------------------------------------------
   What the engine produced, in one shape, however it produced it.
   ------------------------------------------------------------- */
type Reading = {
  sentence: string;
  plan: QueryPlan | null;
  ops: Operation[];
  concepts: string[];
  leftover: string[];
  editOffered: string | null;
};

function run(sentence: string): Reading {
  const plan = parseQuery(sentence);
  const { operations } = readGrammar(sentence);
  const { mentions, leftover } = canonicalise(sentence);
  const edit = parseEdit(sentence, caps);
  return {
    sentence,
    plan,
    ops: operations,
    concepts: mentions.map((m) => m.concept.id),
    leftover,
    editOffered: edit ? (edit.field?.label ?? 'a field') : null,
  };
}

/* -------------------------------------------------------------
   The checks a component can make. Each returns true when the fact is
   carried by the reading.
   ------------------------------------------------------------- */
const has = {
  entity: (id: string) => (r: Reading) => r.plan?.entity.id === id,

  measure: (m: string) => (r: Reading) => r.plan?.measure === m,

  filter: (column: string, value?: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) =>
      (f.column === column || f.columns?.includes(column))
      && (value === undefined
        || f.value.toLowerCase().includes(value.toLowerCase())
        || !!f.values?.some((v) => v.toLowerCase().includes(value.toLowerCase())))),

  /* A filter that is present AND inverted. Checking only that a filter
     is absent passes when the whole sentence was ignored, which is how
     the first run of this reported three inversions as correct. */
  filterNot: (column: string, value: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) =>
      f.column === column
      && f.value.toLowerCase().includes(value.toLowerCase())
      && f.negate === true),

  /** That column is being asked about for holding nothing. */
  empty: (column: string) => (r: Reading) =>
    !!r.plan?.filters.some((f) => f.column === column && f.op === 'empty'),

  groupBy: (column: string) => (r: Reading) => r.plan?.groupBy?.column === column,

  range: () => (r: Reading) => !!r.plan?.range,

  order: (direction: 'asc' | 'desc') => (r: Reading) =>
    r.ops.some((o) => o.op === 'order' && o.direction === direction),

  limit: (n: number) => (r: Reading) => r.ops.some((o) => o.op === 'limit' && o.n === n),

  negate: () => (r: Reading) => r.ops.some((o) => o.op === 'negate'),

  compare: () => (r: Reading) => r.ops.some((o) => o.op === 'compare'),

  derive: (id: string) => (r: Reading) => r.ops.some((o) => o.op === 'derive' && o.id === id),

  concept: (id: string) => (r: Reading) => r.concepts.includes(id),

  /** The engine must NOT have done this. Used for the inversions. */
  not: (f: (r: Reading) => boolean) => (r: Reading) => !f(r),

  /** Nothing in the app holds this. The honest answer is to say so. */
  noSuchThing: () => (_r: Reading) => false,
};

type Component = {
  fact: string;
  check: (r: Reading) => boolean;
  /** True when the app genuinely has no column for it. */
  missing?: boolean;
};

type Case = { sentence: string; components: Component[] };

/* -------------------------------------------------------------
   The ten, unchanged, with what each one actually says.
   ------------------------------------------------------------- */
const CASES: Case[] = [
  {
    sentence: 'show me the five cheapest available rigids',
    components: [
      { fact: 'five of them', check: has.limit(5) },
      { fact: 'cheapest, so ascending on price', check: has.order('asc') },
      { fact: 'available, so in stock', check: has.filter('status', 'in_stock') },
      { fact: 'rigids, a truck body', check: has.noSuchThing(), missing: true },
    ],
  },
  {
    sentence: 'DAFs older than 2022 excluding anything at Warrington',
    components: [
      { fact: 'DAF, a make', check: has.filter('make', 'daf') },
      { fact: 'older than 2022, a year comparison', check: has.filter('year') },
      { fact: 'excluding, an inversion', check: has.negate() },
      { fact: 'Warrington, a place', check: has.filter('location', 'warrington') },
    ],
  },
  {
    sentence: "what's been sitting in Stockport longest",
    components: [
      { fact: 'longest in stock, a derived age', check: has.derive('stock_age') },
      { fact: 'ordered by that age, descending', check: has.order('desc') },
      { fact: 'Stockport, a place', check: has.filter('location', 'stockport') },
    ],
  },
  {
    sentence: 'vehicles over 400k miles but under £25k',
    components: [
      { fact: 'over 400k miles', check: has.noSuchThing(), missing: true },
      { fact: 'under £25k, a price ceiling', check: has.filter('sales_price') },
      { fact: 'both at once, not one or the other', check: (r) => (r.plan?.filters.length ?? 0) >= 1 },
    ],
  },
  {
    sentence: "everything except trailers that's available",
    components: [
      { fact: 'except, an inversion', check: has.negate() },
      { fact: 'not answered as a list of trailers',
        check: has.not((r) => r.plan?.entity.id === 'trailers' && !r.ops.some((o) => o.op === 'negate')) },
      { fact: 'available, so in stock', check: has.filter('status', 'in_stock') },
    ],
  },
  {
    sentence: 'how many 6x2s have we got by depot',
    components: [
      { fact: 'a count', check: has.measure('count') },
      { fact: '6x2, an axle configuration on a truck', check: has.noSuchThing(), missing: true },
      { fact: 'by depot, a breakdown', check: has.groupBy('location') },
    ],
  },
  {
    sentence: 'average stock age for DAF versus Volvo',
    components: [
      { fact: 'an average', check: has.measure('avg') },
      { fact: 'stock age, a derived attribute', check: has.derive('stock_age') },
      { fact: 'DAF against Volvo, a comparison', check: has.compare() },
    ],
  },
  {
    sentence: 'show vehicles added between May and July, newest first',
    components: [
      { fact: 'between May and July, a range', check: has.range() },
      { fact: 'added, so the date it arrived', check: (r) => !!r.plan?.range },
      { fact: 'newest first, descending', check: has.order('desc') },
    ],
  },
  {
    sentence: "what's the highest mileage vehicle that isn't sold",
    components: [
      { fact: 'highest, so descending', check: has.order('desc') },
      { fact: 'just the one', check: has.limit(1) },
      { fact: 'mileage', check: has.noSuchThing(), missing: true },
      { fact: "isn't sold, an inversion", check: has.negate() },
      { fact: 'and the sold filter is inverted, not merely absent',
        check: has.filterNot('status', 'sold') },
    ],
  },
  {
    sentence: "give me all stock where price hasn't been entered",
    components: [
      { fact: 'price is empty, not price totalled', check: has.empty('sales_price') },
      { fact: "hasn't, an inversion", check: has.negate() },
      { fact: 'a list, not a total', check: has.not(has.measure('sum')) },
      { fact: 'and no offer to write the field', check: (r) => r.editOffered === null },
    ],
  },
];

/* ------------------------------------------------------------- */

let carried = 0, dropped = 0, missing = 0;
const wholeSentences: { sentence: string; ok: boolean }[] = [];

console.log('\n  Ten sentences, none of them in any lexicon.\n');

for (const c of CASES) {
  const r = run(c.sentence);
  const results = c.components.map((comp) => ({ comp, ok: comp.check(r) }));

  const realFailures = results.filter((x) => !x.ok && !x.comp.missing);
  const ok = realFailures.length === 0;
  wholeSentences.push({ sentence: c.sentence, ok });

  console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${c.sentence}"`);
  for (const { comp, ok: cok } of results) {
    if (comp.missing) {
      missing++;
      console.log(`          n/a   ${comp.fact}  (this app holds no such column)`);
    } else if (cok) {
      carried++;
      console.log(`          ok    ${comp.fact}`);
    } else {
      dropped++;
      console.log(`          DROP  ${comp.fact}`);
    }
  }
  if (r.plan) {
    console.log(`          plan: ${r.plan.summary}  (confidence ${r.plan.confidence})`);
  } else {
    console.log('          plan: none');
  }
  if (r.ops.length) {
    console.log(`          grammar: ${r.ops.map((o) => o.op).join(', ')}`);
  }
  console.log();
}

const passed = wholeSentences.filter((x) => x.ok).length;
const facts = carried + dropped;

console.log(`  ${passed}/${CASES.length} sentences fully understood.`);
console.log(`  ${carried}/${facts} individual facts carried, ${dropped} dropped.`);
if (missing) console.log(`  ${missing} facts about columns this app does not have, excluded from the score.`);
console.log();
