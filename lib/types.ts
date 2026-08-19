export type UserRole = 'admin' | 'marketer' | 'sales' | 'viewer';
export type ContactStatus = 'lead' | 'contacted' | 'quoted' | 'won' | 'customer' | 'lost';

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
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  theme: 'dark' | 'light';
  created_at: string;
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
  relationship?: 'prospect' | 'existing';
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
  contact_id: string;
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
