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
export function mirror(node: KitNode, patch: Patch = {}, key?: string | number): ReactNode {
  if (patch.drop) return null;

  /* A text node is a node.

     The kit writes mixed content: its cohort legend is
     70%<span>...swatches...</span>100%. Rendering only the elements
     dropped both labels and shipped a scale with no numbers on it.
     `#text` carries no tag and no style, so it renders as words. */
  if (node.tag === '#text') {
    return patch.text !== undefined ? String(patch.text) : (node.text ?? '');
  }

  const style = node.style
    ? parseStyle(patch.style ? patch.style(node.style) : node.style)
    : undefined;

  const props: Record<string, unknown> = { key, style };
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
      return mirror(source, p, i);
    });
  } else if (node.kids?.length) {
    children = node.kids.map((k, i) => mirror(k, {}, i));
  } else if (node.text !== undefined) {
    children = node.text;
  }

  const Tag = node.tag as keyof JSX.IntrinsicElements;
  return <Tag {...props}>{children}</Tag>;
}
