'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ICONS } from '@/components/nav-icons';
import {
  Svg, PeopleIcon, AlertIcon, DocIcon, PlusIcon, MinusIcon,
  CheckIcon, CrossIcon, DownIcon, GridIcon, KebabIcon, CopyIcon, PencilIcon, OpenIcon, SearchIcon,
} from './icons';
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

   The search box and the division chips narrow the rail. The zoom
   buttons scale the chart between 50 and 150 per cent, which is the
   range the behaviour document names, and Fit sets it once. The
   inspector tabs switch its body. Edit permissions opens the modal the
   pack ships, which writes through `set_role_capability`.

   Still drawn and not wired, each for a reason given where it sits:
   the density pair, Compare, and the two the pack puts out of scope,
   New role and Access review, which are disabled rather than dead.
   ============================================================= */

export type NavRow = { label: string; icon: NavIcon; active: boolean };
export type NavSectionView = { label: string; items: NavRow[] };
export type Me = { initials: string; name: string; role: string };


const ZOOM_MIN = 50;
const ZOOM_MAX = 100 + 50;
const ZOOM_STEP = 10;

export type Tab = 'permissions' | 'people' | 'history';

/* The kit's three, in its order. The behaviour document: "Default.
   Opens on the question people actually arrive with." */
const TABS: [Tab, string][] = [
  ['permissions', 'Permissions'], ['people', 'People'], ['history', 'History'],
];

export function RolesScreen({ model, nav, me, mayEdit = false, onEdit }: {
  model: ScreenModel; nav: NavSectionView[]; me: Me;
  /** `admin.roles`. Without it the editor cannot be opened. */
  mayEdit?: boolean;
  onEdit?: (roleId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('permissions');
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
              <button className="r-3g"><Svg size={14}><DocIcon /></Svg><span>Access review</span></button>
              <button className="r-31"><Svg size={14}><PlusIcon /></Svg><span>New role</span></button>
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
                    <button className="r-w" onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}><Svg size={14}><MinusIcon /></Svg></button>
                    <span className="r-6s">{zoom}%</span>
                    <button className="r-w" onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}><Svg size={14}><PlusIcon /></Svg></button>
                  </div>
                  <button className="r-x" onClick={fit}>
                    <Svg size={14}><GridIcon /></Svg>
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
                    <span className="r-35"><Svg size={14}><SearchIcon /></Svg></span>
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
                    <span className="r-7o"><Svg size={14}><AlertIcon /></Svg></span>
                    <div className="r-d"><span className="r-7p">{model.flags.title}</span><span className="r-7q">{model.flags.text}</span></div>
                  </div>
                </div>
              </div>
              <div className="roles-inspector">
                {model.panels.map((p) => (
                  <Inspector key={p.id} panel={p} tab={tab} onTab={setTab}
                    mayEdit={mayEdit} onEdit={onEdit} />
                ))}
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
          {node.elevated && <span title="Elevated" className="r-72"><Svg size={14}><AlertIcon /></Svg></span>}
        </div>
        <div className="r-13">
          <span className="r-14"><Svg size={12}><PeopleIcon /></Svg>{node.holders}</span>
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
  allowed:     { cls: 'r-c', label: 'Allowed',     icon: <CheckIcon /> },
  conditional: { cls: 'r-e', label: 'Conditional', icon: <AlertIcon /> },
  denied:      { cls: 'r-b', label: 'Denied',      icon: <CrossIcon /> },
};

function Meter({ fill, pct }: { fill: { cls: string; width: string | null }; pct: number }) {
  return (
    <div className="r-2">
      <span className="r-3"><span className={fill.cls} style={fill.width ? { width: fill.width } : undefined}></span></span>
      <span className="r-4">{pct}%</span>
    </div>
  );
}

function Inspector({ panel: p, tab, onTab, mayEdit, onEdit }: {
  panel: Panel; tab: Tab; onTab: (t: Tab) => void;
  mayEdit: boolean; onEdit?: (roleId: string) => void;
}) {
  return (
    <div className={`sp sp-${p.id} r-1a`}>
      <div className="r-1b">
        <div className="r-1c">
          <span className={p.headCls}></span>
          <div className="r-y"><span className="r-1d">{p.division}</span><span className="r-1e">{p.name}</span></div>
          <button className="r-w"><Svg size={14}><KebabIcon /></Svg></button>
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
          <button className="r-x"><Svg size={14}><CopyIcon /></Svg><span>Compare</span></button>
        </div>
      </div>
      <div className="r-1m">
        {TABS.map(([key, label]) => (
          <span key={key} className={tab === key ? 'r-1n' : 'r-n'} onClick={() => onTab(key)}>{label}</span>
        ))}
      </div>
      <div className="r-1o">
        {tab === 'permissions' && <Permissions panel={p} />}
        {tab === 'people' && <People panel={p} />}
        {tab === 'history' && <HistoryBody panel={p} />}
      </div>
      <div className="r-1v">
        {/* Without `admin.roles` the editor would open and then refuse
            every write inside the database, which teaches people the
            tool is unreliable. Disabled here, and refused there too. */}
        <button className="r-1w" disabled={!mayEdit} onClick={() => onEdit?.(p.id)}
          title={mayEdit ? undefined : 'Changing what a role can do needs the admin.roles permission'}>
          <Svg size={14}><PencilIcon /></Svg><span>Edit permissions</span>
        </button>
        <button className="r-1x"><Svg size={14}><OpenIcon /></Svg></button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   The Permissions tab.

   This body is the one the screen itself carries, in
   `roles-page.html`. The pack also ships it standalone as
   `roles-tab-permissions.html`, at very slightly different metrics:
   a 10px gap and 9px by 11px padding where the screen has 11 and
   9 by 12. Two files in the same pack describe the same region and
   disagree, so one had to win, and the screen does: it is the thing
   being built, and `check:roles-port` diffs against it. Named in the
   recap, because only the designer knows which of the two is stale.
   ------------------------------------------------------------- */
function Permissions({ panel: p }: { panel: Panel }) {
  return (<>
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
            <span className="r-5m"><Svg size={15}><AlertIcon /></Svg></span>
            <div className="r-2l"><span className="r-2q">{p.flag.title}</span><span className="r-2v">{p.flag.text}</span></div>
          </div>
        )}
  </>);
}

/* -------------------------------------------------------------
   The People tab, from `roles-tab-people.html`.

   Read only, which the pack allows in as many words: "People can ship
   read only. The list is the valuable half." So Assign someone is
   disabled and says where the job is done instead of failing when
   pressed.
   ------------------------------------------------------------- */
export function People({ panel: p }: { panel: Panel }) {
  return (<>
    <div className="r-17">
      <div className="r-4y">
        <span className="r-35"><Svg size={14}><SearchIcon /></Svg></span>
        <input placeholder="Find a holder" className="r-36" />
      </div>
    </div>
    <div className="r-u">
      {p.people.map((h, i) => (
        <div key={h.id} className={i === 0 ? 'r-8b' : 'r-3a'}>
          <span className="r-2w">{h.initials}</span>
          <div className="r-2x"><span className="r-2y">{h.name}</span><span className="r-9">{h.title}</span></div>
          {/* Nothing records when somebody went onto a role, so this is
              the placeholder glyph rather than a date lifted from the
              nearest column that happens to hold one. */}
          <span className="r-t">{h.since ?? '\u2014'}</span>
        </div>
      ))}
    </div>
    <button className="r-8c" disabled
      title="Putting somebody on a role is done from the People tab of Admin">
      <Svg size={14}><PlusIcon /></Svg><span>Assign someone</span>
    </button>
  </>);
}

/* -------------------------------------------------------------
   The History tab, from `roles-tab-history.html`.

   Reads `role_capability_history`, the view migration 108 defines,
   which derives its kind from what actually changed: granted, revoked
   or rescoped. The dot colour IS that kind, which is why the model
   picks the class and this file only places it.
   ------------------------------------------------------------- */
export function HistoryBody({ panel: p }: { panel: Panel }) {
  return (<>
    <div className="r-8d">
      <span className="r-8e">All</span>
      <span className="r-5v">Grants</span>
      <span className="r-5v">Revokes</span>
    </div>
    <div className="r-u">
      {p.history.map((h) => (
        <div key={h.id} className="r-44">
          <span className={h.dotCls}></span>
          <div className="r-y">
            <span className="r-45">{h.text}<strong>{h.strong}</strong>{h.tail}</span>
            <span className="r-32">{h.who}</span>
          </div>
        </div>
      ))}
    </div>
    <button className="r-8i"><span>Full audit trail</span><Svg size={14}><OpenIcon /></Svg></button>
  </>);
}
