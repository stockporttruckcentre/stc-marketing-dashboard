/* =============================================================
   Type every sentence, by generating it.

   The requirement is that every command is verified before go live, and
   there are more of them than anybody can type. So they get typed by
   this: sentences are built from the same vocabulary the parser reads,
   pushed through the parser, and checked against what built them.

   The important part is the direction. A test that asserts a sentence
   parses proves nothing, because a parser that returns "count trailers"
   for everything passes it. These assert the plan matches the parts the
   sentence was assembled from: this body type, that status, that depot,
   that period, that measure. A wrong answer fails even when it is a
   confident one.

   That is the failure mode this was written for. "How many curtainsider
   trailers in stock" returned 1 when the real number is in the
   thousands, and nothing caught it, because the plan was well formed and
   the filter was simply pointed at the wrong column.

     npm run check:fuzz            a representative sweep, in CI
     npm run check:fuzz -- --all   every combination, before go live
   ============================================================= */
import { parseQuery } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { parseSelection } from '../lib/command/select';
import { parseFinder } from '../lib/command/finder';
import { BODY_TYPES, DEPOTS, STATE_PHRASES } from '../lib/command/lexicon';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { INDUSTRIES } from '../lib/command/params';
import { capabilitiesFor } from '../lib/crm/permissions';

const ALL = process.argv.includes('--all');
const caps = capabilitiesFor({ role: 'admin' });

let checked = 0;
/* Distinct sentences, separately from assertions about them. The
   summary line used to print the assertion count and call them
   sentences, which overstated the sweep by roughly five times. */
const SENTENCES = new Set<string>();
let failed = 0;
const failures: string[] = [];

function assert(sentence: string, what: string, condition: boolean, got = '') {
  SENTENCES.add(sentence);
  checked++;
  if (condition) return;
  failed++;
  if (failures.length < 30) failures.push(`  "${sentence}"\n    ${what}${got ? `  got: ${got}` : ''}`);
}

/** Take every nth item unless the full sweep was asked for. */
function sample<T>(items: T[], every: number): T[] {
  return ALL ? items : items.filter((_, i) => i % every === 0);
}

/* -------------------------------------------------------------
   1. Questions about trailers.

   Body type x status x depot x period x measure, asserted on the way
   back out. This is the shape that was silently wrong.
   ------------------------------------------------------------- */
const BODY_WORDS = Object.entries(BODY_TYPES);
const DEPOT_WORDS = Object.entries(DEPOTS);
const STATES = STATE_PHRASES.flatMap((p) => p.words.map((w) => ({ word: w, value: p.value })));
const PERIODS = [
  { phrase: '', expect: false },
  { phrase: ' this week', expect: true },
  { phrase: ' last month', expect: true },
  { phrase: ' in the past 30 days', expect: true },
  { phrase: ' this year', expect: true },
];
const MEASURES = [
  { lead: 'how many', measure: 'count' },
  { lead: 'list', measure: 'list' },
  { lead: 'total value of', measure: 'sum' },
  { lead: 'average profit on', measure: 'avg' },
];

for (const [bodyWord, bodyValue] of sample(BODY_WORDS, 3)) {
  for (const state of sample(STATES, 4)) {
    for (const m of MEASURES) {
      const s = `${m.lead} ${bodyWord} trailers ${state.word}`;
      const p = parseQuery(s);
      assert(s, 'no plan', !!p);
      if (!p) continue;
      assert(s, 'measure', p.measure === m.measure, p.measure);

      const cat = p.filters.find((f) => f.key === 'category');
      assert(s, `category should be ${bodyValue}`, cat?.value === bodyValue, String(cat?.value));
      /* The whole point of the bug: body type has to reach the columns
         that actually carry it, not just the tidy enum nobody fills in. */
      assert(s, 'category must span category, model and description',
        cat?.op === 'anyOf' && (cat.columns ?? []).includes('model'),
        `${cat?.op} ${JSON.stringify(cat?.columns)}`);

      const st = p.filters.find((f) => f.key === 'status');
      assert(s, `status should be ${state.value}`, st?.value === state.value, String(st?.value));
    }
  }
}

for (const [bodyWord, bodyValue] of sample(BODY_WORDS, 5)) {
  for (const [depotWord, depotValue] of sample(DEPOT_WORDS, 2)) {
    for (const period of PERIODS) {
      const s = `how many ${bodyWord} trailers at ${depotWord}${period.phrase}`;
      const p = parseQuery(s);
      assert(s, 'no plan', !!p);
      if (!p) continue;
      assert(s, `category ${bodyValue}`,
        p.filters.find((f) => f.key === 'category')?.value === bodyValue);
      assert(s, `location ${depotValue}`,
        p.filters.find((f) => f.key === 'location')?.value === depotValue);
      assert(s, period.expect ? 'expected a period' : 'expected no period',
        Boolean(p.range) === period.expect, p.range?.label ?? 'none');
    }
  }
}

/* -------------------------------------------------------------
   2. A read verb is never an instruction to create.

   From the screenshot: "export a list of all trailers in stock" was
   offering Add a trailer to stock, with Enter to run.
   ------------------------------------------------------------- */
const READ_LEADS = [
  'export a list of all', 'export every', 'download all', 'give me a list of',
  'show me all', 'how many', 'list all', 'count the', 'total value of all',
];
const READ_NOUNS = ['trailers in stock', 'customers', 'sold trailers', 'curtainsiders at hyde'];

for (const lead of READ_LEADS) {
  for (const noun of READ_NOUNS) {
    const s = `${lead} ${noun}`;
    const p = parseQuery(s);
    assert(s, 'a read sentence must produce a query', !!p);
    /* And must never be read as an instruction to write a record. */
    const e = parseEdit(s, caps);
    assert(s, 'a read sentence must not be an edit', !e || e.missing.length > 0,
      e?.summary ?? '');
  }
}

/* -------------------------------------------------------------
   3. Field writes, every field, every operation.
   ------------------------------------------------------------- */
const SAMPLE_VALUE: Record<string, string> = {
  money: '1200', number: '12', date: '14/03/2027', text: 'Carrington', longtext: 'chased them',
};

for (const f of sample(WRITABLE_FIELDS, 2)) {
  if (f.kind === 'enum') continue;                    // covered by the selector sweep
  if (f.entity !== 'trailers' && f.entity !== 'contacts') continue;
  /* The one field where the stock number is the value rather than the
     record: "add stock number STC150001 to C734105". Generating
     "set stock number on STC143980 to ..." asks for a sentence nobody
     would say, and the parser is right to refuse it. */
  if (f.key === 'stc_no') continue;
  const record = f.entity === 'trailers' ? 'STC143980' : 'Dawson';
  const value = SAMPLE_VALUE[f.kind] ?? 'Carrington';

  for (const alias of sample(f.aliases, 2)) {
    const s = `set ${alias} on ${record} to ${value}`;
    const p = parseEdit(s, caps);
    assert(s, 'no plan', !!p);
    if (!p) continue;
    assert(s, `column ${f.key}`, p.field.key === f.key, p.field.key);
    assert(s, 'record', p.named[0] === record, p.named[0] ?? 'none');
    assert(s, 'complete', p.missing.length === 0, p.missing.join(','));
  }
}

/* -------------------------------------------------------------
   4. Selectors stack rather than overwrite.
   ------------------------------------------------------------- */
const CLAUSES = [
  { text: 'with no owner', label: 'no owner' },
  { text: 'with no email', label: 'no email' },
  { text: 'not contacted in 30 days', label: 'not contacted in 30 days' },
  { text: 'with a fleet over 50', label: 'fleet over 50' },
  { text: 'with a turnover over 2m', label: 'turnover over £2,000,000' },
];

for (let i = 0; i < CLAUSES.length; i++) {
  for (let j = 0; j < CLAUSES.length; j++) {
    if (i === j) continue;
    for (const [depotWord, depotValue] of sample(DEPOT_WORDS, 4)) {
      const s = `customers in ${depotWord} ${CLAUSES[i].text} ${CLAUSES[j].text}`;
      const sel = parseSelection(s, 'Alex Ellis');
      assert(s, 'no selection', !!sel);
      if (!sel) continue;
      const labels = sel.conditions.map((c) => c.label);
      assert(s, `keeps "${CLAUSES[i].label}"`, labels.includes(CLAUSES[i].label), labels.join(' + '));
      assert(s, `keeps "${CLAUSES[j].label}"`, labels.includes(CLAUSES[j].label), labels.join(' + '));
      assert(s, `keeps the place`, labels.includes(`in ${depotValue}`), labels.join(' + '));
    }
  }
}

/* -------------------------------------------------------------
   5. Prospecting, across its whole parameter space.
   ------------------------------------------------------------- */
const RADII = [5, 10, 25, 50];
const COUNTS = [4, 20, 50];

for (const industry of sample(INDUSTRIES, 2)) {
  for (const [depotWord, depotValue] of sample(DEPOT_WORDS, 3)) {
    for (const radius of RADII) {
      for (const count of COUNTS) {
        const s = `find ${count} ${industry.words[0]} companies within ${radius} miles of ${depotWord}`;
        const p = parseFinder(s, caps);
        assert(s, 'no finder plan', !!p);
        if (!p) continue;
        assert(s, `place ${depotValue}`, p.location === depotValue, p.location);
        assert(s, `radius ${radius}`, p.radiusMiles === radius, String(p.radiusMiles));
        assert(s, `count ${count}`, p.limit === count, String(p.limit));
        assert(s, `industry ${industry.label}`, p.industryIds[0] === industry.id,
          String(p.industryIds[0]));
      }
    }
  }
}

/* ------------------------------------------------------------- */

console.log(`\n${SENTENCES.size.toLocaleString('en-GB')} generated sentences, `
  + `${(checked - failed).toLocaleString('en-GB')}/${checked.toLocaleString('en-GB')} assertions about their PLANS hold`
  + `${ALL ? ' (full sweep)' : ' (sampled, use --all for every combination)'}\n`);

if (failures.length) {
  console.log('first failures:\n');
  for (const f of failures) console.log(f);
  console.log();
}
if (failed) process.exit(1);
