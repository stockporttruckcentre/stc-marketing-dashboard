'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { Composer } from '@/components/social/composer';
import type {
  Channel, Network, Template, Campaign, Tag, LibraryItem, Post, Variant,
} from '@/lib/content/types';
import type { CrmCapability } from '@/lib/crm/permissions';

/* =============================================================
   The post composer, for driving. Dev only.

   From the business, about the planner going into use today:

     make it so images uploaded to social posts actually save and the
     whole thing is wired end to end

   The image did not save, and nothing could have found that: the
   composer uploaded the picture, held it, drew it in its own preview
   and then left `image_url` out of the body it sent. Every screen
   looked right. Only the request was wrong.

   So this harness exists to let a browser check WATCH THE REQUEST, which
   is the only place that fault is visible.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

const NETWORKS: Network[] = [
  {
    key: 'linkedin', label: 'LinkedIn', char_limit: 3000, media_max: 9,
    video_max_seconds: 600, requires_media: false, supports_first_comment: true,
    supports_thread: false, supports_alt_text: true, supports_link_preview: true,
    position: 0, is_active: true,
  },
];

const CHANNELS: Channel[] = [
  {
    id: 'chan-1', network_key: 'linkedin', handle: 'stc',
    display_name: 'STC LinkedIn', avatar_file_id: null, profile_url: null,
    entity_id: null, timezone: 'Europe/London', state: 'connected',
    last_error: null, position: 0, is_active: true,
  } as Channel,
];

/* A post that has already been sent for approval, for driving the case
   the business reported: the buttons on a post that cannot be
   submitted again. `?status=pending_review` mounts it. */
function postInState(status: string): Post {
  return {
    id: 'post-1', content: 'A post already sent for approval', caption: null,
    first_comment: null, hashtags: [], platform: ['LinkedIn'], image_url: null,
    status: status as Post['status'], scheduled_date: '2026-09-16', scheduled_at: null,
    from_queue: false, author_id: 'u1', created_by: 'Dana Drafter', reviewed_by: null,
    approved_by_id: null, submitted_at: '2026-09-16T09:00:00Z', approved_at: null,
    rejected_at: null, rejection_note: null, published_at: null, failed_at: null,
    failure_reason: null, campaign_id: null, template_id: null, board_column_id: null,
    board_position: 0, link_url: null, utm_source: null, utm_medium: null,
    utm_campaign: null, utm_content: null, internal_note: null, lint_severity: null,
    lint_findings: null, lint_hash: null, lint_checked_at: null,
    classification: 'internal', is_sensitive: false,
    created_at: '2026-09-16T08:00:00Z', updated_at: '2026-09-16T09:00:00Z',
  };
}

export default function ComposerPreview({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const [open, setOpen] = useState(true);
  const status = searchParams?.status ?? '';
  const existing = status ? postInState(status) : null;
  /* What the screen was told, in the order it was told. The planner
     puts the post in its list from `onStored` and closes the drawer on
     `onSaved`, so a check can read this and know whether a post that
     failed to submit would have appeared anywhere. */
  const [told, setTold] = useState<string[]>([]);

  if (!open) return <div data-closed>Closed</div>;

  return (
    <div className="kit" style={{ padding: 20 }}>
      <div data-told style={{ display: 'none' }}>{told.join(',')}</div>
      <Composer
        post={existing}
        variants={[] as Variant[]}
        channels={CHANNELS}
        networks={NETWORKS}
        templates={[] as Template[]}
        campaigns={[] as Campaign[]}
        tags={[] as Tag[]}
        library={[] as LibraryItem[]}
        caps={new Set<CrmCapability>(['social.draft', 'social.approve', 'social.schedule'])}
        canApprove
        onClose={() => setOpen(false)}
        onStored={(post) => setTold((t) => [...t, `stored:${post.id}`])}
        onSaved={(post, submitted) => {
          setTold((t) => [...t, `saved:${post.id}:${submitted}`]);
          setOpen(false);
        }}
        /* The real upload is a bucket write. Here it answers the way the
           planner's does, because what is being driven is what the
           COMPOSER does with the answer. */
        uploadImage={async (file) => ({
          ok: true as const,
          url: `https://example.test/uploaded/${encodeURIComponent(file.name)}`,
        })}
      />
    </div>
  );
}
