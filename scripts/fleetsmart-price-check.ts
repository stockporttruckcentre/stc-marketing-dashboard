/* =============================================================
   The FleetSmart+ pricing engine, against the workbook's own rules.

   `FleetSmart_Contract_Builder.xlsx` is the rate card and the method.
   `lib/fleetsmart/price.ts` is that method as code, and a port is only
   worth anything if somebody can show it still behaves like the thing
   it was ported from.

   So these are not tests of the code's own arithmetic. Every one of
   them is a rule the workbook states somewhere, restated here as a
   number, worked out by hand from the rate card rather than by calling
   the engine and writing down what it said. A check whose expected
   value came from the code under test is a check that passes the day
   the code is wrong.

   ---- The bug in the workbook that is deliberately not ported ----

   `Contract!H43` is `SUM(H18:H22)`. The asset block runs to row 42, so
   a fleet of six or more prints a monthly total lower than the sum of
   its own lines. That is a spreadsheet range that never grew with the
   sheet, and it is asserted against below: six assets total six assets.

   Run with `npm run check:price`.
   ============================================================= */
import {
  autoWearAndTear, blankAsset, describe, priceAsset, priceContract, round2,
} from '../lib/fleetsmart/price';
import { blankContract } from '../lib/fleetsmart/contract';
import {
  ASSET_TYPES, INCLUDED, OIL_LITRES, PLANS, PORTAL_PER_VISIT, RATES, SERVICE_KIT,
  SETTINGS, SILVER_PORTAL_PER_YEAR, WEAR_AND_TEAR_BASE,
  type AssetType, type Plan,
} from '../lib/fleetsmart/ratecard';
import type { ContractInput, FleetAsset } from '../lib/fleetsmart/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(what: string, holds: boolean, detail = ''): void {
  if (holds) { pass++; return; }
  fail++;
  failures.push(`${what}${detail ? `  (${detail})` : ''}`);
}

/** Money, to the penny, because a third of a pound is not a price. */
function near(what: string, got: number, want: number, tolerance = 0.005): void {
  ok(what, Math.abs(got - want) <= tolerance, `got ${got.toFixed(2)}, wanted ${want.toFixed(2)}`);
}

/** An asset with the reg and the type filled in and everything else default. */
function asset(type: AssetType, plan: Plan, over: Partial<FleetAsset> = {}): FleetAsset {
  return { ...blankAsset('a1', plan), reg: 'TEST 1', type, ...over };
}

function contract(plan: Plan, assets: FleetAsset[], over: Partial<ContractInput> = {}): ContractInput {
  return { ...blankContract(), plan, assets, ...over };
}

/** What one named line cost on one priced asset. */
function lineCost(priced: ReturnType<typeof priceAsset>, name: string): number {
  return priced.lines.find((l) => l.line === name)?.cost ?? 0;
}
function lineFreq(priced: ReturnType<typeof priceAsset>, name: string): number {
  return priced.lines.find((l) => l.line === name)?.frequency ?? 0;
}

/* =============================================================
   1. Inspection frequency. The workbook's T code.

   Visits a year is 52 divided by the PMI interval, rounded UP, because
   half a visit is a visit and the workshop books whole ones.
   ============================================================= */
for (const [weeks, want] of [[4, 13], [6, 9], [8, 7], [10, 6], [12, 5], [13, 4], [16, 4], [26, 2]] as [number, number][]) {
  const p = priceAsset(asset('6x2 Truck', 'Platinum', { pmiWeeks: weeks }),
    contract('Platinum', []));
  ok(`a ${weeks} week PMI is ${want} visits a year`, p.visitsPerYear === want,
    `got ${p.visitsPerYear}`);
}

/* The defaults, which are what a blank cell means rather than a missing
   value. Six weeks for anything on an O licence, twenty six for a van. */
ok('a vehicle defaults to a 6 week PMI',
  priceAsset(asset('6x2 Truck', 'Platinum'), contract('Platinum', [])).visitsPerYear === 9);
ok('a trailer defaults to a 6 week PMI',
  priceAsset(asset('3 Axle Trailer', 'Platinum'), contract('Platinum', [])).visitsPerYear === 9);
ok('a van defaults to a 26 week PMI',
  priceAsset(asset('LCV', 'Platinum'), contract('Platinum', [])).visitsPerYear === 2);

/* A typed zero is a zero, not a blank. This is the whole
   placeholder-as-default behaviour, and getting it backwards would
   charge four laden RBTs to a customer who asked for none. */
{
  const none = priceAsset(asset('6x2 Truck', 'Platinum', { ladenRbtPerYear: 0 }), contract('Platinum', []));
  const blank = priceAsset(asset('6x2 Truck', 'Platinum', { ladenRbtPerYear: null }), contract('Platinum', []));
  ok('a typed zero laden RBT charges none', lineFreq(none, 'Laden Brake Test (RBT)') === 0);
  ok('a blank laden RBT charges the standard four', lineFreq(blank, 'Laden Brake Test (RBT)') === 4);
}

/* =============================================================
   2. What each plan includes, from the Inclusions tab.

   Asserted as inclusion rather than as a price: a line the plan does
   not cover costs nothing however much it is worth.
   ============================================================= */
for (const plan of PLANS) {
  for (const { type, cls } of ASSET_TYPES) {
    const p = priceAsset(asset(type, plan), contract(plan, []));
    for (const l of p.lines) {
      /* The lines that answer to a switch on the asset rather than to
         the plan have their own assertions further down. */
      if (/Taillift|Tacho|DTCO|Collection|Wear & Tear|Portal|Miscellaneous|Telematics/.test(l.line)) continue;
      const shouldBe = INCLUDED[plan][cls].includes(l.line) && l.frequency > 0;
      ok(`${plan} ${type}: ${l.line} is ${shouldBe ? 'in' : 'out of'} the plan`,
        l.included === shouldBe);
      if (!shouldBe) ok(`${plan} ${type}: ${l.line} costs nothing`, l.cost === 0);
    }
  }
}

/* =============================================================
   3. One asset, worked out by hand.

   A 6x2 truck on Platinum, six weekly, everything standard. Every
   figure below is read out of the Rates tab and multiplied by hand,
   then the engine is asked for the same number.
   ============================================================= */
{
  const a = asset('6x2 Truck', 'Platinum', { age: 3, mileagePerYear: 60_000 });
  const p = priceAsset(a, contract('Platinum', [a]));
  const axles = describe('6x2 Truck').axles;

  // The rate card, read directly, for the lines a Platinum vehicle carries.
  let expected = 0;
  for (const r of RATES) {
    if (r.cls !== 'Vehicle') continue;
    if (r.line === 'Inspection/B Service') continue;
    if (/Taillift|Tacho|DTCO|Collection/.test(r.line)) continue;
    if (!INCLUDED.Platinum.Vehicle.includes(r.line)) continue;
    const price = r.axle[Math.max(0, Math.min(3, axles - 1))] ?? 0;
    const freq =
      r.freq === 'T' ? 9 :
      r.freq === 'A' ? 9 :
      r.freq === 'Cc' ? 1 :
      r.freq === 'BK' ? 0 :
      r.freq === 'LD' ? 4 :
      r.freq === '12' ? 12 :
      r.freq === 'BC' ? 1 :
      r.freq === 'Bc' ? 0 : 1;
    expected += price * freq;
  }
  // The blocks the rate card holds separately.
  expected += SERVICE_KIT['6x2 Truck'] * 1;
  expected += round2(OIL_LITRES['6x2 Truck'] * SETTINGS.oilPerLitre) * 1;
  expected += PORTAL_PER_VISIT.Vehicle * 9;
  expected += 100; // bulbs, a vehicle, once a year
  expected += autoWearAndTear('6x2 Truck', 3, 60_000);
  // Platinum carries the tail lift LOLER, and blankAsset ticks it.
  expected += (RATES.find((r) => r.line === 'Taillift LOLER & Weight Test' && r.cls === 'Vehicle')
    ?.axle[axles - 1] ?? 0);
  // The default tacho is the two year calibration.
  expected += (RATES.find((r) => r.line === '2 Year Tacho Calibration' && r.cls === 'Vehicle')
    ?.axle[axles - 1] ?? 0);

  near('a standard Platinum 6x2 truck prices to the rate card by hand', p.annual, round2(expected), 0.02);
  near('its monthly figure is the annual over twelve', p.monthly, p.annual / 12);
  near('its weekly figure is the annual over fifty two', p.weekly, p.annual / 52);
}

/* =============================================================
   4. Wear and tear, which is the one formula in the workbook nobody
      can do in their head.

   Base rate for the type, plus three percent for every year of
   effective age past four. Effective age is real age unless a mileage
   is given, in which case 60,000 miles counts as a year.
   ============================================================= */
near('a new truck earns the base wear and tear',
  autoWearAndTear('6x2 Truck', 0, null), WEAR_AND_TEAR_BASE['6x2 Truck']);
near('a four year old truck is still at the base rate',
  autoWearAndTear('6x2 Truck', 4, null), WEAR_AND_TEAR_BASE['6x2 Truck']);
near('a six year old truck carries two years of uplift',
  autoWearAndTear('6x2 Truck', 6, null), round2(WEAR_AND_TEAR_BASE['6x2 Truck'] * (1 + 0.03 * 2)));
near('three years at 90,000 miles counts as four and a half',
  autoWearAndTear('6x2 Truck', 3, 90_000),
  round2(WEAR_AND_TEAR_BASE['6x2 Truck'] * (1 + 0.03 * 0.5)));
near('a ten year old trailer carries six years of uplift',
  autoWearAndTear('3 Axle Trailer', 10, null),
  round2(WEAR_AND_TEAR_BASE['3 Axle Trailer'] * (1 + 0.03 * 6)));
ok('an asset with no type earns no wear and tear at all', autoWearAndTear('', 10, null) === 0);

{
  const gold = priceAsset(asset('6x2 Truck', 'Gold', { age: 8 }), contract('Gold', []));
  ok('Gold carries no wear and tear', lineCost(gold, 'Wear & Tear Allowance') === 0);

  const goldAgreed = priceAsset(asset('6x2 Truck', 'Gold', { age: 8, wearAndTear: 900 }), contract('Gold', []));
  near('a figure typed onto a Gold contract both sets it and turns it on',
    lineCost(goldAgreed, 'Wear & Tear Allowance'), 900);

  const over = priceAsset(asset('6x2 Truck', 'Platinum', { age: 8, wearAndTear: 1 }), contract('Platinum', []));
  near('a typed figure beats the automatic one', lineCost(over, 'Wear & Tear Allowance'), 1);
}

/* =============================================================
   5. The labour uplift, which applies to labour lines and nothing else.

   Nights is 1.25, combined days and nights is 1.125, and out of hours
   adds five percent on top of whichever it is.
   ============================================================= */
{
  const base = priceAsset(asset('6x2 Truck', 'Platinum'), contract('Platinum', []));
  const nights = priceAsset(asset('6x2 Truck', 'Platinum', { workPattern: 'Nights' }), contract('Platinum', []));
  const ooh = priceAsset(asset('6x2 Truck', 'Platinum', { outOfHours: true }), contract('Platinum', []));
  const both = priceAsset(asset('6x2 Truck', 'Platinum', { workPattern: 'Nights', outOfHours: true }),
    contract('Platinum', []));

  const labour = (p: typeof base) => p.lines.filter((l) => l.labour).reduce((n, l) => n + l.cost, 0);
  const parts = (p: typeof base) => p.lines.filter((l) => !l.labour).reduce((n, l) => n + l.cost, 0);

  ok('there are labour lines to uplift', labour(base) > 0);
  near('nights costs a quarter more on labour', labour(nights), labour(base) * 1.25, 0.02);
  near('out of hours adds five percent', labour(ooh), labour(base) * 1.05, 0.02);
  near('nights and out of hours compound', labour(both), labour(base) * 1.25 * 1.05, 0.02);
  near('parts are not upliftable', parts(nights), parts(base), 0.01);
  near('parts are not upliftable out of hours', parts(ooh), parts(base), 0.01);
}

/* =============================================================
   6. The tail lift, which is exactly one of two lines and never both.
   ============================================================= */
for (const plan of PLANS) {
  const on = priceAsset(asset('6x2 Truck', plan, { tailLift: true }), contract(plan, []));
  const off = priceAsset(asset('6x2 Truck', plan, { tailLift: false }), contract(plan, []));

  const loler = lineCost(on, 'Taillift LOLER & Weight Test');
  const cover = lineCost(on, 'Taillift Cover (optional extra)');
  ok(`${plan}: a tail lift is charged exactly once`, (loler > 0) !== (cover > 0));
  ok(`${plan}: Platinum carries the LOLER test and the others carry cover`,
    plan === 'Platinum' ? loler > 0 && cover === 0 : cover > 0 && loler === 0);
  ok(`${plan}: no tail lift is charged for an asset that has none`,
    lineCost(off, 'Taillift LOLER & Weight Test') === 0
    && lineCost(off, 'Taillift Cover (optional extra)') === 0);
}

/* =============================================================
   7. The tacho, which is one of four calibrations or none.
   ============================================================= */
for (const [tacho, line] of [
  ['2yr', '2 Year Tacho Calibration'],
  ['6yr', '6 Year Tacho Calibration'],
  ['DTCO', 'DTCO'],
  ['Smart', 'Smart DTCO'],
] as [FleetAsset['tacho'], string][]) {
  const p = priceAsset(asset('6x2 Truck', 'Platinum', { tacho }), contract('Platinum', []));
  const charged = p.lines.filter((l) => /Tacho|DTCO/.test(l.line) && l.cost > 0);
  ok(`tacho ${tacho} charges exactly one line`, charged.length === 1, `charged ${charged.length}`);
  ok(`tacho ${tacho} charges ${line}`, charged[0]?.line === line);
}
{
  const none = priceAsset(asset('6x2 Truck', 'Platinum', { tacho: 'none' }), contract('Platinum', []));
  ok('no tacho charges nothing',
    none.lines.filter((l) => /Tacho|DTCO/.test(l.line) && l.cost > 0).length === 0);
}

/* =============================================================
   8. Collection and delivery, priced off the labour rate rather than
      the rate card. One hour per visit, at the rate for the class.
   ============================================================= */
{
  const truck = asset('6x2 Truck', 'Platinum', { collectionAndDelivery: true });
  const trailer = asset('3 Axle Trailer', 'Platinum', { collectionAndDelivery: true, key: 'a2' });
  const van = asset('LCV', 'Platinum', { collectionAndDelivery: true, key: 'a3' });
  const c = contract('Platinum', [truck, trailer, van], { labourHgv: 90, labourTrailer: 70, labourVan: 60 });

  near('collection and delivery on a vehicle is nine hours at the HGV rate',
    lineCost(priceAsset(truck, c), 'Collection & Delivery'), 9 * 90);
  near('collection and delivery on a trailer takes the trailer rate',
    lineCost(priceAsset(trailer, c), 'Collection & Delivery'), 9 * 70);
  near('collection and delivery on a van is two visits at the van rate',
    lineCost(priceAsset(van, c), 'Collection & Delivery'), 2 * 60);

  const without = contract('Platinum', [], { labourHgv: 90 });
  ok('collection and delivery is not charged unless it is asked for',
    lineCost(priceAsset(asset('6x2 Truck', 'Platinum'), without), 'Collection & Delivery') === 0);
}

/* =============================================================
   9. The compliance portal, which changes shape between plans rather
      than only changing flag.
   ============================================================= */
{
  const silverOff = priceAsset(asset('6x2 Truck', 'Silver'), contract('Silver', []));
  const silverOn = priceAsset(asset('6x2 Truck', 'Silver', { portalAddOn: true }), contract('Silver', []));
  const gold = priceAsset(asset('6x2 Truck', 'Gold'), contract('Gold', []));

  ok('Silver has no portal unless it is added', lineCost(silverOff, 'Compliance Portal Access') === 0);
  near('the Silver portal add-on is a flat hundred a year',
    lineCost(silverOn, 'Compliance Portal Access'), SILVER_PORTAL_PER_YEAR);
  near('Gold prices the portal per inspection',
    lineCost(gold, 'Compliance Portal Access'), PORTAL_PER_VISIT.Vehicle * 9);
}

/* =============================================================
   10. Trailers carry no C service, no service kit, no oil, no bulbs.
   ============================================================= */
{
  const t = priceAsset(asset('3 Axle Trailer', 'Platinum'), contract('Platinum', []));
  for (const line of ['Service Kit (C)', 'Engine Oil', 'Bulb Replacement']) {
    ok(`a trailer is not charged for ${line}`, lineCost(t, line) === 0);
  }
  ok('a trailer gets one laden RBT at MOT by default', lineFreq(t, 'Laden Brake Test (RBT)') === 1);
}

/* =============================================================
   11. More plan buys more, for every asset type there is.

   Not a tautology: the inclusion matrix is hand entered, and a line
   dropped out of Platinum by mistake shows up here and nowhere else.
   ============================================================= */
for (const { type } of ASSET_TYPES) {
  const price = (plan: Plan) => {
    const a = asset(type, plan, { age: 5, mileagePerYear: 50_000 });
    return priceAsset(a, contract(plan, [a])).annual;
  };
  const [s, g, p] = [price('Silver'), price('Gold'), price('Platinum')];
  ok(`${type}: Gold costs more than Silver`, g > s, `${s} then ${g}`);
  ok(`${type}: Platinum costs at least as much as Gold`, p >= g, `${g} then ${p}`);
}

/* =============================================================
   12. The contract totals every asset it has.

   This is the workbook bug, asserted the right way round. `Contract!H43`
   is `SUM(H18:H22)`, five rows out of twenty five, so a fleet of six
   prints a total short by however much the sixth asset costs.
   ============================================================= */
{
  const one = asset('6x2 Truck', 'Platinum');
  const six = Array.from({ length: 6 }, (_, i) => ({ ...one, key: `a${i}`, reg: `TEST ${i}` }));
  const c = priceContract(contract('Platinum', six));
  const each = priceAsset(one, contract('Platinum', [one])).annual;

  ok('six assets are priced', c.assets.length === 6);
  near('six identical assets cost six times one', c.subtotal, round2(each * 6), 0.03);
  near('and the total is not the first five', c.annual, round2(each * 6), 0.03);
  ok('the first five would have been visibly less', round2(each * 5) < round2(each * 6));
}

/* =============================================================
   13. The two discounts, in the order the workbook applies them.

   The manager's comes off first as a percentage. The promotional one
   then comes off what is left, read as a percentage under 1 and as
   pounds at 1 or over, which is the workbook's own P6 rule.
   ============================================================= */
{
  const a = asset('6x2 Truck', 'Platinum');
  const plain = priceContract(contract('Platinum', [a]));

  const mgr = priceContract(contract('Platinum', [a], { managerDiscount: 0.1 }));
  near('a ten percent manager discount takes a tenth off', mgr.managerDiscount, round2(-plain.subtotal * 0.1));
  /* Worked the way the engine works it, and deliberately so: the
     discount line is rounded before it is added, because the figure
     printed on the contract has to be the figure that adds up. */
  near('and the annual is what is left',
    mgr.annual, round2(plain.subtotal + round2(-plain.subtotal * 0.1)));

  const pct = priceContract(contract('Platinum', [a], { managerDiscount: 0.1, promoDiscount: 0.05 }));
  near('a promo under one is a percentage of what is left',
    pct.promoDiscount, round2(-plain.subtotal * 0.9 * 0.05));

  const pounds = priceContract(contract('Platinum', [a], { promoDiscount: 250 }));
  near('a promo of one or more is pounds', pounds.promoDiscount, -250);
  near('and comes straight off the total', pounds.annual, round2(plain.subtotal - 250));

  const silly = priceContract(contract('Platinum', [a], { promoDiscount: 999_999 }));
  ok('a promotional discount cannot make a contract negative', silly.annual === 0,
    `got ${silly.annual}`);

  const none = priceContract(contract('Platinum', [a], { promoDiscount: 0 }));
  ok('no discount is no line', none.managerDiscount === 0 && none.promoDiscount === 0);
}

/* =============================================================
   14. The document may only claim what was charged.

   The workbook computes these flags for exactly this reason: a Platinum
   contract whose every asset is a trailer must not promise bulbs, and a
   fleet with no tail lifts must not list tail lift servicing.
   ============================================================= */
{
  const trailersOnly = priceContract(contract('Platinum', [
    asset('3 Axle Trailer', 'Platinum'),
    { ...asset('3 Axle Trailer', 'Platinum'), key: 'a2', reg: 'TEST 2' },
  ]));
  ok('a trailer only fleet does not claim service parts', !trailersOnly.flags.serviceParts);
  ok('a trailer only fleet does not claim a C service', !trailersOnly.flags.cService);
  ok('a trailer only fleet says trailers', trailersOnly.flags.assetWords === 'trailers');
  ok('a trailer only fleet has no vehicles', !trailersOnly.flags.hasVehicles);

  const noLift = priceContract(contract('Platinum', [asset('6x2 Truck', 'Platinum', { tailLift: false })]));
  ok('a fleet with no tail lifts does not claim tail lift work', !noLift.flags.tailLift);

  const mixed = priceContract(contract('Platinum', [
    asset('6x2 Truck', 'Platinum'),
    { ...asset('3 Axle Trailer', 'Platinum'), key: 'a2', reg: 'TEST 2' },
    { ...asset('LCV', 'Platinum'), key: 'a3', reg: 'TEST 3' },
  ]));
  ok('a mixed fleet names all three', mixed.flags.assetWords === 'vehicles, trailers and vans');

  const noTacho = priceContract(contract('Platinum', [asset('6x2 Truck', 'Platinum', { tacho: 'none' })]));
  ok('a fleet with no tacho work does not claim it', !noTacho.flags.tacho);

  const telematics = priceContract(contract('Platinum', [
    asset('3 Axle Trailer', 'Platinum', { telematicsPerYear: 480 }),
  ]));
  ok('telematics priced is telematics claimed', telematics.flags.telematics);
}

/* =============================================================
   15. Nothing ever produces a price that is not a price.

   Every asset type against every plan, with the awkward values in
   every numeric field. A NaN reaching the document prints "£NaN" on
   something a customer signs.
   ============================================================= */
{
  const awkward: Partial<FleetAsset>[] = [
    {},
    { age: 0, mileagePerYear: 0, pmiWeeks: 0 },
    { pmiWeeks: 0, cServicesPerYear: 0, brakeTestsPerYear: 0, ladenRbtPerYear: 0 },
    { age: 99, mileagePerYear: 500_000, misc: 0, telematicsPerYear: 0 },
    { wearAndTear: 0, misc: 0 },
  ];
  let clean = true;
  for (const plan of PLANS) {
    for (const { type } of ASSET_TYPES) {
      for (const over of awkward) {
        const a = asset(type, plan, over);
        const p = priceAsset(a, contract(plan, [a]));
        if (!Number.isFinite(p.annual) || p.annual < 0) {
          clean = false;
          failures.push(`${plan} ${type} ${JSON.stringify(over)} priced to ${p.annual}`);
        }
        for (const l of p.lines) {
          if (!Number.isFinite(l.cost) || l.cost < 0) {
            clean = false;
            failures.push(`${plan} ${type}: ${l.line} cost ${l.cost}`);
          }
        }
      }
    }
  }
  ok('every plan against every asset type against every awkward value prices cleanly', clean);
}

/* An asset with no reg or no type is not priced at all, because a blank
   row on the fleet step is a row somebody has not filled in yet rather
   than a free asset. */
{
  const blank = priceAsset(blankAsset('a1', 'Platinum'), contract('Platinum', []));
  ok('a blank row costs nothing', blank.annual === 0 && blank.lines.length === 0);

  const noType = priceAsset({ ...blankAsset('a1', 'Platinum'), reg: 'TEST 1' }, contract('Platinum', []));
  ok('a reg with no asset type costs nothing', noType.annual === 0);
  ok('and says so', noType.warnings.length === 1);
}

/* =============================================================
   The totals add up.

   From the business, looking at a contract: "Unsure things are totaling
   properly?"

   It is a fair question and nothing here answered it. Every assertion
   above checks a line against the workbook. None of them checked that
   the lines add up to the asset, that the assets add up to the contract,
   or that the monthly figure is the annual one over twelve. A rate card
   can be perfect and a contract still come out wrong if the sum is.

   So: every plan, every asset type, and a spread of the options that
   move a price, reconciled three ways.
   ============================================================= */
{
  let linesToAsset = true;
  let assetsToContract = true;
  let monthlyFromAnnual = true;

  const OPTIONS: Partial<FleetAsset>[] = [
    {},
    { outOfHours: true },
    { workPattern: 'Nights' },
    { workPattern: 'Combined', outOfHours: true },
    { collectionAndDelivery: true },
    { pmiWeeks: 4 },
    { ladenRbtPerYear: 6, brakeTestsPerYear: 2 },
    { telematicsPerYear: 480 },
    { misc: 350 },
    { wearAndTear: 1250 },
    { tailLift: false },
    { portalAddOn: true },
    { age: 9, mileagePerYear: 120_000 },
  ];

  for (const plan of PLANS) {
    for (const type of ASSET_TYPES.map((a) => a.type)) {
      for (const over of OPTIONS) {
        const one = asset(type, plan, over);
        const priced = priceAsset(one, contract(plan, [one]));

        /* Every line, added up, is the asset's annual figure. Rounded to
           the penny on both sides, because the asset total is rounded
           once and the lines are rounded individually. */
        const summed = priced.lines.reduce((t, l) => t + l.cost, 0);
        if (Math.abs(summed - priced.annual) > 0.02) {
          linesToAsset = false;
          failures.push(`${plan} ${type} ${JSON.stringify(over)}: lines come to ${summed.toFixed(2)}, asset says ${priced.annual.toFixed(2)}`);
        }

        if (Math.abs(priced.monthly * 12 - priced.annual) > 0.02) {
          monthlyFromAnnual = false;
          failures.push(`${plan} ${type}: ${priced.monthly.toFixed(2)} a month is not ${priced.annual.toFixed(2)} a year`);
        }
      }
    }
  }

  /* And a whole fleet: the contract is the sum of its assets, before
     either discount. */
  for (const plan of PLANS) {
    const fleet = ASSET_TYPES.map((a, i) => asset(a.type, plan, { }));
    fleet.forEach((a, i) => { a.key = `k${i}`; a.reg = `REG ${i}`; });
    const whole = priceContract(contract(plan, fleet));
    const summed = whole.assets.reduce((t, a) => t + a.annual, 0);
    if (Math.abs(summed - whole.subtotal) > 0.02) {
      assetsToContract = false;
      failures.push(`${plan}: assets come to ${summed.toFixed(2)}, contract subtotal says ${whole.subtotal.toFixed(2)}`);
    }
    if (Math.abs(whole.monthly * 12 - whole.annual) > 0.02) {
      monthlyFromAnnual = false;
      failures.push(`${plan}: contract monthly does not multiply back to annual`);
    }
  }

  ok('every line on an asset adds up to that asset', linesToAsset);
  ok('every asset adds up to the contract', assetsToContract);
  ok('the monthly figure is always the annual one over twelve', monthlyFromAnnual);
}

/* =============================================================
   The two discounts, and the one that was being misread.

   A promotional discount typed as 5, meaning five per cent, was read as
   five pounds: the workbook's rule is that a value under 1 is a fraction
   and anything else is pounds, which works in a cell that accepts "5%"
   and stores 0.05, and does not work in a number field. On a £6,093
   contract that is 42p a month off instead of £25.39, so it looked like
   the discount was broken rather than misread. The builder's field is a
   percentage now and writes the fraction.
   ============================================================= */
{
  const one = asset('6x2 Truck', 'Platinum');
  const plain = priceContract(contract('Platinum', [one]));

  near('a Platinum 6x2 Truck is £6,092.85 a year', plain.annual, 6092.85);
  near('and £507.74 a month', plain.monthly, 507.74);

  const fivePercent = priceContract(contract('Platinum', [one], { promoDiscount: 0.05 }));
  near('five per cent off takes £304.64', -fivePercent.promoDiscount, 304.64);
  near('leaving £482.35 a month', fivePercent.monthly, 482.35);
  ok('which is a real reduction, not pennies',
    plain.monthly - fivePercent.monthly > 20,
    `only ${(plain.monthly - fivePercent.monthly).toFixed(2)} a month`);

  /* The manager's discount comes off first, and the promotional one off
     what is left. Both together, on the workbook's own order. */
  const both = priceContract(contract('Platinum', [one], {
    managerDiscount: 0.1, promoDiscount: 0.05,
  }));
  near("a manager's ten per cent takes £609.29", -both.managerDiscount, 609.29);
  near('and five per cent of what is left takes £274.18', -both.promoDiscount, 274.18);
  near('leaving £5,209.38', both.annual, 5209.38);

  /* Capped, so a discount can never make a contract cost less than
     nothing. */
  const everything = priceContract(contract('Platinum', [one], { promoDiscount: 1 }));
  near('a hundred per cent leaves nothing to pay', everything.annual, 0);
  ok('and never goes below it', everything.annual >= 0);

  const silly = priceContract(contract('Platinum', [one], { promoDiscount: 100000 }));
  ok('a pound figure bigger than the contract is capped at it', silly.annual === 0);

  /* The legacy reading, kept for a draft saved before the field was a
     percentage. Asserted so that behaviour is deliberate rather than
     left over. */
  const legacyPounds = priceContract(contract('Platinum', [one], { promoDiscount: 500 }));
  near('a value above 1 is still read as pounds, for older drafts',
    -legacyPounds.promoDiscount, 500);
}

console.log(`\n${pass}/${pass + fail} holding`);
if (failures.length) {
  console.log('\nfirst failures:');
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
}
if (fail) process.exit(1);
