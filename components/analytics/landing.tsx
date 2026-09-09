'use client';

import Link from 'next/link';
import {
  ArrowRight, ChevronRight, GitBranch, Info, TrendingUp, Trophy, Truck, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Pair, money, pct, shortMoney } from '@/components/analytics/kit/frame';
import { parseStyle } from '@/components/analytics/kit/mirror';
import { KIT_PARTS } from '@/lib/analytics/kit.generated';
import { HUE } from '@/components/analytics/kit/charts';
import { windowWords } from '@/lib/analytics/period';
import type { Analytics, DivisionSlug, Figure, Filters } from '@/lib/analytics/types';

/* =============================================================
   The 30 second view.

   From the business:

     Analytics landing = the 30-second management meeting view.
     Drill deeper = the 30-minute finance analysis.
     ...
     Every element on the Analytics landing must pass this test: would
     an MD or FD reasonably need this within the first 30 seconds of
     opening the page during a management meeting?

   It answers five questions in order: how are we doing, are we ahead
   or behind plan, which division explains it, what needs attention,
   what is coming next. Nothing else is here. The waterfall, the
   indexed trend, the scatter, the flow, the dot plot, the cohort grid
   and the tier stack are all still built and all still reachable, one
   click away on their own screens.

   ---- Where the styling comes from ----

   The kit has no markup for three of these objects: it draws four
   equal KPI cards where section 4 forbids them, three separate
   division scorecards where section 5 asks for one table, and it has
   no "what's coming" panel at all. So these are COMPOSED from the
   kit's own atoms rather than designed: its panel, its label, its
   figure type, its row language. `npm run check:kit-diff` proves it,
   by refusing any shape on this page that the kit does not draw.
   ============================================================= */

const DIVISION_NAME: Record<DivisionSlug, string> = {
  stc: 'STC', trailer: 'Trailer Sales', rental: 'Rentals',
};

/* The kit's panel. One declaration, used by every object below, so a
   management card cannot drift from an analytical one. */
const PANEL: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
  background: 'var(--surface)', padding: '16px 18px',
};

/* The kit's own small caps label, in Inter.

   From the business:

     Ensure tables use inter for labels and figures, not panton. Panton
     is our main accent font for headings and pulling attention to
     things ... Look deeper needs inter headings, small bold panton
     headings never work. Inter is the primary font for analytics.

   So the line this page holds is: Panton for the figures that are
   meant to be read across a meeting room, and for a page heading.
   Inter for everything smaller, which is every label, every table
   column and every card title on this screen.

   The size, the tracking, the weight and the colour are the kit's own
   label, read out of the file by `npm run kit:extract`. Only the
   family is ours, and only because the business changed it after the
   kit was written. */
const LABEL: React.CSSProperties = {
  ...parseStyle(KIT_PARTS.label.style.replace('var(--panton)', 'var(--inter)')),
  textTransform: 'uppercase',
};

/* -------------------------------------------------------------
   1. How are we doing, and are we ahead or behind

   Section 4: one coherent management summary, not a row of equal
   cards. Group revenue carries the weight; target position, the
   comparison and open pipeline sit beneath it as secondary.
   ------------------------------------------------------------- */
export function Executive({ data, onExplain, maySetTargets }: {
  data: Analytics;
  onExplain: (f: Figure) => void;
  maySetTargets: boolean;
}) {
  const revenue = data.headline.find((h) => h.label === 'Group revenue');
  const pipeline = data.headline.find((h) => h.label === 'Open pipeline');
  const won = data.headline.find((h) => h.label === 'New business won');
  if (!revenue) return null;

  const variance = revenue.target != null ? revenue.value - revenue.target : null;
  const delta = revenue.was != null && revenue.was !== 0
    ? ((revenue.value - revenue.was) / Math.abs(revenue.was)) * 100
    : null;

  return (
    <section style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={LABEL}>Group revenue</span>
            <button
              onClick={() => onExplain(revenue)}
              title="What this counts"
              style={{
                display: 'inline-flex', border: 0, background: 'transparent',
                color: 'var(--text-subtle)', cursor: 'pointer', padding: 0,
              }}
            ><Info size={13} /></button>
          </div>

          {/* The one figure on the page that carries this weight. */}
          <div style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 44,
            letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 4,
            fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
          }}>{shortMoney(revenue.value)}</div>

          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 5 }}>
            {windowWords(data.period.window)}
          </div>
        </div>

        {/* Target and comparison, side by side and secondary. Section 4:
            "Do not make the user infer the difference from two
            unrelated cards." */}
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {revenue.target != null && (
            <Figureling
              label="Against target"
              value={shortMoney(revenue.target)}
              note={variance == null ? null : variance >= 0
                ? `${shortMoney(variance)} ahead`
                : `${shortMoney(Math.abs(variance))} behind`}
              tone={variance == null ? 'plain' : variance >= 0 ? 'good' : 'bad'}
            />
          )}
          {delta != null && (
            <Figureling
              label="Comparison"
              value={`${delta >= 0 ? '+' : ''}${pct(delta)}`}
              note={data.period.mode === 'lastyear' ? 'vs same period last year' : 'vs the period before'}
              tone={delta >= 0 ? 'good' : 'bad'}
            />
          )}
          {pipeline && (
            <Figureling
              label="Open pipeline"
              value={shortMoney(pipeline.value)}
              note="still being worked"
              tone="plain"
            />
          )}
        </div>
      </div>

      {maySetTargets && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {/* Section 16: target editing behind a deliberate action, not
              an inline form on the management figure. */}
          <Link
            href="/dashboard/analytics/targets"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'none',
            }}
          >Manage targets <ChevronRight size={12} /></Link>
        </div>
      )}
      {won && null}
    </section>
  );
}

function Figureling({ label, value, note, tone }: {
  label: string; value: string; note: string | null;
  tone: 'good' | 'bad' | 'plain';
}) {
  return (
    <div style={{ minWidth: 132 }}>
      <div style={LABEL}>{label}</div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21, marginTop: 3,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{value}</div>
      {note && (
        <div style={{
          fontSize: 11.5, marginTop: 2,
          color: tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-subtle)',
        }}>{note}</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   2. Which division explains it

   Section 5: one scannable comparison, not three mini dashboards.
   A reader moves down the Revenue column, or the Variance column, and
   compares all three without reading a single chart.
   ------------------------------------------------------------- */
export function DivisionTable({ data }: { data: Analytics }) {
  return (
    <section style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 3, padding: '12px 18px 8px' }}>
        <span style={{ ...LABEL, flex: 'none', width: 148 }}>Division</span>
        <span style={{ ...LABEL, flex: 1, textAlign: 'right' }}>Revenue</span>
        <span style={{ ...LABEL, flex: 1, textAlign: 'right' }}>Target</span>
        <span style={{ ...LABEL, flex: 1, textAlign: 'right' }}>Variance</span>
        <span style={{ ...LABEL, flex: 1, textAlign: 'right' }}>Comparison</span>
        <span style={{ ...LABEL, flex: 1.2, textAlign: 'right' }}>Operations</span>
        <span style={{ flex: 'none', width: 18 }} />
      </div>

      {data.divisions.map((d) => {
        const variance = d.target != null ? d.revenue - d.target : null;
        const delta = d.was !== 0 ? ((d.revenue - d.was) / Math.abs(d.was)) * 100 : null;
        const ops = d.division === 'trailer'
          ? `${d.deals} units · ${d.margin != null ? pct((d.margin / Math.max(1, d.revenue)) * 100) : 'no cost'}`
          : d.division === 'rental'
            ? `${d.customers} on hire · ${d.deals} invoices`
            : `${d.deals} invoices · ${d.customers} customers`;

        return (
          <Link
            key={d.division}
            href={`/dashboard/analytics/revenue?division=${d.division}`}
            style={{
              display: 'flex', gap: 3, alignItems: 'center', padding: '11px 18px',
              borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)',
            }}
          >
            <span style={{
              flex: 'none', width: 148, display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 13, fontWeight: 600,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: HUE[d.division], flex: 'none' }} />
              {DIVISION_NAME[d.division]}
            </span>
            <Cell>{shortMoney(d.revenue)}</Cell>
            <Cell muted>{d.target != null ? shortMoney(d.target) : '—'}</Cell>
            <Cell tone={variance == null ? undefined : variance >= 0 ? 'good' : 'bad'}>
              {variance == null ? '—'
                : `${variance >= 0 ? '+' : '-'}${shortMoney(Math.abs(variance))}`}
            </Cell>
            <Cell tone={delta == null ? undefined : delta >= 0 ? 'good' : 'bad'}>
              {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${pct(delta)}`}
            </Cell>
            <span style={{
              flex: 1.2, textAlign: 'right', fontSize: 11.5, color: 'var(--text-subtle)',
            }}>{ops}</span>
            <ChevronRight size={14} style={{ flex: 'none', width: 18, color: 'var(--text-subtle)' }} />
          </Link>
        );
      })}
    </section>
  );
}

function Cell({ children, tone, muted }: {
  children: React.ReactNode; tone?: 'good' | 'bad'; muted?: boolean;
}) {
  return (
    /* Inter, not Panton. A figure in a table column is read down the
       column against its neighbours, which is what tabular numerals
       are for, and Panton at 13px was the "small bold panton" the
       business asked to be rid of. */
    <span style={{
      flex: 1, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums',
      fontFamily: 'var(--inter)', fontWeight: 600,
      color: tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)'
        : muted ? 'var(--text-subtle)' : 'var(--text)',
    }}>{children}</span>
  );
}

/* -------------------------------------------------------------
   3. What needs attention

   Section 6: the existing `decisionsFrom()` logic, promoted. Not a
   notification feed, and not manufactured: if nothing genuinely
   requires attention it says so.
   ------------------------------------------------------------- */
/* What the panel sweeps, in the order `decisionsFrom()` sweeps it.

   From the business: "What is the 'needs attention' linked to as
   there's only 1 thing inside it."

   It is four rules and a cap of five, and one item means one rule
   fired rather than the panel being broken. A reader cannot tell those
   apart from a list, so the list says what was checked. Each line is
   also the reason a row links where it does: a division behind target
   goes to that division's revenue screen, stock goes to the stock
   list, and somebody raising leads without closing goes to their
   leads. */
const SWEPT = [
  'a division more than a tenth behind its target',
  'trailers past 120 days',
  'and how much margin is left on them to discount',
  'anybody raising leads and closing none',
];

export function NeedsAttention({ data }: { data: Analytics }) {
  return (
    <section style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={LABEL}>Needs attention</span>
      {data.decisions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
          Nothing is outside its normal range this period.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.decisions.map((d) => {
            const row = (
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 'var(--r-full)', flex: 'none',
                  background: d.tone === 'danger' ? 'var(--danger)'
                    : d.tone === 'warning' ? 'var(--warning)' : 'var(--info)',
                }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{d.what}</span>
                {d.href && <ChevronRight size={13} style={{ color: 'var(--text-subtle)', flex: 'none' }} />}
              </span>
            );
            return d.href
              ? <Link key={d.what} href={d.href} style={{ textDecoration: 'none' }}>{row}</Link>
              : <span key={d.what}>{row}</span>;
          })}
        </div>
      )}

      {/* Said out loud, so a short list reads as a quiet period rather
          than as a panel that has stopped working. */}
      <div style={{
        borderTop: '1px solid var(--border)', paddingTop: 8,
        fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45,
      }}>
        Checked this period: {SWEPT.join(', ')}. Five at most, worst first.
        Each one opens the screen it came from.
      </div>
    </section>
  );
}

/* -------------------------------------------------------------
   4. What is coming

   Section 7: existing trustworthy forward-looking figures only. No
   probability weighting, because no probabilities exist in the data.
   Raw pipeline is shown as pipeline, not as expected revenue.
   ------------------------------------------------------------- */
export function WhatsComing({ data }: { data: Analytics }) {
  const pipeline = data.headline.find((h) => h.label === 'Open pipeline');
  const won = data.headline.find((h) => h.label === 'New business won');
  const book = data.book;

  return (
    <section style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={LABEL}>What&rsquo;s coming</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {pipeline && (
          <Coming what="Open pipeline" value={shortMoney(pipeline.value)}
            note="estimated value of leads still being worked" />
        )}
        {won && (
          <Coming what="Won this period" value={shortMoney(won.value)}
            note="agreed, and not yet all invoiced" />
        )}
        {book && (
          <Coming what="FleetSmart+ book" value={`${shortMoney(book.thisWeek)}/wk`}
            note={`${book.contracts} live contracts, recurring`} />
        )}
      </div>
    </section>
  );
}

function Coming({ what, value, note }: { what: string; value: string; note: string }) {
  /* Label and figure on one line, the caveat under it.

     The first cut put all three in one flex row with the note at
     width 100%, which forced a wrap and broke "Open pipeline" and
     "FleetSmart+ book" across two lines each. */
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{what}</span>
        <span style={{
          fontFamily: 'var(--inter)', fontWeight: 700, fontSize: 15,
          fontVariantNumeric: 'tabular-nums', color: 'var(--text)', whiteSpace: 'nowrap',
        }}>{value}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{note}</div>
    </div>
  );
}

/* -------------------------------------------------------------
   5. The way into the 30 minutes

   Section 8: deliberate drill-down navigation, no horizontal tabs, and
   the landing does not preload any of it.
   ------------------------------------------------------------- */
const DRILLDOWNS: { href: string; title: string; says: string; icon: LucideIcon }[] = [
  { href: '/dashboard/analytics/revenue', title: 'Revenue', icon: TrendingUp,
    says: 'Indexed trend, group movement, target analysis' },
  { href: '/dashboard/analytics/pipeline', title: 'Sales and pipeline', icon: GitBranch,
    says: 'Where leads came from and what became of them' },
  { href: '/dashboard/analytics/customers', title: 'Customers', icon: Users,
    says: 'Who is spending, and who has moved' },
  { href: '/dashboard/analytics/stock', title: 'Stock', icon: Truck,
    says: 'Age against margin, and what is tied up' },
  { href: '/dashboard/analytics/fleetsmart', title: 'FleetSmart+', icon: Wrench,
    says: 'Weekly value, tier mix, retention by cohort' },
  { href: '/dashboard/analytics/people', title: 'People', icon: Trophy,
    says: 'Leaderboard and conversion against the group rate' },
];

export function DrillDowns() {
  /* From the business:

       These look deeper cards need icons and to look like clickable
       cards, they'll get lost to someone who's not looking for them or
       knows web design.

     Three things carry that, and none of them is a colour: an icon in
     a tile so the card has a target to aim at, a heading in Inter
     rather than the small bold Panton that was there, and a hover and
     focus state so the pointer confirms it before the click. The
     chevron moves on hover, which is the one piece of motion on this
     screen and is there because a shape that moves under the cursor is
     the clearest possible statement that it does something.

     `.kit-drill` rather than inline styles, because a hover state and
     a focus ring cannot be written inline. */
  return (
    <section>
      <span style={{ ...LABEL, display: 'block', marginBottom: 10 }}>Look deeper</span>
      <div className="kit-drills" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14,
      }}>
        {DRILLDOWNS.map((d) => (
          <Link key={d.href} href={d.href} className="kit-drill" style={{
            ...PANEL, display: 'flex', alignItems: 'center', gap: 12,
            textDecoration: 'none', color: 'var(--text)',
          }}>
            <span className="kit-drill__icon" style={{
              flex: 'none', width: 34, height: 34, borderRadius: 'var(--r)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--border)', background: 'var(--bg-subtle)',
              color: 'var(--text-muted)',
            }}><d.icon size={16} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'block', fontFamily: 'var(--inter)', fontWeight: 600, fontSize: 13.5,
                letterSpacing: '-0.01em',
              }}>{d.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                {d.says}
              </span>
            </span>
            <ArrowRight className="kit-drill__go" size={14} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
          </Link>
        ))}
        <style>{`
          @media (max-width: 900px) { .kit-drills { grid-template-columns: 1fr !important; } }
          .kit-drill { cursor: pointer; transition: border-color 120ms, background 120ms; }
          .kit-drill:hover { border-color: var(--border-strong); background: var(--bg-subtle); }
          .kit-drill:hover .kit-drill__icon { border-color: var(--border-strong); color: var(--text); }
          .kit-drill:hover .kit-drill__go { color: var(--text); transform: translateX(2px); }
          .kit-drill__go { transition: transform 120ms, color 120ms; }
          .kit-drill:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
          @media (prefers-reduced-motion: reduce) {
            .kit-drill, .kit-drill__go { transition: none; }
            .kit-drill:hover .kit-drill__go { transform: none; }
          }
        `}</style>
      </div>
    </section>
  );
}
