'use client';

/* =============================================================
   Telling two bands apart without using their colour.

   ---- Why this is not decoration ----

   The three division colours are tokens, and in dark mode two of them
   are too close to separate. Run against the chart surface they sit on:

     light  STC #2B3F78, Trailer #2F6F5E, S&L #C77A06
            worst adjacent pair, normal vision  ΔE 16.9   passes

     dark   STC #8492C0, Trailer #4FA98F, S&L #E8A33D
            worst adjacent pair, normal vision  ΔE 12.8   FAILS
            the same pair, deutan               ΔE  7.9

   Fifteen is the floor for somebody with full colour vision. Below it,
   two bands of a stacked chart read as one shape with a slight change
   of tone in it, and the whole point of stacking is that each band is a
   division. Deutan at 7.9 is worse again.

   Changing the token values is a rebrand step and belongs to whoever is
   ordering the rebrand, so the tokens are left alone and the charts
   carry a second signal instead: every band is also a fill, and every
   fill is named in the key with the same fill beside it.

   ---- The three fills ----

   Solid, then diagonal hatching, then dots, in the order the divisions
   are declared. The largest division stays solid, because texturing the
   band that occupies most of the chart is what makes a chart look busy.

   The same three are what the reference dashboards do on a stacked
   column: one flat, one striped, one dotted. It survives a photocopy, a
   projector, and a forced-colours browser, none of which a hue does.
   ============================================================= */

/** Every fill this module can draw, in the order series are declared. */
export const FILLS = ['solid', 'hatch', 'dots'] as const;
export type Fill = (typeof FILLS)[number];

export const fillFor = (i: number): Fill => FILLS[i % FILLS.length]!;

/** The id a band references, unique per chart so two charts never share. */
export const patternId = (scope: string, i: number) => `tex-${scope}-${i}`;

/**
 * The pattern definitions for one chart.
 *
 * Rendered inside the chart's own `<svg>`. Each pattern paints the
 * series colour at the band's own opacity and then the marks over it,
 * so a textured band and a solid one are the same weight of colour.
 */
export function Textures({ scope, colours, on }: {
  scope: string;
  colours: string[];
  /** When off, every series is a flat fill and the ids still resolve. */
  on: boolean;
}) {
  return (
    <defs>
      {colours.map((colour, i) => {
        const fill = on ? fillFor(i) : 'solid';
        return (
          <pattern
            key={i}
            id={patternId(scope, i)}
            patternUnits="userSpaceOnUse"
            width={7} height={7}
          >
            <rect width={7} height={7} fill={colour} />
            {fill === 'hatch' && (
              <path
                d="M -1 1 L 1 -1 M 0 7 L 7 0 M 6 8 L 8 6"
                stroke="var(--surface)" strokeWidth={1.6} opacity={0.55}
                shapeRendering="auto"
              />
            )}
            {fill === 'dots' && (
              <circle cx={3.5} cy={3.5} r={1.35} fill="var(--surface)" opacity={0.6} />
            )}
          </pattern>
        );
      })}
    </defs>
  );
}

/**
 * The same fill as a CSS background, for a swatch beside a name.
 *
 * A key whose swatches are all flat while the chart's bands are not is
 * a key that has to be decoded before it can be used.
 */
export function swatchImage(i: number, on: boolean): string | undefined {
  if (!on) return undefined;
  const fill = fillFor(i);
  if (fill === 'hatch') {
    return 'repeating-linear-gradient(45deg, transparent 0 2px,'
      + ' var(--surface) 2px 3.4px)';
  }
  if (fill === 'dots') {
    return 'radial-gradient(var(--surface) 0.9px, transparent 1px)';
  }
  return undefined;
}
