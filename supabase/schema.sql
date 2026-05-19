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
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
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
