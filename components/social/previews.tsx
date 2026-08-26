'use client';

import type { CSSProperties, ReactNode } from 'react';
import { ThumbsUp, MessageCircle, Share2, Repeat2, Heart, BarChart3, Bookmark } from 'lucide-react';
import { countFor, type Channel, type Network, type NetworkKey } from '@/lib/content/types';
import { EmptyState, Label } from '@/components/kit/primitives';

/* =============================================================
   What a post will look like where it is going.

   The four the planner already had, Facebook, LinkedIn, Instagram and
   X, are all still here with the same anatomy: avatar, name, meta line,
   body, image, and the network's own action row. Eight more join them,
   because the composer now knows about twelve networks and a preview
   that covers four of them is worse than none.

   ---- The one place the STC kit does not reach ----

   CLAUDE.md says the kit governs every piece of interface built from
   now on, and a preview is the single thing it cannot: the whole point
   of a preview is to look like the place the post is going, and a
   LinkedIn card drawn in STC navy is a preview of nothing.

   So the line is drawn at the card's own border. Everything AROUND a
   preview is the kit: the heading, the empty state, the spacing. Inside
   it, the network's own colours, which are the network's brand and not
   a palette anybody here chose. That is exactly what the previews in
   the old planner already did.

   ---- The identity ----

   Name and handle come from the channel, which is a record of a real
   account, so a preview of the STC page says STC and a preview of the
   STC Sales and Leasing page says that. The old previews had a company
   name hard coded in four places.
   ============================================================= */

export type PreviewPost = {
  content: string;
  caption?: string | null;
  first_comment?: string | null;
  hashtags?: string[];
  image_url?: string | null;
  scheduled_date?: string;
};

function initialsOf(name: string): string {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function bodyOf(post: PreviewPost, placeholder: string): string {
  const tags = post.hashtags?.length ? `\n\n${post.hashtags.map((h) => `#${h}`).join(' ')}` : '';
  return (post.content || placeholder) + tags;
}

/** The colour a network's avatar chip takes when there is no picture. */
const AVATAR: Record<NetworkKey, string> = {
  x: '#000000',
  linkedin: '#0a66c2',
  telegram: '#229ED9',
  discord: '#5865F2',
  facebook: '#1877f2',
  instagram: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
  threads: '#000000',
  youtube: '#FF0000',
  tiktok: '#010101',
  bluesky: '#0085FF',
  mastodon: '#6364FF',
  reddit: '#FF4500',
};

/* The card itself. White, because every one of these networks is,
   whatever theme the rest of the page is in. It takes the kit's radius
   and a kit hairline on the outside so it sits in the page properly,
   and nothing else of the kit crosses the border. */
const CARD: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r)',
  overflow: 'hidden',
  fontFamily: 'var(--inter)',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px',
};
const BODY: CSSProperties = {
  padding: '0 12px 10px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const FOOT: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', fontSize: 12,
};
const IMG: CSSProperties = { width: '100%', display: 'block' };
const NONE: CSSProperties = {
  padding: '26px 12px', textAlign: 'center', fontSize: 12,
  color: '#65676b', background: '#f2f3f5',
};

export function NetworkPreview({
  network, channel, post, body,
}: {
  network: Network;
  channel?: Channel | null;
  post: PreviewPost;
  /** The words this channel receives, if they differ from the post's. */
  body?: string | null;
}) {
  const name = channel?.display_name ?? 'Your account';
  const handle = channel?.handle ?? 'your_handle';
  const shown: PreviewPost = body != null ? { ...post, content: body } : post;
  const text = bodyOf(shown, 'Write something to see it here.');
  const used = countFor(text, network.key);
  const over = used - network.char_limit;

  const avatar = (
    <div style={{
      width: 34, height: 34, flex: 'none', borderRadius: '50%',
      background: AVATAR[network.key] ?? '#333', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700,
    }}>{initialsOf(name)}</div>
  );

  /* One block per network family rather than twelve near identical
     ones. What actually differs is the meta line, whether the image
     leads, and the action row. */
  const card = (inner: ReactNode) => (
    <div style={CARD}>
      {inner}
      {over > 0 && (
        <div style={{
          padding: '7px 12px', fontSize: 11.5, fontWeight: 600,
          color: '#b42318', background: '#fef3f2', borderTop: '1px solid #fee4e2',
        }}>
          {over} character{over === 1 ? '' : 's'} over what {network.label} accepts.
        </div>
      )}
      {post.first_comment && network.supports_first_comment && (
        <div style={{
          padding: '8px 12px', borderTop: '1px solid #e7e7e7',
          color: '#65676b', fontSize: 12, lineHeight: 1.45,
        }}>
          <span style={{ fontWeight: 600 }}>{handle}</span> {post.first_comment}
        </div>
      )}
    </div>
  );

  const head = (sub: ReactNode, bold = 600) => (
    <div style={HEAD}>
      {avatar}
      <div>
        <div style={{ fontWeight: bold, fontSize: 13, color: '#050505' }}>{name}</div>
        <div style={{ fontSize: 11, color: '#65676b' }}>{sub}</div>
      </div>
    </div>
  );

  const image = post.image_url
    /* eslint-disable-next-line @next/next/no-img-element */
    ? <img src={post.image_url} alt="" style={IMG} />
    : null;

  switch (network.key) {
    case 'facebook':
      return card(<>
        {head(<>{post.scheduled_date ?? 'Just now'} · Public</>)}
        <div style={{ ...BODY, color: '#050505' }}>{text}</div>
        {image}
        <div style={{ ...FOOT, borderTop: '1px solid #ced0d4', color: '#65676b', justifyContent: 'space-around' }}>
          <span><ThumbsUp size={14} style={{ verticalAlign: 'text-bottom' }} /> Like</span>
          <span><MessageCircle size={14} style={{ verticalAlign: 'text-bottom' }} /> Comment</span>
          <span><Share2 size={14} style={{ verticalAlign: 'text-bottom' }} /> Share</span>
        </div>
      </>);

    case 'linkedin':
      return card(<>
        {head(<>{channel?.profile_url ? 'Company' : 'Company page'} · {post.scheduled_date ?? 'Now'}</>)}
        <div style={{ ...BODY, color: '#000' }}>{text}</div>
        {image}
        <div style={{ ...FOOT, borderTop: '1px solid #e0e0e0', color: '#666', justifyContent: 'space-around' }}>
          <span><ThumbsUp size={14} style={{ verticalAlign: 'text-bottom' }} /> Like</span>
          <span><MessageCircle size={14} style={{ verticalAlign: 'text-bottom' }} /> Comment</span>
          <span><Repeat2 size={14} style={{ verticalAlign: 'text-bottom' }} /> Repost</span>
        </div>
      </>);

    case 'instagram':
      return card(<>
        <div style={{ ...HEAD, borderBottom: '1px solid #efefef' }}>
          {avatar}
          <div style={{ fontWeight: 600, fontSize: 13, color: '#262626' }}>{handle}</div>
        </div>
        {post.image_url
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={post.image_url} alt="" style={{ ...IMG, aspectRatio: '1/1', objectFit: 'cover' }} />
          : <div style={NONE}>Instagram needs an image</div>}
        <div style={{ ...BODY, color: '#262626', fontSize: 12, paddingTop: 8 }}>
          <strong>{handle}</strong> {text}
        </div>
      </>);

    case 'x':
    case 'bluesky':
    case 'threads':
    case 'mastodon':
      return card(<>
        <div style={HEAD}>
          {avatar}
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f1419' }}>
            {name} <span style={{ color: '#536471', fontWeight: 400 }}>@{handle}</span>
          </div>
        </div>
        <div style={{ ...BODY, color: '#0f1419' }}>{text}</div>
        {image}
        <div style={{ ...FOOT, color: '#536471', justifyContent: 'space-around' }}>
          <MessageCircle size={15} /><Repeat2 size={15} /><Heart size={15} />
          {network.key === 'x' ? <BarChart3 size={15} /> : <Bookmark size={15} />}
        </div>
      </>);

    case 'youtube':
    case 'tiktok':
      return card(<>
        {post.image_url
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={post.image_url} alt="" style={{
              ...IMG,
              aspectRatio: network.key === 'tiktok' ? '9/16' : '16/9',
              objectFit: 'cover', maxHeight: 280,
            }} />
          : <div style={NONE}>{network.label} needs a video or a thumbnail</div>}
        {head(<>{post.scheduled_date ?? 'Now'}</>, 700)}
        <div style={{ ...BODY, color: '#0f0f0f', fontSize: 12.5 }}>{text}</div>
      </>);

    case 'telegram':
      return card(<>
        <div style={{ padding: 12, background: '#EFF7FD' }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: '#3390EC', marginBottom: 4 }}>{name}</div>
          <div style={{ fontSize: 13, lineHeight: 1.45, color: '#0f0f0f', whiteSpace: 'pre-wrap' }}>{text}</div>
        </div>
        {image}
      </>);

    case 'discord':
      return card(
        <div style={{ background: '#313338', padding: 12, display: 'flex', gap: 10 }}>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#f2f3f5' }}>
              {name} <span style={{ color: '#949ba4', fontWeight: 400, fontSize: 11 }}>BOT</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45, color: '#dbdee1', whiteSpace: 'pre-wrap' }}>{text}</div>
            {image}
          </div>
        </div>,
      );

    case 'reddit':
    default:
      return card(<>
        {head(<>Posted by u/{handle}</>, 700)}
        <div style={{ ...BODY, color: '#1a1a1b' }}>{text}</div>
        {image}
        <div style={{ ...FOOT, color: '#787c7e' }}>
          <span><MessageCircle size={14} style={{ verticalAlign: 'text-bottom' }} /> Comments</span>
          <span><Share2 size={14} style={{ verticalAlign: 'text-bottom' }} /> Share</span>
        </div>
      </>);
  }
}

/**
 * One preview per channel a post is going to.
 *
 * Keyed by channel rather than by network, because two LinkedIn pages
 * are two previews: the STC one and the Sales and Leasing one say
 * different names and, often enough, different words.
 */
export function PreviewColumn({
  channels, networks, post, variantText, empty,
}: {
  channels: Channel[];
  networks: Network[];
  post: PreviewPost;
  /** Per channel words, where a channel has its own. */
  variantText?: Record<string, string | null | undefined>;
  empty?: string;
}) {
  const byKey = new Map(networks.map((n) => [n.key, n]));

  if (!channels.length) {
    return (
      <EmptyState
        what="Nothing to preview yet"
        why={empty ?? 'Pick a channel to see how this will look where it lands.'}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {channels.map((c) => {
        const n = byKey.get(c.network_key);
        if (!n) return null;
        return (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Label>{n.label}</Label>
              <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>@{c.handle}</span>
            </div>
            <NetworkPreview network={n} channel={c} post={post} body={variantText?.[c.id] ?? null} />
          </div>
        );
      })}
    </div>
  );
}
