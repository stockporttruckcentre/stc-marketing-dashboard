-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 051_work_and_tasks.sql. This repository already had a 051 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- Work: projects, workstreams, milestones and tasks.
--
-- Scope sections 9 and 14. This is the model behind the Work tab, and
-- it is the one people will spend their day in, so it is built to the
-- same depth as the CRM rather than as a checklist bolted on the side.
--
-- ---- Why this is not Notion ----
--
-- The question will be asked, and it deserves a straight answer rather
-- than a preference.
--
--   1. TCC is a business that gets audited. Section 4 of the TCC context
--      says a system holding deal notes holds commercially sensitive information by definition, and a
--      task carrying "prepare the exchange listing pack" is exactly
--      that. Every table here takes `add_record_columns`, so a task
--      inherits owning entity, classification, the sensitivity flag with its
--      review date, and soft delete. Notion has no concept of an
--      owning legal entity, and it cannot make a record invisible to
--      Frame-only staff because it does not know what TCC is.
--
--   2. Delegation has to be refusable. A task assigned downward that
--      cannot be handed back is a instruction, not a work item, and
--      people route around it by doing nothing. `task_delegation_requests`
--      makes "I cannot take this" a first class record with an
--      addressee and an outcome, which no general tool models because
--      no general tool knows who outranks whom.
--
--   3. Work has to join to the rest of the product. A task points at an
--      a customer, a contact, a lead, a trailer, a meeting, a post
--      and a content post, all by foreign key. In a general tool those
--      are hyperlinks that go stale, and nothing can ask "every task
--      blocking the Halstead proposal".
--
--   4. The permission model already exists here. `command_may` and
--      `capability_catalog` decide who can reassign, who can approve
--      and who can see a confidential task, and the same check runs in
--      the database rather than in a share dialog.
--
--   5. A batch of work created from a call transcript has to be
--      reversible in one action, which section 57 requires and which no
--      general tool offers at all.
--
-- What Notion is genuinely better at, and what this therefore copies
-- rather than reinvents: letting somebody build the view they want. So
-- `task_views` is a saved query with its own grouping, sorting,
-- filtering and column set, per person or shared, and the screen has no
-- privileged view of its own.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Vocabulary
-- -------------------------------------------------------------

-- Scope 9.2. Closed set, deliberately. The scope says not to
-- over-generalise the database when logic relies on these, and the
-- logic does: what counts as open, overdue, blocked or finished is
-- decided here rather than by a label somebody typed.
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM (
    'backlog', 'ready', 'in_progress', 'blocked',
    'waiting_external', 'in_review', 'done', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('p0', 'p1', 'p2', 'p3');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who a piece of work is aimed at. A department is a legitimate
-- assignee: "Engineering owns this" is a real state of the world, and
-- forcing a name into it on day one produces a fiction that somebody
-- has to correct later.
DO $$ BEGIN
  CREATE TYPE assignee_kind AS ENUM ('person', 'department', 'team', 'unassigned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- What somebody is asking for when they push back on an assignment.
DO $$ BEGIN
  CREATE TYPE delegation_ask AS ENUM ('cancel', 'reassign', 'extend', 'declassify');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delegation_state AS ENUM ('open', 'granted', 'refused', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The shape of a dependency. Finish-to-start is the common one and the
-- only one most tools have; the rest exist because a plan that can only
-- say "after" cannot express "these two ship together".
DO $$ BEGIN
  CREATE TYPE dependency_kind AS ENUM ('blocks', 'relates', 'duplicates', 'parent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------
-- 2. Projects, workstreams and milestones
--
-- Scope 14: Project -> Workstream -> Milestone -> Deliverable -> Task.
-- Deliverable is not a table. It is a milestone with no children of its
-- own, and a fifth level that is structurally identical to the fourth
-- earns nothing but a join.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,

  owner_id          UUID REFERENCES auth.users ON DELETE SET NULL,
  sponsor_id        UUID REFERENCES auth.users ON DELETE SET NULL,
  department_id     UUID REFERENCES departments ON DELETE SET NULL,

  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('planned','active','paused','done','cancelled')),
  priority          task_priority NOT NULL DEFAULT 'p2',

  -- Green, amber, red, as a judgement somebody makes rather than a sum
  -- the system computes. A health light derived from percent complete
  -- is always green until the week it is not.
  health            TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (health IN ('unknown','on_track','at_risk','off_track')),
  health_note       TEXT,
  health_set_at     TIMESTAMPTZ,
  health_set_by     UUID REFERENCES auth.users ON DELETE SET NULL,

  starts_on         DATE,
  target_on         DATE,
  completed_on      DATE,

  -- Scope 14: the project system powers the public tracker as well as
  -- internal execution, so a project knows whether it may be shown.
  is_public         BOOLEAN NOT NULL DEFAULT FALSE,
  public_name       TEXT,
  public_summary    TEXT,

  color             TEXT,
  archived_at       TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workstreams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  lead_id           UUID REFERENCES auth.users ON DELETE SET NULL,
  position          INT NOT NULL DEFAULT 0,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS milestones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects ON DELETE CASCADE,
  workstream_id     UUID REFERENCES workstreams ON DELETE SET NULL,

  -- Scope 14.2 keeps these apart on purpose. What a milestone is called
  -- internally and what the public tracker may call it are different
  -- sentences, and merging them means either leaking a codename or
  -- writing marketing copy into a work item.
  title             TEXT NOT NULL,
  public_title      TEXT,

  owner_id          UUID REFERENCES auth.users ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','at_risk','done','cancelled')),
  target_on         DATE,
  actual_on         DATE,
  is_public         BOOLEAN NOT NULL DEFAULT FALSE,
  position          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 3. Tasks
--
-- Every field in scope 9.1 is here. Where the scope names a concept
-- that is really a relationship, it is a table below rather than a
-- column: collaborators, subtasks, dependencies and acceptance criteria
-- are all one-to-many and a comma separated column would make them
-- unqueryable.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A short human reference, so somebody can say "close FRA-412" out
  -- loud and in the command bar. Filled by a trigger below.
  ref               TEXT UNIQUE,

  title             TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description       TEXT,

  -- ---- where it sits ----
  project_id        UUID REFERENCES projects ON DELETE SET NULL,
  workstream_id     UUID REFERENCES workstreams ON DELETE SET NULL,
  milestone_id      UUID REFERENCES milestones ON DELETE SET NULL,
  department_id     UUID REFERENCES departments ON DELETE SET NULL,
  parent_id         UUID REFERENCES tasks ON DELETE CASCADE,

  -- ---- who ----
  -- Two columns rather than one nullable user, because "nobody has this
  -- yet" and "Engineering has this" are different answers and a single
  -- assignee_id cannot tell them apart.
  assignee_kind     assignee_kind NOT NULL DEFAULT 'unassigned',
  assignee_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  assignee_dept_id  UUID REFERENCES departments ON DELETE SET NULL,
  assignee_team_id  UUID REFERENCES teams ON DELETE SET NULL,

  reviewer_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  approver_id       UUID REFERENCES auth.users ON DELETE SET NULL,

  -- Who put this on somebody. Kept separately from created_by: a
  -- coordinator raising a task on a director's behalf is common, and
  -- the person who may cancel it is the director.
  delegated_by      UUID REFERENCES auth.users ON DELETE SET NULL,
  delegated_at      TIMESTAMPTZ,

  -- ---- state ----
  status            task_status NOT NULL DEFAULT 'backlog',
  priority          task_priority NOT NULL DEFAULT 'p2',

  starts_on         DATE,
  due_at            TIMESTAMPTZ,
  -- What the due date was when the task was first assigned. Every
  -- change is in the history below, but the original is asked for often
  -- enough that walking the history for it is the wrong cost.
  original_due_at   TIMESTAMPTZ,

  estimate_minutes  INT CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
  spent_minutes     INT NOT NULL DEFAULT 0 CHECK (spent_minutes >= 0),

  -- Why it is stuck, in words, next to the state that says it is.
  blocked_reason    TEXT,
  blocked_since     TIMESTAMPTZ,
  -- Who or what outside the company it is waiting on.
  waiting_on        TEXT,

  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  completed_by      UUID REFERENCES auth.users ON DELETE SET NULL,
  cancelled_reason  TEXT,

  -- ---- what it is about ----
  -- Scope 9.1's related-record block. Every one is a foreign key, which
  -- is the point: a link that cannot be joined cannot answer a question.
  --
  -- The source package pointed `opportunity_id` at an `opportunities`
  -- table from its own CRM decomposition. This CRM calls that a lead:
  -- one customer in `crm_contacts`, unlimited pitches against them in
  -- `crm_leads`, which is migration 040. So the column points there and
  -- is named for what it holds.
  organisation_id   UUID REFERENCES crm_contacts ON DELETE SET NULL,
  person_id         UUID REFERENCES crm_contacts ON DELETE SET NULL,
  lead_id           UUID REFERENCES crm_leads ON DELETE SET NULL,
  -- And the unit, because at a truck dealership a great deal of the work
  -- is about one trailer: a refurb, an MOT, getting it photographed.
  stock_trailer_id  UUID REFERENCES stock_trailers ON DELETE SET NULL,
  meeting_id        UUID REFERENCES calendar_events ON DELETE SET NULL,
  content_post_id   UUID REFERENCES social_posts ON DELETE SET NULL,

  -- ---- where it came from ----
  -- 'manual', 'command', 'transcript', 'automation', 'recurrence',
  -- 'import'. Free text on purpose: a new source should not need a
  -- migration, and nothing branches on the value.
  source            TEXT NOT NULL DEFAULT 'manual',
  source_ref        TEXT,
  batch_id          UUID,

  -- Which saved view a person was looking at when they made it, so a
  -- view that produces a lot of work can be recognised as doing so.
  created_in_view   UUID,

  recurrence_id     UUID,

  -- Board position within its status column, as a sparse float so a
  -- drag between two cards never has to renumber the column.
  board_position    DOUBLE PRECISION NOT NULL DEFAULT 0,

  created_by        UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A subtask cannot be its own parent. Deeper cycles are refused by a
  -- trigger, which a CHECK cannot express.
  CONSTRAINT tasks_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),

  -- The assignee columns have to agree with the kind. Without this a row
  -- can claim to be assigned to a person and name a department, and
  -- every reader picks a different one to believe.
  CONSTRAINT tasks_assignee_agrees CHECK (
    (assignee_kind = 'unassigned'  AND assignee_id IS NULL AND assignee_dept_id IS NULL AND assignee_team_id IS NULL)
    OR (assignee_kind = 'person'     AND assignee_id IS NOT NULL)
    OR (assignee_kind = 'department' AND assignee_dept_id IS NOT NULL)
    OR (assignee_kind = 'team'       AND assignee_team_id IS NOT NULL)
  ),

  -- A finished task has a finish time, and an unfinished one does not.
  CONSTRAINT tasks_done_has_time CHECK (
    (status = 'done') = (completed_at IS NOT NULL)
  )
);

/* The indexes that mention `deleted_at` are further down, after
   `add_record_columns` has added the column. Putting them here reads
   better and does not run. */
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due        ON tasks (due_at) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent     ON tasks (parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_delegator  ON tasks (delegated_by);
CREATE INDEX IF NOT EXISTS idx_tasks_batch      ON tasks (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org        ON tasks (organisation_id) WHERE organisation_id IS NOT NULL;

-- -------------------------------------------------------------
-- 4. The relationships a task has more than one of
-- -------------------------------------------------------------

-- Scope 9.1 "Collaborators", plus the people who only want to hear
-- about it. Two roles rather than two tables: a watcher is a
-- collaborator who is not doing any of it.
CREATE TABLE IF NOT EXISTS task_participants (
  task_id     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'collaborator'
                CHECK (role IN ('collaborator','watcher')),
  added_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

-- Scope 9.1 "Dependencies" and "Blocked by", 9.4 "dependencies".
--
-- Directed, and the direction is the whole meaning: `from` blocks `to`.
-- The kind is on the edge rather than implied, so "relates to" and
-- "duplicates" live in the same graph instead of needing tables of
-- their own.
CREATE TABLE IF NOT EXISTS task_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_task   UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  to_task     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  kind        dependency_kind NOT NULL DEFAULT 'blocks',
  created_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_links_not_self CHECK (from_task <> to_task),
  UNIQUE (from_task, to_task, kind)
);
CREATE INDEX IF NOT EXISTS idx_task_links_to   ON task_links (to_task);
CREATE INDEX IF NOT EXISTS idx_task_links_from ON task_links (from_task);

-- Scope 9.1 "Acceptance criteria". A checklist rather than a text blob,
-- because "three of five criteria met" is a question somebody asks and
-- prose cannot answer it.
CREATE TABLE IF NOT EXISTS task_criteria (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  body        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  met_at      TIMESTAMPTZ,
  met_by      UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_criteria_task ON task_criteria (task_id);

-- Scope 9.4 "comments" and "mentions".
CREATE TABLE IF NOT EXISTS task_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  author_id   UUID REFERENCES auth.users ON DELETE SET NULL,
  body        TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  -- Resolved out of the body once, at write time. Working them out at
  -- render time means every reader re-parses every comment, and a
  -- notification that fires on read is a notification nobody trusts.
  mentions    UUID[] NOT NULL DEFAULT '{}',
  -- A reply, so a long thread does not have to be read as a flat list.
  reply_to    UUID REFERENCES task_comments ON DELETE SET NULL,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id, created_at);

-- Scope 9.4 "attachments". There is no table here on purpose. Migration
-- 046 already has `file_attachments (file_id, record_type, record_id)`
-- and its reachability rule asks the owning table whether the caller can
-- SELECT the row, so attaching to a task works the moment the task
-- policies below exist. A `task_files` table would be a second copy of
-- that with a second set of rules to keep in step.
--
--   record_type = 'task', record_id = tasks.id

-- Free tagging, which is how people organize before they know what the
-- structure should be. Deliberately not an enum.
CREATE TABLE IF NOT EXISTS task_labels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  color       TEXT,
  created_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS task_label_links (
  task_id     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  label_id    UUID NOT NULL REFERENCES task_labels ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- -------------------------------------------------------------
-- 5. Delegation that can be answered
--
-- The thing the user asked for by name: if somebody above you assigned
-- it, you cannot simply drop it, you ask for it to be cancelled or
-- passed on, and somebody with the standing to decide answers.
--
-- A row here is a question with an addressee. It is not a status on the
-- task, because two people can be waiting on two different answers
-- about the same task and a status column can only hold one.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_delegation_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,

  asked_by      UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- Who has to answer. Defaults to whoever delegated the task, which is
  -- the person with the standing to release it.
  asked_of      UUID REFERENCES auth.users ON DELETE SET NULL,

  ask           delegation_ask NOT NULL,
  reason        TEXT NOT NULL CHECK (length(btrim(reason)) > 0),

  -- For a reassign, where it should go instead. Somebody who says "not
  -- me" and names a successor is far more use than somebody who does not.
  suggest_kind  assignee_kind,
  suggest_user  UUID REFERENCES auth.users ON DELETE SET NULL,
  suggest_dept  UUID REFERENCES departments ON DELETE SET NULL,
  suggest_team  UUID REFERENCES teams ON DELETE SET NULL,
  -- For an extend, the date being asked for.
  suggest_due   TIMESTAMPTZ,

  state         delegation_state NOT NULL DEFAULT 'open',
  decided_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A decided request has a decider and a time; an open one has neither.
  CONSTRAINT delegation_decided_together CHECK (
    (state = 'open') = (decided_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_deleg_open_for
  ON task_delegation_requests (asked_of) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS idx_deleg_task ON task_delegation_requests (task_id);

-- -------------------------------------------------------------
-- 6. Batches, so delegated work can be undone
--
-- Scope 57. Fifteen tasks created from one misattributed transcript are
-- fifteen problems, and undoing them one at a time is how half of them
-- get left behind.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,
  source        TEXT NOT NULL,
  source_ref    TEXT,
  created_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  rolled_back_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES auth.users ON DELETE SET NULL,
  -- Scope 57: a task that has been started, commented on or completed is
  -- excluded and named in the result, so nobody is told everything was
  -- undone when it was not.
  kept_task_ids  UUID[] NOT NULL DEFAULT '{}'
);

-- -------------------------------------------------------------
-- 7. Recurrence
--
-- Scope 9.4 "recurring tasks". A rule, and the tasks it has produced.
-- The next instance is materialised on a schedule rather than computed
-- at read time, because a virtual task cannot be commented on,
-- reassigned or blocked, and those are the things people do to them.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_recurrences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  template      JSONB NOT NULL DEFAULT '{}',

  -- 'daily' | 'weekly' | 'monthly' | 'weekdays'
  cadence       TEXT NOT NULL CHECK (cadence IN ('daily','weekdays','weekly','monthly')),
  interval_n    INT NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
  -- 0 is Sunday, matching PostgreSQL's own day numbering rather than a
  -- second convention this file would then have to convert.
  weekdays      INT[] NOT NULL DEFAULT '{}',
  day_of_month  INT CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  at_time       TIME NOT NULL DEFAULT '09:00',

  starts_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on       DATE,
  -- Do not open a second copy while the first is still open. Without
  -- this a weekly task nobody did becomes a wall of identical rows.
  skip_if_open  BOOLEAN NOT NULL DEFAULT TRUE,

  last_spawned_on DATE,
  next_due_on     DATE,
  paused_at     TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 8. History
--
-- The activity table in migration 056 carries the readable timeline.
-- This is the machine readable one: which field, from what, to what.
-- Both exist because "Theo moved this to blocked" and "status:
-- in_progress -> blocked" answer different questions, and deriving
-- either from the other loses something.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_field_history (
  id          BIGSERIAL PRIMARY KEY,
  task_id     UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id    UUID REFERENCES auth.users ON DELETE SET NULL,
  field       TEXT NOT NULL,
  was         TEXT,
  now_is      TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_field_history (task_id, at DESC);

-- -------------------------------------------------------------
-- 9. Saved views
--
-- This is the half of Notion worth copying, and it is why the screen
-- has no privileged view of its own: every named view a person opens,
-- including the ones that ship, is a row here. There is no code path
-- that renders "My Work" specially, so anything the built in views can
-- do, a view somebody builds can do too.
--
-- Scope 9.3 names ten views. They are seeded at the bottom of this file
-- as ordinary rows.
--
-- The filter is JSON rather than columns because the shape of a filter
-- is a tree: "due this week AND (mine OR my department) AND NOT
-- cancelled". Columns can hold a list of conditions; they cannot hold
-- the brackets. It is read by one evaluator in lib/work/filter.ts, and
-- the check suite runs that evaluator against the same JSON the
-- database stores, so the two cannot drift.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,

  -- NULL means it belongs to the installation rather than to a person.
  owner_id      UUID REFERENCES auth.users ON DELETE CASCADE,
  -- A view somebody may not delete, because a screen whose navigation
  -- can be emptied is a screen somebody gets locked out of.
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,

  -- 'board' | 'table' | 'list' | 'calendar' | 'timeline' | 'workload'.
  layout        TEXT NOT NULL DEFAULT 'table'
                  CHECK (layout IN ('board','table','list','calendar','timeline','workload')),

  -- What the columns of a board are, or the sections of a list:
  -- 'status' | 'assignee' | 'priority' | 'project' | 'department' |
  -- 'due' | 'label' | 'none'.
  group_by      TEXT NOT NULL DEFAULT 'status',
  -- A second level, so a board can be assignee within status.
  sub_group_by  TEXT,

  -- [{ field, dir }]. An array because "priority then due date" is the
  -- normal way people sort work and one column cannot express it.
  sort          JSONB NOT NULL DEFAULT '[{"field":"due_at","dir":"asc"}]',

  -- The filter tree. See the comment above.
  filter        JSONB NOT NULL DEFAULT '{"all":[]}',

  -- Which fields to show, in order. The table layout reads it as
  -- columns; the board reads it as what appears on a card.
  fields        JSONB NOT NULL DEFAULT '["ref","title","assignee","status","priority","due_at"]',

  -- Per view display switches: card size, whether to show finished
  -- work, whether subtasks are nested under their parent or listed flat.
  options       JSONB NOT NULL DEFAULT '{}',

  -- Ordering in the sidebar of the Work screen.
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A personal view has an owner. A shared one does not, and is instead
  -- reachable through task_view_shares or by being a system view.
  CONSTRAINT task_views_system_has_no_owner CHECK (
    NOT (is_system AND owner_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_task_views_owner ON task_views (owner_id);

-- Who else can see somebody's view. Sharing to a department is the
-- common case: a head of department builds the view their team should
-- be working from, and shares it once rather than to each person.
CREATE TABLE IF NOT EXISTS task_view_shares (
  view_id       UUID NOT NULL REFERENCES task_views ON DELETE CASCADE,
  -- Exactly one of these is set, enforced below.
  user_id       UUID REFERENCES auth.users ON DELETE CASCADE,
  department_id UUID REFERENCES departments ON DELETE CASCADE,
  team_id       UUID REFERENCES teams ON DELETE CASCADE,
  -- Whether they may change it, or only look through it.
  can_edit      BOOLEAN NOT NULL DEFAULT FALSE,
  shared_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  shared_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_view_shares_one_target CHECK (
    (user_id IS NOT NULL)::int
  + (department_id IS NOT NULL)::int
  + (team_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_view_share_user
  ON task_view_shares (view_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_view_share_dept
  ON task_view_shares (view_id, department_id) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_view_share_team
  ON task_view_shares (view_id, team_id) WHERE team_id IS NOT NULL;

-- -------------------------------------------------------------
-- 10. Custom fields
--
-- The other half of why people reach for Notion: the fields they need
-- are never the fields they were given.
--
-- A definition table plus a values table, rather than a JSONB blob on
-- the task. The blob is easier to write and impossible to use: it
-- cannot be indexed usefully, a filter over it cannot be checked, and
-- nothing can tell you which tasks are missing a required field.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_field_defs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE
                  CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label         TEXT NOT NULL,
  help          TEXT,
  kind          TEXT NOT NULL
                  CHECK (kind IN ('text','number','date','select','multi_select','user','checkbox','url','money')),
  -- For select and multi_select: [{value,label,color}].
  options       JSONB NOT NULL DEFAULT '[]',
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Confine a field to one project, so a project can have its own
  -- vocabulary without every task everywhere growing a column.
  project_id    UUID REFERENCES projects ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  archived_at   TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_field_values (
  task_id       UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
  field_id      UUID NOT NULL REFERENCES task_field_defs ON DELETE CASCADE,
  -- One column per shape rather than everything as text, so a number
  -- sorts as a number and a date range query can use an index.
  value_text    TEXT,
  value_number  NUMERIC,
  value_date    DATE,
  value_bool    BOOLEAN,
  value_users   UUID[],
  value_list    TEXT[],
  set_by        UUID REFERENCES auth.users ON DELETE SET NULL,
  set_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_task_field_values_field ON task_field_values (field_id);

-- -------------------------------------------------------------
-- 11. Owning entity, classification, commercially sensitive and soft delete
--
-- Migration 045's helper, on everything that carries meaning of its
-- own. A comment is deliberately included: "the auditors have asked
-- about the Q3 filing" is commercially sensitive whether it is written in a task or
-- underneath one.
-- -------------------------------------------------------------
SELECT add_record_columns('projects');
SELECT add_record_columns('milestones');
SELECT add_record_columns('tasks');
SELECT add_record_columns('task_comments');

INSERT INTO record_tables (table_name) VALUES
  ('projects'), ('milestones'), ('tasks'), ('task_comments')
ON CONFLICT DO NOTHING;

-- The two indexes that could not be created with the table, because the
-- column they filter on did not exist until the line above.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_id)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_dept     ON tasks (assignee_dept_id) WHERE deleted_at IS NULL;

-- -------------------------------------------------------------
-- 12. The reference somebody says out loud
--
-- Per project where there is one, so a project's work numbers from 1
-- and stays legible. Work with no project falls back to a global
-- sequence under a fixed prefix.
-- -------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS task_ref_seq;

CREATE OR REPLACE FUNCTION task_assign_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  prefix TEXT;
  n      BIGINT;
BEGIN
  IF NEW.ref IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT upper(left(regexp_replace(p.key, '[^A-Za-z0-9]', '', 'g'), 4))
      INTO prefix FROM projects p WHERE p.id = NEW.project_id;
    SELECT COUNT(*) + 1 INTO n FROM tasks WHERE project_id = NEW.project_id;
  END IF;

  IF prefix IS NULL OR prefix = '' THEN
    prefix := 'WORK';
    n := nextval('task_ref_seq');
  END IF;

  NEW.ref := prefix || '-' || n::TEXT;
  -- A project whose count collided with an existing ref, which happens
  -- when work has been deleted. Fall back rather than fail the insert.
  WHILE EXISTS (SELECT 1 FROM tasks WHERE ref = NEW.ref) LOOP
    n := n + 1;
    NEW.ref := prefix || '-' || n::TEXT;
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_task_ref ON tasks;
CREATE TRIGGER trg_task_ref BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_assign_ref();

-- -------------------------------------------------------------
-- 13. A subtask tree that is a tree
--
-- The CHECK constraint stops a task being its own parent. It cannot see
-- A -> B -> A, and a cycle there is not a data curiosity: every reader
-- that walks the tree hangs.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_parent_is_acyclic()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  walker UUID := NEW.parent_id;
  hops   INT := 0;
BEGIN
  WHILE walker IS NOT NULL LOOP
    IF walker = NEW.id THEN
      RAISE EXCEPTION 'that would make % a descendant of itself', NEW.ref;
    END IF;
    hops := hops + 1;
    IF hops > 50 THEN
      RAISE EXCEPTION 'subtasks are nested deeper than 50, which is a loop or a mistake';
    END IF;
    SELECT parent_id INTO walker FROM tasks WHERE id = walker;
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_task_acyclic ON tasks;
CREATE TRIGGER trg_task_acyclic BEFORE INSERT OR UPDATE OF parent_id ON tasks
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION task_parent_is_acyclic();

-- The same for dependency edges. A blocks B blocks A is a deadlock
-- somebody has to notice, and noticing it at write time costs one walk.
CREATE OR REPLACE FUNCTION task_link_is_acyclic()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.kind <> 'blocks' THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT to_task FROM task_links WHERE from_task = NEW.to_task AND kind = 'blocks'
      UNION
      SELECT l.to_task FROM task_links l JOIN chain c ON l.from_task = c.id
       WHERE l.kind = 'blocks'
    )
    SELECT 1 FROM chain WHERE id = NEW.from_task
  ) THEN
    RAISE EXCEPTION 'that dependency closes a loop, so neither task could ever start';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_task_link_acyclic ON task_links;
CREATE TRIGGER trg_task_link_acyclic BEFORE INSERT OR UPDATE ON task_links
  FOR EACH ROW EXECUTE FUNCTION task_link_is_acyclic();

-- -------------------------------------------------------------
-- 14. Timestamps that mean what they say
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := NOW();

  -- The first time it moves off the backlog, that is when it started.
  IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at := NOW();
  END IF;

  -- Finishing and unfinishing, kept consistent with the CHECK above so
  -- a caller never has to set two columns to mean one thing.
  IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
    NEW.completed_by := COALESCE(NEW.completed_by, current_actor());
  END IF;
  IF NEW.status <> 'done' AND NEW.completed_at IS NOT NULL THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;

  -- How long it has been stuck, which is the number that makes a
  -- blocked task visible rather than merely labelled.
  IF NEW.status = 'blocked' AND (TG_OP = 'INSERT' OR OLD.status <> 'blocked') THEN
    NEW.blocked_since := NOW();
  END IF;
  IF NEW.status <> 'blocked' THEN
    NEW.blocked_since := NULL;
  END IF;

  IF NEW.original_due_at IS NULL AND NEW.due_at IS NOT NULL THEN
    NEW.original_due_at := NEW.due_at;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_task_touch ON tasks;
CREATE TRIGGER trg_task_touch BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_touch();

-- -------------------------------------------------------------
-- 15. Capabilities
--
-- Into the catalog from migration 058, so the granular permissions
-- screen picks them up with no further work. Every one names what it
-- lets a person do in the words the person would use.
-- -------------------------------------------------------------
INSERT INTO capability_catalog (key, label, description, area, feature, danger, requires, scoped, position) VALUES

('work.view',            'See the Work tab',            'Open Work and see the tasks they are allowed to see.', 'Work', 'Access', 'routine', '{}', TRUE, 10),
('work.viewAll',         'See everybody''s work',       'See every task in the company, not only their own and their department''s.', 'Work', 'Access', 'sensitive', '{work.view}', FALSE, 20),
('work.viewDepartment',  'See their department''s work', 'See everything assigned to their own department.', 'Work', 'Access', 'routine', '{work.view}', FALSE, 30),

('work.create',          'Raise a task',                'Create work for themselves.', 'Work', 'Tasks', 'routine', '{work.view}', FALSE, 40),
('work.assignOthers',    'Assign work to a person',     'Put a task on somebody else. This is what makes them a delegator, and what the person receiving it can appeal to.', 'Work', 'Tasks', 'sensitive', '{work.create}', FALSE, 50),
('work.assignDepartment','Assign work to a department', 'Task a whole department rather than a named person, leaving the head of it to place it.', 'Work', 'Tasks', 'sensitive', '{work.create}', FALSE, 60),
('work.edit',            'Change a task',               'Edit the fields of a task they can see.', 'Work', 'Tasks', 'routine', '{work.view}', TRUE, 70),
('work.editAny',         'Change anybody''s task',      'Edit a task they neither raised nor were assigned.', 'Work', 'Tasks', 'sensitive', '{work.edit}', FALSE, 80),
('work.reassign',        'Move work between people',    'Take a task off one person and give it to another.', 'Work', 'Tasks', 'sensitive', '{work.edit}', FALSE, 90),
('work.setDue',          'Change a due date',           'Move a deadline. Separate from editing because a date somebody else committed to is not an ordinary field.', 'Work', 'Tasks', 'sensitive', '{work.edit}', FALSE, 100),
('work.delete',          'Remove a task',               'Delete a task. Recoverable, but it leaves every list until somebody restores it.', 'Work', 'Tasks', 'destructive', '{work.edit}', FALSE, 110),

('work.requestRelease',  'Ask to be let off a task',    'Ask whoever assigned it to cancel it, pass it on, or move the date. Everybody who can be assigned work needs this.', 'Work', 'Delegation', 'routine', '{work.view}', FALSE, 120),
('work.decideRelease',   'Answer those requests',       'Grant or refuse a request to cancel, reassign or extend work they delegated.', 'Work', 'Delegation', 'sensitive', '{work.assignOthers}', FALSE, 130),
('work.forceRelease',    'Override a delegator',        'Decide a release request on somebody else''s delegated task, for when the delegator has left or is away.', 'Work', 'Delegation', 'sensitive', '{work.decideRelease}', FALSE, 140),

('work.review',          'Review finished work',        'Accept or send back a task that is in review.', 'Work', 'Approval', 'routine', '{work.view}', FALSE, 150),
('work.approve',         'Approve work',                'Give the approval a task is waiting on.', 'Work', 'Approval', 'sensitive', '{work.view}', FALSE, 160),

('work.projects',        'See projects',                'Open the project, workstream and milestone structure.', 'Work', 'Projects', 'routine', '{work.view}', FALSE, 170),
('work.manageProjects',  'Run projects',                'Create and change projects, workstreams and milestones, and set project health.', 'Work', 'Projects', 'sensitive', '{work.projects}', FALSE, 180),
('work.publishProject',  'Put a project on the public tracker', 'Mark a project or milestone as publicly visible. What this exposes leaves the company.', 'Work', 'Projects', 'sensitive', '{work.manageProjects}', FALSE, 190),

('work.views',           'Build views',                 'Make saved views of the work list, with their own grouping, filtering and columns.', 'Work', 'Views', 'routine', '{work.view}', FALSE, 200),
('work.shareViews',      'Share a view',                'Share a saved view with a person, a team or a whole department.', 'Work', 'Views', 'routine', '{work.views}', FALSE, 210),
('work.manageFields',    'Add custom fields',           'Define new fields on tasks, for the whole installation or for one project.', 'Work', 'Views', 'sensitive', '{work.view}', FALSE, 220),
('work.manageSystemViews','Change the built in views',  'Edit or reorder the views everybody starts with.', 'Work', 'Views', 'sensitive', '{work.manageFields}', FALSE, 230),

('work.schedule',        'Schedule recurring work',     'Set up work that repeats, and pause or end it.', 'Work', 'Scheduling', 'sensitive', '{work.assignOthers}', FALSE, 240),
('work.rollback',        'Undo a batch of work',        'Reverse a set of tasks created in one action, such as everything a call transcript proposed.', 'Work', 'Scheduling', 'destructive', '{work.assignOthers}', FALSE, 250),

('work.analytics',       'See work analytics',          'Throughput, cycle time, where work is stuck and who is carrying it.', 'Work', 'Analysis', 'routine', '{work.view}', FALSE, 260),
('work.analyticsAll',    'See analytics for everybody', 'The same figures across every department rather than their own.', 'Work', 'Analysis', 'sensitive', '{work.analytics}', FALSE, 270),

/* Cross cutting rather than Work's own, and defined here because Work
   is the first module to need it. Migration 045 gave every record an
   sensitivity flag and nothing yet decided who may read a record carrying one,
   which meant the flag marked information without withholding it.
   from the meeting, 4.1: this is the inside of the wall. */
('compliance.sensitive',      'Read commercially sensitive information', 'Open records flagged as commercially sensitive. This is the inside of the information barrier, and everyone holding it belongs on an insider list.', 'Compliance', 'Information barrier', 'sensitive', '{}', FALSE, 10)

ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      area = EXCLUDED.area,
      feature = EXCLUDED.feature,
      danger = EXCLUDED.danger,
      requires = EXCLUDED.requires,
      scoped = EXCLUDED.scoped,
      position = EXCLUDED.position;

-- Which roles hold these is NOT seeded here.
--
-- `016_capability_roles_seed.sql` is generated from
-- `lib/crm/permissions.ts` and replaces `command_capability_roles`
-- wholesale, which is the mechanism that makes a revoked grant actually
-- go away. A second INSERT here would run afterwards and quietly put
-- back anything that had just been revoked, so the grants for these
-- capabilities live in that generated file with all the others.
--
--   npm run gen:writable-columns    rewrites it from the registry
--   npm run check:writable-columns  fails if it has gone stale

-- -------------------------------------------------------------
-- 16. Who can reach a task
--
-- One function, called by every policy, so the rule exists once. It
-- fails closed: an unauthenticated caller reaches nothing.
--
-- The order matters and is deliberate. Sensitivity is checked FIRST,
-- because a confidential task should not become readable merely because
-- somebody was named on it, and sensitivity is checked before anything else at
-- all. Only then does involvement or reach widen it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_reach_task(
  p_task            UUID,
  p_assignee        UUID,
  p_assignee_dept   UUID,
  p_created_by      UUID,
  p_delegated_by    UUID,
  p_reviewer        UUID,
  p_approver        UUID,
  p_classification  TEXT,
  p_is_sensitive         BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $fn$
  SELECT CASE
    WHEN current_actor() IS NULL THEN FALSE

    /* Commercially sensitive information. from the meeting, 4.1. Being named on
       a task is not a reason to be inside the wall; an insider list is.
       Checked before everything, including "I created it". */
    WHEN p_is_sensitive AND NOT command_may('compliance.sensitive') THEN FALSE

    /* Secret work is reachable only by the people actually doing it,
       whatever else they are allowed. */
    WHEN classification_rank(p_classification) >= classification_rank('secret')
     AND current_actor() NOT IN (p_assignee, p_created_by, p_delegated_by, p_reviewer, p_approver)
     THEN FALSE

    /* From here it is ordinary work. Anybody named on it can see it. */
    WHEN current_actor() IN (p_assignee, p_created_by, p_delegated_by, p_reviewer, p_approver) THEN TRUE

    /* A collaborator or a watcher was added on purpose. */
    WHEN EXISTS (
      SELECT 1 FROM task_participants tp
       WHERE tp.task_id = p_task AND tp.user_id = current_actor()
    ) THEN TRUE

    /* Work aimed at a department, seen by that department. */
    WHEN p_assignee_dept IS NOT NULL
     AND command_may('work.viewDepartment')
     AND p_assignee_dept = actor_department() THEN TRUE

    WHEN command_may('work.viewAll') THEN TRUE
    ELSE FALSE
  END
$fn$;

REVOKE ALL ON FUNCTION can_reach_task(UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_task(UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,BOOLEAN) TO authenticated;

-- A shorthand for the policies on the child tables, which all have to
-- ask the same question about their parent.
CREATE OR REPLACE FUNCTION can_reach_task_id(p_task UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM tasks t
     WHERE t.id = p_task
       AND t.deleted_at IS NULL
       AND can_reach_task(t.id, t.assignee_id, t.assignee_dept_id, t.created_by,
                          t.delegated_by, t.reviewer_id, t.approver_id,
                          t.classification::TEXT, t.is_sensitive)
  )
$fn$;
REVOKE ALL ON FUNCTION can_reach_task_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_task_id(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 17. Policies
--
-- Every table below is RLS on with no default grant. The writes that
-- matter go through the functions in migration 057 rather than through
-- a policy, because "may I reassign this" is a rule with several parts
-- and a USING clause is the wrong place to hold it.
-- -------------------------------------------------------------
ALTER TABLE projects                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE workstreams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_participants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links               ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_criteria            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_labels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_label_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_delegation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_batches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_recurrences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_field_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_views               ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_view_shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_field_defs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_field_values        ENABLE ROW LEVEL SECURITY;

-- ---- tasks ----
DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (
  deleted_at IS NULL
  AND can_reach_task(id, assignee_id, assignee_dept_id, created_by,
                     delegated_by, reviewer_id, approver_id,
                     classification::TEXT, is_sensitive)
);

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (
  command_may('work.create')
  AND created_by = current_actor()
  /* Putting work on somebody else is a different permission from
     raising your own, and this is where that is enforced rather than in
     the screen that offers the field. */
  AND (assignee_kind <> 'person'     OR assignee_id = current_actor() OR command_may('work.assignOthers'))
  AND (assignee_kind <> 'department' OR command_may('work.assignDepartment'))
  AND (assignee_kind <> 'team'       OR command_may('work.assignDepartment'))
);

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (
  deleted_at IS NULL
  AND command_may('work.edit')
  AND (
    command_may('work.editAny')
    OR current_actor() IN (assignee_id, created_by, delegated_by, reviewer_id, approver_id)
    OR EXISTS (SELECT 1 FROM task_participants tp
                WHERE tp.task_id = tasks.id AND tp.user_id = current_actor()
                  AND tp.role = 'collaborator')
  )
);

/* No DELETE policy at all. Work is soft deleted through
   `soft_delete('tasks', id)` from migration 056, which keeps the row,
   the history and anything hanging off it. A hard delete would take the
   audit trail with it. */

-- ---- the children, which inherit their parent's reach ----
DROP POLICY IF EXISTS task_participants_all ON task_participants;
CREATE POLICY task_participants_all ON task_participants
  FOR ALL USING (can_reach_task_id(task_id))
  WITH CHECK (can_reach_task_id(task_id) AND command_may('work.edit'));

DROP POLICY IF EXISTS task_links_all ON task_links;
CREATE POLICY task_links_all ON task_links
  FOR ALL USING (can_reach_task_id(from_task) AND can_reach_task_id(to_task))
  WITH CHECK (can_reach_task_id(from_task) AND can_reach_task_id(to_task) AND command_may('work.edit'));

DROP POLICY IF EXISTS task_criteria_all ON task_criteria;
CREATE POLICY task_criteria_all ON task_criteria
  FOR ALL USING (can_reach_task_id(task_id))
  WITH CHECK (can_reach_task_id(task_id) AND command_may('work.edit'));

DROP POLICY IF EXISTS task_comments_select ON task_comments;
CREATE POLICY task_comments_select ON task_comments
  FOR SELECT USING (deleted_at IS NULL AND can_reach_task_id(task_id));

DROP POLICY IF EXISTS task_comments_insert ON task_comments;
CREATE POLICY task_comments_insert ON task_comments
  FOR INSERT WITH CHECK (can_reach_task_id(task_id) AND author_id = current_actor());

/* Editing somebody else's words is not a thing, whatever else you can
   do. Only the author, and the edit is stamped. */
DROP POLICY IF EXISTS task_comments_update ON task_comments;
CREATE POLICY task_comments_update ON task_comments
  FOR UPDATE USING (author_id = current_actor() AND deleted_at IS NULL);

DROP POLICY IF EXISTS task_labels_read ON task_labels;
CREATE POLICY task_labels_read ON task_labels FOR SELECT USING (current_actor() IS NOT NULL);
DROP POLICY IF EXISTS task_labels_write ON task_labels;
CREATE POLICY task_labels_write ON task_labels FOR ALL
  USING (command_may('work.edit')) WITH CHECK (command_may('work.edit'));

DROP POLICY IF EXISTS task_label_links_all ON task_label_links;
CREATE POLICY task_label_links_all ON task_label_links
  FOR ALL USING (can_reach_task_id(task_id))
  WITH CHECK (can_reach_task_id(task_id) AND command_may('work.edit'));

DROP POLICY IF EXISTS task_history_read ON task_field_history;
CREATE POLICY task_history_read ON task_field_history
  FOR SELECT USING (can_reach_task_id(task_id));
/* Written by the workflow functions only. History nobody can edit is
   the only kind worth keeping. */
REVOKE INSERT, UPDATE, DELETE ON task_field_history FROM authenticated, anon;

-- ---- delegation requests ----
-- Visible to the two people it is between, and to anybody who could be
-- called on to decide it. A request nobody can see is a request nobody
-- answers.
DROP POLICY IF EXISTS deleg_select ON task_delegation_requests;
CREATE POLICY deleg_select ON task_delegation_requests FOR SELECT USING (
  asked_by = current_actor()
  OR asked_of = current_actor()
  OR command_may('work.forceRelease')
  OR can_reach_task_id(task_id)
);

DROP POLICY IF EXISTS deleg_insert ON task_delegation_requests;
CREATE POLICY deleg_insert ON task_delegation_requests FOR INSERT WITH CHECK (
  command_may('work.requestRelease')
  AND asked_by = current_actor()
  AND can_reach_task_id(task_id)
  /* You may only ask about work that is actually yours. Asking to be
     let off somebody else's task is not a thing. */
  AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id
      AND (t.assignee_id = current_actor()
           OR (t.assignee_dept_id IS NOT NULL AND t.assignee_dept_id = actor_department()))
  )
);

/* Deciding goes through `work_decide_release` in migration 057, which
   applies the outcome to the task in the same transaction. A policy
   that let the state column be set directly would leave a granted
   request with the work still sitting on the same person. */

-- ---- projects, workstreams, milestones ----
DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT USING (
  deleted_at IS NULL AND command_may('work.projects')
  AND (NOT is_sensitive OR command_may('compliance.sensitive'))
);
DROP POLICY IF EXISTS projects_write ON projects;
CREATE POLICY projects_write ON projects FOR ALL
  USING (command_may('work.manageProjects'))
  WITH CHECK (command_may('work.manageProjects'));

DROP POLICY IF EXISTS workstreams_select ON workstreams;
CREATE POLICY workstreams_select ON workstreams FOR SELECT USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id)
);
DROP POLICY IF EXISTS workstreams_write ON workstreams;
CREATE POLICY workstreams_write ON workstreams FOR ALL
  USING (command_may('work.manageProjects'))
  WITH CHECK (command_may('work.manageProjects'));

DROP POLICY IF EXISTS milestones_select ON milestones;
CREATE POLICY milestones_select ON milestones FOR SELECT USING (
  deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id)
);
DROP POLICY IF EXISTS milestones_write ON milestones;
CREATE POLICY milestones_write ON milestones FOR ALL
  USING (command_may('work.manageProjects'))
  WITH CHECK (command_may('work.manageProjects'));

-- ---- batches and recurrences ----
DROP POLICY IF EXISTS batches_select ON task_batches;
CREATE POLICY batches_select ON task_batches FOR SELECT USING (
  created_by = current_actor() OR command_may('work.rollback')
);
DROP POLICY IF EXISTS batches_insert ON task_batches;
CREATE POLICY batches_insert ON task_batches FOR INSERT
  WITH CHECK (created_by = current_actor() AND command_may('work.create'));

DROP POLICY IF EXISTS recur_select ON task_recurrences;
CREATE POLICY recur_select ON task_recurrences FOR SELECT USING (current_actor() IS NOT NULL);
DROP POLICY IF EXISTS recur_write ON task_recurrences;
CREATE POLICY recur_write ON task_recurrences FOR ALL
  USING (command_may('work.schedule')) WITH CHECK (command_may('work.schedule'));

-- ---- views ----
-- The rule that makes saved views usable: a view is reachable if it is
-- yours, if it ships with the product, or if somebody shared it with
-- you, your team or your department.
CREATE OR REPLACE FUNCTION can_reach_view(p_view UUID, p_owner UUID, p_system BOOLEAN)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $fn$
  SELECT CASE
    WHEN current_actor() IS NULL THEN FALSE
    WHEN p_system THEN TRUE
    WHEN p_owner = current_actor() THEN TRUE
    ELSE EXISTS (
      SELECT 1 FROM task_view_shares s
       WHERE s.view_id = p_view
         AND (s.user_id = current_actor()
              OR s.department_id = actor_department()
              OR s.team_id = ANY (actor_teams()))
    )
  END
$fn$;
REVOKE ALL ON FUNCTION can_reach_view(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_view(UUID, UUID, BOOLEAN) TO authenticated;

DROP POLICY IF EXISTS views_select ON task_views;
CREATE POLICY views_select ON task_views FOR SELECT
  USING (can_reach_view(id, owner_id, is_system));

DROP POLICY IF EXISTS views_insert ON task_views;
CREATE POLICY views_insert ON task_views FOR INSERT WITH CHECK (
  command_may('work.views')
  /* A person makes their own views. Making one that belongs to the
     installation is a different permission. */
  AND ((owner_id = current_actor() AND NOT is_system)
       OR command_may('work.manageSystemViews'))
);

DROP POLICY IF EXISTS views_update ON task_views;
CREATE POLICY views_update ON task_views FOR UPDATE USING (
  (owner_id = current_actor() AND command_may('work.views'))
  OR (is_system AND command_may('work.manageSystemViews'))
  OR EXISTS (SELECT 1 FROM task_view_shares s
              WHERE s.view_id = task_views.id AND s.can_edit
                AND (s.user_id = current_actor()
                     OR s.department_id = actor_department()
                     OR s.team_id = ANY (actor_teams())))
);

DROP POLICY IF EXISTS views_delete ON task_views;
CREATE POLICY views_delete ON task_views FOR DELETE USING (
  owner_id = current_actor() AND NOT is_system
);

DROP POLICY IF EXISTS view_shares_select ON task_view_shares;
CREATE POLICY view_shares_select ON task_view_shares FOR SELECT USING (
  EXISTS (SELECT 1 FROM task_views v WHERE v.id = view_id)
);
DROP POLICY IF EXISTS view_shares_write ON task_view_shares;
CREATE POLICY view_shares_write ON task_view_shares FOR ALL USING (
  command_may('work.shareViews')
  AND EXISTS (SELECT 1 FROM task_views v WHERE v.id = view_id AND v.owner_id = current_actor())
) WITH CHECK (
  command_may('work.shareViews')
  AND shared_by = current_actor()
  AND EXISTS (SELECT 1 FROM task_views v WHERE v.id = view_id AND v.owner_id = current_actor())
);

-- ---- custom fields ----
DROP POLICY IF EXISTS field_defs_select ON task_field_defs;
CREATE POLICY field_defs_select ON task_field_defs FOR SELECT USING (current_actor() IS NOT NULL);
DROP POLICY IF EXISTS field_defs_write ON task_field_defs;
CREATE POLICY field_defs_write ON task_field_defs FOR ALL
  USING (command_may('work.manageFields')) WITH CHECK (command_may('work.manageFields'));

DROP POLICY IF EXISTS field_values_all ON task_field_values;
CREATE POLICY field_values_all ON task_field_values
  FOR ALL USING (can_reach_task_id(task_id))
  WITH CHECK (can_reach_task_id(task_id) AND command_may('work.edit'));

-- -------------------------------------------------------------
-- 18. Grants
--
-- Supabase grants the full set on a new public table, so anything the
-- policies do not intend has to be taken back explicitly. Migration 048
-- found this the hard way with the capability catalog.
-- -------------------------------------------------------------
REVOKE ALL ON projects, workstreams, milestones, tasks, task_participants,
  task_links, task_criteria, task_comments, task_labels, task_label_links,
  task_delegation_requests, task_batches, task_recurrences, task_field_history,
  task_views, task_view_shares, task_field_defs, task_field_values
  FROM anon;

GRANT SELECT, INSERT, UPDATE ON projects, workstreams, milestones, tasks,
  task_participants, task_links, task_criteria, task_comments, task_labels,
  task_label_links, task_delegation_requests, task_batches, task_recurrences,
  task_views, task_view_shares, task_field_defs, task_field_values
  TO authenticated;

GRANT SELECT ON task_field_history TO authenticated;
GRANT DELETE ON task_participants, task_links, task_criteria, task_label_links,
  task_views, task_view_shares, task_field_values TO authenticated;
GRANT USAGE ON SEQUENCE task_ref_seq TO authenticated;

-- -------------------------------------------------------------
-- 19. The views everybody starts with
--
-- Scope 9.3 names ten. They are rows, not code, which is the claim this
-- file makes and has to keep: there is no branch anywhere that renders
-- "My Work" differently from a view somebody built this morning.
--
-- The filter grammar, in full:
--
--   { "all": [ ... ] }        every clause must hold
--   { "any": [ ... ] }        at least one must hold
--   { "not": { ... } }        the inverse
--   { "field": "...", "op": "...", "value": ... }
--
-- Operators: is, isNot, in, notIn, contains, gt, gte, lt, lte, isSet,
-- isNotSet, before, after, within.
--
-- Two values resolve per reader rather than being stored: "@me" is the
-- signed in person and "@myDepartment" is their department. That is
-- what lets one shared view mean the right thing for each person
-- looking at it, and it is the whole reason "My Work" is not fifty
-- rows, one per employee.
-- -------------------------------------------------------------
INSERT INTO task_views (name, description, icon, is_system, layout, group_by, sort, filter, fields, options, position) VALUES

('My work', 'Everything on you right now, soonest first.', 'user', TRUE, 'list', 'due',
 '[{"field":"due_at","dir":"asc"},{"field":"priority","dir":"asc"}]',
 '{"all":[{"field":"assignee_id","op":"is","value":"@me"},{"field":"status","op":"notIn","value":["done","cancelled"]}]}',
 '["ref","title","project","priority","due_at","status"]',
 '{"showDone":false,"nestSubtasks":true}', 10),

('My board', 'The same work as a board, so it can be dragged.', 'columns', TRUE, 'board', 'status',
 '[{"field":"board_position","dir":"asc"}]',
 '{"all":[{"field":"assignee_id","op":"is","value":"@me"}]}',
 '["title","priority","due_at","labels"]',
 '{"cardSize":"comfortable"}', 20),

('Team work', 'Everything your team is carrying, grouped by who has it.', 'users', TRUE, 'board', 'assignee',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"status","op":"notIn","value":["done","cancelled"]}]}',
 '["ref","title","status","priority","due_at"]', '{}', 30),

('Department work', 'Work aimed at your department, including anything not yet placed on a person.', 'building', TRUE, 'table', 'status',
 '[{"field":"priority","dir":"asc"},{"field":"due_at","dir":"asc"}]',
 '{"any":[{"field":"assignee_dept_id","op":"is","value":"@myDepartment"},{"field":"department_id","op":"is","value":"@myDepartment"}]}',
 '["ref","title","assignee","status","priority","due_at","project"]', '{}', 40),

('Assigned by me', 'What you have put on other people, and where it has got to.', 'send', TRUE, 'table', 'assignee',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"delegated_by","op":"is","value":"@me"},{"field":"status","op":"notIn","value":["done","cancelled"]}]}',
 '["ref","title","assignee","status","due_at","blocked_reason"]', '{}', 50),

('Waiting for me', 'Reviews, approvals and release requests that will not move until you look.', 'inbox', TRUE, 'list', 'none',
 '[{"field":"due_at","dir":"asc"}]',
 '{"any":[{"field":"reviewer_id","op":"is","value":"@me"},{"field":"approver_id","op":"is","value":"@me"},{"field":"release_asked_of","op":"is","value":"@me"}]}',
 '["ref","title","assignee","status","due_at"]',
 '{"showReleaseRequests":true}', 60),

('Blocked', 'Everything stuck, oldest first, because the longest stuck is the one nobody is looking at.', 'alert', TRUE, 'table', 'department',
 '[{"field":"blocked_since","dir":"asc"}]',
 '{"all":[{"field":"status","op":"in","value":["blocked","waiting_external"]}]}',
 '["ref","title","assignee","blocked_since","blocked_reason","waiting_on"]', '{}', 70),

('Overdue', 'Past its date and not finished.', 'clock', TRUE, 'table', 'assignee',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"due_at","op":"before","value":"now"},{"field":"status","op":"notIn","value":["done","cancelled"]}]}',
 '["ref","title","assignee","due_at","original_due_at","priority"]', '{}', 80),

('This week', 'Due in the next seven days, as a calendar.', 'calendar', TRUE, 'calendar', 'none',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"due_at","op":"within","value":"7d"},{"field":"status","op":"notIn","value":["cancelled"]}]}',
 '["title","assignee","priority"]', '{}', 90),

('Workload', 'Who is carrying how much, for the next fortnight.', 'gauge', TRUE, 'workload', 'assignee',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"status","op":"notIn","value":["done","cancelled"]}]}',
 '["title","estimate_minutes","due_at"]',
 '{"horizonDays":14}', 100),

('Projects', 'Every project, its milestones and where each is against its target.', 'flag', TRUE, 'timeline', 'project',
 '[{"field":"due_at","dir":"asc"}]',
 '{"all":[{"field":"project_id","op":"isSet"}]}',
 '["ref","title","assignee","status","due_at"]', '{}', 110),

('Recently completed', 'Finished in the last month, newest first.', 'check', TRUE, 'list', 'none',
 '[{"field":"completed_at","dir":"desc"}]',
 '{"all":[{"field":"status","op":"is","value":"done"},{"field":"completed_at","op":"within","value":"-30d"}]}',
 '["ref","title","assignee","completed_at","project"]',
 '{"showDone":true}', 120)

ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------
-- 20. What the Work screen reads for its counts
--
-- One view, so the badge on a tab and the number inside it cannot
-- disagree. It is RLS aware because it selects from `tasks`, which
-- means each person's counts are their own without a WHERE clause here.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW my_work_counts AS
SELECT
  COUNT(*) FILTER (
    WHERE assignee_id = current_actor()
      AND status NOT IN ('done','cancelled')
  ) AS mine_open,
  COUNT(*) FILTER (
    WHERE assignee_id = current_actor()
      AND due_at < NOW() AND status NOT IN ('done','cancelled')
  ) AS mine_overdue,
  COUNT(*) FILTER (
    WHERE assignee_id = current_actor() AND status IN ('blocked','waiting_external')
  ) AS mine_blocked,
  COUNT(*) FILTER (
    WHERE delegated_by = current_actor() AND status NOT IN ('done','cancelled')
  ) AS assigned_by_me,
  COUNT(*) FILTER (
    WHERE (reviewer_id = current_actor() AND status = 'in_review')
       OR (approver_id = current_actor() AND status = 'in_review')
  ) AS waiting_on_me,
  COUNT(*) FILTER (
    WHERE assignee_dept_id = actor_department() AND status NOT IN ('done','cancelled')
  ) AS department_open
FROM tasks
WHERE deleted_at IS NULL;

GRANT SELECT ON my_work_counts TO authenticated;

COMMENT ON TABLE tasks IS
  'Work. Scope sections 9 and 14. Reachability is can_reach_task; every '
  'write that has a rule goes through a function in migration 057.';
COMMENT ON TABLE task_views IS
  'A saved view. The screen has no built in views of its own: the ones '
  'that ship are rows here with is_system set.';
COMMENT ON TABLE task_delegation_requests IS
  'Somebody asking to be let off work assigned to them. The reason this '
  'product is not a to-do list: delegation that cannot be answered is '
  'an instruction, and people route around it.';
