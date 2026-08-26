'use client';

import type { CSSProperties } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { DiaryEntry } from '@/lib/calendar/diary';
import { groupByDay } from '@/lib/calendar/diary';
import {
  WEEKDAYS, WEEKDAYS_LONG, dayKey, isToday, monthGrid, relativeDay, timeLabel, weekGrid,
} from '@/lib/calendar/grid';
import { KIND_LABEL } from '@/lib/calendar/kind';
import { EmptyState, Label } from '@/components/kit/primitives';
import { DiaryRow, KindIcon } from './parts';

/* =============================================================
   The three ways of looking at a diary.

   ---- Why the weekday names are inside the grid ----

   They used to be their own `repeat(7, 1fr)` grid sitting above another
   one. A `1fr` track is `minmax(auto, 1fr)`, so a cell holding a long
   meeting title pushed its own column wider than a seventh, the header
   had no content to push back with, and from that column onward the
   names sat over the wrong days. It is the bug somebody sees as "the
   day labels do not line up".

   Two changes, and the second is the one that makes it stay fixed. The
   tracks are `minmax(0, 1fr)`, so nothing inside a cell can widen it.
   And the names are the first row of the same grid rather than a grid
   of their own, so there are seven tracks in the calendar in total and
   there is no second set to disagree with.

   `WEEKDAYS` and `monthGrid` come from the same module, which is what
   stops a screen labelling the columns Sunday first while the grid
   fills them Monday first.
   ============================================================= */

/* ---- the grid, and the two things it has to get right ----

   Seven `minmax(0, 1fr)` columns, so a cell holding a long title cannot
   widen its own column. That is the day label fix.

   And the rows have to be told what they are. Without a
   `gridTemplateRows` every row is implicit, so the row of weekday names
   sized itself like a week and the header came out as tall as a
   fortnight. The two views set their own below: an auto row for the
   names, then the day rows. */
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  /* Scroll rather than spill. On a laptop the head, the numbers and the
     bar take enough of a fixed height shell that six rows of cells at
     their comfortable height do not fit, and a grid with nowhere to go
     pushes out through the bottom of the page. */
  overflow: 'auto',
  minHeight: 0,
};

const HEAD_CELL: CSSProperties = {
  height: 28, display: 'flex', alignItems: 'center', padding: '0 10px',
  position: 'sticky', top: 0, zIndex: 2,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  minWidth: 0, overflow: 'hidden',
};

export type ViewProps = {
  entries: DiaryEntry[];
  cursor: Date;
  onOpen: (entry: DiaryEntry) => void;
  onCompose: (dayKey: string) => void;
  canCompose: boolean;
};

function byDay(entries: DiaryEntry[]): Map<string, DiaryEntry[]> {
  const map = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const list = map.get(e.dayKey);
    if (list) list.push(e);
    else map.set(e.dayKey, [e]);
  }
  return map;
}

/* ---------------- month ---------------- */

/* What a cell is made of, in pixels, so how many entries fit in one is
   arithmetic rather than a guess.

   A chip is 19 high with a 2px gap under it, so n of them occupy
   `21n - 2`: the last one has no gap after it. Everything else in the
   cell is fixed: 4px of padding, the 19px date, the 2px gap under it,
   the 14px "and N more" line, and 4px of padding again.

   So n fits when `21n - 2 <= height - 43`, which is
   `n <= (height - 41) / 21`. Getting that plus one wrong drew a fourth
   chip sliced through the middle at 1080p, which is the same silent
   clipping this whole thing exists to stop. */
const ENTRY = 21;
const CHROME = 4 + 19 + 2 + 14 + 4;

export function MonthView({ entries, cursor, onOpen, onCompose, canCompose }: ViewProps) {
  const cells = useMemo(() => monthGrid(cursor), [cursor]);
  const days = useMemo(() => byDay(entries), [entries]);
  const weeks = cells.length / 7;

  /* How many entries a cell can actually draw.

     Fixed at two, a cell on a 1080p laptop was right and a cell on a 4K
     screen was a 296px box with two lines in the top corner and nothing
     underneath: the same picture stretched rather than the same
     density. So the cell is measured and told how many it has room
     for. Two is the floor, because that is what fits at the tightest
     the shell ever gets. */
  const gridRef = useRef<HTMLDivElement>(null);
  const [perCell, setPerCell] = useState(2);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const rowHeight = (el.clientHeight - 28) / weeks;
      const room = Math.floor((rowHeight - CHROME + 2) / ENTRY);
      setPerCell(Math.max(1, Math.min(8, room)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);

  /* Five rows or six, depending on the month. Named here rather than
     left implicit so the weekday row stays 28px and the week rows share
     what is left, shrinking to 64px before the grid starts scrolling. */
  return (
    <div ref={gridRef} style={{
      ...GRID, flex: 1,
      gridTemplateRows: `28px repeat(${weeks}, minmax(64px, 1fr))`,
    }}>
      {WEEKDAYS.map((d, i) => (
        <div key={d} style={{ ...HEAD_CELL, borderRight: i === 6 ? 'none' : '1px solid var(--border)' }}>
          <abbr title={WEEKDAYS_LONG[i]} style={{ textDecoration: 'none' }}>{d}</abbr>
        </div>
      ))}

      {cells.map((d, i) => {
        const key = dayKey(d);
        const mine = days.get(key) ?? [];
        const thisMonth = d.getMonth() === cursor.getMonth();
        const today = isToday(d);
        const lastColumn = i % 7 === 6;

        return (
          <div
            key={key}
            role="button"
            tabIndex={canCompose ? 0 : -1}
            aria-label={`${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${mine.length} in the diary`}
            onClick={() => canCompose && onCompose(key)}
            onKeyDown={(e) => {
              if (canCompose && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onCompose(key); }
            }}
            style={{
              /* Tight on purpose. Six week rows share whatever the
                 shell has left, which on a 1280 laptop is about 81px
                 each, and every pixel of padding is a pixel that
                 decides whether a second entry is drawn or counted. */
              minWidth: 0, minHeight: 0, padding: '4px 5px', overflow: 'hidden',
              display: 'flex', flexDirection: 'column', gap: 2,
              borderRight: lastColumn ? 'none' : '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              background: today ? 'var(--bg-subtle)' : 'transparent',
              opacity: thisMonth ? 1 : 0.42,
              cursor: canCompose ? 'pointer' : 'default',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--panton)', fontWeight: today ? 800 : 600, fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                width: 19, height: 19, borderRadius: 'var(--r-full)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: today ? 'var(--accent)' : 'transparent',
                color: today ? 'var(--accent-fg)' : 'var(--text-muted)',
              }}>{d.getDate()}</span>
              <span style={{ flex: 1 }} />
            </div>

            {/* Two, then a count.

                Three fitted at the height a month row gets on a big
                screen and did not on a laptop, and the third was
                clipped by the cell's own overflow with nothing saying
                so: the corner said three and two were drawn. Two is
                what fits at the row's minimum height, so two is what is
                drawn, and everything past it is counted out loud. */}
            {/* The count is never the thing that gets cut.

                Two chips and a count fitted at 97px a row and did not at
                81px, and because the whole lot sat in one
                `overflow: hidden` box it was the count that vanished:
                Wednesday had five things on it, drew two, and said
                nothing about the other three. A cell that hides work
                without saying so is worse than one that shows less.

                So the count is its own row, outside the box that
                clips. When the space runs out a chip is what gets cut,
                and the line saying how many are not shown is always
                there. */}
            <div style={{
              flex: 1, minHeight: 0, minWidth: 0,
              display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
            }}>
              {mine.slice(0, perCell).map((e) => (
                <button
                  key={e.event.id}
                  type="button"
                  title={`${e.event.title}, ${KIND_LABEL[e.kind]}`}
                  onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
                    height: 19, flex: 'none', padding: '0 4px', borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                    borderLeft: `2px solid ${e.needsMyAnswer ? 'var(--warning)' : e.event.color}`,
                    background: 'var(--surface-raised)', cursor: 'pointer',
                    fontFamily: 'var(--inter)', fontSize: 11, color: 'var(--text)',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ flex: 'none', display: 'flex', color: 'var(--text-subtle)' }}>
                    <KindIcon kind={e.kind} size={10} />
                  </span>
                  {!e.event.all_day && (
                    <span style={{
                      flex: 'none', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: 'var(--text)',
                    }}>{timeLabel(e.event.start_at)}</span>
                  )}
                  <span style={{
                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: 'var(--text-muted)',
                  }}>{e.event.title}</span>
                </button>
              ))}
            </div>

            {mine.length > perCell && (
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); onOpen(mine[perCell]); }}
                style={{
                  height: 14, flex: 'none', padding: '0 4px', border: 'none',
                  background: 'transparent', textAlign: 'left', cursor: 'pointer',
                  fontFamily: 'var(--inter)', fontSize: 10.5, color: 'var(--text-subtle)',
                  whiteSpace: 'nowrap',
                }}
              >and {mine.length - perCell} more</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- week ---------------- */

/**
 * Seven columns, each a list rather than a timeline.
 *
 * A proper hour grid is the obvious next thing and is not this: with
 * two or three entries a day it would be ninety percent empty rows, and
 * the thing somebody actually wants from a week view here is to see all
 * seven days at once without scrolling. That is what this does.
 */
export function WeekView({ entries, cursor, onOpen, onCompose, canCompose }: ViewProps) {
  const week = useMemo(() => weekGrid(cursor), [cursor]);
  const days = useMemo(() => byDay(entries), [entries]);

  return (
    <div style={{ ...GRID, flex: 1, gridTemplateRows: '28px minmax(0, 1fr)' }}>
      {week.map((d, i) => (
        <div key={`h${dayKey(d)}`} style={{
          ...HEAD_CELL, gap: 6,
          borderRight: i === 6 ? 'none' : '1px solid var(--border)',
          background: isToday(d) ? 'var(--surface-raised)' : 'var(--bg-subtle)',
          color: isToday(d) ? 'var(--text)' : 'var(--text-subtle)',
        }}>
          <span>{WEEKDAYS[i]}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.getDate()}</span>
        </div>
      ))}

      {week.map((d, i) => {
        const key = dayKey(d);
        const mine = days.get(key) ?? [];
        return (
          <div key={key} style={{
            minWidth: 0, padding: 7, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 5,
            borderRight: i === 6 ? 'none' : '1px solid var(--border)',
            background: isToday(d) ? 'var(--bg-subtle)' : 'transparent',
          }}>
            {mine.map((e) => (
              <button
                key={e.event.id}
                type="button"
                onClick={() => onOpen(e)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start',
                  padding: '6px 7px', borderRadius: 'var(--r-sm)', textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderLeft: `2px solid ${e.needsMyAnswer ? 'var(--warning)' : e.event.color}`,
                  background: 'var(--surface-raised)', cursor: 'pointer', minWidth: 0, width: '100%',
                }}
              >
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, width: '100%',
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
                  color: 'var(--text-subtle)',
                }}>
                  <KindIcon kind={e.kind} size={10} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {e.event.all_day ? 'All day' : timeLabel(e.event.start_at)}
                  </span>
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--text)', minWidth: 0, width: '100%',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{e.event.title}</span>
                {e.company && (
                  <span style={{
                    fontSize: 11, color: 'var(--text-subtle)', minWidth: 0, width: '100%',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{e.company}</span>
                )}
              </button>
            ))}

            {canCompose && (
              <button
                type="button"
                onClick={() => onCompose(key)}
                aria-label={`Book something on ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  height: 26, borderRadius: 'var(--r-sm)', width: '100%',
                  border: '1px dashed var(--border-strong)', background: 'transparent',
                  color: 'var(--text-subtle)', cursor: 'pointer',
                  fontFamily: 'var(--inter)', fontSize: 11,
                }}
              ><Plus size={11} /> Book</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- agenda ---------------- */

/**
 * Everything ahead, in order, under day headings.
 *
 * The view somebody actually works from: what is next, who is on it,
 * and what has not been answered. The month is for orientation and this
 * is for the morning.
 */
export function AgendaView({ entries, onOpen, onCompose, canCompose }: ViewProps) {
  const groups = useMemo(() => groupByDay(entries), [entries]);

  if (!groups.length) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState
          what="Nothing in the diary"
          why="No calls, meetings or visits match what you are looking at. Change the filters, or book something."
          action={canCompose
            ? (
              <button
                type="button"
                onClick={() => onCompose(dayKey(new Date()))}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px',
                  borderRadius: 'var(--r)', border: '1px solid var(--accent)',
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              ><Plus size={13} /> Book something</button>
            )
            : undefined}
        />
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
    }}>
      {groups.map((g) => (
        <div key={g.key}>
          <div style={{
            position: 'sticky', top: 0, zIndex: 1,
            display: 'flex', alignItems: 'center', gap: 9,
            height: 32, padding: '0 13px',
            background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
          }}>
            <Label>{relativeDay(g.date)}</Label>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              {g.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
              color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
            }}>{g.entries.length}</span>
          </div>
          {g.entries.map((e) => (
            <DiaryRow key={e.event.id} entry={e} onOpen={() => onOpen(e)} />
          ))}
        </div>
      ))}
    </div>
  );
}
