-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 049_content_model.sql. This repository already had a 049 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 049. Content: the model.
--
-- The Buffer replacement, first half. This is the data. The workflow
-- that moves a post through it is 050 and the measurement is 051, so
-- that each one can be read and each one can be broken deliberately to
-- prove its checks work.
--
-- ---- What was here before, and what happens to it ----
--
-- `social_posts` exists and works: content, a text array of platform
-- names, a date, a status, an author name, an image URL, a caption and
-- hashtags. `components/SocialPlanner.tsx` reads it, `command_create_post`
-- writes it, `008_writable_columns_seed` lists its editable columns and
-- 045 gave it classification, sensitivity flags and soft delete.
--
-- **None of that is replaced.** Every column stays, every existing
-- reader keeps working, and the columns this adds sit alongside. Where
-- an old column and a new one describe the same thing, a trigger keeps
-- the old one in step so nothing that reads it sees a stale value.
--
-- That matters more than it sounds. `platform TEXT[]` is what the
-- planner draws its tags from and what the command bar writes. Variants
-- are the better model and they do not get to break it.
--
-- ---- Why variants ----
--
-- One post is one idea. What goes out is different per network: X takes
-- 280 characters, LinkedIn takes three thousand, Instagram will not
-- take a post with no picture at all. Buffer calls it per platform
-- tailoring and it is the difference between a scheduler and a
-- composer.
--
-- So a post is the idea and a variant is what a channel receives. A
-- variant with no content of its own uses the post's, which is the
-- common case and stays one field to edit.
--
-- ---- Why networks are rows ----
--
-- Character limits, media counts and whether a network accepts a first
-- comment are facts about the network, and they change: X moved its
-- limit twice. As rows, the composer enforces the current one and a
-- change is an update rather than a deployment.
--
-- ---- Permissions ----
--
-- Every policy here reads the capabilities added in 048. Two of them go
-- through a helper that also accepts the older, coarser `marketing.*`
-- pair, because every account in this installation is still authorized
-- by the legacy role seed and none of them holds the new capabilities
-- yet. Without that, this migration would take Content away from every
-- person who has it today. See `may_write_content` below.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Who may work on content.
--
-- The fine grained capability, or the coarse one it grew out of.
--
-- This is a compatibility path and it is written as one. `marketing.edit`
-- is what today's marketer role holds through the legacy seed in
-- migration 016. Reading only `social.draft` here would mean that on
-- the day this migration runs, every person who can write a post stops
-- being able to, and the screen would look like the feature had been
-- removed.
--
-- It comes out when every account holds a role template, which is the
-- same condition migration 059 attaches to removing `command_may`'s
-- own legacy step. Neither goes before the other.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION may_write_content()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $fn$
  SELECT command_may('social.draft') OR command_may('marketing.edit');
$fn$;

CREATE OR REPLACE FUNCTION may_approve_content()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $fn$
  SELECT command_may('social.approve') OR command_may('marketing.approve');
$fn$;

-- Reading Content. Everybody who can reach the CRM can read what the
-- company is publishing: it is company communication, not a secret, and
-- a planner only some people can see is a planner nobody plans with.
CREATE OR REPLACE FUNCTION may_read_content()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $fn$
  SELECT command_may('social.view') OR command_may('marketing.edit')
      OR command_may('marketing.approve') OR command_may('crm.view');
$fn$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['may_write_content()', 'may_approve_content()', 'may_read_content()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 1. The networks.
--
-- What each one accepts, as data. The composer counts characters
-- against `char_limit`, refuses to schedule an Instagram post with no
-- picture because of `requires_media`, and offers a first comment field
-- only where `supports_first_comment` is true.
--
-- Seeded with what Buffer covers plus Telegram and Discord, which
-- matter more to a layer 1 chain than Pinterest does and which neither
-- Buffer nor Sprinklr treats as first class.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_networks (
  key                    TEXT PRIMARY KEY,
  label                  TEXT NOT NULL,

  -- Characters the network accepts in the body.
  char_limit             INTEGER NOT NULL,
  -- Pictures per post. Zero means the network takes no media at all.
  media_max              INTEGER NOT NULL DEFAULT 0,
  -- Seconds of video. Zero means no video.
  video_max_seconds      INTEGER NOT NULL DEFAULT 0,

  -- A post without a picture cannot go out here.
  requires_media         BOOLEAN NOT NULL DEFAULT FALSE,
  -- The trick of putting links and tags in the first comment.
  supports_first_comment BOOLEAN NOT NULL DEFAULT FALSE,
  supports_thread        BOOLEAN NOT NULL DEFAULT FALSE,
  supports_alt_text      BOOLEAN NOT NULL DEFAULT TRUE,
  supports_link_preview  BOOLEAN NOT NULL DEFAULT TRUE,

  position               INTEGER NOT NULL DEFAULT 0,
  -- A network the company has stopped using keeps its row so that old
  -- posts still say where they went.
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO social_networks
  (key, label, char_limit, media_max, video_max_seconds, requires_media,
   supports_first_comment, supports_thread, supports_alt_text, supports_link_preview, position) VALUES
  ('x',         'X',                280,    4,  140, FALSE, FALSE, TRUE,  TRUE,  TRUE,  10),
  ('linkedin',  'LinkedIn',        3000,    9,  600, FALSE, TRUE,  FALSE, TRUE,  TRUE,  20),
  ('telegram',  'Telegram',        4096,   10,    0, FALSE, FALSE, FALSE, FALSE, TRUE,  30),
  ('discord',   'Discord',         2000,   10,    0, FALSE, FALSE, FALSE, FALSE, TRUE,  40),
  ('facebook',  'Facebook',       63206,   10, 14400, FALSE, TRUE,  FALSE, TRUE,  TRUE,  50),
  ('instagram', 'Instagram',       2200,   10,  900, TRUE,  TRUE,  FALSE, TRUE,  FALSE, 60),
  ('threads',   'Threads',          500,   10,  300, FALSE, FALSE, TRUE,  TRUE,  TRUE,  70),
  ('youtube',   'YouTube',         5000,    1,    0, TRUE,  TRUE,  FALSE, FALSE, TRUE,  80),
  ('tiktok',    'TikTok',          2200,    1,  600, TRUE,  FALSE, FALSE, FALSE, FALSE, 90),
  ('bluesky',   'Bluesky',          300,    4,   60, FALSE, FALSE, TRUE,  TRUE,  TRUE, 100),
  ('mastodon',  'Mastodon',         500,    4,    0, FALSE, FALSE, TRUE,  TRUE,  TRUE, 110),
  ('reddit',    'Reddit',         40000,   20,    0, FALSE, TRUE,  FALSE, TRUE,  TRUE, 120)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  char_limit = EXCLUDED.char_limit,
  media_max = EXCLUDED.media_max,
  video_max_seconds = EXCLUDED.video_max_seconds,
  requires_media = EXCLUDED.requires_media,
  supports_first_comment = EXCLUDED.supports_first_comment,
  supports_thread = EXCLUDED.supports_thread,
  supports_alt_text = EXCLUDED.supports_alt_text,
  supports_link_preview = EXCLUDED.supports_link_preview,
  position = EXCLUDED.position;

ALTER TABLE social_networks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "networks_read" ON social_networks;
CREATE POLICY "networks_read" ON social_networks
  FOR SELECT USING (current_actor() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON social_networks FROM authenticated, anon;
GRANT SELECT ON social_networks TO authenticated;

-- -------------------------------------------------------------
-- 2. The channels.
--
-- A connected account. One per network per handle, and both entities
-- can have their own: Frame posts as Frame, TCC posts as TCC, and the
-- planner shows both without either being able to publish as the other
-- by accident.
--
-- ---- Credentials ----
--
-- `credential_ref` is a NAME, not a secret. What it names is held in
-- the deployment's own secret store and never reaches a row, a log or a
-- browser. A table anybody with `social.view` can read is the last
-- place a posting token belongs, and the token is what would let
-- somebody publish as the company.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_channels (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  network_key    TEXT NOT NULL REFERENCES social_networks ON DELETE RESTRICT,

  -- What the account is called on the network, without the @.
  handle         TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  avatar_file_id UUID REFERENCES files ON DELETE SET NULL,
  profile_url    TEXT,

  entity_id      UUID REFERENCES entities ON DELETE SET NULL,

  -- The queue posts in this. A channel with a US audience and a channel
  -- with a European one do not share a best time to post.
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',

  state          TEXT NOT NULL DEFAULT 'disconnected'
                 CHECK (state IN ('connected', 'needs_reauth', 'disconnected')),
  -- The name of a secret, never the secret.
  credential_ref TEXT,
  state_changed_at TIMESTAMPTZ,
  last_error     TEXT,

  connected_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  connected_at   TIMESTAMPTZ,

  position       INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The same handle on the same network twice is a mistake somebody makes
-- once and then cannot tell which one published.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_handle
  ON social_channels (network_key, lower(handle)) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_channel_entity ON social_channels (entity_id, position);

-- -------------------------------------------------------------
-- 3. The queue.
--
-- Buffer's central idea, and the reason people use it rather than a
-- calendar: a channel has slots, and content flows into the next free
-- one instead of somebody choosing a time for every post.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_channel_slots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id  UUID NOT NULL REFERENCES social_channels ON DELETE CASCADE,
  -- 0 is Sunday, matching PostgreSQL's own `dow`, so a query does not
  -- have to translate.
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  at_time     TIME NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, day_of_week, at_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_channel
  ON social_channel_slots (channel_id, day_of_week, at_time) WHERE is_active;

-- -------------------------------------------------------------
-- 4. Campaigns.
--
-- Structure above the post, which Buffer does not have at all. A launch
-- has twenty posts across six channels over three weeks, and "how did
-- the launch do" is the question somebody actually asks.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_campaigns (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,60}$'),
  description TEXT,
  goal        TEXT,
  starts_on   DATE,
  ends_on     DATE,
  owner_id    UUID REFERENCES auth.users ON DELETE SET NULL,
  entity_id   UUID REFERENCES entities ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_campaign_dates ON social_campaigns (starts_on, ends_on) WHERE is_active;

-- -------------------------------------------------------------
-- 5. Templates.
--
-- What everybody starts from. A template is a body with the shape of a
-- post already in it, not a saved draft: saving a draft as a template
-- and editing the draft afterward must not change the template.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_templates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  body          TEXT NOT NULL,
  first_comment TEXT,
  -- Which networks it is written for. Empty means any.
  network_keys  TEXT[] NOT NULL DEFAULT '{}',
  hashtags      TEXT[] NOT NULL DEFAULT '{}',
  -- Shared templates are everybody's. A private one is a person's own
  -- shorthand and does not clutter the list for eleven other people.
  is_shared     BOOLEAN NOT NULL DEFAULT TRUE,
  use_count     INTEGER NOT NULL DEFAULT 0,
  entity_id     UUID REFERENCES entities ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_shared ON social_templates (is_shared, name) WHERE is_active;

-- -------------------------------------------------------------
-- 6. Tags.
--
-- How content is organized and, more usefully, how it is reported on:
-- Buffer's tag analytics answers "how does recruitment content do
-- against product content", which is a better question than "how did
-- Tuesday do".
--
-- ---- No color column, deliberately ----
--
-- The TCC kit's third rule is that color never carries data. A palette
-- of tag colors is exactly that, and it also fails the moment there are
-- more than eight tags. Tags are words.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_tags (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,40}$'),
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 7. The board.
--
-- The kanban planner. Columns are rows rather than an enum for the same
-- reason pipeline stages are: a company that wants a Legal column
-- between Review and Ready should get one without a deployment.
--
-- `maps_to_status` is what keeps the board honest. Moving a card into a
-- column is the same act as changing the post's status, so the two
-- cannot disagree.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_board_columns (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label          TEXT NOT NULL,
  description    TEXT,
  -- Which post status a card in this column has.
  maps_to_status TEXT NOT NULL,
  -- Buffer has no work in progress limit. A team of four with nineteen
  -- things in review does.
  wip_limit      INTEGER,
  position       INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO social_board_columns (key, label, description, maps_to_status, wip_limit, position) VALUES
  ('ideas',     'Ideas',      'Written down, not written yet.',                     'draft',          NULL, 10),
  ('writing',   'Writing',    'Being drafted.',                                     'draft',          NULL, 20),
  ('review',    'In review',  'Waiting on somebody to approve or reject it.',        'pending_review', 12,  30),
  ('ready',     'Ready',      'Approved and waiting for a slot.',                    'approved',       NULL, 40),
  ('scheduled', 'Scheduled',  'In the queue with a time on it.',                    'scheduled',      NULL, 50),
  ('published', 'Published',  'Out. What happens next is measurement, not writing.', 'posted',         NULL, 60)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description,
  maps_to_status = EXCLUDED.maps_to_status, position = EXCLUDED.position;

-- -------------------------------------------------------------
-- 8. What `social_posts` gains.
--
-- Added, never replaced. Section headings above say why each one is
-- here rather than a comment per line.
-- -------------------------------------------------------------

-- Two new states. Nothing that exists changes meaning: `posted` still
-- means out, and is still what the planner and the command bar write.
--
--   publishing  handed to the network, no answer yet. Without it, a
--               network that takes nine seconds looks like a failure.
--   failed      the network refused it. A post that silently returns to
--               draft is a post nobody knows did not go out.
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft', 'pending_review', 'approved', 'scheduled',
                    'publishing', 'posted', 'failed'));

ALTER TABLE social_posts
  -- Who wrote it, as an account rather than a name. `created_by` stays:
  -- it is what the planner prints and what the command bar writes, and
  -- it is the only author eleven existing rows have.
  ADD COLUMN IF NOT EXISTS author_id       UUID REFERENCES auth.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_id  UUID REFERENCES auth.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_note  TEXT,
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason  TEXT,

  -- A time, not a day. `scheduled_date` stays and is kept in step by a
  -- trigger below, so every existing reader still gets a date.
  ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ,
  -- Whether that time came from the queue or a person chose it. The
  -- difference matters when a slot moves.
  ADD COLUMN IF NOT EXISTS from_queue      BOOLEAN NOT NULL DEFAULT FALSE,

  ADD COLUMN IF NOT EXISTS campaign_id     UUID REFERENCES social_campaigns ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id     UUID REFERENCES social_templates ON DELETE SET NULL,

  ADD COLUMN IF NOT EXISTS board_column_id UUID REFERENCES social_board_columns ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS board_position  INTEGER NOT NULL DEFAULT 0,

  -- The first comment trick, on the networks that support it.
  ADD COLUMN IF NOT EXISTS first_comment   TEXT,
  -- The link the post carries, and the tags generated for it rather
  -- than typed. 051 attributes a click back to this post.
  ADD COLUMN IF NOT EXISTS link_url        TEXT,
  ADD COLUMN IF NOT EXISTS utm_source      TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium      TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign    TEXT,
  ADD COLUMN IF NOT EXISTS utm_content     TEXT,

  -- Internal only. Never published, never included in an export that
  -- leaves the company.
  ADD COLUMN IF NOT EXISTS internal_note   TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_scheduled  ON social_posts (scheduled_at)
  WHERE deleted_at IS NULL AND scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_status     ON social_posts (status, scheduled_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_board      ON social_posts (board_column_id, board_position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_campaign   ON social_posts (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_author     ON social_posts (author_id, created_at DESC);

-- Existing rows get a board column matching the status they already
-- hold, so the board draws every post rather than only new ones.
UPDATE social_posts p
   SET board_column_id = c.id
  FROM social_board_columns c
 WHERE p.board_column_id IS NULL
   AND c.maps_to_status = p.status
   AND c.key <> 'ideas';

-- And an author, where their name still matches an account. Where it
-- does not, `created_by` remains the only answer and the screen shows
-- that rather than inventing one.
UPDATE social_posts p
   SET author_id = pr.id
  FROM profiles pr
 WHERE p.author_id IS NULL
   AND (lower(pr.full_name) = lower(p.created_by) OR lower(pr.email) = lower(p.created_by));

-- -------------------------------------------------------------
-- 9. Variants.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_post_variants (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id        UUID NOT NULL REFERENCES social_posts ON DELETE CASCADE,
  channel_id     UUID NOT NULL REFERENCES social_channels ON DELETE CASCADE,

  -- Null means "the post's own words". The common case, and it stays
  -- one field to edit rather than six copies to keep in step.
  content        TEXT,
  first_comment  TEXT,
  link_url       TEXT,

  -- Null means the post's time. Set means this channel goes out
  -- separately, which is how a US morning and a European morning are
  -- the same post at two times.
  scheduled_at   TIMESTAMPTZ,

  state          TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending', 'scheduled', 'publishing',
                                  'published', 'failed', 'skipped')),

  -- What the network called it, and where it ended up.
  external_id    TEXT,
  permalink      TEXT,
  published_at   TIMESTAMPTZ,
  failure_reason TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,

  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (post_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_post    ON social_post_variants (post_id, position);
CREATE INDEX IF NOT EXISTS idx_variant_channel ON social_post_variants (channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_variant_due     ON social_post_variants (scheduled_at)
  WHERE state IN ('pending', 'scheduled');

-- -------------------------------------------------------------
-- 10. Media, and the library.
--
-- Both point at `files` from migration 057 rather than holding bytes.
-- Research section 5: the asset store exists, has classification and
-- permissions on it, and building a second one inside Content is the
-- mistake to avoid.
--
-- `social_media` is a picture used by a post. `social_library` is a
-- picture the company keeps, whether or not anything has used it yet.
-- One file can be both, and the library's `use_count` is why: Sprinklr
-- identifies top performing media, which needs the asset to be a thing
-- rather than an attachment.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_media (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID NOT NULL REFERENCES social_posts ON DELETE CASCADE,
  -- Null means every variant uses it. Set means this channel only,
  -- which is how a square crop reaches Instagram and nowhere else.
  variant_id UUID REFERENCES social_post_variants ON DELETE CASCADE,
  file_id    UUID NOT NULL REFERENCES files ON DELETE RESTRICT,
  -- Not optional in spirit. The composer warns rather than blocks,
  -- because a warning that cannot be dismissed becomes a reason to
  -- paste the picture somewhere else.
  alt_text   TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_post ON social_media (post_id, position);
CREATE INDEX IF NOT EXISTS idx_media_file ON social_media (file_id);

CREATE TABLE IF NOT EXISTS social_library (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id      UUID NOT NULL REFERENCES files ON DELETE CASCADE UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  alt_text     TEXT,
  -- Sprinklr approves assets, not only posts. A logo lockup that has
  -- not been signed off should not reach a public account because
  -- somebody found it in a folder.
  approved_at  TIMESTAMPTZ,
  approved_by  UUID REFERENCES auth.users ON DELETE SET NULL,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  entity_id    UUID REFERENCES entities ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  added_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_active ON social_library (is_active, created_at DESC);

-- -------------------------------------------------------------
-- 11. Tag joins.
--
-- Posts, templates and library assets all take tags, which is what
-- makes "how does recruitment content do" answerable across all three.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_post_tags (
  post_id UUID NOT NULL REFERENCES social_posts ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES social_tags ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON social_post_tags (tag_id);

CREATE TABLE IF NOT EXISTS social_library_tags (
  library_id UUID NOT NULL REFERENCES social_library ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES social_tags ON DELETE CASCADE,
  PRIMARY KEY (library_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_library_tags_tag ON social_library_tags (tag_id);

CREATE TABLE IF NOT EXISTS social_template_tags (
  template_id UUID NOT NULL REFERENCES social_templates ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES social_tags ON DELETE CASCADE,
  PRIMARY KEY (template_id, tag_id)
);

-- -------------------------------------------------------------
-- 12. Keeping the old columns true.
--
-- `platform TEXT[]` and `scheduled_date DATE` are what the planner
-- draws and what `command_create_post` writes. Variants and
-- `scheduled_at` are the better model. Both are true at once, and the
-- trigger is what makes that a fact rather than a hope.
--
-- One direction only, deliberately: the new columns lead. A writer that
-- only knows the old ones still produces a correct row, because the
-- trigger leaves the old value alone when there is nothing new to
-- derive it from.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION social_post_sync_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  names TEXT[];
  col   UUID;
BEGIN
  IF NEW.scheduled_at IS NOT NULL THEN
    NEW.scheduled_date := NEW.scheduled_at::DATE;
  END IF;

  /* The board has to show every post, including ones written by the
     command bar and by the old composer, neither of which knows what a
     board column is. And a post whose status moved has to move with it,
     or approving something on one screen leaves the card sitting in
     review on another.

     Two conditions, both needed. The first puts a new post on the
     board. The second moves an existing card only when its column no
     longer matches its status, which is what lets somebody drag a card
     between Ideas and Writing, both of which are drafts, without it
     springing back. */
  IF NEW.board_column_id IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.status IS DISTINCT FROM OLD.status
         AND NOT EXISTS (
           SELECT 1 FROM social_board_columns c
            WHERE c.id = NEW.board_column_id AND c.maps_to_status = NEW.status))
  THEN
    SELECT c.id INTO col
      FROM social_board_columns c
     WHERE c.is_active AND c.maps_to_status = NEW.status AND c.key <> 'ideas'
     ORDER BY c.position
     LIMIT 1;
    IF col IS NOT NULL THEN
      NEW.board_column_id := col;
    END IF;
  END IF;

  SELECT array_agg(DISTINCT n.label ORDER BY n.label)
    INTO names
    FROM social_post_variants v
    JOIN social_channels c  ON c.id = v.channel_id
    JOIN social_networks n  ON n.key = c.network_key
   WHERE v.post_id = NEW.id;

  IF names IS NOT NULL THEN
    NEW.platform := names;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS social_post_legacy ON social_posts;
CREATE TRIGGER social_post_legacy
  BEFORE INSERT OR UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION social_post_sync_legacy();

-- Adding or removing a variant changes the answer, so the post is
-- touched to make the trigger above run again.
CREATE OR REPLACE FUNCTION social_variant_touches_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE social_posts SET updated_at = NOW()
   WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS social_variant_touch ON social_post_variants;
CREATE TRIGGER social_variant_touch
  AFTER INSERT OR UPDATE OR DELETE ON social_post_variants
  FOR EACH ROW EXECUTE FUNCTION social_variant_touches_post();

-- -------------------------------------------------------------
-- 13. Row level security.
--
-- Reading is wide, writing is narrow, and the narrow parts read the
-- capabilities from 048.
--
-- The existing `social_posts` policies are REPLACED here rather than
-- added to, and it is worth being explicit that this takes nothing
-- away: `may_write_content()` answers true for everybody
-- `current_role_safe() IN ('admin','marketer')` answered true for, and
-- also for anybody given the new capability. The check asserts exactly
-- that, both ways round.
-- -------------------------------------------------------------
DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_channels', 'social_channel_slots', 'social_campaigns',
    'social_templates', 'social_tags', 'social_board_columns',
    'social_post_variants', 'social_media', 'social_library',
    'social_post_tags', 'social_library_tags', 'social_template_tags'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END
$rls$;

-- ---- posts ----
-- Read: anybody who can reach Content. A planner only some people can
-- see is a planner nobody plans with.
DROP POLICY IF EXISTS "social_select" ON social_posts;
CREATE POLICY "social_select" ON social_posts
  FOR SELECT USING (may_read_content());

DROP POLICY IF EXISTS "social_insert" ON social_posts;
CREATE POLICY "social_insert" ON social_posts
  FOR INSERT WITH CHECK (may_write_content());

-- Write: your own always, anybody's with `social.editAny`, and the
-- approver so a rejection note can be written on somebody else's post.
DROP POLICY IF EXISTS "social_update" ON social_posts;
CREATE POLICY "social_update" ON social_posts
  FOR UPDATE USING (
    may_write_content()
    AND (
      author_id = current_actor()
      OR author_id IS NULL          -- rows written before authors existed
      OR command_may('social.editAny')
      OR command_may('marketing.edit')
      OR may_approve_content()
    )
  );

DROP POLICY IF EXISTS "social_delete" ON social_posts;
CREATE POLICY "social_delete" ON social_posts
  FOR DELETE USING (
    command_may('social.delete')
    OR (command_may('marketing.edit') AND current_role_safe() = 'admin')
  );

-- ---- channels ----
DROP POLICY IF EXISTS "channels_read" ON social_channels;
CREATE POLICY "channels_read" ON social_channels
  FOR SELECT USING (may_read_content());

DROP POLICY IF EXISTS "channels_write" ON social_channels;
CREATE POLICY "channels_write" ON social_channels
  FOR ALL USING (command_may('social.channels')) WITH CHECK (command_may('social.channels'));

DROP POLICY IF EXISTS "slots_read" ON social_channel_slots;
CREATE POLICY "slots_read" ON social_channel_slots
  FOR SELECT USING (may_read_content());

DROP POLICY IF EXISTS "slots_write" ON social_channel_slots;
CREATE POLICY "slots_write" ON social_channel_slots
  FOR ALL USING (command_may('social.channels')) WITH CHECK (command_may('social.channels'));

-- ---- campaigns, templates, tags ----
DROP POLICY IF EXISTS "campaigns_read" ON social_campaigns;
CREATE POLICY "campaigns_read" ON social_campaigns
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "campaigns_write" ON social_campaigns;
CREATE POLICY "campaigns_write" ON social_campaigns
  FOR ALL USING (may_write_content()) WITH CHECK (may_write_content());

-- A private template is its author's. A shared one is everybody's to
-- read and its author's or a template manager's to change.
DROP POLICY IF EXISTS "templates_read" ON social_templates;
CREATE POLICY "templates_read" ON social_templates
  FOR SELECT USING (may_read_content() AND (is_shared OR created_by = current_actor()));
DROP POLICY IF EXISTS "templates_insert" ON social_templates;
CREATE POLICY "templates_insert" ON social_templates
  FOR INSERT WITH CHECK (may_write_content());
DROP POLICY IF EXISTS "templates_update" ON social_templates;
CREATE POLICY "templates_update" ON social_templates
  FOR UPDATE USING (
    created_by = current_actor()
    OR command_may('social.templates')
    OR command_may('marketing.edit')
  );
DROP POLICY IF EXISTS "templates_delete" ON social_templates;
CREATE POLICY "templates_delete" ON social_templates
  FOR DELETE USING (created_by = current_actor() OR command_may('social.templates'));

DROP POLICY IF EXISTS "tags_read" ON social_tags;
CREATE POLICY "tags_read" ON social_tags
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "tags_write" ON social_tags;
CREATE POLICY "tags_write" ON social_tags
  FOR ALL USING (command_may('social.tags') OR command_may('marketing.edit'))
  WITH CHECK (command_may('social.tags') OR command_may('marketing.edit'));

DROP POLICY IF EXISTS "board_read" ON social_board_columns;
CREATE POLICY "board_read" ON social_board_columns
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "board_write" ON social_board_columns;
CREATE POLICY "board_write" ON social_board_columns
  FOR ALL USING (command_may('admin.settings')) WITH CHECK (command_may('admin.settings'));

-- ---- variants, media, joins ----
-- A variant is part of its post, so it follows the post's answer rather
-- than carrying a second, differently worded copy of it. Two policies
-- describing the same permission is how they drift.
CREATE OR REPLACE FUNCTION may_edit_post(p_post UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT may_write_content()
     AND EXISTS (
       SELECT 1 FROM social_posts p
        WHERE p.id = p_post
          AND (p.author_id = current_actor()
               OR p.author_id IS NULL
               OR command_may('social.editAny')
               OR command_may('marketing.edit')
               OR may_approve_content())
     );
$fn$;
REVOKE ALL ON FUNCTION may_edit_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION may_edit_post(UUID) TO authenticated;

DROP POLICY IF EXISTS "variants_read" ON social_post_variants;
CREATE POLICY "variants_read" ON social_post_variants
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "variants_write" ON social_post_variants;
CREATE POLICY "variants_write" ON social_post_variants
  FOR ALL USING (may_edit_post(post_id)) WITH CHECK (may_edit_post(post_id));

DROP POLICY IF EXISTS "media_read" ON social_media;
CREATE POLICY "media_read" ON social_media
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "media_write" ON social_media;
CREATE POLICY "media_write" ON social_media
  FOR ALL USING (may_edit_post(post_id)) WITH CHECK (may_edit_post(post_id));

DROP POLICY IF EXISTS "post_tags_read" ON social_post_tags;
CREATE POLICY "post_tags_read" ON social_post_tags
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "post_tags_write" ON social_post_tags;
CREATE POLICY "post_tags_write" ON social_post_tags
  FOR ALL USING (may_edit_post(post_id)) WITH CHECK (may_edit_post(post_id));

DROP POLICY IF EXISTS "library_read" ON social_library;
CREATE POLICY "library_read" ON social_library
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "library_write" ON social_library;
CREATE POLICY "library_write" ON social_library
  FOR ALL USING (command_may('social.library') OR command_may('marketing.edit'))
  WITH CHECK (command_may('social.library') OR command_may('marketing.edit'));

DROP POLICY IF EXISTS "library_tags_read" ON social_library_tags;
CREATE POLICY "library_tags_read" ON social_library_tags
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "library_tags_write" ON social_library_tags;
CREATE POLICY "library_tags_write" ON social_library_tags
  FOR ALL USING (command_may('social.library') OR command_may('marketing.edit'))
  WITH CHECK (command_may('social.library') OR command_may('marketing.edit'));

DROP POLICY IF EXISTS "template_tags_read" ON social_template_tags;
CREATE POLICY "template_tags_read" ON social_template_tags
  FOR SELECT USING (may_read_content());
DROP POLICY IF EXISTS "template_tags_write" ON social_template_tags;
CREATE POLICY "template_tags_write" ON social_template_tags
  FOR ALL USING (may_write_content()) WITH CHECK (may_write_content());

-- -------------------------------------------------------------
-- 14. The record columns.
--
-- Content is company communication from a business that gets audited's
-- subsidiary, so a campaign and a library asset carry the same
-- classification and soft delete every other substantive record does.
-- `add_record_columns` from 045 is what puts them there, so there is
-- one definition of what those columns are.
-- -------------------------------------------------------------
INSERT INTO record_tables (table_name) VALUES
  ('social_campaigns'), ('social_templates'), ('social_library'), ('social_channels')
ON CONFLICT DO NOTHING;

DO $rec$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_campaigns', 'social_templates', 'social_library', 'social_channels'] LOOP
    PERFORM add_record_columns(t);
  END LOOP;
END
$rec$;

-- -------------------------------------------------------------
-- 15. Editable by the command bar.
--
-- CLAUDE.md section 11: a column somebody should be able to change by
-- typing needs a row here, because `command_writable_columns` is the
-- only thing `/api/command/edit` will write, whatever a request says.
-- -------------------------------------------------------------
INSERT INTO command_writable_columns (table_name, column_name) VALUES
  ('social_posts', 'first_comment'),
  ('social_posts', 'internal_note'),
  ('social_posts', 'link_url'),
  ('social_posts', 'scheduled_at'),
  ('social_campaigns', 'name'),
  ('social_campaigns', 'goal'),
  ('social_campaigns', 'description'),
  ('social_templates', 'name'),
  ('social_templates', 'body'),
  ('social_tags', 'name')
ON CONFLICT DO NOTHING;
