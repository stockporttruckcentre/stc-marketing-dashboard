/* =============================================================
   Does the toolbar actually cover the product?

   Two questions, both asked by brute force rather than by judgement.

   COVERAGE. Every screen in the feature registry has to be reachable by
   its own name and by every alias it claims. A screen that exists and
   cannot be reached from the bar is invisible: the original bug was
   eight intents against twelve screens, so typing "meeting" did nothing.

   COMBINATIONS. The vocabulary in lexicon.ts is small on purpose, but it
   multiplies. This sweeps every state word against every body type,
   depot, period and sentence shape and asserts the plan that comes out.
   That is where the tens of thousands of variants live: generated from a
   few hundred groups, asserted rather than listed.

   npm run check:coverage
   ============================================================= */
import { parseQuery as readQuery } from '../lib/command/query';
import { ENTITIES as ENTITIES_FOR_SPACE } from '../lib/command/schema';
import { suggestFeatures, FEATURES } from '../lib/command/features';
import { STATE_PHRASES, BODY_TYPES, DEPOTS } from '../lib/command/lexicon';
import { ACTIONS, suggestActions, availableActions } from '../lib/command/actions';
import { composeSuggestions } from '../lib/command/compose';
import { parseEdit, composeEdits } from '../lib/command/mutate';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { parseSelection, selectionSpace } from '../lib/command/select';
import { attributeNames } from '../lib/command/attributes';
import { loadSampleVocabulary } from './sample-vocabulary';
import { capabilitiesFor, LUSHA_LOCKED } from '../lib/crm/permissions';
import type { UserRole } from '../lib/types';

/* The bar learns makes, depots and customers from the database. A check
   has none, so it gets a sample of what those columns hold. */
/* The fixture, as a value. `parseQuery` takes the index it should read
   with, so this binds it once rather than installing it anywhere. */
const VOCABULARY = loadSampleVocabulary();
const parseQuery = (text: string) => readQuery(text, VOCABULARY);

let pass = 0, fail = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail = '') {
  if (condition) { pass++; return; }
  fail++;
  if (failures.length < 25) failures.push(`${name}${detail ? `  ${detail}` : ''}`);
}

/* ---------- every screen is reachable ---------- */



/* ---------- every action, in every phrasing, for every role ----------

   This is the sweep that matters, and the one that was missing. The bar
   is not a stock search: it has to reach navigation, creation, record
   actions, imports, exports, session and admin, and it has to show a
   person only what they can actually do.

   Verbs times objects, both orders, for each of the four roles. */

const ROLES: UserRole[] = ['admin', 'sales', 'marketer', 'viewer'];
const CAPS = Object.fromEntries(ROLES.map((r) => [r, capabilitiesFor({ role: r })])) as
  Record<UserRole, ReturnType<typeof capabilitiesFor>>;

for (const a of ACTIONS) {
  // Somebody who is allowed this action must reach it, from every object
  // word it claims and from every verb and object pair, in both orders.
  const allowed = ROLES.filter((r) => !a.capability || CAPS[r].has(a.capability));

  // Lusha is switched off for everybody at rollout, so its action having
  // no role is the lock working rather than a gap. Asserted the other way
  // round so that when the lock lifts, this line is what reminds us the
  // action comes back.
  const lockedOff = LUSHA_LOCKED && a.capability === 'crm.enrich';
  if (lockedOff) {
    ok(`action ${a.id} is hidden while Lusha is locked`, allowed.length === 0);
  } else {
    ok(`action ${a.id} is reachable by somebody`, allowed.length > 0, 'no role can use it');
  }

  const role = allowed[0];
  if (role) {
    for (const obj of a.objects) {
      const hits = suggestActions(obj, CAPS[role], 8);
      ok(`${a.id}: "${obj}"`, hits.some((h) => h.action.id === a.id),
        `-> ${hits.map((h) => h.action.id).join(', ') || 'nothing'}`);
    }
    for (const verb of (a.verbs ?? []).slice(0, 4)) {
      for (const obj of a.objects.slice(0, 3)) {
        for (const phrase of [`${verb} ${obj}`, `${obj} ${verb}`, `${verb} the ${obj} please`]) {
          const hits = suggestActions(phrase, CAPS[role], 8);
          ok(`${a.id}: "${phrase}"`, hits.some((h) => h.action.id === a.id),
            `-> ${hits.map((h) => h.action.id).join(', ') || 'nothing'}`);
        }
      }
    }
    for (const phrase of a.phrases ?? []) {
      const hits = suggestActions(phrase, CAPS[role], 8);
      ok(`${a.id}: phrase "${phrase}"`, hits.some((h) => h.action.id === a.id),
        `-> ${hits.map((h) => h.action.id).join(', ') || 'nothing'}`);
    }
  }

  // And a person who is not allowed it must never be offered it, from
  // any of its words. An action that appears and then refuses teaches
  // people the tool is unreliable.
  for (const r of ROLES.filter((x) => !allowed.includes(x))) {
    for (const obj of a.objects) {
      const hits = suggestActions(obj, CAPS[r], 8);
      ok(`${a.id} hidden from ${r}: "${obj}"`, !hits.some((h) => h.action.id === a.id));
    }
    for (const phrase of a.phrases ?? []) {
      ok(`${a.id} hidden from ${r}: "${phrase}"`,
        !suggestActions(phrase, CAPS[r], 8).some((h) => h.action.id === a.id));
    }
  }
}

// The case named in the requirement, spelled out.
ok('admin can elevate somebody',
  suggestActions('elevate dave to admin', CAPS.admin, 8).some((h) => h.action.id === 'admin.role'));
for (const r of ['sales', 'marketer', 'viewer'] as UserRole[]) {
  ok(`${r} cannot elevate anybody`,
    !suggestActions('elevate dave to admin', CAPS[r], 8).some((h) => h.action.id === 'admin.role'));
}

/* Screens are reached through the action registry, because that is the
   one that knows about permission. This asserts the two lists cannot
   drift: every screen the app has, and every word anybody might type for
   it, has to resolve for somebody. */
for (const f of FEATURES) {
  ok(`screen ${f.path} has an action`, ACTIONS.some((a) => a.path === f.path));
  for (const term of [f.title, ...(f.aliases ?? [])]) {
    const reached = ROLES.some((r) =>
      suggestActions(term, CAPS[r], 8).some((h) => h.action.path === f.path));
    ok(`"${term}" reaches ${f.title}`, reached);
  }
}

// A viewer sees fewer things than an admin, and both see something.
ok('a viewer has actions', availableActions(CAPS.viewer).length > 0);
ok('an admin has more than a viewer',
  availableActions(CAPS.admin).length > availableActions(CAPS.viewer).length);

/* ---------- the combinations ---------- */

const STATES = STATE_PHRASES.flatMap((p) => p.words.map((w) => ({ word: w, value: p.value })));
const BODIES = [...new Set(Object.entries(BODY_TYPES).map(([w, v]) => `${w}|${v}`))]
  .map((s) => { const [word, value] = s.split('|'); return { word, value }; });
const PLACES = [...new Set(Object.entries(DEPOTS).map(([w, v]) => `${w}|${v}`))]
  .map((s) => { const [word, value] = s.split('|'); return { word, value }; });

const PERIODS = [
  { phrase: 'this week', expect: true },
  { phrase: 'last week', expect: true },
  { phrase: 'this month', expect: true },
  { phrase: 'in the past 7 days', expect: true },
  { phrase: 'in the past 9 weeks', expect: true },
  { phrase: 'this year', expect: true },
];

function filterValue(text: string, key: string): string | undefined {
  return parseQuery(text)?.filters.find((f) => f.key === key)?.value;
}

// State words, every one of them, in four sentence shapes.
for (const s of STATES) {
  const shapes = [
    `how many trailers ${s.word}`,
    `how many trailers are ${s.word}`,
    `count of trailers ${s.word}`,
    `trailers ${s.word} how many`,
  ];
  for (const shape of shapes) {
    ok(`state "${s.word}"`, filterValue(shape, 'status') === s.value, `in "${shape}"`);
  }
}

// Body types, including against a state so the two do not fight.
for (const b of BODIES) {
  ok(`body "${b.word}"`, filterValue(`how many ${b.word} in stock`, 'category') === b.value);
  ok(`body "${b.word}" with a sale`, filterValue(`how many ${b.word} sold this week`, 'category') === b.value);
}

// Depots, named after the question and bare in front of it.
for (const p of PLACES) {
  ok(`depot "${p.word}" after`, filterValue(`how many trailers at ${p.word}`, 'location') === p.value);
  ok(`depot "${p.word}" before`, filterValue(`${p.word} - how many trailers parked up`, 'location') === p.value);
}

// Periods survive alongside filters.
for (const t of PERIODS) {
  const plan = parseQuery(`how many curtainsiders sold ${t.phrase}`);
  ok(`period "${t.phrase}"`, Boolean(plan?.range), `-> ${plan?.summary}`);
  ok(`period "${t.phrase}" keeps the body type`, plan?.filters.some((f) => f.key === 'category') === true);
}

// The four together, in six word orders.
for (const order of [
  'how many 4.2m curtainsiders in stock at carrington',
  'carrington - how many 4.2m curtainsiders parked up',
  'how many curtainsiders 4.2m are we storing at carrington',
  'at carrington how many 4.2m curtain trailers sat there',
  'curtainsider count 4.2m carrington in stock',
  'can you tell me how many 4.2m tautliners we have stored at carrington please',
]) {
  const plan = parseQuery(order);
  ok(`all four: "${order}"`,
    plan?.filters.some((f) => f.key === 'category' && f.value === 'Curtainsider') === true
    && plan?.filters.some((f) => f.key === 'location' && f.value === 'Carrington') === true
    && plan?.filters.some((f) => f.key === 'status' && f.value === 'in_stock') === true
    && plan?.filters.some((f) => f.key === 'size') === true,
    `-> ${plan?.summary ?? 'NO PLAN'}`);
}

// Politeness must never change the answer.
const plain = parseQuery('how many trailers in stock')?.summary;
for (const polite of [
  'can you tell me how many trailers in stock',
  'please could you check how many trailers in stock',
  'do you know how many trailers in stock',
  'i need to know how many trailers in stock',
  'show me how many trailers in stock thanks',
]) {
  ok(`politeness: "${polite}"`, parseQuery(polite)?.summary === plain,
    `-> ${parseQuery(polite)?.summary} vs ${plain}`);
}

/* ---------- the eight asked for by name ----------
   Pinned separately from the sweep because these are the sentences the
   requirement was written against. If the sweep and these ever disagree,
   these are right. */
const ASKED_FOR: { q: string; expect: Record<string, string | boolean> }[] = [
  { q: 'how many trailers in stock right now', expect: { status: 'in_stock' } },
  { q: 'how many trailers on the stock list', expect: { status: 'in_stock' } },
  { q: 'how many 4.2m curtainsiders are we storing at carrington',
    expect: { status: 'in_stock', category: 'Curtainsider', location: 'Carrington', size: '4.2' } },
  { q: 'can you check the stock list and tell me how many trailers are being stored at Carrington',
    expect: { status: 'in_stock', location: 'Carrington' } },
  { q: 'carrington - how many trailers parked up?', expect: { status: 'in_stock', location: 'Carrington' } },
  { q: 'how many curtainsiders have we sold this week?',
    expect: { status: 'sold', category: 'Curtainsider', range: true } },
  { q: 'how many curtain trailers sold in past 7 days',
    expect: { status: 'sold', category: 'Curtainsider', range: true } },
  { q: 'value of all trailers sold by dave in the past 9 weeks',
    expect: { status: 'sold', rep: 'Dave', range: true, measure: 'sum' } },
];

for (const c of ASKED_FOR) {
  const plan = parseQuery(c.q);
  for (const [key, want] of Object.entries(c.expect)) {
    const got = key === 'range' ? Boolean(plan?.range)
      : key === 'measure' ? plan?.measure
      : plan?.filters.find((f) => f.key === key)?.value;
    ok(`asked for: "${c.q}" -> ${key}`, got === want, `got ${String(got)}, want ${String(want)}`);
  }
}

/* ---------- a bare verb is never a dead end ----------

   The report was "I typed export and nothing came back". The action
   registry only scored when an object word matched, so a verb on its own
   fell through to the empty state, and even fixed it would have offered
   two entries. What somebody means by "export" is "what can I export",
   and the answer is hundreds of runnable sentences built from the
   dictionary. These assert the shape of that, not a list of them. */

for (const verb of ['export', 'download', 'how many', 'list', 'value of', 'count']) {
  const got = composeSuggestions(verb, CAPS.admin, 8);
  ok(`bare verb "${verb}" offers options`, got.length >= 5, `got ${got.length}`);
  ok(`bare verb "${verb}" offers runnable sentences`,
    got.every((g) => g.phrase.trim().split(/\s+/).length >= 2),
    got.map((g) => g.phrase).join(' / '));
}

// Half a word already narrows. "expo" is somebody mid-type, not a typo.
ok('half typed "expo" still offers exports',
  composeSuggestions('expo', CAPS.admin, 8).length >= 5);

// Naming the thing narrows to that thing.
for (const [q, want] of [['export customers', 'customers'], ['export trailers', 'trailers'],
                         ['how many proposals', 'proposals']] as const) {
  const got = composeSuggestions(q, CAPS.admin, 8);
  ok(`"${q}" narrows to ${want}`, got.length > 0 && got.every((g) => g.phrase.includes(want)),
    got.map((g) => g.phrase).join(' / '));
}

// Named by the user: customers in a place, and a period.
ok('export offers a depot',
  composeSuggestions('export customers', CAPS.admin, 12).some((g) => /carrington|bredbury|hyde/.test(g.phrase)),
  composeSuggestions('export customers', CAPS.admin, 12).map((g) => g.phrase).join(' / '));
ok('naming the depot puts it first',
  composeSuggestions('export customers in carrington', CAPS.admin, 4)[0]?.phrase.includes('carrington') === true);
ok('export offers a period',
  composeSuggestions('export trailers', CAPS.admin, 12).some((g) => /this week|this month|past 7 days|this year/.test(g.phrase)));

/* ---------- and nothing you cannot do ---------- */
for (const role of ROLES) {
  const allowed = CAPS[role].has('crm.export');
  const got = composeSuggestions('export', CAPS[role], 8);
  ok(`compose: ${role} ${allowed ? 'gets' : 'never gets'} exports`,
    allowed ? got.length > 0 : got.length === 0);
}

/* ---------- instructions, not just questions ----------

   "Add £1k refurb value to STC143980" was read as a question about
   trailers and answered with a list, which is worse than doing nothing
   because it looks like it worked. Every one of these has to come back
   as a plan naming the column, the operation and the value. */

const EDITS: { q: string; key: string; op: string; value: unknown; target?: string }[] = [
  { q: 'add £1k refurb value to STC143980', key: 'refurb_costs', op: 'add', value: 1000, target: 'STC143980' },
  { q: 'add 1000 refurb to STC143980', key: 'refurb_costs', op: 'add', value: 1000, target: 'STC143980' },
  { q: 'stick another 2.5k on the refurb for stc143980', key: 'refurb_costs', op: 'add', value: 2500, target: 'STC143980' },
  { q: 'set refurb cost 1200 on STC143980', key: 'refurb_costs', op: 'set', value: 1200, target: 'STC143980' },
  { q: 'stc143980 refurb 1200', key: 'refurb_costs', op: 'set', value: 1200, target: 'STC143980' },
  { q: 'set the nbv on STC1439 to 8,500', key: 'nbv', op: 'set', value: 8500, target: 'STC1439' },
  { q: 'knock 250 off the retail on STC143980', key: 'retail_price', op: 'subtract', value: 250, target: 'STC143980' },
  { q: 'move STC143980 to Carrington', key: 'location', op: 'set', value: 'Carrington', target: 'STC143980' },
  { q: 'stc 143980 is parked at bredbury', key: 'location', op: 'set', value: 'Bredbury', target: 'STC143980' },
  { q: 'mot on stc143980 is 14/03/2027', key: 'mot_date', op: 'set', value: '2027-03-14', target: 'STC143980' },
  { q: 'set the mot on STC143980 to 3 March 2027', key: 'mot_date', op: 'set', value: '2027-03-03', target: 'STC143980' },
  { q: 'clear the customer on STC143980', key: 'customer', op: 'clear', value: null, target: 'STC143980' },
  { q: 'set status on stc143980 to rental', key: 'status', op: 'set', value: 'rental', target: 'STC143980' },
  { q: 'change the sale price on STC143980 to 24k', key: 'sales_price', op: 'set', value: 24000, target: 'STC143980' },
  { q: 'add a note to Dawson: chasing tyre quote', key: 'notes', op: 'add', value: 'chasing tyre quote', target: 'Dawson' },
  { q: 'change the owner on Dawson Group to Dave', key: 'assigned_to', op: 'set', value: 'Dave', target: 'Dawson Group' },
];

/* A column a trigger owns is not an instruction, however ordinary the
   sentence sounds.

   `crm_contacts.fleet_size` is declared in columns.ts as "derived from
   trucks, trailers and vans by a trigger" and was ALSO curated into the
   writable dictionary, so this case used to assert that setting it was
   an instruction. It was: the bar read it, the route wrote it, and the
   trigger overwrote it. The canonical validator refused the plan, which
   is how the two dictionaries were found to disagree, and the curated
   entry is now dropped rather than trusted. */
const NOT_INSTRUCTIONS = [
  'set the fleet size on Dawson to 45',
];

for (const q of NOT_INSTRUCTIONS) {
  ok(`edit: "${q}" is not offered, because a trigger owns that column`,
    parseEdit(q, CAPS.admin) === null, 'it was read as an instruction');
}

for (const c of EDITS) {
  const p = parseEdit(c.q, CAPS.admin);
  ok(`edit: "${c.q}" is an instruction`, !!p, 'no plan');
  if (!p) continue;
  ok(`edit: "${c.q}" -> column`, p.field.key === c.key, `got ${p.field.key}, want ${c.key}`);
  ok(`edit: "${c.q}" -> operation`, p.op === c.op, `got ${p.op}, want ${c.op}`);
  ok(`edit: "${c.q}" -> value`, p.value === c.value, `got ${String(p.value)}, want ${String(c.value)}`);
  if (c.target) ok(`edit: "${c.q}" -> record`, p.target?.text === c.target, `got ${p.target?.text}`);
  ok(`edit: "${c.q}" is complete`, p.missing.length === 0, p.missing.join(','));
  ok(`edit: "${c.q}" is confident enough to act on`, p.confidence >= 10, String(p.confidence));
}

/* A question that names a field is still a question. Reading it as an
   instruction would edit a record somebody was only asking about. */
for (const q of [
  'how much refurb on STC143980?',
  'what is the mot on stc143980',
  'which trailers are at carrington',
  'how many trailers have a refurb cost',
  'what is the nbv on STC143980',
]) {
  ok(`question stays a question: "${q}"`, parseEdit(q, CAPS.admin) === null,
    `-> ${parseEdit(q, CAPS.admin)?.summary}`);
}

/* Marking sold is understood, and handed on rather than written. It
   raises a commission line on somebody's tracker and needs a price, so
   the bar names the units and stops there. */
const soldPlan = parseEdit('mark STC143580 and 144504 as sold', CAPS.admin);
ok('selling is understood', !!soldPlan);
ok('selling is handed to the sold flow', soldPlan?.handoff === 'markSold', String(soldPlan?.handoff));
ok('selling names both units', soldPlan?.targets.map((t) => t.text).join(',') === 'STC143580,144504',
  soldPlan?.targets.map((t) => t.text).join(','));

/* ---------- the ten typed out verbatim ----------

   Every one of these was typed at the bar and checked against what came
   back. Seven were wrong on the first pass and two of those were wrong
   in the dangerous way: a write aimed at the wrong column, and a
   question answered confidently with a filter on a rep who does not
   exist. Pinned here so they cannot go back. */

const VERBATIM_EDITS: { q: string; key: string; op: string; value: unknown; targets: string[] }[] = [
  { q: `Reduce STC143140's refurb cost by £100`,
    key: 'refurb_costs', op: 'subtract', value: 100, targets: ['STC143140'] },
  // The STC number is the value here, not the record. Read the other way
  // round this renames a different trailer.
  { q: 'Add stock number STC150001 to C734105',
    key: 'stc_no', op: 'set', value: 'STC150001', targets: ['C734105'] },
  // No prefix, and the digits cannot be the value because a depot is not
  // a number.
  { q: 'Move 143480 to bredbury ',
    key: 'location', op: 'set', value: 'Bredbury', targets: ['143480'] },
  { q: 'mark all outstanding social posts as approved',
    key: 'status', op: 'set', value: 'approved', targets: ['outstanding'] },
];

for (const c of VERBATIM_EDITS) {
  const p = parseEdit(c.q, CAPS.admin);
  ok(`verbatim: "${c.q.trim()}" is an instruction`, !!p, 'no plan');
  if (!p) continue;
  ok(`verbatim: "${c.q.trim()}" -> column`, p.field.key === c.key, `got ${p.field.key}`);
  ok(`verbatim: "${c.q.trim()}" -> operation`, p.op === c.op, `got ${p.op}`);
  ok(`verbatim: "${c.q.trim()}" -> value`, p.value === c.value, `got ${String(p.value)}`);
  ok(`verbatim: "${c.q.trim()}" -> records`,
    p.targets.map((t) => t.text).join(',') === c.targets.join(','),
    `got ${p.targets.map((t) => t.text).join(',')}`);
  ok(`verbatim: "${c.q.trim()}" is complete`, p.missing.length === 0, p.missing.join(','));
}

/* A bulk instruction describes the rows rather than naming them, and the
   half after "as" is where they are going. Reading the longest state
   word won meant "mark all outstanding as approved" set every approved
   post back to outstanding: the instruction exactly inverted. */
const bulk = parseEdit('mark all outstanding social posts as approved', CAPS.admin);
ok('bulk: targets a description', bulk?.target?.kind === 'filter', bulk?.target?.kind);
ok('bulk: narrows on the state described',
  bulk?.target?.kind === 'filter' && bulk.target.value === 'pending_review',
  bulk?.target?.kind === 'filter' ? bulk.target.value : '-');
ok('bulk: approving needs the approve capability',
  !parseEdit('mark all outstanding social posts as approved', CAPS.marketer));

/* "All" on its own is not a subset. A bar that acts on a whole table
   from four words ruins somebody's afternoon, so the instruction is
   understood and then held, waiting for which ones. */
const vague = parseEdit('approve everything', CAPS.admin);
ok('bulk: an unnarrowed everything never runs',
  !vague || vague.missing.includes('target'), vague?.missing.join(','));

/* A negation is not a typo. The fuzzy matcher used to bridge
   "approved" and "unapproved" on a two edit budget. */
ok('fuzzy: does not bridge a negation',
  parseEdit('mark all outstanding social posts as approved', CAPS.admin)?.value === 'approved');
ok('fuzzy: still forgives a real typo',
  parseEdit('aprove all pending social posts', CAPS.admin)?.value === 'approved');

/* ---------- the questions from the same ten ---------- */
const VERBATIM_QUERIES: { q: string; expect: Record<string, string | boolean> }[] = [
  // The colour and the bracket both used to be dropped, so this answered
  // with every curtainsider on the yard at any price.
  { q: 'Give me a list of blue curtainsiders between 5k and 10k',
    expect: { category: 'Curtainsider', colour: 'Blue', min: '5000', max: '10000' } },
  // Counted trailers before there was anywhere else for it to go.
  { q: 'How many social posts are left to approve',
    expect: { entity: 'posts', status: 'pending_review', measure: 'count' } },
  // "just" was read as the name of the rep who sold them, and "today"
  // was stripped as a politeness, so this answered for all time.
  { q: 'How much revenue did we make from just trailer sales today? ',
    expect: { entity: 'trailers', measure: 'sum', range: true, noRep: true } },
];

for (const c of VERBATIM_QUERIES) {
  const plan = parseQuery(c.q);
  ok(`verbatim query: "${c.q.trim()}" parses`, !!plan);
  if (!plan) continue;
  for (const [key, want] of Object.entries(c.expect)) {
    const got = key === 'range' ? Boolean(plan.range)
      : key === 'measure' ? plan.measure
      : key === 'entity' ? plan.entity.id
      : key === 'noRep' ? !plan.filters.some((f) => f.key === 'rep')
      : plan.filters.find((f) => f.key === key)?.value;
    ok(`verbatim query: "${c.q.trim()}" -> ${key}`, got === want,
      `got ${String(got)}, want ${String(want)}`);
  }
}

// A period on a present tense state is meaningless, so it is dropped
// rather than silently narrowing the answer to nothing.
ok('in stock ignores a period', !parseQuery('how many trailers in stock today')?.range);
ok('sold keeps its period', !!parseQuery('how many trailers sold today')?.range);

/* Half a sentence gets offered endings rather than an error. */
ok('a bare stock number offers fields',
  composeEdits('STC143980', CAPS.admin, 6).length >= 5,
  String(composeEdits('STC143980', CAPS.admin, 6).length));
ok('a bare stock number offers refurb first',
  composeEdits('STC143980', CAPS.admin, 6)[0]?.phrase.includes('refurb') === true);
ok('a bare field name offers the sentence shape',
  composeEdits('refurb cost', CAPS.admin, 6).length > 0);

/* And nothing you cannot write. A read only viewer typing the exact
   sentence gets no plan at all, because an instruction that appears and
   then refuses is worse than one that was never offered. */
for (const role of ROLES) {
  const canStock = CAPS[role].has('stock.edit');
  ok(`edit: ${role} ${canStock ? 'can' : 'cannot'} set a refurb cost`,
    !!parseEdit('add £1k refurb value to STC143980', CAPS[role]) === canStock);
  ok(`edit: ${role} sees ${canStock ? 'some' : 'no'} trailer fields`,
    (composeEdits('STC143980', CAPS[role], 6).length > 0) === canStock);

  const canAssign = CAPS[role].has('crm.assign');
  ok(`edit: ${role} ${canAssign ? 'can' : 'cannot'} reassign an account`,
    !!parseEdit('change the owner on Dawson Group to Dave', CAPS[role]) === canAssign);
}

/* Every writable field has to be reachable by at least one of its own
   words, or it is a column nobody can type at. */
for (const f of WRITABLE_FIELDS) {
  const sentence = f.entity === 'trailers'
    ? `set ${f.aliases[0]} on STC143980 to ${sampleValue(f)}`
    : `set ${f.aliases[0]} on Dawson to ${sampleValue(f)}`;
  const p = parseEdit(sentence, CAPS.admin);
  // Selling is deliberately not a field edit, so it is the one exception.
  if (f.key === 'status' && f.entity === 'trailers') continue;
  ok(`field reachable: ${f.entity}.${f.key}`, p?.field.key === f.key,
    `"${sentence}" -> ${p?.field.key ?? 'NO PLAN'}`);
}

function sampleValue(f: { kind: string; vocabulary?: Record<string, string> }): string {
  switch (f.kind) {
    case 'money': return '1200';
    case 'number': return '12';
    case 'date': return '14/03/2027';
    case 'enum': return Object.keys(f.vocabulary ?? {})[0] ?? 'yes';
    default: return 'Carrington';
  }
}

/* ---------- selectors compose ----------

   A command is verb x rows x field x value, and "which rows" is the
   combinatorial half. These assert that clauses stack rather than
   overwriting each other, and that the two clause kinds which look
   alike stay apart: "with a fleet" is a presence test and "with a fleet
   over 50" is a comparison, and reading the second as the first throws
   the number away silently. */

const SELECTIONS: { q: string; entity: string; expect: string[] }[] = [
  { q: 'customers in Manchester with no owner not contacted in 30 days with a fleet over 50',
    entity: 'contacts',
    expect: ['fleet over 50', 'no owner', 'not contacted in 30 days', 'in Manchester'] },
  { q: 'quoted customers in bredbury with no email',
    entity: 'contacts', expect: ['no email', 'status quoted', 'in Bredbury'] },
  { q: 'unassigned leads never contacted',
    entity: 'deals', expect: ['nobody owns', 'never contacted'] },
  { q: 'trailers in stock with no mot date',
    entity: 'trailers', expect: ['no MOT date', 'status in stock'] },
  { q: 'trailers with a refurb cost over 5k at carrington',
    entity: 'trailers', expect: ['refurb cost over £5,000', 'in Carrington'] },
  { q: 'customers with no next action and no phone number',
    entity: 'contacts', expect: ['no next action', 'no phone number'] },
];

for (const c of SELECTIONS) {
  const sel = parseSelection(c.q, 'Alex Ellis');
  ok(`selector: "${c.q}" parses`, !!sel);
  if (!sel) continue;
  ok(`selector: "${c.q}" -> entity`, sel.entity.id === c.entity, sel.entity.id);
  const labels = sel.conditions.map((x) => x.label);
  for (const want of c.expect) {
    ok(`selector: "${c.q}" -> ${want}`, labels.includes(want), labels.join(' + '));
  }
  ok(`selector: "${c.q}" keeps every clause`,
    labels.length === c.expect.length, `got ${labels.length}, want ${c.expect.length}`);
}

/* The entity noun is not also a value for the entity. "Quoted customers"
   was coming back as status=customer with the real status discarded. */
ok('selector: the noun is not a filter',
  !parseSelection('quoted customers', 'Alex')
    ?.conditions.some((c) => c.label === 'status customers'));

/* A presence test must not swallow a comparison. */
const fleet = parseSelection('customers with a fleet over 50', 'Alex');
ok('selector: a comparison beats a presence test',
  !!fleet?.conditions.some((c) => c.kind === 'gte' && c.value === 50),
  fleet?.conditions.map((c) => c.label).join(' + '));

/* And a bare presence test still works when there is no number. */
ok('selector: a presence test survives on its own',
  !!parseSelection('customers with a phone number', 'Alex')
    ?.conditions.some((c) => c.kind === 'present'));

/* Every entity the bar answers questions about has to be able to
   express more than a handful of sets, or that tab still needs
   clicking through. Asserted per entity so a thin one is named. */
for (const e of ENTITIES_FOR_SPACE) {
  const space = selectionSpace(e);
  ok(`selector space: ${e.id} is more than a handful`, space >= 3, String(space));
}

/* ---------- the grammar composes ----------

   The operators are the reason a sentence nobody wrote down can work:
   an ordering, a limit, a negation, a comparison, a computed attribute
   and an emptiness test, applied to whatever attribute the sentence
   names. Six ideas, not six hundred sentences.

   So this asserts them by combination rather than one at a time. Every
   superlative against every body type, depot and state; every negator
   against every status; every "with no" against every column the app
   holds. A phrasing listed in a lexicon is a guess. A phrasing the
   sweep asserts is a promise. */

const SUPER_WORDS: { word: string; direction: 'asc' | 'desc' }[] = [
  { word: 'cheapest', direction: 'asc' },
  { word: 'most expensive', direction: 'desc' },
  { word: 'dearest', direction: 'desc' },
  { word: 'newest', direction: 'desc' },
  { word: 'oldest', direction: 'asc' },
];
const COUNTS = [3, 5, 10, 25];
const BODY_WORDS = [...new Set(Object.keys(BODY_TYPES))].slice(0, 6);
const YARDS = [...new Set(Object.values(DEPOTS))].slice(0, 5);

/* A superlative orders and takes one, and a number in front of it takes
   that many instead. Both survive a body type and a depot being added
   to the same sentence, which is the whole claim. */
for (const s of SUPER_WORDS) {
  for (const body of BODY_WORDS) {
    const p = parseQuery(`the ${s.word} ${body} in stock`);
    ok(`grammar: "${s.word} ${body} in stock" orders ${s.direction}`,
      p?.order?.direction === s.direction, p?.summary ?? 'no plan');
    ok(`grammar: "${s.word} ${body} in stock" takes one`,
      p?.limit === 1, String(p?.limit));
    ok(`grammar: "${s.word} ${body} in stock" keeps the body type`,
      !!p?.filters.some((f) => f.key === 'category'), p?.summary ?? 'no plan');

    for (const n of COUNTS) {
      const q = parseQuery(`the ${n} ${s.word} ${body} at ${YARDS[n % YARDS.length]}`);
      ok(`grammar: "${n} ${s.word} ${body}" takes ${n}`, q?.limit === n, String(q?.limit));
      ok(`grammar: "${n} ${s.word} ${body}" keeps the depot`,
        !!q?.filters.some((f) => f.key === 'location'), q?.summary ?? 'no plan');
    }
  }
}

/* Negation inverts the clause it is in front of and nothing else. An
   inverted answer looks exactly like a correct one, so this is asserted
   against every status the stock list has, in both spellings. */
const NEGATORS_TESTED = ['except', 'excluding', 'apart from', 'other than', 'not including'];
const STATUSES = [...new Set(STATE_PHRASES.map((s) => s.words[0]))].slice(0, 8);
for (const neg of NEGATORS_TESTED) {
  for (const status of STATUSES) {
    const p = parseQuery(`trailers ${neg} the ${status} ones`);
    if (!p) continue;
    const hit = p.filters.find((f) => f.key === 'status');
    if (!hit) continue;
    ok(`grammar: "${neg} the ${status} ones" inverts it`, hit.negate === true, p.summary);
  }
}
for (const status of STATUSES) {
  const p = parseQuery(`trailers that aren't ${status}`);
  const hit = p?.filters.find((f) => f.key === 'status');
  if (!hit) continue;
  ok(`grammar: "aren't ${status}" inverts it`, hit.negate === true, p!.summary);
  const yes = parseQuery(`trailers that are ${status}`);
  ok(`grammar: "are ${status}" does NOT invert it`,
    yes?.filters.find((f) => f.key === 'status')?.negate !== true, yes?.summary ?? 'no plan');
}

/* Emptiness, against every column the app can name on each entity. The
   claim is that any column somebody can ask about is a column they can
   ask to be blank, so it is swept rather than sampled. */
for (const e of ENTITIES_FOR_SPACE) {
  const cols = new Map<string, string>();
  for (const n of attributeNames(e)) if (!cols.has(n.column)) cols.set(n.column, n.alias);
  let asked = 0;
  for (const [column, alias] of cols) {
    if (alias.length < 4 || asked >= 12) continue;
    asked++;
    const p = parseQuery(`${e.label} with no ${alias}`);
    ok(`grammar: "${e.label} with no ${alias}" is an emptiness test`,
      !!p?.filters.some((f) => f.op === 'empty' && f.column === column),
      p?.summary ?? 'no plan');
    ok(`grammar: "${e.label} with no ${alias}" is not a total`,
      p?.measure !== 'sum', p?.summary ?? 'no plan');
  }
}

/* A comparison groups by whatever holds both sides, and does not also
   narrow to one of them. */
for (const a of YARDS) {
  for (const b of YARDS) {
    if (a === b) continue;
    const p = parseQuery(`how many trailers at ${a} versus ${b}`);
    if (!p?.compare) continue;
    ok(`grammar: "${a} versus ${b}" groups rather than narrows`,
      !p.filters.some((f) => f.column === p.compare!.column), p.summary);
  }
}

/* Stock age is computed, not stored, and asking for it must not be read
   as the status "in stock". */
for (const shape of ['stock age', 'days in stock', 'time on the yard']) {
  const p = parseQuery(`average ${shape} by depot`);
  ok(`grammar: "${shape}" is a computed attribute`, p?.derived?.id === 'stock_age',
    p?.summary ?? 'no plan');
}
for (const yard of YARDS) {
  const p = parseQuery(`what's been sitting at ${yard} longest`);
  ok(`grammar: "sitting at ${yard} longest" is an age, oldest first`,
    p?.derived?.id === 'stock_age' && p?.order?.direction === 'asc', p?.summary ?? 'no plan');
}

/* An ordering is not a limit. "Newest first" is a sorted list, and
   reading it as a superlative returns exactly one row. */
for (const shape of ['newest first', 'oldest first', 'cheapest first', 'dearest first']) {
  const p = parseQuery(`list trailers in stock ${shape}`);
  ok(`grammar: "${shape}" sorts without limiting`, !!p?.order && p?.limit === undefined,
    `${p?.order?.direction ?? 'none'} limit ${p?.limit}`);
}

/* And an ordering with nothing to order by says so rather than
   returning an unsorted list that looks sorted. "High to low" on its
   own does not name an attribute, and guessing one is how somebody ends
   up reading the wrong column out in a meeting. */
for (const shape of ['high to low', 'low to high', 'descending']) {
  const p = parseQuery(`list trailers in stock ${shape}`);
  ok(`grammar: "${shape}" alone admits it cannot sort`,
    !p?.order && (p?.unmet ?? []).length > 0, p?.summary ?? 'no plan');
  const named = parseQuery(`list trailers in stock by profit ${shape}`);
  ok(`grammar: "profit ${shape}" sorts on the named attribute`,
    named?.order?.column === 'profit', named?.summary ?? 'no plan');
}

console.log(`\n${pass}/${pass + fail} passing`);
if (failures.length) {
  console.log(`\nfirst failures:`);
  for (const f of failures) console.log(`  ${f}`);
}
if (fail) process.exit(1);
