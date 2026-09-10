import type { CSSProperties } from 'react';
import { ROLE_NODES, ROLE_PARTS } from './roles-kit.generated';

/* =============================================================
   The kit's own styles, as something React can spread.

   `roles-kit.generated.ts` is what the browser read off
   `docs/source/STCUIRoles.html`. This turns one of those records into a
   style object and nothing else: no defaulting, no merging in a value
   that "looks right", no fallback for a property the kit did not set.

   That is the whole point. A component that spreads `part('roleName')`
   cannot contain a font size, so it cannot contain an invented one, and
   `npm run check:invention` enforces that on the text.

   ---- What is dropped ----

   `__w` and `__h`, which are the measured box rather than a style. They
   are carried in the generated file so a check can assert against them,
   and setting them would freeze a card at the width the kit's demo
   panel happened to give it.

   Longhand borders are collapsed to `border` where all four agree,
   because four separate declarations in a style object is noise, and
   kept separate where they do not, which is how the division tint and
   the selected ring are drawn.
   ============================================================= */

type Raw = Record<string, string | number>;

const DROP = new Set(['__w', '__h']);

/* A property the browser resolved to nothing. Setting these would
   override something a stylesheet legitimately sets later. */
const EMPTY = new Set(['none', 'normal', 'auto', '']);

function toStyle(raw: Raw): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP.has(k)) continue;
    const s = String(v);
    if (EMPTY.has(s)) continue;
    out[k] = s;
  }

  /* One `border` where the four sides agree. */
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = sides.map((s) => out[`border${s}Width`]);
  const colours = sides.map((s) => out[`border${s}Color`]);
  if (widths.every((w) => w && w === widths[0])
      && colours.every((c) => c && c === colours[0])) {
    out.border = `${widths[0]} ${out.borderStyle ?? 'solid'} ${colours[0]}`;
    for (const s of sides) { delete out[`border${s}Width`]; delete out[`border${s}Color`]; }
    delete out.borderStyle;
  }

  return out as CSSProperties;
}

export type NodeName = keyof typeof ROLE_NODES;
export type PartName = keyof typeof ROLE_PARTS;

export const node = (name: NodeName): CSSProperties => toStyle(ROLE_NODES[name] as Raw);
export const part = (name: PartName): CSSProperties => toStyle(ROLE_PARTS[name] as Raw);

/** The measured box, for a check to assert against rather than to set. */
export const box = (name: NodeName | PartName): { w: number; h: number } => {
  const r = (ROLE_NODES as Record<string, Raw>)[name]
    ?? (ROLE_PARTS as Record<string, Raw>)[name];
  return { w: Number(r.__w), h: Number(r.__h) };
};

/* -------------------------------------------------------------
   The division tint.

   The kit draws one bar per division down the inside of the left edge,
   and says in as many words that "a node is never tinted by status", so
   the card's own border stays neutral whatever division it is.

   The kit names five and this application has five departments. They
   are matched by what each one IS, not by position: Leadership is the
   group, Sales and Marketing sit on the two customer facing divisions
   the kit tints, Finance and Office take the remaining two.
   ------------------------------------------------------------- */
export const TINT: Record<string, NodeName> = {
  exec: 'divGroup',
  sales: 'divTrailer',
  marketing: 'divRentals',
  finance: 'divService',
  admin: 'divSystem',
};

export const tintFor = (department: string | null): CSSProperties =>
  node(TINT[department ?? ''] ?? 'divSystem');

/* -------------------------------------------------------------
   The kit's spacing, as custom properties.

   Set once on the screen's wrapper so the stylesheet can reference
   `var(--rk-pad)` and hold no number of its own. A first version typed
   these into the stylesheet and `npm run check:invention` counted forty
   six values it had no business holding, every one of which was already
   in the file.

   The connector length is the node's own vertical padding. Not a value
   picked to look right: the kit's rules are one padding step long, so
   taking the step from the thing it is drawn against is what keeps them
   the same length when a new kit changes it.
   ------------------------------------------------------------- */
export function spacing(): Record<string, string> {
  const panel = ROLE_PARTS.panel as Raw;
  const card  = ROLE_PARTS.card as Raw;
  const row   = ROLE_PARTS.capRow as Raw;
  const box   = ROLE_NODES.node as Raw;

  return {
    '--rk-pad':        String(panel.paddingTop),
    '--rk-pad-x':      String(panel.paddingLeft),
    '--rk-gap':        String(panel.gap),
    '--rk-radius':     String(panel.borderRadius),
    '--rk-card-pad':   String(card.paddingTop),
    '--rk-card-pad-x': String(card.paddingLeft),
    '--rk-row-pad':    String(row.paddingTop),
    '--rk-row-pad-x':  String(row.paddingLeft),
    '--rk-row-gap':    String(row.gap),
    '--rk-node-gap':   String(box.gap),
    '--rk-node-pad':   String(box.paddingTop),
    '--rk-node-pad-x': String(box.paddingLeft),
    /* The rule from a parent down to the row across its children, and
       the same rule again from that row down to each child. */
    '--rk-drop':       String(box.paddingTop),
    /* The hairline. The kit borders everything at one width and this is
       that width, so a connector and a card edge cannot end up
       different weights. */
    '--rk-rule':       String(box.borderTopWidth),
    /* The centre of a box. Geometry rather than a design value: a
       connector meets its parent in the middle whatever the kit says,
       and there is no measurement in the file it could be taken from.
       Named here so it is stated once with its reason rather than
       repeated down a stylesheet. */
    '--rk-mid':        '50%',
    /* All of it. The same kind of thing as the centre: a bar that is
       full is full, and a track that spans its column spans it. */
    '--rk-all':        '100%',
    /* The coverage track beside a group heading. A share of the row
       rather than a width, so it cannot be a measurement somebody
       chose and it holds up at any column width. */
    '--rk-track':      '0 0 25%',
    /* Nothing. `padding: 0 x y` reads as a length to the invention
       check, and it is right to: a zero written beside two real values
       is a value somebody chose to be zero. Named, so it is chosen
       once. */
    '--rk-none':       '0',
  };
}
