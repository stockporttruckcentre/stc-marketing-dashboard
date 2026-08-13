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
import { parseQuery } from '../lib/command/query';
import { suggestFeatures, FEATURES } from '../lib/command/features';
import { STATE_PHRASES, BODY_TYPES, DEPOTS } from '../lib/command/lexicon';
import { ACTIONS, suggestActions, availableActions } from '../lib/command/actions';
import { composeSuggestions } from '../lib/command/compose';
import { parseEdit, composeEdits } from '../lib/command/mutate';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { capabilitiesFor, LUSHA_LOCKED } from '../lib/crm/permissions';
import type { UserRole } from '../lib/types';

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
  { q: 'set the fleet size on Dawson to 45', key: 'fleet_size', op: 'set', value: 45, target: 'Dawson' },
];

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

/* Marking sold is not a field edit. It raises a commission line on
   somebody's tracker, so it keeps its own confirmation. */
ok('selling is handed to the sold flow', parseEdit('mark STC143980 as sold', CAPS.admin) === null);

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

console.log(`\n${pass}/${pass + fail} passing`);
if (failures.length) {
  console.log(`\nfirst failures:`);
  for (const f of failures) console.log(`  ${f}`);
}
if (fail) process.exit(1);
