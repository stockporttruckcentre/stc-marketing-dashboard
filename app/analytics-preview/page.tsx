'use client';

/* =============================================================
   The Analytics panels, against fabricated figures. Development only.

   ---- Why this exists ----

   The analytics page has now been rejected twice, and both times the
   report was about the WHOLE rather than any part of it:

     that whole top section looks awful

     It's extremely messy, ui broken on lower section, columns all
     different sized, text formatting not great to understand.

   Neither of those is visible in a diff. Every panel is defensible on
   its own; what was wrong was three cards of different heights beside
   each other, a form growing out of the bottom of one, and eight type
   sizes on one row. The only way to catch that is to look at it, and
   the page cannot be looked at without Supabase credentials.

   So this renders the real components against fabricated rows, in the
   real grid, at any window size, in both themes. It is not a mock of
   the screen. It is the screen's own parts, drawn.

   `notFound()` in production, like the UI kit harness next door, so it
   is never reachable on a deployment.
   ============================================================= */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { Container, KeyRound, Wrench } from 'lucide-react';
import { Button, Chip, PageHead, compactMoney, money } from '@/components/kit/primitives';
import { MonthlyStack, type MonthPoint, type Shape } from '@/components/analytics/monthly';
import { Donut } from '@/components/analytics/donut';
import { DivergingBars, RankedBars, type BarRow } from '@/components/analytics/bars';
import { Key, Panel, PanelGrid, Segments, Toggle } from '@/components/analytics/panel';
import { swatchImage } from '@/components/analytics/texture';
import { Tile } from '@/components/analytics/tiles';

const HUE: Record<string, string> = {
  stc: 'var(--chart-stc)',
  trailer: 'var(--chart-trailer)',
  rental: 'var(--chart-rental)',
};

const SERIES = [
  { key: 'stc', name: 'Maintenance', colour: HUE.stc! },
  { key: 'trailer', name: 'Trailer sales', colour: HUE.trailer! },
  { key: 'rental', name: 'S&L', colour: HUE.rental! },
];

/* Twenty four months, shaped rather than random: a quiet winter, a
   strong spring, one month where nothing was invoiced at all, and a
   trailer division roughly a sixth the size of maintenance. A chart
   drawn against flat noise looks fine and tells you nothing. */
const MONTHS: MonthPoint[] = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(2024, 8 + i, 1);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const season = 1 + 0.34 * Math.sin(((d.getMonth() - 2) / 12) * Math.PI * 2);
  const growth = 1 + i * 0.012;
  const quiet = i === 9;
  return {
    month,
    values: quiet ? [0, 0, 0] : [
      Math.round(186000 * season * growth),
      Math.round(31000 * season * growth * (i % 4 === 0 ? 2.1 : 0.7)),
      Math.round(52000 * season * growth),
    ],
  };
});

const YEAR = MONTHS.slice(-7).map((m) => m.values.reduce((s, v) => s + v, 0));

const CUSTOMERS: BarRow[] = [
  { key: 'a', name: 'Dawson Group', value: 412_800 },
  { key: 'b', name: 'Wincanton North', value: 288_140 },
  { key: 'c', name: 'Bredbury Haulage', value: 196_500 },
  { key: 'd', name: 'TIP Trailers UK', value: 154_020 },
  { key: 'e', name: 'Marsden Logistics International', value: 121_770 },
  { key: 'f', name: 'SMH Transport', value: 98_400, note: 'no record' },
  { key: 'g', name: 'Hyde Freight', value: 74_260 },
  { key: 'h', name: 'A&A Scaffolding', value: 41_900 },
];

const MOVERS: BarRow[] = [
  { key: 'a', name: 'Dawson Group', value: 96_400, note: '316k' },
  { key: 'b', name: 'Hyde Freight', value: 41_200, note: '33k' },
  { key: 'c', name: 'Bishopgate Rentals', value: 12_800, note: '4k' },
  { key: 'd', name: 'Walker Transport', value: -9_600, note: '58k' },
  { key: 'e', name: 'Dane Valley Transport', value: -38_100, note: '104k' },
  { key: 'f', name: 'Wincanton North', value: -121_400, note: '409k' },
];

const AGEING: BarRow[] = [
  { key: '1', name: 'Under a week', value: 42_100, note: '31 jobs', colour: 'var(--chart-company)' },
  { key: '2', name: 'One to four weeks', value: 88_600, note: '46 jobs', colour: 'var(--chart-company)' },
  { key: '3', name: 'One to three months', value: 51_300, note: '19 jobs', colour: 'var(--chart-company)' },
  { key: '4', name: 'Over ninety days', value: 27_400, note: '8 jobs', colour: 'var(--danger)' },
];

const FUNNEL: BarRow[] = [
  { key: 'lead', name: 'Lead', value: 24, note: '312k' },
  { key: 'contacted', name: 'Contacted', value: 16, note: '241k' },
  { key: 'quoted', name: 'Quoted', value: 9, note: '188k' },
  { key: 'won', name: 'Won', value: 4, note: '96k' },
];

const SLICES = [
  { key: 'stc', name: 'Maintenance', value: 2_284_000, colour: HUE.stc! },
  { key: 'trailer', name: 'Trailer sales', value: 486_000, colour: HUE.trailer! },
  { key: 'rental', name: 'S&L', value: 641_000, colour: HUE.rental! },
];

export default function AnalyticsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Harness />;
}

function Harness() {
  const [shape, setShape] = useState<Shape>('stack');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [textured, setTextured] = useState(true);
  const [only, setOnly] = useState<string | null>(null);

  const total = SLICES.reduce((s, x) => s + x.value, 0);
  const keyItems = SERIES.map((s, i) => ({
    ...s, pattern: swatchImage(i, textured && shape !== 'line'),
  }));

  return (
    <div className="kit" style={{ padding: '0 24px 40px', maxWidth: 1480, margin: '0 auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 0 12px',
      }}>
        <PageHead
          eyebrow="Analytics"
          title={only ? SLICES.find((s) => s.key === only)!.name : 'The company'}
          sub="The year from Apr 2026, against the same point in the year before it."
        />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Chip active={only == null} onClick={() => setOnly(null)}>Whole company</Chip>
          <Chip active={only === 'stc'} onClick={() => setOnly(only === 'stc' ? null : 'stc')}>
            <Wrench size={12} /> Maintenance
          </Chip>
          <Chip active={only === 'trailer'} onClick={() => setOnly(only === 'trailer' ? null : 'trailer')}>
            <Container size={12} /> Trailer sales
          </Chip>
          <Chip active={only === 'rental'} onClick={() => setOnly(only === 'rental' ? null : 'rental')}>
            <KeyRound size={12} /> S&amp;L
          </Chip>
        </div>
      </div>

      <PanelGrid>
        <Tile
          label="Invoiced this year"
          value={money(3_411_000)}
          movement={{ from: 3_046_000, to: 3_411_000 }}
          note={`${money(5_902_000)} in all of last year`}
          spark={YEAR}
        />
        <Tile
          label="Committed, not billed"
          value={money(742_400)}
          note="184 on the ramps and in stock"
        />
        <Tile
          label="Invoices raised"
          value="2,914"
          note={`${money(1170)} each on average`}
        />
        <Tile
          label="Open over ninety days"
          value={money(27_400)}
          tone="danger"
          note="8 jobs on the ramps"
        />

        <Panel
          span={7}
          title="Invoiced by month"
          hint="Two years, against the same month a year before"
          minBody={300}
          toolbar={
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Segments value={shape} onChange={setShape} options={[
                { value: 'stack' as const, label: 'Stacked' },
                { value: 'line' as const, label: 'Lines' },
                { value: 'column' as const, label: 'Columns' },
              ]} />
              {shape !== 'line' && (
                <Toggle on={textured} onChange={setTextured}>Patterns</Toggle>
              )}
            </div>
          }
          table={{
            columns: ['Month', ...SERIES.map((s) => s.name), 'Total'],
            rows: MONTHS.slice(-12).reverse().map((p) => ({
              name: new Date(`${p.month}T00:00:00`)
                .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
              cells: [...p.values, p.values.reduce((s, v) => s + v, 0)],
            })),
          }}
          foot={
            <>
              <Key
                items={keyItems}
                hidden={off}
                onToggle={(k) => setOff((s) => {
                  const next = new Set(s);
                  if (next.has(k)) next.delete(k);
                  else if (next.size < SERIES.length - 1) next.add(k);
                  return next;
                })}
              />
              <span style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }}>
                Hover for the month. Press a division to hide it.
              </span>
            </>
          }
        >
          <MonthlyStack
            points={MONTHS}
            series={SERIES}
            yearStart={4}
            shape={shape}
            hidden={off}
            textured={textured}
            height={300}
          />
        </Panel>

        <Panel
          span={5}
          title="Where it came from"
          hint="Press a division to drill in"
          minBody={300}
          table={{
            columns: ['Division', 'This year', 'Share'],
            rows: SLICES.map((s) => ({
              name: s.name, colour: s.colour,
              cells: [s.value, `${((s.value / total) * 100).toFixed(1)}%`],
            })),
          }}
        >
          <Donut
            slices={SLICES}
            total={total}
            caption="invoiced"
            active={only}
            onPick={setOnly}
            textured={textured}
            height={260}
          />
        </Panel>

        <Panel
          span={6}
          title="Biggest customers"
          hint="Every division netted, this year"
          minBody={252}
          table={{
            columns: ['Customer', 'This year'],
            rows: CUSTOMERS.map((c) => ({ name: c.name, cells: [c.value] })),
          }}
          foot={
            <>
              <span><strong style={{ fontFamily: 'var(--panton)' }}>412</strong> customers billing</span>
              <span>Top ten are <strong style={{ fontFamily: 'var(--panton)' }}>41%</strong></span>
              <span>Middle customer <strong style={{ fontFamily: 'var(--panton)' }}>{compactMoney(3120)}</strong></span>
            </>
          }
        >
          <RankedBars rows={CUSTOMERS} colour="var(--chart-company)" empty="Nothing billed." />
        </Panel>

        <Panel
          span={6}
          title="Who moved"
          hint="Against the same point last year"
          minBody={252}
          table={{
            columns: ['Customer', 'Last year', 'Change'],
            rows: MOVERS.map((m) => ({ name: m.name, cells: [m.note ?? null, m.value] })),
          }}
        >
          <DivergingBars
            rows={MOVERS}
            empty="Nobody has moved."
            caption="Maintenance and rental netted together. Trailer purchases are left out: a customer who bought last year and not this one has a trailer, not a problem."
          />
        </Panel>

        <Panel
          span={6}
          title="How old the open work is"
          hint="From the day the job was raised"
          minBody={214}
          table={{
            columns: ['Age', 'Value', 'Jobs'],
            rows: AGEING.map((b) => ({ name: b.name, colour: b.colour, cells: [b.value, b.note ?? null] })),
          }}
          foot={<span style={{ color: 'var(--danger)' }}>{money(27_400)} of it has been open over ninety days.</span>}
        >
          <RankedBars rows={AGEING} colour="var(--chart-company)" empty="No open work." />
        </Panel>

        <Panel
          span={6}
          title="What is coming"
          hint="Open leads on the tracker, by stage"
          minBody={214}
          table={{
            columns: ['Stage', 'Leads', 'Worth'],
            rows: FUNNEL.map((s) => ({ name: s.name, cells: [String(s.value), s.note ?? null] })),
          }}
          foot={
            <>
              <span>11 won this year</span>
              <span style={{ marginLeft: 'auto' }}>
                <Button variant="ghost" size="sm">Open the tracker</Button>
              </span>
            </>
          }
        >
          <RankedBars
            rows={FUNNEL}
            colour="var(--chart-company)"
            format={(n) => n.toLocaleString('en-GB')}
            empty="Nothing open."
          />
        </Panel>
      </PanelGrid>
    </div>
  );
}
