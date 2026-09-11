'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* =============================================================
   The minimap, drawn from the chart rather than decorated.

   From the business:

     The little r-74 svg, make that be a real visual of the tree's
     current view. Have it looking like it does now on 100% view but if
     you drag or zoom, the small version should reflect that. You should
     then be able to drag around the little focus box in this smaller
     version and the larger tree follows suit.

   So it holds one block per role, placed where that role's card
   actually is, and a box showing what the canvas is currently looking
   at. Dragging the box scrolls the canvas, and scrolling or zooming the
   canvas moves the box. One state, two views of it.

   ---- Why everything is a fraction ----

   Nothing here is measured in pixels. Each block is stored as its share
   of the tree's own width and height, and drawn as a percentage of the
   map. So the map is right at any size, at any zoom, on a tablet or a
   4k screen, and the kit keeps deciding how big the map itself is.

   The behaviour document calls for exactly this: "Overflow becomes pan.
   Where the canvas is narrower than the tree, the region scrolls on
   both axes. It is never clipped, and the minimap shows where you are."
   ============================================================= */

export type Block = { id: string; x: number; y: number; w: number; h: number; tint: string };

export function Minimap({ body, tree, zoom, density }: {
  body: React.RefObject<HTMLDivElement>;
  tree: React.RefObject<HTMLDivElement>;
  zoom: number;
  density: string;
}) {
  const map = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [port, setPort] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [dragging, setDragging] = useState(false);

  /* Where every card is, as a share of the tree's own box. */
  const measure = useCallback(() => {
    const t = tree.current;
    if (!t) return;
    const tr = t.getBoundingClientRect();
    if (tr.width === 0 || tr.height === 0) return;
    const out: Block[] = [];
    for (const el of Array.from(t.querySelectorAll('[data-for]'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0) continue;
      out.push({
        id: el.getAttribute('data-for') ?? String(out.length),
        x: (r.left - tr.left) / tr.width,
        y: (r.top - tr.top) / tr.height,
        w: r.width / tr.width,
        h: r.height / tr.height,
        tint: (el.getAttribute('data-tint') ?? '#2B3F78'),
      });
    }
    setBlocks(out);
  }, [tree]);

  /* What the canvas is looking at, as a share of everything it could. */
  const follow = useCallback(() => {
    const b = body.current;
    if (!b || b.scrollWidth === 0 || b.scrollHeight === 0) return;
    setPort({
      x: b.scrollLeft / b.scrollWidth,
      y: b.scrollTop / b.scrollHeight,
      w: Math.min(1, b.clientWidth / b.scrollWidth),
      h: Math.min(1, b.clientHeight / b.scrollHeight),
    });
  }, [body]);

  useEffect(() => {
    /* After paint, and again whenever the chart changes shape. */
    const id = window.requestAnimationFrame(() => { measure(); follow(); });
    return () => window.cancelAnimationFrame(id);
  }, [measure, follow, zoom, density]);

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    b.addEventListener('scroll', follow, { passive: true });
    const ro = new ResizeObserver(() => { measure(); follow(); });
    ro.observe(b);
    if (tree.current) ro.observe(tree.current);
    return () => { b.removeEventListener('scroll', follow); ro.disconnect(); };
  }, [body, tree, follow, measure]);

  /* Dragging the box, or pressing anywhere on the map, scrolls the
     canvas so that point is in the middle of what you are looking at. */
  const scrollTo = useCallback((clientX: number, clientY: number) => {
    const m = map.current, b = body.current;
    if (!m || !b) return;
    const r = m.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    b.scrollLeft = Math.max(0, fx * b.scrollWidth - b.clientWidth / 2);
    b.scrollTop = Math.max(0, fy * b.scrollHeight - b.clientHeight / 2);
  }, [body]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    scrollTo(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => { if (dragging) scrollTo(e.clientX, e.clientY); };
  const onUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  const pc = (n: number) => `${(n * 100).toFixed(3)}%`;
  return (
    <div className={`r-74${dragging ? ' is-dragging' : ''}`} ref={map} data-minimap="1"
      title="Drag to move around the chart"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {blocks.map((n) => (
        <span key={n.id} className="rk-mini-node"
          style={{ left: pc(n.x), top: pc(n.y), width: pc(n.w), height: pc(n.h), background: n.tint }} />
      ))}
      <span className={`rk-mini-view${dragging ? ' is-dragging' : ''}`}
        style={{ left: pc(port.x), top: pc(port.y), width: pc(port.w), height: pc(port.h) }} />
    </div>
  );
}
