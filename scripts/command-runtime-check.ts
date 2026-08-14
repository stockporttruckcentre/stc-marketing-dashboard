/* =============================================================
   Do read commands actually go through the canonical IR in the
   application, or only in a test script?

   The previous checks proved the IR could represent what the reader
   produced. That is not the same claim. An adapter can be perfect and
   entirely unused, with the application still deciding everything from
   `QueryPlan` while the IR sits beside it doing nothing. This proves
   the path, three ways.

   1  DEPENDENCY. The production files are read from disk and their
      imports asserted. `parseQuery` and `planToPayload` may be reached
      from exactly one module, and the bar and the route must reach the
      canonical planner instead. A second planner appearing beside the
      first fails here.

   2  BEHAVIOUR. Every sentence in the corpus is planned through the
      production entry point, turned into the executor's wire shape
      through the production compatibility layer, and compared against
      what the legacy path would have posted. Not a similar shape:
      the same executor-visible request, field for field.

   3  SURFACE. Every planned command carries the plan, its completion,
      its derived requirements, whether it needs confirming and whether
      anything can carry it out. A missing one is a caller left to
      guess, which is how four different answers to "is this allowed"
      appeared in four places last time.

     npm run check:runtime
   ============================================================= */
import { readFileSync } from 'fs';
import { parseQuery as readQuery, planToPayload } from '../lib/command/query';
import { planCommand, planningToQueryPayload } from '../lib/command/plan';
import { executability } from '../lib/command/ir/execute';
import { BODY_TYPES, DEPOTS, STATE_PHRASES } from '../lib/command/lexicon';
import { ENTITIES } from '../lib/command/schema';
import { loadSampleVocabulary } from './sample-vocabulary';

/* The fixture, as a value, bound to both entry points. Passing it to
   `planCommand` as well is the point of this phase: the reader has no
   other way to hear about it. */
const VOCABULARY = loadSampleVocabulary();
const parseQuery = (text: string) => readQuery(text, VOCABULARY);
const plan = (text: string, caps?: Iterable<string>) =>
  planCommand(text, { vocabulary: VOCABULARY, ...(caps ? { actorCapabilities: caps } : {}) });

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  if (failures.length < 20) failures.push(`  ${what}${got ? `\n    ${got}` : ''}`);
};

const source = (path: string) => readFileSync(path, 'utf8');

/* =============================================================
   1. Dependency: one semantic authority, reached from the runtime
   ============================================================= */

const PRODUCTION = [
  'components/dashboard/CommandBar.tsx',
  'app/api/command/query/route.ts',
  'app/api/command/plan/route.ts',
  'lib/command/plan.ts',
  'lib/command/server/planner.ts',
  'lib/command/ir/execute.ts',
];

const CANONICAL_ENTRY = 'lib/command/plan.ts';

for (const path of PRODUCTION) {
  const text = source(path);
  const reachesReader = /\bparseQuery\b|\bplanToPayload\b/.test(
    text.split('\n').filter((l) => l.trim().startsWith('import') || l.includes('from \'')).join('\n'),
  );
  if (path === CANONICAL_ENTRY) {
    ok(`${path} is the one module that reaches the legacy reader`, reachesReader);
  } else {
    ok(`${path} does not reach the legacy reader`, !reachesReader);
  }
}

const bar = source('components/dashboard/CommandBar.tsx');
ok('the command bar plans through the canonical entry point',
  /from '@\/lib\/command\/plan'/.test(bar) && /planCommand\(/.test(bar));
ok('the command bar decides from the canonical plan, not a confidence on a QueryPlan',
  /local\.availability\.representable/.test(bar) && /local\.availability\.executable/.test(bar));
ok('the command bar posts the sentence and the agreed reading, not a query it built itself',
  /JSON\.stringify\(\{ text, hash: m\.hash \}\)/.test(bar));

const route = source('app/api/command/query/route.ts');
/* The route reaches `planCommand` through the authoritative planner,
   which is the same function with the vocabulary loaded first. Calling
   it directly is what let the server plan a sentence in conditions the
   browser never saw. */
ok('the query route plans through the authoritative planner',
  /from '@\/lib\/command\/server\/planner'/.test(route) && /planForExecution\(/.test(route));
ok('the query route builds what it runs from the canonical plan',
  /planningToQueryPayload\(planning\)/.test(route));
ok('the query route refuses a plan the validator refuses',
  /meaning\.completion === 'refused'/.test(route));
ok('the query route checks derived permissions',
  /!planning\.availability\.permitted/.test(route));
ok('the query route refuses what nothing can perform',
  /availability\.executable/.test(route));
ok('the query route never reads a query out of the request body',
  !/raw\.(entityId|filters|measure|groupBy)/.test(route)
  && !/body\s*=\s*await req\.json/.test(route));

/* The compatibility layer takes a Select. It could not consult a
   QueryPlan if somebody wanted it to, which is a stronger guarantee
   than a comment asking them not to. */
const compat = source('lib/command/ir/execute.ts');
const compatImports = compat.split('\n').filter((l) => l.trim().startsWith('import')).join('\n');
ok('the compatibility layer is typed against the IR and imports nothing from the reader',
  /selectToQueryPayload\(select: Select/.test(compat)
  && !/QueryPlan/.test(compatImports)
  && !/from '\.\.\/query'/.test(compatImports));

/* =============================================================
   2. Behaviour: the same request reaches the executor
   ============================================================= */

/**
 * What the executor actually reads out of its body.
 *
 * Labels and the summary are presentation and are compared too, since
 * the answer is meant to read exactly as it did. `key`, `at` and the
 * filter's own label are reader bookkeeping the executor never looks
 * at, and are not part of the request.
 */
type ExecutorRequest = {
  entityId: string;
  measure: string;
  amountColumn: string | null;
  amountLabel: string | null;
  filters: { op: string; columns: string[]; values: string[]; negate: boolean }[];
  groupBy: { column: string; label: string } | null;
  range: { from: string; to: string } | null;
  rangeColumn: string | null;
  scope: string;
  order: { column: string; direction: string; label: string } | null;
  limit: number | null;
  derived: { id: string; from: string; how: string; label: string } | null;
  compare: { column: string; values: string[] } | null;
  summary: string;
};

const sortFilters = (fs: ExecutorRequest['filters']) =>
  fs.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function normalise(p: any, entityDateColumn: string | undefined): ExecutorRequest {
  return {
    entityId: p.entityId,
    measure: p.measure,
    amountColumn: p.amountColumn ?? null,
    amountLabel: p.amountLabel ?? null,
    /* Exactly what the executor reads off a filter. It takes the
       columns from `columns` and falls back to `column`, and the values
       from `values` and falls back to `value`, so the effective pair is
       the request and the fallback fields are not. Comparing the
       fallbacks would fail on a spread filter for a difference the
       database never sees: the reader records which synonym is the
       canonical one and the IR holds all of them as equals. */
    filters: sortFilters((p.filters ?? []).map((f: any) => ({
      /* `contains` and `ilike` are the same operator with two names,
         one in the IR and one in the executor's wire shape. */
      op: f.op === 'contains' ? 'ilike' : f.op,
      columns: (f.columns?.length ? f.columns : [f.column]).slice().sort(),
      values: (f.values?.length ? f.values : [f.value])
        .filter((v: unknown) => v !== undefined && v !== null)
        .map(String).slice().sort(),
      negate: f.negate === true,
    }))),
    groupBy: p.groupBy ? { column: p.groupBy.column, label: p.groupBy.label } : null,
    /* The executor does `String(body.range.from).slice(0, 10)`, so a
       period is a pair of dates and the time of day is not part of the
       request. Comparing the full timestamps compares the clock: the
       two paths each resolve "last month" when they are called, and a
       millisecond apart is not a difference in meaning. */
    range: p.range
      ? { from: String(p.range.from).slice(0, 10), to: String(p.range.to).slice(0, 10) }
      : null,
    /* The old path left this undefined and the route fell back to the
       entity's own date. The IR resolved it up front, so the fallback
       is applied here to compare the column the executor would use. */
    rangeColumn: p.rangeColumn ?? entityDateColumn ?? null,
    scope: p.scope,
    order: p.order ? { column: p.order.column, direction: p.order.direction, label: p.order.label } : null,
    limit: p.limit ?? null,
    derived: p.derived
      ? { id: p.derived.id, from: p.derived.from, how: p.derived.how, label: p.derived.label }
      : null,
    compare: p.compare ? { column: p.compare.column, values: p.compare.values.map(String) } : null,
    summary: p.summary,
  };
}

function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

function difference(a: ExecutorRequest, b: ExecutorRequest): string {
  const out: string[] = [];
  for (const k of Object.keys(a).sort() as (keyof ExecutorRequest)[]) {
    const left = canonical(a[k]);
    const right = canonical(b[k]);
    if (left !== right) out.push(`  ${k}\n      legacy: ${left}\n      canonical: ${right}`);
  }
  return out.join('\n');
}

/* -------------------------------------------------------------
   The same corpus the equivalence check uses.
   ------------------------------------------------------------- */
const BODIES = Object.keys(BODY_TYPES);
const DEPOT_WORDS = Object.keys(DEPOTS);
const STATES = STATE_PHRASES.flatMap((p) => p.words);
const MEASURES = ['how many', 'list', 'total value of', 'average profit on'];
const PERIODS = ['', ' this week', ' last month', ' this year', ' in the past 30 days'];
const SHAPES = ['', ' by make', ' by depot', ' cheapest first', ' newest first'];

const sentences = new Set<string>();
for (const m of MEASURES) {
  for (const b of BODIES) for (const s of STATES) sentences.add(`${m} ${b} trailers ${s}`);
}
for (const b of BODIES) {
  for (const d of DEPOT_WORDS) for (const p of PERIODS) sentences.add(`how many ${b} trailers at ${d}${p}`);
}
for (const b of BODIES) for (const sh of SHAPES) sentences.add(`list ${b} trailers in stock${sh}`);
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
  sentences.add(`stock age of trailers at ${d}`);
  sentences.add(`how many trailers at ${d} by stock age`);
  sentences.add(`average stock age of trailers at ${d}`);
  sentences.add(`days until mot on trailers at ${d}`);
  sentences.add(`margin percentage on sold trailers at ${d}`);
  for (const e of DEPOT_WORDS) if (e !== d) sentences.add(`how many trailers at ${d} versus ${e}`);
}
for (const b of BODIES) {
  sentences.add(`how long since we spoke to contacts about ${b} trailers`);
  sentences.add(`list ${b} trailers by stock age oldest first`);
}

let planned = 0, identical = 0, surfaced = 0;
const diffs: string[] = [];

for (const text of sentences) {
  const legacyRead = parseQuery(text);
  const planning = plan(text);

  /* The canonical entry point must understand exactly what the reader
     understands. Fewer means the migration lost sentences; more would
     mean a second planner appeared. */
  ok(`"${text}" is planned by both paths or by neither`,
    (legacyRead === null) === (planning === null));
  if (!legacyRead || !planning) continue;
  planned++;

  const entityDate = legacyRead.entity.dateColumn;
  const legacy = normalise(planToPayload(legacyRead), entityDate);
  const viaIr = planningToQueryPayload(planning);
  if (!viaIr) { ok(`"${text}" produces an executable request`, false); continue; }
  const canonicalRequest = normalise(viaIr, entityDate);

  if (canonical(legacy) === canonical(canonicalRequest)) identical++;
  else if (diffs.length < 10) diffs.push(`  "${text}"\n${difference(legacy, canonicalRequest)}`);

  /* 3. Everything a caller needs, on every command. */
  const complete = !!planning.plan
    && planning.plan.steps.length > 0
    && !!planning.completion
    && Array.isArray(planning.requirements)
    && typeof planning.confirm === 'boolean'
    && typeof planning.availability.representable === 'boolean'
    && typeof planning.availability.executable === 'boolean';
  if (complete) surfaced++;
}

ok('every planned read reaches the executor with the request it always had',
  identical === planned, `${identical}/${planned}`);
ok('every planned command surfaces plan, completion, requirements, confirmation and availability',
  surfaced === planned, `${surfaced}/${planned}`);

/* =============================================================
   3. Representable, permitted, executable are three answers
   ============================================================= */

const anyRead = plan('how many trailers in stock');
ok('a read is representable', anyRead?.availability.representable === true);
ok('a read is executable, because something performs it',
  anyRead?.availability.executable === true,
  JSON.stringify(anyRead?.availability.unavailable));
ok('a read needs no confirmation', anyRead?.confirm === false);
ok('a read derives a capability requirement as well as any permission',
  !!anyRead?.requirements.some((r) => r.kind === 'capability' && r.id === 'data.read'),
  JSON.stringify(anyRead?.requirements));

ok('with no actor named, permitted is unknown rather than yes',
  anyRead?.availability.permitted === null, String(anyRead?.availability.permitted));

const asViewer = plan('how many contacts', []);
ok('an actor holding nothing is not permitted to read the CRM',
  asViewer?.availability.permitted === false,
  JSON.stringify(asViewer?.availability.missingPermissions));
const asStaff = plan('how many contacts', ['crm.view']);
ok('an actor holding crm.view is permitted to read the CRM',
  asStaff?.availability.permitted === true,
  JSON.stringify(asStaff?.availability.missingPermissions));

/* A capability with no handler is representable, can be permitted, and
   is still not something this application can carry out. */
const emailed = executability({
  steps: [
    { op: 'select', id: 's', from: { entity: 'contacts' }, produces: { kind: 'rows', entity: 'contacts' } },
    {
      op: 'emit', id: 'e', from: { ref: 'rows', step: 's' }, output: { kind: 'rows' },
      to: { kind: 'email', to: [{ kind: 'context', slot: 'actor' }] }, capability: 'rows.email',
    },
  ],
  unmet: [],
});
ok('a handlerless capability is not advertised as executable',
  emailed.executable === false && emailed.missing.some((m) => m.need === 'rows.email'),
  JSON.stringify(emailed));

const created = executability({
  steps: [{ op: 'create', id: 'c', target: { entity: 'contacts' } }],
  unmet: [],
});
ok('a create is not executable, because no canonical executor performs one yet',
  created.executable === false, JSON.stringify(created));

/* ============================================================= */

console.log(`\n  ${sentences.size.toLocaleString('en-GB')} sentences, `
  + `${planned.toLocaleString('en-GB')} planned through the production entry point.`);
console.log(`  ${identical.toLocaleString('en-GB')}/${planned.toLocaleString('en-GB')} `
  + `reach the executor with an identical request.`);
console.log(`\n  ${pass}/${pass + fail} runtime-path assertions hold.\n`);

if (diffs.length) {
  console.log('  first differences:');
  for (const d of diffs) console.log(d);
  console.log();
}
if (failures.length) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  console.log();
}
if (fail) process.exitCode = 1;
