'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Info, X } from 'lucide-react';
import type { Figure } from '@/lib/analytics/types';

/* =============================================================
   The furniture the Analytics hub is built out of.

   Recreated from `STCUIAnalytics.html` rather than lifted from it, as
   the design system's handoff note requires. Every measurement below is
   the reference's own, read off the rendered page:

     section head   Panton 800 at 24px, -0.03em, 2px rule under it
     panel          1px border at r-md on the raised surface
     chart head     Panton 700 at 15px with an italic grey line under it
     footnote       11.5px subtle, above a 1px rule

   ---- The rule this page runs on ----

   The design states it and it is worth having in the code, because it
   is the thing that will erode first:

     No chart ships without a plain-English line saying what it means,
     and no headline figure ships without an explain panel. A managing
     director should never have to ask what a number counts.

   So `Chart` takes `says` and `foot` as REQUIRED props, and `Kpi` takes
   a `Figure`, which cannot be built without its provenance. A chart
   with nothing to say about itself will not compile.
   ============================================================= */

export const money = (n: number, dp = 0) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: dp,
}).format(n);

/** £1,284k rather than £1,284,000, for an axis or a scorecard. */
export function shortMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}£${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}£${Math.round(abs / 1_000)}k`;
  return money(n);
}

export const pct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;

/* -------------------------------------------------------------
   Headings
   ------------------------------------------------------------- */

export function SectionHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div
      id={id}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap',
        paddingBottom: 12, borderBottom: '2px solid var(--border-emphasis)',
        scrollMarginTop: 84, marginBottom: 20,
      }}
    >
      <h2 style={{
        margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24,
        letterSpacing: '-0.03em', color: 'var(--text)',
      }}>{title}</h2>
      <span style={{ fontSize: 13, color: 'var(--text-subtle)', flex: 1, minWidth: 240, lineHeight: 1.5 }}>
        {sub}
      </span>
    </div>
  );
}

/** The small label above a device, outside its panel. */
export function DeviceLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
        letterSpacing: '-0.02em', color: 'var(--text)',
      }}>{title}</div>
      {sub && (
        <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.5, maxWidth: '78ch' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   The panel a chart lives in

   `says` is the italic line under the title: the conclusion, in words,
   before the shape. `foot` is the line under the rule: what the reader
   should take from it or be careful about. Both required.
   ------------------------------------------------------------- */
/**
 * How tall a chart's drawing area is.
 *
 * These six numbers are the kit's, and they are the whole set it uses:
 * every `<svg>` in `docs/source/STCUIAnalytics.html` is `0 0 620 H`
 * with H one of these. Offered as a union rather than a free number so
 * a device cannot quietly grow to fill whatever row it landed in, which
 * is how a waterfall with five bars came to occupy a whole 1080p row.
 */
export type ChartHeight = 150 | 180 | 190 | 200 | 220 | 250;

/** The kit's drawing width. Charts are laid out two to a row against it. */
export const CHART_W = 620;

export function Chart({
  title, says, foot, legend, action, alarm, children,
}: {
  title: string;
  says: string;
  foot: ReactNode;
  legend?: ReactNode;
  action?: ReactNode;
  /** Draws the panel in red. For the one device that is the problem. */
  alarm?: boolean;
  children: ReactNode;
}) {
  return (
    <section style={{
      border: `1px solid ${alarm ? 'var(--danger)' : 'var(--border)'}`,
      borderRadius: 'var(--r-md)', background: 'var(--surface)',
      /* The kit's panel padding, 16 by 18. */
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10,
      minWidth: 0, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
            letterSpacing: '-0.02em', color: 'var(--text)',
          }}>{title}</div>
          <div style={{
            fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic',
            marginTop: 3, lineHeight: 1.5,
          }}>{says}</div>
        </div>
        {legend}
        {action}
      </div>

      <div style={{ minWidth: 0 }}>{children}</div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        paddingTop: 9, borderTop: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5,
      }}>{foot}</div>
    </section>
  );
}

/**
 * Two panels to a row.
 *
 * `grid-template-columns:repeat(2,1fr);gap:16px;width:100%;min-width:0`
 * is the kit's own, and it appears three times in the file. It holds
 * pairs of SMALL PANELS every time: the comparison mode cards, the
 * tier mix, the hover and brush demonstration. It never holds a chart,
 * and putting charts in it was invented. That is fixed at the call
 * sites: charts are one to a row now, which is how the kit draws every
 * one of them.
 *
 * No `align-items` either. The kit does not set one, so the two cells
 * stretch and a pair is two panels of the same height. Ours said
 * `start`, which is what left "its div is a different size to the
 * chart div next to it".
 *
 * Collapses to one column under 980px, because two of these plus the
 * gap and the page padding is about where they stop fitting.
 */
export function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="kit-pair" style={{
      display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 16, width: '100%', minWidth: 0,
    }}>
      {children}
      <style>{`@media (max-width: 980px) { .kit-pair { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

/** The key beside a chart title. Swatch, name, repeat. */
export function Legend({ items }: { items: { name: string; colour: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map((i) => (
        <span key={i.name} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: i.colour, flex: 'none' }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------
   A headline figure

   Four things, always: the number, what it is measured against, the
   line that says what period it covers, and a way to ask what it
   counts. The design is explicit that no figure appears without the
   period it is measured against, and the type system enforces it: a
   `Figure` carries `was`, `target` and `provenance` or it does not
   exist.
   ------------------------------------------------------------- */
export function Kpi({ figure, lead, onExplain }: {
  figure: Figure;
  /** The first card carries the navy rule. One per row. */
  lead?: boolean;
  onExplain: () => void;
}) {
  const f = figure;
  const shown = f.unit === 'money' ? shortMoney(f.value)
    : f.unit === 'percent' ? pct(f.value)
      : f.unit === 'days' ? `${Math.round(f.value)}d`
        : String(Math.round(f.value));

  const delta = f.was != null && f.was !== 0 ? ((f.value - f.was) / Math.abs(f.was)) * 100 : null;
  const good = delta == null ? null : (f.goodWhen === 'up' ? delta >= 0 : delta <= 0);
  const behind = f.target != null && f.target > 0 && f.value < f.target * 0.95;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderTop: `2px solid ${behind ? 'var(--danger)' : lead ? 'var(--primary)' : 'var(--border)'}`,
      borderRadius: 'var(--r-md)', background: 'var(--surface)',
      padding: '13px 15px 14px', display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{f.label}</span>
        {behind && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
            padding: '2px 6px', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap',
          }}>Watch</span>
        )}
        <button
          onClick={onExplain}
          title={`What does ${f.label} count?`}
          aria-label={`What does ${f.label} count?`}
          style={{
            border: 0, background: 'transparent', color: 'var(--text-subtle)',
            cursor: 'pointer', display: 'flex', padding: 0, flex: 'none',
          }}
        ><Info size={13} /></button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 27,
          letterSpacing: '-0.03em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
        }}>{shown}</span>
        {delta != null && (
          <span style={{
            fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
            color: good ? 'var(--success)' : 'var(--danger)',
          }}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{f.note}</div>
    </div>
  );
}

/* -------------------------------------------------------------
   Explain this number

   From the design: "Every figure has this behind it. It is the
   difference between an MD trusting the page and asking somebody to
   check it in a spreadsheet."
   ------------------------------------------------------------- */
export function Explain({ figure, when, onClose }: {
  figure: Figure; when: string; onClose: () => void;
}) {
  const rows: [string, string][] = [
    ['What it counts', figure.provenance.counts],
    ...(figure.provenance.excludes ? [['What it excludes', figure.provenance.excludes] as [string, string]] : []),
    ['Where it comes from', figure.provenance.source],
    ['Who can change it', figure.provenance.changedBy],
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(9, 22, 58, 0.44)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-3)', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
              letterSpacing: '-0.02em', color: 'var(--text)',
            }}>
              {figure.label} · {figure.unit === 'money' ? shortMoney(figure.value)
                : figure.unit === 'percent' ? pct(figure.value) : Math.round(figure.value)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{when}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 26, height: 26, display: 'grid', placeItems: 'center', flex: 'none',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          }}><X size={13} /></button>
        </div>

        <div>
          {rows.map(([label, value], at) => (
            <div key={label} style={{
              display: 'grid', gridTemplateColumns: '176px 1fr', gap: 14,
              padding: '11px 18px', borderTop: at === 0 ? 'none' : '1px solid var(--border)',
              fontSize: 13, lineHeight: 1.55,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--text)' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   The verdict band

   The first thing on the page: how are we doing, in a sentence, then
   the divisions behind it. The right hand column is separate on purpose
   and is not an alert feed.
   ------------------------------------------------------------- */
export function Verdict({ sentence, chips, decisions }: {
  sentence: string;
  chips: { name: string; delta: number | null; colour: string }[];
  decisions: { what: string; tone: 'danger' | 'warning' | 'info'; href: string | null }[];
}) {
  return (
    <section style={{
      border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)',
      borderRadius: 'var(--r-md)', background: 'var(--surface)',
      display: 'flex', flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 460px', minWidth: 0, padding: '16px 18px' }}>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)',
        }}>The period in a sentence</div>
        <p style={{
          margin: '8px 0 0', fontFamily: 'var(--panton)', fontWeight: 800,
          fontSize: 21, lineHeight: 1.3, letterSpacing: '-0.02em', color: 'var(--text)',
        }}>{sentence}</p>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 13 }}>
          {chips.map((c) => (
            <span key={c.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 24,
              padding: '0 9px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', background: 'var(--bg-subtle)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.colour }} />
              {c.name}
              {c.delta != null && (
                <span style={{
                  fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: 'none',
                  color: c.delta >= 0 ? 'var(--success)' : 'var(--danger)',
                }}>
                  {c.delta >= 0 ? '↑' : '↓'} {Math.abs(c.delta).toFixed(1)}%
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <div style={{
        flex: '0 1 320px', minWidth: 260, padding: '16px 18px',
        borderLeft: '1px solid var(--border)',
      }}>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-subtle)',
        }}>Needs a decision</div>
        {decisions.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 10, lineHeight: 1.5 }}>
            Nothing is behind target, nothing has aged past 120 days, and everybody who raised a
            lead has closed one. This column is empty because there is nothing in it.
          </div>
        ) : (
          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {decisions.map((d) => (
              <li key={d.what} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 'var(--r-full)', flex: 'none', marginTop: 5,
                  background: d.tone === 'danger' ? 'var(--danger)' : d.tone === 'warning' ? 'var(--warning)' : 'var(--info)',
                }} />
                {d.href
                  ? <a href={d.href} style={{ color: 'var(--text)', textDecoration: 'none' }}>{d.what}</a>
                  : <span style={{ color: 'var(--text)' }}>{d.what}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------
   A folding block, for the sections a reader is not in yet

   The design's answer to "granular without being overwhelming to our
   non-techy MD": the whole page is present, and the parts below the
   first screen open when somebody wants them.
   ------------------------------------------------------------- */
/**
 * One section of the page: a heading, what it is for, and its cards.
 *
 * This was a fold, and it should never have been. Five of the six
 * defaulted closed, so the bottom of the hub was a stack of grey rows
 * with a chevron on the end. That is an FAQ. Nothing in the design
 * asked for one; the accordion was invented to keep the page short and
 * paid for it by hiding the analysis somebody came to read.
 *
 * A long page is the correct shape for this. The heading rule and the
 * cards below it are what make it navigable, along with the section
 * links in the control bar, and a card already carries its own title,
 * what it says and where its figures came from.
 */
export function Section({ id, title, sub, children }: {
  id: string; title: string; sub: string; children: ReactNode;
}) {
  return (
    <div>
      <SectionHead id={id} title={title} sub={sub} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>{children}</div>
    </div>
  );
}

/** What a section cannot show, and why. Never a chart of zeroes. */
export function NotWiredPanel({ what, why, needs }: { what: string; why: string; needs: string }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderLeft: '2px solid var(--warning)',
      borderRadius: 'var(--r-md)', background: 'var(--surface-sunken)',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13.5,
        letterSpacing: '-0.01em', color: 'var(--text)',
      }}>{what}: not wired up</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{why}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--text)', fontWeight: 600 }}>What it needs. </strong>{needs}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   The tooltip every chart shares

   From the design: "Always three things: the figure, the comparison in
   the same tooltip, and what the figure is made of."
   ------------------------------------------------------------- */
export function Readout({ x, y, title, value, delta, made, hidden, bounds }: {
  x: number; y: number; title: string; value: string;
  delta?: { pct: number; against: string } | null;
  made?: string;
  hidden?: boolean;
  /** The box the readout must stay inside, in the same coordinates as x and y. */
  bounds?: { w: number; h: number } | null;
}) {
  const self = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 150, h: 64 });

  /* Measured after paint, because clamping needs the readout's own
     width and that is not known until it has text in it. One frame with
     an estimated width is imperceptible; a readout that hangs off the
     panel is not. */
  useLayoutEffect(() => {
    const el = self.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) {
      setSize({ w: r.width, h: r.height });
    }
  }, [title, value, made, delta, size.w, size.h]);

  if (hidden) return null;

  /* ---- Staying inside the panel ----

     The readout used to be `left:x; top:y; translate(-50%,-100%)` and
     nothing else, so a bar at the left edge put half of it outside the
     card and a bar at the top put all of it above. The panel clips its
     overflow, so "outside" meant invisible or, worse, a box pinned in
     a corner over the heading.

     So: centred on the point where there is room, pushed in where there
     is not, and flipped below the point when there is no room above.
     PAD keeps it off the panel's own border. */
  const PAD = 6;
  const W = bounds?.w ?? 0;
  const H = bounds?.h ?? 0;

  let left = x - size.w / 2;
  if (W > 0) left = Math.min(Math.max(PAD, left), Math.max(PAD, W - size.w - PAD));

  const above = y - size.h - 10;
  const flip = above < PAD;
  let top = flip ? y + 14 : above;
  if (H > 0) top = Math.min(Math.max(PAD, top), Math.max(PAD, H - size.h - PAD));

  const style: CSSProperties = {
    position: 'absolute', left, top,
    pointerEvents: 'none', zIndex: 5,
    /* A raised surface with a hairline, not an inverted block. Painting
       a tooltip with `--primary` gives a navy card in light and a WHITE
       card in dark, which over a dark chart is a flashbang and is the
       same borrowed-action-colour mistake this repository has recorded
       once already. `--surface-raised` steps one rung up the scale in
       both themes, which is what elevation is for. */
    background: 'var(--surface-raised)', color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--r)', padding: '8px 11px 9px',
    boxShadow: 'var(--shadow-2)', maxWidth: W > 0 ? Math.max(140, W - PAD * 2) : undefined,
  };

  return (
    <div ref={self} style={style}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--text-subtle)', whiteSpace: 'nowrap',
      }}>{title}</div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19, marginTop: 2,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 11.5, marginTop: 2, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, color: delta.pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%
          </span>
          <span style={{ color: 'var(--text-subtle)' }}> {delta.against}</span>
        </div>
      )}
      {/* What the figure is made of can be long, so this one wraps
          rather than widening the readout past the panel. */}
      {made && (
        <div style={{
          fontSize: 11, marginTop: 3, color: 'var(--text-subtle)',
          lineHeight: 1.45, whiteSpace: 'normal',
        }}>{made}</div>
      )}
    </div>
  );
}

/**
 * The hover state, and the box the readout has to stay inside.
 *
 * `box` goes on the element the coordinates are measured against, and
 * that element must be `position: relative`. Getting those two out of
 * step is what pinned a readout to the top left of the page over the
 * heading: the numbers were relative to one element and the readout was
 * positioned against another.
 */
export function useReadout() {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<null | {
    x: number; y: number; title: string; value: string;
    delta?: { pct: number; against: string } | null; made?: string;
  }>(null);

  const bounds = () => {
    const r = box.current?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : null;
  };

  /** Point in `box` coordinates, from a mouse event on any child of it. */
  const pointIn = (e: { currentTarget: EventTarget | null }) => {
    const b = box.current?.getBoundingClientRect();
    const t = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (!b || !t) return null;
    return { x: t.left - b.left + t.width / 2, y: t.top - b.top };
  };

  return { box, at, setAt, bounds, pointIn, clear: () => setAt(null) };
}
