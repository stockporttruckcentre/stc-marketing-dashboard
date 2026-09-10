'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronRight, ChevronDown, Loader, Check, History, Users, ShieldAlert,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { EmptyState, NotProvisioned, Skeleton, Alert } from '@/components/kit/primitives';
import { node, part, tintFor, swatchFor, spacing } from '@/lib/admin/roles-kit';

/* =============================================================
   Roles, as the kit draws them.

   From the business, sending `docs/source/STCUIRoles.html`:

     I think the org chart tab is poorly laid out, messy, not fully
     respecting our UI. Attached is a kit from claude design for just
     this tab only. It's not telling you to use/add all of this content
     in the kit, it's guidance to make the page more interactive and
     understandable for techy and non techy users.

     Within here, I should be able to also manage what each role type
     can do, which auto-affects users within that role on their
     role-inherited permissions.

   ---- Not one number in this file ----

   Every length, colour, weight and radius comes from
   `lib/admin/roles-kit.ts`, which reads
   `lib/admin/roles-kit.generated.ts`, which a browser read off the kit.
   The first version of this screen was authored from a description of
   what an org chart looks like, and that is the exact mistake CLAUDE.md
   was rewritten to stop. `npm run check:invention` enforces it on the
   text, so it cannot come back by accident.

   ---- What this screen shows, and what it honestly cannot ----

   The kit draws five verdicts: Allowed, Denied, Conditional, Inherited
   and Not in role. This database supports two of them. A row in
   `role_template_capabilities` means the role holds the capability and
   its absence means it does not, so Allowed and Not in role are the
   whole truth.

   Denied as a separate thing from absent, a condition like "under
   £250", and inheriting down the reporting line are three model
   changes, not three styles. Drawing them from data that cannot express
   them would put a Conditional pill on a permission with no condition,
   which is worse than not drawing it. The kit is guidance, and it says
   so.

   Scope IS real: `role_template_capabilities.scope` carries the kit's
   scope chip, one of own, assigned, team, department, project, company.

   ---- The tree is the hierarchy, not a picture of one ----

   A box sits under the box named by `role_templates.escalates_to`,
   which is the same column the access request flow reads to decide who
   gets asked. So the chart is not an illustration: if a box is under
   another box, that is who answers its requests.
   ============================================================= */

type Template = {
  id: string; slug: string; name: string; description: string | null;
  department: string | null; manages: string[]; escalates_to: string | null;
  sort_order: number; customised_at: string | null;
};

type Cap = {
  key: string; label: string; description: string;
  area: string; feature: string; danger: string; position: number;
};

type Grant = { role_template_id: string; capability: string; scope: string };
type Holder = { id: string; role_template_id: string; name: string; job_title: string | null };
type Line = {
  id: number; at: string; actor_label: string | null; kind: string;
  role_template_id: string; capability_label: string;
  scope_before: string | null; scope_after: string | null;
};

type Tree = Template & { children: Tree[] };

const DEPT: Record<string, string> = {
  exec: 'LEADERSHIP', sales: 'SALES', marketing: 'MARKETING',
  finance: 'FINANCE', admin: 'OFFICE',
};

/* The kit's own words for the six scopes the database carries. */
const SCOPE: Record<string, string> = {
  own: 'Their own',
  assigned: 'Assigned to them',
  team: 'Their team',
  department: 'Their department',
  project: 'Their projects',
  company: 'Everything',
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean)
  .slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/* ---- The loader and the screen are two components ----

   `RolesChart` reads the five tables and owns the writes. `RolesView`
   draws, from props, and knows nothing about Supabase. That split is
   what lets `app/roles-preview` mount the real screen with fabricated
   roles and a browser look at it, which is the step that was missing
   when this tab went live with every block overlapping. A component
   that can only be rendered behind a login is a component nobody
   renders before merging. */
export type RolesData = {
  roles: Template[]; caps: Cap[]; grants: Grant[]; holders: Holder[]; history: Line[];
};

export function RolesChart({ mayEdit }: { mayEdit: boolean }) {
  const supabase = createClient();

  const [roles, setRoles] = useState<Template[] | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [history, setHistory] = useState<Line[]>([]);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tpl, cat, gr, hd, hist] = await Promise.all([
      supabase.from('role_templates')
        .select('id, slug, name, description, department, manages, escalates_to, sort_order, customised_at')
        .eq('is_active', true).order('sort_order'),
      supabase.from('capability_catalog')
        .select('key, label, description, area, feature, danger, position')
        .eq('is_active', true).order('position'),
      supabase.from('role_template_capabilities').select('role_template_id, capability, scope'),
      supabase.from('role_holders').select('id, role_template_id, name, job_title').eq('is_active', true),
      supabase.from('role_capability_history').select('*').limit(40),
    ]);

    /* The roles arrive in 103, the shape columns in 105 and the history
       in 108. Until those are pasted this says which, rather than
       opening a raw schema error the way the Access tab used to. */
    const err = tpl.error ?? cat.error ?? gr.error;
    if (err?.code === '42P01' || err?.code === 'PGRST205' || err?.code === '42703') {
      setMissing(true); setRoles([]); return;
    }
    if (err) { setFailed(err.message); setRoles([]); return; }

    const list = (tpl.data ?? []) as Template[];
    setRoles(list);
    setCaps((cat.data ?? []) as Cap[]);
    setGrants((gr.data ?? []) as Grant[]);
    setHolders((hd.data ?? []) as Holder[]);
    /* The history is the newest table, so a database without 108 still
       draws the chart rather than refusing the whole screen. */
    setHistory(hist.error ? [] : ((hist.data ?? []) as Line[]));
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 5000);
    return () => clearTimeout(t);
  }, [said]);





  const toggle = useCallback(async (role: Template, cap: Cap, on: boolean, scope: string | null) => {
    setBusy(cap.key);
    setFailed(null);
    const { data, error } = await supabase.rpc('set_role_capability', {
      p_role: role.id,
      p_capability: cap.key,
      p_granted: on,
      p_scope: on ? scope : null,
    });
    setBusy(null);
    if (error) { setFailed(error.message); return; }
    const d = (data ?? {}) as { people?: number; takenOver?: boolean };
    const n = d.people ?? 0;
    setSaid(`${on ? 'Given to' : 'Taken off'} ${role.name}. `
      + `${n} ${n === 1 ? 'person is' : 'people are'} on that role, and it applies to `
      + `${n === 1 ? 'them' : 'all of them'} now.`);
    await load();
  }, [supabase, load]);

  const rescope = useCallback(async (role: Template, cap: Cap, scope: string) => {
    setBusy(cap.key);
    const { error } = await supabase.rpc('set_role_capability', {
      p_role: role.id, p_capability: cap.key, p_granted: true, p_scope: scope,
    });
    setBusy(null);
    if (error) { setFailed(error.message); return; }
    setSaid(`${cap.label} on ${role.name} is now ${SCOPE[scope] ?? scope}.`);
    await load();
  }, [supabase, load]);

  if (missing) {
    return (
      <NotProvisioned
        what="The eleven roles are not in this database yet, so there is no hierarchy to draw."
        needs="migrations 103, 105 and 108, which are the SQL handed over in chat"
      />
    );
  }

  if (!roles) {
    return (
      <div className="rk-loading" style={spacing() as React.CSSProperties}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} />)}
      </div>
    );
  }

  if (roles.length === 0) {
    return <EmptyState what="No roles" why={failed ?? 'Nothing came back from role_templates.'} />;
  }

  return (
    <RolesView
      data={{ roles, caps, grants, holders, history }}
      mayEdit={mayEdit}
      busy={busy}
      said={said}
      failed={failed}
      onToggle={toggle}
      onRescope={rescope}
    />
  );
}

/* -------------------------------------------------------------
   The screen. Props in, nothing fetched.
   ------------------------------------------------------------- */
export function RolesView({ data, mayEdit, busy, said, failed, onToggle, onRescope }: {
  data: RolesData;
  mayEdit: boolean;
  busy: string | null;
  said: string | null;
  failed: string | null;
  onToggle: (role: Template, cap: Cap, on: boolean, scope: string | null) => void | Promise<void>;
  onRescope: (role: Template, cap: Cap, scope: string) => void | Promise<void>;
}) {
  const { roles, caps, grants, holders, history } = data;
  const [picked, setPicked] = useState<string | null>(roles[0]?.slug ?? null);
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  const held = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const g of grants) {
      if (!m.has(g.role_template_id)) m.set(g.role_template_id, new Map());
      m.get(g.role_template_id)!.set(g.capability, g.scope);
    }
    return m;
  }, [grants]);

  const roots: Tree[] = useMemo(() => {
    const bySlug = new Map(roles.map((r) => [r.slug, { ...r, children: [] as Tree[] }]));
    const out: Tree[] = [];
    for (const r of roles) {
      const n = bySlug.get(r.slug)!;
      const up = r.escalates_to ? bySlug.get(r.escalates_to) : undefined;
      if (up && up !== n) up.children.push(n); else out.push(n);
    }
    return out;
  }, [roles]);

  const current = roles.find((r) => r.slug === picked) ?? null;
  const mine = useMemo(
    () => (current ? (held.get(current.id) ?? new Map<string, string>()) : new Map<string, string>()),
    [current, held]);

  const areas = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const m = new Map<string, Cap[]>();
    for (const c of caps) {
      if (needle && !`${c.label} ${c.key} ${c.area} ${c.feature} ${c.description}`
        .toLowerCase().includes(needle)) continue;
      if (!m.has(c.area)) m.set(c.area, []);
      m.get(c.area)!.push(c);
    }
    return [...m.entries()];
  }, [caps, find]);


  const myHolders = current ? holders.filter((h) => h.role_template_id === current.id) : [];
  const myHistory = current ? history.filter((h) => h.role_template_id === current.id) : [];
  const total = caps.length;

  return (
    <div className="rk" style={spacing() as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {failed && <Alert tone="danger"><span>{failed}</span></Alert>}
      {said && <Alert tone="success"><span>{said}</span></Alert>}

      {/* ---- the chart ---- */}
      <div className="rk-panel">
        <div className="rk-bar">
          <label className="rk-search" style={part('search')}>
            <Search size={13} />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a role or a permission"
            />
          </label>
          <div className="rk-legend">
            {Object.entries(DEPT).map(([key, label]) => (
              <span key={key} className="rk-legend__item" style={part('legendItem')}>
                <i style={swatchFor(key)} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="rk-canvas">
          <div className="rk-forest">
            {roots.map((r) => (
              <Branch key={r.slug} n={r} picked={picked} onPick={setPicked}
                      held={held} holders={holders} total={total} />
            ))}
          </div>
        </div>

        <p className="rk-foot" style={part('capKey')}>
          A box sits under whoever answers its access requests. That is the same
          column the request flow reads, so this is the hierarchy rather than a
          drawing of it.
        </p>
      </div>

      {/* ---- the role ---- */}
      {current && (
        <div className="rk-detail">
          <div className="rk-panel rk-panel--pad">
            <div className="rk-head">
              <div>
                <div style={part('listGroupHead')}>
                  {DEPT[current.department ?? ''] ?? 'ROLE'} · ROLE
                </div>
                <h3 style={{ ...part('roleName'), fontSize: undefined }} className="rk-title">
                  {current.name}
                </h3>
                <p className="rk-sub" style={part('capSource')}>
                  {current.escalates_to
                    ? `Asks ${roles.find((r) => r.slug === current.escalates_to)?.name} for anything it does not hold.`
                    : 'Asks nobody. This is the top of the tree.'}
                  {current.manages.length > 0
                    && ` Runs ${current.manages.map((d) => (DEPT[d] ?? d).toLowerCase()).join(' and ')}.`}
                </p>
              </div>

              <div className="rk-stats">
                <Stat n={mine.size} what="ALLOWED" tone="on" />
                <Stat n={total - mine.size} what="NOT IN ROLE" tone="off" />
              </div>
            </div>

            {current.description && (
              <p className="rk-blurb" style={part('capSource')}>{current.description}</p>
            )}

            <div className="rk-cards">
              <div className="rk-card">
                <div style={part('holdersHead')} className="rk-card__head">Coverage by area</div>
                {areasOf(caps).map(([area, list]) => {
                  const n = list.filter((c) => mine.has(c.key)).length;
                  return <Meter key={area} label={area} n={n} of={list.length} />;
                })}
              </div>

              <div className="rk-card">
                <div style={part('holdersHead')} className="rk-card__head">
                  <Users size={12} /> Holders
                </div>
                {myHolders.length === 0 ? (
                  <p style={part('capSource')}>Nobody is on this role.</p>
                ) : (
                  <ul className="rk-holders">
                    {myHolders.map((h) => (
                      <li key={h.id}>
                        <span className="rk-avatar" style={part('initials')}>{initials(h.name)}</span>
                        <span style={part('roleName')}>{h.name}</span>
                        {h.job_title && <span style={part('capSource')}>{h.job_title}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <p style={part('capSource')} className="rk-note">
                  A change below reaches every one of them at once. It does not
                  reach anybody who has been allowed or refused that permission
                  on their own account: a decision about one person still wins.
                </p>
              </div>
            </div>
          </div>

          {/* ---- what it can do ---- */}
          <div className="rk-panel">
            <div className="rk-bar">
              <span style={part('holdersHead')}>What {current.name} can do</span>
              {mayEdit && (
                <button
                  type="button"
                  className="rk-btn"
                  style={editing ? part('segmentOn') : part('buttonPrimary')}
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? <><Check size={13} /> Done</> : <>Edit role</>}
                </button>
              )}
            </div>

            {editing && (
              <div className="rk-editing">
                <Alert tone="warning">
                  <span>
                    <strong>Every switch here applies at once.</strong> There is no
                    save. {myHolders.length === 0
                      ? 'Nobody is on this role yet, so nothing changes for anybody today.'
                      : `${myHolders.length} ${myHolders.length === 1 ? 'person is' : 'people are'} on this role and it takes effect on their next request.`}
                    {' '}From the first change the migrations stop maintaining this
                    role, so a re-run of the setup SQL will not undo your work.
                  </span>
                </Alert>
              </div>
            )}

            {areas.length === 0 ? (
              <div className="rk-empty">
                <EmptyState what="Nothing matches" why="No permission matches what you typed." />
              </div>
            ) : areas.map(([area, list]) => {
              const shown = open.has(area) || find.trim() !== '';
              const n = list.filter((c) => mine.has(c.key)).length;
              return (
                <div key={area}>
                  <button
                    type="button"
                    className="rk-group"
                    style={part('groupHead')}
                    onClick={() => setOpen((s) => {
                      const next = new Set(s);
                      if (next.has(area)) next.delete(area); else next.add(area);
                      return next;
                    })}
                  >
                    {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span style={part('roleName')}>{area}</span>
                    <span className="rk-count" style={part('groupCount')}>{n}/{list.length}</span>
                    <span className="rk-spacer" />
                    <Bar n={n} of={list.length} />
                  </button>

                  {shown && list.map((c) => {
                    const on = mine.has(c.key);
                    return (
                      <div key={c.key} className="rk-row">
                        <span className="rk-row__what">
                          <span style={part('capLabel')}>
                            {c.danger !== 'routine' && (
                              <ShieldAlert size={12} className="rk-danger" aria-label={c.danger} />
                            )}
                            {c.label}
                          </span>
                          <span style={part('capKey')}>{c.key}</span>
                        </span>

                        <span
                          className="rk-verdict"
                          style={on ? part('verdictAllowed') : part('verdictAbsent')}
                        >
                          {on ? <><Check size={12} /> Allowed</> : 'Not in role'}
                        </span>

                        {on ? (
                          editing ? (
                            <select
                              className="rk-scope"
                              style={part('scopeOn')}
                              value={mine.get(c.key) ?? 'own'}
                              disabled={busy === c.key}
                              onChange={(e) => current && void onRescope(current, c, e.target.value)}
                            >
                              {Object.entries(SCOPE).map(([k, label]) => (
                                <option key={k} value={k}>{label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="rk-scope" style={part('scopeOn')}>
                              {SCOPE[mine.get(c.key) ?? 'own'] ?? mine.get(c.key)}
                            </span>
                          )
                        ) : (
                          <span className="rk-scope" style={part('scopeOff')}>no scope</span>
                        )}

                        {editing ? (
                          <button
                            type="button"
                            className="rk-btn"
                            style={on ? part('buttonDanger') : part('buttonPrimary')}
                            disabled={busy === c.key}
                            onClick={() => current && void onToggle(current, c, !on, mine.get(c.key) ?? null)}
                          >
                            {busy === c.key
                              ? <Loader size={12} className="spin" />
                              : (on ? 'Take away' : 'Give')}
                          </button>
                        ) : <span />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {myHistory.length > 0 && (
            <div className="rk-panel rk-panel--pad">
              <div style={part('holdersHead')} className="rk-card__head">
                <History size={12} /> What has been changed on this role
              </div>
              <ul className="rk-audit">
                {myHistory.map((h) => (
                  <li key={h.id}>
                    <span style={part('capLabel')}>
                      {h.kind === 'granted' ? 'Gave' : h.kind === 'revoked' ? 'Took away' : 'Rescoped'}
                      {' '}<strong>{h.capability_label}</strong>
                      {h.kind === 'rescoped' && h.scope_after
                        && ` to ${SCOPE[h.scope_after] ?? h.scope_after}`}
                    </span>
                    <span style={part('capSource')}>
                      {h.actor_label ?? 'Somebody'} · {new Date(h.at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* Every area with its capabilities, unfiltered, for the coverage meter.
   Filtering this would make the share a share of the search. */
function areasOf(caps: Cap[]): [string, Cap[]][] {
  const m = new Map<string, Cap[]>();
  for (const c of caps) {
    if (!m.has(c.area)) m.set(c.area, []);
    m.get(c.area)!.push(c);
  }
  return [...m.entries()];
}

function Branch({ n, picked, onPick, held, holders, total }: {
  n: Tree; picked: string | null; onPick: (s: string) => void;
  held: Map<string, Map<string, string>>; holders: Holder[]; total: number;
}) {
  const count = held.get(n.id)?.size ?? 0;
  const people = holders.filter((h) => h.role_template_id === n.id).length;
  const on = picked === n.slug;

  return (
    <div className="rk-branch">
      <button
        type="button"
        className="rk-node"
        style={on ? node('nodeSelected') : node(n.department === 'exec' ? 'nodeExec' : 'node')}
        onClick={() => onPick(n.slug)}
        aria-pressed={on}
      >
        {/* The kit's card, row for row: a tint bar down the left, a top
            row of initials beside name and division stacked, a bottom
            row of people, a hairline, and the capability count. */}
        <i className="rk-node__tint" style={tintFor(n.department)} />
        <span style={part('nodeTop')}>
          <span className="rk-node__face" style={part('initials', 'wh')}>{initials(n.name)}</span>
          <span style={part('nodeWords')}>
            <span style={part('roleName')}>{n.name}</span>
            <span style={part('roleDivision')}>{DEPT[n.department ?? ''] ?? ''}</span>
          </span>
        </span>
        <span style={part('nodeBottom')}>
          <span style={part('nodePeople')}><Users size={12} />{people}</span>
          <span style={part('nodeDivider', 'wh')} />
          <span style={part('roleCount')}>{count} of {total}</span>
        </span>
      </button>

      {n.children.length > 0 && (
        <div className="rk-kids">
          {n.children.map((c) => (
            <Branch key={c.slug} n={c} picked={picked} onPick={onPick}
                    held={held} holders={holders} total={total} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ n, what, tone }: { n: number; what: string; tone: 'on' | 'off' }) {
  return (
    <div className="rk-stat">
      <span
        className="rk-stat__n"
        style={tone === 'on' ? part('verdictAllowed') : part('verdictAbsent')}
      >
        {n}
      </span>
      <span style={part('statAllowed')}>{what}</span>
    </div>
  );
}

function Bar({ n, of }: { n: number; of: number }) {
  const pct = of === 0 ? 0 : Math.round((n / of) * 100);
  return (
    <span className="rk-bar-track" style={part('meterTrack', 'h')}>
      <span
        className="rk-bar-fill"
        style={{ width: `${pct}%`, background: part('verdictAllowed').color }}
      />
    </span>
  );
}

function Meter({ label, n, of }: { label: string; n: number; of: number }) {
  const pct = of === 0 ? 0 : Math.round((n / of) * 100);
  return (
    <div className="rk-meter">
      <span style={part('capLabel')}>{label}</span>
      <Bar n={n} of={of} />
      <span style={part('roleCount')}>{pct}%</span>
    </div>
  );
}

/* Layout only. Every colour, size and radius on an element that has one
   comes from the kit through `part()` and `node()`; what is here is
   flow, and the connectors, which the kit draws as rules rather than as
   a value. */
const CSS = `
.rk { container-type: inline-size; }
.rk-panel { border: var(--rk-rule) solid var(--border); border-radius: var(--rk-radius); background: var(--surface); margin-bottom: var(--rk-gap); }
.rk-panel--pad { padding: var(--rk-card-pad) var(--rk-card-pad-x); }
.rk-bar { display: flex; align-items: center; gap: var(--rk-gap); padding: var(--rk-pad) var(--rk-pad-x); border-bottom: var(--rk-rule) solid var(--border); flex-wrap: wrap; }
.rk-search { display: inline-flex; align-items: center; gap: var(--rk-node-gap); flex: 1 1 auto; min-width: 0; }
.rk-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.rk-legend { display: flex; gap: var(--rk-row-gap); flex-wrap: wrap; margin-left: auto; }
.rk-legend__item i { flex-shrink: 0; }

.rk-canvas { padding: var(--rk-card-pad) var(--rk-pad-x); overflow-x: auto; }
.rk-forest { display: flex; gap: var(--rk-card-pad-x); justify-content: center; min-width: min-content; }
.rk-branch { display: flex; flex-direction: column; align-items: center; position: relative; }

.rk-node { position: relative; text-align: left; cursor: pointer; overflow: hidden; z-index: 1; font: inherit; }
.rk-node__tint { position: absolute; left: 0; top: 0; bottom: 0; }
.rk-node__face { flex-shrink: 0; }

.rk-kids { display: flex; gap: var(--rk-card-pad); padding-top: calc(var(--rk-drop) * 2); position: relative; }
.rk-kids::before { content: ''; position: absolute; top: 0; left: var(--rk-mid); width: var(--rk-rule); height: var(--rk-drop); background: var(--border); }
.rk-kids::after { content: ''; position: absolute; top: var(--rk-drop); left: 0; right: 0; height: var(--rk-rule); background: var(--border); }
.rk-kids > .rk-branch::before { content: ''; position: absolute; top: calc(var(--rk-drop) * -1); left: var(--rk-mid); width: var(--rk-rule); height: var(--rk-drop); background: var(--border); }
.rk-kids > .rk-branch:first-child::after,
.rk-kids > .rk-branch:last-child::after { content: ''; position: absolute; top: calc(var(--rk-drop) * -1); height: var(--rk-rule); background: var(--surface); z-index: 1; }
.rk-kids > .rk-branch:first-child::after { left: calc(var(--rk-card-pad) * -1); right: var(--rk-mid); }
.rk-kids > .rk-branch:last-child::after { left: var(--rk-mid); right: calc(var(--rk-card-pad) * -1); }
.rk-kids > .rk-branch:only-child::after { display: none; }

.rk-foot { padding: var(--rk-none) var(--rk-pad-x) var(--rk-pad); }

.rk-head { display: flex; gap: var(--rk-card-pad-x); align-items: flex-start; flex-wrap: wrap; }
.rk-title { margin: 0; }
.rk-sub, .rk-blurb { margin: 0; }
.rk-blurb { margin-top: var(--rk-row-pad); }
.rk-stats { display: flex; gap: var(--rk-card-pad-x); margin-left: auto; flex-wrap: wrap; }
.rk-stat { display: flex; flex-direction: column; align-items: flex-end; }
.rk-stat__n { background: transparent; padding: 0; }

.rk-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min-content, 1fr)); gap: var(--rk-gap); margin-top: var(--rk-card-pad); }
.rk-card { border: var(--rk-rule) solid var(--border); border-radius: var(--rk-radius); padding: var(--rk-card-pad) var(--rk-card-pad-x); }
.rk-card__head { display: flex; align-items: center; gap: var(--rk-node-gap); margin-bottom: var(--rk-row-pad); }
.rk-holders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--rk-node-gap); }
.rk-holders li { display: flex; align-items: center; gap: var(--rk-node-gap); }
.rk-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--surface-sunken); aspect-ratio: 1; padding: var(--rk-node-gap); }
.rk-note { margin: var(--rk-row-pad) var(--rk-none) var(--rk-none); }

.rk-meter { display: flex; align-items: center; gap: var(--rk-row-gap); padding: calc(var(--rk-row-pad) / 2) var(--rk-none); }
.rk-meter > :first-child { flex: 1 1 auto; min-width: 0; }
.rk-meter .rk-bar-track { flex: var(--rk-track); }
.rk-bar-track { display: block; overflow: hidden; }
.rk-bar-fill { display: block; height: var(--rk-all); }

.rk-editing { padding: var(--rk-pad) var(--rk-pad-x) var(--rk-none); }
.rk-empty { padding: var(--rk-card-pad); }

.rk-group { display: flex; align-items: center; gap: var(--rk-node-gap); width: var(--rk-all); padding: var(--rk-pad) var(--rk-pad-x); border: 0; border-bottom: var(--rk-rule) solid var(--border); background: transparent; cursor: pointer; text-align: left; }
.rk-count { flex-shrink: 0; }
.rk-spacer { flex: 1; }
.rk-group .rk-bar-track { flex: var(--rk-track); flex-shrink: 0; }

.rk-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--rk-row-gap); padding: var(--rk-row-pad) var(--rk-row-pad-x) var(--rk-row-pad) calc(var(--rk-row-pad-x) * 2); border-bottom: var(--rk-rule) solid var(--border); }
.rk-row__what { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.rk-row__what > span { display: inline-flex; align-items: center; gap: var(--rk-node-gap); min-width: 0; }
.rk-danger { color: var(--warning); flex-shrink: 0; }
.rk-verdict { display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
.rk-scope { white-space: nowrap; }
select.rk-scope { cursor: pointer; }
.rk-btn { display: inline-flex; align-items: center; gap: var(--rk-node-gap); cursor: pointer; white-space: nowrap; }
.rk-btn:disabled { cursor: default; opacity: 0.6; }

.rk-audit { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rk-audit li { display: flex; flex-direction: column; padding: var(--rk-row-pad) 0; border-bottom: var(--rk-rule) solid var(--border); }
.rk-audit li:last-child { border-bottom: 0; }
.rk-loading { display: flex; flex-direction: column; gap: var(--rk-node-gap); }

/* ---- The row folds when it runs out of room ----

   Not at a screen width. A breakpoint is a number somebody picks, and
   there is no measurement in the kit it could be taken from, so it
   would be exactly the kind of invented value this file is not allowed
   to hold.

   flex-wrap on the two rows that can fold asks the same question and
   answers it from the content: they wrap when they do not fit, at
   whatever width that turns out to be.

   No backticks in here, either. This block lives inside a template
   literal, so one would end the string. */
`;
