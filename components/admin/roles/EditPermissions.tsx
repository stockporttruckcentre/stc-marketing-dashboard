'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Cap, Template } from './model';
import { Svg, AlertIcon, CheckIcon, CrossIcon, SearchIcon } from './icons';

/* =============================================================
   The Edit permissions modal, as
   `docs/source/roles_hub/roles-edit-permissions.html` draws it.

   From that file's own opening comment:

     REPEATING REGIONS (loop these, keep every wrapper and class):
       - The capability rows: one row per capability, with a three-way
         verdict control.
       - The `changed` marker and the amber row tint appear only on
         modified rows.
       - The risk flag at the foot is conditional: render it only when
         a change widens the role.

     Wire the three-way control to set_role_capability. The footer
     count is the number of dirty rows.

   ---- The three segments, and what each one means here ----

   The control has no scope picker, so two of its three positions map
   onto the database without ambiguity and one does not:

     Allowed      a grant at company scope.
     Denied       no grant.
     Conditional  a grant at some narrower scope, and WHICH narrower
                  scope is not something the control says.

   So Conditional restores the scope a capability already has, and is
   inert on a row that has never had one, with a title saying why. The
   alternative was to pick a default narrowing, and picking is the one
   thing this port is not allowed to do. It is named in the recap as a
   question for the business rather than answered here.

   ---- The row state the kit does not draw ----

   The kit supplies three row classes: first (`r-88`), subsequent
   (`r-5s`), and subsequent-and-changed (`r-89`, which carries the
   amber tint). A changed FIRST row has no class, because no row in the
   kit's example is both. `r-89` is used for it, which is right in
   every respect except that it also draws the top border a first row
   should not have. Losing the amber tint instead would lose the
   information the tint exists to carry. Flagged rather than papered
   over: one class would settle it.
   ============================================================= */

export type Verdict = 'allowed' | 'conditional' | 'denied';

/** What the database currently says, as the control's three positions. */
export function verdictOf(scope: string | null | undefined): Verdict {
  if (scope == null) return 'denied';
  return scope === 'company' ? 'allowed' : 'conditional';
}

export type Change = { cap: Cap; from: Verdict; to: Verdict; scope: string | null };

/** Widening is what the risk flag is about: more reach than before. */
const RANK: Record<Verdict, number> = { denied: 0, conditional: 1, allowed: 2 };
const widens = (c: Change) => RANK[c.to] > RANK[c.from];

export function EditPermissions({ role, caps, held, onClose, onSave, saving, failed }: {
  role: Template;
  caps: Cap[];
  /** Capability key to its current scope. Absent means no grant. */
  held: Map<string, string>;
  onClose: () => void;
  onSave: (changes: Change[]) => void | Promise<void>;
  saving: boolean;
  failed: string | null;
}) {
  const [draft, setDraft] = useState<Map<string, Verdict>>(new Map());
  const [q, setQ] = useState('');

  /* Escape closes it, as it closes every other dialog in this
     application. Found by `npm run check:roles-drive`, which presses
     the key and asserts the modal goes: the handler was on the role
     menu and not here, and nothing that only renders the screen could
     have noticed. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const now = (key: string): Verdict => draft.get(key) ?? verdictOf(held.get(key));

  const changes = useMemo<Change[]>(() => caps.flatMap((c) => {
    const from = verdictOf(held.get(c.key));
    const to = draft.get(c.key);
    return to && to !== from ? [{ cap: c, from, to, scope: held.get(c.key) ?? null }] : [];
  }), [caps, held, draft]);

  const widening = changes.filter(widens);
  const needle = q.trim().toLowerCase();
  const rows = caps.filter((c) => needle === '' || c.label.toLowerCase().includes(needle)
    || c.area.toLowerCase().includes(needle) || c.key.toLowerCase().includes(needle));

  const set = (key: string, to: Verdict) =>
    setDraft((was) => { const next = new Map(was); next.set(key, to); return next; });

  /* Conditional can only restore a scope the capability already has. */
  const mayCondition = (key: string) => {
    const s = held.get(key);
    return s != null && s !== 'company';
  };

  const n = changes.length;
  return (
    <div className="roles-modal" onClick={onClose}>
      <div className="r-3z" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="r-40">
          <span className="r-41">Edit permissions · {role.name}</span>
          <button className="r-w" onClick={onClose}><Svg size={14}><CrossIcon /></Svg></button>
        </div>
        <div className="r-42">
          <div className="r-86">
            <div className="r-5n">
              <span className="r-35"><Svg size={14}><SearchIcon /></Svg></span>
              <input placeholder={`Filter ${caps.length} capabilities`} className="r-36"
                onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="r-k"></span>
            {n > 0 && <span className="r-87">{n} unsaved {n === 1 ? 'change' : 'changes'}</span>}
          </div>
          <div className="r-5o">
            {rows.map((c, i) => {
              const to = now(c.key);
              const changed = changes.some((x) => x.cap.key === c.key);
              const rowCls = changed ? 'r-89' : i === 0 ? 'r-88' : 'r-5s';
              const seg = (v: Verdict, first: boolean) =>
                (to === v ? (first ? 'r-5p' : 'r-5r') : (first ? 'r-5q' : 'r-2m'));
              const cond = mayCondition(c.key);
              return (
                <div key={c.key} className={rowCls}>
                  <span className="r-38">{c.label}{changed && <> <span className="r-8a">changed</span></>}</span>
                  <div className="r-39">
                    <span className={seg('allowed', true)} title="Allowed, company wide"
                      onClick={() => set(c.key, 'allowed')}><Svg size={12}><CheckIcon /></Svg></span>
                    <span className={seg('conditional', false)}
                      title={cond ? 'Conditional, at the scope it already has'
                        : 'Conditional needs a scope, and this capability has never had one'}
                      onClick={cond ? () => set(c.key, 'conditional') : undefined}><Svg size={12}><AlertIcon /></Svg></span>
                    <span className={seg('denied', false)} title="Denied"
                      onClick={() => set(c.key, 'denied')}><Svg size={12}><CrossIcon /></Svg></span>
                  </div>
                </div>
              );
            })}
          </div>
          {(widening.length > 0 || failed) && (
            <div className="r-5t">
              <span className="r-5u"><Svg size={15}><AlertIcon /></Svg></span>
              <div className="r-2l">
                <span className="r-2q">{failed ? 'That change was refused' : 'This change widens the role'}</span>
                <span className="r-2v">{failed ?? `${widening.length === 1
                  ? `${widening[0]!.cap.label} gives`
                  : `${widening.length} capabilities give`} ${role.name} more reach than before. `
                  + `Everybody on this role gets it the moment you save.`}</span>
              </div>
            </div>
          )}
        </div>
        <div className="r-43">
          <button className="r-3g" onClick={() => setDraft(new Map())}><span>Discard</span></button>
          <button className="r-31" onClick={() => void onSave(changes)}>
            <span>{saving ? 'Saving' : n === 0 ? 'Save' : `Save ${n} ${n === 1 ? 'change' : 'changes'}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
