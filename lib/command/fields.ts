/* =============================================================
   Fields the command bar is allowed to write.

   Until now the bar could go somewhere, count something and export
   something. It could not change anything, which meant a perfectly
   ordinary instruction like "add £1k refurb value to STC143980" did
   nothing at all. Typing an instruction and getting a count back is the
   worst kind of failure: it looks like it worked.

   So this is the writable half of the dictionary. Every entry names a
   column, what kind of value it holds, the words people use for it, and
   the capability somebody needs before it is even offered. The parser in
   mutate.ts reads nothing but this, so a field added here is typeable
   the same day, in every phrasing the alias list covers.

   Two things are deliberately absent.

   No id columns, no created_at, no derived numbers. A total that is the
   sum of two other columns is not a thing to type at, and letting
   somebody set it by hand only makes the two disagree.

   No status on a trailer that has been sold. Undoing a sale unpicks a
   commission line on somebody's tracker, so it keeps its existing
   warning path on the stock list rather than gaining a quiet one here.
   ============================================================= */
import type { CrmCapability } from '@/lib/crm/permissions';
import { BODY_TYPES } from './lexicon';
import { TABLES, derivedAliases, type ColumnKind } from './columns';

export type FieldKind = 'money' | 'number' | 'text' | 'longtext' | 'date' | 'enum';

export type WritableEntity = 'trailers' | 'contacts' | 'posts' | 'meetings';

export type WritableField = {
  /** The column, exactly as the table spells it. */
  key: string;
  label: string;
  kind: FieldKind;
  entity: WritableEntity;
  /** What people call it. Longest match wins, so order does not matter. */
  aliases: string[];
  /** For enums: the words somebody types, mapped to what gets stored. */
  vocabulary?: Record<string, string>;
  capability: CrmCapability;
  /**
   * Can you add to it rather than replace it? True for money and
   * numbers, and for long text where "add a note" means append rather
   * than overwrite what is already there.
   */
  arithmetic?: boolean;
  /** Shown under the confirmation when the change deserves a word. */
  caution?: string;
};

/** Stock statuses, as words rather than as the stored value. */
const STOCK_STATUS: Record<string, string> = {
  'in stock': 'in_stock', instock: 'in_stock', available: 'in_stock', stock: 'in_stock',
  'new build': 'new_build', newbuild: 'new_build', build: 'new_build',
  'sales order': 'sales_order', ordered: 'sales_order', order: 'sales_order', reserved: 'sales_order',
  rental: 'rental', rented: 'rental', hire: 'rental', 'on hire': 'rental',
  scrap: 'scrap', scrapped: 'scrap', 'written off': 'scrap',
  /* Sold is here so the sentence is understood, not so the column is
     written. mutate.ts turns it into a handoff to the sales tracker,
     which is where the price and the commission line belong. Leaving it
     out meant "mark STC143580 as sold" was not recognised at all. */
  sold: 'sold', gone: 'sold', 'sold it': 'sold', sell: 'sold', 'sell it': 'sold',
};

const POST_STATUS: Record<string, string> = {
  draft: 'draft', drafts: 'draft',
  'pending review': 'pending_review', 'for approval': 'pending_review',
  'awaiting approval': 'pending_review', unapproved: 'pending_review',
  /* The words people actually use for the pile waiting on somebody.
     "Mark all outstanding social posts as approved" needs "outstanding"
     to mean something, or the instruction has no subset and is refused. */
  outstanding: 'pending_review', pending: 'pending_review',
  'to approve': 'pending_review', 'left to approve': 'pending_review',
  'needs approving': 'pending_review', 'need approving': 'pending_review',
  unreviewed: 'pending_review', 'not approved': 'pending_review',
  approved: 'approved', 'signed off': 'approved', ok: 'approved',
  approve: 'approved', approving: 'approved', 'sign off': 'approved',
  scheduled: 'scheduled', queued: 'scheduled',
  posted: 'posted', published: 'posted', live: 'posted',
};

const DEAL_STATUS: Record<string, string> = {
  lead: 'lead', enquiry: 'lead', new: 'lead',
  contacted: 'contacted', approached: 'contacted',
  quoted: 'quoted', quote: 'quoted', proposal: 'quoted',
  won: 'won', win: 'won', closed: 'won',
  customer: 'customer', converted: 'customer',
  lost: 'lost', dead: 'lost', lapsed: 'lost',
};

const YES_NO: Record<string, string> = {
  yes: 'Yes', y: 'Yes', done: 'Yes', received: 'Yes', paid: 'Yes', in: 'Yes', true: 'Yes',
  no: 'No', n: 'No', not: 'No', outstanding: 'No', pending: 'No', false: 'No',
};

/* -------------------------------------------------------------
   Trailers.
   ------------------------------------------------------------- */
export const TRAILER_FIELDS: WritableField[] = [
  { key: 'refurb_costs', label: 'Refurb cost', kind: 'money', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    aliases: ['refurb cost', 'refurb costs', 'refurb value', 'refurb spend', 'refurbishment cost',
              'refurbishment', 'rectification cost', 'rectification', 'prep cost', 'prep costs',
              'prep', 'refurb'] },
  { key: 'refurb_costs_at_sale', label: 'Refurb at sale', kind: 'money', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    aliases: ['refurb at sale', 'refurb cost at sale', 'refurb costs at sale', 'sale refurb',
              'refurb on sale', 'post sale refurb'] },
  { key: 'nbv', label: 'Book value', kind: 'money', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    aliases: ['nbv', 'net book value', 'book value', 'book price', 'cost price', 'cost'] },
  { key: 'sales_price', label: 'Sale price', kind: 'money', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    /* Not "sold price": new builds carry a separate sold_price column
       and this one is the sale price on everything else. */
    aliases: ['sale price', 'sales price', 'sold for', 'selling price', 'invoice value'] },
  { key: 'retail_price', label: 'Retail price', kind: 'money', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    aliases: ['retail price', 'retail', 'list price', 'asking price', 'advertised price', 'ticket price'] },
  { key: 'location', label: 'Location', kind: 'text', entity: 'trailers',
    capability: 'stock.edit',
    aliases: ['location', 'depot', 'site', 'yard', 'where it is', 'parked at', 'stored at', 'based at'] },
  { key: 'status', label: 'Status', kind: 'enum', entity: 'trailers', vocabulary: STOCK_STATUS,
    capability: 'stock.edit',
    aliases: ['status', 'state', 'stage'],
    caution: 'Marking a trailer sold goes through the sales tracker, so the commission line is raised with it.' },
  { key: 'category', label: 'Category', kind: 'enum', entity: 'trailers', vocabulary: BODY_TYPES,
    capability: 'stock.edit',
    aliases: ['category', 'body type', 'body', 'trailer type', 'type'] },
  { key: 'make', label: 'Make', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['make', 'manufacturer', 'brand', 'built by'] },
  { key: 'model', label: 'Model', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['model', 'spec'] },
  { key: 'year', label: 'Year', kind: 'number', entity: 'trailers',
    capability: 'stock.edit', aliases: ['year', 'year of manufacture', 'build year', 'age'] },
  { key: 'colour', label: 'Colour', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['colour', 'color', 'paint'] },
  { key: 'chassis_number', label: 'Chassis number', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['chassis number', 'chassis no', 'chassis', 'vin'] },
  /* A unit arrives on chassis and gets its stock number later, so this
     is written against a record found by chassis rather than by the
     number being set. mutate.ts knows to read the STC reference as the
     value here rather than as the record. */
  { key: 'stc_no', label: 'Stock number', kind: 'text', entity: 'trailers',
    capability: 'stock.edit',
    aliases: ['stock number', 'stock no', 'stc number', 'stc no', 'stocknumber', 'unit number'] },
  { key: 'ministry_no', label: 'Ministry number', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['ministry number', 'ministry no', 'ministry'] },
  { key: 'mot_date', label: 'MOT', kind: 'date', entity: 'trailers',
    capability: 'stock.edit',
    aliases: ['mot', 'mot date', 'mot expiry', 'mot due', 'test date', 'plating'] },
  { key: 'customer', label: 'Customer', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['customer', 'buyer', 'client', 'sold to', 'going to'] },
  { key: 'sales_rep', label: 'Sales rep', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['rep', 'sales rep', 'salesman', 'seller', 'handled by'] },
  { key: 'supplier', label: 'Supplier', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['supplier', 'bought from', 'came from', 'source'] },
  { key: 'door_type', label: 'Door type', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['door type', 'doors', 'door'] },
  { key: 'axle_type', label: 'Axle type', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['axle type', 'axles', 'axle', 'running gear'] },
  { key: 'side_aperture', label: 'Side aperture', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['side aperture', 'aperture', 'internal height', 'side height'] },
  { key: 'tread_depths', label: 'Tread depths', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['tread depths', 'tread depth', 'tread', 'tyres', 'tyre depths'] },
  { key: 'new_or_used', label: 'New or used', kind: 'enum', entity: 'trailers',
    capability: 'stock.edit', aliases: ['new or used', 'condition'],
    vocabulary: { new: 'New', used: 'Used', secondhand: 'Used', 'second hand': 'Used' } },
  { key: 'order_date', label: 'Order date', kind: 'date', entity: 'trailers',
    capability: 'stock.edit', aliases: ['order date', 'ordered on', 'date ordered'] },
  { key: 'dispatch_date', label: 'Dispatch date', kind: 'date', entity: 'trailers',
    capability: 'stock.edit',
    aliases: ['dispatch date', 'despatch date', 'dispatched on', 'delivery date', 'delivered on'] },
  { key: 'expected_delivery', label: 'Expected delivery', kind: 'date', entity: 'trailers',
    capability: 'stock.edit', aliases: ['expected delivery', 'due date', 'eta', 'expected'] },
  { key: 'deposit_received', label: 'Deposit received', kind: 'enum', entity: 'trailers',
    capability: 'stock.edit', vocabulary: YES_NO, aliases: ['deposit received', 'deposit'] },
  { key: 'paid_in_full', label: 'Paid in full', kind: 'enum', entity: 'trailers',
    capability: 'stock.edit', vocabulary: YES_NO,
    aliases: ['paid in full', 'paid in', 'fully paid', 'payment'] },
  { key: 'signed_order', label: 'Signed order', kind: 'enum', entity: 'trailers',
    capability: 'stock.edit', vocabulary: YES_NO, aliases: ['signed order', 'signed'] },
  { key: 'quote_no', label: 'Quote number', kind: 'text', entity: 'trailers',
    capability: 'stock.edit', aliases: ['quote number', 'quote no', 'quote ref', 'quote'] },
  { key: 'description', label: 'Description', kind: 'longtext', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit', aliases: ['description', 'spec description', 'details', 'write up'] },
  { key: 'refurb_update', label: 'Refurb update', kind: 'longtext', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit',
    aliases: ['refurb update', 'refurb progress', 'refurb note', 'refurb notes'] },
  { key: 'refurb_done', label: 'Refurb done', kind: 'longtext', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit', aliases: ['refurb done', 'work done', 'refurb completed'] },
  /* Not "comment" or "comments": stock_trailers has a comments column of
     its own, and the curated alias was quietly stealing it, so the real
     column could not be written at all. */
  { key: 'notes', label: 'Notes', kind: 'longtext', entity: 'trailers', arithmetic: true,
    capability: 'stock.edit', aliases: ['note', 'notes', 'remark', 'general notes'] },
];

/* -------------------------------------------------------------
   Customers and the deals against them. One table, so one list.
   ------------------------------------------------------------- */
export const CONTACT_FIELDS: WritableField[] = [
  { key: 'status', label: 'Status', kind: 'enum', entity: 'contacts', vocabulary: DEAL_STATUS,
    capability: 'crm.edit', aliases: ['status', 'stage', 'state'] },
  { key: 'assigned_to', label: 'Owner', kind: 'text', entity: 'contacts',
    capability: 'crm.assign',
    /* Not "account manager": that is its own column on the maintenance
       side and this one is the CRM owner. Two different people, often. */
    aliases: ['owner', 'assigned to', 'assigned', 'rep', 'handler', 'looked after by'] },
  { key: 'contact_name', label: 'Contact name', kind: 'text', entity: 'contacts',
    capability: 'crm.edit', aliases: ['contact name', 'contact', 'name', 'who to ask for'] },
  { key: 'email', label: 'Email', kind: 'text', entity: 'contacts',
    capability: 'crm.edit', aliases: ['email', 'email address', 'e mail'] },
  /* "number" is not one of these. It used to be, and "add stock number
     STC150001 to C734105" was filed as a phone number, on the wrong
     record, with a chassis number for a value. An alias that vague
     claims every sentence with a digit in it. */
  { key: 'phone', label: 'Phone', kind: 'text', entity: 'contacts',
    capability: 'crm.edit',
    aliases: ['phone', 'phone number', 'telephone', 'telephone number', 'mobile',
              'mobile number', 'landline', 'tel', 'contact number'] },
  { key: 'location', label: 'Location', kind: 'text', entity: 'contacts',
    capability: 'crm.edit', aliases: ['location', 'town', 'city', 'area', 'region', 'based in'] },
  { key: 'address', label: 'Address', kind: 'text', entity: 'contacts',
    capability: 'crm.edit', aliases: ['address', 'postal address', 'street'] },
  { key: 'fleet_size', label: 'Fleet size', kind: 'number', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['fleet size', 'fleet'] },
  { key: 'trucks', label: 'Trucks', kind: 'number', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['trucks', 'tractor units', 'units'] },
  { key: 'trailers', label: 'Trailers', kind: 'number', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['trailers on fleet', 'their trailers', 'trailer count'] },
  { key: 'vans', label: 'Vans', kind: 'number', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['vans'] },
  { key: 'employee_count', label: 'Employees', kind: 'number', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['employees', 'headcount', 'staff', 'employee count'] },
  { key: 'turnover', label: 'Turnover', kind: 'money', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['turnover', 'annual turnover', 'revenue'] },
  { key: 'estimated_value', label: 'Estimated value', kind: 'money', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit',
    aliases: ['estimated value', 'deal value', 'opportunity value', 'pipeline value', 'estimate', 'worth'] },
  { key: 'sale_price', label: 'Sale price', kind: 'money', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['sale price', 'sold for', 'invoiced', 'invoice value'] },
  { key: 'commission_rate', label: 'Commission rate', kind: 'number', entity: 'contacts',
    capability: 'crm.edit', aliases: ['commission rate', 'commission percentage', 'comm rate'] },
  { key: 'next_action', label: 'Next action', kind: 'text', entity: 'contacts',
    capability: 'crm.edit',
    /* Not the bare "action": crm_contacts has an action column beside
       this one, and taking the word here made that column unreachable. */
    aliases: ['next action', 'next step', 'follow up', 'to do', 'chase'] },
  { key: 'last_contact', label: 'Last contact', kind: 'date', entity: 'contacts',
    capability: 'crm.edit',
    aliases: ['last contact', 'last contacted', 'last spoke', 'last called', 'contacted on'] },
  { key: 'date_of_enquiry', label: 'Enquiry date', kind: 'date', entity: 'contacts',
    capability: 'crm.edit', aliases: ['enquiry date', 'date of enquiry', 'enquired on', 'came in on'] },
  { key: 'order_date', label: 'Order date', kind: 'date', entity: 'contacts',
    capability: 'crm.edit', aliases: ['order date', 'ordered on'] },
  { key: 'source', label: 'Source', kind: 'text', entity: 'contacts',
    capability: 'crm.edit', aliases: ['source', 'came from', 'lead source', 'found via'] },
  { key: 'side', label: 'Side', kind: 'enum', entity: 'contacts',
    capability: 'crm.edit', aliases: ['side', 'division', 'part of the business'],
    vocabulary: { sales: 'trailer_sales', 'trailer sales': 'trailer_sales',
                  maintenance: 'maintenance', service: 'maintenance', workshop: 'maintenance' } },
  { key: 'relationship', label: 'Relationship', kind: 'enum', entity: 'contacts',
    capability: 'crm.edit', aliases: ['relationship', 'prospect or customer', 'existing customer'],
    vocabulary: { prospect: 'prospect', new: 'prospect', existing: 'existing', current: 'existing' } },
  { key: 'requirement', label: 'Requirement', kind: 'longtext', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['requirement', 'what they want', 'their requirement', 'looking for'] },
  { key: 'notes', label: 'Notes', kind: 'longtext', entity: 'contacts', arithmetic: true,
    capability: 'crm.edit', aliases: ['note', 'notes', 'remark', 'latest update'] },
];

/* -------------------------------------------------------------
   Social posts.

   Here because approving is an instruction people give in bulk and by
   voice: "mark all outstanding social posts as approved". Approving is
   its own capability, so somebody who writes posts cannot wave their
   own through.
   ------------------------------------------------------------- */
export const POST_FIELDS: WritableField[] = [
  { key: 'status', label: 'Status', kind: 'enum', entity: 'posts', vocabulary: POST_STATUS,
    capability: 'marketing.approve',
    aliases: ['post status', 'social status', 'approval', 'status'] },
  { key: 'scheduled_date', label: 'Scheduled date', kind: 'date', entity: 'posts',
    capability: 'marketing.edit',
    aliases: ['scheduled date', 'schedule date', 'post date', 'publish date', 'going out on'] },
  { key: 'caption', label: 'Caption', kind: 'longtext', entity: 'posts', arithmetic: true,
    capability: 'marketing.edit', aliases: ['caption', 'post caption'] },
];



/* =============================================================
   The tail: every remaining column, so nothing is unreachable.

   The lists above are hand written, and hand written is right for the
   columns people talk about: `refurb_costs_at_sale` is "refurb at sale"
   in the yard and no amount of string manipulation gets there.

   Hand written is wrong as the ONLY mechanism, because it covers
   whatever somebody remembered. That is how the bar shipped with no
   social posts in it at all. So every writable column in columns.ts that
   nothing above claims gets an entry generated from its own name.

   The derived words are worse. They are not nothing, which is what was
   there before, and the completeness check can now ask a question it
   could not ask before: is there a column in this database that cannot
   be written by typing?
   ============================================================= */

/** Which table belongs to which of the writable entities. */
const ENTITY_TABLE: Record<WritableEntity, string> = {
  trailers: 'stock_trailers',
  contacts: 'crm_contacts',
  posts: 'social_posts',
  meetings: 'calendar_events',
};

/** What somebody needs before a column on that table is offered. */
const TABLE_CAPABILITY: Record<string, CrmCapability> = {
  stock_trailers: 'stock.edit',
  crm_contacts: 'crm.edit',
  social_posts: 'marketing.edit',
  calendar_events: 'crm.delegate',
};

/** The word that qualifies a column when its plain name is taken. */
const ENTITY_WORD: Record<WritableEntity, string> = {
  trailers: 'trailer', contacts: 'customer', posts: 'post', meetings: 'event',
};

function kindOf(k: ColumnKind): FieldKind {
  switch (k) {
    case 'money': return 'money';
    case 'number': return 'number';
    case 'date': return 'date';
    case 'longtext': return 'longtext';
    case 'enum': return 'enum';
    case 'bool': return 'enum';
    default: return 'text';
  }
}

function titleCase(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * One entry per writable column nothing above already claims.
 *
 * Only for the four tables the edit route can actually write. A field
 * offered for a table with no route behind it would appear and then
 * refuse, which is the thing this whole file exists to prevent.
 */
function generateTail(): WritableField[] {
  const curated = new Set(
    [...TRAILER_FIELDS, ...CONTACT_FIELDS, ...POST_FIELDS].map((f) => `${f.entity}.${f.key}`),
  );
  const out: WritableField[] = [];

  for (const [entity, table] of Object.entries(ENTITY_TABLE) as [WritableEntity, string][]) {
    const spec = TABLES.find((t) => t.table === table);
    const capability = TABLE_CAPABILITY[table];
    if (!spec || !capability) continue;

    for (const col of spec.columns) {
      if (col.writable === false) continue;
      if (curated.has(`${entity}.${col.name}`)) continue;

      const kind = kindOf(col.kind);
      const vocabulary = col.values?.length
        ? Object.fromEntries(col.values.map((v) => [v.toLowerCase().replace(/_/g, ' '), v]))
        : col.kind === 'bool'
          ? { yes: 'true', no: 'false', true: 'true', false: 'false' }
          : undefined;

      /* A derived alias must never collide with a curated one, or the
         longest-match rule hands the sentence to whichever was listed
         first and the generated column becomes unreachable. Where the
         plain words are taken, the column is qualified by what it is on:
         "event colour" rather than "colour". */
      /* Across every entity, not just this one. findField scans the
         whole dictionary, so "color" on a meeting collided with "colour"
         on a trailer and the meeting column was unreachable. */
      const taken = new Set([
        ...[...TRAILER_FIELDS, ...CONTACT_FIELDS, ...POST_FIELDS].flatMap((f) => f.aliases),
        ...out.flatMap((f) => f.aliases),
      ]);
      const derived = derivedAliases(col.name);
      const free = derived.filter((a) => !taken.has(a));
      const aliases = free.length
        ? free
        : derived.map((a) => `${ENTITY_WORD[entity]} ${a}`);

      out.push({
        key: col.name,
        label: titleCase(col.name),
        kind: vocabulary ? 'enum' : kind,
        entity,
        aliases,
        vocabulary,
        capability,
        arithmetic: kind === 'money' || kind === 'number' || kind === 'longtext',
      });
    }
  }
  return out;
}

export const GENERATED_FIELDS: WritableField[] = generateTail();

export const WRITABLE_FIELDS: WritableField[] = [
  ...TRAILER_FIELDS, ...CONTACT_FIELDS, ...POST_FIELDS, ...GENERATED_FIELDS,
];

/** Every field this person is allowed to write, for the checks and the empty state. */
export function writableFor(caps: Set<CrmCapability>): WritableField[] {
  return WRITABLE_FIELDS.filter((f) => caps.has(f.capability));
}
