'use client';

import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  STATUS_LABEL, dayKey, dayLabel, postDay, whenLabel,
  type BoardColumn, type Channel, type Network, type Post, type Variant,
} from '@/lib/content/types';
import { Badge, Button, IconButton, Label } from '@/components/kit/primitives';

/* =============================================================
   The planner: a board and a calendar over the same posts.

   Both exist because people use both. The board answers "what is
   stuck": nineteen things in review is visible at a glance and
   invisible in a list. The calendar answers "what is going out on
   Thursday", which a board cannot show at all.

   ---- Dragging ----

   A card moved between columns that mean different statuses IS the
   transition, with the transition's own permission: dragging from In
   review to Ready is approving, and the database asks for
   `social.approve` exactly as the button does. Moving between Ideas and
   Writing, which are both drafts, is organising.

   So this file never writes a status. It calls /api/content/board and
   lets `content_move_card` decide what the move costs.

   Drawn from `components/kit` and semantic tokens. The package this
   came in with brought its own stylesheet; none of it is used.
   ============================================================= */

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};

export type CardProps = {
  post: Post;
  channels: Channel[];
  networks: Network[];
  variants: Variant[];
  onOpen: (post: Post) => void;
};

function networkLabels(post: Post, variants: Variant[], channels: Channel[], networks: Network[]): string[] {
  const mine = variants.filter((v) => v.post_id === post.id);
  /* A post written before channels existed has no variants and still
     has to say where it went. `platform` is the legacy array, kept true
     by the trigger in migration 054, and it is the only answer the
     posts already in this database have. */
  if (!mine.length) return post.platform ?? [];
  const byId = new Map(channels.map((c) => [c.id, c]));
  const byKey = new Map(networks.map((n) => [n.key, n]));
  const out = new Set<string>();
  for (const v of mine) {
    const c = byId.get(v.channel_id);
    if (c) out.add(byKey.get(c.network_key)?.label ?? c.network_key);
  }
  return [...out];
}

export function PostCard({ post, channels, networks, variants, onOpen }: CardProps) {
  const labels = networkLabels(post, variants, channels, networks);
  /* One shape of date, not two. A card reading "Tue 25 Aug, 1:00 pm"
     next to one reading "2026-08-24" looks like two different fields. */
  const when = post.scheduled_at ? whenLabel(post.scheduled_at) : dayLabel(`${post.scheduled_date}T12:00:00`);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', post.id);
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      }}
      onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onClick={() => onOpen(post)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 7, width: '100%', textAlign: 'left',
        padding: 0, cursor: 'grab', overflow: 'hidden',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${post.status === 'failed' ? 'var(--danger)' : 'var(--border-emphasis)'}`,
        borderRadius: 'var(--r)',
      }}
    >
      {post.image_url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={post.image_url} alt="" style={{ width: '100%', height: 92, objectFit: 'cover', display: 'block' }} />
      )}
      <span style={{
        padding: post.image_url ? '0 11px' : '10px 11px 0',
        fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)',
      }}>
        {post.content.length > 132 ? `${post.content.slice(0, 132)}...` : post.content}
      </span>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '0 11px 10px',
      }}>
        {labels.slice(0, 3).map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
        {labels.length > 3 && <Badge tone="neutral">+{labels.length - 3}</Badge>}
        {post.lint_severity === 'blocking' && (
          <Badge tone="danger"><AlertTriangle size={10} /> Compliance</Badge>
        )}
        {post.is_sensitive && <Badge tone="danger" dot>Sensitive</Badge>}
        {post.status === 'failed' && <Badge tone="danger">Failed</Badge>}
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: 'var(--text-subtle)',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>{when}</span>
      </span>
    </button>
  );
}

export function Board({
  posts, columns, channels, networks, variants, onOpen, onMove, busy,
}: {
  posts: Post[];
  columns: BoardColumn[];
  channels: Channel[];
  networks: Network[];
  variants: Variant[];
  onOpen: (post: Post) => void;
  onMove: (postId: string, columnId: string, position: number) => void;
  busy: string | null;
}) {
  const [over, setOver] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const c of columns) map.set(c.id, []);
    /* A post whose column was never set still has to appear, or the
       board draws an empty planner over a full table. It lands in the
       first column that matches its status, which is what the trigger
       in migration 054 does for anything written since, and what its
       backfill does for the posts that were already here. */
    const fallback = new Map<string, string>();
    for (const c of [...columns].sort((a, b) => a.position - b.position)) {
      if (!fallback.has(c.maps_to_status)) fallback.set(c.maps_to_status, c.id);
    }
    for (const p of posts) {
      const id = (p.board_column_id && map.has(p.board_column_id))
        ? p.board_column_id
        : fallback.get(p.status);
      if (id) map.get(id)!.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.board_position - b.board_position
        || (b.updated_at > a.updated_at ? 1 : -1));
    }
    return map;
  }, [posts, columns]);

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', overflowX: 'auto', paddingBottom: 4 }}>
      {columns.map((col) => {
        const list = byColumn.get(col.id) ?? [];
        const overLimit = col.wip_limit != null && list.length > col.wip_limit;
        const dropping = over === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMove(id, col.id, list.length);
            }}
            style={{
              ...PANEL,
              width: 266, flex: 'none', display: 'flex', flexDirection: 'column',
              minHeight: 220, maxHeight: 620,
              background: dropping ? 'var(--bg-subtle)' : 'var(--surface)',
              borderColor: dropping ? 'var(--border-emphasis)' : 'var(--border)',
            }}
          >
            <div
              title={col.description ?? undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
                height: 32, padding: '0 12px',
                borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)',
              }}
            >
              <Label>{col.label}</Label>
              {overLimit && (
                <span title={`More than ${col.wip_limit} at once`}>
                  <Badge tone="warning">over</Badge>
                </span>
              )}
              <span style={{
                marginLeft: 'auto', fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
              }}>{list.length}</span>
            </div>
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              padding: 8, display: 'flex', flexDirection: 'column', gap: 7,
            }}>
              {list.map((p) => (
                <div key={p.id} style={{ opacity: busy === p.id ? 0.5 : 1 }}>
                  <PostCard
                    post={p} channels={channels} networks={networks}
                    variants={variants} onOpen={onOpen}
                  />
                </div>
              ))}
              {list.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', padding: '6px 2px' }}>
                  {col.key === 'ideas' ? 'Nothing written down yet.' : 'Nothing here.'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------
   The calendar.

   A month at a time, with the queue's own free slots drawn in. That
   last part is the difference between a calendar and a planner: an
   empty Thursday with two unfilled slots on it is a different thing
   from an empty Thursday with none, and only one of them is a gap
   somebody should fill.
   ------------------------------------------------------------- */
export function Calendar({
  posts, channels, networks, variants, onOpen, freeSlots, month, onMonth,
}: {
  posts: Post[];
  channels: Channel[];
  networks: Network[];
  variants: Variant[];
  onOpen: (post: Post) => void;
  /** Day key to the number of unfilled posting slots on it. */
  freeSlots: Record<string, number>;
  month: Date;
  onMonth: (d: Date) => void;
}) {
  const today = dayKey(new Date());

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    /* Weeks start on Monday. The queue's own day numbering starts on
       Sunday because that is PostgreSQL's, and the two are converted
       where they meet rather than one of them being bent. */
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - lead);

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const key = postDay(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
    }
    return map;
  }, [posts]);

  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const byKey = useMemo(() => new Map(networks.map((n) => [n.key, n])), [networks]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 14px', ...PANEL,
      }}>
        <IconButton
          label="Previous month"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ChevronLeft size={14} />
        </IconButton>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
          color: 'var(--text)', minWidth: 148,
        }}>
          {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </div>
        <IconButton
          label="Next month"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ChevronRight size={14} />
        </IconButton>
        <Button size="sm" variant="secondary" onClick={() => onMonth(new Date())}>Today</Button>
      </div>

      <div style={{
        ...PANEL,
        display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gridAutoRows: 'minmax(94px, auto)',
      }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} style={{
            height: 30, display: 'flex', alignItems: 'center', padding: '0 9px',
            background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
          }}>{d}</div>
        ))}
        {cells.map((d) => {
          const key = dayKey(d);
          const outside = d.getMonth() !== month.getMonth();
          const list = byDay.get(key) ?? [];
          const free = freeSlots[key] ?? 0;
          const isToday = key === today;
          return (
            <div key={key} style={{
              display: 'flex', flexDirection: 'column', gap: 3, padding: 6, minWidth: 0,
              borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              background: outside ? 'var(--surface-sunken)' : 'var(--surface)',
            }}>
              <span style={{
                alignSelf: 'flex-start',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 20, height: 20, padding: '0 5px', borderRadius: 'var(--r-full)',
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
                background: isToday ? 'var(--accent)' : 'transparent',
                color: isToday ? 'var(--accent-fg)' : outside ? 'var(--text-subtle)' : 'var(--text-muted)',
              }}>{d.getDate()}</span>

              {list.slice(0, 4).map((p) => {
                const first = variants.find((v) => v.post_id === p.id);
                const channel = first ? byId.get(first.channel_id) : null;
                return (
                  <button
                    key={p.id}
                    onClick={() => onOpen(p)}
                    style={{
                      textAlign: 'left', width: '100%', padding: '3px 6px', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: 1,
                      borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                      borderLeft: `2px solid ${p.status === 'failed' ? 'var(--danger)' : 'var(--border-emphasis)'}`,
                      background: 'var(--bg-subtle)', color: 'var(--text)',
                      fontFamily: 'var(--inter)', fontSize: 11, lineHeight: 1.4,
                      overflow: 'hidden',
                    }}
                  >
                    <span style={{ color: 'var(--text-subtle)', fontSize: 10, whiteSpace: 'nowrap' }}>
                      {p.scheduled_at
                        ? new Date(p.scheduled_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
                        : STATUS_LABEL[p.status]}
                      {channel && ` · ${byKey.get(channel.network_key)?.label ?? channel.network_key}`}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.content.length > 40 ? `${p.content.slice(0, 40)}...` : p.content}
                    </span>
                  </button>
                );
              })}
              {list.length > 4 && (
                <span style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>{list.length - 4} more</span>
              )}
              {!outside && free > 0 && list.length === 0 && (
                <span style={{
                  fontSize: 10.5, color: 'var(--text-subtle)', padding: '2px 6px',
                  border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-sm)',
                }}>
                  {free} free slot{free === 1 ? '' : 's'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
