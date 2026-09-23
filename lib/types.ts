export type UserRole = 'admin' | 'marketer' | 'sales' | 'viewer';
/* ONE WON, NOT TWO.
 *
 * From the business: "when marking a sales tracker record as Won (just
 * closed) it doesn't seem to do much. Then we have a status for
 * Customer, which means won anyway. We only need 1 status, Won. This
 * then assumes the company is now a customer of ours so anywhere else
 * in the app tracking who our customers are will pick this up."
 *
 * There were two words for the same event and the application treated
 * them as a sequence: `won` at the handshake, `customer` weeks later,
 * and every figure that mattered counted the second one. So a rep who
 * marked a deal Won saw nothing move.
 *
 * Winning is now the whole of it. `crm_contacts.relationship` becomes
 * `existing` the moment any deal is won, which is what the rest of the
 * application reads to answer "are they a customer". Migration 146. */
export type ContactStatus = 'lead' | 'contacted' | 'quoted' | 'won' | 'lost';

/**
 * The three tabs of the sales tracker.
 *
 * Rental and leasing is here because a lead type is a value now. It used
 * to be `side` on the company, a column with two things it could ever
 * hold, which is why the third tab was a schema change rather than an
 * option. See migration 040.
 */
export type LeadType = 'trailer_sales' | 'maintenance' | 'rental';
export type PostStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'posted';
export type AssetType = 'logo' | 'font' | 'color' | 'template' | 'image';

export interface Profile {
  /** Their own picture, if they have uploaded one. One column since
      migration 101: `avatar_url` and `photo_url` both existed and the
      uploader wrote the one the team directory did not read. */
  photo_url?: string | null;
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  theme: 'dark' | 'light';
  created_at: string;

  /* Added to the table by migration 048, which is why every one of them
     is optional here. A database that has not had 046 to 059 run
     against it does not have these columns, and a required field would
     make every existing `as Profile` cast a lie. */
  entity_id?: string | null;
  department_id?: string | null;
  manager_id?: string | null;
  job_title?: string | null;
  is_active?: boolean;

  /** Which of the eleven roles they hold. Migration 049 added the
      column, 103 filled it with roles this company recognises, and 104
      put people on them. Optional for the same reason as the rest.

      THERE IS NO `role_template` FIELD, and that is the point. The name
      of the role lives on `role_templates`, reached by this id. A
      screen that asked for `profile.role_template` got undefined every
      time and fell back to the legacy `role` column below, which told
      everybody they were an Administrator. See the Settings page. */
  role_template_id?: string | null;

  /* ---- The rest of what somebody fills in about themselves ----

     Real columns on `profiles`, and they were missing from this type,
     which is why `SettingsPanel` was cast to `Profile & Record<string,
     unknown>` in order to read them. That cast then made every typo a
     legal read. The columns are written down instead. */
  location?: string | null;
  timezone?: string | null;
  working_hours?: string | null;
  responsibilities?: string | null;
  skills?: string[] | null;
}

export interface CrmList {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  is_global: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface CrmListMember {
  list_id: string;
  user_id: string;
  can_edit: boolean;
  added_at: string;
}

export interface CRMContact {
  id: string;
  list_id: string | null;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: ContactStatus;
  /**
   * Whether this company was already trading with STC, as opposed to
   * where a deal with them has got to. See migration 004. Optional in the
   * type because the column may not exist yet.
   */
  relationship?: 'prospect' | 'existing' | 'cash_only';
  /* Red, amber, green: where the relationship stands, as opposed to
     where a deal does. Migration 099, and `lib/crm/health.ts` for what
     the three mean. Denormalised from the open health event so the CRM
     grid can sort a dot without a join.

     Not optional, unlike `relationship` above: the column has a NOT NULL
     default, so every row has one from the moment 099 runs. */
  health: 'green' | 'amber' | 'red';
  health_reason: string | null;
  health_since: string | null;
  health_last_chased: string | null;
  employee_count: number | null;
  turnover: number | null;
  fleet_size: number | null;  // derived sum of trucks+trailers+vans (set by trigger)
  trucks: number | null;
  trailers: number | null;
  vans: number | null;
  address: string | null;
  links: { id: string; label: string; url: string; kind: 'website' | 'linkedin' | 'facebook' | 'instagram' | 'x' | 'other' }[];
  location: string | null;
  services_interested: string[];
  notes: string | null;
  assigned_to: string | null;
  last_contact: string | null;
  // Sales tracker fields (used when this contact is in a personal sales tracker list)
  parent_customer_id: string | null;   // twinned account, see migration 003
  stock_trailer_id: string | null;
  commission_rate: number | null;
  side: 'trailer_sales' | 'maintenance';
  what: string | null;
  account_manager: string | null;
  next_action: string | null;
  category: string | null;
  vehicles: string | null;
  initials: string | null;
  date_of_enquiry: string | null;
  description: string | null;
  new_or_used: string | null;
  estimated_value: number | null;
  requirement: string | null;
  action: string | null;
  order_date: string | null;
  dispatch_date: string | null;
  sale_price: number | null;
  profit: number | null;
  profit_pct: number | null;
  commission: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A pitch to a customer, sitting on somebody's tracker.
 *
 * One account can carry several at once, which is the whole point: two
 * people can be quoting the same firm for different work, and before
 * migration 040 that was only expressible by having two of the firm.
 *
 * `owner_id` is whose tracker it is on, and is not the account owner.
 * Anybody may raise a lead against any account in the CRM and hand it to
 * somebody else as they create it. `shared_with` is how one lead worked
 * by two people shows on both trackers without becoming two leads.
 */
export interface Lead {
  id: string;
  /* NULLABLE, and it has been since migration 040.

     A lead with no account is the honest way to say "I am trying to
     sell this trailer" before there is anybody to sell it to, and it is
     what a price built in a meeting produces before somebody makes the
     CRM record. This said `string`, so every reader that handled the
     null case looked like it was handling something that could not
     happen, and the one that did not handle it typechecked fine. */
  contact_id: string | null;
  /* The company's name, carried on the lead as well as on the account.

     Missing from this type entirely until now, which is why the tracker
     could print "Unknown company" over a row that had the name sitting
     right here: reading it would not have compiled. Written by
     `crm_lead_carries_its_company` from the account where there is one,
     and set directly where there is not. Never written by hand. */
  company_name: string | null;
  owner_id: string | null;
  shared_with: string[];
  type: LeadType;
  status: ContactStatus;
  what: string | null;
  requirement: string | null;
  new_or_used: string | null;
  estimated_value: number | null;
  date_of_enquiry: string | null;
  action: string | null;
  next_action: string | null;
  /** What the inactive prospect nudge reads. */
  last_activity_at: string | null;
  stock_trailer_id: string | null;
  order_date: string | null;
  dispatch_date: string | null;
  sale_price: number | null;
  profit: number | null;
  profit_pct: number | null;
  commission: number | null;
  commission_rate: number | null;
  rep_initials: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  /* ---- The hire a trailer deal actually is. Migration 153. ----

     Eight fields the business named as what a trailer deal's drawer has
     to hold before an order form can be generated off it. All nullable,
     because a deal at enquiry stage has been asked none of them, and a
     blank is a different answer from a nought. */

  /** When the equipment went on hire. Not `order_date`, which is when
      the deal was agreed: the two are often weeks apart. */
  on_hire_date: string | null;
  /** When it is expected back. An estimate, and named as one. */
  off_hire_estimate: string | null;
  term_months: number | null;
  /** The periodic rate, as opposed to `sale_price` which is the whole. */
  hire_rate: number | null;
  service_cycle: string | null;
  maintenance_cover: MaintenanceCover | null;
  /** A third party garage, where the customer sits outside our coverage. */
  vendor_id: string | null;
  /** The maintenance rate agreed with that vendor FOR THIS DEAL. Falls
      back to the vendor's own where it is not set. */
  vendor_rate: number | null;

  /** Which of our own sites the work is for. Migration 154. Empty means
      nobody has said, which is a different answer from every site. */
  depot_ids: string[];
}

/**
 * The cover levels, in the business's own words:
 *
 *   NET/NET / R&M / Full R&M + Tyres as a drop down box
 *
 * Stored as slugs so the wording can be corrected without a migration.
 * NULL is its own answer and means nobody has been asked yet.
 */
export type MaintenanceCover = 'net_net' | 'rm' | 'full_rm_tyres';

/**
 * A garage or service provider outside STC coverage.
 *
 * A table rather than four columns on the deal, because the same garage
 * covers more than one customer and an address typed onto every deal is
 * an address corrected in eleven places when they move.
 */
export interface ThirdPartyVendor {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  /** What they charge as a rule. The deal's own rate wins where set. */
  maintenance_rate: number | null;
  /** Where they cover, in their own words. */
  covers: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** The company a lead is against, carried alongside it. */
export type LeadAccount = Pick<CRMContact,
  'id' | 'company_name' | 'contact_name' | 'email' | 'phone' | 'location' | 'relationship'>;

/**
 * How a tracker row is actually read: the pitch, plus enough of the
 * company to render it without a second query.
 */
export interface LeadWithAccount extends Lead {
  account: LeadAccount | null;
}

export interface SocialPost {
  id: string;
  content: string;
  platform: string[];
  scheduled_date: string;
  status: PostStatus;
  created_by: string;
  reviewed_by: string | null;
  image_url: string | null;
  caption: string | null;
  hashtags: string[];
  created_at: string;
  updated_at: string;
}

/* `Trailer` and `TrailerStatus` were here, for `trailer_sales`.

   That table is the one `schema.sql` marks as replaced by
   `stock_trailers`, and the last thing that wrote it was
   /api/trailers/sync, which is gone. Nothing read the type and nothing
   reads the table. A shape describing a table nothing touches is a
   shape somebody will one day write code against. */

export interface BrandAsset {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  category: string;
  created_at: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string | null;
  published_date: string;
  image_url: string | null;
  author: string | null;
  created_at: string;
}

export interface CalendarEventAttendee {
  user_id?: string;       // present when picked from profiles
  name: string;
  email?: string;
}
export type CalendarVisibility = 'private' | 'team' | 'specific';

/**
 * Where somebody stands on a meeting they were asked to.
 *
 * `proposed` is the interesting one: they have suggested a different
 * time and the meeting is now waiting on whoever asked them. Either side
 * can propose, so this goes back and forth until somebody accepts.
 * See migration 006.
 */
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'proposed';

export interface CalendarInvite {
  id: string;
  event_id: string;
  user_id: string;
  invited_by: string | null;
  status: InviteStatus;
  /** The time currently on the table, when it differs from the event. */
  proposed_start_at: string | null;
  proposed_end_at: string | null;
  /** Whose answer the meeting is waiting on. Null once it is settled. */
  awaiting: string | null;
  /** How many times it has gone back and forth. */
  rounds: number;
  note: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One round of the exchange. Append only, so the entry shows its history. */
export interface CalendarInviteMessage {
  id: string;
  invite_id: string;
  actor_id: string | null;
  action: 'invited' | 'accepted' | 'declined' | 'proposed' | 'withdrawn';
  start_at: string | null;
  end_at: string | null;
  note: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  color: string;
  created_by: string | null;
  contact_id: string | null;
  attendees: CalendarEventAttendee[];
  visibility: CalendarVisibility;
  visible_to: string[];
  created_at: string;
  updated_at: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  author_id: string | null;
  author_name: string;
  text: string;
  created_at: string;
  /* A note that has been changed after it was written says so, and
     names who changed it. Rewriting attributed words silently is not
     something this application does. Migration 144. */
  edited_at?: string | null;
  edited_by?: string | null;
  /* Set when the note was added from a deal on the tracker rather than
     from the customer record itself. The note still belongs to the
     customer: this only says where somebody was standing. */
  from_lead_id?: string | null;
}

export interface ContactAddress {
  id: string;
  contact_id: string;
  label: string;
  address: string;
  city: string | null;
  is_primary: boolean;
  created_at: string;
}

/**
 * One of the sites this business works out of. Migration 154.
 *
 * The register, as opposed to `DEPOTS` below, which is the company
 * finder's map of six depots onto the cities Lusha actually indexes and
 * does not include Carrington. Those two answer different questions and
 * the table is the one a deal points at.
 */
export interface Depot {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export const DEPOTS = [
  // Lusha rejects postcode/radius fields on its prospecting search filter.
  // Each depot maps to the major metropolitan city Lusha actually indexes.
  { name: 'Bredbury',   lushaCity: 'Manchester', lat: 53.4225, lng: -2.1289 },
  { name: 'Hyde',       lushaCity: 'Manchester', lat: 53.4500, lng: -2.0747 },
  { name: 'Dukinfield', lushaCity: 'Manchester', lat: 53.4783, lng: -2.0833 },
  { name: 'Haydock',    lushaCity: 'Liverpool',  lat: 53.4731, lng: -2.6519 },
  { name: 'Birkenhead', lushaCity: 'Liverpool',  lat: 53.3934, lng: -3.0150 },
  { name: 'Atherton',   lushaCity: 'Manchester', lat: 53.5219, lng: -2.4925 },
] as const;

export interface NewsSource {
  id: string;
  name: string;
  backdrop_url: string | null;
  updated_at: string;
}

export interface MaintAccount {
  id: string;
  owner_id: string;
  date_of_update: string | null;
  status: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  services: string | null;
  vehicles: string | null;
  requirements: string | null;
  update_log: string | null;
  next_action: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export type StockStatus = 'new_build' | 'in_stock' | 'sales_order' | 'sold' | 'rental' | 'scrap';
export interface StockTrailer {
  id: string;
  status: StockStatus;
  category: string | null;
  stc_no: string | null;
  supplier: string | null;
  trade_in: boolean | null;
  chassis_number: string | null;
  ministry_no: string | null;
  supplier_no: string | null;
  received_date: string | null;
  paid_status: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  side_aperture: string | null;
  colour: string | null;
  description: string | null;
  door_type: string | null;
  mot_date: string | null;
  axle_type: string | null;
  location: string | null;
  status_text: string | null;
  sales_rep: string | null;
  nbv: number | null;
  refurb_costs: number | null;
  refurb_costs_at_sale: number | null;
  total_nbv: number | null;
  new_or_used: string | null;
  customer: string | null;
  order_date: string | null;
  dispatch_date: string | null;
  month: string | null;
  sales_price: number | null;
  profit: number | null;
  profit_pct: number | null;
  trailer_docs: string | null;
  signed_order: string | null;
  deposit_received: string | null;
  paid_in_full: string | null;
  refurb_update: string | null;
  refurb_done: string | null;
  tread_depths: string | null;
  chassis_colour: string | null;
  body_colour: string | null;
  expected_delivery: string | null;
  retail_price: number | null;
  sold_price: number | null;
  quote_no: string | null;
  hyperlink: string | null;
  notes: string | null;
  jr_notes: string | null;
  comments: string | null;
  documents: string | null;
  fleet_serve_link: string | null;
  created_at: string;
  updated_at: string;
}
