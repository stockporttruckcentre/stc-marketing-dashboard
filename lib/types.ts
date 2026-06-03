export type UserRole = 'admin' | 'marketer' | 'sales' | 'viewer';
export type ContactStatus = 'lead' | 'contacted' | 'quoted' | 'won' | 'customer' | 'lost';
export type PostStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'posted';
export type TrailerStatus = 'available' | 'reserved' | 'sold';
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

export interface Trailer {
  id: string;
  make: string;
  model: string;
  year: number;
  price: number;
  status: TrailerStatus;
  location: string;
  description: string | null;
  images: string[];
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

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
  // postcode goes here once Alex confirms; for now keeping lat/lng + name only.
  { name: 'Bredbury',   lat: 53.4225, lng: -2.1289 },
  { name: 'Hyde',       lat: 53.4500, lng: -2.0747 },
  { name: 'Dukinfield', lat: 53.4783, lng: -2.0833 },
  { name: 'Haydock',    lat: 53.4731, lng: -2.6519 },
  { name: 'Birkenhead', lat: 53.3934, lng: -3.0150 },
  { name: 'Atherton',   lat: 53.5219, lng: -2.4925 },
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
