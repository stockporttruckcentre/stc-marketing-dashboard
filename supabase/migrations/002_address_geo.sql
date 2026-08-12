-- =============================================================
-- 002_address_geo.sql
--
-- Coordinates on contact addresses, so a customer's sites can be shown
-- on a map and a pin can be dragged to correct one. Additive and safe to
-- re-run. The map degrades to geocoding on the fly when these columns do
-- not exist, so this is an improvement rather than a prerequisite.
-- =============================================================

ALTER TABLE contact_addresses ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE contact_addresses ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);

-- When a pin was last positioned, and whether a human placed it. A pin
-- dragged by a person must never be silently overwritten by a geocoder.
ALTER TABLE contact_addresses ADD COLUMN IF NOT EXISTS geo_source TEXT
  CHECK (geo_source IN ('geocoded', 'manual'));
ALTER TABLE contact_addresses ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contact_addresses_geo
  ON contact_addresses (lat, lng) WHERE lat IS NOT NULL;
