'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Activity } from 'lucide-react';

type Notice = {
  id: string;
  title: string;
  company: string | null;
  noticeType: string | null;
  publishedDate: string;
  url: string;
  summary: string;
  isCustomer: boolean;
};

export function BusinessActivityStrip() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/news/business-activity');
      const j = await r.json();
      if (j.error) setError(j.error);
      setNotices(j.notices ?? []);
      setMatched(j.matchedCount ?? 0);
      setTotal(j.totalCount ?? 0);
      setFetchedAt(j.fetchedAt ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(207,36,23,0.12)', color: '#cf2417',
          }}>
            <Activity size={15} />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)' }}>
              Breaking business activity
              {matched > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#fff',
                  background: '#cf2417', padding: '2px 7px', borderRadius: 8,
                }}>
                  {matched} customer{matched === 1 ? '' : 's'} affected
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              Live from The Gazette · UK insolvency & administration notices
              {fetchedAt && <> · updated {new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>}
            </div>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="btn btn--icon" title="Refresh">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: 8 }}>Feed unavailable: {error}</div>}
      {!loading && notices.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: 8 }}>No recent notices.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {notices.map(n => {
          const dt = new Date(n.publishedDate);
          return (
            <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'block', padding: '10px 12px', borderRadius: 8,
                background: n.isCustomer ? 'rgba(207,36,23,0.06)' : 'var(--bg-2)',
                border: `1px solid ${n.isCustomer ? 'rgba(207,36,23,0.4)' : 'var(--border)'}`,
                textDecoration: 'none', color: 'var(--fg-1)',
                transition: 'background .14s, border-color .14s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = n.isCustomer ? 'rgba(207,36,23,0.1)' : 'var(--bg-3)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = n.isCustomer ? 'rgba(207,36,23,0.06)' : 'var(--bg-2)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {n.isCustomer && <AlertTriangle size={14} style={{ color: '#cf2417', flexShrink: 0, marginTop: 2 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: n.isCustomer ? 600 : 500, color: 'var(--fg-1)' }}>{n.title}</span>
                    {n.noticeType && <span style={{ fontSize: 10, color: 'var(--fg-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>{n.noticeType}</span>}
                  </div>
                  {n.summary && (
                    <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 4, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {n.summary}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    <ExternalLink size={10} />
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
