'use client';

import type { CSSProperties, ReactNode } from 'react';
import { KIT_DEVICES } from '@/lib/analytics/kit.generated';

/* =============================================================
   Render the kit's own markup, with our data in it.

   ---- Why this is not a component library ----

   From the business, after the analytics hub was rebuilt three times:

     I don't know why you can't just copy the css and paste it in the
     app, copy the html paste it in the app then you have the same
     thing without fail. Mirror it.

   That is exactly right, and it is what this does. `kit.generated.ts`
   holds the kit's DOM as a tree of tags, inline styles and text, read
   out of a rendered browser page. This walks that tree and returns
   React elements from it. The structure is the kit's, every style
   string is the kit's, and the only thing that changes is the text.

   A component built this way cannot drift, because there is nothing in
   it to drift: no lengths, no colours, no weights. `npm run
   check:invention` enforces that by refusing any component that
   contains a number.

   ---- The one shape of edit allowed ----

   A patch mirrors the tree it edits. `text` replaces a node's words.
   `kids` patches the children positionally. `from` says which original
   child to clone, which is how eight rows in the kit become however
   many rows the business actually has, all wearing the kit's row.
   `style` may only TRANSFORM the kit's string, so a heat cell can take
   its alpha from the data while keeping every other declaration the
   file wrote.

   There is deliberately no way to supply a style from scratch.
   ============================================================= */

export type KitNode = {
  readonly tag: string;
  readonly style?: string;
  readonly text?: string;
  readonly kids?: readonly KitNode[];
  /* SVG only. Inside an svg the kit writes its design in attributes
     rather than in a style: stroke, stroke-width, stroke-dasharray,
     fill and vector-effect. They come across with the node so that a
     port does not have to type a single one of them. */
  readonly attrs?: Readonly<Record<string, string>>;
  /* Also SVG only, and deliberately separate from `attrs`. These are
     the kit's own data set and a port must never draw them. They are
     recorded because some of what looks like data is design: a
     waterfall bar is 69.4 wide in a 124 slot, and that proportion is a
     decision about the chart. A port reads it off here rather than
     typing it. */
  readonly geom?: Readonly<Record<string, string>>;
  readonly viewBox?: string;
  readonly preserveAspectRatio?: string | null;
};

export type Patch = {
  /** Replace the words. */
  text?: string | number;
  /** Which of the original children to clone. Defaults to this index. */
  from?: number;
  /** Change the kit's style string. Never replace it wholesale. */
  style?: (kitStyle: string) => string;
  /** Patch the children, positionally. */
  kids?: Patch[];
  /** Leave this node out. */
  drop?: boolean;
  /** Anything React, dropped in place of the node's own children. */
  slot?: ReactNode;
  /**
   * Anything React, added AFTER the node's own children.
   *
   * `slot` replaces what the kit draws. This adds to it, which is what
   * an interaction layer needs: the kit is a static file and has no
   * hover targets in it, so a mirrored chart has to lay its own over
   * the drawing without touching a single one of the file's nodes.
   *
   * Losing that is how the ported charts shipped with the readout
   * gone. The kit cannot supply a behaviour it does not have, and a
   * port that only ever mirrors ends up mirroring the absence.
   */
  after?: ReactNode;
  /**
   * Geometry, for an SVG shape.
   *
   * The kit's own x1, points and width are ITS data set. Ours has to
   * put its own numbers in the same shapes, so geometry is supplied
   * here while every presentation attribute stays the kit's. Anything
   * named here that the kit also sets is overridden, which is how a
   * heat cell or a division line takes our colour without the rest of
   * the declaration moving.
   */
  attrs?: Record<string, string | number>;
  /**
   * Rewrite the kit's colours, everywhere under this node.
   *
   * The kit is a light design and writes its data colours as literal
   * hexes: navy for STC, a mid blue for trailer sales, a pale blue for
   * rentals. This application has a dark theme as well, and navy on a
   * navy ground is a shape nobody can see. Every literal in the file
   * therefore has to become the data token for that series, which
   * `app/kit-tokens.css` already defines on both grounds and which
   * exists because of the same fault the other way round: "the bottom
   * bar graph is blinding".
   *
   * It applies to style strings, to `fill` and to `stroke`, and it
   * inherits down the tree, so a legend swatch and the line it stands
   * for cannot be recoloured differently.
   */
  recolour?: (value: string) => string;
  /** Handlers, for the devices the design makes interactive. */
  on?: {
    click?: () => void;
    enter?: (e: React.MouseEvent<HTMLElement>) => void;
    leave?: () => void;
  };
  title?: string;
};

/* -------------------------------------------------------------
   Inline CSS text to a React style object.

   React will not take a string for `style`, so the kit's own
   declarations are parsed rather than retyped. Custom properties are
   kept as written, which is what lets `var(--surface)` survive.
   ------------------------------------------------------------- */
export function parseStyle(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const prop = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out as CSSProperties;
}

/** The first node under `node` whose style matches. For borrowing a variant. */
export function find(node: KitNode, test: (style: string, n: KitNode) => boolean): KitNode | null {
  if (node.style && test(node.style, node)) return node;
  for (const k of node.kids ?? []) {
    const hit = find(k, test);
    if (hit) return hit;
  }
  return null;
}

/** Every node under `node` whose style matches, in document order. */
export function findAll(node: KitNode, test: (style: string, n: KitNode) => boolean): KitNode[] {
  const out: KitNode[] = [];
  if (node.style && test(node.style, node)) out.push(node);
  for (const k of node.kids ?? []) out.push(...findAll(k, test));
  return out;
}

/**
 * The whole device: the label above the panel, and the box round both.
 *
 * The kit draws one as a flex column with an 11px gap holding a title
 * block and then the panel. Extracting the panel alone left the label
 * to be written by hand, and a hand written label is a different height
 * on each side of a row. That is exactly what the business reported:
 *
 *   Revenue page for example, one chart starts further down the page
 *   than the other and its div is a different size to the chart div
 *   next to it. The brand kit forces you to keep them uniform which
 *   was ignored.
 *
 * With the label inside the device, both halves come from the file and
 * a row of two devices is two identical structures.
 */
export function DeviceFrame({ of, title, sub, children }: {
  /** Which of the kit's devices to wear. */
  of: keyof typeof KIT_DEVICES;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const d = KIT_DEVICES[of] as {
    found: boolean; wrapStyle?: string | null; head?: KitNode | null;
  };
  const head = d?.head ?? null;

  return (
    <div style={d?.wrapStyle ? parseStyle(d.wrapStyle) : undefined}>
      {head && mirror(head, {
        kids: [{ text: title }, sub === undefined ? { drop: true } : { text: sub }],
      })}
      {children}
    </div>
  );
}

/** The kit's panel, as the named device wears it. */
export function panelStyle(key: keyof typeof KIT_DEVICES): CSSProperties {
  const d = KIT_DEVICES[key] as { node?: KitNode };
  return d?.node?.style ? parseStyle(d.node.style) : {};
}

export function device(key: keyof typeof KIT_DEVICES): KitNode {
  const d = KIT_DEVICES[key] as { found: boolean; node?: KitNode; title: string };
  if (!d?.found || !d.node) {
    throw new Error(
      `The kit has no device called "${key}". Run \`npm run kit:extract\` and check `
      + 'the title in scripts/kit-extract.ts matches the one in the file.',
    );
  }
  return d.node;
}

/* -------------------------------------------------------------
   The walk
   ------------------------------------------------------------- */
export function mirror(
  node: KitNode, patch: Patch = {}, key?: string | number, inherited?: (v: string) => string,
): ReactNode {
  if (patch.drop) return null;
  const recolour = patch.recolour ?? inherited;

  /* A text node is a node.

     The kit writes mixed content: its cohort legend is
     70%<span>...swatches...</span>100%. Rendering only the elements
     dropped both labels and shipped a scale with no numbers on it.
     `#text` carries no tag and no style, so it renders as words. */
  if (node.tag === '#text') {
    return patch.text !== undefined ? String(patch.text) : (node.text ?? '');
  }

  /* A style transform runs even where the kit wrote no style.

     It did not, and that shipped a transparent overlay the size of the
     whole page. The waterfall's plot has no style attribute in the
     file, so the patch that adds `position:relative` to it was
     silently skipped, the hover layer inside it had nothing to size
     against, and `inset:0` resolved to the viewport. It sat over every
     other control on the screen and swallowed the pointer.

     Transforming an empty string is still a transform, so it is
     allowed. Adding a declaration the file does not have is the one
     shape of edit this permits, and the caller has to say why. */
  const written = node.style !== undefined
    ? (patch.style ? patch.style(node.style) : node.style)
    : (patch.style ? patch.style('') : undefined);
  const style = written === undefined
    ? undefined
    : parseStyle(recolour ? recolour(written) : written);

  const props: Record<string, unknown> = { style };

  /* The kit's own presentation attributes, then ours for geometry.
     React wants them camel cased, so the hyphenated names the file
     writes are converted rather than listed. */
  for (const [k, v] of Object.entries({ ...(node.attrs ?? {}), ...(patch.attrs ?? {}) })) {
    const paint = recolour && typeof v === 'string' && (k === 'fill' || k === 'stroke');
    props[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = paint ? recolour(v) : v;
  }
  if (node.viewBox) {
    props.viewBox = node.viewBox;
    if (node.preserveAspectRatio) props.preserveAspectRatio = node.preserveAspectRatio;
  }
  if (patch.title) props.title = patch.title;
  if (patch.on?.click) { props.onClick = patch.on.click; props.role = 'button'; props.tabIndex = 0; }
  if (patch.on?.enter) props.onMouseEnter = patch.on.enter;
  if (patch.on?.leave) props.onMouseLeave = patch.on.leave;

  let children: ReactNode;
  if (patch.slot !== undefined) {
    children = patch.slot;
  } else if (patch.text !== undefined) {
    children = String(patch.text);
  } else if (patch.kids) {
    const originals = node.kids ?? [];
    children = patch.kids.map((p, i) => {
      const source = originals[p.from ?? i];
      /* A patch pointing at a child the kit does not have is a bug in
         the caller, and silently rendering nothing is how it would
         survive to a screenshot. */
      if (!source) {
        throw new Error(
          `mirror: no child at index ${p.from ?? i} of <${node.tag}>, which has `
          + `${originals.length}. The kit's structure has changed, or the patch is wrong.`,
        );
      }
      return mirror(source, p, i, recolour);
    });
  } else if (node.kids?.length) {
    children = node.kids.map((k, i) => mirror(k, {}, i, recolour));
  } else if (node.text !== undefined) {
    children = node.text;
  }

  if (patch.after !== undefined) {
    children = <>{children}{patch.after}</>;
  }

  /* The key is passed directly rather than spread. React warns about a
     key inside a spread object and, in a future version, ignores it,
     which would put every mirrored list back on index reconciliation. */
  const Tag = node.tag as keyof JSX.IntrinsicElements;
  return <Tag key={key} {...props}>{children}</Tag>;
}
