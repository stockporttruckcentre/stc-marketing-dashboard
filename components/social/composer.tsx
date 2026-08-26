'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Upload, Image as ImageIcon, Hash, Link2, Clock, CalendarDays,
  AlertTriangle, FileText, Trash2, Check, PenLine,
} from 'lucide-react';
import {
  countFor, whenLabel, utmFor,
  type Campaign, type Channel, type LibraryItem, type Network,
  type Post, type Tag, type Template, type Variant,
} from '@/lib/content/types';
import { PreviewColumn } from './previews';
import type { Capability } from '@/lib/platform/permissions/catalog';
import { Alert, Bar, Button, Chip, Label } from '@/components/kit/primitives';
import { Drawer, Field, Segmented, Select, Split, TextArea, TextInput } from '@/components/kit/forms';

/* =============================================================
   The composer.

   Everything the old one had, in the same order, plus what a proper
   planner needs: per channel tailoring, a first comment where the
   network takes one, links that generate their own tags, templates,
   campaigns, tags, and the wording findings as they are typed rather
   than after somebody submits.

   ---- The character count ----

   Per network, and counted the way each network counts. X charges a
   fixed 23 characters for a link whatever its real length, because it
   shortens them itself, so a composer that counts the raw string tells
   somebody they are forty over when they are not. `countFor` in
   lib/content/types.ts is that, in one place.

   ---- Why tailoring is a tab and not a second field ----

   The common case is one set of words everywhere, and making that case
   cost six text boxes would be worse than what it replaces rather than
   better. So the main box is the post, and a channel only gets its own
   words when somebody asks for them. A channel with its own words says
   so, so nobody edits the main box and wonders why X did not change.
   ============================================================= */

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};

type Draft = {
  content: string;
  caption: string;
  firstComment: string;
  hashtags: string;
  linkUrl: string;
  internalNote: string;
  imageUrl: string | null;
  channelIds: string[];
  variants: Record<string, string>;
  campaignId: string;
  templateId: string | null;
  tagIds: string[];
  /** '' means no time chosen yet. */
  scheduledAt: string;
  mode: 'queue' | 'time' | 'none';
};

const EMPTY: Draft = {
  content: '', caption: '', firstComment: '', hashtags: '', linkUrl: '',
  internalNote: '', imageUrl: null, channelIds: [], variants: {},
  campaignId: '', templateId: null, tagIds: [], scheduledAt: '', mode: 'none',
};

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section style={PANEL}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        {icon && <span style={{ color: 'var(--text-subtle)', display: 'flex' }}>{icon}</span>}
        <Label>{title}</Label>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  );
}

export function Composer({
  post, variants, channels, networks, templates, campaigns, tags, library,
  caps, canApprove, onClose, onSaved, uploadImage,
}: {
  /** An existing post to edit, or null for a new one. */
  post: Post | null;
  variants: Variant[];
  channels: Channel[];
  networks: Network[];
  templates: Template[];
  campaigns: Campaign[];
  tags: Tag[];
  library: LibraryItem[];
  caps: Set<Capability>;
  canApprove: boolean;
  onClose: () => void;
  onSaved: (post: Post, submitted: boolean) => void;
  uploadImage: (file: File) => Promise<{ ok: true; url: string } | { ok: false; why: string }>;
}) {
  const byKey = useMemo(() => new Map(networks.map((n) => [n.key, n])), [networks]);
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const [draft, setDraft] = useState<Draft>(() => {
    if (!post) return EMPTY;
    const perChannel: Record<string, string> = {};
    for (const v of variants) if (v.content) perChannel[v.channel_id] = v.content;
    return {
      content: post.content,
      caption: post.caption ?? '',
      firstComment: post.first_comment ?? '',
      hashtags: (post.hashtags ?? []).join(' '),
      linkUrl: post.link_url ?? '',
      internalNote: post.internal_note ?? '',
      imageUrl: post.image_url,
      channelIds: variants.map((v) => v.channel_id),
      variants: perChannel,
      campaignId: post.campaign_id ?? '',
      templateId: post.template_id,
      tagIds: [],
      scheduledAt: post.scheduled_at ? post.scheduled_at.slice(0, 16) : '',
      mode: post.scheduled_at ? 'time' : post.from_queue ? 'queue' : 'none',
    };
  });

  const [tailoring, setTailoring] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextSlots, setNextSlots] = useState<Record<string, string | null>>({});
  const [showLibrary, setShowLibrary] = useState(false);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const chosen = useMemo(
    () => draft.channelIds.map((id) => byId.get(id)).filter(Boolean) as Channel[],
    [draft.channelIds, byId],
  );

  /* What the queue would do with this right now, so somebody choosing
     between the queue and a time can see what the queue would pick. */
  useEffect(() => {
    if (draft.mode !== 'queue' || !draft.channelIds.length) return;
    let alive = true;
    fetch(`/api/content/queue?channels=${draft.channelIds.join(',')}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setNextSlots(j.slots ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [draft.mode, draft.channelIds]);

  const hashtagList = useMemo(
    () => draft.hashtags.split(/[,\s#]+/).map((s) => s.trim()).filter(Boolean),
    [draft.hashtags],
  );

  /** The text a given channel would actually receive. */
  const textFor = useCallback((channelId: string) => {
    const own = draft.variants[channelId];
    const base = own && own.trim() ? own : draft.content;
    const tags = hashtagList.length ? `\n\n${hashtagList.map((h) => `#${h}`).join(' ')}` : '';
    return base + tags;
  }, [draft.variants, draft.content, hashtagList]);

  /** Every channel that would be refused, and why. */
  const problems = useMemo(() => {
    const out: { channel: Channel; why: string }[] = [];
    for (const c of chosen) {
      const n = byKey.get(c.network_key);
      if (!n) continue;
      const used = countFor(textFor(c.id), n.key);
      if (used > n.char_limit) {
        out.push({ channel: c, why: `${used - n.char_limit} over ${n.label}'s ${n.char_limit}` });
      }
      if (n.requires_media && !draft.imageUrl) {
        out.push({ channel: c, why: `${n.label} will not take a post with no picture` });
      }
    }
    return out;
  }, [chosen, byKey, textFor, draft.imageUrl]);

  const previewPost = {
    content: draft.content,
    caption: draft.caption || null,
    first_comment: draft.firstComment || null,
    hashtags: hashtagList,
    image_url: draft.imageUrl,
    scheduled_date: draft.scheduledAt ? draft.scheduledAt.slice(0, 10) : undefined,
  };

  const variantText = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const c of chosen) {
      const own = draft.variants[c.id];
      out[c.id] = own && own.trim() ? own : null;
    }
    return out;
  }, [chosen, draft.variants]);

  function applyTemplate(t: Template) {
    setDraft((d) => ({
      ...d,
      content: t.body,
      firstComment: t.first_comment ?? d.firstComment,
      hashtags: t.hashtags.length ? t.hashtags.join(' ') : d.hashtags,
      templateId: t.id,
      channelIds: t.network_keys.length
        ? channels.filter((c) => t.network_keys.includes(c.network_key)).map((c) => c.id)
        : d.channelIds,
    }));
    fetch('/api/content/templates', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: t.id, used: true }),
    }).catch(() => {});
  }

  async function pickImage(file: File) {
    setUploading(true); setError(null);
    const done = await uploadImage(file);
    setUploading(false);
    if (!done.ok) { setError(done.why); return; }
    set('imageUrl', done.url);
  }

  async function save(then: 'draft' | 'submit') {
    setError(null);
    if (!draft.content.trim()) { setError('A post with nothing in it is not a post.'); return; }
    if (then === 'submit' && !draft.channelIds.length) {
      setError('Pick at least one channel. A post with nowhere to go cannot be submitted.');
      return;
    }
    setBusy(then === 'submit' ? 'submit' : 'save');

    const link = draft.linkUrl.trim();
    const body = {
      content: draft.content.trim(),
      caption: draft.caption.trim() || null,
      first_comment: draft.firstComment.trim() || null,
      hashtags: hashtagList,
      channel_ids: draft.channelIds,
      variants: Object.fromEntries(
        Object.entries(draft.variants)
          .filter(([, v]) => v && v.trim())
          .map(([k, v]) => [k, { content: v.trim() }]),
      ),
      scheduled_at: draft.mode === 'time' && draft.scheduledAt
        ? new Date(draft.scheduledAt).toISOString() : null,
      campaign_id: draft.campaignId || null,
      template_id: draft.templateId,
      link_url: link || null,
      internal_note: draft.internalNote.trim() || null,
      tag_ids: draft.tagIds,
    };

    try {
      const res = post
        ? await fetch(`/api/content/posts/${post.id}`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/content/posts', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
      const json = await res.json();
      if (!json.ok) { setBusy(null); setError(json.message ?? 'That could not be saved.'); return; }

      let saved = json.post as Post;

      /* Editing an existing post: the channel set and the tags are
         their own endpoints, because replacing them is a set operation
         and a published channel must never be dropped. */
      if (post) {
        await fetch(`/api/content/posts/${post.id}/variants`, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel_ids: draft.channelIds, variants: body.variants }),
        });
        await fetch(`/api/content/posts/${post.id}/tags`, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tag_ids: draft.tagIds }),
        });
      }

      if (then === 'submit') {
        const moved = await (await fetch(`/api/content/posts/${saved.id}/transition`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ move: 'submit' }),
        })).json();
        if (!moved.ok) {
          setBusy(null);
          setError(moved.message ?? 'It saved, but it could not be submitted.');
          return;
        }
        saved = moved.post as Post;
      }

      setBusy(null);
      onSaved(saved, then === 'submit');
    } catch {
      setBusy(null);
      setError('That did not reach the server. Try again.');
    }
  }

  const activeNetwork = tailoring ? byKey.get(byId.get(tailoring)?.network_key ?? 'x') : null;
  const activeCount = tailoring && activeNetwork ? countFor(textFor(tailoring), activeNetwork.key) : 0;

  return (
    <Drawer
      eyebrow={post ? 'Editing' : 'New'}
      title={post ? 'Edit post' : 'New post'}
      icon={<PenLine size={18} />}
      onClose={onClose}
      width={1080}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <span style={{ flex: 1 }} />
          {post && caps.has('social.delete') && (
            <Button
              size="sm" variant="secondary"
              onClick={async () => {
                if (!confirm('Delete this post? It can be restored by an administrator.')) return;
                await fetch(`/api/content/posts/${post.id}`, { method: 'DELETE' });
                onClose();
              }}
            >
              <Trash2 size={12} /> Delete
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => save('draft')}>
            {busy === 'save' ? 'Saving' : 'Save draft'}
          </Button>
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => save('submit')}>
            {busy === 'submit'
              ? 'Sending'
              : canApprove ? 'Save and send for approval' : 'Submit for review'}
          </Button>
        </>
      }
    >
      {templates.length > 0 && !post && (
        <div style={{ width: 260 }}>
          <Field label="Start from a template">
            <Select
              value=""
              onChange={(v) => {
                const t = templates.find((x) => x.id === v);
                if (t) applyTemplate(t);
              }}
            >
              <option value="">Write it from scratch</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
      )}

      <div style={{
        display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
        alignItems: 'start',
      }}>
        {/* ---- the left half: what the post is ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Field
            label="Post"
            hint={chosen.length ? 'Everywhere, unless a channel has its own words' : 'What goes out'}
          >
            <TextArea
              value={draft.content}
              onChange={(v) => set('content', v)}
              rows={5}
              placeholder="Just arrived on the yard: 2019 Schmitz curtainsider, MOT to March."
            />
          </Field>

          <CharMeters
            chosen={chosen}
            byKey={byKey}
            textFor={textFor}
            fallback={draft.content.length}
          />

          {/* ---- who it goes to ---- */}
          <Field
            label="Channels"
            hint={chosen.length ? `${chosen.length} selected` : 'None yet'}
          >
            {channels.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                No accounts are set up yet. Somebody with channel access can add them under Channels.
              </span>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {channels.map((c) => {
                  const on = draft.channelIds.includes(c.id);
                  const n = byKey.get(c.network_key);
                  return (
                    <Chip
                      key={c.id}
                      active={on}
                      title={c.state === 'connected'
                        ? `@${c.handle}`
                        : `@${c.handle}. Not connected yet, so this can be planned but not published.`}
                      onClick={() => setDraft((d) => ({
                        ...d,
                        channelIds: on
                          ? d.channelIds.filter((x) => x !== c.id)
                          : [...d.channelIds, c.id],
                      }))}
                    >
                      {on && <Check size={11} />}
                      {n?.label ?? c.network_key}
                      <span style={{ color: 'var(--text-subtle)' }}>@{c.handle}</span>
                      {/* A channel nobody has connected can be planned
                          into and scheduled, and cannot publish. Saying
                          "plan only" beats a bare marker somebody has to
                          hover to understand. */}
                      {c.state !== 'connected' && (
                        <span style={{ fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '0.04em' }}>
                          plan only
                        </span>
                      )}
                    </Chip>
                  );
                })}
              </div>
            )}
          </Field>

          {/* ---- per channel words ---- */}
          {chosen.length > 0 && (
            <Field label="Tailor a channel" hint="Only where it needs to differ">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {chosen.map((c) => {
                  const own = !!draft.variants[c.id]?.trim();
                  return (
                    <Chip
                      key={c.id}
                      active={tailoring === c.id}
                      onClick={() => setTailoring(tailoring === c.id ? null : c.id)}
                    >
                      {byKey.get(c.network_key)?.label ?? c.network_key}
                      {own && <span style={{ color: 'var(--accent)', fontSize: 10.5 }}>own</span>}
                    </Chip>
                  );
                })}
              </div>
              {tailoring && (
                <>
                  <TextArea
                    value={draft.variants[tailoring] ?? ''}
                    onChange={(v) => setDraft((d) => ({
                      ...d, variants: { ...d.variants, [tailoring]: v },
                    }))}
                    rows={4}
                    placeholder={`Leave this empty and ${byKey.get(byId.get(tailoring)?.network_key ?? 'x')?.label ?? 'this channel'} uses the post above.`}
                  />
                  {activeNetwork && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7 }}>
                      <span style={{ flex: 1 }}>
                        <Bar
                          value={Math.min(activeCount, activeNetwork.char_limit)}
                          max={activeNetwork.char_limit}
                          tone={activeCount > activeNetwork.char_limit ? 'danger' : 'neutral'}
                        />
                      </span>
                      <span style={{
                        fontSize: 11.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        color: activeCount > activeNetwork.char_limit ? 'var(--danger)' : 'var(--text-subtle)',
                        fontWeight: activeCount > activeNetwork.char_limit ? 600 : 400,
                      }}>
                        {activeCount} / {activeNetwork.char_limit}
                      </span>
                    </div>
                  )}
                </>
              )}
            </Field>
          )}

          {/* ---- the rest of the post ---- */}
          <Split>
            <Field label="Caption">
              <TextInput value={draft.caption} onChange={(v) => set('caption', v)} placeholder="Optional" />
            </Field>
            <Field label="Hashtags">
              <TextInput
                value={draft.hashtags}
                onChange={(v) => set('hashtags', v)}
                placeholder="#curtainsider #trailersales"
                trailing={<Hash size={12} />}
              />
            </Field>
          </Split>

          {chosen.some((c) => byKey.get(c.network_key)?.supports_first_comment) && (
            <Field
              label="First comment"
              hint={chosen.filter((c) => byKey.get(c.network_key)?.supports_first_comment)
                .map((c) => byKey.get(c.network_key)?.label).join(', ')}
            >
              <TextInput
                value={draft.firstComment}
                onChange={(v) => set('firstComment', v)}
                placeholder="Links and tags, kept out of the post itself"
              />
            </Field>
          )}

          <Field label="Link" hint="Tagged automatically, per channel">
            <TextInput
              value={draft.linkUrl}
              onChange={(v) => set('linkUrl', v)}
              placeholder="https://"
              trailing={<Link2 size={12} />}
            />
          </Field>
          {draft.linkUrl.trim() && chosen.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', wordBreak: 'break-all' }}>
              {utmFor(draft.linkUrl.trim(), {
                source: chosen[0].network_key,
                campaign: campaigns.find((c) => c.id === draft.campaignId)?.slug ?? null,
              })}
            </span>
          )}

          {/* ---- picture ---- */}
          <Field
            label="Image"
            hint={chosen.some((c) => byKey.get(c.network_key)?.requires_media) && !draft.imageUrl
              ? `Needed by ${chosen.filter((c) => byKey.get(c.network_key)?.requires_media)
                  .map((c) => byKey.get(c.network_key)?.label).join(', ')}`
              : undefined}
          >
            {draft.imageUrl ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.imageUrl} alt=""
                  style={{
                    width: 84, height: 84, objectFit: 'cover',
                    border: '1px solid var(--border)', borderRadius: 'var(--r)',
                  }}
                />
                <Button size="sm" variant="secondary" onClick={() => set('imageUrl', null)}>
                  <X size={12} /> Remove
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  height: 28, padding: '0 10px', borderRadius: 'var(--r)', cursor: 'pointer',
                  background: 'var(--surface)', color: 'var(--text)',
                  border: '1px solid var(--border-strong)',
                  fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600,
                }}>
                  <Upload size={13} /> {uploading ? 'Uploading' : 'Upload image'}
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = '';
                  }} />
                </label>
                {library.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setShowLibrary((s) => !s)}>
                    <FileText size={13} /> From the library
                  </Button>
                )}
              </div>
            )}
          </Field>

          {showLibrary && !draft.imageUrl && (
            <div style={{
              display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            }}>
              {library.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    set('imageUrl', `/api/files/${item.file_id}`);
                    setShowLibrary(false);
                    fetch('/api/content/library', {
                      method: 'PATCH', headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: item.id, used: true }),
                    }).catch(() => {});
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left',
                    padding: 0, cursor: 'pointer', overflow: 'hidden', ...PANEL,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/files/${item.file_id}`} alt=""
                    style={{ width: '100%', height: 76, objectFit: 'cover', display: 'block' }}
                  />
                  <span style={{
                    padding: '0 8px', fontSize: 11.5, fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{item.name}</span>
                  <span style={{ padding: '0 8px 8px', fontSize: 10.5, color: 'var(--text-subtle)' }}>
                    {item.approved_at ? 'Signed off' : 'Not signed off yet'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ---- when ---- */}
          <Field label="When">
            <Segmented
              value={draft.mode}
              onChange={(v) => set('mode', v)}
              options={[
                { value: 'none', label: 'Decide later' },
                { value: 'queue', label: 'Next free slot' },
                { value: 'time', label: <><CalendarDays size={12} /> Pick a time</> },
              ]}
            />
          </Field>
          {draft.mode === 'time' && (
            <TextInput
              type="datetime-local"
              value={draft.scheduledAt}
              onChange={(v) => set('scheduledAt', v)}
            />
          )}
          {draft.mode === 'queue' && chosen.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {chosen.map((c) => (
                <span key={c.id} style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <Clock size={11} style={{ verticalAlign: 'text-bottom' }} />{' '}
                  {byKey.get(c.network_key)?.label}:{' '}
                  {nextSlots[c.id]
                    ? whenLabel(nextSlots[c.id], c.timezone)
                    : 'no posting times set yet, so the queue has nowhere to put it'}
                </span>
              ))}
            </div>
          )}

          {/* ---- filing ---- */}
          <Split>
            <Field label="Campaign">
              <Select value={draft.campaignId} onChange={(v) => set('campaignId', v)}>
                <option value="">Not part of one</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Tags">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 32, alignItems: 'center' }}>
                {tags.length === 0
                  ? <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>None made yet</span>
                  : tags.map((t) => {
                      const on = draft.tagIds.includes(t.id);
                      return (
                        <Chip
                          key={t.id}
                          active={on}
                          onClick={() => setDraft((d) => ({
                            ...d,
                            tagIds: on ? d.tagIds.filter((x) => x !== t.id) : [...d.tagIds, t.id],
                          }))}
                        >
                          {on && <Check size={10} />}{t.name}
                        </Chip>
                      );
                    })}
              </div>
            </Field>
          </Split>

          <Field label="Internal note" hint="Never published">
            <TextInput
              value={draft.internalNote}
              onChange={(v) => set('internalNote', v)}
              placeholder="Context for whoever reviews this"
            />
          </Field>

          {error && <Alert tone="danger">{error}</Alert>}
        </div>

        {/* ---- the right half: what it will look like ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Label>Live preview</Label>
          <PreviewColumn
            channels={chosen}
            networks={networks}
            post={previewPost}
            variantText={variantText}
            empty="Pick a channel to see how it will look."
          />

          {problems.length > 0 && (
            <Panel title="Will be refused" icon={<AlertTriangle size={12} />}>
              {problems.map((p, i) => (
                <span key={i} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>@{p.channel.handle}</strong>: {p.why}
                </span>
              ))}
            </Panel>
          )}

          {post?.lint_findings && post.lint_findings.length > 0 && (
            <Panel title="Wording">
              {post.lint_findings.map((f, i) => (
                <span key={i} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.message}</span>
              ))}
            </Panel>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * A count per network, because one count is a lie the moment two
 * networks are selected.
 *
 * With nothing selected it shows the plain length, which is what the
 * old composer showed and is still the right answer when there is no
 * network to count against.
 */
function CharMeters({
  chosen, byKey, textFor, fallback,
}: {
  chosen: Channel[];
  byKey: Map<string, Network>;
  textFor: (channelId: string) => string;
  fallback: number;
}) {
  if (!chosen.length) {
    return (
      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
        {fallback} characters
      </span>
    );
  }

  /* One row per network, not per channel. Two LinkedIn pages carrying
     the same words are one limit. */
  const seen = new Set<string>();
  const rows: { network: Network; used: number }[] = [];
  for (const c of chosen) {
    const n = byKey.get(c.network_key);
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    rows.push({ network: n, used: countFor(textFor(c.id), n.key) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(({ network, used }) => {
        const over = used > network.char_limit;
        return (
          <div key={network.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 76, flex: 'none', fontSize: 11.5, color: 'var(--text-subtle)' }}>
              {network.label}
            </span>
            <span style={{ flex: 1 }}>
              <Bar
                value={Math.min(used, network.char_limit)}
                max={network.char_limit}
                tone={over ? 'danger' : 'neutral'}
              />
            </span>
            <span style={{
              width: 92, flex: 'none', textAlign: 'right',
              fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
              color: over ? 'var(--danger)' : 'var(--text-subtle)',
              fontWeight: over ? 600 : 400,
            }}>
              {used} / {network.char_limit}
            </span>
          </div>
        );
      })}
    </div>
  );
}
