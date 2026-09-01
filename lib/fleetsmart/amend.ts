import type { ContractInput, FleetAsset, PricedContract } from './types';
import { priceAsset } from './price';
import { SHIPPED_CARD, type RateCard } from './ratecard';

/* =============================================================
   What changed on a contract, in sentences.

   From the business: the logic has to be "bulletproof and well-presented
   for understanding". This is the second half. The first is migration
   072, which makes sure a change is recorded whole and in order; this
   makes sure a person can read it.

   ---- Why the summary is computed and stored, not computed on demand ----

   Computed, because a note somebody types says what they meant to
   change and this says what they changed. Those differ often enough to
   matter on a bill.

   Stored, because it has to still read correctly in two years, after
   the rate card has moved twice and the wording has been rewritten.
   A summary regenerated later from two old inputs would silently start
   describing them in today's terms.

   ---- The shape of a line ----

   Each change is one sentence and one figure, because the two questions
   anybody asks about an amendment are "what changed" and "what did that
   do to the bill". Splitting them means the screen can put the money in
   a column and keep it readable at a glance.

   `delta` is the change to the annual figure attributable to that one
   line, where it can be attributed. Adding an asset can be: it is that
   asset's annual price. Moving from Silver to Gold cannot be attributed
   to any single asset, so it carries no figure and the total at the
   bottom carries it instead. A number that looks attributable and is not
   is worse than no number.
   ============================================================= */

export type Change = {
  /** What happened, in one sentence. */
  what: string;
  /** The change to the annual figure this line accounts for, or null. */
  delta: number | null;
  /** Grouping for the screen, so assets sort together and the plan sits above them. */
  kind: 'plan' | 'term' | 'asset-added' | 'asset-removed' | 'asset-changed' | 'money' | 'other';
};

export type AmendmentSummary = {
  changes: Change[];
  /** Before and after, on the annual figure. */
  was: number;
  now: number;
  /** Positive is more expensive. */
  difference: number;
};

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

/** An asset is the same asset if it has the same registration. */
function key(a: FleetAsset): string {
  return a.reg.trim().toLowerCase();
}

function real(assets: FleetAsset[]): FleetAsset[] {
  return assets.filter((a) => a.reg.trim() !== '' && a.type !== '');
}

/** What one asset costs a year on its own, for attributing a line. */
function annualOf(asset: FleetAsset, input: ContractInput, card: RateCard): number {
  return priceAsset(asset, input, card).annual;
}

/* The fields on an asset worth naming when they move, and how to say
   each one. Anything not here changes the price and shows in the total
   without a line of its own, which is the right trade: a list that names
   every field somebody nudged is a list nobody reads. */
const NAMED: {
  field: keyof FleetAsset;
  say: (from: unknown, to: unknown) => string | null;
}[] = [
  {
    field: 'wearAndTear',
    say: (from, to) => {
      if (from == null && to != null) return `wear and tear of ${money(Number(to))} a year added`;
      if (from != null && to == null) return 'wear and tear taken off';
      return `wear and tear changed from ${money(Number(from))} to ${money(Number(to))}`;
    },
  },
  {
    field: 'misc',
    say: (from, to) => {
      if (from == null && to != null) return `an agreed extra of ${money(Number(to))} a year added`;
      if (from != null && to == null) return 'the agreed extra taken off';
      return `the agreed extra changed from ${money(Number(from))} to ${money(Number(to))}`;
    },
  },
  { field: 'tailLift', say: (_f, to) => (to ? 'tail lift cover added' : 'tail lift cover taken off') },
  { field: 'collectionAndDelivery', say: (_f, to) => (to ? 'collection and delivery added' : 'collection and delivery taken off') },
  { field: 'outOfHours', say: (_f, to) => (to ? 'moved to out of hours' : 'no longer out of hours') },
  { field: 'portalAddOn', say: (_f, to) => (to ? 'portal access added' : 'portal access taken off') },
  { field: 'workPattern', say: (from, to) => `work pattern changed from ${from} to ${to}` },
  { field: 'tacho', say: (from, to) => `tacho changed from ${from} to ${to}` },
  {
    field: 'telematicsPerYear',
    say: (from, to) => {
      if (!from && to) return `telematics at ${money(Number(to))} a year added`;
      if (from && !to) return 'telematics taken off';
      return `telematics changed from ${money(Number(from))} to ${money(Number(to))} a year`;
    },
  },
  { field: 'pmiWeeks', say: (from, to) => `inspections moved from every ${from ?? 'default'} weeks to every ${to ?? 'default'}` },
  { field: 'ladenRbtPerYear', say: (from, to) => `laden RBTs changed from ${from ?? 'the default'} to ${to ?? 'the default'} a year` },
  { field: 'brakeTestsPerYear', say: (from, to) => `unladen RBTs changed from ${from ?? 'the default'} to ${to ?? 'the default'} a year` },
  { field: 'cServicesPerYear', say: (from, to) => `C services changed from ${from ?? 'the default'} to ${to ?? 'the default'} a year` },
];

/**
 * What changed between two versions of a contract.
 *
 * `before` and `after` are whole contract inputs, and `pricedBefore` and
 * `pricedAfter` are what the engine made of each. Both are needed: the
 * inputs say what somebody changed, the priced results say what it cost.
 */
export function describeAmendment(
  before: ContractInput,
  after: ContractInput,
  pricedBefore: PricedContract,
  pricedAfter: PricedContract,
  card: RateCard = SHIPPED_CARD,
): AmendmentSummary {
  const changes: Change[] = [];

  /* ---- the plan and the term, first, because they touch everything ---- */
  if (before.plan !== after.plan) {
    const up = ['Silver', 'Gold', 'Platinum'].indexOf(after.plan)
      > ['Silver', 'Gold', 'Platinum'].indexOf(before.plan);
    changes.push({
      kind: 'plan',
      what: `${up ? 'Upgraded' : 'Moved'} from FleetSmart+ ${before.plan} to ${after.plan}`,
      /* Not attributable to one asset, and the plan changes what every
         line on every asset costs. The total at the bottom carries it. */
      delta: null,
    });
  }

  if (before.termMonths !== after.termMonths) {
    changes.push({
      kind: 'term',
      what: `Term changed from ${before.termMonths} months to ${after.termMonths}`,
      delta: null,
    });
  }

  if (before.startDate !== after.startDate && after.startDate) {
    changes.push({
      kind: 'other',
      what: `Start date moved from ${before.startDate || 'not set'} to ${after.startDate}`,
      delta: null,
    });
  }

  /* ---- the fleet ---- */
  const was = new Map(real(before.assets).map((a) => [key(a), a]));
  const now = new Map(real(after.assets).map((a) => [key(a), a]));

  for (const [k, asset] of now) {
    if (was.has(k)) continue;
    changes.push({
      kind: 'asset-added',
      what: `${asset.type} ${asset.reg.trim()} added`,
      delta: annualOf(asset, after, card),
    });
  }

  for (const [k, asset] of was) {
    if (now.has(k)) continue;
    changes.push({
      kind: 'asset-removed',
      what: `${asset.type} ${asset.reg.trim()} taken off`,
      delta: -annualOf(asset, before, card),
    });
  }

  /* An asset on both sides, changed. Priced against its own version of
     the contract each time, so a plan change shows in the total rather
     than being counted again on every asset. */
  for (const [k, then] of was) {
    const later = now.get(k);
    if (!later) continue;

    const said: string[] = [];
    for (const { field, say } of NAMED) {
      const from = then[field];
      const to = later[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      const sentence = say(from, to);
      if (sentence) said.push(sentence);
    }
    if (then.type !== later.type) {
      said.unshift(`changed from a ${then.type} to a ${later.type}`);
    }
    if (said.length === 0) continue;

    /* Only the part of the difference this asset is responsible for,
       and only where the plan did not also move. With a plan change in
       the same amendment there is no honest way to split an asset's
       increase between the two, so the line says what changed and the
       total says what it cost. */
    const samePlan = before.plan === after.plan;
    const delta = samePlan
      ? annualOf(later, after, card) - annualOf(then, before, card)
      : null;

    changes.push({
      kind: 'asset-changed',
      what: `${later.reg.trim()}: ${said.join(', ')}`,
      delta: delta && Math.abs(delta) > 0.005 ? delta : null,
    });
  }

  /* ---- the money that is not an asset ---- */
  if (before.managerDiscount !== after.managerDiscount) {
    changes.push({
      kind: 'money',
      what: `Manager's discount changed from ${(before.managerDiscount * 100).toFixed(1)}% to ${(after.managerDiscount * 100).toFixed(1)}%`,
      delta: null,
    });
  }
  if (before.promoDiscount !== after.promoDiscount) {
    changes.push({
      kind: 'money',
      what: `Promotional discount changed from ${(before.promoDiscount * 100).toFixed(1)}% to ${(after.promoDiscount * 100).toFixed(1)}%`,
      delta: null,
    });
  }
  for (const [field, label] of [
    ['labourHgv', 'HGV'], ['labourTrailer', 'trailer'], ['labourVan', 'van'],
  ] as const) {
    if (before[field] !== after[field]) {
      changes.push({
        kind: 'money',
        what: `${label} labour rate changed from ${money(before[field])} to ${money(after[field])} an hour`,
        delta: null,
      });
    }
  }

  const order: Change['kind'][] = ['plan', 'term', 'asset-added', 'asset-removed', 'asset-changed', 'money', 'other'];
  changes.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return {
    changes,
    was: pricedBefore.annual,
    now: pricedAfter.annual,
    difference: Math.round((pricedAfter.annual - pricedBefore.annual) * 100) / 100,
  };
}

/**
 * Whether there is anything to amend.
 *
 * An amendment with no changes on it is a row in a bill's history that
 * explains nothing, so the screen refuses to apply one and this is what
 * it asks.
 */
export function nothingChanged(summary: AmendmentSummary): boolean {
  return summary.changes.length === 0 && Math.abs(summary.difference) < 0.005;
}

/**
 * The whole amendment in one line, for a list.
 *
 * Names the first change and counts the rest, because a list of
 * amendments is scanned rather than read and "two trailers added" tells
 * somebody whether to open it.
 */
export function amendmentInAWord(summary: AmendmentSummary): string {
  if (summary.changes.length === 0) return 'No change to the cover';
  const first = summary.changes[0].what;
  if (summary.changes.length === 1) return first;
  return `${first}, and ${summary.changes.length - 1} other change${summary.changes.length === 2 ? '' : 's'}`;
}
