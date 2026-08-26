-- =============================================================
-- What has this database actually got?
--
-- Paste this into the Supabase SQL editor and run it. It reads the
-- catalogue only: no writes, no data, nothing to undo. It answers one
-- question per migration, in plain words.
--
-- Anything that says NO is why a screen looks empty.
-- =============================================================
WITH expected(ord, migration, what_it_adds, marker, kind) AS (
  VALUES
    (1,  '001 to 039', 'The CRM and the command bar',                    'command_perform',            'function'),
    (2,  '040',        'What this installation is called and branded as', 'tenant_settings',            'table'),
    (3,  '041',        'current_actor(), and a calendar hole closed',     'current_actor',              'function'),
    (4,  '042',        'Entities, departments, teams, people',           'teams',                      'table'),
    (5,  '043',        'Role templates and per person permissions',      'role_templates',             'table'),
    (6,  '044',        'The audit trail nobody can edit',                'audit_log',                  'table'),
    (7,  '045',        'Classification, MNPI flags, soft delete, timeline', 'activity',                 'table'),
    (8,  '046',        'Files as rows pointing at storage',              'files',                      'table'),
    (9,  '047',        'Pipelines and Opportunities',                    'opportunities',              'table'),
    (10, '048',        'The register of every permission in the product', 'capability_catalog',        'table'),
    (11, '049',        'Content: channels, queue, templates, tags, board', 'social_channels',          'table'),
    (12, '050',        'Content: submit, approve, schedule, publish',     'content_submit',             'function'),
    (13, '051',        'Work: tasks, projects, delegation, saved views',  'tasks',                      'table'),
    (14, '052',        'One person, one or both companies',               'profile_entities',           'table'),
    (15, '053',        'Work: the moves, and the gate on the columns',    'work_move',                  'function'),
    /* 054 only inserts rows, so the marker is one of those rows.
       `role_template_capabilities` already exists from 043 and would
       answer yes on a database that never ran this. */
    (16, '054',        'Work, in the granular role templates',            'work.assignOthers',          'grant')
)
SELECT
  e.migration                                AS "Migration",
  e.what_it_adds                             AS "What it adds",
  CASE WHEN present THEN 'yes' ELSE 'NO' END AS "In your database?",
  CASE WHEN present THEN ''
       ELSE 'Run the catch-up file' END      AS "What to do"
FROM expected e
CROSS JOIN LATERAL (
  SELECT CASE e.kind
    WHEN 'table' THEN EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = e.marker AND c.relkind = 'r')
    WHEN 'grant' THEN EXISTS (
      SELECT 1 FROM role_template_capabilities c
      JOIN role_templates rt ON rt.id = c.role_template_id
      WHERE rt.slug = 'administrator' AND c.capability = e.marker)
    ELSE EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = e.marker)
  END AS present
) found
ORDER BY e.ord;
