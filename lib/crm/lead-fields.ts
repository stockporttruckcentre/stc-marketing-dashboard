/* =============================================================
   A lead asks about the thing it is a lead for.

   ---- The complaint ----

   From production testing:

     The fields when you create a new lead or open an existing one are
     identical across each lead type. If I create a maintenance tracker
     lead it's asking how much i've sold the trailer for.

   It was worse than a wrong label. The drawer offered "New / Used" on a
   maintenance contract, described the job with the placeholder "4.7m
   curtain, PSK flats, drawbar", and had no field at all for the one
   thing a maintenance lead is actually about, which is what kind of work
   it is for. `crm_leads.what` has existed since the lead entity went in,
   the grid shows it, the new lead modal asks for it, and the drawer
   somebody spends their day in did not.

   ---- Why labels and not columns ----

   The three divisions sell different things and record the same shapes:
   a date the deal was agreed, a date it starts, what it is worth, what
   was made on it. `order_date` and `sale_price` are those shapes with
   trailer sales names on them, because trailer sales is the sheet the
   tracker was built from.

   Adding `contract_start_date` and `contract_value` beside them would
   give three columns meaning one thing, three sets of totals that have
   to agree, and a reporting question ("what did we sell") that has to
   remember to ask three times. So the columns stay one and the WORDS
   follow the division, which is what the reader needs and what was
   actually wrong.

   Where a field genuinely does not apply, it is not shown. New / Used
   describes a trailer and nothing else, so maintenance and rental never
   see it, and a blank column is never written on those rows.
   ============================================================= */
import type { LeadType } from '@/lib/types';
import { MAINTENANCE_WHAT, RENTAL_WHAT } from '@/lib/crm/work-kind';

export type LeadFields = {
  /** The division, spelled the way the tracker tab spells it. */
  label: string;

  /** `what`: what is being pitched for. Free text on trailer sales. */
  what: { label: string; hint: string; options: string[] | null };

  /** `new_or_used`: a trailer is new or used. A contract is neither. */
  newOrUsed: boolean;

  /** `description` on the account, which is where the spec goes. */
  description: { label: string; placeholder: string };

  /** `requirement`, which is the longer version of the same question. */
  requirementLabel: string;

  /** `estimated_value`, before anything is agreed. */
  estimatedLabel: string;
  estimatedHint: string;

  /* ---- once it is won, the four columns that describe the close ---- */
  closing: {
    title: string;
    hint: string;
    /** `order_date` */
    orderDate: string;
    /** `dispatch_date` */
    dispatchDate: string;
    /** `sale_price` */
    salePrice: string;
    /** `profit` and `profit_pct`, which only trailer sales records. */
    profit: boolean;
  };

  /** A trailer sale can name the unit out of stock. Nothing else can. */
  stockTrailer: boolean;
};

const TRAILER_SALES: LeadFields = {
  label: 'Trailer sales',
  what: {
    label: 'What are they after?',
    hint: 'The unit, in the words you would use on the phone.',
    options: null,
  },
  newOrUsed: true,
  description: {
    label: 'Specification',
    placeholder: '4.7m curtain, PSK flats, drawbar',
  },
  requirementLabel: 'Requirement',
  estimatedLabel: 'Estimated sales value',
  estimatedHint: 'What you expect the deal to be worth.',
  closing: {
    title: 'The sale',
    hint: 'What the deal was worth',
    orderDate: 'Order date',
    dispatchDate: 'Dispatch date',
    salePrice: 'Sale price (£)',
    profit: true,
  },
  stockTrailer: true,
};

const MAINTENANCE: LeadFields = {
  label: 'Maintenance',
  what: {
    label: 'What kind of work?',
    hint: 'What the contract or the job is for.',
    options: MAINTENANCE_WHAT,
  },
  newOrUsed: false,
  description: {
    label: 'The fleet',
    placeholder: '12 tractors, 30 curtainsiders, 4 vans',
  },
  requirementLabel: 'What they need from us',
  estimatedLabel: 'Estimated annual value',
  estimatedHint: 'What the work is worth to us in a year.',
  closing: {
    title: 'The contract',
    hint: 'What was agreed',
    orderDate: 'Agreed on',
    dispatchDate: 'Contract starts',
    salePrice: 'Contract value (£)',
    /* Profit on a maintenance contract is a workshop figure that
       arrives months later, not something a rep types when the deal is
       agreed. Analytics reads it from the invoices. */
    profit: false,
  },
  stockTrailer: false,
};

const RENTAL: LeadFields = {
  label: 'Rental & leasing',
  what: {
    label: 'What kind of hire?',
    hint: 'Spot hire, contract hire or a lease.',
    options: RENTAL_WHAT,
  },
  newOrUsed: false,
  description: {
    label: 'What they want on hire',
    placeholder: '2 curtainsiders, 6 months, Carrington',
  },
  requirementLabel: 'Hire requirement',
  estimatedLabel: 'Estimated hire value',
  estimatedHint: 'What the hire is worth over its term.',
  closing: {
    title: 'The hire',
    hint: 'What was agreed',
    orderDate: 'Agreed on',
    dispatchDate: 'On hire from',
    salePrice: 'Hire value (£)',
    profit: false,
  },
  stockTrailer: false,
};

const BY_TYPE: Record<LeadType, LeadFields> = {
  trailer_sales: TRAILER_SALES,
  maintenance:   MAINTENANCE,
  rental:        RENTAL,
};

/**
 * The words this division uses.
 *
 * Falls back to trailer sales for a null type, which is what the column
 * defaults to and what every row imported before the type existed is.
 */
export function fieldsFor(type: LeadType | null | undefined): LeadFields {
  return BY_TYPE[type ?? 'trailer_sales'] ?? TRAILER_SALES;
}
