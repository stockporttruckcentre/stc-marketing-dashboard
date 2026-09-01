'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/* =============================================================
   Picking a start date, quickly.

   The Plan step used a bare `<input type="date">`. That control is the
   browser's, it looks different in every one of them, it takes three
   clicks to reach a month that is not this one, and on a contract that
   almost always starts on the first of a month it makes somebody hunt
   for a date they could have typed in two keystrokes.

   ---- What makes this quicker rather than merely different ----

   Four shortcuts, which is what the date actually is nine times out of
   ten: today, the first of next month, the first of the month after,
   and this day next year. One press each.

   A month grid for everything else, with the month and year moved by
   their own arrows rather than by a scroll through weeks.

   And the field is still typed into. Somebody who knows the date types
   it, in the way people write dates here: 1/4/26, 01-04-2026, 1 Apr
   2026, all read the same. A picker that cannot be typed into is slower
   than the input it replaced, whatever it looks like.
   ============================================================= */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3).toLowerCase());

/** An ISO date, or null. Dates are handled as strings throughout: a
    contract's start date is a day, not an instant, and a Date carries a
    timezone that will eventually move it. */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parts(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]); const m = Number(match[2]) - 1; const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** How it reads to a person: "1 April 2026". */
export function readable(value: string): string {
  const p = parts(value);
  if (!p) return '';
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
}

/**
 * What somebody typed, as an ISO date, or null.
 *
 * Day first, because that is how a date is written here and "1/4/26"
 * meaning the fourth of January would be a quiet and expensive mistake
 * on a contract.
 */
export function parseTyped(text: string): string | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (parts(s)) return s;

  const numeric = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2}|\d{4})$/.exec(s);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]) - 1;
    let y = Number(numeric[3]);
    if (y < 100) y += 2000;
    if (m < 0 || m > 11 || d < 1 || d > daysIn(y, m)) return null;
    return iso(y, m, d);
  }

  const worded = /^(\d{1,2})[ \-]([a-z]{3,})[ \-](\d{2}|\d{4})$/.exec(s);
  if (worded) {
    const d = Number(worded[1]);
    const m = SHORT.indexOf(worded[2].slice(0, 3));
    let y = Number(worded[3]);
    if (y < 100) y += 2000;
    if (m < 0 || d < 1 || d > daysIn(y, m)) return null;
    return iso(y, m, d);
  }

  return null;
}

function daysIn(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** Monday first, which is how a working week is read. */
function leadingBlanks(y: number, m: number): number {
  return (new Date(y, m, 1).getDay() + 6) % 7;
}

function todayIso(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth(), n.getDate());
}

function firstOfMonthsAhead(n: number): string {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth() + n, 1);
  return iso(d.getFullYear(), d.getMonth(), 1);
}

function sameDayNextYear(): string {
  const t = new Date();
  return iso(t.getFullYear() + 1, t.getMonth(), t.getDate());
}

export function DatePicker({
  value, onChange, label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const picked = parts(value);
  const [cursor, setCursor] = useState(() => ({
    y: picked?.y ?? new Date().getFullYear(),
    m: picked?.m ?? new Date().getMonth(),
  }));

  /* Opening on a month somebody cannot see the chosen date in is the
     small thing that makes a picker feel broken. */
  useEffect(() => {
    if (open && picked) setCursor({ y: picked.y, m: picked.m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const grid = useMemo(() => {
    const blanks = leadingBlanks(cursor.y, cursor.m);
    const count = daysIn(cursor.y, cursor.m);
    const cells: (number | null)[] = Array(blanks).fill(null);
    for (let d = 1; d <= count; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const today = todayIso();

  const SHORTCUTS: { label: string; value: string }[] = [
    { label: 'Today', value: today },
    { label: '1st next month', value: firstOfMonthsAhead(1) },
    { label: '1st the month after', value: firstOfMonthsAhead(2) },
    { label: 'A year today', value: sameDayNextYear() },
  ];

  function commitTyped() {
    if (typed.trim() === '') { setBad(false); return; }
    const parsed = parseTyped(typed);
    if (!parsed) { setBad(true); return; }
    setBad(false);
    setTyped('');
    onChange(parsed);
    setOpen(false);
  }

  function shift(months: number) {
    const d = new Date(cursor.y, cursor.m + months, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      {label && (
        <label style={{
          display: 'block', marginBottom: 5,
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11.5,
          letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-subtle)',
        }}>{label}</label>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          height: 32, padding: '0 11px', cursor: 'pointer', textAlign: 'left',
          background: 'var(--surface)', color: 'var(--text)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--r)',
          fontFamily: 'var(--inter)', fontSize: 13,
        }}
      >
        <CalendarDays size={14} style={{ color: 'var(--text-subtle)', flex: 'none' }} />
        <span style={{ flex: 1, color: value ? 'var(--text)' : 'var(--text-subtle)' }}>
          {value ? readable(value) : 'Pick a start date'}
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 60, top: 'calc(100% + 6px)', left: 0,
          width: 292, padding: 12,
          background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)',
        }}>
          {/* ---- the four it usually is ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {SHORTCUTS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => { onChange(s.value); setOpen(false); }}
                style={{
                  height: 28, padding: '0 8px', cursor: 'pointer',
                  background: value === s.value ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: value === s.value ? '#fff' : 'var(--text-muted)',
                  border: '1px solid var(--border)', borderRadius: 'var(--r)',
                  fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >{s.label}</button>
            ))}
          </div>

          {/* ---- or type it ---- */}
          <input
            value={typed}
            onChange={(e) => { setTyped(e.target.value); setBad(false); }}
            onBlur={commitTyped}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTyped(); } }}
            placeholder="or type it: 1/4/26, 1 Apr 2026"
            style={{
              width: '100%', height: 30, marginTop: 8, padding: '0 10px',
              background: 'var(--surface)', color: 'var(--text)',
              border: `1px solid ${bad ? 'var(--danger, #CF2417)' : 'var(--border)'}`,
              borderRadius: 'var(--r)', fontFamily: 'var(--inter)', fontSize: 12.5,
            }}
          />
          {bad && (
            <p style={{
              margin: '5px 0 0', fontFamily: 'var(--inter)', fontSize: 11,
              color: 'var(--danger, #CF2417)',
            }}>
              That is not a date this reads. Day first: 1/4/26 is the first of April.
            </p>
          )}

          {/* ---- the month ---- */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, margin: '12px 0 6px',
          }}>
            <IconStep onClick={() => shift(-12)} title="A year back">
              <ChevronLeft size={13} /><ChevronLeft size={13} style={{ marginLeft: -9 }} />
            </IconStep>
            <IconStep onClick={() => shift(-1)} title="Previous month">
              <ChevronLeft size={14} />
            </IconStep>
            <span style={{
              flex: 1, textAlign: 'center',
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
              color: 'var(--text)',
            }}>
              {MONTHS[cursor.m]} {cursor.y}
            </span>
            <IconStep onClick={() => shift(1)} title="Next month">
              <ChevronRight size={14} />
            </IconStep>
            <IconStep onClick={() => shift(12)} title="A year on">
              <ChevronRight size={13} /><ChevronRight size={13} style={{ marginLeft: -9 }} />
            </IconStep>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {DAYS.map((d) => (
              <span key={d} style={{
                height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.06em', color: 'var(--text-subtle)',
              }}>{d[0]}</span>
            ))}

            {grid.map((d, i) => {
              if (d === null) return <span key={`b${i}`} />;
              const cell = iso(cursor.y, cursor.m, d);
              const chosen = cell === value;
              const isToday = cell === today;
              return (
                <button
                  key={cell}
                  type="button"
                  onClick={() => { onChange(cell); setOpen(false); }}
                  style={{
                    height: 28, cursor: 'pointer', borderRadius: 'var(--r)',
                    background: chosen ? 'var(--accent)' : 'transparent',
                    color: chosen ? '#fff' : 'var(--text)',
                    border: isToday && !chosen
                      ? '1px solid var(--border-strong)' : '1px solid transparent',
                    fontFamily: 'var(--inter)', fontSize: 12.5,
                    fontWeight: chosen || isToday ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >{d}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function IconStep({ onClick, title, children }: {
  onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, flex: 'none', cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 'var(--r)', color: 'var(--text-muted)',
      }}
    >{children}</button>
  );
}
