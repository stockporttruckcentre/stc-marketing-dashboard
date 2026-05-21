-- =============================================================
-- STC Marketing Dashboard - Supabase Schema
-- Run this entire file in Supabase SQL Editor on a fresh project.
-- =============================================================

-- =============================================================
-- 1. PROFILES
-- =============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'marketer', 'sales', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Helper: get current user's role (used in RLS without infinite recursion)
CREATE OR REPLACE FUNCTION current_role_safe()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================
-- 2. CRM CONTACTS
-- =============================================================
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'contacted', 'quoted', 'won', 'lost')),
  fleet_size INTEGER,
  location TEXT,
  services_interested TEXT[] DEFAULT '{}',
  notes TEXT,
  assigned_to TEXT,
  last_contact DATE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts (status);

-- =============================================================
-- 3. SOCIAL POSTS
-- =============================================================
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  platform TEXT[] NOT NULL DEFAULT '{}',
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'scheduled', 'posted')),
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  image_url TEXT,
  caption TEXT,
  hashtags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================
-- 4. TRAILER SALES
-- =============================================================
CREATE TABLE IF NOT EXISTS trailer_sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
  location TEXT NOT NULL DEFAULT '',
  description TEXT,
  images TEXT[] DEFAULT '{}',
  external_id TEXT UNIQUE,  -- For sync with MD's Excel (his row identifier)
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================
-- 5. BRAND ASSETS
-- =============================================================
CREATE TABLE IF NOT EXISTS brand_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('logo', 'font', 'color', 'template', 'image')),
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================
-- 6. NEWS ITEMS
-- =============================================================
CREATE TABLE IF NOT EXISTS news_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  summary TEXT,
  published_date DATE NOT NULL,
  image_url TEXT,
  author TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Backfill columns for existing installs (idempotent)
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS author    TEXT;
CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_date DESC);

-- =============================================================
-- 7. LUSHA CREDITS (single-row ledger)
-- =============================================================
CREATE TABLE IF NOT EXISTS lusha_credits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
INSERT INTO lusha_credits (balance) SELECT 2500
WHERE NOT EXISTS (SELECT 1 FROM lusha_credits);

-- =============================================================
-- updated_at TRIGGERS
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_crm_contacts_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_crm_contacts_updated_at BEFORE UPDATE ON crm_contacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_social_posts_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_social_posts_updated_at BEFORE UPDATE ON social_posts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_trailer_sales_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_trailer_sales_updated_at BEFORE UPDATE ON trailer_sales
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trailer_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_assets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lusha_credits ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select_all"  ON profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (current_role_safe() = 'admin');

-- CRM contacts: viewers read, marketer/sales/admin write, admin delete
DROP POLICY IF EXISTS "crm_select" ON crm_contacts;
DROP POLICY IF EXISTS "crm_insert" ON crm_contacts;
DROP POLICY IF EXISTS "crm_update" ON crm_contacts;
DROP POLICY IF EXISTS "crm_delete" ON crm_contacts;
CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "crm_insert" ON crm_contacts FOR INSERT WITH CHECK (current_role_safe() IN ('admin','marketer','sales'));
CREATE POLICY "crm_update" ON crm_contacts FOR UPDATE USING (current_role_safe() IN ('admin','marketer','sales'));
CREATE POLICY "crm_delete" ON crm_contacts FOR DELETE USING (current_role_safe() = 'admin');

-- Social posts
DROP POLICY IF EXISTS "social_select" ON social_posts;
DROP POLICY IF EXISTS "social_insert" ON social_posts;
DROP POLICY IF EXISTS "social_update" ON social_posts;
DROP POLICY IF EXISTS "social_delete" ON social_posts;
CREATE POLICY "social_select" ON social_posts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "social_insert" ON social_posts FOR INSERT WITH CHECK (current_role_safe() IN ('admin','marketer'));
CREATE POLICY "social_update" ON social_posts FOR UPDATE USING (current_role_safe() IN ('admin','marketer'));
CREATE POLICY "social_delete" ON social_posts FOR DELETE USING (current_role_safe() = 'admin');

-- Trailer sales
DROP POLICY IF EXISTS "trailers_select" ON trailer_sales;
DROP POLICY IF EXISTS "trailers_write"  ON trailer_sales;
CREATE POLICY "trailers_select" ON trailer_sales FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "trailers_write"  ON trailer_sales FOR ALL    USING (current_role_safe() IN ('admin','sales'));

-- Brand assets
DROP POLICY IF EXISTS "brand_select" ON brand_assets;
DROP POLICY IF EXISTS "brand_write"  ON brand_assets;
CREATE POLICY "brand_select" ON brand_assets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "brand_write"  ON brand_assets FOR ALL    USING (current_role_safe() IN ('admin','marketer'));

-- News
DROP POLICY IF EXISTS "news_select" ON news_items;
DROP POLICY IF EXISTS "news_write"  ON news_items;
CREATE POLICY "news_select" ON news_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "news_write"  ON news_items FOR ALL    USING (current_role_safe() IN ('admin','marketer'));

-- Lusha credits
DROP POLICY IF EXISTS "lusha_select" ON lusha_credits;
DROP POLICY IF EXISTS "lusha_write"  ON lusha_credits;
CREATE POLICY "lusha_select" ON lusha_credits FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "lusha_write"  ON lusha_credits FOR ALL    USING (current_role_safe() IN ('admin','marketer','sales'));

-- =============================================================
-- STORAGE BUCKET for brand assets
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "brand_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "brand_storage_write" ON storage.objects;
DROP POLICY IF EXISTS "brand_storage_delete" ON storage.objects;
CREATE POLICY "brand_storage_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-assets');
CREATE POLICY "brand_storage_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'brand-assets' AND auth.role() = 'authenticated');
CREATE POLICY "brand_storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'brand-assets' AND current_role_safe() IN ('admin','marketer'));

-- =============================================================
-- SEED DATA
-- =============================================================
INSERT INTO brand_assets (name, type, url, category) VALUES
  ('STC Logo Navy',  'logo',  '/assets/logo-navy.png',   'Logos'),
  ('STC Logo White', 'logo',  '/assets/logo-white.png',  'Logos'),
  ('Panton Black',   'font',  '/assets/fonts/panton-black.otf', 'Fonts'),
  ('Navy Primary',   'color', '#071458', 'Colors'),
  ('Red Accent',     'color', '#cf2417', 'Colors')
ON CONFLICT DO NOTHING;

-- =============================================================
-- ADD-ON: CRM LISTS, LIST MEMBERS, CALENDAR EVENTS
-- Run after the rest of the schema. Safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS crm_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users ON DELETE SET NULL,
  is_global BOOLEAN DEFAULT FALSE NOT NULL,
  color TEXT DEFAULT '#cf2417',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure only one global list
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_global_list ON crm_lists ((is_global)) WHERE is_global = TRUE;

INSERT INTO crm_lists (name, description, is_global, color)
SELECT 'Global CRM', 'Shared CRM visible to the whole team', TRUE, '#cf2417'
WHERE NOT EXISTS (SELECT 1 FROM crm_lists WHERE is_global = TRUE);

CREATE TABLE IF NOT EXISTS crm_list_members (
  list_id UUID REFERENCES crm_lists ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  can_edit BOOLEAN DEFAULT TRUE NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (list_id, user_id)
);

-- Attach list_id to contacts (default to global)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='list_id') THEN
    ALTER TABLE crm_contacts ADD COLUMN list_id UUID REFERENCES crm_lists ON DELETE SET NULL;
    UPDATE crm_contacts SET list_id = (SELECT id FROM crm_lists WHERE is_global = TRUE LIMIT 1) WHERE list_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_list_id ON crm_contacts (list_id);

-- =============================================================
-- CALENDAR EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN DEFAULT FALSE NOT NULL,
  color TEXT DEFAULT '#cf2417',
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events (start_at);

-- updated_at triggers
DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_crm_lists_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_crm_lists_updated_at BEFORE UPDATE ON crm_lists
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_calendar_events_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON calendar_events
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =============================================================
-- RLS for new tables
-- =============================================================
ALTER TABLE crm_lists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events  ENABLE ROW LEVEL SECURITY;

-- Lists: read global + your own + shared with you
DROP POLICY IF EXISTS "lists_select" ON crm_lists;
DROP POLICY IF EXISTS "lists_insert" ON crm_lists;
DROP POLICY IF EXISTS "lists_update" ON crm_lists;
DROP POLICY IF EXISTS "lists_delete" ON crm_lists;
CREATE POLICY "lists_select" ON crm_lists FOR SELECT USING (
  is_global = TRUE
  OR owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM crm_list_members m WHERE m.list_id = crm_lists.id AND m.user_id = auth.uid())
);
CREATE POLICY "lists_insert" ON crm_lists FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "lists_update" ON crm_lists FOR UPDATE USING (
  owner_id = auth.uid() OR current_role_safe() = 'admin'
);
CREATE POLICY "lists_delete" ON crm_lists FOR DELETE USING (
  (owner_id = auth.uid() AND is_global = FALSE) OR current_role_safe() = 'admin'
);

-- List members
DROP POLICY IF EXISTS "members_all" ON crm_list_members;
CREATE POLICY "members_all" ON crm_list_members FOR ALL USING (
  EXISTS (SELECT 1 FROM crm_lists l WHERE l.id = crm_list_members.list_id AND (l.owner_id = auth.uid() OR current_role_safe() = 'admin'))
  OR user_id = auth.uid()
);

-- Update existing CRM policies to honour list_id visibility
DROP POLICY IF EXISTS "crm_select" ON crm_contacts;
CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    list_id IS NULL
    OR EXISTS (
      SELECT 1 FROM crm_lists l
      WHERE l.id = crm_contacts.list_id
        AND (l.is_global = TRUE OR l.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM crm_list_members m WHERE m.list_id = l.id AND m.user_id = auth.uid()))
    )
  )
);

-- Calendar events - all authenticated read+write (team calendar)
DROP POLICY IF EXISTS "cal_select" ON calendar_events;
DROP POLICY IF EXISTS "cal_write"  ON calendar_events;
CREATE POLICY "cal_select" ON calendar_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "cal_write"  ON calendar_events FOR ALL    USING (auth.role() = 'authenticated');

-- =============================================================
-- REALTIME PUBLICATION
-- =============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE crm_contacts;   EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE crm_lists;      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE social_posts;   EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- =============================================================
-- ADD-ON: contact_notes (history of notes per CRM contact)
-- =============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES auth.users ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '—',
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes (contact_id, created_at DESC);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes_select" ON contact_notes;
DROP POLICY IF EXISTS "notes_insert" ON contact_notes;
DROP POLICY IF EXISTS "notes_delete" ON contact_notes;

-- Read notes for any contact whose parent list you can see
CREATE POLICY "notes_select" ON contact_notes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM crm_contacts c
    LEFT JOIN crm_lists l ON l.id = c.list_id
    WHERE c.id = contact_notes.contact_id
      AND (l.id IS NULL OR l.is_global = TRUE OR l.owner_id = auth.uid() OR is_list_member_safe(l.id))
  )
);
CREATE POLICY "notes_insert" ON contact_notes FOR INSERT WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM crm_contacts c
    LEFT JOIN crm_lists l ON l.id = c.list_id
    WHERE c.id = contact_notes.contact_id
      AND (l.id IS NULL OR l.is_global = TRUE OR l.owner_id = auth.uid() OR is_list_member_safe(l.id))
  )
);
CREATE POLICY "notes_delete" ON contact_notes FOR DELETE USING (
  author_id = auth.uid() OR current_role_safe() = 'admin'
);

-- Trigger: when a contact_note is inserted, sync the latest text to crm_contacts.notes
CREATE OR REPLACE FUNCTION sync_latest_note()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  UPDATE crm_contacts SET notes = NEW.text WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS contact_notes_sync_latest ON contact_notes;
CREATE TRIGGER contact_notes_sync_latest
  AFTER INSERT ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION sync_latest_note();

-- Add to realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE contact_notes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- =============================================================
-- ADD-ON: detailed CRM contact fields (fleet breakdown, address, links)
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='trucks') THEN
    ALTER TABLE crm_contacts ADD COLUMN trucks INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='trailers') THEN
    ALTER TABLE crm_contacts ADD COLUMN trailers INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='vans') THEN
    ALTER TABLE crm_contacts ADD COLUMN vans INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='address') THEN
    ALTER TABLE crm_contacts ADD COLUMN address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='links') THEN
    ALTER TABLE crm_contacts ADD COLUMN links JSONB DEFAULT '[]'::jsonb NOT NULL;
  END IF;
END $$;

-- Optional: keep fleet_size in sync as derived value
CREATE OR REPLACE FUNCTION sync_fleet_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF (NEW.trucks IS NOT NULL OR NEW.trailers IS NOT NULL OR NEW.vans IS NOT NULL) THEN
    NEW.fleet_size := COALESCE(NEW.trucks, 0) + COALESCE(NEW.trailers, 0) + COALESCE(NEW.vans, 0);
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS crm_contacts_fleet_total ON crm_contacts;
CREATE TRIGGER crm_contacts_fleet_total
  BEFORE INSERT OR UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION sync_fleet_total();

-- =============================================================
-- ADD-ON: employees + turnover + multi-address
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='employee_count') THEN
    ALTER TABLE crm_contacts ADD COLUMN employee_count INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='turnover') THEN
    ALTER TABLE crm_contacts ADD COLUMN turnover NUMERIC(14,2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contact_addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL DEFAULT 'Head office',
  address TEXT NOT NULL,
  city TEXT,
  is_primary BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_addresses_contact ON contact_addresses (contact_id, is_primary DESC);

ALTER TABLE contact_addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "addresses_all" ON contact_addresses;
CREATE POLICY "addresses_all" ON contact_addresses FOR ALL USING (
  EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = contact_addresses.contact_id)
);

-- One primary per contact: when marking primary, unmark others
CREATE OR REPLACE FUNCTION enforce_single_primary_address()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.is_primary THEN
    UPDATE contact_addresses SET is_primary = FALSE
    WHERE contact_id = NEW.contact_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS contact_addresses_single_primary ON contact_addresses;
CREATE TRIGGER contact_addresses_single_primary
  AFTER INSERT OR UPDATE OF is_primary ON contact_addresses
  FOR EACH ROW WHEN (NEW.is_primary = TRUE)
  EXECUTE FUNCTION enforce_single_primary_address();

-- Sync crm_contacts.location from primary address city
CREATE OR REPLACE FUNCTION sync_primary_address_to_contact()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  prim_city TEXT;
  prim_addr TEXT;
BEGIN
  SELECT city, address INTO prim_city, prim_addr
  FROM contact_addresses
  WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id) AND is_primary = TRUE
  ORDER BY created_at DESC LIMIT 1;

  UPDATE crm_contacts
    SET location = COALESCE(prim_city, location),
        address  = COALESCE(prim_addr, address)
    WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);
  RETURN COALESCE(NEW, OLD);
END;
$func$;
DROP TRIGGER IF EXISTS contact_addresses_sync ON contact_addresses;
CREATE TRIGGER contact_addresses_sync
  AFTER INSERT OR UPDATE OR DELETE ON contact_addresses
  FOR EACH ROW EXECUTE FUNCTION sync_primary_address_to_contact();

-- Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE contact_addresses; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- =============================================================
-- ADD-ON: theme preference on profiles
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='theme') THEN
    ALTER TABLE profiles ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light'));
  END IF;
END $$;

-- =============================================================
-- ADD-ON: brand asset seed refresh with real local files
-- =============================================================
DELETE FROM brand_assets WHERE url LIKE '/assets/logo-%' OR url LIKE '/assets/fonts/%';

INSERT INTO brand_assets (name, type, url, category) VALUES
  ('STC Logo Emblem',           'logo',  '/assets/stc-logo-emblem.png',           'Logos'),
  ('STC Navbar Button',         'logo',  '/assets/stc-navbar-button.png',         'Logos'),
  ('STC Sales & Leasing (White)', 'logo', '/assets/stc-sales-leasing-white.png',  'Logos')
ON CONFLICT DO NOTHING;

-- =============================================================
-- ADD-ON: real brand logos (11 variants from user upload)
-- =============================================================
DELETE FROM brand_assets WHERE category = 'Logos';
INSERT INTO brand_assets (name, type, url, category) VALUES
  ('STC Group',                       'logo', '/assets/logos/group.jpg',         'Logos'),
  ('STC Holdings',                    'logo', '/assets/logos/holdings.jpg',      'Logos'),
  ('Stockport Truck Centre — White',  'logo', '/assets/logos/stc-white.jpg',     'Logos'),
  ('Stockport Truck Centre — Navy',   'logo', '/assets/logos/stc-navy.jpg',      'Logos'),
  ('Sales & Leasing — White',         'logo', '/assets/logos/sl-white.jpg',      'Logos'),
  ('Sales & Leasing — Navy',          'logo', '/assets/logos/sl-navy.jpg',       'Logos'),
  ('STC oval (no text)',              'logo', '/assets/logos/notext.jpg',        'Logos'),
  ('STC text (no oval)',              'logo', '/assets/logos/nooval.jpg',        'Logos'),
  ('Trailers To Go',                  'logo', '/assets/logos/trailerstogo.jpg',  'Logos'),
  ('Christmas variant',               'logo', '/assets/logos/xmas.jpg',          'Logos'),
  ('Favicon source',                  'logo', '/assets/logos/favicon.jpg',       'Logos')
ON CONFLICT DO NOTHING;


-- =============================================================
-- NEWS SOURCES (per-publication backdrops)
-- =============================================================
CREATE TABLE IF NOT EXISTS news_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  backdrop_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "news_sources_select" ON news_sources;
DROP POLICY IF EXISTS "news_sources_write"  ON news_sources;
CREATE POLICY "news_sources_select" ON news_sources FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "news_sources_write"  ON news_sources FOR ALL    USING (current_role_safe() IN ('admin','marketer'));

-- Seed each known feed source (8 sources, slugs match backdrop filenames)
INSERT INTO news_sources (name) VALUES
  ('Commercial Motor'),
  ('Fleet News'),
  ('IRTE'),
  ('Motor Transport'),
  ('Trucking'),
  ('Logistics UK'),
  ('RHA')
ON CONFLICT (name) DO NOTHING;
DELETE FROM news_sources WHERE name = 'Road Transport';

-- Migrate older rows that used the previous names so the source chips show correctly
UPDATE news_items   SET source = 'IRTE' WHERE source = 'Transport Engineer';
UPDATE news_items   SET source = 'RHA'  WHERE source = 'UK HGV / haulage';
DELETE FROM news_sources WHERE name IN ('Transport Engineer', 'UK HGV / haulage');


-- =============================================================
-- Calendar event meeting features (additive, idempotent)
-- =============================================================
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS contact_id  UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS attendees   JSONB DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visibility  TEXT  DEFAULT 'private' NOT NULL CHECK (visibility IN ('private','team','specific'));
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visible_to  UUID[] DEFAULT '{}'::UUID[] NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_contact ON calendar_events (contact_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_visibility ON calendar_events (visibility);

-- Visibility-aware SELECT policy: creator always sees; team-events visible to all auth; specific-events visible to listed users
DROP POLICY IF EXISTS "calendar_select"      ON calendar_events;
DROP POLICY IF EXISTS "calendar_select_v2"   ON calendar_events;
CREATE POLICY "calendar_select_v2" ON calendar_events FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    created_by = auth.uid()
    OR visibility = 'team'
    OR (visibility = 'specific' AND auth.uid() = ANY (visible_to))
  )
);
DROP POLICY IF EXISTS "calendar_insert" ON calendar_events;
CREATE POLICY "calendar_insert" ON calendar_events FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "calendar_update" ON calendar_events;
CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE USING (auth.uid() = created_by);
DROP POLICY IF EXISTS "calendar_delete" ON calendar_events;
CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE USING (auth.uid() = created_by);

-- =============================================================
-- SALES TRACKER FIELDS on crm_contacts + 'customer' status
-- (additive, idempotent)
-- =============================================================
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_status_check;
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_status_check
  CHECK (status IN ('lead','contacted','quoted','won','customer','lost'));

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS date_of_enquiry DATE;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS new_or_used     TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS estimated_value NUMERIC;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS requirement     TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS action          TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS order_date      DATE;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS dispatch_date   DATE;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS sale_price      NUMERIC;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS profit          NUMERIC;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS profit_pct      NUMERIC;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS commission      NUMERIC;


-- =============================================================
-- MAINTENANCE ACCOUNTS (per-user)
-- =============================================================
CREATE TABLE IF NOT EXISTS maint_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date_of_update DATE,
  status TEXT,
  company_name TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  location TEXT,
  services TEXT,
  vehicles TEXT,
  requirements TEXT,
  update_log TEXT,
  next_action TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_accounts_owner    ON maint_accounts (owner_id);
CREATE INDEX IF NOT EXISTS idx_maint_accounts_category ON maint_accounts (category);

ALTER TABLE maint_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maint_owner_select" ON maint_accounts;
DROP POLICY IF EXISTS "maint_owner_write"  ON maint_accounts;
CREATE POLICY "maint_owner_select" ON maint_accounts FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "maint_owner_write"  ON maint_accounts FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_maint_accounts_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_maint_accounts_updated_at BEFORE UPDATE ON maint_accounts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


-- =============================================================
-- Unified tracker: SIDE (sales vs maintenance) + maint-specific fields
-- =============================================================
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS side TEXT DEFAULT 'trailer_sales' CHECK (side IN ('trailer_sales','maintenance'));
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS what TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS account_manager TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS vehicles TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS initials TEXT;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_side ON crm_contacts (side);


-- =============================================================
-- STOCK TRAILERS (global trailer stock list - replaces trailer_sales)
-- =============================================================
CREATE TABLE IF NOT EXISTS stock_trailers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('new_build','in_stock','sales_order','sold','rental','scrap')),
  category TEXT,
  -- Identity
  stc_no TEXT,
  supplier TEXT,
  trade_in BOOLEAN,
  chassis_number TEXT,
  ministry_no TEXT,
  supplier_no TEXT,
  -- Vehicle
  received_date DATE,
  paid_status TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  side_aperture TEXT,
  colour TEXT,
  description TEXT,
  door_type TEXT,
  mot_date DATE,
  axle_type TEXT,
  location TEXT,
  status_text TEXT,
  sales_rep TEXT,
  -- Financials
  nbv NUMERIC,
  refurb_costs NUMERIC,
  refurb_costs_at_sale NUMERIC,
  total_nbv NUMERIC,
  -- Sales fields
  new_or_used TEXT,
  customer TEXT,
  order_date DATE,
  dispatch_date DATE,
  month DATE,
  sales_price NUMERIC,
  profit NUMERIC,
  profit_pct NUMERIC,
  trailer_docs TEXT,
  signed_order TEXT,
  deposit_received TEXT,
  paid_in_full TEXT,
  refurb_update TEXT,
  refurb_done TEXT,
  tread_depths TEXT,
  -- New builds specifics
  chassis_colour TEXT,
  body_colour TEXT,
  expected_delivery DATE,
  retail_price NUMERIC,
  sold_price NUMERIC,
  quote_no TEXT,
  hyperlink TEXT,
  -- Notes
  notes TEXT,
  jr_notes TEXT,
  comments TEXT,
  documents TEXT,
  fleet_serve_link TEXT,
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_trailers_status   ON stock_trailers (status);
CREATE INDEX IF NOT EXISTS idx_stock_trailers_category ON stock_trailers (category);
CREATE INDEX IF NOT EXISTS idx_stock_trailers_customer ON stock_trailers (customer);
CREATE INDEX IF NOT EXISTS idx_stock_trailers_stc      ON stock_trailers (stc_no);

ALTER TABLE stock_trailers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_select" ON stock_trailers;
DROP POLICY IF EXISTS "stock_write"  ON stock_trailers;
CREATE POLICY "stock_select" ON stock_trailers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "stock_write"  ON stock_trailers FOR ALL    USING (current_role_safe() IN ('admin','marketer','sales'));

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_stock_trailers_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_stock_trailers_updated_at BEFORE UPDATE ON stock_trailers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


-- =============================================================
-- Tracker ↔ Stock linkage + commission auto-calc
-- =============================================================
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS stock_trailer_id UUID REFERENCES stock_trailers(id) ON DELETE SET NULL;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0.10;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stock_trailer ON crm_contacts (stock_trailer_id);
