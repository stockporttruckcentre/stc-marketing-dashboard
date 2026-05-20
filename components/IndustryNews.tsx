'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Loader, Trash2, TrendingUp, Search, Calendar, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { NewsItem, UserRole } from '@/lib/types';

const SOURCE_DOMAINS: Record<string, string> = {
  'Commercial Motor':   'commercialmotor.com',
  'Fleet News':         'fleetnews.co.uk',
  'Transport Engineer': 'transportengineer.org.uk',
  'UK HGV / haulage':   'news.google.com',
};

function faviconFor(source: string, articleUrl?: string): string {
  // Try domain mapping first, otherwise derive from the article URL
  let host = SOURCE_DOMAINS[source];
  if (!host && articleUrl) {
    try { host = new URL(articleUrl).hostname.replace(/^www\./, ''); } catch {}
  }
  if (!host) host = 'news.google.com';
  return `https://www.google.com/s2/favicons?sz=64&domain=${host}`;
}

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
  initialItems, role,
}: { initialItems: NewsItem[]; role: UserRole }) {
  const supabase = createClient();
  const [items, setItems] = useState<NewsItem[]>(initialItems);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeSource, setActiveSource] = useState<string | null>(null);

  const canRefresh = role === 'admin' || role === 'marketer';

  const sources = useMemo(() => {
    const set = new Set(items.map(i => i.source));
    return Array.from(set).sort();
  }, [items]);

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
        .from('news_items').select('*').order('published_date', { ascending: false }).limit(80);
      setItems((data ?? []) as NewsItem[]);
      setMessage(`Fetched ${json.added} stories from ${json.sources} feed${json.sources === 1 ? '' : 's'}`);
    } catch (e: any) { setMessage(e.message); }
    finally { setRefreshing(false); }
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
            {items.length} stor{items.length === 1 ? 'y' : 'ies'} indexed across {sources.length} publication{sources.length === 1 ? '' : 's'}.
          </div>
        </div>
        {canRefresh && (
          <button onClick={refresh} disabled={refreshing} className="btn btn--primary">
            {refreshing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Refresh feeds
          </button>
        )}
      </div>

      {/* Toolbar: search + source chips */}
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
          {sources.map(src => (
            <button
              key={src}
              className={`news-chip ${activeSource === src ? 'is-active' : ''}`}
              onClick={() => setActiveSource(activeSource === src ? null : src)}>
              <img src={faviconFor(src)} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
              {src}
            </button>
          ))}
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
          {items.length === 0
            ? <>No stories yet. Click <strong style={{ color: 'var(--fg-1)' }}>Refresh feeds</strong> to pull the latest from Commercial Motor, Fleet News, Transport Engineer and more.</>
            : <>No stories match your filter.</>}
        </div>
      ) : (
        <div className="news-grid">
          {filtered.map(item => (
            <article key={item.id} className="news-card">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-card__link">
                <div className="news-card__media">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        // Hide broken images so the gradient placeholder shows
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="news-card__placeholder">
                      <img src={faviconFor(item.source, item.url)} alt="" width={32} height={32} style={{ opacity: 0.6 }} />
                    </div>
                  )}
                  <div className="news-card__source-badge">
                    <img src={faviconFor(item.source, item.url)} alt="" width={14} height={14} style={{ borderRadius: 2 }} />
                    {item.source}
                  </div>
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
          ))}
        </div>
      )}
    </div>
  );
}
