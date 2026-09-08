-- =============================================================
-- 098. Three divisions, three tabs.
--
-- From the business:
--
--   Split rental from S&L tab on Revenue tab
--   tabs should be STC, Trailer Sales, Rentals. Rename S&L to Trailer
--   Sales. Add Rentals.
--
-- This is the case migration 093 said was coming. It called the rental
-- division "S&L" because that tab covered trailer sales and rentals
-- together, and wrote down what would happen when it did not:
--
--   `divisions` already carries a third row for `trailer`, and giving
--   S&L's trailer work its own screen is a fourth row and a page, not
--   an unpicking of this.
--
-- So this is one word and one page. The page is
-- `app/dashboard/revenue/trailer/page.tsx`, which calls the same screen
-- both other divisions call.
--
-- ---- The slug still does not follow ----
--
-- `rental` remains the slug for the same reason 093 gave: it is half of
-- the primary key on three Protean tables, it is what every read takes
-- as `p_division`, and it is in three URLs. The name is what people
-- read and the slug is what the database joins on, and this is exactly
-- the case those are two separate things for.
-- =============================================================

UPDATE divisions SET name = 'Rentals'       WHERE slug = 'rental'  AND name <> 'Rentals';
UPDATE divisions SET name = 'Trailer Sales' WHERE slug = 'trailer' AND name <> 'Trailer Sales';

-- Said out loud, because a rename that silently matched nothing is a
-- rename that looks applied and is not.
DO $$
DECLARE r TEXT; t TEXT;
BEGIN
  SELECT name INTO r FROM divisions WHERE slug = 'rental';
  SELECT name INTO t FROM divisions WHERE slug = 'trailer';
  IF r IS DISTINCT FROM 'Rentals' THEN
    RAISE EXCEPTION '098 did not land: the rental division is called %', COALESCE(r, '(missing)');
  END IF;
  IF t IS DISTINCT FROM 'Trailer Sales' THEN
    RAISE EXCEPTION '098 did not land: the trailer division is called %', COALESCE(t, '(missing)');
  END IF;
  RAISE NOTICE 'divisions: STC, %, %', t, r;
END $$;
