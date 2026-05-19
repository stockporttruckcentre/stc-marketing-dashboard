'use client';

import { useMemo, useState } from 'react';
import { Plus, Check, X, FileText, Clock, CheckCircle, Calendar, Trash2 } from 'lucide-react';
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

const STATUS_META: Record<PostStatus, { color: string; Icon: any; label: string }> = {
  draft:          { color: 'bg-gray-100 text-gray-800',     Icon: FileText,    label: 'Draft' },
  pending_review: { color: 'bg-yellow-100 text-yellow-800', Icon: Clock,       label: 'Pending review' },
  approved:       { color: 'bg-green-100 text-green-800',   Icon: CheckCircle, label: 'Approved' },
  scheduled:      { color: 'bg-blue-100 text-blue-800',     Icon: Calendar,    label: 'Scheduled' },
  posted:         { color: 'bg-purple-100 text-purple-800', Icon: Check,       label: 'Posted' },
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
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="px-3 py-2 border rounded-lg"
        >
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="ml-auto">
          {canCreate && (
            <button
              onClick={() => setShowForm(s => !s)}
              className="px-4 py-2 bg-stc-red text-white rounded-lg hover:bg-stc-red-dark flex items-center gap-2"
            >
              <Plus size={14} /> New post
            </button>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-800 rounded-lg px-4 py-2 text-sm">{error}</div>}

      {showForm && (
        <form
          className="bg-white rounded-lg shadow p-4 space-y-3"
          action={async (fd) => handleCreate(fd)}
        >
          <textarea name="content" required placeholder="Post content..." className="w-full px-3 py-2 border rounded-lg min-h-[100px]" />
          <input name="caption" placeholder="Caption (optional)" className="w-full px-3 py-2 border rounded-lg" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="date" name="scheduled_date" required className="px-3 py-2 border rounded-lg" defaultValue={new Date().toISOString().slice(0,10)} />
            <input name="hashtags" placeholder="Hashtags (#STC #MOT)" className="md:col-span-3 px-3 py-2 border rounded-lg" />
          </div>
          <div className="flex flex-wrap gap-3">
            {PLATFORMS.map(p => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name={`plat_${p}`} defaultChecked={p === 'Facebook' || p === 'LinkedIn'} /> {p}
              </label>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-stc-navy text-white rounded-lg">
              {isAdmin ? 'Create & approve' : 'Submit for review'}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-3">
        {filtered.map(p => {
          const meta = STATUS_META[p.status];
          const Icon = meta.Icon;
          return (
            <div key={p.id} className="bg-white rounded-lg shadow p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${meta.color}`}>
                      <Icon size={12} /> {meta.label}
                    </span>
                    {p.platform.map(pl => (
                      <span key={pl} className="text-xs px-2 py-0.5 bg-gray-100 rounded">{pl}</span>
                    ))}
                    <span className="text-xs text-gray-500">Scheduled: {p.scheduled_date}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{p.content}</p>
                  {p.caption && <p className="text-sm text-gray-600">{p.caption}</p>}
                  {p.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.hashtags.map(t => <span key={t} className="text-xs text-stc-red">#{t}</span>)}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {p.status === 'pending_review' && isAdmin && (
                    <div className="flex gap-2">
                      <button onClick={() => setStatus(p.id, 'approved')}
                        className="px-3 py-1.5 bg-green-600 text-white rounded flex items-center gap-1 hover:bg-green-700">
                        <Check size={14} /> Approve
                      </button>
                      <button onClick={() => setStatus(p.id, 'draft')}
                        className="px-3 py-1.5 bg-red-600 text-white rounded flex items-center gap-1 hover:bg-red-700">
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                  {p.status === 'approved' && (
                    <button onClick={() => setStatus(p.id, 'scheduled')}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded flex items-center gap-1">
                      <Calendar size={14} /> Mark scheduled
                    </button>
                  )}
                  {(p.status === 'scheduled' || p.status === 'approved') && (
                    <button onClick={() => setStatus(p.id, 'posted')}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded flex items-center gap-1">
                      <Check size={14} /> Mark posted
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => deletePost(p.id)} title="Delete"
                      className="p-1.5 text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-500 border-t pt-2">
                Created by {p.created_by} on {new Date(p.created_at).toLocaleDateString()}
                {p.reviewed_by && ` • Reviewed by ${p.reviewed_by}`}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No posts yet.
          </div>
        )}
      </div>
    </div>
  );
}
