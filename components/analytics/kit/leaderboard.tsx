'use client';

import type { ReactNode } from 'react';
import { themed } from './devices';
import { device, mirror, type KitNode, type Patch } from './mirror';

/* =============================================================
   The kit's leaderboard, with our rows in it.

   ---- Why this file exists ----

   From the business, about the portfolio's customer table:

     extremely buggy UI here on Customers on this portfolio which again
     proves you've completed ditched the analytics UI kit I built you
     and just vibing it doing whatever. 75% blank room on the rows
     which is a banned primitive, and none of it was used for the extra
     column and instead you just made the other columns smaller. We
     don't design this way, we have rules for a reason.

   All three complaints are one fault. That table was a flex row with
   `flex:1` on the name and fixed pixel widths on the numbers, so on a
   wide screen the name cell absorbed every spare pixel and the figures
   were crushed into 78px each at the far right. Adding the Open column
   took its width off the others because there was nowhere else for it
   to come from.

   The kit already answers this and the answer was never read. Its
   `leaderboard` device is a list of names with numbers against them,
   and the spare width in its row goes to a 22px progression BAR, not
   to whitespace. That is the rule: the middle of a row carries a
   reading of the figures, so there is no blank to distribute.

   ---- What this file may contain ----

   Nothing. Not a length, not a colour, not a weight, not a gap. Every
   style string below is read out of `kit.generated.ts`, which a
   browser produced from `docs/source/STCUIAnalytics.html`. The only
   numbers computed here are where OUR values fall on the kit's own
   bar, which is the one thing a port has to do.

   `npm run check:invention` holds this file at nought.

   ---- The one transform, and it was asked for ----

   The kit's name cell is `flex:none;width:104px` because in the file
   it holds "Dean Mann". A customer is "Redbridge Produce & Flowers Ltd
   T/A Dole Foodservice". Asked which they wanted, the business chose:

     Name takes the free space, bar keeps flex:1

   so the name cell's `flex:none;width:104px` becomes `flex:1` and the
   row's spare width splits between the name and the bar. `flex:1` is
   the kit's own declaration, taken from the bar beside it. No value is
   introduced.

   ---- Why the row is cloned rather than built ----

   The kit draws five rows and they are not identical: row 1 has no top
   rule, rows 2 and 3 carry a rise and a fall with the right arrow and
   the right token on each, and the badge on each row is already the
   colour of that division. So a row that rises clones the kit's rising
   row and a row that falls clones its falling one, and the arrow, the
   colour and the rule all come across without being named here.
   ============================================================= */

/* Which of the kit's own rows to wear.

   ROW_FIRST has no top rule and opens the list. ROW_UP and ROW_DOWN
   carry the rule, and between them the kit's success and danger
   treatments with the matching arrow. TOTAL is the kit's own footing
   row, which is where a portfolio's totals belong. */
const ROW_FIRST = 1;
const ROW_UP = 2;
const ROW_DOWN = 3;
const TOTAL = 6;

/* Inside a row, which child is which. Read off the kit's markup and
   named here so that nothing below indexes by a bare number. */
const RANK = 0;
const AVATAR = 1;
const NAME = 2;
const BADGE = 3;
const BAR = 4;
const FIGURES = 5;
const HEADLINE = 6;
const DELTA = 7;

/* Inside the header. */
const HEAD_TITLE = 0;
const HEAD_LEGEND = 1;
const HEAD_SORT = 2;

export type LeaderRow = {
  key: string;
  /** The name, and the line of detail under it. */
  name: string;
  sub: string;
  /** Two letters for the kit's round chip. */
  initials: string;
  /** The pill, and nothing drawn where there is nothing to say. */
  badge?: string;
  /**
   * How far along the kit's bar this row sits, 0 to 1 of the widest
   * row in the list.
   *
   * ONE FILL, NOT THE KIT'S THREE. The kit stacks leads, quoted and
   * won, and its two paler colours are literal hexes with no token
   * pair in `app/kit-tokens.css`. Navy on the dark ground is a navy
   * bar on a navy page, which is the fault that file exists to stop,
   * and inventing a pair here is not allowed. The solid fill is
   * `var(--navy-900)`, which `themedStructure` already maps to
   * `--chart-total` on both grounds, so the one that survives the
   * theme is the one that is drawn. The other two are dropped and the
   * kit's own 22px track shows through behind.
   */
  bar: number;
  /** The two figures in the kit's narrow slot. */
  figures: [string, string];
  /** The headline figure, in the kit's Panton slot. */
  headline: string;
  /** The change, where there is one. */
  delta?: { text: string; up: boolean };
  /** Tooltips, one per column, for the columns that carry a figure. */
  titles?: { bar?: string; figures?: [string, string]; headline?: string; delta?: string };
  onClick?: () => void;
  /** Anything this application adds to the row, such as its buttons. */
  after?: ReactNode;
};

/* -------------------------------------------------------------
   The one fill, on a ground the kit never saw.

   The kit is a light design. Its solid bar is `var(--navy-900)`, and
   this application has a dark theme where the page itself is
   `#09163A`: the same value. Drawn as written, the bar is a navy
   rectangle on a navy page and there is nothing to see. That is the
   exact fault `app/kit-tokens.css` was written for, and it already
   holds the answer: `--chart-total` is the navy on the light ground
   and a pale navy on the dark one, defined as a pair for this reason.

   `themedStructure` in `devices.tsx` names that same mapping, but it
   compares the whole value and then swaps literal hexes, so it does
   nothing to a STYLE STRING that carries the token by name. Rather
   than change how every ported chart is recoloured, the swap is made
   here, on this one declaration, and it swaps a token for a token:
   no value is introduced.
   ------------------------------------------------------------- */
const onTheme = (kit: string) => kit.replace('var(--navy-900)', 'var(--chart-total)');

/** Put our percentage into the kit's own width declaration. */
const at = (fraction: number) => (kit: string) =>
  kit.replace(/width:[\d.]+%/, `width:${Math.max(0, Math.min(1, fraction)) * 100}%`);

/** The kit's cell, with the words replaced and nothing else touched. */
const words = (text: string): Patch => ({ text });

function rowPatch(r: LeaderRow, rank: number): Patch {
  const rising = r.delta?.up !== false;
  return {
    from: rank === 1 ? ROW_FIRST : rising ? ROW_UP : ROW_DOWN,
    on: r.onClick ? { click: r.onClick } : undefined,
    style: r.onClick ? (kit) => `${kit}cursor:pointer` : undefined,
    kids: [
      words(String(rank)),
      words(r.initials),
      {
        /* The one transform, chosen by the business. See the header. */
        /* The kit's own declaration, matched rather than retyped, so that no
           length appears in this file even as part of a search. */
        style: (kit) => kit.replace(/flex:none;width:[^;]+/, 'flex:1'),
        kids: [words(r.name), words(r.sub)],
      },
      r.badge ? { kids: [{ kids: [{}, words(r.badge)] }], recolour: themed } : { drop: true },
      {
        title: r.titles?.bar,
        kids: [{ drop: true }, { drop: true }, { style: (kit) => onTheme(at(r.bar)(kit)) }],
      },
      {
        kids: [
          { text: r.figures[0], title: r.titles?.figures?.[0] },
          { text: r.figures[1], title: r.titles?.figures?.[1] },
          { drop: true },
        ],
      },
      { text: r.headline, title: r.titles?.headline },
      r.delta
        ? { title: r.titles?.delta, kids: [{ kids: [{}, words(r.delta.text)] }] }
        : { kids: [{ drop: true }] },
    ],
    after: r.after,
  };
}

export function Leaderboard({
  title, legend, sort, rows, total, empty,
}: {
  /** The card's own heading, in the kit's header bar. */
  title: string;
  /** What the bar stands for, in the kit's legend. */
  legend: string;
  /**
   * What goes in the kit's sort slot.
   *
   * The file draws a word and a chevron there. This application needs
   * a control that NAMES the order, because the business reported
   * exactly that fault: "unsure how the Sort works on Customers on this
   * portfolio [...] it's not clear what it actually sorting and in what
   * order." So the slot carries the real control and the kit keeps the
   * position, the type size and the colour it put there.
   */
  sort: ReactNode;
  rows: LeaderRow[];
  /** The kit's footing row, where a list has one. */
  total?: { label: string; figures: [string, string]; headline: string };
  /** What to draw instead when there is nothing to list. */
  empty?: ReactNode;
}) {
  const kit: KitNode = device('leaderboard');

  const head: Patch = {
    kids: [
      words(title),
      { kids: [{ drop: true }, { drop: true },
               { kids: [{ style: onTheme }, words(legend)] }] },
      {
        /* Held on one line. The kit's own words are "Sort by won
           value", four short ones that never wrap; anything longer
           wrapped, and because the title beside it is `flex:1` the
           header grew to five lines. This is the shape the file draws,
           not a size chosen for it. */
        style: (kit) => `${kit};white-space:nowrap`,
        slot: sort,
      },
    ],
  };

  if (rows.length === 0) {
    return mirror(kit, { kids: [head, { slot: empty }, ...Array(5).fill({ drop: true })] });
  }

  return mirror(kit, {
    kids: [
      head,
      ...rows.map((r, i) => rowPatch(r, i + 1)),
      total
        ? {
            from: TOTAL,
            kids: [
              words(total.label),
              { kids: [words(total.figures[0]), words(total.figures[1]), { drop: true }] },
              words(total.headline),
              {},
            ],
          }
        : { from: TOTAL, drop: true },
    ],
  });
}
