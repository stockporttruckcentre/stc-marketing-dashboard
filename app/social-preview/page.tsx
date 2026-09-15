'use client';

import { notFound } from 'next/navigation';
import { SocialPlanner } from '@/components/SocialPlanner';
import type {
  ActivityLine, BoardColumn, Campaign, Channel, LibraryItem,
  Network, Post, Slot, Tag, Template, Variant,
} from '@/lib/content/types';
import type { Profile } from '@/lib/types';

/* =============================================================
   The whole social planner, for driving. Dev only.

   From the business, about the planner going into use today:

     make it so images uploaded to social posts actually save and the
     whole thing is wired end to end

   The picture was one fault. "The whole thing" is nine tabs, and the
   only honest way to say every control on them works is to press every
   control on them. `/dashboard/social` cannot be driven without a
   Supabase session and real rows, so this mounts the same component
   with rows a check can predict.

   IT IS THE REAL COMPONENT. Nothing here is a stand in for a screen:
   the fixtures below are the props `app/dashboard/social/page.tsx`
   reads on the server, and everything drawn from them is the same code
   the marketing team uses.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

const NETWORKS: Network[] = [
  {
    key: 'linkedin', label: 'LinkedIn', char_limit: 3000, media_max: 9,
    video_max_seconds: 600, requires_media: false, supports_first_comment: true,
    supports_thread: false, supports_alt_text: true, supports_link_preview: true,
    position: 0, is_active: true,
  },
  {
    key: 'instagram', label: 'Instagram', char_limit: 2200, media_max: 10,
    video_max_seconds: 90, requires_media: true, supports_first_comment: true,
    supports_thread: false, supports_alt_text: true, supports_link_preview: false,
    position: 1, is_active: true,
  },
];

const CHANNELS: Channel[] = [
  {
    id: 'chan-1', network_key: 'linkedin', handle: 'stockport-truck-centre',
    display_name: 'STC LinkedIn', avatar_file_id: null, profile_url: null,
    entity_id: null, timezone: 'Europe/London', state: 'connected',
    last_error: null, position: 0, is_active: true,
  },
  {
    id: 'chan-2', network_key: 'instagram', handle: 'stctrucks',
    display_name: 'STC Instagram', avatar_file_id: null, profile_url: null,
    entity_id: null, timezone: 'Europe/London', state: 'needs_reauth',
    last_error: 'The token expired.', position: 1, is_active: true,
  },
];

const SLOTS: Slot[] = [
  { id: 'slot-1', channel_id: 'chan-1', day_of_week: 2, at_time: '09:00', is_active: true },
  { id: 'slot-2', channel_id: 'chan-1', day_of_week: 4, at_time: '14:30', is_active: true },
];

const COLUMNS: BoardColumn[] = [
  { id: 'col-1', key: 'draft', label: 'Draft', description: null, maps_to_status: 'draft', wip_limit: null, position: 0, is_active: true },
  { id: 'col-2', key: 'review', label: 'In review', description: null, maps_to_status: 'pending_review', wip_limit: 5, position: 1, is_active: true },
  { id: 'col-3', key: 'approved', label: 'Approved', description: null, maps_to_status: 'approved', wip_limit: null, position: 2, is_active: true },
  { id: 'col-4', key: 'scheduled', label: 'Scheduled', description: null, maps_to_status: 'scheduled', wip_limit: null, position: 3, is_active: true },
  { id: 'col-5', key: 'posted', label: 'Posted', description: null, maps_to_status: 'posted', wip_limit: null, position: 4, is_active: true },
];

const TODAY = '2026-09-15';

function post(over: Partial<Post> & Pick<Post, 'id' | 'content' | 'status'>): Post {
  return {
    caption: null, first_comment: null, hashtags: ['trucks'], platform: ['LinkedIn'],
    image_url: null, scheduled_date: TODAY, scheduled_at: null, from_queue: false,
    author_id: 'user-1', created_by: 'Dana Drafter', reviewed_by: null,
    approved_by_id: null, submitted_at: null, approved_at: null, rejected_at: null,
    rejection_note: null, published_at: null, failed_at: null, failure_reason: null,
    campaign_id: 'camp-1', template_id: null, board_column_id: 'col-1', board_position: 0,
    link_url: 'https://stockporttruckcentre.co.uk/offers',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
    internal_note: null, lint_severity: 'clean', lint_findings: [], lint_hash: null,
    lint_checked_at: null, classification: 'internal', is_sensitive: false,
    created_at: `${TODAY}T08:00:00Z`, updated_at: `${TODAY}T08:00:00Z`,
    ...over,
  };
}

/* One post in each state the screen draws differently, so every control
   that appears only for one status is on the screen to be pressed. */
const POSTS: Post[] = [
  post({ id: 'post-1', content: 'A curtainsider ready to go this week', status: 'draft' }),
  /* Written by somebody else on purpose. A post you wrote yourself
     hides Approve and Reject, correctly, and a sweep that only ever
     saw your own posts would never press either of them. */
  post({ id: 'post-2', content: 'Waiting on a yes from Business Development', status: 'pending_review', board_column_id: 'col-2', submitted_at: `${TODAY}T09:00:00Z`, author_id: 'user-2', created_by: 'Sam Someone' }),
  post({ id: 'post-3', content: 'Signed off and waiting for a slot', status: 'approved', board_column_id: 'col-3', approved_at: `${TODAY}T10:00:00Z`, approved_by_id: 'user-2' }),
  post({ id: 'post-4', content: 'Booked in for Thursday morning', status: 'scheduled', board_column_id: 'col-4', scheduled_at: `${TODAY}T14:30:00Z`, from_queue: true }),
  post({ id: 'post-5', content: 'Went out last week', status: 'posted', board_column_id: 'col-5', published_at: '2026-09-08T09:00:00Z' }),
  post({ id: 'post-6', content: 'This one did not go out', status: 'failed', failed_at: `${TODAY}T11:00:00Z`, failure_reason: 'The channel needs reconnecting.' }),
];

const VARIANTS: Variant[] = [
  { id: 'var-4', post_id: 'post-2', channel_id: 'chan-1', content: null, first_comment: null, link_url: null, scheduled_at: null, state: 'pending', external_id: null, permalink: null, published_at: null, failure_reason: null, attempts: 0, position: 0 },
  { id: 'var-1', post_id: 'post-1', channel_id: 'chan-1', content: null, first_comment: null, link_url: null, scheduled_at: null, state: 'pending', external_id: null, permalink: null, published_at: null, failure_reason: null, attempts: 0, position: 0 },
  { id: 'var-2', post_id: 'post-4', channel_id: 'chan-1', content: null, first_comment: null, link_url: null, scheduled_at: `${TODAY}T14:30:00Z`, state: 'scheduled', external_id: null, permalink: null, published_at: null, failure_reason: null, attempts: 0, position: 0 },
  { id: 'var-3', post_id: 'post-5', channel_id: 'chan-1', content: null, first_comment: null, link_url: null, scheduled_at: null, state: 'published', external_id: 'x1', permalink: 'https://www.linkedin.com/feed/update/1', published_at: '2026-09-08T09:00:00Z', failure_reason: null, attempts: 1, position: 0 },
];

const TEMPLATES: Template[] = [
  {
    id: 'tpl-1', name: 'New stock arrival', description: 'For a trailer landing on site',
    body: 'Just landed at Stockport Truck Centre', first_comment: null,
    network_keys: ['linkedin'], hashtags: ['trucks'], is_shared: true,
    use_count: 4, created_by: 'user-1', is_active: true,
  },
];

const CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-1', name: 'Autumn stock', slug: 'autumn_stock', description: null,
    goal: 'Move the curtainsiders', starts_on: '2026-09-01', ends_on: '2026-11-30',
    owner_id: 'user-1', is_active: true,
  },
];

const TAGS: Tag[] = [
  { id: 'tag-1', name: 'Stock', slug: 'stock', description: null, position: 0, is_active: true },
  { id: 'tag-2', name: 'Hiring', slug: 'hiring', description: null, position: 1, is_active: true },
];

const LIBRARY: LibraryItem[] = [
  {
    id: 'lib-1', file_id: '00000000-0000-0000-0000-0000000000a1',
    name: 'Curtainsider on the forecourt', description: null,
    alt_text: 'A blue curtainsider trailer', approved_at: `${TODAY}T07:00:00Z`,
    approved_by: 'user-2', use_count: 2, last_used_at: `${TODAY}T07:30:00Z`,
    is_active: true, created_at: `${TODAY}T07:00:00Z`,
  },
  {
    id: 'lib-2', file_id: '00000000-0000-0000-0000-0000000000a2',
    name: 'Workshop bay', description: null, alt_text: null,
    approved_at: null, approved_by: null, use_count: 0, last_used_at: null,
    is_active: true, created_at: `${TODAY}T07:05:00Z`,
  },
];

const ACTIVITY: ActivityLine[] = [
  {
    id: 1, at: `${TODAY}T09:00:00Z`, actor_id: 'user-1', actor_label: 'Dana Drafter',
    verb: 'submitted', subject_type: 'social_post', subject_id: 'post-2',
    subject_label: 'Waiting on a yes', summary: 'Dana Drafter sent a post for approval',
    metadata: null, is_system: false,
  },
];

const PROFILE: Profile = {
  id: 'user-1', email: 'dana@stc.example', full_name: 'Dana Drafter',
  role: 'marketer' as Profile['role'], theme: 'dark', created_at: `${TODAY}T00:00:00Z`,
  is_active: true,
};

/* Everything, because the point is to press everything. What a person
   who holds less sees is a separate question, and `check:screens` and
   `check:coverage` are what answer it. */
const CAPABILITIES = [
  'social.view', 'social.draft', 'social.approve', 'social.schedule',
  'social.delete', 'social.library', 'social.templates', 'social.tags',
  'social.channels', 'marketing.edit', 'marketing.approve',
];

export default function SocialPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <SocialPlanner
      initialPosts={POSTS}
      profile={PROFILE}
      capabilities={CAPABILITIES}
      channels={CHANNELS}
      networks={NETWORKS}
      slots={SLOTS}
      columns={COLUMNS}
      variants={VARIANTS}
      templates={TEMPLATES}
      campaigns={CAMPAIGNS}
      tags={TAGS}
      library={LIBRARY}
      activity={ACTIVITY}
      postTags={[{ post_id: 'post-1', tag_id: 'tag-1' }]}
      openTab={null}
      openPostId={null}
      needsReview={false}
      startComposing={false}
    />
  );
}
