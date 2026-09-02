-- =============================================================
-- What has this database actually got?
--
-- Paste this into the Supabase SQL editor and run it. It reads the
-- catalogue only: no writes, no data, nothing to undo. It answers one
-- question per migration, in plain words.
--
-- Anything that says NO is why a screen looks empty.
--
-- ---- Why a function's NAME is not always enough ----
--
-- Half the migrations from 082 on do not add a function, they change
-- one. `protean_company` has existed since 080 and has been rewritten
-- four times since. Asking "is there a function called protean_company"
-- answers yes on a database four migrations behind, which is worse than
-- not asking: it is a NO dressed as a yes.
--
-- So there are two more kinds of marker for those:
--
--   signature   the function takes this argument, so the version that
--               takes it is the one installed
--   returns     the function gives back this column, same reasoning
--
-- That is what caught the fault this file was extended for. The Admin
-- requests screen answered
--
--   Could not find the function public.access_requests_waiting
--   without parameters in the schema cache
--
-- because 074 had never been run here, and nothing on the old version
-- of this file went past 054 to say so.
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
    /* This row used to look for a table called `opportunities` and
       called 047 "Pipelines and Opportunities". There is no such table
       in this repository and never has been: 047 is the renumbered
       actor and policy migration, and the row said NO on every database
       including a fully migrated one, sending whoever read it off to
       run a catch-up file they did not need. */
    (9,  '047',        'current_role_safe(), and two policies that were open', 'current_role_safe',   'function'),
    (10, '048',        'The register of every permission in the product', 'capability_catalog',        'table'),
    (11, '049',        'Content: channels, queue, templates, tags, board', 'social_channels',          'table'),
    (12, '050',        'Content: submit, approve, schedule, publish',     'content_submit',             'function'),
    (13, '051',        'Work: tasks, projects, delegation, saved views',  'tasks',                      'table'),
    (14, '052',        'One person, one or both companies',               'profile_entities',           'table'),
    (15, '053',        'Work: the moves, and the gate on the columns',    'work_move',                  'function'),
    /* 054 only inserts rows, so the marker is one of those rows.
       `role_template_capabilities` already exists from 043 and would
       answer yes on a database that never ran this. */
    (16, '054',        'Work, in the granular role templates',            'work.assignOthers',          'grant'),

    (17, '055',        'Content: the states a post can move between',     'content_transition',         'function'),
    (18, '056',        'Projects and workstreams above tasks',            'projects',                   'table'),
    (19, '057',        'Which company each person belongs to',            'actor_entities',             'function'),
    (20, '058',        'Work: the transition log and the column gate',    'task_transitions',           'table'),
    (21, '059',        'Work, in the compliance role template',           'work.analyticsAll',          'grant'),
    (22, '060',        'Existing posts adopted onto a channel',           'content_adopt_legacy_posts', 'function'),
    (23, '061',        'FleetSmart+ contracts',                           'fleetsmart_contracts',       'table'),
    (24, '062',        'Guests on meetings',                              'calendar_guests',            'table'),
    /* 063 widened the same function rather than adding one, so the
       argument it gained is the marker. */
    (25, '063',        'A meeting guest can just be a name',              'calendar_invite_guest:p_name', 'signature'),
    (26, '064',        'Signed out visitors read nothing but branding',   'tenant_branding',            'function'),
    (27, '065',        'Notifications: kinds, preferences, delivery',     'notification_kinds',         'table'),
    (28, '066',        'Notifications: the sweeps that raise them',       'notification_sweeps',        'table'),
    (29, '067',        'A FleetSmart+ contract is a lead',                'fleetsmart_syncing',         'function'),
    (30, '068',        'FleetSmart+ in the permission register',          'fleetsmart.view',            'catalog'),
    (31, '070',        'The FleetSmart+ rate card',                       'fleetsmart_rate_cards',      'table'),
    (32, '071',        'Ending, editing and deleting a contract',         'fleetsmart_end',             'function'),
    (33, '072',        'Amending a live contract',                        'fleetsmart_amendments',      'table'),
    (34, '018',        'Setting somebody''s role from the command bar',   'command_set_role',           'function'),
    (35, '019',        'The last administrator cannot be demoted',        'guard_last_admin',           'function'),
    (36, '073',        'The permission hub: per role, per person grants', 'admin_set_capability',       'function'),
    (37, '074',        'Asking for an account, and the Admin queue',      'access_requests',            'table'),

    -- ---- Revenue, out of Protean ----
    (38, '075',        'Protean accounts, invoices and open jobs',        'protean_invoices',           'table'),
    (39, '076',        'Groups of customers that total together',         'customer_groups',            'table'),
    (40, '077',        'Taking a Protean export in',                      'protean_take_invoices',      'function'),
    (41, '078',        'What closing the workshop file would close',      'protean_would_close',        'function'),
    (42, '079',        'Spend on the customer record, and the year',      'financial_year_of',          'function'),
    (43, '080',        'Company revenue and revenue by month',            'protean_by_month',           'function'),
    (44, '081',        'Open jobs find the account they belong to',       'protean_relink_jobs',        'function'),
    /* 082 rewrote the year to run April to April. Every figure now
       carries the date the year started, so that column is the marker. */
    (45, '082',        'The year runs April to April, everywhere',        'protean_company:fy_started', 'returns'),
    (46, '083',        'Revenue keyed by division, not just by account',  'divisions',                  'table'),
    (47, '084',        'Every write knows which division it is for',      'protean_bind:p_division',    'signature'),
    (48, '085',        'Every read can be asked for one division',        'protean_company:p_division', 'signature'),
    /* 086 added the whole of last year alongside the same point in it. */
    (49, '086',        'Open work with no account, and last year in full', 'protean_company:last_year_full', 'returns'),
    (50, '087',        'Renaming, emptying and dismissing a group',       'declined_group_suggestions', 'table'),
    (51, '088',        'Three divisions on one footing, for Analytics',   'division_revenue',           'function'),
    (52, '089',        'A group belongs to a division',                   'group_revenue:p_division',   'signature'),
    (53, '090',        'The seven figures finance takes into a meeting',  'trailer_deals',              'function'),
    (54, '091',        'An approved account can actually sign in',        'blank_auth_tokens',          'function'),
    (55, '092',        'Trailer customers reconcile, and can be created', 'make_customer_for_trailer',  'function'),
    /* 093 only renames a row, so the marker is the row itself. Every
       function it could name has existed since 083. */
    (56, '093',        'The rental division is called S&L',               'S&L',                        'division'),
    (57, '094',        'A group says which question it is answering',     'group_members:p_upto',       'signature')
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
      WHERE c.capability = e.marker)
    WHEN 'catalog' THEN EXISTS (
      SELECT 1 FROM capability_catalog c WHERE c.key = e.marker)
    /* A ROW IN A TABLE THAT MAY NOT BE THERE YET.

       `EXISTS (SELECT 1 FROM divisions ...)` is the obvious way to
       write this and it cannot be used. A table named directly is
       resolved when the statement is PLANNED, not when the branch is
       taken, so on a database that predates 083 the whole readback
       fails to parse and comes back empty. Which is worse than any
       wrong answer it could have given: every row then reads as absent,
       including the forty that are there.

       `query_to_xml` takes the query as a STRING, so nothing is
       resolved until the CASE actually reaches it, and `to_regclass`
       guards that. This is the standard way to ask about a table that
       may not exist. */
    WHEN 'division' THEN (
      CASE WHEN to_regclass('public.divisions') IS NULL THEN FALSE
           ELSE (xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM public.divisions WHERE name = %L', e.marker),
             FALSE, TRUE, '')))[1]::TEXT::INT > 0
      END)
    /* `name:argument`. Present when some overload of that name takes an
       argument by that name, which is what tells a rewritten function
       apart from the version it replaced. */
    WHEN 'signature' THEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = split_part(e.marker, ':', 1)
        AND pg_get_function_identity_arguments(p.oid)
            ILIKE '%' || split_part(e.marker, ':', 2) || '%')
    /* `name:column`, the same idea on the other side of the function. */
    WHEN 'returns' THEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = split_part(e.marker, ':', 1)
        AND pg_get_function_result(p.oid)
            ILIKE '%' || split_part(e.marker, ':', 2) || '%')
    ELSE EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = e.marker)
  END AS present
) found
ORDER BY e.ord;
