'use client';

import { useMemo, useState } from 'react';
import { Plus, Check, X, Calendar, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { SocialPost, PostStatus, Profile } from '@/lib/types';

const PLATFORMS = ['Facebook', 'LinkedIn', 'Instagram', 'X'] as const;
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

export function SocialPlanner({
  initialPosts, profile,
}: { initialPosts: SocialPost[]; profile: Profile }) {
  const supabase = useMemo(() => createClient(), []);
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);
  const [filter, setFilter] = useState<PostStatus | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile.role === 'admin';
  const canCreate = isAdmin || profile.role === 'marketer';
  const filtered = useMemo(
    () => posts.filter(p => filter === 'all' || p.status === filter),
    [posts, filter]
  );

  async function setStatus(id: string, status: PostStatus) {
    const patch: Partial<SocialPost> = { status };
    if (status === 'approved') patch.reviewed_by = profile.full_name;
    const { error } = await supabase.from('social_posts').update(patch).eq('id', id);
    if (error) { setError(error.message); return; }
    setPosts(ps => ps.map(p => p.id === id ? { ...p, ...patch } as SocialPost : p));
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post?')) return;
    const { error } = await supabase.from('social_posts').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    setPosts(ps => ps.filter(p => p.id !== id));
  }

  async function handleCreate(form: FormData) {
    setError(null);
    const platforms = PLATFORMS.filter(p => form.get(`plat_${p}`));
    const hashtagsRaw = String(form.get('hashtags') || '');
    const payload = {
      content: String(form.get('content') || '').trim(),
      caption: String(form.get('caption') || '') || null,
      platform: platforms,
      scheduled_date: String(form.get('scheduled_date') || new Date().toISOString().slice(0, 10)),
      hashtags: hashtagsRaw.split(/[,\s#]+/).map(s => s.trim()).filter(Boolean),
      created_by: profile.full_name,
      status: (isAdmin ? 'approved' : 'pending_review') as PostStatus,
    };
    if (!payload.content) { setError('Content is required'); return; }
    const { data, error } = await supabase.from('social_posts').insert(payload).select('*').single();
    if (error) { setError(error.message); return; }
    setPosts(ps => [data as SocialPost, ...ps]);
    setShowForm(false);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Marketing · Social planner</div>
          <h1 className="page-head__title">{posts.length} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 22 }}>posts</span></h1>
          <div className="page-head__sub">Draft → review → approve → schedule → post. {posts.filter(p => p.status === 'pending_review').length} awaiting review.</div>
        </div>
      </div>

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="input" style={{ width: 180, height: 32 }}>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="toolbar__spacer" />
        {canCreate && (
          <button onClick={() => setShowForm(s => !s)} className="btn btn--primary"><Plus size={14} /> New post</button>
        )}
      </div>

      {error && <div className="alert alert--danger" style={{ marginBottom: 12 }}>{error}</div>}

      {showForm && (
        <form action={async (fd) => handleCreate(fd)} className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="field">
            <div className="field__label">Content</div>
            <textarea name="content" required placeholder="Write the post..." className="input" style={{ minHeight: 100, padding: 10 }} />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="field__label">Caption</div>
            <input name="caption" placeholder="Optional caption" className="input" />
          </div>
          <div className="split-2" style={{ marginTop: 10 }}>
            <div className="field"><div className="field__label">Scheduled date</div>
              <input type="date" name="scheduled_date" required className="input" defaultValue={new Date().toISOString().slice(0,10)} /></div>
            <div className="field"><div className="field__label">Hashtags</div>
              <input name="hashtags" placeholder="#STC #MOT #HGV" className="input" /></div>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 12 }}>
            {PLATFORMS.map(p => (
              <label key={p} className="row" style={{ fontSize: 12.5, color: 'var(--fg-2)', cursor: 'pointer' }}>
                <input type="checkbox" name={`plat_${p}`} defaultChecked={p === 'Facebook' || p === 'LinkedIn'} /> {p}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn--ghost">Cancel</button>
            <button type="submit" className="btn btn--primary">{isAdmin ? 'Create & approve' : 'Submit for review'}</button>
          </div>
        </form>
      )}

      <div className="col" style={{ gap: 12 }}>
        {filtered.map(p => (
          <div key={p.id} className="card" style={{ padding: 18 }}>
            <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className={`pill pill--${p.status}`}>
                <span className="pill__dot" />{STATUS_LABEL[p.status]}
              </span>
              {p.platform.map(pl => <span key={pl} className="tag">{pl}</span>)}
              <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>SCHEDULED · {p.scheduled_date}</span>
              <div className="toolbar__spacer" />
              {p.status === 'pending_review' && isAdmin && (
                <>
                  <button onClick={() => setStatus(p.id, 'approved')} className="btn btn--sm btn--primary"><Check size={12} /> Approve</button>
                  <button onClick={() => setStatus(p.id, 'draft')} className="btn btn--sm"><X size={12} /> Reject</button>
                </>
              )}
              {p.status === 'approved' && <button onClick={() => setStatus(p.id, 'scheduled')} className="btn btn--sm"><Calendar size={12} /> Mark scheduled</button>}
              {(p.status === 'scheduled' || p.status === 'approved') && <button onClick={() => setStatus(p.id, 'posted')} className="btn btn--sm"><Check size={12} /> Mark posted</button>}
              {isAdmin && <button onClick={() => deletePost(p.id)} className="btn btn--icon btn--sm" title="Delete"><Trash2 size={12} /></button>}
            </div>
            <p style={{ color: 'var(--fg-1)', whiteSpace: 'pre-wrap', margin: 0 }}>{p.content}</p>
            {p.caption && <p style={{ color: 'var(--fg-3)', fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>{p.caption}</p>}
            {p.hashtags.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                {p.hashtags.map(t => <span key={t} style={{ color: 'var(--stc-red)', fontSize: 12 }}>#{t}</span>)}
              </div>
            )}
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
    </div>
  );
}
