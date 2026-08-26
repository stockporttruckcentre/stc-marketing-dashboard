/* =============================================================
   Reading a contract off the wire.

   Shared by the create and the save routes rather than exported from
   one of them, because Next treats every export from a route file as a
   route field and a helper living there fails the build.

   Everything is coerced rather than trusted. A number that arrives as
   the string "12" becomes 12; a plan nobody offers becomes the one that
   was there before; an asset with no reg is dropped. The engine is
   given a shape it can price, and the price is then computed here on
   the server, so nothing a browser sends decides what a contract costs.

   The manager's discount is the one field with a permission on it. It
   is dropped, silently and completely, for anybody without
   `fleetsmart.discount`. Silently because the control is not drawn for
   them either: a request carrying one is a modified client or a stale
   tab, and neither is worth a sentence.
   ============================================================= */
import { PLANS, TERM_MONTHS, WORK_PATTERNS, type Plan } from './ratecard';
import { ASSET_TYPES } from './ratecard';
import type { ContractInput, FleetAsset, Tacho, WorkPattern } from './types';
import { blankExtras, type ContractExtras, type WordingKey } from './contract';
import { DEFAULT_LABOUR } from './ratecard';

const TACHOS: Tacho[] = ['2yr', '6yr', 'DTCO', 'Smart', 'none'];
const WORDING_KEYS: WordingKey[] = [
  'planTitle', 'term', 'services', 'exclusions', 'additional', 'charges', 'collection', 'payment',
];

/** A number, or null where there is not one. Never NaN. */
function num(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A number with a floor and a fallback, for the fields that must have one. */
function required(v: unknown, fallback: number, min = 0): number {
  const n = num(v);
  return n == null || n < min ? fallback : n;
}

function text(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function readAsset(raw: unknown, index: number): FleetAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const reg = text(a.reg, 40);
  if (!reg) return null;

  const type = ASSET_TYPES.some((t) => t.type === a.type) ? (a.type as FleetAsset['type']) : '';

  return {
    key: text(a.key, 60) || `a${index}`,
    reg,
    type,
    age: num(a.age),
    mileagePerYear: num(a.mileagePerYear),
    pmiWeeks: num(a.pmiWeeks),
    cServicesPerYear: num(a.cServicesPerYear),
    brakeTestsPerYear: num(a.brakeTestsPerYear),
    ladenRbtPerYear: num(a.ladenRbtPerYear),
    telematicsPerYear: num(a.telematicsPerYear),
    workPattern: WORK_PATTERNS.some((w) => w.value === a.workPattern)
      ? (a.workPattern as WorkPattern) : 'Days',
    outOfHours: a.outOfHours === true,
    tailLift: a.tailLift === true,
    tacho: TACHOS.includes(a.tacho as Tacho) ? (a.tacho as Tacho) : '2yr',
    collectionAndDelivery: a.collectionAndDelivery === true,
    portalAddOn: a.portalAddOn === true,
    wearAndTear: num(a.wearAndTear),
    misc: num(a.misc),
    note: text(a.note, 600),
  };
}

export function readContractBody(
  body: unknown,
  mayDiscount: boolean,
): { input: ContractInput; extras: ContractExtras } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Nothing arrived to save.' };
  const b = body as Record<string, unknown>;

  const rawInput = (b.input ?? {}) as Record<string, unknown>;
  const rawExtras = (b.extras ?? {}) as Record<string, unknown>;

  const customerName = text(rawInput.customerName, 200);
  if (!customerName) return { error: 'A contract needs a customer on it.' };

  const assets = Array.isArray(rawInput.assets)
    ? rawInput.assets.map(readAsset).filter((a): a is FleetAsset => a !== null).slice(0, 200)
    : [];

  const plan = PLANS.includes(rawInput.plan as Plan) ? (rawInput.plan as Plan) : 'Platinum';
  const termMonths = TERM_MONTHS.includes(required(rawInput.termMonths, 36, 1))
    ? required(rawInput.termMonths, 36, 1)
    : required(rawInput.termMonths, 36, 1);

  /* Discounts are fractions between nothing and everything. A 1.4 in
     the manager's discount box would otherwise turn a contract into a
     refund. The promotional one is deliberately unbounded above 1,
     because over 1 it means pounds rather than percent, and it is
     capped against the total by the engine instead. */
  const managerDiscount = mayDiscount
    ? Math.min(Math.max(num(rawInput.managerDiscount) ?? 0, 0), 0.9)
    : 0;

  const input: ContractInput = {
    plan,
    termMonths,
    startDate: text(rawInput.startDate, 10),
    customerName,
    customerAddress: text(rawInput.customerAddress, 400),
    customerContact: text(rawInput.customerContact, 200),
    customerCompanyNumber: text(rawInput.customerCompanyNumber, 40),
    labourHgv: required(rawInput.labourHgv, DEFAULT_LABOUR.hgv, 0),
    labourTrailer: required(rawInput.labourTrailer, DEFAULT_LABOUR.trailer, 0),
    labourVan: required(rawInput.labourVan, DEFAULT_LABOUR.van, 0),
    managerDiscount,
    promoDiscount: Math.max(num(rawInput.promoDiscount) ?? 0, 0),
    promoOnContract: rawExtras.promoOnContract === true || rawInput.promoOnContract === true,
    assets,
  };

  const overrides: Partial<Record<WordingKey, string>> = {};
  const rawOverrides = (rawExtras.overrides ?? {}) as Record<string, unknown>;
  for (const key of WORDING_KEYS) {
    const v = text(rawOverrides[key], 6000);
    if (v) overrides[key] = v;
  }

  const extras: ContractExtras = {
    ...blankExtras(),
    companyNumber: text(rawExtras.companyNumber, 40),
    registeredAddress: text(rawExtras.registeredAddress, 400),
    maximumMileage: num(rawExtras.maximumMileage),
    accountManagerName: text(rawExtras.accountManagerName, 120),
    accountManagerPhone: text(rawExtras.accountManagerPhone, 60),
    accountManagerEmail: text(rawExtras.accountManagerEmail, 160),
    overrides,
  };

  return { input, extras };
}
