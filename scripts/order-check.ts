/* =============================================================
   An order somebody chose, and everything that can go wrong with it
   later.

   From the business, about the tracker's three division tabs:

     make it so people can re-order them by drag and it saves forever
     device-wide.

   "Forever" is the hard half. The saved order is a list of keys written
   at some point in the past; the tabs it is applied to are whatever the
   application has today. Those two disagree the moment anybody adds a
   division, renames one, or opens the app in a browser that hands back
   a string somebody edited.

   The failure that matters is not a wrong order. It is a MISSING TAB: a
   fourth division added next year, absent from every saved order, and
   quietly dropped from the strip for every person who has ever dragged
   one. Nobody would report that as a bug in tab ordering, because it
   does not look like one.

   So the rule this asserts throughout is: whatever the saved order
   says, every tab comes back, exactly once.
   ============================================================= */

import { applyOrder, moveTo } from '../lib/ui/order';
import { readChoice, writeChoice, forgetChoice } from '../lib/ui/remember';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

const SIDES = ['trailer_sales', 'maintenance', 'rental'].map((key) => ({ key }));
const keys = (items: { key: string }[]) => items.map((i) => i.key).join(',');

console.log('\n  Applying a saved order\n  ----------------------');

ok('nothing saved leaves the declared order alone',
  keys(applyOrder(SIDES, null)) === 'trailer_sales,maintenance,rental');

ok('an empty saved order leaves it alone',
  keys(applyOrder(SIDES, [])) === 'trailer_sales,maintenance,rental');

ok('a saved order is honoured',
  keys(applyOrder(SIDES, ['rental', 'trailer_sales', 'maintenance']))
    === 'rental,trailer_sales,maintenance');

/* ---- THE ONE THAT WOULD NOT BE REPORTED AS A TAB BUG ----

   A division added after somebody saved their order. It is in none of
   their saved lists and it has to appear anyway. */
{
  const withFourth = [...SIDES, { key: 'parts' }];
  const got = applyOrder(withFourth, ['rental', 'trailer_sales', 'maintenance']);
  ok('a division added later still appears',
    got.some((x) => x.key === 'parts'),
    'It was dropped, which on the real screen is a tab that silently stops existing '
    + 'for everybody who has ever dragged one.');
  ok('and it goes at the end rather than the front',
    keys(got) === 'rental,trailer_sales,maintenance,parts',
    `got ${keys(got)}. Sorting the unknown one first would put next year's division `
    + 'ahead of the order somebody deliberately set.');
}

/* ---- A division removed since ---- */
ok('a saved key that no longer exists is ignored',
  keys(applyOrder(SIDES, ['gone', 'rental', 'also_gone', 'trailer_sales', 'maintenance']))
    === 'rental,trailer_sales,maintenance');

/* ---- Nonsense in storage, which is a string a person can edit ---- */
for (const [what, saved] of [
  ['a saved order of keys that are all unknown', ['a', 'b', 'c']],
  ['the same key three times', ['rental', 'rental', 'rental']],
  ['one key only', ['rental']],
] as [string, string[]][]) {
  const got = applyOrder(SIDES, saved);
  ok(`${what} still returns every tab exactly once`,
    got.length === SIDES.length && new Set(got.map((x) => x.key)).size === SIDES.length,
    `got ${keys(got)}`);
}

/* One key only puts that one first and leaves the rest in their
   declared order behind it, which is what a half saved list should
   mean. */
ok('a partial saved order puts what it names first',
  keys(applyOrder(SIDES, ['rental'])) === 'rental,trailer_sales,maintenance');

/* ---- The input is not modified ---- */
{
  const declared = [...SIDES];
  applyOrder(declared, ['rental', 'maintenance', 'trailer_sales']);
  ok('applying an order does not reorder the list it was given',
    keys(declared) === 'trailer_sales,maintenance,rental',
    'A sort in place would leave the declared order permanently changed, and the next '
    + 'render would apply the saved order to an already reordered list.');
}

console.log('\n  Moving one\n  ----------');

const three = ['a', 'b', 'c'];

for (const [what, from, to, want] of [
  ['first to last', 0, 2, 'b,c,a'],
  ['last to first', 2, 0, 'c,a,b'],
  ['middle left', 1, 0, 'b,a,c'],
  ['middle right', 1, 2, 'a,c,b'],
  ['onto itself', 1, 1, 'a,b,c'],
] as [string, number, number, string][]) {
  ok(`${what} gives ${want}`, moveTo(three, from, to).join(',') === want,
    `got ${moveTo(three, from, to).join(',')}`);
}

/* An index off the end is what a drop outside the strip produces, and a
   negative one is what Alt with the left arrow on the first tab
   produces. Neither may lose the tab. */
for (const [what, from, to] of [
  ['dropped past the end', 0, 99],
  ['dragged before the start', 2, -5],
  ['a source index that is not there', 7, 0],
] as [string, number, number][]) {
  const got = moveTo(three, from, to);
  ok(`${what} keeps all three`,
    got.length === 3 && new Set(got).size === 3, `got ${got.join(',')}`);
}

ok('moving does not modify the list it was given', (() => {
  const list = ['a', 'b', 'c'];
  moveTo(list, 0, 2);
  return list.join(',') === 'a,b,c';
})());

/* ---- Every reachable order is reachable by dragging ----

   Three tabs have six orders. Somebody who wants Rental first and
   Maintenance second has to be able to get there, and a reorder that
   can only produce some permutations is a control that fights back. */
{
  const seen = new Set<string>();
  const walk = (order: string[], depth: number) => {
    seen.add(order.join(','));
    if (depth === 0) return;
    for (let from = 0; from < order.length; from += 1) {
      for (let to = 0; to < order.length; to += 1) {
        walk(moveTo(order, from, to), depth - 1);
      }
    }
  };
  walk(['a', 'b', 'c'], 3);
  ok('all six orders of three tabs are reachable by dragging',
    seen.size === 6, `only ${seen.size} reachable: ${[...seen].join(' | ')}`);
}

/* =============================================================
   And the other thing kept on the machine: one choice out of a set.

   `remember.ts` holds which layout a view is drawn in, and it exists
   because two rows of the Work rail were the same question in different
   shapes. From the business:

     My Work and my board seem like the same thing just a different
     view, then they both offer viewing options etc.

   The reason a second row existed was that the layout chips did not
   last. Making them last removes the row, and what makes that safe is
   the one rule below: this reads a string out of storage that anything
   on the machine can have written, and hands it back as a union type.
   Without the check that is a lie the type system cannot catch, and it
   shows up as a screen drawing nothing because `view.layout` is a word
   no layout answers to.
   ============================================================= */
console.log('\n  A choice, remembered\n  --------------------');

const LAYOUTS = ['board', 'table', 'list', 'calendar', 'timeline', 'workload'] as const;

/* A stand in for what a browser gives, including the two ways it does
   not: absent, and throwing on access. */
function withStorage(store: Storage | null, run: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const had = 'window' in g;
  const before = g.window;
  g.window = store === null
    ? { get localStorage(): Storage { throw new Error('site data is blocked'); } }
    : { localStorage: store };
  try { run(); } finally {
    if (had) g.window = before; else delete g.window;
  }
}

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

withStorage(fakeStorage(), () => {
  ok('nothing stored is null, not a guess',
    readChoice('work-layout:x', LAYOUTS) === null);
});

withStorage(fakeStorage({ 'stc-choice:work-layout:x': 'board' }), () => {
  ok('a stored choice comes back', readChoice('work-layout:x', LAYOUTS) === 'board');
});

/* ---- THE ONE THAT WOULD DRAW AN EMPTY SCREEN ----

   `layout` used to be one of seven words. Retire one, or let anything
   write to local storage, and a view whose remembered layout is 'gantt'
   matches none of the six branches that draw it: not an error, not an
   empty state, just a panel with nothing in it and no way to work out
   why. Which is exactly the class of fault nobody reports as a bug. */
withStorage(fakeStorage({ 'stc-choice:work-layout:x': 'gantt' }), () => {
  ok('a stored layout that no longer exists is refused, not handed on',
    readChoice('work-layout:x', LAYOUTS) === null);
});

withStorage(fakeStorage({ 'stc-choice:work-layout:x': '{"layout":"board"}' }), () => {
  ok('and so is anything else somebody put there',
    readChoice('work-layout:x', LAYOUTS) === null);
});

/* ---- Per view, not per screen ----

   The whole point of the key carrying the view's id. One layout for the
   whole Work tab would mean choosing a board on My work silently
   redraws Team work, which is the same "why did that change" the
   duplicate rows caused. */
{
  const store = fakeStorage();
  withStorage(store, () => {
    writeChoice('work-layout:mine', 'board');
    writeChoice('work-layout:team', 'table');
    ok('two views remember two different layouts',
      readChoice('work-layout:mine', LAYOUTS) === 'board'
      && readChoice('work-layout:team', LAYOUTS) === 'table');

    forgetChoice('work-layout:mine');
    ok('forgetting one leaves the other alone',
      readChoice('work-layout:mine', LAYOUTS) === null
      && readChoice('work-layout:team', LAYOUTS) === 'table');
  });
}

/* ---- A browser that refuses ----

   In a private window some browsers throw on the localStorage property
   itself, before any method is called. A screen that cannot remember
   how it was drawn opens the way it was saved. It does not fail to
   open, and it does not tell anybody. */
withStorage(null, () => {
  let threw = false;
  try {
    ok('storage that throws reads as no choice', readChoice('work-layout:x', LAYOUTS) === null);
    writeChoice('work-layout:x', 'board');
    forgetChoice('work-layout:x');
  } catch { threw = true; }
  ok('and writing to it is silent rather than fatal', !threw);
});

console.log(
  failed === 0
    ? '\n  Every tab comes back exactly once, and every remembered choice is one\n'
      + '  the screen can actually draw.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
