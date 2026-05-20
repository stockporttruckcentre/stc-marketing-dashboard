'use client';

import { useState } from 'react';
import { RefreshCw, ExternalLink, Loader, Trash2, TrendingUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { NewsItem, UserRole } from '@/lib/types';

export function IndustryNews({
  initialItems, role,
}: { initialItems: NewsItem[]; role: UserRole }) {
  const supabase = createClient();
  const [items, setItems] = useState<NewsItem[]>(initialItems);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canRefresh = role === 'admin' || role === 'marketer';

  async function refresh() {
    setRefreshing(true); setMessage(null);
    try {
      const res = await fetch('/api/news/fetch', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Refresh failed');
      const { data } = await supabase
        .from('news_items').select('*').order('published_date', { ascending: false }).limit(50);
      setItems((data ?? []) as NewsItem[]);
      setMessage(`Fetched ${json.added} new items from ${json.sources} feed(s)`);
    } catch (e: any) { setMessage(e.message); }
    finally { setRefreshing(false); }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this news item?')) return;
    const { error } = await supabase.from('news_items').delete().eq('id', id);
    if (error) { setMessage(error.message); return; }
    setItems(it => it.filter(x => x.id !== id));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Workspace · Industry news</div>
          <h1 className="page-head__title"><TrendingUp size={26} style={{ color: 'var(--stc-red)' }} /><span>News<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">Commercial Motor · Fleet News · Transport Engineer. {items.length} stories indexed.</div>
        </div>
        {canRefresh && (
          <button onClick={refresh} disabled={refreshing} className="btn btn--primary">
            {refreshing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        )}
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="col" style={{ gap: 12 }}>
        {items.map(item => (
          <div key={item.id} className="card" style={{ padding: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
              <h3 style={{ margin: 0, flex: 1 }}>{item.title}</h3>
              <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{item.published_date}</span>
            </div>
            {item.summary && <p style={{ color: 'var(--fg-2)', fontSize: 13, margin: '0 0 10px' }}>{item.summary}</p>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="dispatch-label">{item.source}</span>
              <div className="row" style={{ gap: 6 }}>
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--ghost">
                  Read more <ExternalLink size={12} />
                </a>
                {role === 'admin' && (
                  <button onClick={() => deleteItem(item.id)} className="btn btn--icon btn--sm" title="Delete">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>
            No news yet. Click <strong style={{ color: 'var(--fg-1)' }}>Refresh</strong> to pull the latest.
          </div>
        )}
      </div>
    </div>
  );
}
