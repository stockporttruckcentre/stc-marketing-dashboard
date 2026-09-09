'use client';

import { notFound, useSearchParams } from 'next/navigation';
import { AnalyticsHub } from '@/components/AnalyticsHub';
import { TargetsBoard } from '@/components/analytics/TargetsBoard';
import { CustomersDrillDown } from '@/components/analytics/drilldowns/customers';
import { FleetSmartDrillDown } from '@/components/analytics/drilldowns/fleetsmart';
import { PeopleDrillDown } from '@/components/analytics/drilldowns/people';
import { PipelineDrillDown } from '@/components/analytics/drilldowns/pipeline';
import { RevenueDrillDown } from '@/components/analytics/drilldowns/revenue';
import { StockDrillDown } from '@/components/analytics/drilldowns/stock';
import { buildPeriod } from '@/lib/analytics/period';
import {
  ageingBands, contractBook, decisionsFrom, divisionRows, headlineFigures,
  monthPoints, peopleRows, sourceFlows, stockUnits, verdictSentence,
  type ContractRow, type LeadRow, type TrailerRow, type WindowRow,
} from '@/lib/analytics/shape';

/* =============================================================
   The Analytics hub, with figures and without a database.

   The same harness the tracker, the FleetSmart+ contract and the
   reports hub have, and for the reason that got established the hard
   way in this repository: a layout measured on a rebuilt copy is a
   guess dressed as a measurement.

   So this mounts the REAL `AnalyticsHub`, in the real content box the
   dashboard gives a page, and feeds it by answering its own request.
   Nothing about the component is stubbed or branched: it fetches
   `/api/analytics` exactly as it does in production, and the fetch is
   answered here rather than by the server.

   ---- Why the fixture is awkward on purpose ----

   A demonstration fixture where everything is going well proves the
   page renders. This one has a division behind target, a person who
   raised leads and closed none, a trailer with no cost recorded, stock
   past 120 days with the margin gone, and a contract that was signed
   and then declined. Those are the states the page exists to surface,
   and a screenshot that does not contain them has not been checked.

   Never in production.
   ============================================================= */

const TODAY = '2026-09-09';
const period = buildPeriod({ kind: 'month', today: TODAY, mode: 'previous', trim: true });

const WINDOW: WindowRow[] = [
  { division: 'stc', name: 'STC', revenue: 1284000, deals: 412, customers: 96,
    margin: null, was_revenue: 1098000, was_deals: 380, was_customers: 91, target: 1250000 },
  { division: 'trailer', name: 'Trailer Sales', revenue: 702000, deals: 24, customers: 21,
    margin: 129168, was_revenue: 560000, was_deals: 19, was_customers: 18, target: 560000 },
  { division: 'rental', name: 'Rentals', revenue: 146000, deals: 88, customers: 31,
    margin: null, was_revenue: 184000, was_deals: 96, was_customers: 33, target: 210000 },
];

/* Twenty four months, shaped rather than random: a quiet winter, a
   strong spring, one month where rentals fell away, and a trailer
   division roughly half the size of maintenance. A chart drawn against
   flat noise looks fine and tells you nothing. */
const MONTH_ROWS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 9 + i, 1));
  const month = d.toISOString().slice(0, 10);
  const season = 1 + 0.22 * Math.sin(((d.getUTCMonth() - 2) / 12) * Math.PI * 2);
  return [
    { month, division: 'stc', net: Math.round(900000 * season * (1 + i * 0.018)) },
    { month, division: 'trailer', net: Math.round(340000 * season * (1 + i * 0.034)) },
    { month, division: 'rental', net: Math.round(210000 * season * (1 - i * 0.011)) },
  ];
}).flat();

const TARGETS = MONTH_ROWS
  .filter((r) => r.division === 'stc')
  .map((r) => ({ month: r.month, division: null as string | null, target: 1_500_000 }));

const NAMES = new Map([
  ['u1', 'Dean Mann'], ['u2', 'Tom Price'], ['u3', 'Rob Latham'],
  ['u4', 'Sam Keane'], ['u5', 'Jo Hartley'],
]);

const LEADS: LeadRow[] = [
  ...spread('u1', 'trailer_sales', 34, 26, 18, 412000, 'referral'),
  ...spread('u2', 'maintenance', 41, 31, 17, 186000, 'outbound'),
  ...spread('u3', 'maintenance', 28, 19, 12, 94000, 'website'),
  ...spread('u4', 'rental', 22, 14, 0, 0, 'depot walk-in'),
  ...spread('u5', 'trailer_sales', 17, 11, 7, 96000, 'repeat'),
];

function spread(
  owner: string, type: string, leads: number, quoted: number, won: number,
  value: number, source: string,
): LeadRow[] {
  const out: LeadRow[] = [];
  for (let i = 0; i < leads; i += 1) {
    const day = String((i % 9) + 1).padStart(2, '0');
    const isWon = i < won;
    const isQuoted = i < quoted;
    out.push({
      id: `${owner}-${i}`,
      owner_id: owner,
      type,
      status: isWon ? 'customer' : isQuoted ? 'quoted' : i % 5 === 0 ? 'lost' : 'contacted',
      estimated_value: Math.round(value / Math.max(1, won || leads)),
      sale_price: isWon ? Math.round(value / Math.max(1, won)) : null,
      order_date: isWon ? `2026-09-${day}` : null,
      created_at: `2026-09-${day}T09:00:00Z`,
      contact_source: source,
    });
  }
  return out;
}

const TRAILERS: TrailerRow[] = Array.from({ length: 41 }, (_, i) => {
  const age = [12, 18, 24, 29, 33, 41, 48, 55, 61, 66, 72, 78, 84, 91, 96, 102, 110, 118,
    124, 129, 133, 138, 142, 151, 158, 166, 174, 181, 8, 15, 22, 36, 44, 52, 59, 68, 75, 88, 99, 113, 127][i]!;
  const listed = new Date(Date.UTC(2026, 8, 9) - age * 86_400_000).toISOString();
  const price = 22000 + (i % 7) * 4200;
  /* Older units carry less margin, which is the shape the scatter is
     drawn to show. Three have no cost at all: the stock list does not
     always carry one, and they must not plot as pure profit. */
  const thin = age > 120;
  return {
    id: `t${i}`,
    stc_no: `STC${142000 + i}`,
    make: ['Krone', 'SDC', 'Montracon', 'Schmitz'][i % 4]!,
    model: ['Curtainsider', 'Flatbed', 'Box', 'Skeletal'][i % 4]!,
    category: 'Curtainsider',
    status: 'in_stock',
    location: ['Carrington', 'Hyde', 'Haydock'][i % 3]!,
    retail_price: price,
    sales_price: null,
    total_nbv: i % 14 === 0 ? null : Math.round(price * (thin ? 0.95 : 0.78 + (i % 5) * 0.02)),
    nbv: null,
    created_at: listed,
    order_date: null,
  };
});

const CONTRACTS: ContractRow[] = Array.from({ length: 104 }, (_, i) => {
  const month = (i % 9) + 1;
  const plan = i % 10 < 3 ? 'Silver' : i % 10 < 8 ? 'Gold' : 'Platinum';
  const annual = plan === 'Silver' ? 2470 : plan === 'Gold' ? 5010 : 5320;
  /* Eight did not survive. Two lapsed out of the January cohort, which
     is what makes the retention grid say something. */
  const dead = i % 13 === 0 && month <= 2;
  return {
    id: `c${i}`,
    plan,
    status: dead ? 'expired' : i % 11 === 0 ? 'sent' : 'accepted',
    monthly_total: Math.round(annual / 12),
    annual_total: annual,
    starts_on: `2026-${String(month).padStart(2, '0')}-01`,
    created_at: `2026-${String(month).padStart(2, '0')}-01T00:00:00Z`,
    decided_at: dead ? `2026-0${Math.min(9, month + 3)}-01T00:00:00Z` : null,
  };
});

function sample() {
  const divisions = divisionRows(WINDOW);
  const people = peopleRows(LEADS, NAMES, period);
  const stock = stockUnits(TRAILERS, TODAY);
  const book = contractBook(CONTRACTS, period);
  return {
    period,
    generatedAt: new Date().toISOString(),
    verdict: verdictSentence(divisions, period),
    decisions: decisionsFrom({ divisions, stock, people, book }),
    headline: headlineFigures({ divisions, people, book, period }),
    divisions,
    months: monthPoints(MONTH_ROWS, TARGETS),
    people,
    sources: sourceFlows(LEADS, period),
    stock,
    book,
    customers: [
      { name: 'Culina Logistics', revenue: 184200, was: 151000, division: 'stc' as const },
      { name: 'Wincanton', revenue: 142900, was: 148300, division: 'stc' as const },
      { name: 'Gregory Distribution', revenue: 96400, was: 61200, division: 'stc' as const },
      { name: 'TIP Trailer Services', revenue: 71800, was: 0, division: 'rental' as const },
      { name: 'Dawson Group', revenue: 64100, was: 70900, division: 'stc' as const },
      { name: 'Booker', revenue: 51300, was: 44100, division: 'rental' as const },
    ],
    notWired: [
      {
        what: 'Rentals utilisation and the per asset hire timeline',
        why: 'Rentals reaches this application as invoices out of Sage and nothing else. There is '
          + 'no record here of which trailers are on the hire fleet or which days each one was out, '
          + 'so utilisation, idle days and the timeline cannot be worked out.',
        needs: 'A hire fleet and a hire booking per asset, imported the way the invoices already '
          + 'are. Everything else on the rentals side is drawn from the invoices and is live.',
      },
      {
        what: 'A group gross margin',
        why: 'Only trailer sales records what a thing cost. STC invoices and rental invoices carry '
          + 'a net figure and no cost, so a margin across the group would be a trailer margin with '
          + 'two thirds of the revenue quietly left out of the denominator.',
        needs: 'A cost or a labour recovery figure against Protean jobs. Trailer margin is real '
          + 'and is shown on its own.',
      },
    ],
    bands: ageingBands(stock),
  };
}

/* The hub asks the API on mount, so the answer is installed before the
   module that renders it is evaluated. Nothing in the component is
   branched or stubbed: it makes the same request it makes in
   production and this answers it. */
if (typeof window !== 'undefined' && !(window as any).__analyticsPreview) {
  (window as any).__analyticsPreview = true;
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    /* The targets screen reads and writes its own route. Answered
       here so the harness shows the grid with figures in it rather
       than the alert, and a save round trips without a database. */
    if (url.includes('/api/analytics/target')) {
      if ((init?.method ?? 'GET') !== 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      const fy = Number(TODAY.slice(0, 4)) - (Number(TODAY.slice(5, 7)) >= 4 ? 0 : 1);
      const targets = Array.from({ length: 12 }, (_, i) => {
        const month = new Date(Date.UTC(fy, 3 + i, 1)).toISOString().slice(0, 10);
        return [
          { month, division: null, target: 2020000 },
          { month, division: 'stc', target: 1250000 },
          { month, division: 'trailer', target: 560000 },
          { month, division: 'rental', target: 210000 },
        ];
      }).flat();
      return Promise.resolve(new Response(JSON.stringify({ targets }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url.includes('/api/analytics')) {
      return Promise.resolve(new Response(JSON.stringify(sample()), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

/* Which screen the harness is showing.

   Analytics is a landing and seven screens now, and the harness only
   ever mounted the landing. A drill-down that nothing could render was
   a drill-down nothing could measure, so `check:kit-diff` had an empty
   list of ported devices and reported success on a page it had never
   seen. `?screen=revenue` and the rest mount the real drill-down
   component, fed by the same fixture through the same fetch. */
const SCREENS: Record<string, (p: { today: string }) => JSX.Element> = {
  targets: TargetsBoard,
  revenue: RevenueDrillDown,
  pipeline: PipelineDrillDown,
  people: PeopleDrillDown,
  stock: StockDrillDown,
  fleetsmart: FleetSmartDrillDown,
  customers: CustomersDrillDown,
};

export default function AnalyticsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  /* Read through the router rather than off `window`, so the server
     and the browser agree on the first render. Reading
     `window.location` here made every drill-down a hydration
     mismatch, and React then threw the server tree away and redrew,
     which is a page measured after a repaint. */
  const screen = useSearchParams().get('screen') ?? '';
  const Drill = SCREENS[screen];
  if (Drill) {
    return (
      <div className="kit" style={{ padding: '24px 28px 56px', maxWidth: 1800 }}>
        <Drill today={TODAY} />
      </div>
    );
  }
  return (
    /* The same box the dashboard gives a page: `.content__inner` in
       globals.css is 24px 28px inside an 1800px cap. Kept at 1800 on
       purpose, because the hub caps ITSELF at the kit's 1440 and this
       harness has to show that happening rather than hide it behind a
       narrower wrapper. */
    <div className="kit" style={{ padding: '24px 28px 56px', maxWidth: 1800 }}>
      <AnalyticsHub today={TODAY} />
    </div>
  );
}
