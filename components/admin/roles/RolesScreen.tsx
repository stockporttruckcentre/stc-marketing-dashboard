'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ICONS } from '@/components/nav-icons';
import type { NavIcon } from '@/lib/nav';
import type { Chart, Column, NodeView, Panel, ScreenModel, Verdict } from './model';

/* =============================================================
   The Roles screen, as `docs/source/roles_hub/roles-page.html` draws it.

   From the handoff:

     Reproduce roles-page.html and its three stylesheets exactly. Do
     not rebuild, re-layout, re-name, restructure or improve. If your
     output does not diff cleanly against these files, it is wrong,
     however close it looks.

   So this file is that markup, element for element and class for
   class, with a loop in each region the handoff names as repeating:
   the radios, the chart, the rail and the inspector, plus the legend,
   the chips and the header numbers, which are the same data. What is
   not a loop is copied. `npm run check:roles-port` renders this with
   the kit's own placeholder data, blanks the bound text, and compares
   the result to the kit's file in a browser. A wrapper this file
   drops, a class it renames or an attribute it adds fails that check.

   ---- What is not JavaScript ----

   Selecting a role is not. The handoff is exact about it: one radio
   per role, and `roles-behaviour.css` shows the panel, rings the node
   and highlights the row from `:checked`. So the radios are
   uncontrolled and nothing in here holds a "selected" state. The
   three regions cannot disagree because no code is asked to keep them
   in step.

   ---- What is ----

   Three things the kit draws as controls and leaves to the build:
   the search box and the division chips narrow the rail, and the zoom
   buttons scale the chart between 50 and 150 per cent, which is the
   range the behaviour document names. Each one sets a `hidden`
   attribute or the chart's zoom and touches nothing else. Every other
   button on the screen (the views, the density, Access review, New
   role, Compare, the tabs, Edit permissions) is drawn as the kit draws
   it and opens nothing, because what each one opens is a further
   design that has not been handed over in this form. That is stated
   in the recap rather than filled in.
   ============================================================= */

export type NavRow = { label: string; icon: NavIcon; active: boolean };
export type NavSectionView = { label: string; items: NavRow[] };
export type Me = { initials: string; name: string; role: string };

/* The kit's icon frame: every inline svg in the file carries these
   attributes and the class `r-1`. Paths are copied from the file. */
function Svg({ size, title, children }: { size: number; title?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="r-1">
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
const PeopleIcon = ({ size }: { size: number }) => (
  <Svg size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20v-.5A6.5 6.5 0 0 1 8.5 13h1A6.5 6.5 0 0 1 16 19.5v.5" />
    <path d="M17 8.5a3 3 0 1 0 0-5" />
  </Svg>
);
const AlertIcon = ({ size }: { size: number }) => (
  <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>
);
const DocIcon = ({ size }: { size: number }) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
const PlusIcon = ({ size }: { size: number }) => <Svg size={size}><path d="M12 5v14M5 12h14" /></Svg>;
const MinusIcon = ({ size }: { size: number }) => <Svg size={size}><path d="M5 12h14" /></Svg>;

const ZOOM_MIN = 50;
const ZOOM_MAX = 100 + 50;
const ZOOM_STEP = 10;

export function RolesScreen({ model, nav, me }: { model: ScreenModel; nav: NavSectionView[]; me: Me }) {
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const body = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);

  const clamp = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const fit = () => {
    const b = body.current, t = tree.current;
    if (!b || !t) return;
    /* The tree's natural width is its drawn width undone by the zoom
       it is currently drawn at. */
    const natural = t.getBoundingClientRect().width / (zoom / 100);
    if (natural <= 0) return;
    setZoom(clamp(Math.floor((b.clientWidth / natural) * 100 / ZOOM_STEP) * ZOOM_STEP));
  };

  const needle = q.trim().toLowerCase();
  const rowShown = (r: { name: string; people: string[] }) =>
    needle === '' || r.name.toLowerCase().includes(needle)
      || r.people.some((p) => p.toLowerCase().includes(needle));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: model.behaviourCss }} />
      <div className="r-62">
        {model.ids.map((id) => (
          <input key={id} className="sn-in" type="radio" name="stc-screen-role" id={`sn-${id}`}
            defaultChecked={id === model.defaultId} />
        ))}
        <div className="sn-body roles-shell">
          <div className="roles-nav">
            <div className="r-63"><span className="r-64">S</span><span className="r-65">Stockport Truck Centre</span></div>
            {nav.map((s, i) => (
              <NavSection key={s.label} section={s} first={i === 0} />
            ))}
            <span className="r-k"></span>
            <div className="r-69"><span className="r-6a">{me.initials}</span><div className="r-6b"><span className="r-2q">{me.name}</span><span className="r-6c">{me.role}</span></div></div>
          </div>
          <div className="r-6d">
            <div className="r-6e">
              <div className="r-6f"><span className="r-6g">ADMINISTRATION</span><span className="r-6h">Roles and permissions</span></div>
              <span className="r-k"></span>
              <div className="r-6i">
                <div className="r-3f"><span className="r-4h">{model.stats.roles}</span><span className="r-8">ROLES</span></div>
                <div className="r-3f"><span className="r-4h">{model.stats.capabilities}</span><span className="r-8">CAPABILITIES</span></div>
                <div className="r-3f"><span className="r-6j">{model.stats.flags}</span><span className="r-8">FLAGS</span></div>
              </div>
              <button className="r-3g"><DocIcon size={14} /><span>Access review</span></button>
              <button className="r-31"><PlusIcon size={14} /><span>New role</span></button>
            </div>
            <div className="r-6k">
              <div className="roles-canvas">
                <div className="r-6l">
                  <div className="r-4i"><span className="r-6m">Chart</span><span className="r-4j">Grid</span><span className="r-4j">Matrix</span></div>
                  <div className="r-4i"><span className="r-6n">Compact</span><span className="r-6o">Comfortable</span></div>
                  <span className="r-6p"></span>
                  <div className="r-6q">
                    {model.legend.map((l) => (
                      <span key={l.label} className="r-2r"><span className={l.swatchCls}></span>{l.label}</span>
                    ))}
                  </div>
                  <span className="r-k"></span>
                  <div className="r-6r">
                    <button className="r-w" onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}><MinusIcon size={14} /></button>
                    <span className="r-6s">{zoom}%</span>
                    <button className="r-w" onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}><PlusIcon size={14} /></button>
                  </div>
                  <button className="r-x" onClick={fit}>
                    <Svg size={14}>
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </Svg>
                    <span>Fit</span>
                  </button>
                </div>
                <div data-canvas-body="1" className="roles-canvas-body" ref={body}>
                  <div className="r-6t" ref={tree} style={zoom === 100 ? undefined : { zoom: zoom / 100 }}>
                    <ChartTree chart={model.chart} />
                  </div>
                  {model.chart.direct.length > 0 && (
                    <div className="r-6x">
                      <div className="r-6y"><span className="r-6z">DIRECTLY ASSIGNED</span><span className="r-70"></span><span className="r-32">Outside the reporting line</span></div>
                      <div className="r-71">
                        {model.chart.direct.map((n) => <Node key={n.id} node={n} />)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="r-73">
                  <span className="r-4x">{model.chart.footer}</span>
                  <span className="r-k"></span>
                  <div className="r-74"><span className="r-75"></span><span className="r-76"></span><span className="r-77"></span><span className="r-78"></span><span className="r-79"></span><span className="r-7a"></span><span className="r-7b"></span><span className="r-7c"></span><span className="r-7d"></span><span className="r-7e"></span><span className="r-7f"></span><span className="r-7g"></span><span className="r-7h"></span></div>
                </div>
              </div>
              <div className="roles-rail">
                <div className="r-7i">
                  <div className="r-4y">
                    <span className="r-35"><Svg size={14}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg></span>
                    <input placeholder="Find a role or person" className="r-36" onChange={(e) => setQ(e.target.value)} />
                  </div>
                  <div className="r-7j">
                    <span className={chip === null ? 'r-7k' : 'r-3l'} onClick={() => setChip(null)}>All</span>
                    {model.chips.map((c) => (
                      <span key={c.key} className={chip === c.key ? 'r-7k' : 'r-3l'} onClick={() => setChip(c.key)}>{c.label}</span>
                    ))}
                  </div>
                </div>
                <div className="r-7l">
                  {model.rail.map((g) => {
                    const rows = g.rows.map((r) => ({ ...r, shown: rowShown(r) }));
                    const groupShown = (chip === null || chip === g.key) && rows.some((r) => r.shown);
                    return (
                      <div key={g.key} className="r-u" hidden={!groupShown}>
                        <div className="r-2s"><span className={g.swatchCls}></span><span className="r-1z">{g.label}</span><span className="r-k"></span><span className="r-t">{g.rows.length}</span></div>
                        {rows.map((r) => (
                          <label key={r.id} htmlFor={`sn-${r.id}`} data-list={r.id} className="sn-row r-18" hidden={!r.shown}>
                            <span className="r-19">{r.name}</span><span className="r-t">{r.holders}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="r-7m">
                  <div className="r-7n">
                    <span className="r-7o"><AlertIcon size={14} /></span>
                    <div className="r-d"><span className="r-7p">{model.flags.title}</span><span className="r-7q">{model.flags.text}</span></div>
                  </div>
                </div>
              </div>
              <div className="roles-inspector">
                {model.panels.map((p) => <Inspector key={p.id} panel={p} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------
   The in-shell navigation.

   The kit draws the application's sidebar inside the screen, at the
   218px the handoff fixes. Its items and its person are bound to the
   real ones: the sections and rows this person can reach, and who
   they are. Every section after the first is preceded by the kit's
   divider and section label, as its ADMINISTRATION block is.
   ------------------------------------------------------------- */
function NavSection({ section, first }: { section: NavSectionView; first: boolean }) {
  return (
    <>
      {!first && <span className="r-66"></span>}
      {!first && <span className="r-67">{section.label.toUpperCase()}</span>}
      {section.items.map((i) => {
        const Icon = ICONS[i.icon];
        return (
          <span key={i.label} className={i.active ? 'r-68' : 'r-2g'}>
            <Icon size={15} className="r-1" />
            <span className="r-k">{i.label}</span>
          </span>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------
   The chart.

   The kit's connector grammar, read off its file: the root, then a
   stem (`r-4p`) into a row of branches (`r-6v`; `r-6w` when nested).
   Each branch is a column (`r-1y`) that opens with its elbow: the
   first child turns right (`r-4q`), the last turns left (`r-4v`), any
   between carries a bar across (`r-3j`); then a drop (`r-2d`) into
   what hangs there. A single report continues its column under a
   short rule (`r-2a`); two or more fan out again under their own stem.
   A column holding one thing is not wrapped, exactly as the kit does
   not wrap the FleetSmart+ card that stands alone.
   ------------------------------------------------------------- */
function ChartTree({ chart }: { chart: Chart }) {
  if (!chart.root) return null;
  return (
    <>
      <Node node={chart.root} />
      {chart.branches.length > 0 && (
        <div className="r-1y">
          <span className="r-4p"></span>
          <Branches columns={chart.branches} nested={false} />
        </div>
      )}
    </>
  );
}

function Branches({ columns, nested }: { columns: Column[]; nested: boolean }) {
  const last = columns.length - 1;
  return (
    <div className={nested ? 'r-6w' : 'r-6v'}>
      {columns.map((col, i) => (
        <div key={i} className="r-1y">
          {i === 0
            ? <span className="r-4q"><span className="r-4r"></span></span>
            : i === last
              ? <span className="r-4v"><span className="r-4w"></span></span>
              : <span className="r-3j"><span className="r-3k"></span></span>}
          <span className="r-2d"></span>
          <ColumnView column={col} />
        </div>
      ))}
    </div>
  );
}

function ColumnView({ column }: { column: Column }) {
  const items = column.map((item, i) => {
    if (item.kind === 'node') return <Node key={item.node.id} node={item.node} />;
    if (item.kind === 'rule') return <span key={`rule-${i}`} className="r-2a"></span>;
    return (
      <div key={`branches-${i}`} className="r-1y">
        <span className="r-4p"></span>
        <Branches columns={item.branches} nested />
      </div>
    );
  });
  if (items.length === 1) return <>{items}</>;
  return <div className="r-1y">{items}</div>;
}

function Node({ node }: { node: NodeView }) {
  return (
    <label htmlFor={`sn-${node.id}`} className="sn-lab">
      <div data-for={node.id} className={node.boxCls}>
        <span className={node.tintCls}></span>
        <div className="r-z">
          <div className="r-10"><span className="r-11">{node.name}</span><span className="r-12">{node.division}</span></div>
          {node.elevated && <span title="Elevated" className="r-72"><AlertIcon size={14} /></span>}
        </div>
        <div className="r-13">
          <span className="r-14"><PeopleIcon size={12} />{node.holders}</span>
          <span className="r-15"></span>
          <span className="r-16">{node.capsText}</span>
        </div>
      </div>
    </label>
  );
}

/* -------------------------------------------------------------
   The inspector. One panel per role; the radio decides which shows.
   ------------------------------------------------------------- */
const VERDICT: Record<Verdict, { cls: string; label: string; icon: ReactNode }> = {
  allowed:     { cls: 'r-c',  label: 'Allowed',     icon: <path d="M20 6L9 17l-5-5" /> },
  conditional: { cls: 'r-e', label: 'Conditional', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></> },
  denied:      { cls: 'r-b',  label: 'Denied',      icon: <path d="M18 6L6 18M6 6l12 12" /> },
};

function Meter({ fill, pct }: { fill: { cls: string; width: string | null }; pct: number }) {
  return (
    <div className="r-2">
      <span className="r-3"><span className={fill.cls} style={fill.width ? { width: fill.width } : undefined}></span></span>
      <span className="r-4">{pct}%</span>
    </div>
  );
}

function Inspector({ panel: p }: { panel: Panel }) {
  return (
    <div className={`sp sp-${p.id} r-1a`}>
      <div className="r-1b">
        <div className="r-1c">
          <span className={p.headCls}></span>
          <div className="r-y"><span className="r-1d">{p.division}</span><span className="r-1e">{p.name}</span></div>
          <button className="r-w"><Svg size={14}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></Svg></button>
        </div>
        <div className="r-1f">
          <div className="r-d"><span className="r-1g">{p.allowed}</span><span className="r-8">ALLOWED</span></div>
          <div className="r-d"><span className="r-1h">{p.conditional}</span><span className="r-8">CONDITIONAL</span></div>
          <div className="r-d"><span className="r-1i">{p.blocked}</span><span className="r-8">BLOCKED</span></div>
          <div className="r-1j"><span className="r-8">OF {p.total}</span><Meter fill={p.fill} pct={p.pct} /></div>
        </div>
        <div className="r-17">
          <div className="r-1k">
            {p.avatars.map((a, i) => (
              <span key={i} className={i === 0 ? 'r-1l' : 'r-v'}><span className="r-l">{a}</span></span>
            ))}
            {p.plus != null && <span className="r-v"><span className="r-57">+{p.plus}</span></span>}
          </div>
          <span className="r-s">{p.peopleText}</span>
          <span className="r-k"></span>
          <button className="r-x"><Svg size={14}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg><span>Compare</span></button>
        </div>
      </div>
      <div className="r-1m"><span className="r-1n">Permissions</span><span className="r-n">People</span><span className="r-n">History</span></div>
      <div className="r-1o">
        <div className="r-m">
          <span className="r-f">Key permissions</span>
          <div className="r-1p">
            {p.keys.map((k, i) => {
              const v = VERDICT[k.verdict];
              return (
                <div key={k.label} className={i === 0 ? 'r-1q' : 'r-j'}>
                  <span className="r-a">{k.label}<br /><span className="r-9">{k.scope}</span></span>
                  <span className={v.cls}><Svg size={12}>{v.icon}</Svg>{v.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="r-1r">
          <span className="r-f">Coverage by area</span>
          {p.coverage.map((c) => (
            <div key={c.area} className="r-5"><span className="r-6">{c.area}</span><Meter fill={c.fill} pct={c.pct} /></div>
          ))}
        </div>
        <div className="r-m">
          <span className="r-f">Where it comes from</span>
          <div className="r-u">
            <div className="r-g"><div className="r-h"><span className="r-o"></span><span className="r-p"></span></div><div className="r-q"><span className="r-r">{p.base.title}</span><span className="r-i">{p.base.text}</span></div></div>
            <div className="r-g"><div className="r-h"><span className="r-o"></span><span className="r-p"></span></div><div className="r-q"><span className="r-r">{p.line.title}</span><span className="r-i">{p.line.text}</span></div></div>
            <div className="r-g"><div className="r-h"><span className="r-1s"></span></div><div className="r-1t"><span className="r-1u">{p.scope.title}</span><span className="r-i">{p.scope.text}</span></div></div>
          </div>
        </div>
        {p.flag && (
          <div className="r-5l">
            <span className="r-5m"><AlertIcon size={15} /></span>
            <div className="r-2l"><span className="r-2q">{p.flag.title}</span><span className="r-2v">{p.flag.text}</span></div>
          </div>
        )}
      </div>
      <div className="r-1v">
        <button className="r-1w"><Svg size={14}><path d="M4 20h4L20 8l-4-4L4 16z" /></Svg><span>Edit permissions</span></button>
        <button className="r-1x"><Svg size={14}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg></button>
      </div>
    </div>
  );
}
