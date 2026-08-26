'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Check, Trash2, Eye, Calendar, LayoutGrid,
  AlertTriangle, CheckCheck, Send, Megaphone,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Profile } from '@/lib/types';
import {
  STATUS_LABEL, dayKey, dayLabel, postDay,
  type ActivityLine, type BoardColumn, type Campaign, type Channel,
  type LibraryItem, type Network, type Post, type PostStatus,
  type Slot, type Tag, type Template, type Variant,
} from '@/lib/content/types';
import type { Capability } from '@/lib/platform/permissions/catalog';
import { bucketStore, storeImage } from '@/lib/social/media';
import { stagingKey } from '@/lib/command/files';
import { fileDigest } from '@/lib/command/context';
import {
  Alert, Badge, Button, Chip, EmptyState, IconButton, RecordHead,
  SearchInput, StatStrip, TabShell, Tabs,
} from '@/components/kit/primitives';
import { Drawer, Select } from '@/components/kit/forms';
import { Board, Calendar as MonthCalendar } from '@/components/social/planner';
import { Composer } from '@/components/social/composer';
import { PostDrawer, Timeline } from '@/components/social/detail';
import { Channels, Library, Queue, Tags, Templates } from '@/components/social/workspace';
import { PreviewColumn } from '@/components/social/previews';

/* Which company a post goes out as is never abbreviated into a chip on
   this screen. The kit's first rule is that one thing points, and two
   branded chips competing on the same card is exactly the noise it
   exists to stop. The company travels with the channel instead, which
   is where the handle already says it: the drawer's channel table. */

/* =============================================================
   The social planner.

   The screen this route has always carried, grown into a planner the
   marketing team can actually run on.

   ---- What was here, and what happened to it ----

   Everything. The status filter, the card list with its Approve,
   Reject, Mark scheduled, Mark posted, Preview and Delete controls, the
   compose form with its character count and platform toggles, the live
   previews and all four network previews. They are all still here. The
   list is one of several ways to look at the same posts rather than the
   only one, and the previews moved to `components/social/previews.tsx`
   and gained eight more networks.

   Two controls changed shape rather than going:

   Mark scheduled was a plain write to the status column. It is now
   Schedule, which puts the post in a real queue at a real time.
   Migration 055 closed the status column, because approval was one
   PATCH away for anybody who could edit a post.

   Mark posted was the same kind of write. It is still here and still
   does what it did, through `content_mark_posted`, which records it as
   done by hand rather than pretending this product published it. No
   network driver exists yet, so it is how anything reaches Posted at
   all.

   ---- The existing posts ----

   Nothing was migrated away from. `social_posts` is the same table it
   has always been: migration 054 adds columns to it, backfills a board
   column and an author onto every row already there, and 060 gives each
   one a channel and a variant from the `platform` array it already
   carried. So the post that was on this page before is on the board,
   on the calendar, in the list and in its own drawer, with its network
   named.

   ---- The tabs ----

   Planner, Calendar, List, Queue, Library, Templates, Tags, Channels,
   Activity. Each is gated on the capability it needs, so a person who
   cannot connect an account never sees the tab for it.

   Everything here is drawn from `components/kit` and semantic tokens.
   The one exception is inside a network preview, and previews.tsx says
   why at length.
   ============================================================= */

const TABS_ORDER = [
  'planner', 'calendar', 'list', 'queue', 'library',
  'templates', 'tags', 'channels', 'activity',
] as const;
type Tab = (typeof TABS_ORDER)[number];

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};

const STATUS_FILTERS: { value: PostStatus | 'all'; label: string }[] = [
  { value: 'all',            label: 'Every status' },
  { value: 'draft',          label: 'Draft' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved',       label: 'Approved' },
  { value: 'scheduled',      label: 'Scheduled' },
  { value: 'publishing',     label: 'Publishing' },
  { value: 'posted',         label: 'Posted' },
  { value: 'failed',         label: 'Failed' },
];

export function SocialPlanner({
  initialPosts, profile, capabilities,
  channels: initialChannels, networks, slots: initialSlots, columns,
  variants: initialVariants, templates: initialTemplates, campaigns,
  tags: initialTags, library: initialLibrary, activity, postTags,
  openTab, needsReview, startComposing,
}: {
  initialPosts: Post[];
  profile: Profile;
  /** Resolved from capability_report, so a per person grant counts. */
  capabilities: string[];
  channels: Channel[];
  networks: Network[];
  slots: Slot[];
  columns: BoardColumn[];
  variants: Variant[];
  templates: Template[];
  campaigns: Campaign[];
  tags: Tag[];
  library: LibraryItem[];
  activity: ActivityLine[];
  postTags: { post_id: string; tag_id: string }[];
  /** The `?tab=` the command bar arrived with, already validated. */
  openTab: Tab | null;
  /** Whether it arrived asking for the approval queue. */
  needsReview: boolean;
  /* `?new=1`, which is where the command bar's "new post" lands. The
     bar cannot open a drawer, so it opens the screen with the drawer
     already up, which is the same thing from the other side. */
  startComposing: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const caps = useMemo(() => new Set(capabilities) as Set<Capability>, [capabilities]);

  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [variants, setVariants] = useState<Variant[]>(initialVariants);
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [library, setLibrary] = useState<LibraryItem[]>(initialLibrary);

  const [tab, setTab] = useState<Tab>(openTab ?? 'planner');
  const [status, setStatus] = useState<PostStatus | 'all'>(needsReview ? 'pending_review' : 'all');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(() => new Date());

  const [composing, setComposing] = useState<Post | null | 'new'>(startComposing ? 'new' : null);
  const [open, setOpen] = useState<Post | null>(null);
  const [previewing, setPreviewing] = useState<Post | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canWrite = caps.has('social.draft') || caps.has('marketing.edit');
  const canApprove = caps.has('social.approve') || caps.has('marketing.approve');
  const canSchedule = caps.has('social.schedule') || caps.has('marketing.edit');
  const canChannels = caps.has('social.channels');
  const canTags = caps.has('social.tags') || caps.has('marketing.edit');
  const canDelete = caps.has('social.delete');
  const canMarkPosted = caps.has('social.publishNow') || caps.has('marketing.edit');

  /* What the empty state says you are filtered to, and the one control
     that undoes it. The kit's second kind of empty state: name the
     filter and say how many clearing it would return. */
  const filterWords = useMemo(() => {
    const bits: string[] = [];
    if (status !== 'all') bits.push(STATUS_LABEL[status].toLowerCase());
    if (channelFilter) {
      const c = channels.find((x) => x.id === channelFilter);
      if (c) bits.push(`@${c.handle}`);
    }
    if (tagFilter) bits.push(tags.find((t) => t.id === tagFilter)?.name ?? 'a tag');
    if (campaignFilter) bits.push(campaigns.find((c) => c.id === campaignFilter)?.name ?? 'a campaign');
    if (mineOnly) bits.push('your own');
    if (query.trim()) bits.push(`"${query.trim()}"`);
    return bits.length ? bits.join(', ') : 'nothing';
  }, [status, channelFilter, tagFilter, campaignFilter, mineOnly, query, channels, tags, campaigns]);

  const filtered = status !== 'all' || channelFilter || tagFilter
    || campaignFilter || mineOnly || query.trim();

  const clearFilters = useCallback(() => {
    setStatus('all'); setChannelFilter(''); setTagFilter('');
    setCampaignFilter(''); setMineOnly(false); setQuery('');
  }, []);

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const tagsByPost = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of postTags) {
      if (!map.has(row.post_id)) map.set(row.post_id, []);
      map.get(row.post_id)!.push(row.tag_id);
    }
    return map;
  }, [postTags]);

  /* ---- what the toolbar leaves ---- */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (mineOnly && p.author_id !== profile.id) return false;
      if (campaignFilter && p.campaign_id !== campaignFilter) return false;
      if (tagFilter && !(tagsByPost.get(p.id) ?? []).includes(tagFilter)) return false;
      if (channelFilter && !variants.some((v) => v.post_id === p.id && v.channel_id === channelFilter)) return false;
      if (!q) return true;
      return `${p.content} ${p.caption ?? ''} ${(p.hashtags ?? []).join(' ')} ${p.created_by}`
        .toLowerCase().includes(q);
    });
  }, [posts, status, mineOnly, campaignFilter, tagFilter, channelFilter, query, variants, tagsByPost, profile.id]);

  /* ---- the figures ----

     No colour on any of them and no sparkline. The kit's stat strip is
     a label, a number and one qualifier, and a series would be a
     component the kit does not have: the rule is that a value with no
     token is a signal to ask rather than to invent. So the movement is
     said in the qualifier instead, in words, which is what somebody
     reads out in a meeting anyway. */
  const kpis = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
    const monthAgo = new Date(now); monthAgo.setDate(now.getDate() - 30);
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    return {
      drafts: posts.filter((p) => p.status === 'draft').length,
      waiting: posts.filter((p) => p.status === 'pending_review').length,
      thisWeek: posts.filter((p) => {
        if (p.status !== 'scheduled' || !p.scheduled_at) return false;
        const at = new Date(p.scheduled_at);
        return at >= now && at <= weekEnd;
      }).length,
      published: posts.filter((p) => p.published_at && new Date(p.published_at) >= monthAgo).length,
      publishedWeek: posts.filter((p) => p.published_at && new Date(p.published_at) >= weekAgo).length,
      failed: posts.filter((p) => p.status === 'failed').length,
    };
  }, [posts]);

  /** Free posting slots per day, for the calendar's outlines. */
  const freeSlots = useMemo(() => {
    const out: Record<string, number> = {};
    const taken = new Set(
      variants.filter((v) => v.scheduled_at).map((v) => `${v.channel_id}|${v.scheduled_at}`),
    );
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    for (const s of slots) {
      if (!s.is_active) continue;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== s.day_of_week) continue;
        const key = dayKey(d);
        const at = `${key}T${s.at_time}`;
        if (taken.has(`${s.channel_id}|${at}`)) continue;
        out[key] = (out[key] ?? 0) + 1;
      }
    }
    return out;
  }, [slots, variants, month]);

  /* ---- writes ---- */

  const refresh = useCallback(async () => {
    const res = await fetch('/api/content/posts');
    const json = await res.json();
    if (json.ok) setPosts(json.posts as Post[]);
  }, []);

  const replace = useCallback((post: Post) => {
    setPosts((ps) => {
      const known = ps.some((p) => p.id === post.id);
      return known ? ps.map((p) => (p.id === post.id ? post : p)) : [post, ...ps];
    });
    setOpen((o) => (o && o.id === post.id ? post : o));
  }, []);

  /** Dragging a card. What the move costs is the database's answer. */
  const moveCard = useCallback(async (postId: string, columnId: string, position: number) => {
    const before = posts.find((p) => p.id === postId);
    const column = columns.find((c) => c.id === columnId);
    if (!before || !column || before.board_column_id === columnId) return;

    setBusy(postId); setError(null);
    /* Optimistic, and rolled back by name rather than by refetching, so
       a refused move puts the card back where it was rather than
       leaving the board wrong until the next load. */
    setPosts((ps) => ps.map((p) => (
      p.id === postId ? { ...p, board_column_id: columnId, board_position: position } : p
    )));

    try {
      const res = await fetch('/api/content/board', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: postId, column_id: columnId, position }),
      });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) {
        setPosts((ps) => ps.map((p) => (p.id === postId ? before : p)));
        setError(json.message ?? 'That move was refused.');
        return;
      }
      replace(json.post as Post);
    } catch {
      setBusy(null);
      setPosts((ps) => ps.map((p) => (p.id === postId ? before : p)));
      setError('That did not reach the server. Try again.');
    }
  }, [posts, columns, replace]);

  const transition = useCallback(async (post: Post, move: string, body: Record<string, unknown> = {}) => {
    setBusy(post.id); setError(null);
    try {
      const res = await fetch(`/api/content/posts/${post.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ move, ...body }),
      });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) { setError(json.message ?? 'That was refused.'); return; }
      replace(json.post as Post);
    } catch {
      setBusy(null);
      setError('That did not reach the server. Try again.');
    }
  }, [replace]);

  const markPosted = useCallback(async (post: Post) => {
    setBusy(post.id); setError(null);
    try {
      const res = await fetch(`/api/content/posts/${post.id}/posted`, { method: 'POST' });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) { setError(json.message ?? 'That was refused.'); return; }
      replace(json.post as Post);
    } catch {
      setBusy(null);
      setError('That did not reach the server. Try again.');
    }
  }, [replace]);

  const removePost = useCallback(async (post: Post) => {
    if (!confirm('Delete this post? An administrator can restore it.')) return;
    setBusy(post.id); setError(null);
    const res = await fetch(`/api/content/posts/${post.id}`, { method: 'DELETE' });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) { setError(json.message ?? 'That was refused.'); return; }
    setPosts((ps) => ps.filter((p) => p.id !== post.id));
    setOpen(null);
  }, []);

  /* The same upload the old composer did, through the same helpers, so
     the bucket, the key rule and what counts as an image have one
     definition. */
  const uploadImage = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = stagingKey({
      confirmation: `composer:${profile.id}`,
      digest: fileDigest(new TextDecoder('latin1').decode(bytes)),
      operation: 'post.create',
      name: file.name,
    });
    const stored = await storeImage(bucketStore(supabase), {
      key, name: file.name, mime: file.type, bytes,
    });
    return stored.ok
      ? { ok: true as const, url: stored.url }
      : { ok: false as const, why: stored.why };
  }, [supabase, profile.id]);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  };
  const patch = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const TAB_LIST: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: 'planner',   label: 'Planner',   count: visible.length, show: true },
    { key: 'calendar',  label: 'Calendar',  show: true },
    { key: 'list',      label: 'List',      show: true },
    { key: 'queue',     label: 'Queue',     count: slots.filter((s) => s.is_active).length, show: true },
    { key: 'library',   label: 'Library',   count: library.length, show: true },
    { key: 'templates', label: 'Templates', count: templates.length, show: true },
    { key: 'tags',      label: 'Tags',      count: tags.length, show: true },
    { key: 'channels',  label: 'Channels',  count: channels.length, show: canChannels || channels.length > 0 },
    { key: 'activity',  label: 'Activity',  show: true },
  ];

  return (
    <TabShell>
      <RecordHead
        icon={<Megaphone size={20} />}
        title="Social planner"
        badges={<>
          <Badge tone="neutral" dot>{posts.length} post{posts.length === 1 ? '' : 's'}</Badge>
          {kpis.waiting > 0 && <Badge tone="warning">{kpis.waiting} awaiting review</Badge>}
          {kpis.failed > 0 && <Badge tone="danger">{kpis.failed} failed</Badge>}
        </>}
        sub="Plan, approve and schedule across every channel the company posts from."
        actions={canWrite
          ? <Button size="sm" variant="primary" onClick={() => setComposing('new')}>
              <Plus size={13} /> New post
            </Button>
          : undefined}
      />

      <StatStrip items={[
        { label: 'Drafts', value: kpis.drafts, note: 'not sent for approval' },
        {
          label: 'Awaiting review',
          value: kpis.waiting,
          note: canApprove ? 'yours to approve or send back' : 'with an approver',
        },
        { label: 'Out this week', value: kpis.thisWeek, note: 'scheduled in the next seven days' },
        {
          label: 'Published, 30 days',
          value: kpis.published,
          note: `${kpis.publishedWeek} in the last seven`,
        },
        {
          label: 'Failed',
          value: kpis.failed,
          note: kpis.failed > 0 ? 'needs a look' : 'nothing to chase',
        },
      ]} />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={TAB_LIST.filter((t) => t.show).map((t) => ({ key: t.key, label: t.label, count: t.count }))}
      />

      {(tab === 'planner' || tab === 'calendar' || tab === 'list') && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
          padding: '10px 14px', ...PANEL,
        }}>
          <div style={{ width: 230, maxWidth: '100%' }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search posts"
              icon={<Search size={14} />}
            />
          </div>

          <div style={{ width: 152 }}>
            <Select value={status} onChange={(v) => setStatus(v as PostStatus | 'all')}>
              {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>

          {channels.length > 0 && (
            <div style={{ width: 172 }}>
              <Select value={channelFilter} onChange={setChannelFilter}>
                <option value="">Every channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {networks.find((n) => n.key === c.network_key)?.label ?? c.network_key} @{c.handle}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {tags.length > 0 && (
            <div style={{ width: 140 }}>
              <Select value={tagFilter} onChange={setTagFilter}>
                <option value="">Every tag</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          )}

          {campaigns.length > 0 && (
            <div style={{ width: 158 }}>
              <Select value={campaignFilter} onChange={setCampaignFilter}>
                <option value="">Every campaign</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          )}

          <Chip active={mineOnly} onClick={() => setMineOnly((m) => !m)}>Mine</Chip>

          {filtered && (
            <button onClick={clearFilters} style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}>Clear</button>
          )}

          <span style={{ flex: 1 }} />

          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            {visible.length} of {posts.length}
          </span>
        </div>
      )}

      {error && (
        <Alert tone="danger">
          <AlertTriangle size={13} />
          <span style={{ flex: 1 }}>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 4 }}>
        {tab === 'planner' && (
          visible.length === 0 && posts.length === 0 ? (
            <EmptyState
              what="Nothing planned yet"
              why="Write the first post and it appears here. The board is where the team can see what is being written, what is waiting on an approver and what is ready to go out."
              action={canWrite
                ? <Button size="sm" variant="primary" onClick={() => setComposing('new')}>
                    <Plus size={13} /> New post
                  </Button>
                : undefined}
            />
          ) : (
            <Board
              posts={visible}
              columns={columns}
              channels={channels}
              networks={networks}
              variants={variants}
              onOpen={setOpen}
              onMove={moveCard}
              busy={busy}
            />
          )
        )}

        {tab === 'calendar' && (
          <MonthCalendar
            posts={visible}
            channels={channels}
            networks={networks}
            variants={variants}
            onOpen={setOpen}
            freeSlots={freeSlots}
            month={month}
            onMonth={setMonth}
          />
        )}

        {/* ---- the list ----

            Two columns of compact rows in bordered boxes, at the kit's
            density. It was one full width card per post with its own
            padding and rule, which is ninety percent whitespace on a
            wide screen.

            The controls did not go anywhere. They sit on the row and on
            the drawer the row opens, which is where a row of this
            height can carry them. ---- */}
        {tab === 'list' && (
          visible.length === 0 ? (
            <EmptyState
              what={posts.length === 0 ? 'Nothing written yet' : 'Nothing matches those filters'}
              why={posts.length === 0
                ? 'Write the first post and it appears here, on the board and on the calendar.'
                : `You are filtered to ${filterWords}. Clearing them would show ${posts.length} post${posts.length === 1 ? '' : 's'}.`}
              action={posts.length === 0
                ? (canWrite
                    ? <Button size="sm" variant="primary" onClick={() => setComposing('new')}>
                        <Plus size={13} /> New post
                      </Button>
                    : undefined)
                : <Button size="sm" variant="primary" onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <div style={{
              display: 'grid', gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
              alignItems: 'start',
            }}>
              {/* Split in half, not alternated. `i % 2` zigzags across
                  the two boxes, so a list sorted by date reads left,
                  right, left, and nobody scans that way. Down the first
                  column, then down the second. */}
              {[0, 1].map((col) => (
                <div key={col} style={PANEL}>
                  {visible
                    .slice(col === 0 ? 0 : Math.ceil(visible.length / 2),
                           col === 0 ? Math.ceil(visible.length / 2) : undefined)
                    .map((p) => (
                      <PostRow
                        key={p.id}
                        post={p}
                        variants={variants}
                        channels={channels}
                        networks={networks}
                        busy={busy === p.id}
                        canApprove={canApprove}
                        canApproveThis={canApprove && (p.author_id !== profile.id || caps.has('social.approveOwn'))}
                        canSchedule={canSchedule}
                        canDelete={canDelete}
                        canMarkPosted={canMarkPosted}
                        onOpen={() => setOpen(p)}
                        onPreview={() => setPreviewing(p)}
                        onTransition={(move, body) => transition(p, move, body)}
                        onMarkPosted={() => markPosted(p)}
                        onDelete={() => removePost(p)}
                      />
                    ))}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'queue' && (
          <Queue
            channels={channels}
            networks={networks}
            slots={slots}
            posts={posts}
            variants={variants}
            canEdit={canChannels}
            onSlots={async (channelId, next) => {
              const res = await fetch(`/api/content/channels/${channelId}/slots`, {
                method: 'PUT', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ slots: next }),
              });
              const json = await res.json();
              if (!json.ok) return json.message ?? 'Those times could not be saved.';
              setSlots((s) => [...s.filter((x) => x.channel_id !== channelId), ...(json.slots as Slot[])]);
              return null;
            }}
          />
        )}

        {tab === 'library' && (
          <Library
            items={library}
            caps={caps}
            onUpload={async (file, name) => {
              const up = await uploadImage(file);
              if (!up.ok) return up.why;
              const json = await post('/api/content/library', { file_id: up.url, name });
              if (!json.ok) return json.message ?? 'That could not be added.';
              setLibrary((l) => [json.item as LibraryItem, ...l]);
              return null;
            }}
            onPatch={async (body) => {
              const json = await patch('/api/content/library', body);
              if (!json.ok) return json.message ?? 'That could not be changed.';
              if (json.item) {
                const item = json.item as LibraryItem;
                setLibrary((l) => (item.is_active
                  ? l.map((x) => (x.id === item.id ? item : x))
                  : l.filter((x) => x.id !== item.id)));
              }
              return null;
            }}
          />
        )}

        {tab === 'templates' && (
          <Templates
            templates={templates}
            networks={networks}
            caps={caps}
            onUse={(t) => {
              setComposing('new');
              setNotice(`Started from "${t.name}".`);
              /* The composer reads templates itself, so this only has
                 to open it. Applying it there keeps one code path for a
                 template becoming a draft. */
            }}
            onSave={async (body) => {
              const json = await post('/api/content/templates', body);
              if (!json.ok) return json.message ?? 'That could not be saved.';
              setTemplates((t) => [json.template as Template, ...t]);
              return null;
            }}
            onArchive={async (id) => {
              const json = await patch('/api/content/templates', { id, is_active: false });
              if (json.ok) setTemplates((t) => t.filter((x) => x.id !== id));
              else setError(json.message ?? 'That could not be archived.');
            }}
          />
        )}

        {tab === 'tags' && (
          <Tags
            tags={tags}
            canEdit={canTags}
            onAdd={async (name) => {
              const json = await post('/api/content/tags', { name });
              if (!json.ok) return json.message ?? 'That tag could not be added.';
              if (!json.existed) setTags((t) => [...t, json.tag as Tag]);
              return null;
            }}
            onMerge={async (id, into) => {
              const json = await patch('/api/content/tags', { id, merge_into: into });
              if (!json.ok) return json.message ?? 'Those tags could not be merged.';
              setTags((t) => t.filter((x) => x.id !== id));
              setNotice(`${json.merged} post${json.merged === 1 ? '' : 's'} moved over.`);
              return null;
            }}
            onArchive={async (id) => {
              const json = await patch('/api/content/tags', { id, is_active: false });
              if (json.ok) setTags((t) => t.filter((x) => x.id !== id));
              else setError(json.message ?? 'That could not be archived.');
            }}
          />
        )}

        {tab === 'channels' && (
          <Channels
            channels={channels}
            networks={networks}
            canEdit={canChannels}
            onAdd={async (body) => {
              const json = await post('/api/content/channels', body);
              if (!json.ok) return json.message ?? 'That channel could not be added.';
              setChannels((c) => [...c, json.channel as Channel]);
              return null;
            }}
            onPatch={async (body) => {
              const json = await patch('/api/content/channels', body);
              if (!json.ok) return json.message ?? 'That channel could not be changed.';
              const ch = json.channel as Channel;
              setChannels((c) => c.map((x) => (x.id === ch.id ? ch : x)));
              return null;
            }}
          />
        )}

        {tab === 'activity' && (
          <div style={PANEL}>
            <Timeline
              lines={activity}
              empty="Nothing yet. Writing, approving, scheduling and publishing all land here."
            />
          </div>
        )}
      </div>

      {composing && (
        <Composer
          post={composing === 'new' ? null : composing}
          variants={composing === 'new' ? [] : variants.filter((v) => v.post_id === composing.id)}
          channels={channels.filter((c) => c.is_active)}
          networks={networks}
          templates={templates}
          campaigns={campaigns}
          tags={tags}
          library={library}
          caps={caps}
          canApprove={canApprove}
          onClose={() => setComposing(null)}
          onSaved={(saved, submitted) => {
            replace(saved);
            setComposing(null);
            setNotice(submitted ? 'Sent for approval.' : 'Saved as a draft.');
            refresh();
          }}
          uploadImage={uploadImage}
        />
      )}

      {open && (
        <PostDrawer
          post={open}
          variants={variants}
          channels={channels}
          networks={networks}
          caps={caps}
          meId={profile.id}
          onClose={() => setOpen(null)}
          onChanged={replace}
          onEdit={(p) => { setOpen(null); setComposing(p); }}
        />
      )}

      {previewing && (
        <Drawer
          eyebrow="Preview"
          title="What this will look like"
          icon={<Eye size={18} />}
          onClose={() => setPreviewing(null)}
          width={520}
        >
          <PreviewColumn
            channels={variants.filter((v) => v.post_id === previewing.id)
              .map((v) => channelById.get(v.channel_id))
              .filter(Boolean) as Channel[]}
            networks={networks}
            post={{
              content: previewing.content,
              caption: previewing.caption,
              first_comment: previewing.first_comment,
              hashtags: previewing.hashtags ?? [],
              image_url: previewing.image_url,
              scheduled_date: previewing.scheduled_date,
            }}
            variantText={Object.fromEntries(
              variants.filter((v) => v.post_id === previewing.id)
                .map((v) => [v.channel_id, v.content]),
            )}
            empty="This post has no channels on it, so there is nothing to preview against."
          />
        </Drawer>
      )}

    </TabShell>
  );
}

/* =============================================================
   One row of the list.

   The kit's density: two lines in 12px of padding, divided by a 1px
   rule inside a bordered box. It was a card with 16px padding, a 100px
   thumbnail and its own horizontal rule, which is most of why the list
   read as empty.

   ---- Nothing was dropped, and here is where each thing went ----

   Status, channels, the date and the sensitivity mark: on the row.
   The contextual action, Submit or Approve or Schedule or Mark posted:
     on the row, as the one button the post's state actually needs.
   Preview and Delete: on the row.
   Send back: opens the drawer, which is exactly what it did before,
     because a rejection needs a reason typed and never fitted inline.
   Caption, hashtags, the full text, who created and who reviewed it:
     the drawer, which carries them alongside the timeline. The row
     opens it on click, as it always did.
   ============================================================= */
function PostRow({
  post, variants, channels, networks, busy,
  canApprove, canApproveThis, canSchedule, canDelete, canMarkPosted,
  onOpen, onPreview, onTransition, onMarkPosted, onDelete,
}: {
  post: Post;
  variants: Variant[];
  channels: Channel[];
  networks: Network[];
  busy: boolean;
  canApprove: boolean;
  canApproveThis: boolean;
  canSchedule: boolean;
  canDelete: boolean;
  canMarkPosted: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onTransition: (move: string, body?: Record<string, unknown>) => void;
  onMarkPosted: () => void;
  onDelete: () => void;
}) {
  const mine = variants.filter((v) => v.post_id === post.id);
  const byId = new Map(channels.map((c) => [c.id, c]));
  const byKey = new Map(networks.map((n) => [n.key, n]));

  const labels = mine.length
    ? [...new Set(mine.map((v) => {
        const c = byId.get(v.channel_id);
        return c ? byKey.get(c.network_key)?.label ?? c.network_key : null;
      }).filter(Boolean) as string[])]
    : post.platform ?? [];

  /* A hue for an outcome, never for a position in a process. */
  const tone = post.status === 'posted' ? 'success'
    : post.status === 'failed' ? 'danger'
    : post.status === 'pending_review' ? 'warning'
    : 'neutral';

  const when = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : dayLabel(`${post.scheduled_date}T12:00:00`);

  /* One button, the one this state needs. A row that carried five would
     be the card again. */
  const action = post.status === 'draft'
    ? { label: 'Submit', icon: <Send size={12} />, run: () => onTransition('submit'), primary: false }
    : post.status === 'pending_review' && canApproveThis
      ? { label: 'Approve', icon: <Check size={12} />, run: () => onTransition('approve'), primary: true }
      : post.status === 'approved' && canSchedule
        ? { label: 'Schedule', icon: <Calendar size={12} />, run: () => onTransition('schedule', { at: null }), primary: false }
        : ['scheduled', 'publishing', 'failed'].includes(post.status) && canMarkPosted
          ? { label: 'Mark posted', icon: <CheckCheck size={12} />, run: onMarkPosted, primary: false }
          : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '10px 14px', cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        opacity: busy ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {post.image_url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.image_url} alt=""
          style={{
            width: 40, height: 40, flex: 'none', objectFit: 'cover',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{post.content}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={tone} dot>{STATUS_LABEL[post.status]}</Badge>
          {labels.slice(0, 2).map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
          {labels.length > 2 && <Badge tone="neutral">+{labels.length - 2}</Badge>}
          {post.lint_severity === 'blocking' && (
            <Badge tone="danger"><AlertTriangle size={10} /> Wording</Badge>
          )}
          {post.is_sensitive && <Badge tone="danger" dot>Sensitive</Badge>}
          {post.status === 'pending_review' && canApprove && !canApproveThis && (
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>You wrote this</span>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{post.created_by}</span>
        </span>
      </div>

      <span style={{
        fontSize: 11.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>{when}</span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
        {action && (
          <Button
            size="sm"
            variant={action.primary ? 'primary' : 'secondary'}
            onClick={(e) => { e.stopPropagation(); action.run(); }}
            title={action.label}
          >
            {action.icon} {action.label}
          </Button>
        )}
        <span onClick={(e) => e.stopPropagation()}>
          <IconButton label="Preview this post" onClick={onPreview}>
            <Eye size={12} />
          </IconButton>
        </span>
        {canDelete && (
          <span onClick={(e) => e.stopPropagation()}>
            <IconButton label="Delete this post" danger onClick={onDelete}>
              <Trash2 size={12} />
            </IconButton>
          </span>
        )}
      </span>
    </div>
  );
}
