'use client';

import { useState } from 'react';
import { RefreshCw, ExternalLink, Loader, Trash2 } from 'lucide-react';
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
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/news/fetch', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Refresh failed');
      const { data } = await supabase
        .from('news_items').select('*').order('published_date', { ascending: false }).limit(50);
      setItems((data ?? []) as NewsItem[]);
      setMessage(`Fetched ${json.added} new items from ${json.sources} feed(s)`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this news item?')) return;
    const { error } = await supabase.from('news_items').delete().eq('id', id);
    if (error) { setMessage(error.message); return; }
    setItems(it => it.filter(x => x.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Industry news</h2>
          <p className="text-xs text-gray-600 mt-1">Pulled from Commercial Motor, Fleet News, Transport Engineer</p>
        </div>
        {canRefresh && (
          <button onClick={refresh} disabled={refreshing}
            className="px-4 py-2 bg-stc-navy text-white rounded-lg hover:bg-stc-navy-light disabled:opacity-50 flex items-center gap-2">
            {refreshing ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh news
          </button>
        )}
      </div>

      {message && <div className="bg-blue-50 text-blue-900 rounded-lg px-4 py-2 text-sm">{message}</div>}

      <div className="grid gap-3">
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-lg shadow p-5">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="font-semibold flex-1">{item.title}</h3>
              <span className="text-xs text-gray-500 whitespace-nowrap">{item.published_date}</span>
            </div>
            {item.summary && <p className="text-sm text-gray-700 mb-3 line-clamp-3">{item.summary}</p>}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{item.source}</span>
              <div className="flex items-center gap-2">
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-stc-red hover:underline flex items-center gap-1">
                  Read more <ExternalLink size={12} />
                </a>
                {(role === 'admin') && (
                  <button onClick={() => deleteItem(item.id)} className="text-gray-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No news yet. Click <strong>Refresh news</strong> to pull the latest.
          </div>
        )}
      </div>
    </div>
  );
}
