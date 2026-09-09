'use client';

import { KIT_RAMPS } from '@/lib/analytics/kit.generated';
import { device, find, mirror, type Patch } from './mirror';

/* =============================================================
   Contract retention by start month.

   The kit's own markup, with our rows in it. Nothing here sets a
   length, a colour or a weight: every style string comes out of
   `docs/source/STCUIAnalytics.html` through `kit.generated.ts`, and the
   only edits are the words and, on a heat cell, the alpha.

   ---- What the previous version got wrong ----

   It was written from a reading of the kit rather than from the kit,
   and differed from it in nineteen places: a table instead of flex
   rows, 46px columns instead of flex, 26px rows instead of 30, 11.5px
   cell text instead of 10.5, a colour mix instead of alpha on navy,
   uppercase headers at .12em instead of the file's .06em, five legend
   swatches with gaps instead of six touching, and a heat scale
   normalised to the data instead of the file's fixed 70 to 100.

   That last one was not merely different, it inverted: on a book with
   one cohort the floor equalled 100, so the best possible retention
   rendered as the palest cell on the grid and both legend labels read
   100%.

   ---- The scale ----

   `KIT_RAMPS.cohort` is read off the legend swatches in the file:
   six stops from 0.15 to 1, labelled 70 to 100. So a cell's alpha is
   the value's position on that fixed scale, which is what the kit
   draws and what makes a dark cell mean the same thing on every grid.
   ============================================================= */

const RAMP = KIT_RAMPS.cohort;

/** The month, in the words the kit uses for it. */
function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/** Where a retention figure sits on the kit's own scale. */
function alphaFor(value: number): number {
  const lo = RAMP.from ?? 0;
  const hi = RAMP.to ?? 100;
  const first = RAMP.stops[0] ?? 0;
  const last = RAMP.stops[RAMP.stops.length - 1] ?? 1;
  const t = Math.min(1, Math.max(0, (value - lo) / Math.max(1, hi - lo)));
  return first + t * (last - first);
}

/** Swap the alpha in the kit's own rgba, leaving every other declaration alone. */
const withAlpha = (a: number) => (css: string) =>
  css.replace(/rgba\(([\d,\s]+),\s*[\d.]+\)/, `rgba($1,${a.toFixed(2)})`);

export function CohortGrid({ cohorts, says }: {
  cohorts: { month: string; signed: number; live: (number | null)[] }[];
  says: string;
}) {
  const node = device('cohort');

  /* The three cell variants the kit draws, borrowed from the file
     rather than described. A filled cell is any heat cell; a dashed
     one is a month that has not happened yet. */
  const grid = node.kids?.[1];
  const headerRow = grid?.kids?.[0];
  const sampleRow = grid?.kids?.[1];
  const dashed = grid ? find(grid, (s) => s.includes('dashed')) : null;

  if (!grid || !headerRow || !sampleRow) return null;

  /* How many month columns the kit's own header carries, so a row can
     never be wider than the header it sits under. */
  const kitMonths = (headerRow.kids?.length ?? 2) - 2;
  const months = Math.min(kitMonths, Math.max(0, ...cohorts.map((c) => c.live.length)));

  const headerPatch: Patch = {
    from: 0,
    kids: [
      {},
      {},
      ...Array.from({ length: months }, (_, i) => ({ from: 2, text: `M${i}` })),
    ],
  };

  const rowPatch = (c: { month: string; signed: number; live: (number | null)[] }): Patch => ({
    from: 1,
    kids: [
      /* "January", the way the kit writes it, not the ISO date the
         database stores. The port dropped this and the grid shipped
         with 2026-01-01 down its left edge. */
      { text: monthLabel(c.month) },
      { text: c.signed },
      ...Array.from({ length: months }, (_, i) => {
        const v = c.live[i];
        if (v == null) {
          /* The kit's own dashed cell, cloned wholesale. Its index in
             the sample row does not matter: `slot` empties it and the
             style is taken from the file's dashed variant. */
          return dashed
            ? { from: 2, style: () => dashed.style ?? '', slot: null }
            : { from: 2, slot: null, style: (s: string) => s.replace(/background:[^;]+;?/, '') };
        }
        return { from: 2, text: v, style: withAlpha(alphaFor(v)) };
      }),
    ],
  });

  return mirror(node, {
    kids: [
      /* Title block: the kit's title stays, the sentence under it is
         about this business's data. */
      { kids: [{}, { text: says }] },
      /* The grid: the kit's header, then one of the kit's rows per
         cohort we actually have. */
      { kids: [headerPatch, ...cohorts.map(rowPatch)] },
      /* Footnote and scale, exactly as the kit draws them. */
      {},
    ],
  });
}
