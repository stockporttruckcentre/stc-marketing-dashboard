/* =============================================================
   FleetSmart+, in the shapes the screen and the engine share.

   One definition per thing, used by the wizard that collects it, the
   engine that prices it, the document that prints it and the routes
   that save it. A second copy is how a field added to the form reaches
   two of the four.
   ============================================================= */
import type { AssetClass, AssetType, Plan } from './ratecard';

export type { AssetClass, AssetType, Plan };

export type WorkPattern = 'Days' | 'Nights' | 'Combined';
export type Tacho = '2yr' | '6yr' | 'DTCO' | 'Smart' | 'none';

/**
 * One asset on a contract.
 *
 * Everything except `reg` and `type` is optional, and that is the point
 * of the builder: a reg and an asset type is enough, every other value
 * falls back to what the plan and the class say it should be, and
 * anything typed over the top wins. `null` means "use the default",
 * which is why these are nullable rather than pre-filled.
 */
export type FleetAsset = {
  /** Local only, so a row can be reordered and removed without an id from the server. */
  key: string;
  reg: string;
  type: AssetType | '';

  /** Age in years and miles a year. Both drive the Platinum wear and tear figure only. */
  age: number | null;
  mileagePerYear: number | null;

  /** Weeks between safety inspections. Blank is 6, or 26 for a van. */
  pmiWeeks: number | null;
  /** C (major) services a year. Blank is 1, or 0 for a trailer. */
  cServicesPerYear: number | null;
  /** Brake tests a year. Blank is 0, or 1 for a van. */
  brakeTestsPerYear: number | null;
  /** Laden roller brake tests a year. Blank is 4, or 1 for a trailer and 0 for a van. */
  ladenRbtPerYear: number | null;
  /** Telematics brake performance monitoring, charged as a flat yearly figure. */
  telematicsPerYear: number | null;

  workPattern: WorkPattern;
  outOfHours: boolean;
  tailLift: boolean;
  tacho: Tacho;
  collectionAndDelivery: boolean;
  /** Silver only. On Gold and Platinum the portal is part of the plan. */
  portalAddOn: boolean;

  /** Types over the automatic Platinum figure, and adds the line on any plan. */
  wearAndTear: number | null;
  /** Anything agreed that the plan does not cover. */
  misc: number | null;
  /** Why this asset is set up the way it is. Never printed on the contract. */
  note: string;
};

/** Everything the wizard collects, which is everything the engine needs. */
export type ContractInput = {
  plan: Plan;
  termMonths: number;
  startDate: string;

  customerName: string;
  customerAddress: string;
  customerContact: string;
  customerCompanyNumber: string;

  /** Labour rates, which price collection and delivery and print in the Charges block. */
  labourHgv: number;
  labourTrailer: number;
  labourVan: number;

  /** A manager's discount, as a fraction. 0.05 is five percent. */
  managerDiscount: number;
  /**
   * A promotional discount. Under 1 it is read as a percentage of what
   * is left after the manager's discount; 1 or over it is read as a
   * pound figure. The workbook's own P6 rule, kept because the sales
   * team already types it that way.
   */
  promoDiscount: number;
  /** Whether the customer sees the promotional discount as its own line. */
  promoOnContract: boolean;

  assets: FleetAsset[];
};

/** One priced line against one asset. */
export type PricedLine = {
  line: string;
  /** What one of them costs. */
  price: number;
  /** How many a year. */
  frequency: number;
  /** Whether the plan covers it. A line that is not covered still prices, at £0. */
  included: boolean;
  /** Whether the work pattern and out-of-hours uplift applied. */
  labour: boolean;
  cost: number;
};

/** What the engine says about one asset. */
export type PricedAsset = {
  key: string;
  reg: string;
  type: AssetType | '';
  cls: AssetClass | '';
  axles: number;
  lines: PricedLine[];
  annual: number;
  monthly: number;
  weekly: number;
  /** The wear and tear figure actually used, and whether a person set it. */
  wearAndTear: number;
  wearAndTearIsManual: boolean;
  /** Inspection visits a year, which several lines and the wording both need. */
  visitsPerYear: number;
  /** Things worth saying out loud before this goes to a customer. */
  warnings: string[];
};

/** What the engine says about the whole contract. */
export type PricedContract = {
  assets: PricedAsset[];
  /** Before either discount. */
  subtotal: number;
  managerDiscount: number;
  promoDiscount: number;
  annual: number;
  monthly: number;
  weekly: number;
  /** What the contract can honestly claim it includes. */
  flags: ContractFlags;
};

/**
 * What the fleet and the plan between them make true.
 *
 * The workbook calls these the contract text flags and is explicit
 * about why they exist: they decide which lines the document says are
 * included, so it can never claim something the customer is not being
 * charged for.
 */
export type ContractFlags = {
  hasVehicles: boolean;
  hasTrailers: boolean;
  hasVans: boolean;
  tacho: boolean;
  brakeTests: boolean;
  ladenRbts: boolean;
  tailLift: boolean;
  wearAndTear: boolean;
  portal: boolean;
  telematics: boolean;
  serviceParts: boolean;
  cService: boolean;
  documentStorage: boolean;
  collectionAndDelivery: boolean;
  misc: boolean;
  /** "vehicles, trailers and vans", for the MOT line. */
  assetWords: string;
};
