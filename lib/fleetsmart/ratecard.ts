/* =============================================================
   The FleetSmart+ rate card, exactly as the pricing workbook holds it.

   Lifted 1:1 from `FleetSmart_Contract_Builder.xlsx`: the Rates tab
   becomes `RATES`, the Inclusions tab becomes `INCLUDED`, and the
   engine settings on the Lists tab become `SETTINGS`. Nothing was
   rounded, renamed or tidied on the way in, because the whole promise
   of the tab is that a contract priced here and a contract priced in
   the workbook come to the same number.

   ---- Why it is here and also in the database ----

   Migration 061 seeds `fleetsmart_rates` from this file. The database
   is what the running application prices from, so somebody can put a
   price up without a deploy. This copy is the seed and the fallback:
   an installation that has not run 061 still prices correctly, and the
   check in `scripts/fleetsmart-price-check.ts` runs against it, so the
   numbers it asserts are the numbers the workbook produced.

   ---- Reading a rate row ----

   `axle` is the four price columns, indexed by the asset's axle count:
   `axle[axles - 1]`. A £0 means the line does not apply to that class
   or axle count. It is not a missing price, and the workbook says so
   in its own words on the Rates tab.

   `freq` is a code the engine turns into a number of times per year:

     1   once a year          T   every inspection visit
     A   every A service      Bc  every B service (never, see below)
     Cc  every C service      BK  every brake test
     LD  every laden RBT      12  monthly
     BC  B and C services

   `labour` marks the lines that scale with the work pattern and the
   out-of-hours uplift.

   B services are not offered on any FleetSmart+ plan. The rows are kept
   so an old key still resolves, and their frequency is hard zero.
   ============================================================= */

export type Plan = 'Silver' | 'Gold' | 'Platinum';
export type AssetClass = 'Vehicle' | 'Trailer' | 'Van';
export type AssetType = '2 Axle Rigid' | '6x2 Truck' | '3 Axle Trailer' | 'LCV';
export type FreqCode = '1' | 'T' | 'A' | 'Bc' | 'Cc' | 'BK' | 'LD' | '12' | 'BC';

export const PLANS: Plan[] = ['Silver', 'Gold', 'Platinum'];

/** The four assets FleetSmart+ covers, and what each one is. */
export const ASSET_TYPES: { type: AssetType; cls: AssetClass; axles: number }[] = [
  { type: '2 Axle Rigid',   cls: 'Vehicle', axles: 2 },
  { type: '6x2 Truck',      cls: 'Vehicle', axles: 3 },
  { type: '3 Axle Trailer', cls: 'Trailer', axles: 3 },
  { type: 'LCV',            cls: 'Van',     axles: 2 },
];

export type RateRow = {
  cls: AssetClass;
  line: string;
  /** Price per axle count, indexed 1-axle to 4-axle. */
  axle: [number, number, number, number];
  freq: FreqCode;
  labour: boolean;
};

export const RATES: RateRow[] = [
  { cls: 'Vehicle', line: 'Collection & Delivery', axle: [0, 0, 0, 0], freq: 'T', labour: true },
  { cls: 'Vehicle', line: 'Inspection/A Service', axle: [0, 186, 233.75, 297], freq: 'A', labour: true },
  { cls: 'Vehicle', line: 'Inspection/B Service', axle: [0, 260, 297, 371], freq: 'Bc', labour: true },
  { cls: 'Vehicle', line: 'Inspection/C Service', axle: [0, 260, 297.5, 520], freq: 'Cc', labour: true },
  { cls: 'Vehicle', line: 'Submit for MOT', axle: [0, 149, 149, 149], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Laden Brake Test (RBT)', axle: [120, 120, 120, 120], freq: 'LD', labour: false },
  { cls: 'Vehicle', line: 'MOT Steam Clean', axle: [0, 69, 69, 106], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Brake Test', axle: [0, 99.75, 99.75, 99.75], freq: 'BK', labour: false },
  { cls: 'Vehicle', line: 'ATF Lane Fee', axle: [0, 70, 70, 75], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Test Fee', axle: [0, 91, 113, 159], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Taillift LOLER & Weight Test', axle: [0, 185, 185, 185], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Taillift Cover (optional extra)', axle: [0, 204, 204, 204], freq: '1', labour: false },
  { cls: 'Vehicle', line: '2 Year Tacho Calibration', axle: [0, 79, 79, 79], freq: '1', labour: false },
  { cls: 'Vehicle', line: '6 Year Tacho Calibration', axle: [0, 101, 101, 101], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'DTCO', axle: [0, 138, 138, 138], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Smart DTCO', axle: [0, 165, 165, 165], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Headlamp Alignment Test', axle: [0, 50, 50, 59], freq: '1', labour: false },
  { cls: 'Vehicle', line: 'Sundries', axle: [0, 10, 20, 27], freq: 'T', labour: false },
  { cls: 'Vehicle', line: 'DD Fee', axle: [0, 4, 4, 4], freq: '12', labour: false },
  { cls: 'Vehicle', line: 'Truckfile', axle: [0, 5, 5, 5], freq: 'T', labour: false },
  { cls: 'Trailer', line: 'Collection & Delivery', axle: [0, 0, 0, 0], freq: 'T', labour: true },
  { cls: 'Trailer', line: 'Inspection/A Service', axle: [69, 80, 97.5, 0], freq: 'A', labour: true },
  { cls: 'Trailer', line: 'Inspection/B Service', axle: [69, 80, 97.5, 0], freq: 'Bc', labour: true },
  { cls: 'Trailer', line: 'Inspection/C Service', axle: [69, 80, 97.5, 0], freq: 'Cc', labour: true },
  { cls: 'Trailer', line: 'Submit for MOT', axle: [159, 159, 149, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Laden Brake Test (RBT)', axle: [210, 210, 210, 0], freq: 'LD', labour: false },
  { cls: 'Trailer', line: 'MOT Steam Clean', axle: [69, 69, 69, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Brake Test', axle: [102.75, 102.75, 102.75, 0], freq: 'BK', labour: false },
  { cls: 'Trailer', line: 'ATF Lane Fee', axle: [59, 59, 50, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Test Fee', axle: [62, 66, 64, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Taillift LOLER & Weight Test', axle: [185, 185, 185, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Taillift Cover (optional extra)', axle: [204, 204, 204, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: '2 Year Tacho Calibration', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: '6 Year Tacho Calibration', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'DTCO', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Smart DTCO', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Headlamp Alignment Test', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Trailer', line: 'Sundries', axle: [13, 13, 13, 0], freq: 'T', labour: false },
  { cls: 'Trailer', line: 'DD Fee', axle: [4, 4, 4, 0], freq: '12', labour: false },
  { cls: 'Trailer', line: 'Truckfile', axle: [5, 5, 5, 0], freq: 'T', labour: false },
  { cls: 'Van', line: 'Collection & Delivery', axle: [0, 0, 0, 0], freq: 'T', labour: true },
  { cls: 'Van', line: 'Inspection/A Service', axle: [0, 170, 0, 0], freq: 'A', labour: true },
  { cls: 'Van', line: 'Inspection/B Service', axle: [0, 186, 0, 0], freq: 'Bc', labour: true },
  { cls: 'Van', line: 'Inspection/C Service', axle: [0, 212.5, 0, 0], freq: 'Cc', labour: true },
  { cls: 'Van', line: 'Submit for MOT', axle: [0, 75, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Laden Brake Test (RBT)', axle: [0, 0, 0, 0], freq: 'LD', labour: false },
  { cls: 'Van', line: 'MOT Steam Clean', axle: [0, 45, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Brake Test', axle: [0, 78.5, 0, 0], freq: 'BK', labour: false },
  { cls: 'Van', line: 'ATF Lane Fee', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Test Fee', axle: [0, 54, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Taillift LOLER & Weight Test', axle: [0, 185, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Taillift Cover (optional extra)', axle: [0, 204, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: '2 Year Tacho Calibration', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: '6 Year Tacho Calibration', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'DTCO', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Smart DTCO', axle: [0, 0, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Headlamp Alignment Test', axle: [0, 59, 0, 0], freq: '1', labour: false },
  { cls: 'Van', line: 'Sundries', axle: [0, 11, 0, 0], freq: 'T', labour: false },
  { cls: 'Van', line: 'DD Fee', axle: [0, 4, 0, 0], freq: '12', labour: false },
  { cls: 'Van', line: 'Truckfile', axle: [0, 5, 0, 0], freq: 'T', labour: false },
];

/** Which lines each plan covers, per class. Everything else is not charged. */
export const INCLUDED: Record<Plan, Record<AssetClass, string[]>> = {
  Silver: {
    Vehicle: ['Inspection/A Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Truckfile (document storage)'],
    Trailer: ['Inspection/A Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Sundries', 'DD Fee', 'Truckfile (document storage)'],
    Van: ['Inspection/A Service', 'Submit for MOT', 'MOT Steam Clean', 'Brake Test', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Truckfile (document storage)'],
  },
  Gold: {
    Vehicle: ['Inspection/A Service', 'Inspection/C Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Service Kit (C)', 'Engine Oil', 'Compliance Portal Access', 'Bulb Replacement'],
    Trailer: ['Inspection/A Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Sundries', 'DD Fee', 'Compliance Portal Access'],
    Van: ['Inspection/A Service', 'Inspection/C Service', 'Submit for MOT', 'MOT Steam Clean', 'Brake Test', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Service Kit (C)', 'Engine Oil', 'Compliance Portal Access', 'Bulb Replacement'],
  },
  Platinum: {
    Vehicle: ['Inspection/A Service', 'Inspection/C Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Service Kit (C)', 'Engine Oil', 'Wear & Tear Allowance', 'Compliance Portal Access', 'Bulb Replacement'],
    Trailer: ['Inspection/A Service', 'Submit for MOT', 'Laden Brake Test (RBT)', 'MOT Steam Clean', 'Brake Test', 'ATF Lane Fee', 'Test Fee', 'Sundries', 'DD Fee', 'Wear & Tear Allowance', 'Compliance Portal Access'],
    Van: ['Inspection/A Service', 'Inspection/C Service', 'Submit for MOT', 'MOT Steam Clean', 'Brake Test', 'Test Fee', 'Headlamp Alignment Test', 'Sundries', 'DD Fee', 'Service Kit (C)', 'Engine Oil', 'Wear & Tear Allowance', 'Compliance Portal Access', 'Bulb Replacement'],
  },
};

/** The parts kit fitted at each C service, per asset type. */
export const SERVICE_KIT: Record<AssetType, number> = {
  '2 Axle Rigid': 210, '6x2 Truck': 260, 'LCV': 110, '3 Axle Trailer': 0,
};

/** Litres of engine oil used per C service, per asset type. */
export const OIL_LITRES: Record<AssetType, number> = {
  '2 Axle Rigid': 26, '6x2 Truck': 36, 'LCV': 8, '3 Axle Trailer': 0,
};

/** Compliance portal, per inspection, on Gold and Platinum. */
export const PORTAL_PER_VISIT: Record<AssetClass, number> = {
  Vehicle: 15, Trailer: 14, Van: 50,
};

/** Bulb replacement per year. A trailer carries no covered bulbs. */
export const BULBS_PER_YEAR: Record<AssetClass, number> = {
  Vehicle: 100, Van: 100, Trailer: 0,
};

/** The wear and tear allowance a Platinum asset starts from, before ageing. */
export const WEAR_AND_TEAR_BASE: Record<AssetType, number> = {
  '2 Axle Rigid': 800, '6x2 Truck': 1500, '3 Axle Trailer': 500, 'LCV': 600,
};

/** Portal access on Silver, which is an add-on rather than part of the plan. */
export const SILVER_PORTAL_PER_YEAR = 100;

/** What a work pattern does to every labour line. */
export const WORK_PATTERNS: { value: string; label: string; multiplier: number }[] = [
  { value: 'Days',     label: 'Days',            multiplier: 1 },
  { value: 'Nights',   label: 'Nights',          multiplier: 1.25 },
  { value: 'Combined', label: 'Days and nights', multiplier: 1.125 },
];

/** The inspection intervals the builder offers, in weeks. */
export const PMI_INTERVALS = [4, 6, 8, 10, 12, 13, 16, 26];

/** Contract lengths, in months. */
export const TERM_MONTHS = [12, 24, 36, 48, 60];

/** What a tachograph choice charges. Empty means the standard 2 year. */
export const TACHO_CHOICES: { value: string; label: string }[] = [
  { value: '2yr',   label: '2 year calibration' },
  { value: '6yr',   label: '6 year calibration' },
  { value: 'DTCO',  label: 'DTCO' },
  { value: 'Smart', label: 'Smart DTCO' },
  { value: 'none',  label: 'No tachograph work' },
];

/* The engine settings that live on the workbook's Lists tab. Every one
   of them is editable there, so every one of them is a named constant
   here rather than a number buried in a formula. */
export const SETTINGS = {
  /** Miles a year that counts as one year of ageing for wear and tear. */
  wearMileageBaseline: 60_000,
  /** How much the wear and tear allowance rises per year of age, after the start year. */
  wearUpliftPerYear: 0.03,
  /** The age at which that uplift starts. */
  wearUpliftStartYear: 4,
  /** What working out of hours adds to every labour line. */
  outOfHoursUplift: 0.05,
  /** Engine oil, per litre. */
  oilPerLitre: 7.6,
};

/** The default labour rates the builder opens with. */
export const DEFAULT_LABOUR = { hgv: 85, trailer: 65, van: 85 };
