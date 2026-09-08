-- =============================================================
-- 097. A lead can quote more than one trailer.
--
-- From the business:
--
--   The trailer sales leads when you create one needs a very custom view
--   that links back to the trailer sales tab. If you're quoting certain
--   trailers from our stock list it needs reflecting in the system. You
--   should be able to search for trailers by different variants to find
--   the correct one(s) for the lead, and move one to an existing lead
--   from the stock page itself.
--
-- "one(s)" is the whole of this migration. `crm_leads.stock_trailer_id`
-- is a single column, so the system could hold "this deal is about
-- STC142345" and could not hold "they are looking at these four". A
-- quote for three curtainsiders was three leads or one lead and two
-- units nobody could see, and neither is what happened in the yard.
--
-- ---- Why the old column stays ----
--
-- Eleven things read `crm_leads.stock_trailer_id` today: the sold
-- warning, the tracker link check, the analytics split between new and
-- existing customers, the reconciliation screen, `command_mark_sold`.
-- Dropping it would mean changing all of them in one commit and hoping.
--
-- So it stays and it stops being written by hand. A trigger keeps it
-- equal to the FIRST trailer on the new table, which is what every one
-- of those readers means by "the trailer this deal is about". They keep
-- working, unchanged, and they are now reading a value that cannot
-- disagree with what the screen shows.
--
-- ---- What position means ----
--
-- The order somebody put them in, which on a quote is the order they
-- are priced in. It is not a ranking and nothing sorts by anything else,
-- because "the first one" has to be stable: if it were sorted by stock
-- number, adding a unit could silently change which trailer the sold
-- warning is about.
-- =============================================================

CREATE TABLE IF NOT EXISTS crm_lead_trailers (
  lead_id          UUID NOT NULL REFERENCES crm_leads     ON DELETE CASCADE,
  stock_trailer_id UUID NOT NULL REFERENCES stock_trailers ON DELETE CASCADE,

  -- Where it sits on the quote. Zero based, gapless is not enforced:
  -- removing the middle unit of three should not renumber the others.
  position INTEGER NOT NULL DEFAULT 0,

  -- What this particular unit is for on this particular deal. "The one
  -- they want if the fridge sells first" is a real thing to write down
  -- and there was nowhere to write it.
  note TEXT,

  added_by UUID REFERENCES auth.users ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same unit twice on one quote is a mistake every time.
  PRIMARY KEY (lead_id, stock_trailer_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_trailers_lead    ON crm_lead_trailers (lead_id, position);
CREATE INDEX IF NOT EXISTS idx_lead_trailers_trailer ON crm_lead_trailers (stock_trailer_id);

-- -------------------------------------------------------------
-- 1. Everything already linked, brought across
--
-- Every lead that names a trailer today gets one row, at position 0, so
-- the new table is the whole truth from the first minute rather than
-- from the next time somebody edits something.
-- -------------------------------------------------------------
INSERT INTO crm_lead_trailers (lead_id, stock_trailer_id, position, added_by, added_at)
SELECT l.id, l.stock_trailer_id, 0, l.created_by, COALESCE(l.created_at, NOW())
  FROM crm_leads l
 WHERE l.stock_trailer_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM stock_trailers s WHERE s.id = l.stock_trailer_id)
ON CONFLICT (lead_id, stock_trailer_id) DO NOTHING;

-- -------------------------------------------------------------
-- 2. The old column follows the new table
--
-- `stock_trailer_id` becomes derived. Nothing outside this trigger
-- should write it, and everything that reads it keeps its meaning: the
-- unit this deal is principally about.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_lead_first_trailer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target UUID := COALESCE(NEW.lead_id, OLD.lead_id);
  first_one UUID;
BEGIN
  SELECT t.stock_trailer_id INTO first_one
    FROM crm_lead_trailers t
   WHERE t.lead_id = target
   ORDER BY t.position, t.added_at
   LIMIT 1;

  UPDATE crm_leads
     SET stock_trailer_id = first_one,
         -- Attaching a unit to a quote is work on that quote. The
         -- trigger from 096 cannot see this: the write is to another
         -- table entirely.
         last_activity_at = NOW()
   WHERE id = target
     AND stock_trailer_id IS DISTINCT FROM first_one;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS crm_lead_trailers_sync ON crm_lead_trailers;
CREATE TRIGGER crm_lead_trailers_sync
  AFTER INSERT OR UPDATE OR DELETE ON crm_lead_trailers
  FOR EACH ROW EXECUTE FUNCTION crm_lead_first_trailer();

-- -------------------------------------------------------------
-- 3. Who can see and change a link
--
-- The link belongs to the lead, so it inherits the lead's answer
-- exactly. Written as a lookup rather than a copy of the predicate,
-- because two copies of "who may see a lead" is how they diverge.
-- -------------------------------------------------------------
ALTER TABLE crm_lead_trailers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_trailers_select" ON crm_lead_trailers;
CREATE POLICY "lead_trailers_select" ON crm_lead_trailers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM crm_leads l WHERE l.id = lead_id)
  );

/* Insert, update and delete all ask the same question: may this person
   change this lead. `crm_leads` has its own UPDATE policy and it is the
   authority, so this asks the database to answer it rather than
   restating it. */
DROP POLICY IF EXISTS "lead_trailers_write" ON crm_lead_trailers;
CREATE POLICY "lead_trailers_write" ON crm_lead_trailers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM crm_leads l
       WHERE l.id = lead_id
         AND (l.owner_id = auth.uid()
              OR auth.uid() = ANY (l.shared_with)
              OR current_role_safe() = 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm_leads l
       WHERE l.id = lead_id
         AND (l.owner_id = auth.uid()
              OR auth.uid() = ANY (l.shared_with)
              OR current_role_safe() = 'admin')
    )
  );

-- -------------------------------------------------------------
-- 4. Attaching a unit to a lead, as one operation
--
-- A function rather than three statements in a browser, for the reason
-- every other operation here is one: the screen and the command bar
-- both do this, and two implementations is how one of them forgets to
-- put the unit at the end rather than on top of an existing one.
--
-- Returns the number of units on the lead afterwards, so the caller can
-- say "three units on this quote" without asking again.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_attach_trailer(
  p_lead    UUID,
  p_trailer UUID,
  p_note    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_position INTEGER;
  total         INTEGER;
BEGIN
  IF p_lead IS NULL OR p_trailer IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'A lead and a trailer are both needed.');
  END IF;

  SELECT COALESCE(MAX(position) + 1, 0) INTO next_position
    FROM crm_lead_trailers WHERE lead_id = p_lead;

  INSERT INTO crm_lead_trailers (lead_id, stock_trailer_id, position, note, added_by)
  VALUES (p_lead, p_trailer, next_position, NULLIF(BTRIM(COALESCE(p_note, '')), ''), auth.uid())
  ON CONFLICT (lead_id, stock_trailer_id) DO UPDATE
    SET note = COALESCE(EXCLUDED.note, crm_lead_trailers.note);

  SELECT COUNT(*) INTO total FROM crm_lead_trailers WHERE lead_id = p_lead;
  RETURN jsonb_build_object('ok', TRUE, 'units', total);
END;
$$;

CREATE OR REPLACE FUNCTION crm_detach_trailer(p_lead UUID, p_trailer UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  total INTEGER;
BEGIN
  DELETE FROM crm_lead_trailers WHERE lead_id = p_lead AND stock_trailer_id = p_trailer;
  SELECT COUNT(*) INTO total FROM crm_lead_trailers WHERE lead_id = p_lead;
  RETURN jsonb_build_object('ok', TRUE, 'units', total);
END;
$$;

GRANT EXECUTE ON FUNCTION crm_attach_trailer(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION crm_detach_trailer(UUID, UUID)       TO authenticated;

-- -------------------------------------------------------------
-- 5. Which leads a trailer is on
--
-- The stock page asks this on every drawer open, and asked it through
-- `stock_trailer_id` alone, so a unit that was second on a three unit
-- quote looked like it was on nobody's tracker. One view, read by the
-- route, so the answer is the same wherever it is asked from.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW crm_trailer_on_leads AS
SELECT t.stock_trailer_id,
       t.lead_id,
       t.position,
       l.owner_id,
       l.status,
       l.type,
       l.company_name,
       p.full_name AS owner_name
  FROM crm_lead_trailers t
  JOIN crm_leads l ON l.id = t.lead_id
  LEFT JOIN profiles p ON p.id = l.owner_id;

GRANT SELECT ON crm_trailer_on_leads TO authenticated;

NOTIFY pgrst, 'reload schema';
