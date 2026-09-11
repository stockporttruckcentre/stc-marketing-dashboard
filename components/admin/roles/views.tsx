'use client';

import { useMemo, useState } from 'react';
import type { GridRow, Matrix, ScreenModel, Verdict } from './model';
import { Svg, SearchIcon, ChevronIcon, DownIcon, OpenIcon, CheckIcon, CrossIcon, AlertIcon } from './icons';

/* =============================================================
   The Grid and Matrix views, from `roles-view-grid.html` and
   `roles-view-matrix.html`.

   Both are switched by `roles-behaviour.css`, not by this file: the
   three `.vw-in` radios in the screen decide which of `.vw-chart`,
   `.vw-grid` and `.vw-matrix` is shown. So neither component knows
   whether it is the one on display, which is the same guarantee the
   role selection has, and for the same reason.

   ---- The two things the kit could not settle on its own ----

   Its grid draws a division bar for the three divisions its twelve
   example rows happen to show, and its matrix for four of five. The
   geometry is identical inside each family, so the model hands over a
   carrier class and the division's own colour. A colour that the kit
   states, on a shape that the kit states.

   Its matrix fixes six columns. This business has seven capability
   areas, so the count comes from the data and the label width and the
   unit either side of it stay the kit's, read out of its stylesheet by
   `roles-port:generate`.
   ============================================================= */

const VERDICT: Record<Verdict, { cls: string; label: string; icon: React.ReactNode }> = {
  allowed: { cls: 'r-c', label: 'Allowed', icon: <CheckIcon /> },
  conditional: { cls: 'r-e', label: 'Conditional', icon: <AlertIcon /> },
  denied: { cls: 'r-b', label: 'Denied', icon: <CrossIcon /> },
};

/* ---- The toolbar chips ----

   The kit draws each as a chip with a chevron. What sits behind one is
   not in the pack, so rather than a menu this file would have to design,
   each chip cycles its own values and says which one it is on. The
   control is the label. */
function useCycle<T extends string>(values: readonly T[]) {
  const [i, setI] = useState(0);
  return [values[i]!, () => setI((n) => (n + 1) % values.length)] as const;
}

const DIVISION_ALL = 'All divisions';
const SORTS = ['Holders', 'Holders, fewest first'] as const;
const COVERS = ['Coverage', 'Coverage, lowest first'] as const;
const FLAGS = ['All roles', 'Flagged only'] as const;

export function GridView({ model, onOpen }: { model: ScreenModel; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const divisions = useMemo(
    () => [DIVISION_ALL, ...new Set(model.grid.map((r) => r.division))] as const, [model.grid]);
  const [division, nextDivision] = useCycle(divisions as readonly string[]);
  const [sort, nextSort] = useCycle(SORTS);
  const [cover, nextCover] = useCycle(COVERS);
  const [flags, nextFlags] = useCycle(FLAGS);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = model.grid.filter((r) =>
      (needle === '' || r.name.toLowerCase().includes(needle) || r.division.toLowerCase().includes(needle))
      && (division === DIVISION_ALL || r.division === division)
      && (flags === 'All roles' || r.flagged));
    if (sort === 'Holders') out = [...out].sort((a, b) => b.holders - a.holders);
    else out = [...out].sort((a, b) => a.holders - b.holders);
    if (cover === 'Coverage, lowest first') out = [...out].sort((a, b) => a.pct - b.pct);
    return out;
  }, [model.grid, q, division, sort, cover, flags]);

  /* The kit's Export button, doing the thing its label says: the rows
     on screen, in the order on screen, as a file. */
  const exportCsv = () => {
    const head = ['Role', 'Division', 'Reports to', 'Holders', 'Coverage %', 'Flagged'];
    const body = rows.map((r) => [r.name, r.division, r.reportsTo, r.holders, r.pct, r.flagged ? 'yes' : 'no']);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'stc-roles.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="r-8l vw vw-grid">
      <div className="r-8m">
        <div className="r-5n">
          <span className="r-35"><Svg size={14}><SearchIcon /></Svg></span>
          <input placeholder={`Filter ${model.grid.length} roles`} className="r-36"
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="r-3b" onClick={nextDivision} title="Click to change the division shown">
          {division}<Svg size={12}><ChevronIcon /></Svg></span>
        <span className="r-3b" onClick={nextSort} title="Click to reverse the order">
          {sort}<Svg size={12}><ChevronIcon /></Svg></span>
        <span className="r-3b" onClick={nextCover} title="Click to order by coverage">
          {cover}<Svg size={12}><ChevronIcon /></Svg></span>
        <span className="r-3b" onClick={nextFlags} title="Click to show only the flagged roles">
          {flags}<Svg size={12}><ChevronIcon /></Svg></span>
        <span className="r-k"></span>
        <span className="r-4x">Showing {rows.length} of {model.grid.length}</span>
        <button className="r-x" onClick={exportCsv}>
          <Svg size={14}><DownIcon /></Svg><span>Export</span>
        </button>
      </div>
      <div className="r-8n">
        <div className="r-8o">
          <div className="r-8p">
            <span className="r-1z">ROLE</span><span className="r-1z">DIVISION</span>
            <span className="r-1z">REPORTS TO</span><span className="r-1z">HOLDERS</span>
            <span className="r-1z">COVERAGE</span><span className="r-1z">FLAGS</span>
            <span className="r-8q"></span>
          </div>
          {rows.map((r) => <Row key={r.id} row={r} onOpen={onOpen} />)}
        </div>
      </div>
    </div>
  );
}

function Row({ row: r, onOpen }: { row: GridRow; onOpen: (id: string) => void }) {
  return (
    <div className="r-22">
      <span className="r-23">
        <span className={r.barCls} style={{ background: r.tint }}></span>
        <span className="r-24">{r.name}</span>
      </span>
      <span className="r-s">{r.division}</span>
      <span className="r-25">{r.reportsTo}</span>
      <span className="r-26">{r.holders}</span>
      <div className="r-2">
        <span className="r-3"><span className={r.fill.cls} style={r.fill.width ? { width: r.fill.width } : undefined}></span></span>
        <span className="r-4">{r.pct}%</span>
      </div>
      {/* The kit leaves this cell empty in all twelve of its rows, so a
          flagged role is marked with the chip the rest of the screen
          uses for exactly this, rather than a shape invented here. */}
      <span>{r.flagged
        ? <span className="r-e"><Svg size={12}><AlertIcon /></Svg>Review</span>
        : null}</span>
      <span className="r-27">
        <button className="r-28" onClick={() => onOpen(r.id)}>
          <span>Open</span><Svg size={14}><OpenIcon /></Svg>
        </button>
      </span>
    </div>
  );
}

export function MatrixView({ matrix }: { matrix: Matrix }) {
  const [area, nextArea] = useCycle(['All groups', ...matrix.areas] as readonly string[]);
  const shown = area === 'All groups'
    ? matrix.areas.map((_, i) => i)
    : matrix.areas.map((a, i) => (a === area ? i : -1)).filter((i) => i >= 0);
  const template = `${matrix.template.split(' repeat')[0]} repeat(${shown.length}, ${matrix.template.split(', ')[1] ?? '1fr'}`;

  return (
    <div className="r-8t vw vw-matrix">
      <div className="r-8u">
        <span className="r-8v">Capability group</span>
        <span className="r-8w" onClick={nextArea} title="Click to show one group at a time">
          {area === 'All groups' ? `All ${matrix.areas.length} groups` : area}
          <Svg size={12}><ChevronIcon /></Svg>
        </span>
        <span className="r-8x"></span>
        {(['allowed', 'conditional', 'denied'] as Verdict[]).map((v) => (
          <span key={v} className="r-47">
            <span className={VERDICT[v].cls}><Svg size={12}>{VERDICT[v].icon}</Svg></span>{VERDICT[v].label}
          </span>
        ))}
        <span className="r-k"></span>
        <button className="r-x" disabled
          title="Out of scope in the handoff: the review pack needs a definition of what it contains before the export means anything">
          <Svg size={14}><DownIcon /></Svg><span>Download review pack</span>
        </button>
      </div>
      <div className="r-8y">
        <div className="r-5w">
          <div className="r-8z" style={{ gridTemplateColumns: template }}>
            <span className="r-90">ROLE</span>
            {shown.map((i) => <span key={matrix.areas[i]} className="r-2o">{matrix.areas[i]!.toUpperCase()}</span>)}
          </div>
          {matrix.rows.map((r) => (
            <div key={r.id} className="r-20" style={{ gridTemplateColumns: template }}>
              <span className="r-21">
                <span className={r.barCls} style={{ background: r.tint }}></span>{r.name}
              </span>
              {shown.map((i) => (
                <span key={i} className="r-7">
                  <span className={VERDICT[r.cells[i]!].cls}
                    title={`${matrix.areas[i]}: ${VERDICT[r.cells[i]!].label}`}>
                    <Svg size={12}>{VERDICT[r.cells[i]!].icon}</Svg>
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
