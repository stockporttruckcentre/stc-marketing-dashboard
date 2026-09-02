-- =============================================================
-- 093. The division is S&L, not S&L Rental.
--
-- From the business:
--
--   S&L Rental just rename that sub tab to S&L because the tab covers
--   trailer sales and rentals. I've a feeling we'll end up with a third
--   tab for trailer sales but do it this way for now.
--
-- The slug stays `rental`. Only the name people read changes.
--
-- ---- Why the slug does not follow ----
--
-- `divisions.slug` is the primary key. It is half of the primary key on
-- `protean_accounts`, `protean_invoices` and `protean_open_jobs`, it is
-- what every read and every write takes as `p_division`, it is in three
-- URLs and in a dozen command bar actions.
--
-- Renaming it would be a data migration across four tables to change a
-- word nobody sees, on the strength of a division that might be split
-- in two later anyway. The slug is an identifier and the name is what
-- it is called, and this is exactly the case those are two things for.
--
-- ---- What happens when trailer sales does get its own tab ----
--
-- Nothing here blocks it. `divisions` already carries a third row for
-- `trailer`, and giving S&L's trailer work its own screen is a fourth
-- row and a page, not an unpicking of this.
-- =============================================================

UPDATE divisions SET name = 'S&L' WHERE slug = 'rental' AND name <> 'S&L';

DO $$
DECLARE got TEXT;
BEGIN
  SELECT name INTO got FROM divisions WHERE slug = 'rental';
  IF got IS DISTINCT FROM 'S&L' THEN
    RAISE EXCEPTION '093 did not land: the rental division is called %', got;
  END IF;
END $$;
