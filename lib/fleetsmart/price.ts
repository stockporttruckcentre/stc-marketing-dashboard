/* =============================================================
   The FleetSmart+ pricing engine.

   A straight port of `FleetSmart_Contract_Builder.xlsx`. Every rule
   below is one formula on the Quote Builder or the Pricing Detail tab,
   and the port is deliberately literal: the point of this tab is that a
   contract priced here and the same contract priced in the workbook
   come to the same number, and a tidier engine that disagrees by
   fourteen pence is worse than an untidy one that does not.

   `scripts/fleetsmart-price-check.ts` asserts that agreement against
   figures taken out of the workbook itself after LibreOffice
   recalculated it, so the claim is carried out rather than made.

   ---- How a price is built ----

   One line at a time. Each line has a price, a frequency and a flag
   saying whether the plan covers it:

     cost = included ? price x frequency x (labour ? uplift : 1) : 0

   The price comes from the rate card, indexed by class and axle count.
   The frequency comes from a code on the rate row, resolved against
   this asset's own intervals. Whether it is included comes from the
   inclusion matrix, except for the dozen lines that answer to a switch
   on the asset instead, which are spelled out in `overrideFor`.

   A line the plan does not cover still prices. It comes out at £0 with
   `included: false`, and the screen shows it greyed with its rate
   beside it, because "what would that have cost" is the question a
   salesman asks in the room.
   ============================================================= */
import {
  ASSET_TYPES, SHIPPED_CARD,
  type AssetClass, type AssetType, type FreqCode, type Plan, type RateCard,
} from './ratecard';
import type {
  ContractFlags, ContractInput, FleetAsset, PricedAsset, PricedContract, PricedLine,
} from './types';

/** Money, to the penny, without the floating point tail. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** What an asset type is, and how many axles it has. */
export function describe(type: AssetType | ''): { cls: AssetClass | ''; axles: number } {
  const found = ASSET_TYPES.find((a) => a.type === type);
  return found ? { cls: found.cls, axles: found.axles } : { cls: '', axles: 0 };
}

/** A blank row, ready for a reg and an asset type. */
export function blankAsset(key: string, plan: Plan): FleetAsset {
  return {
    key,
    reg: '',
    type: '',
    age: null,
    mileagePerYear: null,
    pmiWeeks: null,
    cServicesPerYear: null,
    brakeTestsPerYear: null,
    ladenRbtPerYear: null,
    telematicsPerYear: null,
    workPattern: 'Days',
    outOfHours: false,
    /* Platinum carries the tail lift LOLER and weight test, so the box
       starts ticked there and is turned off for an asset that has no
       tail lift. On Silver and Gold it is an optional extra and starts
       off. Same default the workbook sets in its Q column. */
    tailLift: plan === 'Platinum',
    tacho: '2yr',
    collectionAndDelivery: false,
    portalAddOn: false,
    wearAndTear: null,
    misc: null,
    note: '',
  };
}

/* ---- the defaults every blank cell falls back to ---- */

export function defaultPmiWeeks(cls: AssetClass | ''): number {
  return cls === 'Van' ? 26 : 6;
}
export function defaultCServices(cls: AssetClass | ''): number {
  return cls === 'Trailer' ? 0 : 1;
}
export function defaultBrakeTests(cls: AssetClass | ''): number {
  return cls === 'Van' ? 1 : 0;
}
/** Vehicles get four a year and that is mandatory. Trailers get one, at MOT. Vans none. */
export function defaultLadenRbt(cls: AssetClass | ''): number {
  return cls === 'Van' ? 0 : cls === 'Trailer' ? 1 : 4;
}

/**
 * The wear and tear allowance an asset earns before anybody types over it.
 *
 * Base rate for the asset type, uplifted 3% for every year of effective
 * age past four. Effective age is real age unless a mileage is given,
 * in which case 60,000 miles counts as a year: a three year old truck
 * on 90,000 miles a year is treated as four and a half.
 *
 * Platinum only. On Silver and Gold the line is not in the plan and the
 * figure is zero unless somebody sets one.
 */
export function autoWearAndTear(
  type: AssetType | '', age: number | null, miles: number | null,
  card: RateCard = SHIPPED_CARD,
): number {
  if (!type) return 0;
  const base = card.wearAndTearBase[type as AssetType] ?? 0;
  const years = age ?? 0;
  const effective = miles && miles > 0 ? (years * miles) / card.settings.wearMileageBaseline : years;
  const over = Math.max(0, effective - card.settings.wearUpliftStartYear);
  return round2(base * (1 + card.settings.wearUpliftPerYear * over));
}

/** Every frequency this asset resolves, keyed by the rate card's codes. */
function frequencies(asset: FleetAsset, cls: AssetClass | '', plan: Plan) {
  const pmi = asset.pmiWeeks ?? defaultPmiWeeks(cls);
  /* Visits a year. Rounded up, because half a visit is a visit. */
  const visits = pmi > 0 ? Math.ceil(52 / pmi) : 0;
  const cServices = asset.cServicesPerYear ?? defaultCServices(cls);

  return {
    visits,
    /* Silver covers one DVSA inspection, taken at the MOT, rather than
       the full cycle. Gold and Platinum cover every visit. */
    aServices: plan === 'Silver' ? (asset.reg ? 1 : 0) : visits,
    /* B services are not offered on any plan. */
    bServices: 0,
    cServices,
    brakeTests: asset.brakeTestsPerYear ?? defaultBrakeTests(cls),
    ladenRbts: asset.ladenRbtPerYear ?? defaultLadenRbt(cls),
  };
}

function resolveFreq(code: FreqCode, f: ReturnType<typeof frequencies>): number {
  switch (code) {
    case 'T':  return f.visits;
    case 'A':  return f.aServices;
    case 'Bc': return f.bServices;
    case 'Cc': return f.cServices;
    case 'BK': return f.brakeTests;
    case 'LD': return f.ladenRbts;
    case '12': return 12;
    case 'BC': return f.bServices + f.cServices;
    default:   return 1;
  }
}

/** What the work pattern and out-of-hours between them do to a labour line. */
export function labourUplift(asset: FleetAsset, card: RateCard = SHIPPED_CARD): number {
  const pattern = card.workPatterns.find((p) => p.value === asset.workPattern)?.multiplier ?? 1;
  return pattern * (asset.outOfHours ? 1 + card.settings.outOfHoursUplift : 1);
}

/**
 * The lines that answer to a switch on the asset rather than to the plan.
 *
 * Returns true or false to override the inclusion matrix, or null to
 * leave the matrix to decide. Every one of these is a rule the workbook
 * writes into the Incl column of the Pricing Detail tab.
 */
function overrideFor(line: string, asset: FleetAsset, plan: Plan): boolean | null {
  switch (line) {
    case 'Collection & Delivery':
      return asset.collectionAndDelivery;
    /* The LOLER test is part of Platinum. On Silver and Gold the same
       tail lift is covered by the optional extra instead, so exactly
       one of the two can ever be charged. */
    case 'Taillift LOLER & Weight Test':
      return asset.tailLift && plan === 'Platinum';
    case 'Taillift Cover (optional extra)':
      return asset.tailLift && plan !== 'Platinum';
    case '2 Year Tacho Calibration': return asset.tacho === '2yr';
    case '6 Year Tacho Calibration': return asset.tacho === '6yr';
    case 'DTCO':                     return asset.tacho === 'DTCO';
    case 'Smart DTCO':               return asset.tacho === 'Smart';
    default:
      return null;
  }
}

/** Price one asset, line by line. */
export function priceAsset(
  asset: FleetAsset, input: ContractInput, card: RateCard = SHIPPED_CARD,
): PricedAsset {
  const { plan } = input;
  const { cls, axles } = describe(asset.type);
  const f = frequencies(asset, cls, plan);
  const uplift = labourUplift(asset, card);
  const covered = cls ? card.included[plan][cls] : [];

  const lines: PricedLine[] = [];
  const add = (line: string, price: number, frequency: number, included: boolean, labour: boolean) => {
    /* A line with no frequency is never charged, whatever the plan
       says. The workbook guards every Incl formula the same way, and it
       is what stops a trailer being billed for zero laden RBTs. */
    const on = included && frequency > 0;
    lines.push({
      line, price, frequency, included: on, labour,
      cost: on ? price * frequency * (labour ? uplift : 1) : 0,
    });
  };

  if (!asset.reg.trim() || !cls) {
    return {
      key: asset.key, reg: asset.reg, type: asset.type, cls, axles,
      lines: [], annual: 0, monthly: 0, weekly: 0,
      wearAndTear: 0, wearAndTearIsManual: false, visitsPerYear: f.visits,
      warnings: asset.reg.trim() && !cls ? ['Pick an asset type. Nothing prices until it has one.'] : [],
    };
  }

  /* ---- the rate card lines ---- */
  for (const rate of card.rates) {
    if (rate.cls !== cls) continue;
    /* Kept only so an old key still resolves. */
    if (rate.line === 'Inspection/B Service') continue;

    const override = overrideFor(rate.line, asset, plan);
    const included = override ?? covered.includes(rate.line);

    const price = rate.line === 'Collection & Delivery'
      /* Priced from the labour rate rather than the rate card, which is
         why its four price columns are all £0 and correctly so: one
         hour per visit at the rate for that class. */
      ? (cls === 'Vehicle' ? input.labourHgv : cls === 'Trailer' ? input.labourTrailer : input.labourVan)
      : (rate.axle[Math.max(0, Math.min(3, axles - 1))] ?? 0);

    add(rate.line, price, resolveFreq(rate.freq, f), included, rate.labour);
  }

  /* ---- the lines the rate card holds in its own blocks ---- */

  add('Service Kit (C)', card.serviceKit[asset.type as AssetType] ?? 0, f.cServices,
    covered.includes('Service Kit (C)'), false);

  add('Engine Oil', round2((card.oilLitres[asset.type as AssetType] ?? 0) * card.settings.oilPerLitre), f.cServices,
    covered.includes('Engine Oil'), false);

  /* Wear and tear. Platinum earns it automatically; on any plan a
     figure typed over the top both sets it and turns it on, which is
     how a one-off allowance gets agreed on a Gold contract. */
  const manual = asset.wearAndTear != null && asset.wearAndTear > 0;
  const wear = manual
    ? asset.wearAndTear!
    : plan === 'Platinum' ? autoWearAndTear(asset.type, asset.age, asset.mileagePerYear, card) : 0;
  add('Wear & Tear Allowance', wear, 1, plan === 'Platinum' || manual, false);

  /* The portal is part of Gold and Platinum, priced per inspection. On
     Silver it is a £100 a year add-on, which is why its price and its
     frequency both change rather than only its flag. */
  if (plan === 'Silver') {
    add('Compliance Portal Access', card.silverPortalPerYear, 1, asset.portalAddOn, false);
  } else {
    add('Compliance Portal Access', card.portalPerVisit[cls], f.visits,
      covered.includes('Compliance Portal Access'), false);
  }

  add('Bulb Replacement', card.bulbsPerYear[cls], 1, covered.includes('Bulb Replacement'), false);

  add('Miscellaneous (agreed extra)', asset.misc ?? 0, 1, (asset.misc ?? 0) > 0, false);

  add('Telematics brake performance monitoring', asset.telematicsPerYear ?? 0, 1,
    (asset.telematicsPerYear ?? 0) > 0, false);

  const annual = round2(lines.reduce((n, l) => n + l.cost, 0));

  return {
    key: asset.key, reg: asset.reg, type: asset.type, cls, axles,
    lines,
    annual,
    monthly: annual / 12,
    weekly: annual / 52,
    wearAndTear: wear,
    wearAndTearIsManual: manual,
    visitsPerYear: f.visits,
    warnings: warningsFor(asset, plan, cls, f, wear, manual, card),
  };
}

/**
 * What is worth saying out loud about one asset.
 *
 * The workbook builds the same list as one enormous concatenated
 * string in its Note column. Kept as separate sentences because the
 * screen can then show them as separate lines, and because a warning
 * nobody can read is a warning nobody acts on.
 *
 * Every one of these is a question a salesman should answer before the
 * contract goes out, not an error. Nothing here blocks anything.
 */
function warningsFor(
  asset: FleetAsset,
  plan: Plan,
  cls: AssetClass,
  f: ReturnType<typeof frequencies>,
  wear: number,
  manual: boolean,
  card: RateCard,
): string[] {
  const out: string[] = [];
  const telematics = asset.telematicsPerYear ?? 0;

  if (plan === 'Silver') {
    out.push(`Silver covers one DVSA inspection at MOT, not the full ${f.visits} visit cycle. No A or C service.`);
  }
  if (plan === 'Silver' && asset.portalAddOn) {
    out.push('Portal add-on at £100 a year added.');
  }
  if (telematics > 0) {
    out.push(`Telematics charged at £${telematics.toFixed(2)} a year.`);
  }

  if (cls === 'Trailer') {
    if (f.ladenRbts === 0) {
      out.push(telematics > 0
        ? 'No laden RBTs, telematics priced instead.'
        : 'No laden RBTs and no telematics. Confirm the customer has their RBTs done elsewhere.');
    } else if (f.ladenRbts === 1) {
      if (telematics === 0) {
        out.push('Only the one laden RBT at MOT and no telematics priced. Add RBTs, price telematics, or confirm the customer has theirs done elsewhere.');
      }
    } else {
      out.push(`One laden RBT at MOT plus ${f.ladenRbts - 1} added in.`);
    }
  }

  if (cls === 'Vehicle' && f.ladenRbts !== 4) {
    out.push('Laden RBTs changed from the standard four a year for a vehicle.');
  }
  if (cls === 'Vehicle' && f.ladenRbts === 0 && telematics === 0) {
    out.push('No laden RBTs and no telematics on a vehicle. Confirm who is carrying them out.');
  }
  if (telematics > 0 && f.ladenRbts > defaultLadenRbt(cls)) {
    out.push(`Telematics is priced and ${f.ladenRbts} laden RBTs a year are charged, above the standard for this asset. Check the customer wants both.`);
  }
  if (telematics > 0 && f.brakeTests > defaultBrakeTests(cls)) {
    out.push(`Telematics is priced and ${f.brakeTests} brake test(s) a year are still charged. Check that is right.`);
  }
  if (telematics === 0 && f.brakeTests > defaultBrakeTests(cls)) {
    out.push(`Extra brake tests added (${f.brakeTests} a year). Telematics monitoring may be the cheaper option.`);
  }

  if ((asset.misc ?? 0) > 0) {
    out.push(`Miscellaneous expense of £${(asset.misc ?? 0).toFixed(2)} a year on top of the plan.`);
  }
  if (manual && plan === 'Platinum'
      && round2(wear) !== autoWearAndTear(asset.type, asset.age, asset.mileagePerYear, card)) {
    out.push('Manual wear and tear figure in use, overriding the automatic one.');
  }
  if (manual && plan !== 'Platinum') {
    out.push('Wear and tear is not part of this plan. A manual figure has been added.');
  }
  if (plan === 'Platinum' && !asset.tailLift) {
    out.push('Tail lift excluded, which takes £185 off. Does this asset have no tail lift?');
  }
  if (asset.tailLift && plan !== 'Platinum') {
    out.push('Tail lift cover added as an optional extra.');
  }
  if (asset.collectionAndDelivery) {
    out.push('Collection and delivery added, at one hour of labour per visit.');
  }
  if (plan === 'Platinum' && !asset.age) {
    out.push('Age is blank, so wear and tear is at the base rate with no ageing uplift.');
  }
  if (asset.outOfHours) out.push('Out-of-hours uplift applied.');
  if (asset.workPattern !== 'Days') out.push(`${asset.workPattern} work pattern uplift applied.`);
  if (cls === 'Trailer' && plan !== 'Silver') {
    out.push('Trailer: no C service, service kit, oil or bulbs. None of them apply.');
  }
  if (asset.tacho === 'none' && cls === 'Vehicle') {
    out.push('No tachograph work priced on a vehicle. Confirm who is calibrating it.');
  }

  return out;
}

/** Price the whole contract. */
export function priceContract(
  input: ContractInput, card: RateCard = SHIPPED_CARD,
): PricedContract {
  const assets = input.assets.map((a) => priceAsset(a, input, card));
  const subtotal = round2(assets.reduce((n, a) => n + a.annual, 0));

  /* The manager's discount comes off first, then the promotional one,
     which is capped so a £5,000 promo on a £4,000 contract cannot make
     it negative. Both are held as negative numbers, as the workbook
     holds them, so the total is a plain sum. */
  const managerDiscount = input.managerDiscount ? round2(-subtotal * input.managerDiscount) : 0;
  const afterManager = subtotal + managerDiscount;
  const promoRaw = input.promoDiscount <= 0
    ? 0
    /* A fraction, which is what the builder writes now: its field is a
       percentage and stores 0.05 for five per cent.

       The `<= 1` rather than `< 1` matters at exactly one value. The
       workbook's rule is that anything under 1 is a fraction and
       anything else is pounds, so 1 would be a pound. Nobody discounts
       a maintenance contract by £1, and 100 per cent is at least a
       thing somebody might type, so 1 reads as all of it.

       The pounds branch stays for a draft saved before the field was a
       percentage, which is the only way a value above 1 can now exist. */
    : input.promoDiscount <= 1
      ? afterManager * input.promoDiscount
      : input.promoDiscount;
  const promoDiscount = promoRaw ? round2(-Math.min(promoRaw, afterManager)) : 0;

  const annual = round2(subtotal + managerDiscount + promoDiscount);

  return {
    assets,
    subtotal,
    managerDiscount,
    promoDiscount,
    annual,
    monthly: annual / 12,
    weekly: annual / 52,
    flags: flagsFor(assets, input),
  };
}

/** Did any asset actually pay for this line. */
function charged(assets: PricedAsset[], match: (line: string) => boolean): boolean {
  return assets.some((a) => a.lines.some((l) => l.included && l.cost > 0 && match(l.line)));
}

/**
 * What the document is allowed to claim.
 *
 * Read off what was CHARGED rather than off the plan, which is the
 * whole reason the workbook computes them: a Platinum contract whose
 * every asset is a trailer must not promise bulbs, and a fleet with no
 * tail lifts must not list tail lift servicing.
 */
function flagsFor(assets: PricedAsset[], input: ContractInput): ContractFlags {
  const real = assets.filter((a) => a.reg.trim() && a.cls);
  const hasVehicles = real.some((a) => a.cls === 'Vehicle');
  const hasTrailers = real.some((a) => a.cls === 'Trailer');
  const hasVans = real.some((a) => a.cls === 'Van');

  const words =
    hasVehicles && hasTrailers && hasVans ? 'vehicles, trailers and vans'
    : hasVehicles && hasTrailers ? 'vehicles and trailers'
    : hasVehicles && hasVans ? 'vehicles and vans'
    : hasTrailers && hasVans ? 'trailers and vans'
    : hasVehicles ? 'vehicles'
    : hasTrailers ? 'trailers'
    : hasVans ? 'vans'
    : 'vehicles and trailers';

  return {
    hasVehicles, hasTrailers, hasVans,
    tacho: charged(real, (l) => /Tacho|DTCO/.test(l)),
    brakeTests: charged(real, (l) => l === 'Brake Test'),
    ladenRbts: charged(real, (l) => l.startsWith('Laden')),
    tailLift: charged(real, (l) => l.startsWith('Taillift')),
    wearAndTear: charged(real, (l) => l === 'Wear & Tear Allowance'),
    portal: charged(real, (l) => l === 'Compliance Portal Access'),
    telematics: charged(real, (l) => l.startsWith('Telematics')),
    serviceParts: charged(real, (l) => l === 'Service Kit (C)' || l === 'Engine Oil' || l === 'Bulb Replacement'),
    cService: charged(real, (l) => l === 'Inspection/C Service'),
    documentStorage: charged(real, (l) => l.startsWith('Truckfile')),
    collectionAndDelivery: charged(real, (l) => l === 'Collection & Delivery'),
    misc: charged(real, (l) => l.startsWith('Miscellaneous')),
    assetWords: words,
  };
}

/**
 * The inspection interval to print for one class.
 *
 * One number where every asset of that class agrees, and a pointer to
 * the schedule where they do not, because a contract that says "every 6
 * weeks" over a fleet running two intervals is a contract that is
 * wrong about one of them.
 */
export function intervalFor(input: ContractInput, cls: AssetClass): number | 'mixed' | null {
  const mine = input.assets.filter((a) => a.reg.trim() && describe(a.type).cls === cls);
  if (!mine.length) return null;
  const first = mine[0].pmiWeeks ?? defaultPmiWeeks(cls);
  return mine.every((a) => (a.pmiWeeks ?? defaultPmiWeeks(cls)) === first) ? first : 'mixed';
}
