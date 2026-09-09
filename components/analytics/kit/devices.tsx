'use client';

import { useRef, useState } from 'react';
import { KIT_COLOURS } from '@/lib/analytics/kit.generated';
import { HUE } from './charts';
import { Readout, shortMoney } from './frame';
import { DeviceFrame, device, mirror, type KitNode, type Patch } from './mirror';

/* =============================================================
   The kit's charts, drawn with our numbers in them.

   ---- Why these exist alongside `charts.tsx` ----

   The charts in `charts.tsx` were recreated from a reading of
   `docs/source/STCUIAnalytics.html`. Two things about the file did not
   survive that trip, and both of them are what the business reported
   after the restructure:

     The charts you resized from full row to one column, you made the
     text too small to read. some have like 3px fonts that are
     impossible.

     Revenue page for example, one chart starts further down the page
     than the other and its div is a different size to the chart div
     next to it. The brand kit forces you to keep them uniform which
     was ignored.

   The file answers both, and neither answer is a matter of taste.

   1. THERE IS NO TEXT INSIDE A KIT CHART. Not one text element in any
      of its seven charts. Every axis tick, every annotation and every
      bar label is HTML sitting around the SVG. That is what lets the
      drawing stretch: the kit sets preserveAspectRatio to none and
      every stroke to non-scaling, so the shape fills the column while
      strokes stay one pixel and type stays the size it was set at.
      Our charts drew their labels as SVG text inside a viewBox, so
      halving the column halved the type, and a 10px label in a 556px
      column came out at five and a half.

   2. A CHART IS A DEVICE, AND A DEVICE CARRIES ITS OWN LABEL. The kit
      draws one as a flex column with an 11px gap: a title block, then
      the panel. Two of those side by side are two identical structures
      and line up. Ours had the label written separately above each
      panel, so a two line label on the left and a one line label on
      the right pushed one chart down and left the panels different
      heights.

   ---- The four pieces of writing a device carries ----

   The kit gives each one two headings, not one, and they say different
   things. `label` and `sub` sit above the panel and describe the
   DEVICE: what kind of chart this is and how to read it. `title` and
   `says` sit inside it and describe THIS DATA: the period, and the
   conclusion in a sentence. `foot` is the line under the rule.

   ---- What this file may contain ----

   Nothing. Every style string, every stroke, every dash pattern and
   every proportion below comes out of `kit.generated.ts`, which is
   read from the file by a browser. The only numbers computed here are
   the positions of OUR data on the kit's own axes, which is the one
   thing a port has to do.
   ============================================================= */

/* -------------------------------------------------------------
   The kit's colours, on a ground the kit never saw

   The file is a light design and writes its data colours as literal
   hexes. This application has a dark theme too, and #09163A on the
   dark ground is a navy bar on a navy page: the waterfall's two end
   columns and the STC line in the legend were both drawn and both
   invisible.

   `app/kit-tokens.css` already holds the answer and holds it for the
   same reason in reverse, after "the bottom bar graph is blinding": a
   data colour is its own axis and gets a value on each ground, so a
   division is the same series in both themes.

   So the mapping is from the kit's own legend, which names each hex,
   to the token for that series. It is not a choice: `KIT_COLOURS` is
   read out of the file and says which swatch is STC, which is trailer
   sales and which is rentals.

   ---- Not every navy in the file is a division ----

   The waterfall's two ends are navy-900 and a rise is navy-500, and
   neither is STC or trailer sales: they are the group total and the
   direction of a change. Mapping them through the division table
   above drew STC's £186k in the trailer sales green, which is a
   different sentence about the business. So the waterfall has its own
   pair, `--chart-total` and `--chart-rise`, defined in
   `app/kit-tokens.css` for both grounds.
   ------------------------------------------------------------- */
const DIVISION: Record<string, string> = {
  [KIT_COLOURS.STC.toLowerCase()]: HUE.stc,
  [KIT_COLOURS['Trailer sales'].toLowerCase()]: HUE.trailer,
  [KIT_COLOURS.Rentals.toLowerCase()]: HUE.rental,
};

/* The waterfall's structural navies, which are about the group and
   about direction rather than about a division. */
const STRUCTURE: Record<string, string> = {
  'var(--navy-900)': 'var(--chart-total)',
  [KIT_COLOURS['Trailer sales'].toLowerCase()]: 'var(--chart-rise)',
};

function swap(table: Record<string, string>) {
  return (value: string): string => {
    const direct = table[value.trim().toLowerCase()];
    if (direct) return direct;
    return value.replace(/#[0-9A-Fa-f]{6}/g, (hex) => table[hex.toLowerCase()] ?? hex);
  };
}

/** Swap a kit colour for this application's token for that series. */
export const themed = swap(DIVISION);

/** The same, for a device whose navies mean the group and not a division. */
export const themedStructure = swap(STRUCTURE);

/** The drawing box the kit gave this device, as numbers. */
function boxOf(svg: KitNode): { w: number; h: number } {
  const [, , w, h] = (svg.viewBox ?? '').split(/\s+/).map(Number);
  return { w: w || 0, h: h || 0 };
}

const geom = (n: KitNode | undefined, key: string) => Number(n?.geom?.[key] ?? 0);

/* -------------------------------------------------------------
   Pointing at a chart

   The kit is a static file. It has no hover targets in it, so a port
   that only ever mirrors mirrors the absence too, and that is exactly
   what happened: the readout on the indexed trend and the waterfall
   went when those two devices were ported.

   The layer is added rather than drawn. It covers the plot, carries no
   colour and no size of its own, and reports which slot the pointer is
   over as a fraction of the width. Everything visible still comes out
   of the file.
   ------------------------------------------------------------- */
function useHover(slots: number) {
  const [at, setAt] = useState<{ i: number; x: number; w: number; h: number } | null>(null);

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || slots <= 0) return;
    const t = (e.clientX - r.left) / r.width;
    const i = Math.min(slots - 1, Math.max(0, Math.round(t * (slots - 1))));
    setAt({ i, x: e.clientX - r.left, w: r.width, h: r.height });
  };

  /* The sheet itself. No colour, no length and no weight: it covers
     the plot it is dropped into and does nothing else. */
  const layer = (
    <div
      onMouseMove={onMove}
      onMouseLeave={() => setAt(null)}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
    />
  );

  return { at, layer };
}

/* -------------------------------------------------------------
   Indexed division trend

   Five rules, one of them solid where 100 falls, three lines, an
   annotation on the 100 rule and a month strip underneath. The
   annotation and the strip are HTML in the file and HTML here.
   ------------------------------------------------------------- */
export function IndexedTrend({ points, label, sub, title, says, foot }: {
  points: { month: string; stc: number; trailer: number; rental: number }[];
  label: string;
  sub: string;
  title: string;
  says: string;
  foot: string;
}) {
  const node = device('indexed');
  const hover = useHover(points.length);
  const plot = node.kids?.[1];
  const svg = plot?.kids?.[0];
  if (!plot || !svg || points.length === 0) return null;

  const { w, h } = boxOf(svg);
  const kids = svg.kids ?? [];
  const lines = kids.filter((k) => k.tag === 'line');
  const series = kids.filter((k) => k.tag === 'polyline');
  /* The kit's own two rules: a dashed one for the grid, and the one it
     draws solid and heavier for the line everything is read against. */
  const dashed = lines.find((l) => l.attrs?.['stroke-dasharray']) ?? lines[0];
  const solid = lines.find((l) => !l.attrs?.['stroke-dasharray']) ?? lines[0];
  if (!dashed || !solid || series.length < 3) return null;

  const all = points.flatMap((p) => [p.stc, p.trailer, p.rental]).concat(100);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const y = (v: number) => ((hi - v) / span) * h;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;

  /* The kit draws its lines back to front, palest first and heaviest
     last, so the division that carries the business sits on top. Its
     order is rentals, trailer sales, STC. */
  const ORDER = ['rental', 'trailer', 'stc'] as const;

  return (
    <DeviceFrame of="indexed" title={label} sub={sub}>
      {mirror(node, {
        recolour: themed,
        kids: [
          /* Panel head: this period's title and the sentence about
             this data. The legend beside it is the kit's own and
             already names the three divisions, so it is untouched. */
          { kids: [{ kids: [{ text: title }, { text: says }] }, {}] },
          {
            kids: [
              {
                kids: [
                  ...Array.from({ length: lines.length }, (_, i) => {
                    const yy = (i / Math.max(1, lines.length - 1)) * h;
                    return {
                      from: kids.indexOf(dashed),
                      attrs: { x1: 0, x2: w, y1: yy, y2: yy },
                    };
                  }),
                  /* And the rule that means "no change", where 100
                     actually falls for this data rather than where it
                     fell for the kit's. */
                  {
                    from: kids.indexOf(solid),
                    attrs: { x1: 0, x2: w, y1: y(100), y2: y(100) },
                  },
                  ...ORDER.map((k, i) => ({
                    from: kids.indexOf(series[i]!),
                    attrs: {
                      points: points.map((p, j) => `${x(j).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' '),
                      stroke: HUE[k],
                    },
                  })),
                ],
              },
              /* The annotation goes on the 100 rule, wherever that is.
                 Only `top` moves. Its offset, its size and its backing
                 plate are the file's. */
              { style: (s) => s.replace(/top:[^;]+/, `top:${((y(100) / h) * 100).toFixed(1)}%`) },
            ],
            /* The hover layer, over the kit's own plot. Added rather
               than drawn: the file has no hover targets in it, and a
               port that only mirrors loses the readout with them. */
            after: (
              <>
                {hover.layer}
                {hover.at && points[hover.at.i] && (
                  <Readout
                    x={hover.at.x}
                    y={0}
                    bounds={{ w: hover.at.w, h: hover.at.h }}
                    title={monthName(points[hover.at.i]!.month)}
                    value={`STC ${Math.round(points[hover.at.i]!.stc)}`}
                    made={`Trailer sales ${Math.round(points[hover.at.i]!.trailer)} `
                      + `· Rentals ${Math.round(points[hover.at.i]!.rental)}`}
                  />
                )}
              </>
            ),
          },
          /* The month strip, in HTML, one initial per month. */
          { kids: points.map((p) => ({ from: 0, text: monthInitial(p.month) })) },
          { kids: [{ text: foot }] },
        ],
      })}
    </DeviceFrame>
  );
}

function monthName(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthInitial(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
    .slice(0, 1);
}

/* -------------------------------------------------------------
   How the group number moved

   Five slots: the opening figure, one per division, the closing
   figure. The middle bars float, and a dashed connector carries the
   running total across each gap.

   A bar is 69.4 wide in a 124 slot in the file, and that proportion is
   a decision about the chart rather than a fact about August, so it is
   read off the file's own rectangles instead of chosen.
   ------------------------------------------------------------- */
export function GroupMovement({ start, steps, end, label, sub, title, says }: {
  start: { label: string; value: number };
  steps: { label: string; delta: number }[];
  end: { label: string; value: number };
  label: string;
  sub: string;
  title: string;
  says: string;
}) {
  const node = device('waterfall');
  const hover = useHover(steps.length + 2);
  const plot = node.kids?.[1];
  const svg = plot?.kids?.[0];
  const strip = plot?.kids?.[1];
  if (!plot || !svg || !strip) return null;

  const kids = svg.kids ?? [];
  const { w, h } = boxOf(svg);
  const connector = kids.find((k) => k.tag === 'line');
  const rects = kids.filter((k) => k.tag === 'rect');
  /* Three bar variants in the file: the two ends in navy, a rise, and
     a fall in the danger colour. Which is which is read off the fill
     rather than assumed from position. */
  const terminal = rects[0];
  const fall = rects.find((r) => (r.attrs?.fill ?? '').includes('danger'));
  const rise = rects.find((r) => r !== terminal && r !== fall
    && (r.attrs?.fill ?? '') !== (terminal?.attrs?.fill ?? ''));
  if (!connector || !terminal || !rise || !fall) return null;

  /* Which of the strip's columns carries which kind of figure. The
     kit writes a total and a movement differently: one is bold and in
     `--text`, the other is signed and coloured. Both are in the file,
     so the right one is cloned rather than a colour being picked. */
  const stripKids = strip.kids ?? [];
  const columnFor = (kind: 'end' | 'up' | 'down') => {
    const at = stripKids.findIndex((c) => {
      const figure = c.kids?.[1]?.style ?? '';
      if (kind === 'end') return figure.includes('var(--text)');
      if (kind === 'up') return figure.includes('var(--success)');
      return figure.includes('var(--danger)');
    });
    return at < 0 ? 0 : at;
  };

  const slot = w / rects.length;
  const barW = geom(terminal, 'width');
  const inset = geom(terminal, 'x');

  const columns = [
    { label: start.label, value: start.value, kind: 'end' as const },
    ...steps.map((s) => ({
      label: s.label,
      value: s.delta,
      kind: (s.delta >= 0 ? 'up' : 'down') as 'up' | 'down',
    })),
    { label: end.label, value: end.value, kind: 'end' as const },
  ];

  /* Running totals, so a middle bar floats where the last one left
     off. The scale reaches everywhere the total passes through, not
     just its two ends: a division that takes the running total below
     the opening figure still has to have somewhere to be drawn. */
  const running: number[] = [];
  let at = start.value;
  for (const s of steps) { running.push(at); at += s.delta; }
  const top = Math.max(start.value, end.value, ...running,
    ...running.map((r, i) => r + (steps[i]?.delta ?? 0)));
  const y = (v: number) => ((top - v) / Math.max(1, top)) * h;

  const bars = columns.map((c, i) => {
    const left = i * slot + inset;
    if (c.kind === 'end') {
      return {
        from: kids.indexOf(terminal),
        attrs: { x: left, width: barW, y: y(c.value), height: Math.max(1, h - y(c.value)) },
      };
    }
    const base = running[i - 1] ?? 0;
    const hiEnd = Math.max(base, base + c.value);
    const loEnd = Math.min(base, base + c.value);
    return {
      from: kids.indexOf(c.kind === 'up' ? rise : fall),
      attrs: { x: left, width: barW, y: y(hiEnd), height: Math.max(1, y(loEnd) - y(hiEnd)) },
    };
  });

  const joins = columns.slice(0, -1).map((_, i) => {
    const after = i === 0 ? start.value : (running[i - 1] ?? 0) + (steps[i - 1]?.delta ?? 0);
    return {
      from: kids.indexOf(connector),
      attrs: {
        x1: i * slot + inset + barW,
        x2: (i + 1) * slot + inset,
        y1: y(after), y2: y(after),
      },
    };
  });

  const thousands = (n: number) => `${Math.round(n / 1000)}k`;

  return (
    <DeviceFrame of="waterfall" title={label} sub={sub}>
      {mirror(node, {
        recolour: themedStructure,
        kids: [
          { kids: [{ text: title }, { text: says }] },
          {
            /* The plot has no `position` in the kit, because the file
               puts nothing over it. A readout has to be placed against
               something, so the wrapper is made a positioning context.
               That is a transform of the kit's string, adding the one
               declaration an interaction needs and moving none of the
               ones the design wrote. */
            style: (css: string) => `${css};position:relative`,
            after: (
              <>
                {hover.layer}
                {hover.at && columns[hover.at.i] && (
                  <Readout
                    x={hover.at.x}
                    y={0}
                    bounds={{ w: hover.at.w, h: hover.at.h }}
                    title={columns[hover.at.i]!.label}
                    value={columns[hover.at.i]!.kind === 'end'
                      ? shortMoney(columns[hover.at.i]!.value)
                      : `${columns[hover.at.i]!.value >= 0 ? '+' : '-'}`
                        + shortMoney(Math.abs(columns[hover.at.i]!.value))}
                    made={columns[hover.at.i]!.kind === 'end'
                      ? 'The group total for this window'
                      : 'This division\u2019s contribution to the change'}
                  />
                )}
              </>
            ),
            kids: [
              { kids: [...joins, ...bars] },
              {
                kids: columns.map((c) => ({
                  from: columnFor(c.kind),
                  kids: [
                    { text: c.label },
                    {
                      text: c.kind === 'end'
                        ? `£${thousands(c.value)}`
                        : `${c.value >= 0 ? '+' : '-'}${thousands(Math.abs(c.value))}`,
                    },
                  ],
                })),
              },
            ],
          },
        ],
      })}
    </DeviceFrame>
  );
}

/* Kept so a caller can ask for the kit's own drawing height without
   reading the generated file itself. */
export function heightOf(key: 'indexed' | 'waterfall'): number {
  const node = device(key);
  const svg = node.kids?.[1]?.kids?.[0];
  return svg ? boxOf(svg).h : 0;
}

export type { Patch };

/* -------------------------------------------------------------
   Revenue against target, by division

   The kit's bullet rows: a bar per division with the target as a red
   notch, so hitting or missing is a position rather than a sum to work
   out. The notch is the only red on the chart, which is what makes a
   miss read instantly.

   This device was built months ago and then rendered nowhere. The
   Revenue drill-down's own line says "and the target position behind
   it" and there was no target on the page, which is the plainest
   version of "some charts look empty where I feel data should be".

   The kit sets Panton on the two figure columns here. It stays: the
   instruction to move figures to Inter was about the tables composed
   for the landing, and this is a device the file itself draws.
   ------------------------------------------------------------- */
export function AgainstTarget({ rows, group, label, sub, title, onPick }: {
  rows: { key: string; name: string; value: number; target: number | null; colour: string }[];
  /** The line under the rule: the group total and what it says. */
  group: { total: number; variance: number | null; says: string };
  label: string;
  sub: string;
  title: string;
  onPick?: (key: string) => void;
}) {
  const node = device('bullet');
  const kids = node.kids ?? [];
  const sample = kids.find((k) => (k.style ?? '').startsWith('display:flex;align-items:center;gap:'));
  const foot = kids[kids.length - 1];
  if (!sample || !foot || rows.length === 0) return null;

  const track = sample.kids?.[1];
  const fill = track?.kids?.[0];
  const notch = track?.kids?.[1];
  if (!fill || !notch) return null;

  /* One scale for every row, so the bars are comparable. The kit's own
     rows share one: its 80.3% and 43.9% are against the same top. */
  const top = Math.max(1, ...rows.map((r) => Math.max(r.value, r.target ?? 0)));
  const at = (v: number) => `${((v / top) * 100).toFixed(1)}%`;

  const money = (n: number) => `£${Math.round(Math.abs(n) / 1000)}k`;
  const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(n)}`;

  const rowPatch = (r: typeof rows[number]) => {
    const variance = r.target == null ? null : r.value - r.target;
    return {
      from: kids.indexOf(sample),
      on: onPick ? { click: () => onPick(r.key) } : undefined,
      /* A row that narrows the whole page has to say so before it is
         clicked. One declaration added to the kit's own row, and only
         where there is something to click. */
      style: onPick ? (css: string) => `${css};cursor:pointer` : undefined,
      title: onPick ? `Narrow the page to ${r.name}` : undefined,
      kids: [
        { text: r.name },
        {
          kids: [
            { style: (css: string) => css
              .replace(/width:[^;]+/, `width:${at(r.value)}`)
              .replace(/background:[^;]+/, `background:${r.colour}`) },
            /* No target, no notch. A notch at nought would read as a
               target of nothing, which is a statement nobody made. */
            r.target == null
              ? { drop: true }
              : { style: (css: string) => css.replace(/left:[^;]+/, `left:${at(r.target ?? 0)}`) },
          ],
        },
        { text: money(r.value) },
        {
          text: variance == null ? '' : signed(variance),
          style: (css: string) => (variance == null || variance >= 0
            ? css
            : css.replace(/color:[^;]+/, 'color:var(--danger)')),
        },
      ],
    };
  };

  return (
    <DeviceFrame of="bullet" title={label} sub={sub}>
      {mirror(node, {
        recolour: themed,
        kids: [
          /* Head: our title, the kit's own "target" key beside it. */
          { kids: [{ text: title }, {}] },
          ...rows.map(rowPatch),
          {
            from: kids.indexOf(foot),
            kids: [
              {},
              { text: group.says },
              { text: money(group.total) },
              {
                text: group.variance == null ? '' : signed(group.variance),
                style: (css: string) => (group.variance == null || group.variance >= 0
                  ? css
                  : css.replace(/color:[^;]+/, 'color:var(--danger)')),
              },
            ],
          },
        ],
      })}
    </DeviceFrame>
  );
}
