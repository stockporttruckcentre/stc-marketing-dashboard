-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 054_work_role_templates.sql. This repository already had a 054 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- Work, in the role templates.
--
-- The installation carries two registers of the same idea, and both
-- have to know about a capability or it half exists:
--
--   `command_capability_roles`  the four legacy roles, generated from
--                               lib/crm/permissions.ts into migration
--                               016 and replaced wholesale.
--   `role_template_capabilities` the granular templates from migration
--                               043, which is what the admin screen
--                               will edit once it is built.
--
-- Migration 051 added twenty eight Work capabilities plus
-- `compliance.sensitive`, and 052 added the three for the company split. The
-- legacy register got them. This one did not, which
-- `scripts/sql/permission-check.sql` refuses: a capability an
-- administrator template does not grant is a capability the granular
-- screen will show as off for the person who is supposed to have
-- everything.
--
-- Scope is the second half and it is not decoration. `own` means their
-- own records, `department` means their department's, `company` means
-- all of it. A member holding `work.view` at `department` sees their
-- department's work; the same capability at `own` would show them only
-- what is on them, and the twelve views that ship would come back
-- mostly empty for no visible reason.
-- =============================================================

DO $seed$
DECLARE
  admin_id      UUID;
  compliance_id UUID;
  member_id     UUID;
  contrib_id    UUID;
  observer_id   UUID;
BEGIN
  SELECT id INTO admin_id      FROM role_templates WHERE slug = 'administrator';
  SELECT id INTO compliance_id FROM role_templates WHERE slug = 'compliance';
  SELECT id INTO member_id     FROM role_templates WHERE slug = 'member';
  SELECT id INTO contrib_id    FROM role_templates WHERE slug = 'contributor';
  SELECT id INTO observer_id   FROM role_templates WHERE slug = 'observer';

  /* Administrator takes every Work capability, by reading the catalog
     rather than by listing them. A capability added next year is
     granted by this line without anybody remembering to come back,
     which is the difference between a seed and a rule. */
  IF admin_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    SELECT admin_id, key, 'company'::capability_scope
      FROM capability_catalog
     WHERE area IN ('Work', 'Compliance')
    ON CONFLICT DO NOTHING;
  END IF;

  /* Compliance reads everything and holds the information barrier, but
     does not run the work: they are not the ones assigning it. */
  IF compliance_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (compliance_id, 'work.view',           'company'),
      (compliance_id, 'work.viewAll',        'company'),
      (compliance_id, 'work.viewDepartment', 'company'),
      (compliance_id, 'work.projects',       'company'),
      (compliance_id, 'work.analytics',      'company'),
      (compliance_id, 'work.analyticsAll',   'company'),
      (compliance_id, 'work.views',          'own'),
      (compliance_id, 'work.requestRelease', 'own'),
      (compliance_id, 'work.review',         'company'),
      (compliance_id, 'work.approve',        'company'),
      (compliance_id, 'compliance.sensitive',     'company'),
      (compliance_id, 'entity.viewAll',      'company'),
      (compliance_id, 'entity.setOwn',       'own')
    ON CONFLICT DO NOTHING;
  END IF;

  /* Member is the ordinary working role. They raise work, do it, build
     their own views and ask to be let off what they cannot do. What
     they do NOT get is putting work on other people: that is
     `work.assignOthers`, and it is the line between a colleague and a
     manager. */
  IF member_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (member_id, 'work.view',           'department'),
      (member_id, 'work.viewDepartment', 'department'),
      (member_id, 'work.create',         'own'),
      (member_id, 'work.edit',           'assigned'),
      (member_id, 'work.requestRelease', 'own'),
      (member_id, 'work.review',         'department'),
      (member_id, 'work.projects',       'department'),
      (member_id, 'work.views',          'own'),
      (member_id, 'work.shareViews',     'department'),
      (member_id, 'work.analytics',      'department'),
      (member_id, 'entity.setOwn',       'own')
    ON CONFLICT DO NOTHING;
  END IF;

  /* Contributor does the work in front of them. They can still raise
     something for themselves and still ask to be let off, because
     neither is an administrative act and taking them away is how people
     end up doing work badly rather than saying so. */
  IF contrib_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (contrib_id, 'work.view',           'assigned'),
      (contrib_id, 'work.create',         'own'),
      (contrib_id, 'work.edit',           'assigned'),
      (contrib_id, 'work.requestRelease', 'own'),
      (contrib_id, 'work.views',          'own'),
      (contrib_id, 'work.projects',       'assigned'),
      (contrib_id, 'entity.setOwn',       'own')
    ON CONFLICT DO NOTHING;
  END IF;

  /* Observer reads. They keep `work.requestRelease` for the one case
     that matters: somebody set to read only who is nonetheless named on
     a task needs a way to say it is not theirs. */
  IF observer_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (observer_id, 'work.view',           'department'),
      (observer_id, 'work.viewDepartment', 'department'),
      (observer_id, 'work.projects',       'department'),
      (observer_id, 'work.analytics',      'department'),
      (observer_id, 'work.views',          'own'),
      (observer_id, 'work.requestRelease', 'own')
    ON CONFLICT DO NOTHING;
  END IF;
END $seed$;
