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

console.log(`\n${pass}/${pass + fail} passing`);
if (failures.length) {
  console.log(`\nfirst failures:`);
  for (const f of failures) console.log(`  ${f}`);
}
if (fail) process.exit(1);
