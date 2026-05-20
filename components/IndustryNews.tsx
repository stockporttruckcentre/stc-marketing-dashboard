'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Loader, Trash2, TrendingUp, Search, Calendar, User, Upload, ImagePlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { NewsItem, NewsSource, UserRole } from '@/lib/types';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  const today = new Date(); today.setHours(0,0,0,0);
  const that  = new Date(d);  that.setHours(0,0,0,0);
  const diff  = Math.round((+today - +that) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)   return `${diff}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function IndustryNews({
  initialItems, initialSources, role,
}: { initialItems: NewsItem[]; initialSources: NewsSource[]; role: UserRole }) {
  const supabase = createClient();
  const [items, setItems] = useState<NewsItem[]>(initialItems);
  const [sources, setSources] = useState<NewsSource[]>(initialSources);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingSrc, setUploadingSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);

  const canEdit = role === 'admin' || role === 'marketer';

  // Source name → backdrop URL lookup
  const backdropFor = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of sources) m.set(s.name, s.backdrop_url);
    return m;
  }, [sources]);

  const sourceList = useMemo(() => sources.map(s => s.name), [sources]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => {
      if (activeSource && i.source !== activeSource) return false;
      if (!q) return true;
      return (i.title?.toLowerCase().includes(q))
          || (i.summary?.toLowerCase().includes(q))
          || (i.source?.toLowerCase().includes(q))
          || (i.author?.toLowerCase().includes(q));
    });
  }, [items, query, activeSource]);

  async function refresh() {
    setRefreshing(true); setMessage(null);
    try {
      const res = await fetch('/api/news/fetch', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Refresh failed');
      const { data } = await supabase
        .from('news_items').select('*').order('published_date', { ascending: false }).limit(120);
      setItems((data ?? []) as NewsItem[]);
      const parts: string[] = [`${json.added} new`];
      parts.push(`${json.sources} feed${json.sources === 1 ? '' : 's'}`);
      setMessage(parts.join(' · '));
    } catch (e: any) { setMessage(e.message); }
    finally { setRefreshing(false); }
  }

  async function uploadBackdrop(sourceName: string, file: File) {
    setUploadingSrc(sourceName); setMessage(null);
    try {
      const slug = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `news-backdrops/${slug}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('brand-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('brand-assets').getPublicUrl(path);
      const { data, error } = await supabase
        .from('news_sources')
        .update({ backdrop_url: pub.publicUrl, updated_at: new Date().toISOString() })
        .eq('name', sourceName)
        .select('*').single();
      if (error) throw error;
      setSources(s => s.map(x => x.name === sourceName ? (data as NewsSource) : x));
      setMessage(`Backdrop set for ${sourceName}`);
    } catch (e: any) { setMessage(e.message); }
    finally { setUploadingSrc(null); }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this story?')) return;
    const { error } = await supabase.from('news_items').delete().eq('id', id);
    if (error) { setMessage(error.message); return; }
    setItems(it => it.filter(x => x.id !== id));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Workspace · Industry news</div>
          <h1 className="page-head__title">
            <TrendingUp size={26} style={{ color: 'var(--stc-red)' }} />
            <span>News<span style={{ color: 'var(--stc-red)' }}>.</span></span>
          </h1>
          <div className="page-head__sub">
            {items.length} stor{items.length === 1 ? 'y' : 'ies'} indexed across {sourceList.length} publication{sourceList.length === 1 ? '' : 's'}.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canEdit && (
            <button onClick={() => setShowManage(s => !s)} className="btn">
              <ImagePlus size={14} /> Backdrops
            </button>
          )}
          {canEdit && (
            <button onClick={refresh} disabled={refreshing} className="btn btn--primary">
              {refreshing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Refresh feeds
            </button>
          )}
        </div>
      </div>

      {showManage && (
        <div className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Publication backdrops</h3>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>One 16:9 image per publication. JPG/PNG/WebP, ~1600×900.</span>
          </div>
          <div className="backdrop-manager">
            {sources.map(src => (
              <div key={src.id} className="backdrop-tile">
                <div className="backdrop-tile__preview">
                  {src.backdrop_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={src.backdrop_url} alt={src.name} />
                  ) : (
                    <div className="backdrop-tile__empty">No backdrop</div>
                  )}
                </div>
                <div className="backdrop-tile__name">{src.name}</div>
                <label className="btn btn--sm btn--ghost" style={{ cursor: 'pointer' }}>
                  {uploadingSrc === src.name ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                  {src.backdrop_url ? 'Replace' : 'Upload'}
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadBackdrop(src.name, f);
                    e.target.value = '';
                  }} />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="news-toolbar">
        <div className="news-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines, summaries, publications…"
          />
        </div>
        <div className="news-chips">
          <button
            className={`news-chip ${activeSource === null ? 'is-active' : ''}`}
            onClick={() => setActiveSource(null)}>
            All
          </button>
          {sourceList.map(src => (
            <button
              key={src}
              className={`news-chip ${activeSource === src ? 'is-active' : ''}`}
              onClick={() => setActiveSource(activeSource === src ? null : src)}>
              {src}
            </button>
          ))}
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
          {items.length === 0
            ? <>No stories yet. Click <strong style={{ color: 'var(--fg-1)' }}>Refresh feeds</strong> to pull the latest.</>
            : <>No stories match your filter.</>}
        </div>
      ) : (
        <div className="news-grid">
          {filtered.map(item => {
            const backdrop = backdropFor.get(item.source) || null;
            return (
              <article key={item.id} className="news-card">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-card__link">
                  <div className="news-card__media">
                    {backdrop ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={backdrop} alt={item.source} loading="lazy" />
                    ) : (
                      <div className="news-card__placeholder">
                        <span>{item.source}</span>
                      </div>
                    )}
                    <div className="news-card__source-badge">{item.source}</div>
                  </div>
                  <div className="news-card__body">
                    <h3 className="news-card__title">{item.title}</h3>
                    {item.summary && <p className="news-card__summary">{item.summary}</p>}
                    <div className="news-card__meta">
                      <span className="news-card__meta-item">
                        <Calendar size={12} /> {formatDate(item.published_date)}
                      </span>
                      {item.author && (
                        <span className="news-card__meta-item">
                          <User size={12} /> {item.author}
                        </span>
                      )}
                      <span className="news-card__meta-item news-card__meta-item--cta">
                        Read <ExternalLink size={11} />
                      </span>
                    </div>
                  </div>
                </a>
                {role === 'admin' && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteItem(item.id); }}
                    className="news-card__delete"
                    title="Delete">
                    <Trash2 size={12} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
