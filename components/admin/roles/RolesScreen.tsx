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
      <div className="r-3x">
        {model.ids.map((id) => (
          <input key={id} className="sn-in" type="radio" name="stc-screen-role" id={`sn-${id}`}
            defaultChecked={id === model.defaultId} />
        ))}
        <div className="sn-body roles-shell">
          <div className="roles-nav">
            <div className="r-3y"><span className="r-3z">S</span><span className="r-40">Stockport Truck Centre</span></div>
            {nav.map((s, i) => (
              <NavSection key={s.label} section={s} first={i === 0} />
            ))}
            <span className="r-h"></span>
            <div className="r-44"><span className="r-45">{me.initials}</span><div className="r-46"><span className="r-31">{me.name}</span><span className="r-47">{me.role}</span></div></div>
          </div>
          <div className="r-48">
            <div className="r-49">
              <div className="r-4a"><span className="r-4b">ADMINISTRATION</span><span className="r-4c">Roles and permissions</span></div>
              <span className="r-h"></span>
              <div className="r-4d">
                <div className="r-2i"><span className="r-32">{model.stats.roles}</span><span className="r-7">ROLES</span></div>
                <div className="r-2i"><span className="r-32">{model.stats.capabilities}</span><span className="r-7">CAPABILITIES</span></div>
                <div className="r-2i"><span className="r-4e">{model.stats.flags}</span><span className="r-7">FLAGS</span></div>
              </div>
              <button className="r-4f"><DocIcon size={14} /><span>Access review</span></button>
              <button className="r-4g"><PlusIcon size={14} /><span>New role</span></button>
            </div>
            <div className="r-4h">
              <div className="roles-canvas">
                <div className="r-4i">
                  <div className="r-33"><span className="r-4j">Chart</span><span className="r-34">Grid</span><span className="r-34">Matrix</span></div>
                  <div className="r-33"><span className="r-4k">Compact</span><span className="r-4l">Comfortable</span></div>
                  <span className="r-4m"></span>
                  <div className="r-4n">
                    {model.legend.map((l) => (
                      <span key={l.label} className="r-29"><span className={l.swatchCls}></span>{l.label}</span>
                    ))}
                  </div>
                  <span className="r-h"></span>
                  <div className="r-4o">
                    <button className="r-t" onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}><MinusIcon size={14} /></button>
                    <span className="r-4p">{zoom}%</span>
                    <button className="r-t" onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}><PlusIcon size={14} /></button>
                  </div>
                  <button className="r-12" onClick={fit}>
                    <Svg size={14}>
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </Svg>
                    <span>Fit</span>
                  </button>
                </div>
                <div data-canvas-body="1" className="roles-canvas-body" ref={body}>
                  <div className="r-4q" ref={tree} style={zoom === 100 ? undefined : { zoom: zoom / 100 }}>
                    <ChartTree chart={model.chart} />
                  </div>
                  {model.chart.direct.length > 0 && (
                    <div className="r-4u">
                      <div className="r-4v"><span className="r-4w">DIRECTLY ASSIGNED</span><span className="r-4x"></span><span className="r-4y">Outside the reporting line</span></div>
                      <div className="r-4z">
                        {model.chart.direct.map((n) => <Node key={n.id} node={n} />)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="r-51">
                  <span className="r-52">{model.chart.footer}</span>
                  <span className="r-h"></span>
                  <div className="r-53"><span className="r-54"></span><span className="r-55"></span><span className="r-56"></span><span className="r-57"></span><span className="r-58"></span><span className="r-59"></span><span className="r-5a"></span><span className="r-5b"></span><span className="r-5c"></span><span className="r-5d"></span><span className="r-5e"></span><span className="r-5f"></span><span className="r-5g"></span></div>
                </div>
              </div>
              <div className="roles-rail">
                <div className="r-5h">
                  <div className="r-5i">
                    <span className="r-5j"><Svg size={14}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg></span>
                    <input placeholder="Find a role or person" className="r-5k" onChange={(e) => setQ(e.target.value)} />
                  </div>
                  <div className="r-5l">
                    <span className={chip === null ? 'r-5m' : 'r-2n'} onClick={() => setChip(null)}>All</span>
                    {model.chips.map((c) => (
                      <span key={c.key} className={chip === c.key ? 'r-5m' : 'r-2n'} onClick={() => setChip(c.key)}>{c.label}</span>
                    ))}
                  </div>
                </div>
                <div className="r-5n">
                  {model.rail.map((g) => {
                    const rows = g.rows.map((r) => ({ ...r, shown: rowShown(r) }));
                    const groupShown = (chip === null || chip === g.key) && rows.some((r) => r.shown);
                    return (
                      <div key={g.key} className="r-q" hidden={!groupShown}>
                        <div className="r-2a"><span className={g.swatchCls}></span><span className="r-2b">{g.label}</span><span className="r-h"></span><span className="r-r">{g.rows.length}</span></div>
                        {rows.map((r) => (
                          <label key={r.id} htmlFor={`sn-${r.id}`} data-list={r.id} className="sn-row r-13" hidden={!r.shown}>
                            <span className="r-14">{r.name}</span><span className="r-r">{r.holders}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="r-5o">
                  <div className="r-5p">
                    <span className="r-5q"><AlertIcon size={14} /></span>
                    <div className="r-a"><span className="r-5r">{model.flags.title}</span><span className="r-5s">{model.flags.text}</span></div>
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
      {!first && <span className="r-41"></span>}
      {!first && <span className="r-42">{section.label.toUpperCase()}</span>}
      {section.items.map((i) => {
        const Icon = ICONS[i.icon];
        return (
          <span key={i.label} className={i.active ? 'r-43' : 'r-24'}>
            <Icon size={15} className="r-1" />
            <span className="r-h">{i.label}</span>
          </span>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------
   The chart.

   The kit's connector grammar, read off its file: the root, then a
   stem (`r-3a`) into a row of branches (`r-4s`; `r-4t` when nested).
   Each branch is a column (`r-1x`) that opens with its elbow: the
   first child turns right (`r-3b`), the last turns left (`r-3g`), any
   between carries a bar across (`r-2l`); then a drop (`r-22`) into
   what hangs there. A single report continues its column under a
   short rule (`r-1z`); two or more fan out again under their own stem.
   A column holding one thing is not wrapped, exactly as the kit does
   not wrap the FleetSmart+ card that stands alone.
   ------------------------------------------------------------- */
function ChartTree({ chart }: { chart: Chart }) {
  if (!chart.root) return null;
  return (
    <>
      <Node node={chart.root} />
      {chart.branches.length > 0 && (
        <div className="r-1x">
          <span className="r-3a"></span>
          <Branches columns={chart.branches} nested={false} />
        </div>
      )}
    </>
  );
}

function Branches({ columns, nested }: { columns: Column[]; nested: boolean }) {
  const last = columns.length - 1;
  return (
    <div className={nested ? 'r-4t' : 'r-4s'}>
      {columns.map((col, i) => (
        <div key={i} className="r-1x">
          {i === 0
            ? <span className="r-3b"><span className="r-3c"></span></span>
            : i === last
              ? <span className="r-3g"><span className="r-3h"></span></span>
              : <span className="r-2l"><span className="r-2m"></span></span>}
          <span className="r-22"></span>
          <ColumnView column={col} />
        </div>
      ))}
    </div>
  );
}

function ColumnView({ column }: { column: Column }) {
  const items = column.map((item, i) => {
    if (item.kind === 'node') return <Node key={item.node.id} node={item.node} />;
    if (item.kind === 'rule') return <span key={`rule-${i}`} className="r-1z"></span>;
    return (
      <div key={`branches-${i}`} className="r-1x">
        <span className="r-3a"></span>
        <Branches columns={item.branches} nested />
      </div>
    );
  });
  if (items.length === 1) return <>{items}</>;
  return <div className="r-1x">{items}</div>;
}

function Node({ node }: { node: NodeView }) {
  return (
    <label htmlFor={`sn-${node.id}`} className="sn-lab">
      <div data-for={node.id} className={node.boxCls}>
        <span className={node.tintCls}></span>
        <div className="r-u">
          <div className="r-v"><span className="r-w">{node.name}</span><span className="r-x">{node.division}</span></div>
          {node.elevated && <span title="Elevated" className="r-50"><AlertIcon size={14} /></span>}
        </div>
        <div className="r-y">
          <span className="r-z"><PeopleIcon size={12} />{node.holders}</span>
          <span className="r-10"></span>
          <span className="r-11">{node.capsText}</span>
        </div>
      </div>
    </label>
  );
}

/* -------------------------------------------------------------
   The inspector. One panel per role; the radio decides which shows.
   ------------------------------------------------------------- */
const VERDICT: Record<Verdict, { cls: string; label: string; icon: ReactNode }> = {
  allowed:     { cls: 'r-o',  label: 'Allowed',     icon: <path d="M20 6L9 17l-5-5" /> },
  conditional: { cls: 'r-1p', label: 'Conditional', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></> },
  denied:      { cls: 'r-s',  label: 'Denied',      icon: <path d="M18 6L6 18M6 6l12 12" /> },
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
    <div className={`sp sp-${p.id} r-15`}>
      <div className="r-16">
        <div className="r-17">
          <span className={p.headCls}></span>
          <div className="r-18"><span className="r-19">{p.division}</span><span className="r-1a">{p.name}</span></div>
          <button className="r-t"><Svg size={14}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></Svg></button>
        </div>
        <div className="r-1b">
          <div className="r-a"><span className="r-1c">{p.allowed}</span><span className="r-7">ALLOWED</span></div>
          <div className="r-a"><span className="r-1d">{p.conditional}</span><span className="r-7">CONDITIONAL</span></div>
          <div className="r-a"><span className="r-1e">{p.blocked}</span><span className="r-7">BLOCKED</span></div>
          <div className="r-1f"><span className="r-7">OF {p.total}</span><Meter fill={p.fill} pct={p.pct} /></div>
        </div>
        <div className="r-1g">
          <div className="r-1h">
            {p.avatars.map((a, i) => (
              <span key={i} className={i === 0 ? 'r-1i' : 'r-p'}><span className="r-g">{a}</span></span>
            ))}
            {p.plus != null && <span className="r-p"><span className="r-3p">+{p.plus}</span></span>}
          </div>
          <span className="r-1j">{p.peopleText}</span>
          <span className="r-h"></span>
          <button className="r-12"><Svg size={14}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg><span>Compare</span></button>
        </div>
      </div>
      <div className="r-1k"><span className="r-1l">Permissions</span><span className="r-i">People</span><span className="r-i">History</span></div>
      <div className="r-1m">
        <div className="r-j">
          <span className="r-b">Key permissions</span>
          <div className="r-1n">
            {p.keys.map((k, i) => {
              const v = VERDICT[k.verdict];
              return (
                <div key={k.label} className={i === 0 ? 'r-1o' : 'r-f'}>
                  <span className="r-8">{k.label}<br /><span className="r-9">{k.scope}</span></span>
                  <span className={v.cls}><Svg size={12}>{v.icon}</Svg>{v.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="r-1q">
          <span className="r-b">Coverage by area</span>
          {p.coverage.map((c) => (
            <div key={c.area} className="r-5"><span className="r-6">{c.area}</span><Meter fill={c.fill} pct={c.pct} /></div>
          ))}
        </div>
        <div className="r-j">
          <span className="r-b">Where it comes from</span>
          <div className="r-q">
            <div className="r-c"><div className="r-d"><span className="r-k"></span><span className="r-l"></span></div><div className="r-m"><span className="r-n">{p.base.title}</span><span className="r-e">{p.base.text}</span></div></div>
            <div className="r-c"><div className="r-d"><span className="r-k"></span><span className="r-l"></span></div><div className="r-m"><span className="r-n">{p.line.title}</span><span className="r-e">{p.line.text}</span></div></div>
            <div className="r-c"><div className="r-d"><span className="r-1r"></span></div><div className="r-1s"><span className="r-1t">{p.scope.title}</span><span className="r-e">{p.scope.text}</span></div></div>
          </div>
        </div>
        {p.flag && (
          <div className="r-6g">
            <span className="r-6h"><AlertIcon size={15} /></span>
            <div className="r-6i"><span className="r-31">{p.flag.title}</span><span className="r-6j">{p.flag.text}</span></div>
          </div>
        )}
      </div>
      <div className="r-1u">
        <button className="r-1v"><Svg size={14}><path d="M4 20h4L20 8l-4-4L4 16z" /></Svg><span>Edit permissions</span></button>
        <button className="r-1w"><Svg size={14}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg></button>
      </div>
    </div>
  );
}
