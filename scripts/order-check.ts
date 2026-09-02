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

console.log(
  failed === 0
    ? '\n  Every tab comes back exactly once, whatever was saved.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
