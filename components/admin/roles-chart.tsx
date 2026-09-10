'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, ArrowUp, Users, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Card, PanelHead, Badge, Label, Skeleton, EmptyState, NotProvisioned, SearchInput,
} from '@/components/kit/primitives';

/* =============================================================
   The eleven roles, as the shape they actually are.

   From the business:

     Create a tab in admin for Roles next to People. It shows what
     permissions each role has access to so my team can understand what
     each role can and can't do, to determine who gets what role.

     Design the roles tab in an org chart style that's interactive so
     you can see the hierarchy and click to see what each role does.

   ---- Everything here is read, nothing is written ----

   This screen decides nothing. It is the answer to "what would happen
   if I put Dean on Sr Sales", asked before doing it rather than after.
   Changing somebody's role is still People, one person at a time, and
   still recorded against the name of whoever did it.

   ---- Where the content comes from ----

   The database, on every load. Three tables, all readable by anybody
   signed in:

     role_templates                the roles, and the tree
     role_template_capabilities    which role holds which
     capability_catalog            what each one is called, and means

   Deliberately NOT a list written into this file. A hand written
   summary of what a role can do is correct on the day it is typed and
   is a lie by the next migration, and this screen exists precisely so
   somebody can trust what it says. It was checked before it was built:
   eighty nine capabilities in the catalogue, eighty nine granted across
   the eleven roles, none on one side and not the other, and every one
   of the eighty nine gates a real screen or control.

   ---- The tree ----

   `escalates_to` is the parent, and it is the same column the request
   flow uses to decide who is asked when somebody wants a permission
   they do not hold. So this chart is not a drawing OF the hierarchy, it
   is the hierarchy: if a box sits under another box here, that is who
   gets the request.

   Developer and Managing Director have no parent and are drawn side by
   side at the top. Both hold everything.
   ============================================================= */

type Template = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  department: string | null;
  manages: string[];
  escalates_to: string | null;
  sort_order: number;
};

type Cap = {
  key: string;
  label: string;
  description: string;
  area: string;
  feature: string;
  danger: 'routine' | 'careful' | 'destructive' | string;
  position: number;
};

type Node = Template & { children: Node[] };

const DEPT_LABEL: Record<string, string> = {
  exec: 'Leadership',
  sales: 'Sales',
  marketing: 'Marketing',
  finance: 'Finance',
  admin: 'Office',
};

export function RolesChart() {
  const supabase = createClient();

  const [roles, setRoles] = useState<Template[] | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [held, setHeld] = useState<Record<string, Set<string>>>({});
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [find, setFind] = useState('');

  const load = useCallback(async () => {
    const [tpl, cat, grants] = await Promise.all([
      supabase.from('role_templates')
        .select('id, slug, name, description, department, manages, escalates_to, sort_order')
        .eq('is_active', true).order('sort_order'),
      supabase.from('capability_catalog')
        .select('key, label, description, area, feature, danger, position')
        .eq('is_active', true).order('position'),
      supabase.from('role_template_capabilities').select('role_template_id, capability'),
    ]);

    /* The roles arrive in migration 103 and the shape columns in 105.
       Until those are pasted in this is a tab that opens an error, which
       is the thing that went wrong with the Access screen. */
    const err = tpl.error ?? cat.error ?? grants.error;
    if (err?.code === '42P01' || err?.code === 'PGRST205'
        || err?.code === '42703') { setMissing(true); setRoles([]); return; }
    if (err) { setFailed(err.message); setRoles([]); return; }

    const list = (tpl.data ?? []) as Template[];
    const by: Record<string, Set<string>> = {};
    for (const g of (grants.data ?? []) as { role_template_id: string; capability: string }[]) {
      (by[g.role_template_id] ??= new Set()).add(g.capability);
    }
    setRoles(list);
    setCaps((cat.data ?? []) as Cap[]);
    setHeld(by);
    setPicked((p) => p ?? list[0]?.slug ?? null);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  /* The tree, from `escalates_to`. Anything with no parent, or a parent
     that is not in the list, is a root: a role whose manager has been
     retired must still be drawn rather than silently disappearing. */
  const roots: Node[] = useMemo(() => {
    if (!roles) return [];
    const bySlug = new Map(roles.map((r) => [r.slug, { ...r, children: [] as Node[] }]));
    const out: Node[] = [];
    for (const r of roles) {
      const node = bySlug.get(r.slug)!;
      const parent = r.escalates_to ? bySlug.get(r.escalates_to) : undefined;
      if (parent && parent !== node) parent.children.push(node);
      else out.push(node);
    }
    return out;
  }, [roles]);

  const current = roles?.find((r) => r.slug === picked) ?? null;
  const currentCaps = useMemo(() => {
    if (!current) return [];
    const mine = held[current.id] ?? new Set<string>();
    const needle = find.trim().toLowerCase();
    return caps
      .filter((c) => mine.has(c.key))
      .filter((c) => !needle
        || c.label.toLowerCase().includes(needle)
        || c.area.toLowerCase().includes(needle)
        || c.feature.toLowerCase().includes(needle)
        || c.description.toLowerCase().includes(needle));
  }, [current, held, caps, find]);

  /* Grouped the way the catalogue groups itself, so the order on screen
     is the order somebody maintaining the catalogue chose. */
  const byArea = useMemo(() => {
    const m = new Map<string, Cap[]>();
    for (const c of currentCaps) (m.get(c.area) ?? m.set(c.area, []).get(c.area)!).push(c);
    return [...m.entries()];
  }, [currentCaps]);

  const cannot = useMemo(() => {
    if (!current) return [];
    const mine = held[current.id] ?? new Set<string>();
    return caps.filter((c) => !mine.has(c.key));
  }, [current, held, caps]);

  if (missing) {
    return (
      <NotProvisioned
        what="The eleven roles are not in this database yet, so there is no hierarchy to draw."
        needs="migrations 103 and 105, which are the SQL handed over in chat"
      />
    );
  }

  if (!roles) {
    return (
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={22} />)}
        </div>
      </Card>
    );
  }

  if (roles.length === 0) {
    return <EmptyState what="No roles" why={failed ?? 'Nothing came back from role_templates.'} />;
  }

  return (
    <>
      <style>{CHART_CSS}</style>

      {failed && (
        <Card>
          <div style={{ color: 'var(--danger, #CF2417)', fontSize: 13 }}>{failed}</div>
        </Card>
      )}

      <div className="rc-split">
        {/* ---- the chart ---- */}
        <Card padded={false}>
          <PanelHead title="Who reports to whom" count={roles.length} />
          <div style={{ padding: '18px 14px 22px', overflowX: 'auto' }}>
            <div className="rc-forest">
              {roots.map((r) => (
                <Branch key={r.slug} node={r} picked={picked} onPick={setPicked} held={held} />
              ))}
            </div>
            <p className="rc-note">
              A box sits under the box that answers its access requests. That is the
              same column the request flow reads, so this is the hierarchy rather
              than a picture of it.
            </p>
          </div>
        </Card>

        {/* ---- what the chosen one can do ---- */}
        <Card padded={false}>
          <PanelHead
            title={current?.name ?? 'Pick a role'}
            count={current ? (held[current.id]?.size ?? 0) : undefined}
          />
          {!current ? (
            <div style={{ padding: 14 }}>
              <EmptyState what="Nothing chosen" why="Click a role on the chart." />
            </div>
          ) : (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {current.description && (
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)' }}>
                  {current.description}
                </p>
              )}

              <div className="rc-facts">
                <Fact k="Department" v={DEPT_LABEL[current.department ?? ''] ?? current.department ?? 'None'} />
                <Fact
                  k="Asks"
                  v={roles.find((r) => r.slug === current.escalates_to)?.name ?? 'Nobody, this is the top'}
                  icon={<ArrowUp size={12} />}
                />
                <Fact
                  k="Runs"
                  v={current.manages.length === 0
                    ? 'Their own work'
                    : current.manages.map((d) => DEPT_LABEL[d] ?? d).join(', ')}
                  icon={<Users size={12} />}
                />
              </div>

              <div style={{ maxWidth: 320 }}>
                <SearchInput
                  value={find}
                  onChange={setFind}
                  placeholder="Find a permission"
                  icon={<Search size={14} />}
                />
              </div>

              {byArea.length === 0 ? (
                <EmptyState
                  what={find ? 'Nothing matches' : 'This role holds nothing'}
                  why={find
                    ? 'No permission on this role matches what you typed.'
                    : 'Every permission is withheld from it.'}
                />
              ) : byArea.map(([area, list]) => (
                <div key={area}>
                  <Label>{area}</Label>
                  <div className="rc-caps">
                    {list.map((c) => (
                      <div key={c.key} className="rc-cap" title={c.description}>
                        <span className="rc-cap__label">
                          {c.danger !== 'routine' && (
                            <ShieldAlert
                              size={12}
                              style={{ color: 'var(--warning)', flexShrink: 0 }}
                              aria-label={c.danger}
                            />
                          )}
                          {c.label}
                        </span>
                        <span className="rc-cap__where">{c.feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {!find && cannot.length > 0 && (
                <details className="rc-cannot">
                  <summary>
                    And {cannot.length} {cannot.length === 1 ? 'thing' : 'things'} it cannot do
                  </summary>
                  <div className="rc-caps" style={{ marginTop: 8 }}>
                    {cannot.map((c) => (
                      <div key={c.key} className="rc-cap is-off" title={c.description}>
                        <span className="rc-cap__label">{c.label}</span>
                        <span className="rc-cap__where">{c.area}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* -------------------------------------------------------------
   One box and everything under it.

   Drawn with borders rather than SVG: the connectors are a pseudo
   element per node, so the tree reflows at any width and needs no
   measuring pass. A layout that has to measure itself flickers on first
   paint, and this one is above the fold.
   ------------------------------------------------------------- */
function Branch({ node, picked, onPick, held }: {
  node: Node;
  picked: string | null;
  onPick: (slug: string) => void;
  held: Record<string, Set<string>>;
}) {
  const n = held[node.id]?.size ?? 0;
  return (
    <div className="rc-branch">
      <button
        type="button"
        className={`rc-node${picked === node.slug ? ' is-on' : ''}`}
        onClick={() => onPick(node.slug)}
        aria-pressed={picked === node.slug}
      >
        <span className="rc-node__name">{node.name}</span>
        <span className="rc-node__n">
          <Badge tone={picked === node.slug ? 'accent' : 'neutral'}>{n}</Badge>
        </span>
      </button>

      {node.children.length > 0 && (
        <div className="rc-kids">
          {node.children.map((c) => (
            <Branch key={c.slug} node={c} picked={picked} onPick={onPick} held={held} />
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({ k, v, icon }: { k: string; v: string; icon?: React.ReactNode }) {
  return (
    <div className="rc-fact">
      <Label>{k}</Label>
      <span className="rc-fact__v">{icon}{v}</span>
    </div>
  );
}

/* Scoped by the `rc-` prefix. Written here rather than in globals.css
   because nothing else draws a tree and a rule nobody else uses is
   easier to change when it lives beside the thing it draws. */
const CHART_CSS = `
.rc-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1100px) { .rc-split { grid-template-columns: minmax(0, 1fr); } }

.rc-forest { display: flex; gap: 26px; flex-wrap: wrap; }
.rc-branch { display: flex; flex-direction: column; align-items: center; position: relative; }

.rc-node {
  display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
  color: inherit;
  font-family: var(--panton, inherit);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  position: relative; z-index: 1;
}
.rc-node:hover { border-color: var(--border-strong, var(--border)); }
.rc-node:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rc-node.is-on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.rc-node__name { font-weight: 600; }

/* The children row, and the three rules that join it to the parent. */
.rc-kids { display: flex; gap: 18px; padding-top: 20px; position: relative; }
.rc-kids::before {
  content: ''; position: absolute; top: 0; left: 50%;
  width: 1px; height: 10px; background: var(--border);
}
.rc-branch > .rc-kids > .rc-branch::before {
  content: ''; position: absolute; top: -10px; left: 50%;
  width: 1px; height: 10px; background: var(--border);
}
/* The horizontal rule across the children, trimmed to the outermost
   two so it does not overhang the first and last box. */
.rc-kids::after {
  content: ''; position: absolute; top: 10px;
  left: 0; right: 0; height: 1px; background: var(--border);
}
.rc-kids > .rc-branch:first-child::after,
.rc-kids > .rc-branch:last-child::after {
  content: ''; position: absolute; top: -10px; height: 1px;
  background: var(--surface); z-index: 0;
}
.rc-kids > .rc-branch:first-child::after { left: -20px; right: 50%; }
.rc-kids > .rc-branch:last-child::after { left: 50%; right: -20px; }
.rc-kids > .rc-branch:only-child::after { display: none; }

.rc-note {
  margin: 16px 0 0; font-size: 12px; line-height: 1.5;
  color: var(--text-subtle); max-width: 62ch;
}

.rc-facts { display: flex; gap: 18px; flex-wrap: wrap; }
.rc-fact { display: flex; flex-direction: column; gap: 3px; }
.rc-fact__v {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; color: var(--text);
}

.rc-caps { display: flex; flex-direction: column; margin-top: 6px; }
.rc-cap {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 30px; padding: 4px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.rc-cap:last-child { border-bottom: 0; }
.rc-cap__label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.rc-cap__where {
  font-size: 11.5px; color: var(--text-subtle);
  white-space: nowrap; flex-shrink: 0;
}
.rc-cap.is-off .rc-cap__label { color: var(--text-subtle); text-decoration: line-through; }

.rc-cannot summary {
  cursor: pointer; font-size: 12.5px; color: var(--text-muted);
  padding: 6px 0; border-top: 1px solid var(--border);
}
`;
