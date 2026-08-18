-- =============================================================
-- 029. The parts of a customer that are not columns on it.
--
-- Three operations the CRM drawer has had buttons for since it was
-- built, and which no sentence could reach:
--
--   a site       another address on the account, and which one is the
--                main one
--   a link       the website, the LinkedIn page, whatever else
--   a twin       the same business held as two accounts, because
--                Protean keeps sales and maintenance apart
--
-- All three are several writes that belong together. Adding a site and
-- making it the main one is two, and doing the second without the first
-- leaves an account with two head offices. Linking two accounts writes
-- one record and has to refuse a chain, which the trigger in migration
-- 003 enforces and which this asks about first so the refusal has words
-- in it.
--
-- SECURITY INVOKER, gated on `crm.edit`, which is what the drawer gates
-- on. Row level security decides which accounts are reachable.
-- =============================================================

CREATE OR REPLACE FUNCTION command_add_address(
  p_contact UUID,
  p_address TEXT,
  p_label   TEXT DEFAULT NULL,
  p_primary BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  made UUID;
  who  TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;
  IF COALESCE(btrim(p_address), '') = '' THEN
    RAISE EXCEPTION 'an address with nothing in it is not an address';
  END IF;

  SELECT company_name INTO who FROM crm_contacts WHERE id = p_contact;
  IF who IS NULL THEN
    RAISE EXCEPTION 'that customer is not there';
  END IF;

  INSERT INTO contact_addresses (contact_id, label, address, is_primary)
  VALUES (p_contact, COALESCE(NULLIF(btrim(p_label), ''), 'Site'), btrim(p_address),
          COALESCE(p_primary, FALSE))
  RETURNING id INTO made;

  RETURN jsonb_build_object('id', made, 'customer', who, 'address', btrim(p_address));
END;
$$;

REVOKE ALL ON FUNCTION command_add_address(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_add_address(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- Which one is the main one
-- -------------------------------------------------------------
--
-- Named by what it says rather than by an id, because that is how a
-- person refers to an address. One match is used, none refuses by name,
-- and several asks, exactly as every other reference in this
-- application does.
CREATE OR REPLACE FUNCTION command_primary_address(
  p_contact UUID,
  p_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  found   UUID;
  matches INTEGER;
  says    TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;

  SELECT COUNT(*) INTO matches FROM contact_addresses
   WHERE contact_id = p_contact
     AND (COALESCE(btrim(p_address), '') = ''
          OR address ILIKE '%' || btrim(p_address) || '%'
          OR label ILIKE '%' || btrim(p_address) || '%');

  IF matches = 0 THEN
    RAISE EXCEPTION 'that customer has no address matching %', COALESCE(p_address, 'that');
  END IF;
  IF matches > 1 THEN
    SELECT string_agg(address, '; ') INTO says FROM contact_addresses
     WHERE contact_id = p_contact
       AND (COALESCE(btrim(p_address), '') = ''
            OR address ILIKE '%' || btrim(p_address) || '%'
            OR label ILIKE '%' || btrim(p_address) || '%');
    RAISE EXCEPTION
      '% addresses match that, so it is not clear which one: %', matches, says;
  END IF;

  SELECT id INTO found FROM contact_addresses
   WHERE contact_id = p_contact
     AND (COALESCE(btrim(p_address), '') = ''
          OR address ILIKE '%' || btrim(p_address) || '%'
          OR label ILIKE '%' || btrim(p_address) || '%');

  -- The trigger from schema.sql unmarks the others, so this is one
  -- write and the account cannot end up with two head offices.
  UPDATE contact_addresses SET is_primary = TRUE WHERE id = found;

  RETURN jsonb_build_object('id', found);
END;
$$;

REVOKE ALL ON FUNCTION command_primary_address(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_primary_address(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- A link on the account
-- -------------------------------------------------------------
--
-- `crm_contacts.links` is one JSON column holding a list, which is why
-- it is not writable as a field: typing at it would replace the lot. A
-- link is added to the list and removed from it by what it points at.
CREATE OR REPLACE FUNCTION command_add_link(
  p_contact UUID,
  p_url     TEXT,
  p_label   TEXT DEFAULT NULL,
  p_kind    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  held JSONB;
  kind TEXT;
  url  TEXT := btrim(COALESCE(p_url, ''));
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;
  IF url = '' THEN
    RAISE EXCEPTION 'a link with no address is not a link';
  END IF;
  IF url !~* '^https?://' THEN url := 'https://' || url; END IF;

  SELECT COALESCE(links, '[]'::JSONB) INTO held FROM crm_contacts WHERE id = p_contact;
  IF held IS NULL THEN
    RAISE EXCEPTION 'that customer is not there';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(held) AS l WHERE l ->> 'url' = url) THEN
    RAISE EXCEPTION 'that link is already on the account';
  END IF;

  -- What kind of link it is, from where it points, which is what the
  -- drawer shows an icon for.
  kind := COALESCE(NULLIF(btrim(p_kind), ''), CASE
    WHEN url ILIKE '%linkedin.%'  THEN 'linkedin'
    WHEN url ILIKE '%facebook.%'  THEN 'facebook'
    WHEN url ILIKE '%twitter.%' OR url ILIKE '%//x.com%' THEN 'x'
    WHEN url ILIKE '%instagram.%' THEN 'instagram'
    ELSE 'website'
  END);

  UPDATE crm_contacts
     SET links = held || jsonb_build_array(jsonb_build_object(
           'id', gen_random_uuid(),
           'label', COALESCE(NULLIF(btrim(p_label), ''), initcap(kind)),
           'url', url,
           'kind', kind))
   WHERE id = p_contact;

  RETURN jsonb_build_object('url', url, 'kind', kind);
END;
$$;

REVOKE ALL ON FUNCTION command_add_link(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_add_link(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION command_remove_link(
  p_contact UUID,
  p_which   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  held    JSONB;
  matches INTEGER;
  says    TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;

  SELECT COALESCE(links, '[]'::JSONB) INTO held FROM crm_contacts WHERE id = p_contact;
  IF held IS NULL THEN
    RAISE EXCEPTION 'that customer is not there';
  END IF;

  SELECT COUNT(*), string_agg(l ->> 'url', '; ') INTO matches, says
    FROM jsonb_array_elements(held) AS l
   WHERE l ->> 'url' ILIKE '%' || btrim(p_which) || '%'
      OR l ->> 'kind' ILIKE btrim(p_which)
      OR l ->> 'label' ILIKE '%' || btrim(p_which) || '%';

  IF matches = 0 THEN
    RAISE EXCEPTION 'there is no link matching % on that account', p_which;
  END IF;
  IF matches > 1 THEN
    RAISE EXCEPTION '% links match that, so it is not clear which one: %', matches, says;
  END IF;

  UPDATE crm_contacts
     SET links = (
       SELECT COALESCE(jsonb_agg(l), '[]'::JSONB)
         FROM jsonb_array_elements(held) AS l
        WHERE NOT (l ->> 'url' ILIKE '%' || btrim(p_which) || '%'
                OR l ->> 'kind' ILIKE btrim(p_which)
                OR l ->> 'label' ILIKE '%' || btrim(p_which) || '%'))
   WHERE id = p_contact;

  RETURN jsonb_build_object('removed', says);
END;
$$;

REVOKE ALL ON FUNCTION command_remove_link(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_remove_link(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- The same business, held twice
-- -------------------------------------------------------------
--
-- Links are flat: a twin points at a head record and a head record
-- points at nothing. Migration 003's trigger enforces that; this asks
-- first so the refusal says which record is already a twin rather than
-- coming back as a constraint name.
CREATE OR REPLACE FUNCTION command_link_accounts(
  p_contact UUID,
  p_parent  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  mine   TEXT;
  theirs TEXT;
  above  UUID;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'you do not have crm.edit';
  END IF;
  IF p_contact = p_parent THEN
    RAISE EXCEPTION 'an account cannot be linked to itself';
  END IF;

  SELECT company_name INTO mine FROM crm_contacts WHERE id = p_contact;
  SELECT company_name, parent_customer_id INTO theirs, above
    FROM crm_contacts WHERE id = p_parent;
  IF mine IS NULL OR theirs IS NULL THEN
    RAISE EXCEPTION 'one of those accounts is not there';
  END IF;
  IF above IS NOT NULL THEN
    RAISE EXCEPTION
      '% is already linked to another account, and links do not chain', theirs;
  END IF;

  UPDATE crm_contacts SET parent_customer_id = p_parent WHERE id = p_contact;

  RETURN jsonb_build_object('linked', mine, 'to', theirs);
END;
$$;

REVOKE ALL ON FUNCTION command_link_accounts(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_link_accounts(UUID, UUID) TO authenticated;
