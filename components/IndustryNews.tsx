'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Loader, Trash2, TrendingUp, Search, Calendar, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Button, Chip, Tabs, SearchInput, Alert, PageHead, EmptyState, Label,
} from '@/components/kit/primitives';
import { BusinessActivityStrip } from './BusinessActivityStrip';
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
  const [sources] = useState<NewsSource[]>(initialSources);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'industry' | 'company'>('industry');
  const [query, setQuery] = useState('');
  const [activeSource, setActiveSource] = useState<string | null>(null);

  const canRefresh = role === 'admin' || role === 'marketer';

  // Source -> static backdrop image shipped in /public/news-backdrops.
  // 7 sources, no fallback - blank gradient is intentional for any unmapped source.
  const SOURCE_THUMB: Record<string, string> = {
    'Commercial Motor': '/news-backdrops/commercialmotor.webp',
    'Fleet News':       '/news-backdrops/fleetnews.webp',
    'IRTE':             '/news-backdrops/irte.webp',
    'Motor Transport':  '/news-backdrops/motortransport.webp',
    'Trucking':         '/news-backdrops/trucking.webp',
    'Logistics UK':     '/news-backdrops/logisticsuk.webp',
    'RHA':              '/news-backdrops/rha.webp',
  };
  const backdropFor = { get: (src: string) => SOURCE_THUMB[src] || null };

  // Show all 8 publication chips, even if a source returned zero this week.
  // Count badge tells the team how many stories each source produced.
  const itemCountBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.source, (m.get(it.source) || 0) + 1);
    return m;
  }, [items]);
  const sourceList = useMemo(() => {
    // Prefer the news_sources table (canonical 8); fall back to items if empty
    const fromTable = sources.map(s => s.name);
    if (fromTable.length) return fromTable;
    return Array.from(new Set(items.map(i => i.source))).sort();
  }, [sources, items]);

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
      if (json.purged) parts.push(`${json.purged} stale removed`);
      parts.push(`${json.sources} feed${json.sources === 1 ? '' : 's'}`);
      setMessage(parts.join(' · '));
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
      {/* Controls and type come from the kit. The grid and the cards below
          are untouched: that layout is signed off. */}
      <div className="kit">
        <PageHead
          eyebrow="Workspace · Industry news"
          title={<><TrendingUp size={25} style={{ color: 'var(--accent)' }} />News</>}
          sub={`${items.length} stor${items.length === 1 ? 'y' : 'ies'} indexed across ${sourceList.length} publication${sourceList.length === 1 ? '' : 's'}`}
          action={canRefresh && (
            <Button variant="accent" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
              {refreshing ? 'Refreshing' : 'Refresh feeds'}
            </Button>
          )}
        />

        <div style={{ marginBottom: 16 }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'industry' as const, label: 'Industry news', count: items.length },
              { key: 'company' as const, label: 'Insolvency updates' },
            ]}
          />
        </div>
      </div>

      {tab === 'company' ? (
        <BusinessActivityStrip />
      ) : (
      <>
      <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search headlines, summaries, publications"
            icon={<Search size={14} />}
          />
          <Label>{filtered.length} shown</Label>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={activeSource === null} onClick={() => setActiveSource(null)}>All</Chip>
          {sourceList.map(src => {
            const n = itemCountBySource.get(src) || 0;
            return (
              <Chip
                key={src}
                active={activeSource === src}
                count={n}
                empty={n === 0}
                onClick={() => setActiveSource(activeSource === src ? null : src)}
                title={n === 0 ? `${src}, no stories in the last 14 days` : `${src}, ${n} stor${n === 1 ? 'y' : 'ies'}`}
              >{src}</Chip>
            );
          })}
        </div>
      </div>

      {message && <div className="kit" style={{ marginBottom: 14 }}><Alert tone="info">{message}</Alert></div>}

      {filtered.length === 0 ? (
        <div className="kit">
          <EmptyState
            what={items.length === 0 ? 'No stories have been pulled yet.' : 'Nothing matches that filter.'}
            why={items.length === 0
              ? 'The trade feeds are read on demand rather than on a schedule. Pulling them now fills this page.'
              : 'Try a different publication, or clear the search to see everything from the last fortnight.'}
            action={items.length === 0
              ? (canRefresh ? <Button variant="accent" onClick={refresh} disabled={refreshing}>Refresh feeds</Button> : undefined)
              : <Button variant="secondary" onClick={() => { setQuery(''); setActiveSource(null); }}>Clear filters</Button>}
          />
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
    </>
      )}
    </div>
  );
}
