'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  X, Check, Send, CalendarClock, Zap, Pencil, ExternalLink,
  AlertTriangle, Undo2, CheckCheck, Megaphone,
} from 'lucide-react';
import {
  STATUS_LABEL, VARIANT_LABEL, whenLabel,
  type ActivityLine, type Channel, type Network, type Post, type Variant,
} from '@/lib/content/types';
import { PreviewColumn } from './previews';
import type { Capability } from '@/lib/platform/permissions/catalog';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { Drawer, Field, TextArea, TextInput } from '@/components/kit/forms';

/* =============================================================
   One post, everything about it, and everything you can do to it.

   ---- Nothing here appears that would then refuse ----

   A control that appears and then refuses teaches people the tool is
   unreliable. So each button is drawn only when the person holds the
   capability AND the post is in a state the transition accepts.
   `social.approveOwn` is the interesting one: an author who can approve
   still does not see Approve on their own post, because the database
   will refuse it and telling them afterwards is worse than not
   offering.

   ---- The trail ----

   The Activity panel is the `activity` table from migration 050, not a
   second history built for this screen. That is why it can say a post
   took nine days and sat with an approver for six.
   ============================================================= */

type Move = 'submit' | 'approve' | 'reject' | 'schedule' | 'unschedule' | 'publish';

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};
const TD: CSSProperties = {
  padding: '0 12px', height: 34, borderBottom: '1px solid var(--border)',
  fontSize: 12.5, color: 'var(--text-muted)',
};

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={PANEL}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        <Label>{title}</Label>
      </div>
      {children}
    </section>
  );
}

/** The timeline, drawn the same way in the drawer and on the tab. */
export function Timeline({ lines, empty }: { lines: ActivityLine[]; empty: string }) {
  if (!lines.length) {
    return <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-subtle)' }}>{empty}</div>;
  }
  return (
    <div>
      {lines.map((a) => (
        <div key={a.id} style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          padding: '9px 12px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            width: 108, flex: 'none', fontSize: 11.5, color: 'var(--text-subtle)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {new Date(a.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {' '}
            {new Date(a.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)' }}>
            {a.summary}
            {a.subject_label && (
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                {a.subject_label.length > 70 ? `${a.subject_label.slice(0, 70)}...` : a.subject_label}
              </span>
            )}
          </span>
          <span style={{
            width: 130, flex: 'none', textAlign: 'right',
            fontSize: 11.5, color: 'var(--text-subtle)',
          }}>
            {a.actor_label ?? 'The system'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PostDrawer({
  post, variants, channels, networks, caps, meId, onClose, onChanged, onEdit,
}: {
  post: Post;
  variants: Variant[];
  channels: Channel[];
  networks: Network[];
  caps: Set<Capability>;
  meId: string;
  onClose: () => void;
  onChanged: (post: Post) => void;
  onEdit: (post: Post) => void;
}) {
  const [busy, setBusy] = useState<Move | 'mark' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<'reject' | 'schedule' | null>(null);
  const [at, setAt] = useState('');
  const [activity, setActivity] = useState<ActivityLine[]>([]);

  const mine = variants.filter((v) => v.post_id === post.id);
  const onChannels = mine
    .map((v) => channels.find((c) => c.id === v.channel_id))
    .filter(Boolean) as Channel[];
  const anyConnected = onChannels.some((c) => c.state === 'connected');

  useEffect(() => {
    let alive = true;
    fetch(`/api/content/posts/${post.id}/transition`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setActivity(j.activity ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [post.id]);

  const move = useCallback(async (which: Move, body: Record<string, unknown> = {}) => {
    setBusy(which); setError(null);
    try {
      const res = await fetch(`/api/content/posts/${post.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ move: which, ...body }),
      });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) { setError(json.message ?? 'That was refused.'); return; }
      setAsking(null); setNote('');
      onChanged(json.post as Post);
    } catch {
      setBusy(null);
      setError('That did not reach the server. Try again.');
    }
  }, [post.id, onChanged]);

  const markPosted = useCallback(async () => {
    setBusy('mark'); setError(null);
    try {
      /* Recording that somebody posted it on the network by hand. No
         driver exists yet, so without this every post sits at Scheduled
         forever. It is recorded as manual, so a report can tell the
         difference between what this product published and what a
         person did and then wrote down. */
      const res = await fetch(`/api/content/posts/${post.id}/posted`, { method: 'POST' });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) { setError(json.message ?? 'That was refused.'); return; }
      onChanged(json.post as Post);
    } catch {
      setBusy(null);
      setError('That did not reach the server. Try again.');
    }
  }, [post.id, onChanged]);

  const isAuthor = post.author_id === meId;
  const canApprove = caps.has('social.approve') || caps.has('marketing.approve');
  /* An author approving their own work needs the second capability, and
     the database refuses it without one. Hiding the button rather than
     letting it fail is the whole rule. */
  const mayApproveThis = canApprove && (!isAuthor || caps.has('social.approveOwn'));
  const canSchedule = caps.has('social.schedule') || caps.has('marketing.edit');
  const canWrite = caps.has('social.draft') || caps.has('marketing.edit');

  return (
    <Drawer
      eyebrow={STATUS_LABEL[post.status]}
      title={post.content.length > 46 ? `${post.content.slice(0, 46)}...` : post.content}
      icon={<Megaphone size={18} />}
      onClose={onClose}
      footer={
        <>
          {post.status === 'draft' && canWrite && (
            <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => move('submit')}>
              <Send size={13} /> {busy === 'submit' ? 'Sending' : 'Submit for review'}
            </Button>
          )}

          {post.status === 'pending_review' && mayApproveThis && (
            <>
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => move('approve')}>
                <Check size={13} /> {busy === 'approve' ? 'Approving' : 'Approve'}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setAsking('reject')}>
                <X size={13} /> Send back
              </Button>
            </>
          )}
          {post.status === 'pending_review' && canApprove && isAuthor && !caps.has('social.approveOwn') && (
            <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              You wrote this, so somebody else approves it.
            </span>
          )}

          {post.status === 'approved' && canSchedule && (
            <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setAsking('schedule')}>
              <CalendarClock size={13} /> Schedule
            </Button>
          )}
          {post.status === 'scheduled' && canSchedule && (
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => move('unschedule')}>
              <Undo2 size={13} /> Out of the queue
            </Button>
          )}

          {/* Publishing exists only where a channel is actually
              connected. None is yet, so this stays hidden rather than
              appearing and refusing. */}
          {(post.status === 'approved' || post.status === 'scheduled')
            && caps.has('social.publishNow') && anyConnected && (
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => move('publish')}>
              <Zap size={13} /> Publish now
            </Button>
          )}

          {['approved', 'scheduled', 'publishing', 'failed'].includes(post.status)
            && (caps.has('social.publishNow') || caps.has('marketing.edit')) && (
            <Button
              size="sm" variant="secondary" disabled={busy !== null} onClick={markPosted}
              title="Somebody posted this on the network themselves. Record that here."
            >
              <CheckCheck size={13} /> {busy === 'mark' ? 'Recording' : 'Mark posted'}
            </Button>
          )}

          <span style={{ flex: 1 }} />
          {post.published_at && (
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              Out {whenLabel(post.published_at)}
            </span>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="neutral" dot>{STATUS_LABEL[post.status]}</Badge>
        {post.is_sensitive && <Badge tone="danger" dot>Sensitive</Badge>}
        <span style={{ flex: 1 }} />
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => onEdit(post)}>
            <Pencil size={12} /> Edit
          </Button>
        )}
      </div>

      {post.status === 'failed' && post.failure_reason && (
        <Alert tone="danger">
          <AlertTriangle size={13} /> {post.failure_reason}
        </Alert>
      )}
      {post.rejection_note && post.status === 'draft' && (
        <Alert tone="warning">Sent back: {post.rejection_note}</Alert>
      )}
      {post.lint_severity && post.lint_severity !== 'clean' && (
        <Alert tone={post.lint_severity === 'blocking' ? 'danger' : 'warning'}>
          <span>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              {post.lint_severity === 'blocking'
                ? 'Wording: fix before this goes out'
                : 'Wording: worth a look'}
            </span>
            {(post.lint_findings ?? []).map((f, i) => <span key={i} style={{ display: 'block' }}>{f.message}</span>)}
          </span>
        </Alert>
      )}

      {/* ---- where it is going, and what happened there ---- */}
      <Panel title="Channels">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {mine.map((v) => {
              const c = channels.find((x) => x.id === v.channel_id);
              const n = networks.find((x) => x.key === c?.network_key);
              return (
                <tr key={v.id}>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>
                    {n?.label ?? c?.network_key}
                  </td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>@{c?.handle}</td>
                  <td style={TD}>
                    {VARIANT_LABEL[v.state]}
                    {v.content && <span style={{ color: 'var(--text-subtle)' }}> · own words</span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                    {v.scheduled_at ? whenLabel(v.scheduled_at, c?.timezone) : ''}
                    {v.permalink && (
                      <a
                        href={v.permalink} target="_blank" rel="noreferrer"
                        style={{ marginLeft: 8, color: 'var(--accent)' }}
                        aria-label="Open the published post"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {mine.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...TD, color: 'var(--text-subtle)' }}>
                  {post.platform?.length
                    ? `No channels on it yet. It was written down as going to ${post.platform.join(', ')}.`
                    : 'No channels yet, so this has nowhere to go.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <PreviewColumn
        channels={onChannels}
        networks={networks}
        post={{
          content: post.content,
          caption: post.caption,
          first_comment: post.first_comment,
          hashtags: post.hashtags ?? [],
          image_url: post.image_url,
          scheduled_date: post.scheduled_date,
        }}
        variantText={Object.fromEntries(mine.map((v) => [v.channel_id, v.content]))}
        empty="This post has no channels on it yet, so there is nothing to preview against."
      />

      {post.internal_note && (
        <Panel title="Internal note">
          <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {post.internal_note}
          </div>
        </Panel>
      )}

      <Panel title="Activity">
        <Timeline lines={activity} empty="Nothing has happened to this yet beyond being written." />
      </Panel>

      {asking === 'reject' && (
        <Panel title="Send it back">
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="What needs changing">
              <TextArea
                value={note}
                onChange={setNote}
                rows={3}
                placeholder="A rejection with no reason sends somebody back to the same screen."
              />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => { setAsking(null); setNote(''); }}>
                Cancel
              </Button>
              <Button
                size="sm" variant="primary"
                disabled={!note.trim() || busy !== null}
                onClick={() => move('reject', { note })}
              >Send it back</Button>
            </div>
          </div>
        </Panel>
      )}

      {asking === 'schedule' && (
        <Panel title="Schedule it">
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="When">
              <TextInput type="datetime-local" value={at} onChange={setAt} />
            </Field>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              <Button
                size="sm" variant="secondary" disabled={busy !== null}
                onClick={() => move('schedule', { at: null })}
                title="Put it in the next free slot on every channel"
              >Next free slot</Button>
              <Button
                size="sm" variant="primary" disabled={!at || busy !== null}
                onClick={() => move('schedule', { at: new Date(at).toISOString() })}
              >Schedule</Button>
            </div>
          </div>
        </Panel>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Drawer>
  );
}
