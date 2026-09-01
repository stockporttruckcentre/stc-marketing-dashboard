-- =============================================================
-- 068. FleetSmart+ was missing from the capability register.
--
-- From the business, on an administrator account:
--
--   Clicking save draft says "you do not have access to do that" on an
--   admin account when I should have access. same as Save and Send.
--
-- ---- What was actually wrong ----
--
-- Nothing to do with FleetSmart+ and everything to do with a list.
--
-- Migration 053 introduced `capability_catalog`, the register of every
-- permission the application has, and `capability_report`, which
-- resolves what one person holds by reading that register against their
-- role, their role template and their own overrides.
--
-- `lib/api/guard.ts` asks `capability_report` and then REPLACES the
-- role derived answer with what came back. That is right for a
-- capability the register knows about, because an override has to be
-- able to take one away.
--
-- It is wrong for a capability the register has never heard of. Then the
-- report has no opinion, returns no row, and replacing means the
-- capability is silently dropped for everybody.
--
-- The four FleetSmart+ capabilities were seeded into
-- `command_capability_roles` by migration 016 and were never added to
-- the register in 053. The catalogue in `lib/platform/permissions/catalog.ts`
-- lists all four, so the interface offered every button. The database
-- register listed none of them, so `capability_report` returned nothing
-- for FleetSmart+, and every route behind `requireCapability` refused
-- everybody, administrators included.
--
-- That is why the screen let somebody build a contract and the save
-- refused them: the screen and the route were reading two different
-- lists.
--
-- ---- What this does ----
--
-- Adds the four rows. The grants already exist in
-- `command_capability_roles`, so nothing about who may do what changes:
-- this makes the register agree with the code that has been shipping
-- since 061.
--
-- `scripts/capability-catalog-check.ts` now asserts the two lists match,
-- which is the check `guard.ts` claimed existed and did not.
-- =============================================================

INSERT INTO capability_catalog
  (key, label, description, area, feature, danger, requires, scoped, position)
VALUES
  ('fleetsmart.view', 'See FleetSmart+ contracts',
   'Open the FleetSmart+ tab and read the contracts on it, whoever built them.',
   'FleetSmart+', 'Contracts', 'routine', '{}', FALSE, 10),

  ('fleetsmart.build', 'Build a contract',
   'Price a fleet and save the result as a draft. The price comes off the rate card, so this is not the right to set a price.',
   'FleetSmart+', 'Contracts', 'routine', '{fleetsmart.view}', FALSE, 20),

  ('fleetsmart.discount', 'Apply a manager''s discount',
   'Take a percentage off the whole contract before the promotional discount. The one number on the document that comes out of somebody else''s margin.',
   'FleetSmart+', 'Contracts', 'sensitive', '{fleetsmart.build}', FALSE, 30),

  ('fleetsmart.send', 'Send a contract to a customer',
   'Mark a contract sent and record what went out. A price a customer has seen is a price they will hold you to.',
   'FleetSmart+', 'Contracts', 'sensitive', '{fleetsmart.build}', FALSE, 40)
ON CONFLICT (key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  area        = EXCLUDED.area,
  feature     = EXCLUDED.feature,
  danger      = EXCLUDED.danger,
  requires    = EXCLUDED.requires,
  scoped      = EXCLUDED.scoped,
  position    = EXCLUDED.position;

-- -------------------------------------------------------------
-- The role templates, so the platform roles hold them too.
--
-- Migration 016 granted these against the four legacy roles, which is
-- what `command_may` reads for an account with no template. Migration
-- 049 added templates, and an account on a template resolves through
-- `role_template_capabilities` instead, so a person moved onto the
-- Administrator template would have lost FleetSmart+ even after the rows
-- above.
--
-- Same shape as Content in 055: the administrator gets all four, a
-- member builds and sends but does not discount, a contributor and an
-- observer can look.
-- -------------------------------------------------------------
DO $seed$
DECLARE
  admin_id     UUID;
  member_id    UUID;
  contrib_id   UUID;
  observer_id  UUID;
BEGIN
  SELECT id INTO admin_id     FROM role_templates WHERE slug = 'administrator';
  SELECT id INTO member_id    FROM role_templates WHERE slug = 'member';
  SELECT id INTO contrib_id   FROM role_templates WHERE slug = 'contributor';
  SELECT id INTO observer_id  FROM role_templates WHERE slug = 'observer';

  IF admin_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    SELECT admin_id, k, 'company' FROM unnest(ARRAY[
      'fleetsmart.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send'
    ]) k
    ON CONFLICT DO NOTHING;
  END IF;

  IF member_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    SELECT member_id, k, 'company' FROM unnest(ARRAY[
      'fleetsmart.view', 'fleetsmart.build', 'fleetsmart.send'
    ]) k
    ON CONFLICT DO NOTHING;
  END IF;

  IF contrib_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    VALUES (contrib_id, 'fleetsmart.view', 'company') ON CONFLICT DO NOTHING;
  END IF;

  IF observer_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    VALUES (observer_id, 'fleetsmart.view', 'company') ON CONFLICT DO NOTHING;
  END IF;
END $seed$;

-- -------------------------------------------------------------
-- Did it land.
--
-- Named rather than counted: a capability the register is missing is
-- exactly the failure this migration exists to fix, and it should never
-- be discovered again by somebody being refused a button.
-- -------------------------------------------------------------
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(k, ', ') INTO missing
    FROM unnest(ARRAY[
      'fleetsmart.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send'
    ]) k
   WHERE NOT EXISTS (SELECT 1 FROM capability_catalog c WHERE c.key = k);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the register is still missing: %', missing;
  END IF;

  RAISE NOTICE 'ok  the four FleetSmart+ capabilities are in the register';
END $$;
