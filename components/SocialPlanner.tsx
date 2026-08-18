'use client';

import { useMemo, useState, useEffect } from 'react';
import { Plus, Check, X, Calendar, Trash2, Upload, Eye, ThumbsUp, MessageCircle, Share2, Loader } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { SocialPost, PostStatus, Profile } from '@/lib/types';

/* One list, shared with the sentence reader. Two copies would disagree
   the first time somebody added a platform. */
import { PLATFORMS, DEFAULT_PLATFORMS, createPost, type Platform } from '@/lib/social/posts';
import { bucketStore, storeImage } from '@/lib/social/media';

const STATUSES: { value: PostStatus | 'all'; label: string }[] = [
  { value: 'all',            label: 'All' },
  { value: 'draft',          label: 'Draft' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved',       label: 'Approved' },
  { value: 'scheduled',      label: 'Scheduled' },
  { value: 'posted',         label: 'Posted' },
];
const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft', pending_review: 'Pending review', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted',
};

export function SocialPlanner({ initialPosts, profile }: { initialPosts: SocialPost[]; profile: Profile }) {
  const supabase = useMemo(() => createClient(), []);
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);
  const [filter, setFilter] = useState<PostStatus | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [previewPost, setPreviewPost] = useState<SocialPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile.role === 'admin';
  const canCreate = isAdmin || profile.role === 'marketer';
  const filtered = useMemo(
    () => posts.filter((p) => filter === 'all' || p.status === filter),
    [posts, filter]
  );

  async function setStatus(id: string, status: PostStatus) {
    const patch: Partial<SocialPost> = { status };
    if (status === 'approved') patch.reviewed_by = profile.full_name;
    const { error } = await supabase.from('social_posts').update(patch).eq('id', id);
    if (error) { setError(error.message); return; }
    setPosts((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } as SocialPost : p));
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post?')) return;
    const { error } = await supabase.from('social_posts').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    setPosts((ps) => ps.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Marketing · Social planner</div>
          <h1 className="page-head__title"><Calendar size={26} style={{ color: 'var(--stc-red)' }} /><span>{posts.length} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 22 }}>posts</span></span></h1>
          <div className="page-head__sub">Compose with live previews · {posts.filter((p) => p.status === 'pending_review').length} awaiting review.</div>
        </div>
      </div>

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="input" style={{ width: 180, height: 32 }}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="toolbar__spacer" />
        {canCreate && <button onClick={() => setShowForm((s) => !s)} className="btn btn--primary"><Plus size={14} /> New post</button>}
      </div>

      {error && <div className="alert alert--danger" style={{ marginBottom: 12 }}>{error}</div>}

      {showForm && <ComposeForm profile={profile} onClose={() => setShowForm(false)} onCreated={(p) => { setPosts((ps) => [p, ...ps]); setShowForm(false); }} />}

      <div className="col" style={{ gap: 12 }}>
        {filtered.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => setPreviewPost(p)}>
            <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className={`pill pill--${p.status}`}><span className="pill__dot" />{STATUS_LABEL[p.status]}</span>
              {p.platform.map((pl) => <span key={pl} className="tag">{pl}</span>)}
              <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>SCHEDULED · {p.scheduled_date}</span>
              <div className="toolbar__spacer" />
              {p.status === 'pending_review' && isAdmin && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setStatus(p.id, 'approved'); }} className="btn btn--sm btn--primary"><Check size={12} /> Approve</button>
                  <button onClick={(e) => { e.stopPropagation(); setStatus(p.id, 'draft'); }} className="btn btn--sm"><X size={12} /> Reject</button>
                </>
              )}
              {p.status === 'approved' && <button onClick={(e) => { e.stopPropagation(); setStatus(p.id, 'scheduled'); }} className="btn btn--sm"><Calendar size={12} /> Mark scheduled</button>}
              {(p.status === 'scheduled' || p.status === 'approved') && <button onClick={(e) => { e.stopPropagation(); setStatus(p.id, 'posted'); }} className="btn btn--sm"><Check size={12} /> Mark posted</button>}
              <button onClick={(e) => { e.stopPropagation(); setPreviewPost(p); }} className="btn btn--sm btn--ghost"><Eye size={12} /> Preview</button>
              {isAdmin && <button onClick={(e) => { e.stopPropagation(); deletePost(p.id); }} className="btn btn--icon btn--sm"><Trash2 size={12} /></button>}
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              {p.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.image_url} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--r-2)', border: '1px solid var(--border)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: 'var(--fg-1)', whiteSpace: 'pre-wrap', margin: 0, fontSize: 14 }}>{p.content}</p>
                {p.caption && <p style={{ color: 'var(--fg-3)', fontSize: 12.5, marginTop: 6, marginBottom: 0 }}>{p.caption}</p>}
                {p.hashtags.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', marginTop: 6, gap: 6 }}>
                    {p.hashtags.map((t) => <span key={t} style={{ color: 'var(--stc-red)', fontSize: 12 }}>#{t}</span>)}
                  </div>
                )}
              </div>
            </div>
            <div className="hr" />
            <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }} className="mono">
              CREATED BY {p.created_by.toUpperCase()} · {new Date(p.created_at).toLocaleDateString('en-GB')}
              {p.reviewed_by && ` · REVIEWED BY ${p.reviewed_by.toUpperCase()}`}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>No posts at this status.</div>
        )}
      </div>

      {previewPost && <PreviewModal post={previewPost} profile={profile} onClose={() => setPreviewPost(null)} />}
    </div>
  );
}

// ========== COMPOSE ==========
function ComposeForm({ profile, onClose, onCreated }: { profile: Profile; onClose: () => void; onCreated: (p: SocialPost) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [platforms, setPlatforms] = useState<Platform[]>([...DEFAULT_PLATFORMS]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile.role === 'admin';

  function togglePlatform(p: Platform) {
    setPlatforms((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]);
  }

  /* The same operation the command bar performs. The bucket, the key
     rule and what counts as an image are `lib/social/media.ts`, so
     neither caller has its own idea of any of them. */
  async function uploadImage(file: File) {
    setUploading(true); setError(null);
    const stored = await storeImage(bucketStore(supabase), {
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    setUploading(false);
    if (!stored.ok) { setError(stored.why); return; }
    setImageUrl(stored.url);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSubmitting(true);
    const tags = hashtags.split(/[,\s#]+/).map((s) => s.trim()).filter(Boolean);
    if (!content.trim()) { setError('Content is required'); setSubmitting(false); return; }

    /* The same operation the command bar performs. The author and the
       status come from the profile inside it, rather than from here,
       because a browser that chose its own status could put a post
       straight to approved. */
    const made = await createPost(supabase, {
      content: content.trim(),
      platforms,
      scheduledDate,
      caption: caption || null,
      hashtags: tags,
      imageUrl,
    });
    if (!made.ok) { setSubmitting(false); setError(made.why); return; }

    const { data, error } = await supabase
      .from('social_posts').select('*').eq('id', made.id).single();
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    onCreated(data as SocialPost);
  }

  const draft: SocialPost = {
    id: 'preview', content, caption: caption || null, platform: platforms,
    scheduled_date: scheduledDate, status: 'draft', created_by: profile.full_name,
    reviewed_by: null, image_url: imageUrl, hashtags: hashtags.split(/[,\s#]+/).map((s) => s.trim()).filter(Boolean),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  return (
    <div className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
      <div className="card__head">
        <h3 style={{ margin: 0 }}>New post</h3>
        <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
      </div>
      <div className="split-aside" style={{ gap: 0 }}>
        <form onSubmit={submit} style={{ padding: 18, borderRight: '1px solid var(--border)' }}>
          <div className="field">
            <div className="field__label">Content</div>
            <textarea required placeholder="What's the post?" value={content} onChange={(e) => setContent(e.target.value)}
              className="input" style={{ minHeight: 130, padding: 10 }} />
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>{content.length} chars</div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="field__label">Caption (optional)</div>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} className="input" />
          </div>
          <div className="split-2" style={{ marginTop: 10 }}>
            <div className="field">
              <div className="field__label">Schedule date</div>
              <input type="date" required value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="input" />
            </div>
            <div className="field">
              <div className="field__label">Hashtags</div>
              <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#STC #MOT #HGV" className="input" />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="field__label">Image</div>
            {imageUrl ? (
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--r-2)', border: '1px solid var(--border)' }} />
                <button type="button" onClick={() => setImageUrl(null)} className="btn btn--sm"><X size={12} /> Remove</button>
              </div>
            ) : (
              <label className="btn">
                {uploading ? <Loader size={14} className="spin" /> : <Upload size={14} />} Upload image
                <input type="file" accept="image/*" hidden onChange={(e) => {
                  const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '';
                }} />
              </label>
            )}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="field__label">Platforms</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {PLATFORMS.map((p) => (
                <button type="button" key={p} onClick={() => togglePlatform(p)}
                  className={`btn btn--sm ${platforms.includes(p) ? 'btn--primary' : ''}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="alert alert--danger" style={{ marginTop: 10 }}>{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <button type="button" onClick={onClose} className="btn btn--ghost">Cancel</button>
            <button type="submit" disabled={submitting} className="btn btn--primary">
              {submitting && <Loader size={14} className="spin" />}
              {isAdmin ? 'Create & approve' : 'Submit for review'}
            </button>
          </div>
        </form>
        <div style={{ padding: 18, background: 'var(--bg)', minWidth: 320 }}>
          <div className="page-head__eyebrow" style={{ marginBottom: 8 }}>Live previews</div>
          {platforms.length === 0
            ? <div className="row-item__sub">Pick a platform to see how it&apos;ll look</div>
            : (
              <div className="col" style={{ gap: 14 }}>
                {platforms.map((p) => <PlatformPreview key={p} platform={p} post={draft} profile={profile} />)}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ========== PREVIEW MODAL ==========
function PreviewModal({ post, profile, onClose }: { post: SocialPost; profile: Profile; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>Post preview</h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16 }}>
          {post.platform.length === 0
            ? <div className="row-item__sub">No platforms selected</div>
            : (
              <div className="col" style={{ gap: 14 }}>
                {post.platform.map((p) => <PlatformPreview key={p} platform={p as Platform} post={post} profile={profile} />)}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ========== PER-PLATFORM PREVIEWS ==========
function PlatformPreview({ platform, post, profile }: { platform: Platform; post: SocialPost; profile: Profile }) {
  const initials = profile.full_name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const body = (post.content || 'Write something to see it here...') + (post.hashtags.length ? '\n\n' + post.hashtags.map((h) => `#${h}`).join(' ') : '');

  if (platform === 'Facebook') {
    return (
      <div className="preview preview--fb">
        <div className="preview__head">
          <div className="preview__avatar" style={{ background: '#1877f2' }}>STC</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#050505' }}>Stockport Truck Centre</div>
            <div style={{ fontSize: 11, color: '#65676b' }}>{post.scheduled_date} · 🌍</div>
          </div>
        </div>
        <div className="preview__body" style={{ color: '#050505' }}>{body}</div>
        {post.image_url && /* eslint-disable-next-line @next/next/no-img-element */
          <img src={post.image_url} alt="" className="preview__img" />}
        <div className="preview__foot" style={{ borderTop: '1px solid #ced0d4', color: '#65676b', justifyContent: 'space-around' }}>
          <span><ThumbsUp size={14} style={{ verticalAlign: 'text-bottom' }} /> Like</span>
          <span><MessageCircle size={14} style={{ verticalAlign: 'text-bottom' }} /> Comment</span>
          <span><Share2 size={14} style={{ verticalAlign: 'text-bottom' }} /> Share</span>
        </div>
      </div>
    );
  }

  if (platform === 'LinkedIn') {
    return (
      <div className="preview preview--li">
        <div className="preview__head">
          <div className="preview__avatar" style={{ background: '#0a66c2' }}>STC</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#000' }}>Stockport Truck Centre</div>
            <div style={{ fontSize: 11, color: '#666' }}>Commercial Vehicle Maintenance · {post.scheduled_date}</div>
          </div>
        </div>
        <div className="preview__body" style={{ color: '#000' }}>{body}</div>
        {post.image_url && /* eslint-disable-next-line @next/next/no-img-element */
          <img src={post.image_url} alt="" className="preview__img" />}
        <div className="preview__foot" style={{ borderTop: '1px solid #e0e0e0', color: '#666', justifyContent: 'space-around' }}>
          <span>👍 Like</span><span>💬 Comment</span><span>🔄 Repost</span>
        </div>
      </div>
    );
  }

  if (platform === 'Instagram') {
    return (
      <div className="preview preview--ig">
        <div className="preview__head" style={{ borderBottom: '1px solid #efefef' }}>
          <div className="preview__avatar" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>STC</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#262626' }}>stockporttruckcentre</div>
          </div>
        </div>
        {post.image_url ? /* eslint-disable-next-line @next/next/no-img-element */
          <img src={post.image_url} alt="" className="preview__img" style={{ aspectRatio: '1/1', objectFit: 'cover' }} />
          : <div style={{ background: '#fafafa', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>Instagram needs an image</div>
        }
        <div className="preview__body" style={{ color: '#262626', fontSize: 12 }}>
          <strong>stockporttruckcentre</strong> {body}
        </div>
      </div>
    );
  }

  // X
  return (
    <div className="preview preview--x">
      <div className="preview__head">
        <div className="preview__avatar" style={{ background: '#000' }}>STC</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f1419' }}>Stockport Truck Centre <span style={{ color: '#536471', fontWeight: 400 }}>@stc_uk</span></div>
        </div>
      </div>
      <div className="preview__body" style={{ color: '#0f1419' }}>{body}</div>
      {post.image_url && /* eslint-disable-next-line @next/next/no-img-element */
        <img src={post.image_url} alt="" className="preview__img" />}
      <div className="preview__foot" style={{ color: '#536471', justifyContent: 'space-around', fontSize: 12 }}>
        <span>💬</span><span>🔄</span><span>♥</span><span>📊</span>
      </div>
    </div>
  );
}
