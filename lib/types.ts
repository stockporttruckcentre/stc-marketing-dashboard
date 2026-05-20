export type UserRole = 'admin' | 'marketer' | 'sales' | 'viewer';
export type ContactStatus = 'lead' | 'contacted' | 'quoted' | 'won' | 'lost';
export type PostStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'posted';
export type TrailerStatus = 'available' | 'reserved' | 'sold';
export type AssetType = 'logo' | 'font' | 'color' | 'template' | 'image';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
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

export const DEPOTS = [
  { name: 'Bredbury',   lat: 53.4225, lng: -2.1289 },
  { name: 'Hyde',       lat: 53.4500, lng: -2.0747 },
  { name: 'Dukinfield', lat: 53.4783, lng: -2.0833 },
  { name: 'Haydock',    lat: 53.4731, lng: -2.6519 },
  { name: 'Birkenhead', lat: 53.3934, lng: -3.0150 },
  { name: 'Atherton',   lat: 53.5219, lng: -2.4925 },
] as const;
