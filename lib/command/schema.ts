/* =============================================================
   The data dictionary.

   Hand-writing one intent per question does not scale: "how many
   trailers in stock" is a different sentence from "what are the
   in-stock trailers worth" and from "how many fridges in Hyde", and
   there are hundreds more.

   So instead of intents, this describes the data itself: which things
   exist, what people call them, which columns can be filtered and
   grouped, and what words map to which values. A generic query then
   composes measure + entity + filters + grouping, which covers the
   combinations rather than the sentences.

   To add coverage, add vocabulary here. Not another intent.
   ============================================================= */

import { BODY_TYPES } from './lexicon';

export type Measure = 'count' | 'sum' | 'avg' | 'list';

export type FilterSpec = {
  key: string;
  column: string;
  kind: 'enum' | 'text' | 'date' | 'number' | 'boolean';
  label: string;
  /** Word the user might say, mapped to the value stored in the column. */
  vocabulary?: Record<string, string>;
  /** Free text filters match with ilike against this column. */
  freeText?: boolean;
};

export type DimensionSpec = {
  key: string;
  column: string;
  label: string;
  words: string[];
};

export type EntitySpec = {
  id: string;
  table: string;
  /** Singular and plural, plus everything people call it in the yard. */
  nouns: string[];
  label: string;
  labelOne: string;
  /** Column shown when listing rows. */
  titleColumn: string;
  subtitleColumns: string[];
  /** Numeric columns that can be summed or averaged. */
  amounts: { key: string; column: string; label: string; words: string[] }[];
  filters: FilterSpec[];
  dimensions: DimensionSpec[];
  /** Applied unless the sentence overrides it. */
  scope?: 'mine' | 'all';
  /** Where a row lives, for the "open it" link. */
  hrefFor?: (row: any) => string;
  dateColumn?: string;
  /**
   * Every date a person can order by or ask about, not only the one
   * periods are measured against.
   *
   * "Show vehicles added between May and July, newest first" needs the
   * date it ARRIVED, and the period column is the date it left. One
   * dateColumn could not tell them apart, so "newest first" sorted the
   * stock list by the day each trailer was dispatched, which for
   * anything still in the yard is empty.
   */
  dates?: { key: string; column: string; label: string; words: string[] }[];
  /**
   * Nouns that name the thing AND narrow it. "how many leads" means
   * status=lead, whereas "how many customers" just means all of them.
   */
  nounImpliesFilter?: Record<string, { column: string; value: string; label: string }>;
};

const STOCK_STATUS: Record<string, string> = {
  'in stock': 'in_stock', instock: 'in_stock', available: 'in_stock', stock: 'in_stock',
  'new build': 'new_build', newbuild: 'new_build', build: 'new_build', building: 'new_build',
  'sales order': 'sales_order', ordered: 'sales_order', order: 'sales_order', reserved: 'sales_order',
  sold: 'sold', gone: 'sold',
  rental: 'rental', rented: 'rental', hire: 'rental', hired: 'rental',
  scrap: 'scrap', scrapped: 'scrap', written: 'scrap',
};

const DEAL_STATUS: Record<string, string> = {
  lead: 'lead', leads: 'lead', new: 'lead', enquiry: 'lead', enquiries: 'lead',
  contacted: 'contacted', contact: 'contacted', approached: 'contacted',
  quoted: 'quoted', quote: 'quoted', quotes: 'quoted', proposal: 'quoted', proposals: 'quoted',
  won: 'won', win: 'won',
  customer: 'customer', customers: 'customer', closed: 'customer', converted: 'customer',
  lost: 'lost', dead: 'lost', lapsed: 'lost',
};

export const ENTITIES: EntitySpec[] = [
  {
    id: 'trailers',
    table: 'stock_trailers',
    label: 'trailers', labelOne: 'trailer',
    nouns: ['trailer', 'trailers', 'unit', 'units', 'vehicle', 'vehicles', 'stock', 'box', 'boxes', 'fleet'],
    titleColumn: 'stc_no',
    subtitleColumns: ['make', 'model', 'category', 'location'],
    dateColumn: 'dispatch_date',
    dates: [
      { key: 'received', column: 'received_date', label: 'date in',
        words: ['added', 'arrived', 'came in', 'received', 'booked in', 'landed', 'in stock since', 'taken in'] },
      { key: 'dispatched', column: 'dispatch_date', label: 'date out',
        words: ['dispatched', 'delivered', 'went out', 'left', 'collected', 'shipped'] },
      { key: 'ordered', column: 'order_date', label: 'order date',
        words: ['ordered', 'order date', 'placed'] },
      { key: 'mot', column: 'mot_date', label: 'MOT date', words: ['mot', 'test', 'tested'] },
      { key: 'expected', column: 'expected_delivery', label: 'expected delivery',
        words: ['expected', 'due in', 'due to arrive', 'eta'] },
    ],
    amounts: [
      { key: 'price', column: 'sales_price', label: 'sale price', words: ['worth', 'value', 'revenue', 'price', 'sales', 'turnover', 'income'] },
      { key: 'profit', column: 'profit', label: 'profit', words: ['profit', 'margin', 'gross'] },
      { key: 'nbv', column: 'nbv', label: 'book value', words: ['nbv', 'book value', 'cost'] },
      { key: 'retail', column: 'retail_price', label: 'retail price', words: ['retail'] },
    ],
    filters: [
      { key: 'status', column: 'status', kind: 'enum', label: 'status', vocabulary: STOCK_STATUS },
      { key: 'make', column: 'make', kind: 'text', label: 'make', freeText: true },
      { key: 'model', column: 'model', kind: 'text', label: 'model', freeText: true },
      // Yard words for body type, so "how many fridges in stock" narrows
      // properly instead of counting everything in stock.
      // One source of truth for what people call a trailer body. This
      // used to be a shorter copy living here, which meant half the words
      // in the lexicon were never reachable from a query.
      { key: 'category', column: 'category', kind: 'enum', label: 'category', vocabulary: BODY_TYPES },
      { key: 'location', column: 'location', kind: 'text', label: 'location', freeText: true },
      { key: 'customer', column: 'customer', kind: 'text', label: 'customer', freeText: true },
      { key: 'rep', column: 'sales_rep', kind: 'text', label: 'rep', freeText: true },
      // "Blue curtainsiders" used to narrow on the body and quietly drop
      // the colour, so the answer was every curtainsider on the yard.
      { key: 'colour', column: 'colour', kind: 'enum', label: 'colour',
        vocabulary: {
          blue: 'Blue', red: 'Red', white: 'White', black: 'Black', green: 'Green',
          silver: 'Silver', grey: 'Grey', gray: 'Grey', yellow: 'Yellow',
          orange: 'Orange', 'dark blue': 'Blue', 'light blue': 'Blue',
        } },
      { key: 'condition', column: 'new_or_used', kind: 'enum', label: 'condition',
        vocabulary: { new: 'New', used: 'Used', secondhand: 'Used', 'second hand': 'Used' } },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'state'] },
      { key: 'make', column: 'make', label: 'make', words: ['make', 'manufacturer', 'brand'] },
      { key: 'category', column: 'category', label: 'category', words: ['category', 'type', 'kind'] },
      { key: 'location', column: 'location', label: 'location', words: ['location', 'depot', 'site', 'yard'] },
      { key: 'customer', column: 'customer', label: 'customer', words: ['customer', 'client', 'buyer'] },
      { key: 'rep', column: 'sales_rep', label: 'rep', words: ['rep', 'salesman', 'seller', 'who'] },
    ],
    // Some words name the thing and narrow it at once. "Box" is a trailer
    // and a body type, and the rule that stops an entity noun being read
    // as a filter meant "how many boxes" counted everything.
    nounImpliesFilter: {
      box: { column: 'category', value: 'Box', label: 'category box' },
      boxes: { column: 'category', value: 'Box', label: 'category box' },
    },
    hrefFor: (r) => `/dashboard/sales?stock=${r.id}`,
  },
  {
    id: 'deals',
    table: 'crm_contacts',
    label: 'proposals', labelOne: 'proposal',
    nouns: ['deal', 'deals', 'proposal', 'proposals', 'quote', 'quotes', 'opportunity',
            'opportunities', 'lead', 'leads', 'enquiry', 'enquiries', 'pipeline'],
    titleColumn: 'company_name',
    subtitleColumns: ['contact_name', 'status', 'location'],
    dateColumn: 'date_of_enquiry',
    dates: [
      { key: 'enquiry', column: 'date_of_enquiry', label: 'enquiry date',
        words: ['enquired', 'enquiry', 'came in', 'raised', 'opened'] },
      { key: 'contact', column: 'last_contact', label: 'last contact',
        words: ['contacted', 'spoke', 'spoken', 'touched', 'heard from', 'chased'] },
      { key: 'ordered', column: 'order_date', label: 'order date', words: ['ordered', 'placed'] },
      { key: 'dispatched', column: 'dispatch_date', label: 'date out',
        words: ['dispatched', 'delivered', 'went out'] },
    ],
    scope: 'mine',
    amounts: [
      { key: 'estimated', column: 'estimated_value', label: 'estimated value', words: ['worth', 'value', 'pipeline', 'estimated'] },
      { key: 'sale', column: 'sale_price', label: 'sale price', words: ['revenue', 'sales', 'sold for', 'turnover', 'invoiced'] },
      { key: 'profit', column: 'profit', label: 'profit', words: ['profit', 'margin'] },
      { key: 'commission', column: 'commission', label: 'commission', words: ['commission', 'earned', 'earnings'] },
    ],
    filters: [
      { key: 'status', column: 'status', kind: 'enum', label: 'status', vocabulary: DEAL_STATUS },
      { key: 'side', column: 'side', kind: 'enum', label: 'side',
        vocabulary: { maintenance: 'maintenance', service: 'maintenance', workshop: 'maintenance',
                      sales: 'trailer_sales', 'trailer sales': 'trailer_sales' } },
      { key: 'customer', column: 'company_name', kind: 'text', label: 'customer', freeText: true },
      { key: 'assigned', column: 'assigned_to', kind: 'text', label: 'assigned to', freeText: true },
      { key: 'location', column: 'location', kind: 'text', label: 'location', freeText: true },
      { key: 'source', column: 'source', kind: 'text', label: 'source', freeText: true },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'stage', 'state'] },
      { key: 'customer', column: 'company_name', label: 'customer', words: ['customer', 'company', 'client', 'account'] },
      { key: 'assigned', column: 'assigned_to', label: 'owner', words: ['rep', 'owner', 'who', 'assigned'] },
      { key: 'side', column: 'side', label: 'side', words: ['side', 'division'] },
      { key: 'location', column: 'location', label: 'location', words: ['location', 'area', 'region'] },
    ],
    hrefFor: (r) => `/dashboard/leads?contact=${r.id}`,
    nounImpliesFilter: {
      lead:      { column: 'status', value: 'lead',   label: 'status lead' },
      leads:     { column: 'status', value: 'lead',   label: 'status lead' },
      enquiry:   { column: 'status', value: 'lead',   label: 'status lead' },
      enquiries: { column: 'status', value: 'lead',   label: 'status lead' },
      quote:     { column: 'status', value: 'quoted', label: 'status quoted' },
      quotes:    { column: 'status', value: 'quoted', label: 'status quoted' },
    },
  },
  {
    id: 'contacts',
    table: 'crm_contacts',
    label: 'customers', labelOne: 'customer',
    nouns: ['customer', 'customers', 'contact', 'contacts', 'company', 'companies',
            'client', 'clients', 'account', 'accounts', 'prospect', 'prospects'],
    titleColumn: 'company_name',
    subtitleColumns: ['contact_name', 'email', 'phone'],
    dateColumn: 'created_at',
    dates: [
      { key: 'added', column: 'created_at', label: 'date added',
        words: ['added', 'created', 'joined', 'onboarded'] },
      { key: 'contact', column: 'last_contact', label: 'last contact',
        words: ['contacted', 'spoke', 'spoken', 'heard from', 'chased'] },
    ],
    amounts: [
      { key: 'fleet', column: 'fleet_size', label: 'fleet size', words: ['fleet', 'vehicles', 'size'] },
      { key: 'turnover', column: 'turnover', label: 'turnover', words: ['turnover'] },
      { key: 'employees', column: 'employee_count', label: 'employees', words: ['employees', 'staff', 'headcount'] },
    ],
    filters: [
      { key: 'status', column: 'status', kind: 'enum', label: 'status', vocabulary: DEAL_STATUS },
      { key: 'location', column: 'location', kind: 'text', label: 'location', freeText: true },
      { key: 'assigned', column: 'assigned_to', kind: 'text', label: 'assigned to', freeText: true },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'stage'] },
      { key: 'location', column: 'location', label: 'location', words: ['location', 'area', 'town', 'city'] },
      { key: 'assigned', column: 'assigned_to', label: 'owner', words: ['rep', 'owner', 'assigned'] },
    ],
    hrefFor: (r) => `/dashboard/crm?contact=${r.id}`,
  },
  /* The marketing side is part of the CRM too.
     "How many social posts are left to approve" used to fall through to
     the trailers entity and answer with a count of trailers, which is a
     confident wrong answer to a question about something else entirely. */
  {
    id: 'posts',
    table: 'social_posts',
    label: 'social posts', labelOne: 'social post',
    nouns: ['social post', 'social posts', 'post', 'posts', 'socials', 'content'],
    titleColumn: 'content',
    subtitleColumns: ['platform', 'scheduled_date', 'status'],
    dateColumn: 'scheduled_date',
    amounts: [],
    filters: [
      { key: 'status', column: 'status', kind: 'enum', label: 'status',
        vocabulary: {
          draft: 'draft', drafts: 'draft', unwritten: 'draft',
          'pending review': 'pending_review', 'to approve': 'pending_review',
          'for approval': 'pending_review', 'awaiting approval': 'pending_review',
          'left to approve': 'pending_review', 'need approving': 'pending_review',
          'needs approving': 'pending_review', unapproved: 'pending_review',
          outstanding: 'pending_review', pending: 'pending_review',
          approved: 'approved', signed: 'approved', 'signed off': 'approved',
          scheduled: 'scheduled', queued: 'scheduled', planned: 'scheduled',
          posted: 'posted', published: 'posted', live: 'posted', gone: 'posted',
        } },
      { key: 'author', column: 'created_by', kind: 'text', label: 'author', freeText: true },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'stage', 'state'] },
      { key: 'author', column: 'created_by', label: 'author', words: ['author', 'who', 'writer'] },
    ],
    hrefFor: () => '/dashboard/social',
  },
  {
    id: 'meetings',
    table: 'calendar_events',
    label: 'meetings', labelOne: 'meeting',
    nouns: ['meeting', 'meetings', 'call', 'calls', 'appointment', 'appointments', 'visit', 'visits', 'diary'],
    titleColumn: 'title',
    subtitleColumns: ['start_at'],
    dateColumn: 'start_at',
    amounts: [],
    filters: [
      { key: 'visibility', column: 'visibility', kind: 'enum', label: 'visibility',
        vocabulary: { private: 'private', team: 'team', shared: 'team' } },
    ],
    dimensions: [
      { key: 'visibility', column: 'visibility', label: 'visibility', words: ['visibility'] },
    ],
    hrefFor: () => '/dashboard/calendar',
  },
];

/** Words that pick which number is being asked for. */
export const MEASURE_WORDS: { measure: Measure; words: string[] }[] = [
  { measure: 'count', words: ['how many', 'count', 'number of', 'how much stock', 'total number'] },
  /* "took" and "taken" are not here. They were, and "deposit taken" is a
     status phrase on a trailer, so every sentence containing it came
     back as a sum instead of a list. The generated sweep found 654 of
     them. "Took in" and "taken in" carry the money sense without
     colliding. */
  { measure: 'sum',   words: ['how much', 'total', 'worth', 'value of', 'sum', 'revenue',
                             'turnover', 'turn over', 'turned over', 'took in', 'taken in',
                             'billed'] },
  { measure: 'avg',   words: ['average', 'avg', 'mean', 'typical'] },
  { measure: 'list',  words: ['list', 'show', 'which', 'what are', 'find', 'give me'] },
];

export function entityByNoun(word: string): EntitySpec | undefined {
  const w = word.toLowerCase();
  return ENTITIES.find((e) => e.nouns.includes(w));
}
