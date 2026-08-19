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
   * When a sale happened, for entities that have sales.
   *
   * Two columns and a rule rather than one column, because that is what
   * the business means: the date it went out, or the date it was
   * ordered when it has not gone out yet. Declared once here so nothing
   * downstream has to choose, and absent on entities where a sale is
   * not a thing that happens.
   */
  saleDate?: { primary: string; fallback: string };
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
    /* WHEN A SALE HAPPENED, SAID ONCE.

       The sales tracker has always read it as `dispatch_date ||
       order_date`: a unit that has gone out is dated by when it went,
       and one that is sold and not yet dispatched is dated by when it
       was ordered. Anything reading only `dispatch_date` misses every
       sale still waiting to go out, which at any moment is most of the
       recent ones.

       Declared here so the question reader, the exporter and any
       commission figure consume the same meaning instead of each
       choosing a column. */
    saleDate: { primary: 'dispatch_date', fallback: 'order_date' },
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
      /* Refurb is money the business talks about constantly and it was
         not here, so "trailers with refurb over £2k" put the £2k on the
         sale price and read the word "refurb" as a customer's name. */
      { key: 'refurb', column: 'refurb_costs', label: 'refurb cost',
        words: ['refurb', 'refurb cost', 'refurb costs', 'refurbishment', 'rework'] },
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
    /* A PITCH, WHICH IS A DIFFERENT QUESTION FROM A CUSTOMER.

       This entity has always existed and always read `crm_contacts`,
       because a deal and a company were the same row. "How many
       customers are in Carrington" counts companies and "how many
       leads has Dave got open" counts pitches, and while both came off
       one table the two questions shared an answer that was wrong for
       one of them. Migration 040 gave a pitch its own table and this
       reads it. */
    id: 'deals',
    table: 'crm_leads',
    label: 'leads', labelOne: 'lead',
    nouns: ['deal', 'deals', 'proposal', 'proposals', 'quote', 'quotes', 'opportunity',
            'opportunities', 'lead', 'leads', 'enquiry', 'enquiries', 'pipeline'],
    titleColumn: 'what',
    subtitleColumns: ['requirement', 'status', 'action'],
    dateColumn: 'date_of_enquiry',
    /* The same rule on the tracker side, where the commission lives. */
    saleDate: { primary: 'dispatch_date', fallback: 'order_date' },
    dates: [
      { key: 'enquiry', column: 'date_of_enquiry', label: 'enquiry date',
        words: ['enquired', 'enquiry', 'came in', 'raised', 'opened'] },
      { key: 'moved', column: 'last_activity_at', label: 'last touched',
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
      /* Three kinds of work rather than two sides of the business.
         Rental is here from the start: the type is a value on the lead
         now, not a column that has to be widened to hold a third. */
      { key: 'type', column: 'type', kind: 'enum', label: 'kind of work',
        vocabulary: { maintenance: 'maintenance', service: 'maintenance', workshop: 'maintenance',
                      sales: 'trailer_sales', 'trailer sales': 'trailer_sales',
                      rental: 'rental', leasing: 'rental', hire: 'rental',
                      'contract hire': 'rental' } },
      { key: 'what', column: 'what', kind: 'text', label: 'what for', freeText: true },
      { key: 'requirement', column: 'requirement', kind: 'text', label: 'requirement', freeText: true },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'stage', 'state'] },
      { key: 'type', column: 'type', label: 'kind of work',
        words: ['side', 'division', 'kind', 'type', 'work'] },
      { key: 'what', column: 'what', label: 'what for', words: ['what'] },
    ],
    hrefFor: (r) => `/dashboard/leads?lead=${r.id}`,
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
      { key: 'fleet', column: 'fleet_size', label: 'fleet size', words: ['fleet', 'fleet size', 'vehicles'] },
      { key: 'turnover', column: 'turnover', label: 'turnover', words: ['turnover'] },
      { key: 'employees', column: 'employee_count', label: 'employees', words: ['employees', 'staff', 'headcount'] },
      /* A customer's own vehicles, counted by type. These are numbers on
         a CRM record, not vehicles this business stocks: "customers with
         more than 20 trucks" is a fleet question and there is no truck
         anywhere in the stock list. */
      { key: 'their_trucks', column: 'trucks', label: 'their trucks', words: ['trucks', 'tractor units'] },
      /* On a customer, "trailers" is a count of the ones THEY run. The
         word also names the stock list, so it only reaches this column
         once the sentence has already resolved to a customer. */
      { key: 'their_trailers', column: 'trailers', label: 'their trailers',
        words: ['their trailers', 'trailers on their fleet', 'trailers on fleet', 'trailers'] },
      { key: 'their_vans', column: 'vans', label: 'their vans', words: ['vans'] },
    ],
    filters: [
      { key: 'status', column: 'status', kind: 'enum', label: 'status', vocabulary: DEAL_STATUS },
      /* THE CUSTOMER'S OWN NAME.
         The tracker reading of this table has had one all along and the
         CRM reading had not, so "find Dawson Group" resolved to a list
         of every customer: the sentence named a record and the answer
         was everybody. It is also what makes a company name in the live
         vocabulary able to name the entity on its own. */
      { key: 'customer', column: 'company_name', kind: 'text', label: 'customer', freeText: true },
      { key: 'contact', column: 'contact_name', kind: 'text', label: 'contact', freeText: true },
      { key: 'location', column: 'location', kind: 'text', label: 'location', freeText: true },
      { key: 'assigned', column: 'assigned_to', kind: 'text', label: 'assigned to', freeText: true },
    ],
    dimensions: [
      { key: 'status', column: 'status', label: 'status', words: ['status', 'stage'] },
      { key: 'customer', column: 'company_name', label: 'customer',
        words: ['customer', 'company', 'client', 'account'] },
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
    /* THE BRAND KIT IS A TABLE, AND IT WAS ANSWERED BY A SCREEN.

       `brand_assets` holds the logos, the fonts and the colours, and a
       colour's hex is its `url`. "What is our navy hex" is a question
       about a row, and the only answer it had was an action that opened
       the brand kit and left somebody to find it and select it. */
    id: 'brand',
    table: 'brand_assets',
    label: 'brand assets', labelOne: 'brand asset',
    /* Deliberately qualified. "Colour" on its own is a column on a
       trailer and "logo" is not, so the unqualified words are the ones
       that could only mean this. */
    nouns: ['brand asset', 'brand assets', 'brand colour', 'brand colours',
            'brand color', 'brand colors', 'brand hex', 'brand kit',
            'logo', 'logos', 'brand font', 'brand fonts',
            /* A hex is a hex. Nothing else in this application calls
               anything one, so the word can stand on its own where
               "colour" cannot. */
            'hex', 'hexes', 'hex code', 'hex codes', 'colour code', 'color code'],
    titleColumn: 'name',
    subtitleColumns: ['type', 'category', 'url'],
    dateColumn: 'created_at',
    amounts: [],
    filters: [
      /* QUALIFIED WORDS ONLY.

         "Colour" and "hex" on their own belong to a trailer: "what
         colour is STC143580" is a question about a unit, and a bare
         `colour` here made it a question about the brand kit. Every key
         is a phrase that could only mean this table. */
      { key: 'type', column: 'type', kind: 'enum', label: 'type',
        vocabulary: {
          logo: 'logo', logos: 'logo', emblem: 'logo', emblems: 'logo',
          'brand font': 'font', 'brand fonts': 'font', typeface: 'font',
          typefaces: 'font',
          'brand colour': 'color', 'brand colours': 'color',
          'brand color': 'color', 'brand colors': 'color',
          'brand hex': 'color', swatch: 'color', swatches: 'color',
          template: 'template', templates: 'template',
        } },
      { key: 'name', column: 'name', kind: 'text', label: 'name', freeText: true },
      { key: 'category', column: 'category', kind: 'text', label: 'category', freeText: true },
    ],
    dimensions: [
      { key: 'type', column: 'type', label: 'type', words: ['type', 'kind'] },
      { key: 'category', column: 'category', label: 'category', words: ['category', 'group'] },
    ],
    hrefFor: () => '/dashboard/brand',
  },
  {
    /* WHAT THE MONTH IS SUPPOSED TO BRING IN.
       `revenue_targets` was reachable by one hand written intent that
       computed a gap in a route and by nothing else, so nobody could
       ask what the target actually was. It is an ordinary table with a
       month and an amount on it, and it is answered like one. */
    id: 'targets',
    table: 'revenue_targets',
    label: 'targets', labelOne: 'target',
    nouns: ['target', 'targets', 'budget', 'budgets', 'quota', 'quotas'],
    titleColumn: 'period_month',
    subtitleColumns: ['target_amount'],
    dateColumn: 'period_month',
    amounts: [
      { key: 'target', column: 'target_amount', label: 'target',
        words: ['target', 'budget', 'quota', 'goal'] },
    ],
    filters: [],
    dimensions: [
      { key: 'month', column: 'period_month', label: 'month', words: ['month', 'period'] },
    ],
    hrefFor: () => '/dashboard/analytics',
  },
  {
    id: 'meetings',
    table: 'calendar_events',
    label: 'meetings', labelOne: 'meeting',
    /* An invitation is a meeting seen from the other side. "Suggest
       Friday at 2pm instead for this invitation" is about the same row
       as "for this meeting", and without the word the sentence pointed
       at nothing. */
    nouns: ['meeting', 'meetings', 'call', 'calls', 'appointment', 'appointments',
            'visit', 'visits', 'site visit', 'site visits', 'diary',
            'invitation', 'invitations', 'invite', 'invites'],
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
  {
    /* THE PEOPLE WHO USE THIS.
       Addressable because a sentence can now change what one of them is
       allowed to do, and a result that can be operated on has to be a
       result that can be described: "change Dave to sales and export
       him to CSV" had nowhere to read the second half from. It also
       answers the ordinary questions nobody could ask before, like how
       many administrators there are. */
    id: 'people',
    table: 'profiles',
    label: 'people', labelOne: 'person',
    nouns: ['person', 'people', 'colleague', 'colleagues', 'user', 'users',
            'team member', 'team members', 'staff'],
    titleColumn: 'full_name',
    subtitleColumns: ['email', 'role'],
    dateColumn: 'created_at',
    amounts: [],
    filters: [
      { key: 'role', column: 'role', kind: 'enum', label: 'role',
        vocabulary: {
          admin: 'admin', admins: 'admin', administrator: 'admin', administrators: 'admin',
          sales: 'sales', rep: 'sales', reps: 'sales',
          marketer: 'marketer', marketers: 'marketer', marketing: 'marketer',
          viewer: 'viewer', viewers: 'viewer', 'read only': 'viewer',
        } },
    ],
    dimensions: [
      { key: 'role', column: 'role', label: 'role', words: ['role', 'roles', 'access'] },
    ],
    hrefFor: () => '/dashboard/admin',
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
