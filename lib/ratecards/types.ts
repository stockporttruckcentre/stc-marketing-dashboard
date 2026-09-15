/* =============================================================
   The shapes the Rate Card Builder reads and writes.

   Written out by hand and kept honest by `npm run check:rpc`, for the
   reason `lib/protean/rpc.ts` is: a column renamed in a migration and
   not here is an `undefined` on a screen rather than an error anywhere.
   ============================================================= */
import type { RateBasis } from './kit.generated';

export type { RateBasis };

/** Who picks up the bill for an hour of work. See migration 110 s3. */
export type ChargeTo = 'stc' | 'customer';

export type CardStatus = 'draft' | 'awaiting' | 'approved' | 'superseded' | 'withdrawn';

export type LabourRate = {
  id: string;
  card_id: string;
  pool: string;
  label: string;
  rate: number;
  charge_to: ChargeTo;
  is_custom: boolean;
  note: string | null;
  position: number;
};

export type Rate = {
  id: string;
  card_id: string;
  rate_id: string;
  section: string;
  item: string;
  /** 0 for a single price column, 1 to 4 for an axle count. */
  axle: number;
  basis: RateBasis;
  /** Full precision. Never rounded, never a price. Derived rates only. */
  hours: number | null;
  pool: string | null;
  amount: number | null;
  text_value: string | null;
  override_value: number | null;
  overridden_by: string | null;
  overridden_at: string | null;
  cap: number | null;
  cap_by: string | null;
  position: number;

  /* Computed by `rate_card_read`, so the screen and the export cannot
     disagree about what a row costs. */
  price: number | null;
  /** The same hours at the STC-billed labour rate, where one is set. */
  price_stc: number | null;
  /** What an overridden derived rate would be without the override. */
  would_be: number | null;
  over_cap: boolean;
};

export type CardManager = {
  user_id: string;
  from_crm: boolean;
  name: string | null;
  email: string | null;
};

export type Inclusion = {
  inclusion: string;
  silver: boolean;
  gold: boolean;
  platinum: boolean;
  position: number;
};

export type CardHead = {
  id: string;
  ref: string;
  contact_id: string | null;
  customer_name: string;
  effective_from: string;
  good_until: string;
  status: CardStatus;
  main_contact: string | null;
  address: string | null;
  telephone: string | null;
  email: string | null;
  other_detail: string | null;
  accounts_detail: string | null;
  contract_id: string | null;
  show_fleetsmart: boolean;
  extra_inclusions: { inclusion: string; tiers: string[] }[];
  owner_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;

  days_old: number;
  ageing: boolean;
  expired: boolean;
  editable: boolean;
};

export type FleetsmartSide = {
  contract: {
    id: string; ref: string | null; plan: 'Silver' | 'Gold' | 'Platinum';
    starts_on: string | null; status: string; extras: Record<string, unknown>;
  } | null;
  shown: boolean;
  extras: { inclusion: string; tiers: string[] }[];
  inclusions: Inclusion[];
};

/** Everything the builder draws one frame from. One call. */
export type FullCard = {
  card: CardHead;
  labour: LabourRate[];
  rates: Rate[];
  managers: CardManager[];
  fleetsmart: FleetsmartSide;
  parts: Rate[];
  /** Fields the CRM could not fill in, which the screen marks required. */
  missing: ('main_contact' | 'address' | 'telephone' | 'email' | 'account_manager')[];
};

/** A row on the hub. */
export type CardRow = {
  id: string;
  ref: string;
  contact_id: string | null;
  customer_name: string;
  status: CardStatus;
  effective_from: string;
  good_until: string;
  days_old: number;
  ageing: boolean;
  expired: boolean;
  overrides: number;
  labour_summary: string | null;
  on_contract: boolean;
  plan: 'Silver' | 'Gold' | 'Platinum' | null;
  show_fleetsmart: boolean;
  owner_name: string | null;
  manager_names: string | null;
  updated_at: string;
};

export type ChangeRow = {
  id: string;
  kind: string;
  what: string;
  was: string | null;
  now_is: string | null;
  rows_moved: number;
  actor_name: string | null;
  actor_id: string | null;
  at: string;
};

/** The four answers to "does this customer already have one". */
export type DuplicateVerdict = {
  verdict: 'none' | 'live' | 'ageing' | 'expired';
  card_id: string | null;
  card_ref: string | null;
  card_status: CardStatus | null;
  effective_from: string | null;
  good_until: string | null;
  days_old: number | null;
  owner_name: string | null;
};

/* ---- The defaults, which every new card starts as ---- */

export type TemplateLabour = { pool: string; label: string; rate: number; position: number };

export type TemplateRate = {
  rate_id: string;
  axle: number;
  section: string;
  item: string;
  basis: RateBasis;
  hours: number | null;
  pool: string | null;
  amount: number | null;
  text_value: string | null;
  cap: number | null;
  cap_by: string | null;
  position: number;
  /** Computed by the database, so the tab and a card agree. */
  price: number | null;
};

export type TemplateRead = {
  labour: TemplateLabour[];
  rates: TemplateRate[];
  inclusions: Inclusion[];
  /** Cards still purely on the defaults, so a change may be offered for them. */
  untouched_cards: number;
  /** Cards with a rate somebody set, which a defaults change never touches. */
  touched_cards: number;
};

export type ResyncCandidate = {
  card_id: string;
  card_ref: string;
  customer_name: string;
  card_status: CardStatus;
  effective_from: string;
  owner_name: string | null;
  untouched: boolean;
  /** Why this card is left alone, in the words the screen prints. */
  why_not: string | null;
};

export type TemplateChange = {
  id: string;
  kind: string;
  what: string;
  was: string | null;
  now_is: string | null;
  cards_moved: number;
  actor_name: string | null;
  at: string;
};
