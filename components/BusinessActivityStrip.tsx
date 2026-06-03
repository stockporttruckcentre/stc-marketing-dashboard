'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, RefreshCw, Activity, ArrowUpRight,
  Briefcase, Gavel, ScrollText, Coins, Power, UserCog, Shield, AlertOctagon, Trash2, Handshake,
} from 'lucide-react';

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
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Per-notice-type visual identity (icon + colour token).
// Colours are HSL hue strings so we can derive multiple shades (accent / tint / border).
type TypeMeta = { Icon: any; hue: number; label: string };
const DEFAULT_META: TypeMeta = { Icon: AlertOctagon, hue: 220, label: 'Notice' };
const TYPE_META: { match: RegExp; meta: TypeMeta }[] = [
  { match: /administration/i,            meta: { Icon: Briefcase,   hue: 222, label: 'Administration' } },
  { match: /resolutions for winding up/i,meta: { Icon: Power,       hue: 6,   label: 'Winding-up'      } },
  { match: /winding[- ]?up orders?/i,    meta: { Icon: Power,       hue: 6,   label: 'Winding-up'      } },
  { match: /petitions? to wind up/i,     meta: { Icon: Gavel,       hue: 32,  label: 'Petition'        } },
  { match: /appointment of liquidators/i,meta: { Icon: UserCog,     hue: 350, label: 'Liquidators'     } },
  { match: /liquidat/i,                  meta: { Icon: Power,       hue: 6,   label: 'Liquidation'     } },
  { match: /bankruptcy/i,                meta: { Icon: ScrollText,  hue: 350, label: 'Bankruptcy'      } },
  { match: /notice of intended dividend/i,meta:{ Icon: Coins,       hue: 150, label: 'Dividend'        } },
  { match: /receivership/i,              meta: { Icon: Shield,      hue: 32,  label: 'Receivership'    } },
  { match: /voluntary arrangement|cva/i, meta: { Icon: Handshake,   hue: 270, label: 'CVA'             } },
  { match: /strike off|struck off/i,     meta: { Icon: Trash2,      hue: 215, label: 'Strike-off'      } },
  { match: /insolven/i,                  meta: { Icon: AlertOctagon,hue: 32,  label: 'Insolvency'      } },
  { match: /appoint/i,                   meta: { Icon: UserCog,     hue: 270, label: 'Appointment'     } },
  { match: /meeting/i,                   meta: { Icon: Activity,    hue: 200, label: 'Meeting'         } },
];
function metaFor(t: string | null | undefined): TypeMeta {
  if (!t) return DEFAULT_META;
  for (const { match, meta } of TYPE_META) if (match.test(t)) return meta;
  return DEFAULT_META;
}

const TYPE_GROUPS: { key: string; label: string; match: (t: string | null) => boolean }[] = [
  { key: 'all',           label: 'All',           match: () => true },
  { key: 'admin',         label: 'Administration', match: t => !!t && /admin/i.test(t) },
  { key: 'liquidation',   label: 'Liquidation',    match: t => !!t && /liquid/i.test(t) },
  { key: 'winding',       label: 'Winding-up',     match: t => !!t && /winding/i.test(t) },
  { key: 'bankruptcy',    label: 'Bankruptcy',     match: t => !!t && /bankrupt/i.test(t) },
  { key: 'dividends',     label: 'Dividends',      match: t => !!t && /dividend/i.test(t) },
];

export function BusinessActivityStrip() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);
  const [transportCount, setTransportCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of TYPE_GROUPS) c[g.key] = notices.filter(n => g.match(n.noticeType)).length;
    return c;
  }, [notices]);

  const filtered = useMemo(() => {
    const g = TYPE_GROUPS.find(x => x.key === filter) ?? TYPE_GROUPS[0];
    return notices.filter(n => g.match(n.noticeType));
  }, [notices, filter]);

  return (
    <div className="iu-wrap">
      <div className="iu-head">
        <div className="iu-head__title">
          <span className="iu-head__icon"><Activity size={14} /></span>
          <h2>Insolvency Updates</h2>
          {matched > 0 && (
            <span className="iu-badge iu-badge--alert">
              <AlertTriangle size={11} /> {matched} customer{matched === 1 ? '' : 's'} affected
            </span>
          )}
        </div>
        <div className="iu-head__sub">
          London Gazette · {total} active notice{total === 1 ? '' : 's'}
          {transportCount > 0 ? ` · ${transportCount} transport-related` : ''}
          {fetchedAt && <> · updated {new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>}
        </div>
        <button onClick={load} disabled={loading} className="iu-refresh" title="Refresh">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="iu-chips">
        {TYPE_GROUPS.map(g => (
          <button key={g.key}
            onClick={() => setFilter(g.key)}
            className={`iu-chip ${filter === g.key ? 'is-active' : ''}`}>
            {g.label}
            <span className="iu-chip__n">{counts[g.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="iu-empty">Feed unavailable: {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="iu-empty">No notices match this filter.</div>
      )}

      <div className="iu-grid">
        {filtered.map(n => {
          const m = metaFor(n.noticeType);
          const Icon = m.Icon;
          const accent = `hsl(${m.hue} 84% 60%)`;
          const accentDim = `hsla(${m.hue}, 84%, 60%, 0.16)`;
          const accentBg = `hsla(${m.hue}, 70%, 55%, 0.06)`;
          const accentBgHover = `hsla(${m.hue}, 70%, 55%, 0.10)`;
          return (
            <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
              className={`iu-card ${n.isCustomer ? 'iu-card--alert' : ''}`}
              style={{
                '--accent': accent,
                '--accent-dim': accentDim,
                '--accent-bg': n.isCustomer ? 'rgba(207,36,23,0.08)' : accentBg,
                '--accent-bg-hover': n.isCustomer ? 'rgba(207,36,23,0.14)' : accentBgHover,
              } as any}>
              {/* Accent stripe left edge */}
              <span className="iu-card__stripe" />

              <div className="iu-card__top">
                <span className="iu-card__icon"><Icon size={14} /></span>
                <span className="iu-card__type">{m.label}</span>
                {n.isCustomer && (
                  <span className="iu-card__alert">
                    <AlertTriangle size={10} /> Customer
                  </span>
                )}
                <span className="iu-card__date">{fmtDate(n.publishedDate)}</span>
              </div>

              <div className="iu-card__title">{n.title}</div>

              <div className="iu-card__foot">
                <span className="iu-card__cta">Read on Gazette</span>
                <ArrowUpRight size={12} className="iu-card__arrow" />
              </div>
            </a>
          );
        })}
      </div>

      <style jsx>{`
        .iu-wrap {
          margin: 0 0 18px;
          padding: 16px 18px 18px;
          background: var(--bg-1);
          border: 1px solid var(--border);
          border-radius: 14px;
        }
        .iu-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 8px;
          row-gap: 2px;
        }
        .iu-head__title {
          display: flex; align-items: center; gap: 10px;
          grid-column: 1 / 2; grid-row: 1 / 2;
        }
        .iu-head__title h2 {
          font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
          color: var(--fg-1); margin: 0;
        }
        .iu-head__icon {
          width: 26px; height: 26px; border-radius: 8px;
          background: rgba(207,36,23,0.12); color: var(--stc-red);
          display: inline-flex; align-items: center; justify-content: center;
          flex: none;
        }
        .iu-head__sub {
          grid-column: 1 / 2; grid-row: 2 / 3;
          font-size: 11px; color: var(--fg-3);
          margin-left: 36px;
        }
        .iu-refresh {
          grid-column: 2 / 3; grid-row: 1 / 3;
          width: 32px; height: 32px; border-radius: 8px;
          background: var(--bg-2); border: 1px solid var(--border);
          color: var(--fg-2);
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all .14s;
        }
        .iu-refresh:hover { background: var(--bg-3); color: var(--fg-1); }
        .iu-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 10.5px; font-weight: 600;
          padding: 3px 8px; border-radius: 999px;
        }
        .iu-badge--alert {
          background: rgba(207,36,23,0.16); color: var(--stc-red);
        }

        .iu-chips {
          display: flex; flex-wrap: wrap; gap: 5px;
          margin: 14px 0 12px;
        }
        .iu-chip {
          background: var(--bg-2); border: 1px solid var(--border);
          color: var(--fg-2);
          padding: 5px 10px; border-radius: 7px;
          font-size: 11.5px; font-weight: 500;
          cursor: pointer; transition: all .14s;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .iu-chip:hover { background: var(--bg-3); color: var(--fg-1); }
        .iu-chip.is-active {
          background: var(--stc-navy); border-color: var(--stc-navy); color: #fff;
        }
        .iu-chip__n {
          background: rgba(0,0,0,0.18);
          font-size: 10px; font-weight: 700;
          padding: 1px 5px; border-radius: 4px;
          min-width: 14px; text-align: center;
        }
        .iu-chip.is-active .iu-chip__n { background: rgba(255,255,255,0.22); }

        .iu-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 8px;
        }

        /* ===== Linear/Neon-style card ===== */
        .iu-card {
          position: relative;
          display: flex; flex-direction: column;
          padding: 12px 14px 11px 18px;
          background:
            radial-gradient(120% 60% at 0% 0%, var(--accent-bg) 0%, transparent 70%),
            var(--bg-2);
          border: 1px solid var(--border);
          border-radius: 10px;
          text-decoration: none;
          color: var(--fg-1);
          overflow: hidden;
          transition: transform .15s cubic-bezier(.2,.8,.2,1), border-color .15s, background .15s, box-shadow .2s;
        }
        .iu-card__stripe {
          position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
          background: var(--accent);
          border-radius: 0 3px 3px 0;
          opacity: 0.9;
        }
        .iu-card:hover {
          background:
            radial-gradient(120% 60% at 0% 0%, var(--accent-bg-hover) 0%, transparent 70%),
            var(--bg-3);
          border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
          transform: translateY(-2px);
          box-shadow: 0 8px 24px -10px hsl(0 0% 0% / 0.35);
        }
        .iu-card--alert .iu-card__stripe { background: var(--stc-red); }
        .iu-card--alert {
          border-color: rgba(207,36,23,0.45);
        }

        .iu-card__top {
          display: flex; align-items: center; gap: 6px;
          margin-bottom: 8px;
          font-size: 10.5px;
        }
        .iu-card__icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: 6px;
          background: var(--accent-dim);
          color: var(--accent);
          flex: none;
        }
        .iu-card__type {
          font-size: 10.5px; font-weight: 600;
          color: var(--accent);
          text-transform: uppercase; letter-spacing: 0.06em;
          padding: 2px 6px; border-radius: 4px;
          background: var(--accent-dim);
          white-space: nowrap;
        }
        .iu-card__alert {
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 9.5px; font-weight: 700;
          color: #fff; background: var(--stc-red);
          padding: 2px 6px; border-radius: 4px;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .iu-card__date {
          margin-left: auto;
          color: var(--fg-3);
          white-space: nowrap; flex: none;
        }
        .iu-card__title {
          font-size: 13.5px; font-weight: 600;
          color: var(--fg-1);
          line-height: 1.3; letter-spacing: -0.005em;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .iu-card__foot {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: auto;
          font-size: 11px; color: var(--fg-3);
        }
        .iu-card__cta { font-weight: 500; transition: color .14s; }
        .iu-card__arrow { transition: transform .15s cubic-bezier(.2,.8,.2,1); }
        .iu-card:hover .iu-card__cta { color: var(--accent); }
        .iu-card:hover .iu-card__arrow { color: var(--accent); transform: translate(2px, -2px); }
        .iu-card--alert:hover .iu-card__cta,
        .iu-card--alert:hover .iu-card__arrow { color: var(--stc-red); }

        .iu-empty {
          padding: 22px; text-align: center;
          color: var(--fg-3); font-size: 12px;
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
