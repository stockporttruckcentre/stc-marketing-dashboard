-- =============================================================
-- 141. The brand kit and the news screen ask the capability.
--
-- Two more from the audit, both read before anything was changed.
--
-- THE BRAND KIT.
--
--   brand_write  USING (current_role_safe() IN ('admin','marketer'))
--
-- `brand.manage` exists in the register, is described as "Add, replace
-- or remove brand assets", and governed nothing. Granting it to
-- somebody left the upload and delete controls refused by the
-- database; revoking it from a marketer left them working.
--
-- THE NEWS SCREEN.
--
--   news_write  USING (current_role_safe() IN ('admin','marketer'))
--
-- Worse here, because the two halves disagreed with each other rather
-- than merely with the Roles tab. The refresh button appeared for the
-- old role names, and the endpoint behind it asks `marketing.edit`.
-- Grant `marketing.edit` to somebody outside those roles and the
-- button stayed hidden. Revoke it from a marketer and the button
-- stayed visible and refused when pressed.
--
-- Both now ask the same question the screens ask, and both refuse a
-- write while viewing as somebody else, for the reason 139 exists.
-- =============================================================

DROP POLICY IF EXISTS "brand_select" ON brand_assets;
CREATE POLICY "brand_select" ON brand_assets
  FOR SELECT USING (command_may('brand.view'));

DROP POLICY IF EXISTS "brand_write" ON brand_assets;
CREATE POLICY "brand_write" ON brand_assets
  FOR ALL
  USING (command_may('brand.manage') AND NOT viewing_as_somebody())
  WITH CHECK (command_may('brand.manage') AND NOT viewing_as_somebody());

/* Reading the news is not a permission anybody was asked to hold, and
   making it one now would hide a screen from people who have always
   had it. Only the write side changes. */
DROP POLICY IF EXISTS "news_write" ON news_items;
CREATE POLICY "news_write" ON news_items
  FOR ALL
  USING (command_may('marketing.edit') AND NOT viewing_as_somebody())
  WITH CHECK (command_may('marketing.edit') AND NOT viewing_as_somebody());

DO $$ BEGIN
  RAISE NOTICE 'the brand kit reads brand.manage and the news screen reads marketing.edit';
END $$;
