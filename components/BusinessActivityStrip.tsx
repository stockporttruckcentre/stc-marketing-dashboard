'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Activity, Building2 } from 'lucide-react';

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

function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BusinessActivityStrip() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);
  const [transportCount, setTransportCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/news/business-activity', { cache: 'no-store' });
      const j = await r.json();
      if (j.error) setError(j.error);
      setNotices(j.notices ?? []);
      setMatched(j.matchedCount ?? 0);
      setTotal(j.totalCount ?? 0);
      setTransportCount(j.transportCount ?? 0);
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
      borderRadius: 14,
      padding: 18,
      marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(207,36,23,0.12)', color: 'var(--stc-red)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Activity size={18} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
              Company Updates
              {matched > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  background: 'var(--stc-red)', padding: '2px 8px', borderRadius: 8,
                }}>
                  {matched} customer{matched === 1 ? '' : 's'} affected
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
              London Gazette · UK insolvency, administration Live from The Gazette · UK insolvency, administration & winding-up notices winding-up notices · {total} notice{total === 1 ? '' : 's'}
              {fetchedAt && <> · updated {new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>}
            </div>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="btn btn--ghost btn--sm" title="Refresh">
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: 10, background: 'var(--bg-2)', borderRadius: 8 }}>
          Feed unavailable: {error}. Vercel will retry on next refresh.
        </div>
      )}
      {!loading && !error && notices.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: 10 }}>No recent notices.</div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 10,
      }}>
        {notices.map(n => (
          <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              padding: '12px 14px', borderRadius: 10,
              background: n.isCustomer ? 'rgba(207,36,23,0.06)' : 'var(--bg-2)',
              border: `1px solid ${n.isCustomer ? 'rgba(207,36,23,0.45)' : 'var(--border)'}`,
              textDecoration: 'none',
              color: 'var(--fg-1)',
              transition: 'transform .12s, background .14s, border-color .14s',
              minHeight: 122,
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.background = n.isCustomer ? 'rgba(207,36,23,0.10)' : 'var(--bg-3)';
              el.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.background = n.isCustomer ? 'rgba(207,36,23,0.06)' : 'var(--bg-2)';
              el.style.transform = 'none';
            }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {n.isCustomer && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, color: 'var(--stc-red)',
                    background: 'rgba(207,36,23,0.18)', padding: '2px 6px', borderRadius: 4,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    <AlertTriangle size={10} /> Our customer
                  </span>
                )}
                {n.noticeType && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: 'var(--fg-2)', background: 'var(--bg-3)',
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    {n.noticeType}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 13.5, fontWeight: 600, color: 'var(--fg-1)',
                lineHeight: 1.35,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                marginBottom: 4,
              }}>
                <Building2 size={12} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--fg-3)' }} />
                {n.title}
              </div>
              {n.summary && (
                <div style={{
                  fontSize: 11.5, color: 'var(--fg-2)',
                  lineHeight: 1.45,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  marginTop: 4,
                }}>
                  {n.summary}
                </div>
              )}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 10, fontSize: 10.5, color: 'var(--fg-3)',
            }}>
              <span>{fmtDate(n.publishedDate)}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Read on Gazette <ExternalLink size={10} />
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
