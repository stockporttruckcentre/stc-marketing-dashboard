'use client';

import type { Comparison, Verdict } from './model';
import { Svg, ArrowIcon, CrossIcon, CheckIcon, AlertIcon } from './icons';

/* =============================================================
   Compare, from `docs/source/roles_hub/roles-compare.html`.

   The behaviour document is exact about how it is reached:

     Shift-click a second node to compare.
     Density is a canvas setting, not a per-role one.

   and about where it goes:

     Replaces the inspector body while two roles are selected.

   So the screen holds the second role, the inspector swaps its body for
   this, and closing it puts the tabs back. Every capability is listed,
   the rows where the two agree drawn plainly and the rows where they
   differ tinted, which is the kit's own distinction between `r-3c` and
   `r-48`.
   ============================================================= */

const VERDICT: Record<Verdict, { cls: string; label: string; icon: React.ReactNode }> = {
  allowed: { cls: 'r-c', label: 'Allowed', icon: <CheckIcon /> },
  conditional: { cls: 'r-e', label: 'Conditional', icon: <AlertIcon /> },
  denied: { cls: 'r-b', label: 'Denied', icon: <CrossIcon /> },
};

/** The kit's column heads are the two roles, shortened to fit 116px. */
const short = (name: string) => (name.length <= 14 ? name : `${name.slice(0, 13)}…`).toUpperCase();

export function Compare({ what, onClose }: { what: Comparison; onClose: () => void }) {
  return (
    <div className="r-92">
      <div className="r-93">
        <span className="r-94">COMPARING</span>
        <span className="r-5y"><span className="r-5z">{what.a.initials}</span>{what.a.name}</span>
        <span className="r-95"><Svg size={15}><ArrowIcon /></Svg></span>
        <span className="r-5y"><span className="r-5z">{what.b.initials}</span>{what.b.name}</span>
        <span className="r-k"></span>
        <span className="r-96">
          <span className="r-97"></span>
          {what.differences} {what.differences === 1 ? 'difference' : 'differences'}
        </span>
        {/* The kit draws this as a span, as it does every other
            clickable thing on the screen, so it stays a span. Giving
            the kit's spans real button semantics is a change to the
            design's own keyboard story and belongs to the designer,
            not to this port. Raised in the recap. */}
        <span className="r-98" onClick={onClose} title="Stop comparing">
          <Svg size={13}><CrossIcon /></Svg>
        </span>
      </div>
      <div className="r-5w">
        <div className="r-99">
          <span className="r-1z">CAPABILITY</span>
          <span className="r-1z">{short(what.a.name)}</span>
          <span className="r-1z">{short(what.b.name)}</span>
        </div>
        {what.rows.map((r) => (
          <div key={r.key} className={r.differs ? 'r-48' : 'r-3c'}>
            <span className={r.differs ? 'r-49' : 'r-3d'}>{r.label}</span>
            <span className={VERDICT[r.a].cls}><Svg size={12}>{VERDICT[r.a].icon}</Svg>{VERDICT[r.a].label}</span>
            <span className={VERDICT[r.b].cls}><Svg size={12}>{VERDICT[r.b].icon}</Svg>{VERDICT[r.b].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
