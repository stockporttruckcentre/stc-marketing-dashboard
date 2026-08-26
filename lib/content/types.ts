/* =============================================================
   Content, in the shapes the screens use.

   One definition per thing, shared by the page that reads it on the
   server, the component that draws it and the routes that write it. A
   second copy is how a column added in a migration reaches two of the
   three.

   Nothing here decides a permission. `command_may()` in the database
   does, inside the same transaction as the write. What is here is what
   the interface needs in order not to offer a control that will then
   refuse, which CLAUDE.md section 11 is explicit about.
   ============================================================= */

export type NetworkKey =
  | 'x' | 'linkedin' | 'telegram' | 'discord' | 'facebook' | 'instagram'
  | 'threads' | 'youtube' | 'tiktok' | 'bluesky' | 'mastodon' | 'reddit';

export type Network = {
  key: NetworkKey;
  label: string;
  char_limit: number;
  media_max: number;
  video_max_seconds: number;
  requires_media: boolean;
  supports_first_comment: boolean;
  supports_thread: boolean;
  supports_alt_text: boolean;
  supports_link_preview: boolean;
  position: number;
  is_active: boolean;
};

export type ChannelState = 'connected' | 'needs_reauth' | 'disconnected';

export type Channel = {
  id: string;
  network_key: NetworkKey;
  handle: string;
  display_name: string;
  avatar_file_id: string | null;
  profile_url: string | null;
  entity_id: string | null;
  timezone: string;
  state: ChannelState;
  last_error: string | null;
  position: number;
  is_active: boolean;
};

export type Slot = {
  id: string;
  channel_id: string;
  /** 0 is Sunday, matching PostgreSQL's own `dow`. */
  day_of_week: number;
  at_time: string;
  is_active: boolean;
};

/**
 * Every state a post can be in.
 *
 * `posted` rather than `published` because that is what the column has
 * always held and what the planner and the command bar both write.
 * Renaming it would be a migration with no benefit and one screen's
 * worth of risk.
 */
export type PostStatus =
  | 'draft' | 'pending_review' | 'approved' | 'scheduled'
  | 'publishing' | 'posted' | 'failed';

export type VariantState =
  | 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'skipped';

export type LintSeverity = 'clean' | 'advisory' | 'blocking';

export type LintFinding = {
  rule: string;
  message: string;
  severity?: string;
  at?: number;
  length?: number;
  suggestion?: string;
};

export type Post = {
  id: string;
  content: string;
  caption: string | null;
  first_comment: string | null;
  hashtags: string[];
  /** The legacy array of network labels, kept true by a trigger. */
  platform: string[];
  image_url: string | null;

  status: PostStatus;
  scheduled_date: string;
  scheduled_at: string | null;
  from_queue: boolean;

  author_id: string | null;
  /** The author's name, which is the only one some old rows have. */
  created_by: string;
  reviewed_by: string | null;
  approved_by_id: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  published_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;

  campaign_id: string | null;
  template_id: string | null;
  board_column_id: string | null;
  board_position: number;

  link_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  internal_note: string | null;

  lint_severity: LintSeverity | null;
  lint_findings: LintFinding[] | null;
  lint_hash: string | null;
  lint_checked_at: string | null;

  classification: string;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
};

export type Variant = {
  id: string;
  post_id: string;
  channel_id: string;
  /** Null means "the post's own words". */
  content: string | null;
  first_comment: string | null;
  link_url: string | null;
  scheduled_at: string | null;
  state: VariantState;
  external_id: string | null;
  permalink: string | null;
  published_at: string | null;
  failure_reason: string | null;
  attempts: number;
  position: number;
};

export type BoardColumn = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  maps_to_status: PostStatus;
  wip_limit: number | null;
  position: number;
  is_active: boolean;
};

export type Campaign = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  goal: string | null;
  starts_on: string | null;
  ends_on: string | null;
  owner_id: string | null;
  is_active: boolean;
};

export type Template = {
  id: string;
  name: string;
  description: string | null;
  body: string;
  first_comment: string | null;
  network_keys: string[];
  hashtags: string[];
  is_shared: boolean;
  use_count: number;
  created_by: string | null;
  is_active: boolean;
};

export type Tag = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  is_active: boolean;
};

export type LibraryItem = {
  id: string;
  file_id: string;
  name: string;
  description: string | null;
  alt_text: string | null;
  approved_at: string | null;
  approved_by: string | null;
  use_count: number;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
};

/**
 * A company this installation posts for.
 *
 * One install, two companies: Stockport Truck Centre and STC Sales and
 * Leasing, seeded by migration 048. Every substantive record carries
 * which one owns it, so a channel belonging to one cannot be published
 * to as the other by accident.
 *
 * There is no chip variant per company here, deliberately. The kit's
 * first rule is that red points at one thing, and two branded chips
 * competing on the same card is exactly the noise that rule exists to
 * stop. The name goes in a neutral badge and reads the same either way.
 */
export type Entity = {
  id: string;
  code: string;
  name: string;
  ticker: string | null;
  is_default: boolean;
};

/** One line of the timeline, as `activity` holds it. */
export type ActivityLine = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_label: string | null;
  verb: string;
  subject_type: string;
  subject_id: string;
  subject_label: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  is_system: boolean;
};

/* -------------------------------------------------------------
   Words for states.

   In one place, because a status shown as "Pending review" on one
   screen and "In review" on another reads as two different things.
   ------------------------------------------------------------- */
export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  posted: 'Posted',
  failed: 'Failed',
};

export const VARIANT_LABEL: Record<VariantState, string> = {
  pending: 'Not scheduled',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* -------------------------------------------------------------
   Counting characters the way a network counts them.

   Not `content.length`. Every network counts a URL as a fixed width
   whatever its real length, because they shorten it themselves, and a
   composer that counts the raw string tells somebody they are 40 over
   when they are not.
   ------------------------------------------------------------- */

/** What each network charges for a link, regardless of its length. */
const LINK_WEIGHT: Partial<Record<NetworkKey, number>> = {
  x: 23,
  bluesky: 23,
};

const URL_PATTERN = /https?:\/\/\S+/g;

export function countFor(text: string, network: NetworkKey): number {
  const weight = LINK_WEIGHT[network];
  if (!weight) return [...text].length;

  let total = 0;
  let last = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    total += [...text.slice(last, m.index ?? 0)].length + weight;
    last = (m.index ?? 0) + m[0].length;
  }
  total += [...text.slice(last)].length;
  return total;
}

/** The words a channel would actually receive. */
export function bodyFor(post: Pick<Post, 'content'>, variant?: Pick<Variant, 'content'> | null): string {
  return variant?.content ?? post.content;
}

/* -------------------------------------------------------------
   Time
   ------------------------------------------------------------- */

/** "Tue 14 Oct, 9:00 AM", in the reader's own zone. */
export function whenLabel(iso: string | null, timezone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

export function dayLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/** Local YYYY-MM-DD, which is what a calendar cell is keyed by. */
export function dayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Which day a post belongs to, preferring the time over the date. */
export function postDay(post: Pick<Post, 'scheduled_at' | 'scheduled_date'>): string {
  return post.scheduled_at ? dayKey(post.scheduled_at) : post.scheduled_date;
}

/* -------------------------------------------------------------
   UTM tags, generated rather than typed.

   Sprinklr's model, and the reason attribution can name a post rather
   than a campaign: the tags are derived from what the post already is,
   so two people cannot spell the same campaign differently.
   ------------------------------------------------------------- */
export function utmFor(
  link: string,
  parts: { source: string; medium?: string; campaign?: string | null; content?: string | null },
): string {
  if (!link) return link;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  url.searchParams.set('utm_source', parts.source);
  url.searchParams.set('utm_medium', parts.medium ?? 'social');
  if (parts.campaign) url.searchParams.set('utm_campaign', parts.campaign);
  if (parts.content) url.searchParams.set('utm_content', parts.content);
  return url.toString();
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
