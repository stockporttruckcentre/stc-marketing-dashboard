'use client';

import { useState } from 'react';
import * as Lucide from 'lucide-react';
import { Bell, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Badge, Button, type Tone } from '@/components/kit/primitives';
import {
  actionsFor, ago, allLink, bunchItems, KIND_ICON, toneOf,
  type NotificationAction, type NotificationRow,
} from '@/lib/notifications/types';

/* =============================================================
   One notification.

   Built from the kit's list row and activity timeline: a coloured dot
   in a gutter, the sentence at 13px, the time under it at 11.5px
   subtle. What the kit does not have, because no prototype needed it,
   is the two things that make this worth building at all.

   ---- The buttons ----

   An invitation you have to go and find the meeting to answer has
   wasted the trip. So the actions the kind carries are on the card:
   navy on the one to press, quiet on the rest, and no red anywhere.

   Rule one of the kit is doing real work in that last part. A list is a
   column of independent cards each with its own primary, so an accent
   on the primary is not one red button on a screen, it is one per card.
   Screenshotted at 1080p with five cards and it read as a wall of red.
   Red is kept for destructive intent, and nothing here is destructive:
   clearing one is a small X, and calling a meeting off happens in the
   diary.

   ---- The bunch ----

   Two accounts assigned in one breath is one row saying two. It opens
   to show both, because a count with nothing under it is a number
   somebody has to go and check.

   A bunch has no buttons. Three invitations behind one row cannot
   share an Accept: it would have to mean all three, and somebody who
   meant one has just accepted two meetings they have not read.
   ============================================================= */

const DOT: Record<Tone, string> = {
  neutral: 'var(--text-subtle)', info: 'var(--info)', success: 'var(--success)',
  warning: 'var(--warning)', danger: 'var(--danger)', accent: 'var(--accent)',
};

/** Lucide by name, so `lib/notifications/types.ts` stays a data file. */
function KindIcon({ kind, size = 15 }: { kind: string; size?: number }) {
  const name = KIND_ICON[kind];
  const Found = name
    ? (Lucide as unknown as Record<string, typeof Bell | undefined>)[name]
    : undefined;
  const Icon = Found ?? Bell;
  return <Icon size={size} />;
}

export function NotificationCard({
  n, onAction, onOpen, onDismiss, compact = false,
}: {
  n: NotificationRow;
  /** Carrying out one of the kind's buttons. */
  onAction: (n: NotificationRow, action: NotificationAction) => void;
  /** Following it through to wherever it points. */
  onOpen: (n: NotificationRow) => void;
  onDismiss: (n: NotificationRow) => void;
  /** The bell panel is tighter than the page. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const tone = toneOf(n);
  const items = bunchItems(n);
  const actions = actionsFor(n);
  const more = allLink(n);
  const unread = n.read_at === null;
  const answered = n.actioned_at !== null;

  return (
    <div
      style={{
        display: 'flex', gap: 11,
        padding: compact ? '11px 13px' : '13px 15px',
        borderBottom: '1px solid var(--border)',
        /* Unread carries a tint rather than a bolder weight. Bold on
           every row in a list of forty is a list with no hierarchy. */
        background: unread ? 'var(--bg-subtle)' : 'transparent',
      }}
    >
      {/* The gutter. Dot for severity, icon for what it is about. */}
      <span style={{
        flex: 'none', width: 26, height: 26, borderRadius: 'var(--r)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, currentColor 12%, transparent)',
        color: DOT[tone], marginTop: 1,
      }}>
        <KindIcon kind={n.kind} />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button
            onClick={() => onOpen(n)}
            style={{
              flex: 1, minWidth: 0, textAlign: 'left', padding: 0,
              border: 'none', background: 'transparent',
              cursor: n.link_path ? 'pointer' : 'default',
              fontFamily: 'var(--inter)', fontSize: 13, lineHeight: 1.45,
              fontWeight: unread ? 600 : 500, color: 'var(--text)',
              letterSpacing: '-0.01em',
            }}
          >{n.title}</button>

          {n.item_count > 1 && <Badge tone={tone}>{n.item_count}</Badge>}

          <button
            onClick={() => onDismiss(n)}
            aria-label="Clear this"
            title="Clear this"
            style={{
              flex: 'none', border: 'none', background: 'transparent',
              color: 'var(--text-subtle)', cursor: 'pointer', padding: 0, height: 16,
            }}
          ><X size={13} /></button>
        </div>

        {n.body && (
          <span style={{
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: compact ? 2 : 4,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{n.body}</span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            {ago(n.updated_at ?? n.created_at)}
          </span>
          {answered && (
            <span style={{ fontSize: 11.5, color: 'var(--success)' }}>
              {said(n.action_taken)}
            </span>
          )}
        </div>

        {/* ---- what is inside a bunch ---- */}
        {n.item_count > 1 && items.length > 0 && (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{
                alignSelf: 'flex-start', marginTop: 3, padding: 0, border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 600,
                color: 'var(--accent)',
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {open ? 'Hide them' : `Show all ${n.item_count}`}
            </button>

            {open && (
              <div style={{
                marginTop: 5, borderLeft: '1px solid var(--border)', paddingLeft: 11,
                display: 'flex', flexDirection: 'column', gap: 7,
              }}>
                {items.map((it, i) => (
                  <button
                    key={`${it.id ?? i}`}
                    onClick={() => it.link && onOpen({ ...n, link_path: it.link })}
                    style={{
                      textAlign: 'left', padding: 0, border: 'none', background: 'transparent',
                      cursor: it.link ? 'pointer' : 'default',
                      display: 'flex', flexDirection: 'column', gap: 1,
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{it.title}</span>
                    {it.body && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{it.body}</span>
                    )}
                  </button>
                ))}
                {items.length < n.item_count && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                    and {n.item_count - items.length} more
                  </span>
                )}
                {more && (
                  <button
                    onClick={() => onOpen({ ...n, link_path: more })}
                    style={{
                      alignSelf: 'flex-start', padding: 0, border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 600,
                      color: 'var(--accent)',
                    }}
                  >Open the lot</button>
                )}
              </div>
            )}
          </>
        )}

        {/* ---- what you can do about it ---- */}
        {!answered && actions.length > 0 && (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 7 }}>
            {actions.map((a) => (
              <Button
                key={a.key} size="sm" variant={a.variant}
                onClick={() => onAction(n, a)}
              >
                <ActionIcon name={a.icon} />
                {a.label}
              </Button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function ActionIcon({ name }: { name?: string }) {
  if (!name) return null;
  const Found = (Lucide as unknown as Record<string, typeof Bell | undefined>)[name];
  if (!Found) return null;
  return <Found size={13} />;
}

/** What was done, said back rather than echoed as a key. */
function said(what: string | null): string {
  switch (what) {
    case 'accept':    return 'You said you can make it';
    case 'decline':   return 'You said you cannot';
    case 'confirmed': return 'Confirmed';
    case 'queried':   return 'Queried';
    case 'dropped':   return 'Left it';
    case 'download':  return 'Downloaded';
    default:          return 'Done';
  }
}
