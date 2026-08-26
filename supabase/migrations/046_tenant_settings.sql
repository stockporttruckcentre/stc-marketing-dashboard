-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 040_tenant_settings.sql. This repository already had a 040 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 040. Who this installation belongs to.
--
-- Scope sections 0.3, 45 and 46. There was no tenant, organisation or
-- settings concept anywhere in this codebase, and that absence is the
-- root cause of every hardcoded company identity in
-- `docs/frame-hardcoding-inventory.md`. Each piece of identity had
-- nowhere to live, so it ended up in whichever file needed it: the login
-- heading, the Word footer, the Excel author, and the User-Agent two map
-- routes send to a third party.
--
-- ONE ROW, DELIBERATELY. This is not a tenants table and must not become
-- one. Scope 0.3 asks that a fresh INSTANCE can be rebranded in a day,
-- which is a deployment concern, not a request to serve several
-- companies from one database. `id BOOLEAN PRIMARY KEY DEFAULT TRUE
-- CHECK (id)` is how that is enforced: the only value the column accepts
-- is TRUE, and a primary key admits it once. A second insert fails
-- rather than quietly creating a second identity that half the
-- application would then read.
--
-- READABLE BEFORE SIGN IN. The login page shows the company name above
-- the password box, so `anon` can read this table. That is correct
-- rather than a compromise: every field here is already visible to
-- anybody who loads the front page. Nothing secret goes in this table.
-- Credentials stay in environment variables where they are today.
-- =============================================================

CREATE TABLE IF NOT EXISTS tenant_settings (
  -- The single-row lock. See the header.
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- ---- identity ----
  -- What the company is called in full, for document headers and the
  -- login page.
  company_name    TEXT NOT NULL,
  -- The short form for tight spaces: sidebar, tab title, table headers.
  short_name      TEXT NOT NULL,
  -- What the software itself is called, which is not always the company
  -- name. "STC Dashboard" over "STC".
  product_name    TEXT NOT NULL,
  -- One line under the product name on the sign in card.
  tagline         TEXT,

  -- ---- reaching the company ----
  -- Used for the sign in placeholder, so nobody is shown somebody else's
  -- domain as an example of their own address.
  email_domain    TEXT,
  -- The public website, printed in export footers.
  website         TEXT,
  support_email   TEXT,

  -- ---- how the outside world sees this installation ----
  -- Sent as User-Agent on outbound requests to third party services.
  -- Nominatim requires an identifying agent, and until now this
  -- application told it that it was the company it was built for.
  user_agent      TEXT,

  -- ---- brand ----
  -- Storage URLs rather than files. The brand kit already uploads to a
  -- bucket and these point at what it holds.
  logo_url        TEXT,
  emblem_url      TEXT,
  wordmark_url    TEXT,
  -- Hex, and only the two the kit treats as brand. Everything else in
  -- the palette derives from tokens. Scope 45 says centralise brand
  -- tokens, not every line of UI copy.
  primary_colour  TEXT NOT NULL DEFAULT '#09163A',
  accent_colour   TEXT NOT NULL DEFAULT '#CF2417',

  -- ---- formatting ----
  locale          TEXT NOT NULL DEFAULT 'en-GB',
  timezone        TEXT NOT NULL DEFAULT 'Europe/London',
  currency        TEXT NOT NULL DEFAULT 'GBP',

  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by      UUID REFERENCES auth.users ON DELETE SET NULL
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_settings_read" ON tenant_settings;
-- Everybody, signed in or not. The login page is the reason.
CREATE POLICY "tenant_settings_read" ON tenant_settings
  FOR SELECT USING (TRUE);

-- No write policy at all. Every change goes through the function below,
-- which asks for the capability by name. A policy saying "admins may
-- update" would be a second copy of that rule, and two copies of a
-- permission is how they drift.
REVOKE INSERT, UPDATE, DELETE ON tenant_settings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON tenant_settings FROM authenticated;

-- =============================================================
-- The seed.
--
-- Written as an upsert against the single row, so running this file
-- against a database that already carries a customised identity does
-- not overwrite it. Only the columns that have never been set are
-- filled. `scripts/sql/bundle-twice-check.sh` asserts that running the
-- bundle twice is a no-op, and a seed that replaced values would fail
-- that on its second pass.
-- =============================================================

INSERT INTO tenant_settings (
  id, company_name, short_name, product_name, tagline,
  email_domain, website, user_agent
)
VALUES (
  TRUE,
  'Stockport Truck Centre',
  'STC',
  'STC Dashboard',
  'Everything the sales and marketing teams run on.',
  'stc-uk.com',
  'stc-uk.com',
  'STCDashboard/1.0 (internal tool)'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- Changing it.
--
-- SECURITY DEFINER because the table has no write policy, so an invoker
-- side function could not write it at all. The capability check is
-- therefore the whole of the authorisation and is the first thing the
-- function does.
--
-- NULL means "leave it alone" rather than "clear it". Every argument
-- defaults to NULL so a caller changing one field does not have to
-- resend the other fifteen, and cannot blank them by omission.
-- =============================================================

CREATE OR REPLACE FUNCTION tenant_settings_update(
  p_company_name   TEXT DEFAULT NULL,
  p_short_name     TEXT DEFAULT NULL,
  p_product_name   TEXT DEFAULT NULL,
  p_tagline        TEXT DEFAULT NULL,
  p_email_domain   TEXT DEFAULT NULL,
  p_website        TEXT DEFAULT NULL,
  p_support_email  TEXT DEFAULT NULL,
  p_user_agent     TEXT DEFAULT NULL,
  p_logo_url       TEXT DEFAULT NULL,
  p_emblem_url     TEXT DEFAULT NULL,
  p_wordmark_url   TEXT DEFAULT NULL,
  p_primary_colour TEXT DEFAULT NULL,
  p_accent_colour  TEXT DEFAULT NULL,
  p_locale         TEXT DEFAULT NULL,
  p_timezone       TEXT DEFAULT NULL,
  p_currency       TEXT DEFAULT NULL
)
RETURNS tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result tenant_settings;
BEGIN
  IF NOT command_may('admin.settings') THEN
    RAISE EXCEPTION 'you do not have admin.settings';
  END IF;

  -- A colour that is not a colour reaches every screen at once, so it is
  -- checked here rather than trusted from a form.
  IF p_primary_colour IS NOT NULL AND p_primary_colour !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION '% is not a six digit hex colour', p_primary_colour;
  END IF;
  IF p_accent_colour IS NOT NULL AND p_accent_colour !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION '% is not a six digit hex colour', p_accent_colour;
  END IF;

  -- An empty company name renders as a blank login page, which reads as
  -- a broken deployment rather than an unbranded one.
  IF p_company_name IS NOT NULL AND btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'the company name cannot be empty';
  END IF;

  UPDATE tenant_settings SET
    company_name   = COALESCE(btrim(p_company_name),   company_name),
    short_name     = COALESCE(btrim(p_short_name),     short_name),
    product_name   = COALESCE(btrim(p_product_name),   product_name),
    tagline        = COALESCE(p_tagline,               tagline),
    email_domain   = COALESCE(p_email_domain,          email_domain),
    website        = COALESCE(p_website,               website),
    support_email  = COALESCE(p_support_email,         support_email),
    user_agent     = COALESCE(p_user_agent,            user_agent),
    logo_url       = COALESCE(p_logo_url,              logo_url),
    emblem_url     = COALESCE(p_emblem_url,            emblem_url),
    wordmark_url   = COALESCE(p_wordmark_url,          wordmark_url),
    primary_colour = COALESCE(p_primary_colour,        primary_colour),
    accent_colour  = COALESCE(p_accent_colour,         accent_colour),
    locale         = COALESCE(p_locale,                locale),
    timezone       = COALESCE(p_timezone,              timezone),
    currency       = COALESCE(p_currency,              currency),
    updated_at     = NOW(),
    updated_by     = auth.uid()
  WHERE id
  RETURNING * INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'this installation has no settings row, so migration 057 has not been run here';
  END IF;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION tenant_settings_update FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_settings_update TO authenticated;
