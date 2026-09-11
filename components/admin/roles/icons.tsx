import type { ReactNode } from 'react';

/* =============================================================
   The kit's icons, as its own files draw them.

   Every inline svg across the handoff carries the same frame: a 24 box,
   no fill, `currentColor`, 2 wide, round caps and joins, class `r-1`.
   Only the size and the paths change, so the frame is written once here
   and each icon is the paths the kit's files contain, copied out of
   them.

   These are not from `lucide-react`. The design system says icons come
   from Lucide, and for CRM work built to that system they do. This
   screen is a port of files that ship their own paths, and swapping in
   a different library's version of "a person" would be a redrawing.
   The application's OWN navigation rows inside the screen do use
   Lucide, because those rows are the application's, not the kit's.
   ============================================================= */

export function Svg({ size, title, children }: { size: number; title?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="r-1">
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const PeopleIcon = () => (<>
  <circle cx="9" cy="8" r="3.5" />
  <path d="M2 20v-.5A6.5 6.5 0 0 1 8.5 13h1A6.5 6.5 0 0 1 16 19.5v.5" />
  <path d="M17 8.5a3 3 0 1 0 0-5" />
</>);
export const AlertIcon = () => (<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>);
export const DocIcon = () => (<>
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
  <path d="M14 3v5h5" />
</>);
export const PlusIcon = () => <path d="M12 5v14M5 12h14" />;
export const MinusIcon = () => <path d="M5 12h14" />;
export const CheckIcon = () => <path d="M20 6L9 17l-5-5" />;
export const CrossIcon = () => <path d="M18 6L6 18M6 6l12 12" />;
export const DownIcon = () => <path d="M12 5v14M19 12l-7 7-7-7" />;
export const ChevronIcon = () => <path d="M6 9l6 6 6-6" />;
export const ArrowIcon = () => <path d="M5 12h14M12 5l7 7-7 7" />;
export const SearchIcon = () => (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const KebabIcon = () => (<>
  <circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" />
</>);
export const CopyIcon = () => (<>
  <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
</>);
export const PencilIcon = () => <path d="M4 20h4L20 8l-4-4L4 16z" />;
export const OpenIcon = () => (<>
  <path d="M14 4h6v6M20 4l-9 9" />
  <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
</>);
export const GridIcon = () => (<>
  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
</>);
export const BinIcon = () => <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />;
