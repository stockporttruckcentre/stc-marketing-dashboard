'use client';

/* =============================================================
   The five analytical sections, moved out of the hub.

   From the business:

     Landing = the 30-second management meeting view.
     Drill deeper = the 30-minute finance analysis.
     ...
     Existing analytical components should normally be moved and
     reused rather than deleted. Preserve the engine. Reorganise the
     experience.

   So these are the hub's own sections, moved verbatim. Not rewritten,
   not simplified, not re-styled. Each one now has a drill-down page of
   its own to live on, and the landing renders none of them.

   Nothing here changed except where it is imported from.
   ============================================================= */
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  BandStrip, BulletRows, DotPlot, HUE, IndexedLines, PROGRESSION, TIER,
  Progression, ShareRows, SourceFlowChart, StackedMonths, StockScatter, Waterfall,
} from '@/components/analytics/kit/charts';
import { CohortGrid } from '@/components/analytics/kit/cohort';
import {
  Chart, DeviceLabel, Legend, Pair, money, pct, shortMoney,
} from '@/components/analytics/kit/frame';
import { indexed } from '@/lib/analytics/shape';
import { iso, windowWords } from '@/lib/analytics/period';
import type { Analytics, DivisionSlug, Filters } from '@/lib/analytics/types';

const DIVISION_NAME: Record<DivisionSlug, string> = {
  stc: 'STC', trailer: 'Trailer Sales', rental: 'Rentals',
};

export function Divisions({ data, f, set }: {
  data: Analytics; f: Filters; set: (p: Partial<Filters>) => void;
}) {
  const points = useMemo(() => indexed(data.months), [data.months]);

  return (
    <>
      {/* Two to a row, which is the kit's layout for every device it
          draws. The waterfall in particular has five bars: given a
          whole 1440 row it stops being a shape. */}
      <Pair>
      <div>
        <DeviceLabel
          title="Indexed division trend"
          sub="Every division starts at 100, so a line above the middle rule means growth regardless of what that division actually sells."
        />
        <Chart
          title={`${data.months.length} months, indexed`}
          says={growthWords(points)}
          legend={<Legend items={[
            { name: 'STC', colour: HUE.stc },
            { name: 'Trailer sales', colour: HUE.trailer },
            { name: 'Rentals', colour: HUE.rental },
          ]} />}
          foot={<span>Indexing hides the size of each division on purpose. Use it for direction, and the revenue bars above for weight.</span>}
        >
          <IndexedLines points={points} />
        </Chart>
      </div>

      {data.period.compare && (
        <div>
          <DeviceLabel
            title="How the group number moved"
            sub="A waterfall, not a pie. It answers what changed rather than what is the split."
          />
          {/* The SAME two windows the rest of the page uses, not the last
              two months. A waterfall on its own comparison is how a page
              ends up saying the group is up in one panel and down in the
              next, and a reader is right not to trust either. */}
          <Chart
            title={`${windowWords(data.period.compare)} to ${windowWords(data.period.window)}`}
            says={movedWords(data.divisions)}
            foot={<span>Each middle bar is one division&rsquo;s contribution to the change, not its size. The two ends are the same figures as the sentence at the top of the page.</span>}
          >
            <Waterfall
              start={{
                label: 'Before',
                value: data.divisions.reduce((a, d) => a + d.was, 0),
              }}
              steps={data.divisions.map((d) => ({
                label: d.name, delta: d.revenue - d.was, colour: HUE[d.division],
              }))}
              end={{
                label: 'This period',
                value: data.divisions.reduce((a, d) => a + d.revenue, 0),
              }}
            />
          </Chart>
        </div>
      )}
      </Pair>

      <div>
        <DeviceLabel
          title="Division scorecards"
          sub="Same shape each time, different unit. The unit is part of the number so nothing has to be inferred."
        />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {data.divisions.map((d) => {
            const behind = d.target != null && d.target > 0 && d.revenue < d.target * 0.95;
            const on = f.divisions.includes(d.division);
            return (
              <button
                key={d.division}
                onClick={() => set({
                  divisions: on ? f.divisions.filter((x) => x !== d.division) : [...f.divisions, d.division],
                })}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: 0,
                  border: `1px solid ${behind ? 'var(--danger)' : on ? 'var(--primary)' : 'var(--border)'}`,
                  borderTop: `2px solid ${behind ? 'var(--danger)' : HUE[d.division]}`,
                  borderRadius: 'var(--r-md)', background: 'var(--surface)',
                  fontFamily: 'var(--inter)',
                }}
              >
                <div style={{ padding: '13px 15px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, height: 20, padding: '0 8px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: HUE[d.division] }} />
                      {d.name}
                    </span>
                    {behind && (
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                        color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                        padding: '2px 6px', borderRadius: 'var(--r-sm)',
                      }}>Behind</span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 26, marginTop: 8,
                    letterSpacing: '-0.03em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                  }}>{shortMoney(d.revenue)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {d.division === 'trailer' ? `sold, ${d.deals} trailers` : `invoiced, ${d.deals} invoices`}
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {d.detail.map((row) => (
                    <div key={row.label} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12,
                      padding: '7px 15px', fontSize: 12.5,
                      borderTop: '1px solid var(--border)',
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                      <span style={{
                        color: row.bad ? 'var(--danger)' : 'var(--text)', fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function growthWords(points: { stc: number; trailer: number; rental: number }[]): string {
  const last = points[points.length - 1];
  if (!last) return 'Not enough months to draw a trend yet.';
  const say = (name: string, v: number) => {
    const d = v - 100;
    if (Math.abs(d) < 3) return `${name} is level`;
    return `${name} is ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(0)}%`;
  };
  return `${say('STC', last.stc)}, ${say('trailer sales', last.trailer)}, ${say('rentals', last.rental)} against where each started.`;
}

export function movedWords(divisions: Analytics['divisions']): string {
  const delta = divisions.reduce((a, d) => a + (d.revenue - d.was), 0);
  const biggest = [...divisions]
    .map((d) => ({ name: d.name, d: d.revenue - d.was }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  if (!biggest) return 'Nothing to compare.';
  return `${delta >= 0 ? 'Up' : 'Down'} ${shortMoney(Math.abs(delta))}. `
    + `${biggest.name} ${biggest.d >= 0 ? 'added' : 'gave back'} ${shortMoney(Math.abs(biggest.d))} of that.`;
}

export function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* =============================================================
   People
   ============================================================= */
export function People({ data, f, set }: {
  data: Analytics; f: Filters; set: (p: Partial<Filters>) => void;
}) {
  const people = data.people;
  const max = Math.max(1, ...people.map((p) => p.leads));
  const totalLeads = people.reduce((a, p) => a + p.leads, 0);
  const totalWon = people.reduce((a, p) => a + p.won, 0);
  const groupRate = totalLeads > 0 ? totalWon / totalLeads : 0;

  if (people.length === 0) {
    return (
      <Chart title="New business by person" says="Nobody raised a lead in this window."
        foot={<span>Leads count against the window they were raised in, wins against the window they were agreed in.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          Nothing to rank. Widen the period or clear a filter.
        </div>
      </Chart>
    );
  }

  return (
    <>
      {/* Two to a row. */}
      <Pair>
      <div>
        <DeviceLabel
          title="Leaderboard with progression"
          sub="The bar is three nested segments: leads, of which quoted, of which won. A wide pale bar with a narrow dark tip is somebody generating interest but not closing."
        />
        <Chart
          title="New business by person"
          says={leaderWords(people)}
          legend={<Legend items={[
            { name: 'Leads', colour: PROGRESSION.leads },
            { name: 'Quoted', colour: PROGRESSION.quoted },
            { name: 'Won', colour: PROGRESSION.won },
          ]} />}
          foot={<span>Click a row to narrow the page to that person. Revenue stays group wide: a Protean invoice does not carry a salesperson.</span>}
        >
          <div>
            {people.map((p, at) => (
              <button
                key={p.id}
                onClick={() => set({ person: f.person === p.id ? null : p.id })}
                style={{
                  display: 'grid', width: '100%', textAlign: 'left', cursor: 'pointer',
                  gridTemplateColumns: '26px 176px 1fr 108px 96px',
                  gap: 12, alignItems: 'center', padding: '9px 4px',
                  border: 0, borderTop: at === 0 ? 'none' : '1px solid var(--border)',
                  background: f.person === p.id ? 'var(--bg-subtle)' : 'transparent',
                  fontFamily: 'var(--inter)',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                  {at + 1}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                    {p.division ? DIVISION_NAME[p.division] : 'No division'}
                  </span>
                </span>
                <Progression leads={p.leads} quoted={p.quoted} won={p.won} max={max} />
                <span style={{
                  fontSize: 12, color: 'var(--text-muted)', textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>{p.leads} · {p.quoted} · <strong style={{ color: 'var(--text)' }}>{p.won}</strong></span>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13, textAlign: 'right',
                  color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                }}>{shortMoney(p.wonValue)}</span>
              </button>
            ))}
          </div>
        </Chart>
      </div>

      <div>
        <DeviceLabel
          title="Conversion against the group rate"
          sub="A dot per person against the group average. Above the line is closing better than average, and dot size is how much they closed."
        />
        <Chart
          title="Lead to won conversion"
          says={`Group average is ${Math.round(groupRate * 100)}%.`}
          foot={<span>Dot size is won value, so a small dot high up is a good rate on a small book. Both matter, and neither alone tells you who to back.</span>}
        >
          <DotPlot
            groupRate={groupRate}
            people={people.map((p) => ({
              id: p.id, initials: p.initials, name: p.name, rate: p.conversion, value: p.wonValue,
            }))}
          />
        </Chart>
      </div>
      </Pair>

      {/* The source flow moved to the Sales and pipeline drill-down.
          From the business: "The existing Source Flow device belongs
          here rather than on the executive landing." People answers
          who sold; pipeline answers where the work came from. */}
    </>
  );
}

/* =============================================================
   Where work came from, and what became of it

   Split out of `People` when the hub became a landing and six
   drill-downs. Same device, same calculation, different screen.
   ============================================================= */
export function Sources({ data }: { data: Analytics }) {
  return (
    <>
      {data.sources.length > 0 && (
        <div>
          <DeviceLabel
            title="Where work came from, and what became of it"
            sub="Bands from each source splitting into won by division, still open, and lost. The loss is drawn at full width rather than left as the gap."
          />
          <Chart
            title={`${data.sources.reduce((a, s) => a + s.leads, 0)} leads raised in this window`}
            says={sourceWords(data.sources)}
            foot={(
              <span>
                The source is recorded on the CUSTOMER rather than on the lead, so this reads as
                &ldquo;what work from this kind of customer turned into&rdquo;. Close to per lead
                attribution and not identical to it.
              </span>
            )}
          >
            <SourceFlowChart rows={data.sources} />
          </Chart>
        </div>
      )}
    </>
  );
}

export function leaderWords(people: Analytics['people']): string {
  if (people.length < 2) return `${people[0]?.name ?? 'Nobody'} is the only person with anything in this window.`;
  const byValue = people[0]!;
  const byLeads = [...people].sort((a, b) => b.leads - a.leads)[0]!;
  if (byValue.id === byLeads.id) {
    return `${byValue.name} leads on both volume and value.`;
  }
  return `${byLeads.name} generates the most leads but ${byValue.name} converts more value. `
    + 'Two different conversations, in the same row.';
}

export function sourceWords(sources: Analytics['sources']): string {
  const best = [...sources]
    .filter((s) => s.leads >= 3)
    .sort((a, b) => rate(b) - rate(a))[0];
  const worst = [...sources]
    .filter((s) => s.leads >= 3)
    .sort((a, b) => rate(a) - rate(b))[0];
  if (!best || !worst || best === worst) return 'Not enough leads yet to compare sources.';
  return `${best.source} converts best at ${Math.round(rate(best) * 100)}%. `
    + `${worst.source} brought ${worst.leads} and closed ${won(worst)}.`;
}

export const won = (s: Analytics['sources'][number]) => s.won.stc + s.won.trailer + s.won.rental;
export const rate = (s: Analytics['sources'][number]) => (s.leads > 0 ? won(s) / s.leads : 0);

/* =============================================================
   Trailer sales
   ============================================================= */
export function Stock({ data }: { data: Analytics & { bands?: any[] } }) {
  const units = data.stock;
  const old = units.filter((u) => u.days > 120);
  const thin = old.filter((u) => u.marginPct != null && u.marginPct < 8);
  const noCost = units.filter((u) => u.marginPct == null);

  if (units.length === 0) {
    return (
      <Chart title="Stock" says="Nothing is showing as in stock."
        foot={<span>Reads the stock list, counting anything marked in stock or available.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          No units to plot.
        </div>
      </Chart>
    );
  }

  return (
    <>
      <Pair>
      <div>
        <DeviceLabel
          title="Stock age against margin"
          sub="Every dot is a trailer. Right means it has been here too long, low means there is little margin left to give away. The bottom right corner is the problem corner."
        />
        <Chart
          title={`${units.length} trailers in stock`}
          says={`${old.length} are past 120 days. ${thin.length} of those have under 8% margin left to discount.`}
          action={<span style={{
            fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap',
          }}>Dot size = asking price</span>}
          foot={(
            <span>
              Days are counted from the day the unit was added to the stock list, which is the
              earliest date this application holds for it.
              {noCost.length > 0 && ` ${noCost.length} units have no cost recorded and are not plotted: a margin cannot be worked out for them.`}
            </span>
          )}
        >
          <StockScatter units={units} />
        </Chart>
      </div>

      {data.bands && (
        <div>
          <DeviceLabel
            title="Stock ageing bands"
            sub="How the units break down, and what each band is worth. The band, not the average, is what tells you whether stock is turning."
          />
          <Chart
            title="What is tied up, by age"
            says={bandWords(data.bands)}
            foot={<span>Value is the asking price, not what a unit would fetch after a discount.</span>}
          >
            <BandStrip bands={data.bands} />
          </Chart>
        </div>
      )}
      </Pair>
    </>
  );
}

export function bandWords(bands: { label: string; units: number; value: number; reading: string }[]): string {
  const bad = bands[bands.length - 1];
  if (!bad || bad.units === 0) return 'Nothing is older than four months. Stock is turning.';
  return `${shortMoney(bad.value)} is tied up in stock older than four months, across ${bad.units} units.`;
}

/* =============================================================
   FleetSmart+
   ============================================================= */
export function Book({ data, set }: { data: Analytics; set: (p: Partial<Filters>) => void }) {
  const book = data.book;
  if (!book) {
    return (
      <Chart title="The contract book" says="No FleetSmart+ contracts have been accepted yet."
        foot={<span>Counts accepted contracts only. Drafts and contracts sent and not signed are not a book.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          Nothing to draw. The book appears the first time a contract is accepted.
        </div>
      </Chart>
    );
  }

  const first = book.months[0];
  const last = book.months[book.months.length - 1];
  const grew = first && last
    ? ((total(last) - total(first)) / Math.max(1, total(first))) * 100
    : 0;

  return (
    <>
      <div>
        <DeviceLabel
          title="The book, built by tier"
          sub="Stacked weekly value by month. The height is the whole book, and the segments show which tier is actually growing."
        />
        <Chart
          title="Weekly contracted value"
          says={first && last
            ? `The book is ${grew >= 0 ? 'up' : 'down'} ${Math.abs(grew).toFixed(0)}% over these months.`
            : 'Not enough months to show a trend yet.'}
          legend={<Legend items={[
            { name: 'Silver', colour: TIER.silver },
            { name: 'Gold', colour: TIER.gold },
            { name: 'Platinum', colour: TIER.platinum },
          ]} />}
          foot={<span>Drag across the bars to set the period for the whole page.</span>}
        >
          <StackedMonths
            months={book.months as any}
            series={[
              { key: 'silver', name: 'Silver', colour: TIER.silver },
              { key: 'gold', name: 'Gold', colour: TIER.gold },
              { key: 'platinum', name: 'Platinum', colour: TIER.platinum },
            ]}
            onBrush={(from, to) => set({
              kind: 'custom',
              from,
              to: endOfMonthIso(to),
            })}
          />
        </Chart>

        <div style={{
          display: 'grid', gap: 1, marginTop: 12, background: 'var(--border)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        }}>
          {[
            ['This week', money(book.thisWeek), `across ${book.contracts} contracts`],
            ['Annualised', shortMoney(book.annualised), 'if nothing changes'],
            ['Added this period', money(book.addedThisPeriod), 'weekly value of new contracts'],
            ['Average', money(book.contracts ? book.thisWeek / book.contracts : 0), 'per contract per week'],
          ].map(([label, value, sub]) => (
            <div key={label} style={{ background: 'var(--surface)', padding: '11px 13px' }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
              }}>{label}</div>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21, marginTop: 3,
                color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
              }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* The mix sits on its own row. The cohort grid follows it at full
          width, because that is how wide the kit draws it: 1126 inside
          a 1440 page. Putting it in a two column grid halved it, which
          is a layout the file does not have. */}
      <div>
        <Chart
          title={`Mix today, ${book.contracts} contracts`}
          says={mixWords(book)}
          foot={<span>Contracts on the left of each row, weekly value on the right. They rank differently, which is the point.</span>}
        >
          <ShareRows rows={book.mix.map((m) => ({
            name: m.tier, count: m.contracts, value: m.weekly,
            colour: m.tier === 'Platinum' ? TIER.platinum : m.tier === 'Gold' ? TIER.gold : TIER.silver,
          }))} />
        </Chart>

        {/* No Chart wrapper. The kit's cohort device is the whole
            panel: its own border, title, sentence, grid, footnote and
            scale. Wrapping it in ours would draw the panel twice and
            the title twice, which is what happens when a device is
            treated as a chart rather than as the design. */}
        <CohortGrid cohorts={book.cohorts} says={retentionWords(book)} />
      </div>
    </>
  );
}

export const total = (m: { silver: number; gold: number; platinum: number }) => m.silver + m.gold + m.platinum;

export function mixWords(book: NonNullable<Analytics['book']>): string {
  const weekly = book.mix.reduce((a, m) => a + m.weekly, 0);
  const biggest = [...book.mix].sort((a, b) => b.weekly - a.weekly)[0];
  if (!biggest || weekly === 0) return 'No live contracts to break down.';
  return `${biggest.tier} is ${Math.round((biggest.weekly / weekly) * 100)}% of the weekly value `
    + `from ${biggest.contracts} of ${book.contracts} contracts.`;
}

export function retentionWords(book: NonNullable<Analytics['book']>): string {
  const withData = book.cohorts.filter((c) => c.signed > 0);
  if (withData.length === 0) return 'No contracts have started in these months.';
  const worst = [...withData].sort((a, b) => {
    const la = a.live.filter((v) => v != null).pop() ?? 100;
    const lb = b.live.filter((v) => v != null).pop() ?? 100;
    return la - lb;
  })[0]!;
  const kept = worst.live.filter((v) => v != null).pop() ?? 100;
  if (kept === 100) return 'Every contract signed in these months is still live.';
  return `The ${monthLabel(worst.month)} cohort has kept ${kept}% of what it signed, the lowest of any month here.`;
}

export function endOfMonthIso(month: string): string {
  const d = new Date(`${month.slice(0, 10)}T00:00:00Z`);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/* =============================================================
   Customers
   ============================================================= */
export function Customers({ data }: { data: Analytics }) {
  if (data.customers.length === 0) {
    return (
      <Chart title="Top customers" says="Nothing invoiced in this window."
        foot={<span>Reads Protean and Sage invoices by tax point.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          No customers to rank.
        </div>
      </Chart>
    );
  }
  const top = data.customers;
  const all = top.reduce((a, c) => a + c.revenue, 0);

  return (
    <Chart
      title={`Top ${top.length} customers`}
      says={`These ${top.length} account for ${shortMoney(all)} of invoicing in this window.`}
      foot={<span>Protean and Sage account names, so a customer not yet matched to a CRM record still appears. Trailer sales are not invoiced through either and are not in this table.</span>}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {['Customer', 'Division', 'This window', 'Comparison', 'Change'].map((h, i) => (
                <th key={h} style={{
                  textAlign: i >= 2 ? 'right' : 'left', padding: '0 10px 7px',
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
                  borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((c) => {
              const change = c.was > 0 ? ((c.revenue - c.was) / c.was) * 100 : null;
              return (
                <tr key={`${c.division}-${c.name}`}>
                  <td style={{ ...cellStyle, color: 'var(--text)', fontWeight: 500 }}>{c.name}</td>
                  <td style={{ ...cellStyle, color: 'var(--text-subtle)' }}>{DIVISION_NAME[c.division]}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                    {money(c.revenue)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)' }}>
                    {c.was > 0 ? money(c.was) : '—'}
                  </td>
                  <td style={{
                    ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: change == null ? 'var(--text-subtle)' : change >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {change == null ? 'new' : `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Chart>
  );
}

export const cellStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};
