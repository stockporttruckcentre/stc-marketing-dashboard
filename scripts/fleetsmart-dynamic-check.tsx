/* =============================================================
   Everything on the contract answers to something, and to the right
   thing.

   ---- The bug this exists because of ----

   From the business:

     the final contract is only pulling HGV rate it seems. HGV rate is
     £85 by default. If I create a contract only with trailers on the
     fleet list, the contract shows the HGV £85 rate, not the trailer
     £65 one ... this was flagged by a customer, not at staff-level.

   The Charges block read `input.labourHgv` and nothing else. The
   arithmetic was never wrong: `priceAsset` has always picked the rate
   by class, so a trailer was priced at £65 an hour all the way through.
   It was the SENTENCE under the total that named the wrong figure, and
   a sentence cannot be caught by checking a sum.

   That is what makes this class of fault dangerous. A hardcoded value
   that happens to be right for the commonest case looks like a working
   feature for as long as nobody builds the uncommon one, and the first
   person to find it was the customer holding the document.

   ---- What this asserts, generally ----

   Not "the labour rate is right", which would be one more thing that
   passes until the next hardcoded value. The rule:

     CHANGE AN INPUT, AND THE DOCUMENT CHANGES.

   Every field the builder offers is moved, one at a time, and the
   rendered contract has to come out different. A field that can be
   edited and changes nothing is either dead or hardcoded somewhere
   downstream, and both are worth knowing about.

   The inverse holds too: the per asset note is documented as never
   printed, so moving it must change nothing.

   And the specific shape of the customer's fault, stated as a rule:

     THE CONTRACT NEVER QUOTES A RATE FOR A CLASS THAT IS NOT ON IT.

   Run with `npm run check:fleetsmart-dynamic`.
   ============================================================= */

import { renderToStaticMarkup } from 'react-dom/server';
import { ContractDocument } from '../components/fleetsmart/document';
import { blankContract, blankExtras, wordingFor, type ContractExtras } from '../lib/fleetsmart/contract';
import { blankAsset, priceContract } from '../lib/fleetsmart/price';
import type { AssetType, ContractInput, FleetAsset } from '../lib/fleetsmart/types';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

/* ---- the fleet under test ----

   One of each class, on Platinum, because a flag that is off can hide a
   field that does nothing. A trailer only fixture would pass a check
   that the tail lift switch does nothing, since trailers on this plan
   carry no tail lift line. */
const KINDS: AssetType[] = ['6x2 Truck', '3 Axle Trailer', 'LCV'];

function fleetOf(types: AssetType[]): FleetAsset[] {
  return types.map((type, i) => ({
    ...blankAsset(`a${i}`, 'Platinum'),
    reg: `REG${i}`, type, age: 4, mileagePerYear: 80_000,
  }));
}

const BASE: ContractInput = {
  ...blankContract(),
  startDate: '2026-04-01',
  customerName: 'Dawson Group Haulage Limited',
  customerAddress: 'Brinksway, Stockport',
  customerContact: 'Julie Barnes',
  assets: fleetOf(KINDS),
};

const EXTRAS: ContractExtras = {
  ...blankExtras(),
  companyNumber: '04728311',
  registeredAddress: 'Brinksway, Stockport, SK3 0BY',
  accountManagerName: 'Dave Sherratt',
  accountManagerPhone: '0161 480 3535',
  accountManagerEmail: 'dave@stockporttruckcentre.co.uk',
};

const render = (input: ContractInput, extras: ContractExtras) => renderToStaticMarkup(
  <ContractDocument
    input={input} priced={priceContract(input)} extras={extras} reference="FS-2026-0148"
  />,
);

const BEFORE = render(BASE, EXTRAS);

/* =============================================================
   1. The rate the customer found
   ============================================================= */
console.log('\n  The rate a customer reads\n  -------------------------');

/** The labour sentence on its own, so a coincidental £85.00 elsewhere
    on the document cannot make this pass or fail by accident. */
function labourLine(input: ContractInput): string {
  const said = wordingFor('charges', input, priceContract(input), EXTRAS);
  return said.split(/(?<=\.)\s+/).find((s) => s.includes('labour rate') || s.includes('labour rates')) ?? '';
}

const ONLY: [string, AssetType, 'labourHgv' | 'labourTrailer' | 'labourVan', number][] = [
  ['trailers only', '3 Axle Trailer', 'labourTrailer', 65],
  ['vehicles only', '6x2 Truck', 'labourHgv', 85],
  ['vans only', 'LCV', 'labourVan', 85],
];

for (const [name, type, field, expected] of ONLY) {
  /* Every rate made distinct, so "it printed 85" cannot be right for
     two different reasons. The defaults have HGV and van both at 85,
     which is exactly how the fault hid. */
  const input: ContractInput = {
    ...BASE,
    labourHgv: 111, labourTrailer: 222, labourVan: 333,
    [field]: expected,
    assets: fleetOf([type, type]),
  } as ContractInput;

  const line = labourLine(input);
  ok(`${name} quotes its own rate`, line.includes(`£${expected.toFixed(2)}`), line);

  const others = (['labourHgv', 'labourTrailer', 'labourVan'] as const)
    .filter((f) => f !== field)
    .map((f) => input[f]);
  ok(`${name} quotes no other class's rate`,
    others.every((r) => !line.includes(`£${r.toFixed(2)}`)),
    `${line}\n        must not name ${others.map((r) => `£${r.toFixed(2)}`).join(' or ')}`);
}

/* The reported case, with the real defaults, end to end through the
   rendered document rather than the wording function. */
{
  const trailersOnly = { ...BASE, assets: fleetOf(['3 Axle Trailer', '3 Axle Trailer']) };
  const line = labourLine(trailersOnly);
  ok('a trailers only contract on the shipped rates says £65.00, not £85.00',
    line.includes('£65.00') && !line.includes('£85.00'), line);
}

/* And a mixed fleet names both, because collapsing to one would be the
   same fault with a different default. */
{
  const line = labourLine({ ...BASE, labourHgv: 90, labourTrailer: 70 });
  ok('a mixed fleet names every rate on it',
    line.includes('£90.00') && line.includes('£70.00'), line);
}

/* ---- and the customer can tell which rate is theirs ----

   From the business, on the fix above:

     will the customer know which rate applies to which

   Naming the class is not enough on its own. A trailer is a vehicle in
   ordinary English, so "£85.00 for vehicles and £65.00 for trailers"
   only parses if the reader already knows those words are STC's asset
   classes. The Schedule prints a Class column against every
   registration, and the sentence has to send them to it. */
{
  const mixed = { ...BASE, assets: fleetOf(['6x2 Truck', '3 Axle Trailer']) };
  const line = labourLine(mixed);

  ok('a mixed fleet says which rate belongs to which class',
    line.includes('for vehicles') && line.includes('for trailers'), line);

  ok('and points at the column where those classes are printed',
    /class shown against each asset in the Schedule/.test(line), line);

  /* The pointer is only true if the column is actually there. */
  const html = render(mixed, EXTRAS);
  ok('and that column exists on the document',
    html.includes('>Class<') && html.includes('>Vehicle<') && html.includes('>Trailer<'),
    'the sentence sends the customer to a Class column, so the Class column has to be printed '
    + 'and has to use the same words');

  /* One rate needs no mapping, and a sentence that sends somebody to a
     column for no reason is a sentence they read twice. */
  const oneRate = labourLine({ ...mixed, labourHgv: 80, labourTrailer: 80 });
  ok('a single rate does not send anybody looking for a column',
    !/Schedule above/.test(oneRate), oneRate);
}

/* ---- as many figures as there are rates, and no more ----

   From the business:

     Ensure you are only showing the customer what they need. Only show
     them 2 different rates if their contract has 2 different rates.

   The three rates default to 85, 65 and 85, so "one figure per class"
   prints eighty five twice and invites the reader to hunt for the
   difference between a vehicle and a van when there is none. The rule
   is about the count on the paper, not about which classes are on the
   fleet, so it is swept over every fleet shape against every way the
   three rates can collide.
   ============================================================= */
console.log('\n  As many figures as there are rates\n  ----------------------------------');
{
  const CLASSES: [string, AssetType, 'labourHgv' | 'labourTrailer' | 'labourVan'][] = [
    ['vehicles', '6x2 Truck', 'labourHgv'],
    ['trailers', '3 Axle Trailer', 'labourTrailer'],
    ['vans', 'LCV', 'labourVan'],
  ];

  /* Every way three numbers can be equal or different, so a collision
     between any two classes is covered and not just the shipped one. */
  const RATES: [string, number, number, number][] = [
    ['the shipped rates', 85, 65, 85],
    ['all three different', 92, 68, 55],
    ['all three the same', 78, 78, 78],
    ['vehicle and trailer alike', 70, 70, 55],
    ['trailer and van alike', 90, 60, 60],
  ];

  let swept = 0;
  let wrong = 0;
  const examples: string[] = [];

  for (let bits = 1; bits < 8; bits += 1) {
    const on = CLASSES.filter((_, i) => bits & (1 << i));
    for (const [name, hgv, trailer, van] of RATES) {
      const input: ContractInput = {
        ...BASE,
        labourHgv: hgv, labourTrailer: trailer, labourVan: van,
        assets: fleetOf(on.map(([, type]) => type)),
      };
      const line = labourLine(input);

      const agreed = new Set(on.map(([, , field]) => input[field]));
      const printed = new Set(line.match(/£[\d,]+\.\d\d/g) ?? []);
      swept += 1;

      if (printed.size !== agreed.size
        || [...agreed].some((r) => !printed.has(`£${r.toFixed(2)}`))) {
        wrong += 1;
        if (examples.length < 3) {
          examples.push(`${on.map(([w]) => w).join(' + ')}, ${name}: `
            + `${agreed.size} agreed, ${printed.size} printed\n        ${line}`);
        }
      }
    }
  }

  ok(`every fleet reads exactly the rates it agreed (${swept} combinations)`,
    wrong === 0, examples.join('\n        '));

  /* The reason the rule is not "one figure per class". */
  const allThree = labourLine({ ...BASE, assets: fleetOf(['6x2 Truck', '3 Axle Trailer', 'LCV']) });
  ok('a fleet of all three classes on the shipped rates reads two figures, not three',
    (allThree.match(/£/g) ?? []).length === 2, allThree);
  ok('and names the two classes that share a rate together',
    allThree.includes('for vehicles and vans'), allThree);

  /* Before a fleet exists there is nothing to point at, and the same
     grouping still applies. */
  const empty = labourLine({ ...BASE, assets: [] });
  ok('an empty fleet still quotes each rate once',
    (empty.match(/£/g) ?? []).length === 2, empty);
  ok('and does not point at a Schedule with nothing on it',
    !/Schedule above/.test(empty), empty);

  /* "for vehicles and vans and £65.00 per hour for trailers" is one
     sentence with two meanings of "and" in it. */
  ok('a grouped class list is not run into the next rate with a bare and',
    !/\w and £/.test(allThree), allThree);
}

/* =============================================================
   2. Change an input, and the document changes
   ============================================================= */
console.log('\n  What answers to what\n  --------------------');

type Move = {
  what: string;
  input?: Partial<ContractInput>;
  extras?: Partial<ContractExtras>;
  asset?: Partial<FleetAsset>;
  /** False where the field is documented as never reaching the paper. */
  shows?: boolean;
};

const MOVES: Move[] = [
  { what: 'plan', input: { plan: 'Silver' } },
  { what: 'term in months', input: { termMonths: 60 } },
  { what: 'commencement date', input: { startDate: '2027-01-15' } },
  { what: 'customer name', input: { customerName: 'Wincanton North Limited' } },
  { what: 'contact', input: { customerContact: 'Tom Moore' } },
  { what: 'the HGV labour rate', input: { labourHgv: 97 } },
  { what: 'the trailer labour rate', input: { labourTrailer: 71 } },
  { what: 'the van labour rate', input: { labourVan: 63 } },
  { what: "the manager's discount", input: { managerDiscount: 0.1 } },
  { what: 'a promotional discount shown on the contract',
    input: { promoDiscount: 0.05, promoOnContract: true } },

  { what: 'company number', extras: { companyNumber: '99999999' } },
  { what: 'registered address', extras: { registeredAddress: 'Somewhere else entirely' } },
  { what: 'maximum mileage', extras: { maximumMileage: 120_000 } },
  { what: 'the account manager', extras: { accountManagerName: 'Alex Ellis' } },
  { what: 'a wording override', extras: { overrides: { charges: 'Whatever was typed here.' } } },

  { what: 'a registration', asset: { reg: 'CHANGED1' } },
  { what: 'an asset type', asset: { type: '2 Axle Rigid' } },
  { what: 'asset age', asset: { age: 12 } },
  { what: 'miles a year', asset: { mileagePerYear: 200_000 } },
  { what: 'the inspection interval', asset: { pmiWeeks: 13 } },
  { what: 'C services a year', asset: { cServicesPerYear: 4 } },
  { what: 'brake tests a year', asset: { brakeTestsPerYear: 6 } },
  /* Seven, not four. A vehicle's default is already four a year, so
     setting four was setting the value it already had, and the check
     reported the FIXTURE as a dead field on its first run. */
  { what: 'laden RBTs a year', asset: { ladenRbtPerYear: 7 } },
  { what: 'telematics', asset: { telematicsPerYear: 12 } },
  { what: 'the work pattern', asset: { workPattern: 'Nights' } },
  { what: 'out of hours', asset: { outOfHours: true } },
  { what: 'the tail lift switch', asset: { tailLift: false } },
  { what: 'the tacho type', asset: { tacho: 'Smart' } },
  { what: 'collection and delivery', asset: { collectionAndDelivery: true } },
  /* Only meaningful on Silver: on Gold and Platinum the portal is part
     of the plan and priced per inspection, so an add-on switch there is
     correctly inert. The first run of this check flagged that as a dead
     field too, and it was the fixture asking the wrong question. */
  { what: 'the portal add on, on Silver',
    input: { plan: 'Silver' }, asset: { portalAddOn: true } },
  { what: 'wear and tear', asset: { wearAndTear: 900 } },
  { what: 'a miscellaneous amount', asset: { misc: 250 } },

  /* Documented on the fleet step as "Never printed on the contract". */
  { what: 'the internal note', asset: { note: 'Priced low to win it back off Wincanton.' },
    shows: false },
];

for (const move of MOVES) {
  const input: ContractInput = {
    ...BASE,
    ...move.input,
    assets: move.asset
      ? BASE.assets.map((a, i) => (i === 0 ? { ...a, ...move.asset } : a))
      : BASE.assets,
  };
  const extras = { ...EXTRAS, ...move.extras };
  const after = render(input, extras);
  const changed = after !== BEFORE;
  const shows = move.shows ?? true;

  ok(shows ? `moving ${move.what} changes the contract`
    : `moving ${move.what} does not reach the contract, as documented`,
  changed === shows,
  shows
    ? 'the field can be edited and the document came out identical, so it is either '
      + 'dead or something downstream is hardcoded'
    : 'this is meant to be internal and it is on the paper');
}

/* =============================================================
   3. What the plan and the fleet let the document claim

   The flags exist so a document cannot promise something nobody is
   being charged for. Worth asserting directly: it is the same class of
   fault as the labour rate, one level up.
   ============================================================= */
console.log('\n  What the document may claim\n  ---------------------------');

{
  const trailers = { ...BASE, assets: fleetOf(['3 Axle Trailer', '3 Axle Trailer']) };
  const html = render(trailers, EXTRAS);
  ok('a trailer only fleet is not promised tachograph calibrations',
    !html.includes('Tachograph calibrations'),
    'trailers have no tachograph, so charging nothing for one and promising it is a claim '
    + 'the contract cannot meet');

  const silver = { ...BASE, plan: 'Silver' as const };
  const silverHtml = render(silver, EXTRAS);
  ok('a Silver plan does not promise in depth mechanical servicing',
    !silverHtml.includes('In-depth mechanical component servicing'));
  ok('and does promise the annual inspection it does carry',
    silverHtml.includes('Annual DVSA safety inspection'));

  const noTailLifts = {
    ...BASE,
    assets: BASE.assets.map((a) => ({ ...a, tailLift: false })),
  };
  ok('a fleet with no tail lifts is not promised tail lift servicing',
    !render(noTailLifts, EXTRAS).includes('Tail lift LOLER'));

  ok('the schedule heading names the classes actually on the fleet',
    render(trailers, EXTRAS).includes('trailers included')
    && !render(trailers, EXTRAS).includes('vehicles, trailers and vans included'));
}

console.log(
  failed === 0
    ? '\n  Every field the builder offers reaches the paper, the internal note does\n'
      + '  not, and no rate is quoted for a class that is not on the contract.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
