/* =============================================================
   The rates a contract is priced on, and the tachograph.

   ---- The two faults this exists because of ----

   From the sales team, and confirmed by the business:

     check tacho graph in fleetsmart+, adding one to an asset doesnt
     update the cost?

   and then, having put van tachograph rates into the rate editor:

     actually i cant add it to this gold contract as an extra, it
     doesnt add any cost at all

   Two separate faults, and the second one hid the first.

   1. THE BUILDER NEVER READ THE SAVED RATE CARD. `ContractWizard`
      called `priceContract(input)` with no card, so it priced on the
      card the application ships with, whatever the rate editor said.
      The create and update routes did the same, so the screen and the
      database agreed and both were wrong, which is why nothing looked
      broken. Rates typed into the editor reached the amendment screen
      and the editor's own worked example and nothing else.

   2. EVERY ASSET DEFAULTED TO A TWO YEAR TACHOGRAPH. A tachograph is
      in the cab. A trailer has none and most vans have none, and with
      van rates now on the card a default of `2yr` would put a
      calibration on the price of every van anybody adds.

   And the shape they share, which is what is actually asserted here:

     A CONTROL THAT MOVES MUST MOVE THE PRICE, OR SAY WHY IT CANNOT.

   Run with `npm run check:fleetsmart-ratecard`.
   ============================================================= */
import { readFileSync } from 'node:fs';
import {
  ASSET_TYPES, SHIPPED_CARD, cardFrom, type RateCard,
} from '../lib/fleetsmart/ratecard';
import {
  blankAsset, defaultTacho, describe, priceAsset, priceContract, tachoPriced, withType,
} from '../lib/fleetsmart/price';
import { blankContract } from '../lib/fleetsmart/contract';
import type { ContractInput, FleetAsset } from '../lib/fleetsmart/types';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const base: ContractInput = { ...blankContract(), plan: 'Gold' };

function annual(type: string, tacho: FleetAsset['tacho'], card: RateCard): number {
  const a: FleetAsset = {
    ...blankAsset('k', 'Gold'), reg: 'AB12 CDE', type: type as FleetAsset['type'], tacho,
  };
  return priceAsset(a, base, card).annual;
}

/* The card the business has just typed van rates into. Built from the
   shipped one so the only difference is the thing under test. */
const WITH_VAN_RATES = cardFrom({
  ...SHIPPED_CARD,
  rates: SHIPPED_CARD.rates.map((r) =>
    (r.cls === 'Van' && /Tacho|DTCO/.test(r.line) ? { ...r, axle: [95, 95, 95, 95] } : r)),
}, 'test-van-tacho');

/* =============================================================
   1. Nothing arrives carrying a tachograph it should not have.
   ============================================================= */
head('What an asset starts with');

for (const t of ASSET_TYPES) {
  const started = withType(blankAsset('k', 'Gold'), t.type);
  const want = t.cls === 'Vehicle' ? '2yr' : 'none';
  ok(`a new ${t.type} starts on ${want}`, started.tacho === want,
    `it started on ${started.tacho}, so a ${t.cls.toLowerCase()} would be priced for `
    + 'tachograph work nobody asked for');
}

ok('and the default is decided by the class, not by the type',
  defaultTacho('Van') === 'none' && defaultTacho('Trailer') === 'none'
  && defaultTacho('Vehicle') === '2yr');

ok('a type with no class yet carries none',
  withType(blankAsset('k', 'Gold'), '').tacho === 'none');

/* The thing the business asked for, in their own words, as one line. */
ok('a van does not pick up a tachograph by default, even once vans have rates',
  annual('LCV', withType(blankAsset('k', 'Gold'), 'LCV').tacho, WITH_VAN_RATES)
  === annual('LCV', 'none', WITH_VAN_RATES),
  'a new van prices the same as a van with no tachograph on it, or the default is wrong');

/* =============================================================
   2. The control moves the price, or says why it cannot.
   ============================================================= */
head('Changing the tachograph changes the price, where there is a rate');

for (const t of ASSET_TYPES) {
  const { cls, axles } = describe(t.type);
  const priced = tachoPriced(cls, axles, SHIPPED_CARD);
  const moved = annual(t.type, '2yr', SHIPPED_CARD) !== annual(t.type, 'none', SHIPPED_CARD);
  ok(`${t.type}: the control is offered exactly when it does something`, priced === moved,
    priced
      ? 'the rate card prices a tachograph for this class but changing it moved nothing'
      : 'changing it moved the price, but the control is disabled as though it could not');
}

head('And a class that gains rates gains the control with it');

ok('the shipped card prices no tachograph for a van', !tachoPriced('Van', 2, SHIPPED_CARD));
ok('so changing it on a van moves nothing, which is why it is disabled',
  annual('LCV', '2yr', SHIPPED_CARD) === annual('LCV', 'none', SHIPPED_CARD));
ok('put van rates on the card and the control opens',
  tachoPriced('Van', 2, WITH_VAN_RATES));
ok('and then it moves the price',
  annual('LCV', '2yr', WITH_VAN_RATES) > annual('LCV', 'none', WITH_VAN_RATES),
  'van tachograph rates are on the card and adding one still costs nothing');

ok('a trailer has no tachograph on any card, because it has no cab',
  !tachoPriced('Trailer', 3, SHIPPED_CARD));

/* =============================================================
   3. The price on screen is the price on the card in force.

   The fault itself, stated as arithmetic: the same contract priced on
   two different cards must come to two different numbers. It could not,
   because the card was never read.
   ============================================================= */
head('A contract prices on the card it is given');

{
  const fleet: ContractInput = {
    ...base,
    customerName: 'A Haulier Limited',
    assets: [{ ...blankAsset('a1', 'Gold'), reg: 'AB12 CDE', type: 'LCV', tacho: '2yr' }],
  };
  const shipped = priceContract(fleet, SHIPPED_CARD).annual;
  const edited = priceContract(fleet, WITH_VAN_RATES).annual;
  ok('two cards, two prices', shipped !== edited,
    `both came to ${shipped}, so the card was not read`);
  ok('and the difference is the rate that was added', Math.abs((edited - shipped) - 95) < 0.005,
    `the difference was ${(edited - shipped).toFixed(2)} rather than 95.00`);
}

/* =============================================================
   4. Nothing prices on the shipped card by accident.

   The rule that would have caught the original fault without anybody
   thinking of the tachograph at all: a call that passes no rate card
   prices on whatever STC shipped, so every one of them has to be a
   decision somebody wrote down. Two are, and both are about drawing a
   document that has already gone out.

   A new one fails here on the day it is written.
   ============================================================= */
head('No screen prices on the shipped card by accident');

const ALLOWED = new Map<string, string>([
  ['components/FleetSmart.tsx',
    'a contract that has gone out prints the price it went out at, and a row saved before '
    + 'prices were stored has no card recorded to re-price it on'],
  ['app/fleetsmart-preview/page.tsx',
    'the dev only print harness, which fabricates a contract rather than reading one'],
]);

const SEARCHED = [
  'components/FleetSmart.tsx',
  'components/fleetsmart/wizard.tsx',
  'components/fleetsmart/amend-fleet.tsx',
  'components/fleetsmart/amend-drawer.tsx',
  'components/fleetsmart/rate-editor.tsx',
  'app/fleetsmart-preview/page.tsx',
  'app/api/fleetsmart/contracts/route.ts',
  'app/api/fleetsmart/contracts/[id]/route.ts',
  'app/api/fleetsmart/contracts/[id]/amend/route.ts',
];

for (const file of SEARCHED) {
  const src = readFileSync(file, 'utf8');
  /* A call whose argument list has no comma at the top level is a call
     with one argument, which is a call with no rate card. */
  const cardless: number[] = [];
  for (const m of src.matchAll(/\bprice(?:Contract|Asset)\s*\(/g)) {
    let i = m.index! + m[0].length, depth = 0, comma = false, quote = '';
    for (; i < src.length; i += 1) {
      const c = src[i]!;
      if (quote) { if (c === '\\') { i += 1; continue; } if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(' || c === '{' || c === '[') { depth += 1; continue; }
      if (c === ')' && depth === 0) break;
      if (c === ')' || c === '}' || c === ']') { depth -= 1; continue; }
      if (c === ',' && depth === 0) { comma = true; break; }
    }
    if (!comma) cardless.push(src.slice(0, m.index).split('\n').length);
  }

  const why = ALLOWED.get(file);
  if (cardless.length === 0) {
    ok(`${file} always names the card it prices on`, true);
  } else if (why) {
    ok(`${file} prices on the shipped card, on purpose`, true);
    console.log(`        line ${cardless.join(', ')}: ${why}`);
  } else {
    ok(`${file} always names the card it prices on`, false,
      `line ${cardless.join(', ')} prices with no rate card, so it uses whatever STC shipped `
      + 'rather than the rates in force. Pass the card, or say here why it cannot.');
  }
}

/* And the allowlist cannot rot: a file listed as an exception that no
   longer needs to be one is a line to delete. */
for (const [file, why] of ALLOWED) {
  const src = readFileSync(file, 'utf8');
  const any = /\bprice(?:Contract|Asset)\s*\(/.test(src);
  ok(`${file} is still an exception worth having`, any,
    `it no longer prices anything, so its line in ALLOWED is dead: ${why}`);
}

console.log(bad === 0
  ? '\n  A contract prices on the rates in force, and a tachograph nobody asked for costs nothing.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
