'use client';

import { Leaderboard } from '@/components/analytics/kit/leaderboard';

/* =============================================================
   The portfolio's customer table, with figures and without a database.

   The same harness the tracker, the analytics hub and the reports hub
   have, and for the reason this repository learned the hard way: a
   layout measured on a rebuilt copy is a guess dressed as a
   measurement. So this mounts the REAL component, in the real content
   box, with the rows that were on the screen when the business
   reported the fault:

     75% blank room on the rows which is a banned primitive, and none
     of it was used for the extra column and instead you just made the
     other columns smaller.

   `npm run check:portfolio-table` drives this page in a browser and
   asserts that the row has no gap in it and that nothing wraps.

   Never in production.
   ============================================================= */

const ROWS = [
  { name: 'Suttle Transport', sub: '4 invoices · last billed 07 Sept 26',
    badge: 'Rentals', thisYear: 1000, lastYear: 0, open: 385000, pct: null },
  { name: 'Brenntag UK LTD', sub: 'Nothing billed yet',
    badge: undefined, thisYear: 0, lastYear: 0, open: 225000, pct: null },
  { name: 'Redbridge Produce & Flowers Ltd T/A Dole Foodservice',
    sub: '112 invoices · last billed 18 Sept 26',
    badge: 'STC', thisYear: 87000, lastYear: 72000, open: 105000, pct: 19.6 },
  { name: 'Davies Turner', sub: '57 invoices · last billed 18 Sept 26',
    badge: 'STC', thisYear: 40000, lastYear: 43000, open: 76000, pct: -7.3 },
  { name: 'Barton & Redman Ltd', sub: '14 invoices · last billed 16 Sept 26',
    badge: 'STC', thisYear: 7000, lastYear: 1000, open: 76000, pct: 487 },
  { name: 'Lloyds Transport Ltd', sub: 'Nothing billed yet',
    badge: undefined, thisYear: 0, lastYear: 0, open: 43000, pct: null },
  { name: 'Cave Direct', sub: '31 invoices · last billed 17 Sept 26',
    badge: 'STC', thisYear: 14000, lastYear: 0, open: 37000, pct: null },
  { name: 'PMCE Ltd', sub: 'Nothing billed yet',
    badge: undefined, thisYear: 0, lastYear: 0, open: 36000, pct: null },
  { name: 'Novuna', sub: '86 invoices · last billed 18 Sept 26',
    badge: 'STC', thisYear: 60000, lastYear: 56000, open: 29000, pct: 8.3 },
  { name: 'A.C.S. Construction (North West) Limited', sub: '9 invoices · last billed 02 Sept 26',
    badge: 'Trailer sales', thisYear: 22000, lastYear: 31000, open: 12000, pct: -29.0 },
];

const NOTHING = '—';

const compact = (n: number) => {
  if (!n) return '£0';
  const k = Math.round(n / 1000);
  return k >= 1 ? `£${k}k` : `£${Math.round(n)}`;
};

const initialsOf = (name: string) => name
  .replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join('') || '?';

export default function Page() {
  const widest = ROWS.reduce((m, r) => Math.max(m, r.thisYear), 0);

  return (
    <div className="kit" style={{ padding: '18px 24px 40px', maxWidth: 1480, margin: '0 auto' }}>
      <Leaderboard
        title="Customers"
        legend="This year, against the biggest on the list"
        sort={<span>Open pipeline value, highest first</span>}
        rows={ROWS.map((r) => ({
          key: r.name,
          name: r.name,
          sub: r.sub,
          initials: initialsOf(r.name),
          badge: r.badge,
          bar: widest ? r.thisYear / widest : 0,
          figures: [compact(r.lastYear), r.open ? compact(r.open) : NOTHING],
          headline: compact(r.thisYear),
          delta: r.pct == null ? undefined
            : { text: `${r.pct > 0 ? '+' : '\u2212'}${Math.abs(r.pct)}%`, up: r.pct > 0 },
          onClick: () => {},
        }))}
        total={{
          label: `Showing ${ROWS.length} of 257`,
          figures: [
            compact(ROWS.reduce((t, r) => t + r.lastYear, 0)),
            compact(ROWS.reduce((t, r) => t + r.open, 0)),
          ],
          headline: compact(ROWS.reduce((t, r) => t + r.thisYear, 0)),
        }}
      />
    </div>
  );
}
