/* =============================================================
   The kit's icons, as lucide components.

   From CLAUDE.md, about the design system and true of every pack since:

     Icons come from `lucide-react`, already a dependency. Do not
     extract the inline SVGs from the reference files.

   Each entry below is the lucide icon whose path data is the one the
   kit drew, so the screen looks like the reference without carrying a
   second copy of twenty seven SVGs. The kit's own `rc-1` class is kept
   on every one, because some rules size and colour by it.
   ============================================================= */
import {
  Check, ChevronRight, ChevronDown, ChevronLeft, MoreHorizontal, ArrowRight,
  X, RotateCcw, Lock, Plus, FileText, Download, Eye, Clock, AlertCircle,
  Copy, ArrowUp, Mail, BarChart3, Minus, Calendar, Search, ExternalLink,
  Trash2, List, Pencil, Info,
} from 'lucide-react';

type P = { size?: number; className?: string; style?: React.CSSProperties };

/** Every icon carries the kit's own class, which some rules select on. */
const wrap = (Icon: React.ComponentType<Record<string, unknown>>, fallback: number) =>
  function KitIcon({ size, className, style }: P) {
    return <Icon width={size ?? fallback} height={size ?? fallback} strokeWidth={2}
      className={`rc-1${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />;
  };

export const ITick        = wrap(Check, 14);
export const IChevronR    = wrap(ChevronRight, 14);
export const IChevronD    = wrap(ChevronDown, 14);
export const IChevronL    = wrap(ChevronLeft, 16);
export const IMore        = wrap(MoreHorizontal, 16);
export const IArrowR      = wrap(ArrowRight, 14);
export const IClose       = wrap(X, 16);
export const IReset       = wrap(RotateCcw, 14);
export const ILock        = wrap(Lock, 14);
export const IPlus        = wrap(Plus, 14);
export const IDoc         = wrap(FileText, 14);
export const IDownload    = wrap(Download, 14);
export const IEye         = wrap(Eye, 14);
export const IClock       = wrap(Clock, 14);
export const IWarn        = wrap(AlertCircle, 14);
export const ICopy        = wrap(Copy, 14);
export const IArrowUp     = wrap(ArrowUp, 14);
export const IMail        = wrap(Mail, 14);
export const IChart       = wrap(BarChart3, 14);
export const IMinus       = wrap(Minus, 14);
export const ICalendar    = wrap(Calendar, 14);
export const ISearch      = wrap(Search, 14);
export const IExternal    = wrap(ExternalLink, 14);
export const ITrash       = wrap(Trash2, 14);
export const IList        = wrap(List, 14);
export const IEdit        = wrap(Pencil, 14);
export const IInfo        = wrap(Info, 14);
