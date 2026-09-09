'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader } from 'lucide-react';
import { Alert, Button, Field, Label, Segmented, Toolbar } from '@/components/analytics/kit/controls';
import { device, mirror, panelStyle } from '@/components/analytics/kit/mirror';
import { Screen } from '@/components/analytics/DrillDown';
import { money } from '@/components/analytics/kit/frame';
import { startOfFinancialYear } from '@/lib/analytics/period';
import type { DivisionSlug } from '@/lib/analytics/types';

/* =============================================================
   Setting the line the business is judged against.

   From the business:

     continue. wire up targets.

   The Executive panel has linked here since the hub was split into a
   landing and six drill-downs, and the link went nowhere: the editor
   was still a fold inside the old hub, on a screen that no longer
   renders it. So this is that editor, promoted to a screen of its own
   and given the thing it always needed, which is a whole year at once.

   ---- A year, not a month ----

   The old form set one month, the one the page happened to be showing.
   That is the wrong grain for the job: a target is set once, in a
   planning meeting, for twelve months, and setting it a month at a time
   means eleven more visits and no way to see whether the year adds up.

   So the grid is the financial year, April to April, which is the year
   every revenue figure in this application already uses. Migration 082
   established it and `startOfFinancialYear` is the same function the
   period bar calls, so this screen and the charts cannot disagree about
   which April a year begins in.

   ---- Group and divisions are separate rows, on purpose ----

   `revenue_targets` stores a null division to mean the group. It is not
   the sum of the three: the group target is what the business commits
   to, and the divisions are how it expects to get there. They can
   disagree, and when they do the total under each column says so rather
   than one silently overwriting the other.

   ---- Nought clears ----

   `analytics_set_target` deletes on nought rather than storing a target
   of nothing, because a target of nought and no target at all look
   identical on a chart and only one of them is a statement somebody
   made. An empty box is left alone; a nought clears.
   ============================================================= */

const COLUMNS: { key: DivisionSlug | 'group'; name: string; says: string }[] = [
  { key: 'group', name: 'Group', says: 'What the business commits to' },
  { key: 'stc', name: 'STC', says: 'Workshop and parts invoicing' },
  { key: 'trailer', name: 'Trailer Sales', says: 'Units sold' },
  { key: 'rental', name: 'Rentals', says: 'Hire invoicing' },
];

type Row = { month: string; label: string };

/** The twelve months of a financial year, April first. */
function monthsOf(fyStart: string): Row[] {
  const year = Number(fyStart.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(year, 3 + i, 1));
    return {
      month: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    };
  });
}

const cellKey = (month: string, column: string) => `${month}|${column}`;

export function TargetsBoard({ today }: { today: string }) {
  const thisYear = startOfFinancialYear(today);
  const [fy, setFy] = useState(thisYear);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const rows = useMemo(() => monthsOf(fy), [fy]);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch('/api/analytics/target');
      const body = await res.json();
      if (!res.ok) { setFailed(body?.error ?? 'The targets could not be read.'); return; }
      const next: Record<string, number> = {};
      for (const t of body.targets as { month: string; division: string | null; target: number }[]) {
        next[cellKey(t.month.slice(0, 10), t.division ?? 'group')] = Number(t.target);
      }
      setSaved(next);
      setDraft({});
    } catch {
      setFailed('The targets could not be reached. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = (key: string) => draft[key] ?? (saved[key] != null ? String(saved[key]) : '');

  async function commit(month: string, column: DivisionSlug | 'group') {
    const key = cellKey(month, column);
    const typed = draft[key];
    /* Untouched is untouched. Only a box somebody has typed in is
       written, so tabbing across a year does not send twelve writes. */
    if (typed === undefined) return;

    const amount = Number(typed.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      setFailed('A target is a number, or nought to clear it.');
      return;
    }
    if (saved[key] === amount || (typed.trim() === '' && saved[key] == null)) {
      setDraft((was) => { const next = { ...was }; delete next[key]; return next; });
      return;
    }
    if (typed.trim() === '') {
      /* An emptied box is a clear, which is a nought to the function. */
      return commitAmount(key, month, column, 0);
    }
    return commitAmount(key, month, column, amount);
  }

  async function commitAmount(
    key: string, month: string, column: DivisionSlug | 'group', amount: number,
  ) {
    setSaving(key);
    setFailed(null);
    const res = await fetch('/api/analytics/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, division: column === 'group' ? null : column, amount }),
    });
    setSaving(null);
    if (!res.ok) {
      setFailed((await res.json())?.error ?? 'That did not save.');
      return;
    }
    setSaved((was) => {
      const next = { ...was };
      if (amount <= 0) delete next[key]; else next[key] = amount;
      return next;
    });
    setDraft((was) => { const next = { ...was }; delete next[key]; return next; });
    setJustSaved(key);
    window.setTimeout(() => setJustSaved((k) => (k === key ? null : k)), 1400);
  }

  const totalFor = (column: string) =>
    rows.reduce((a, r) => a + (saved[cellKey(r.month, column)] ?? 0), 0);

  const years = [-1, 0, 1].map((n) => {
    const start = `${Number(thisYear.slice(0, 4)) + n}-04-01`;
    const short = Number(start.slice(0, 4));
    return { key: start, label: `${short}/${String(short + 1).slice(2)}` };
  });

  const node = device('cohort');
  const grid = node.kids?.[1];
  const headerRow = grid?.kids?.[0];
  const sampleRow = grid?.kids?.[1];

  return (
    <Screen
      title="Targets"
      says="Monthly revenue targets for the financial year, April to April. Every notch on every chart comes from here. Nought clears a target."
    >
      <Toolbar>
        <Segmented options={years} value={fy} onChange={setFy} />
        <span style={{ flex: 1 }} />
        {busy && <Label>Reading the year</Label>}
        <Button onClick={load} disabled={busy}>Refresh</Button>
      </Toolbar>

      {failed && <Alert tone="danger">{failed}</Alert>}

      {/* The kit's own grid, with fields in the cells.

          There is no targets panel in `docs/source/STCUIAnalytics.html`,
          and building one meant either inventing thirty lengths or
          finding the device in the file that is already this shape.
          The renewal cohort grid is: a label column, a narrow second
          column and then a row of equal cells, and every one of its
          measurements is the designer's. So it is worn rather than
          copied, and this file contains no length of its own.

          A heat cell carries a background that means a retention
          figure. A field cell has no figure to shade, so the fill is
          taken off and everything else about the cell, its height, its
          centring, its flex, is left exactly as the file wrote it. */}
      {grid && headerRow && sampleRow && (
        <div style={{ ...panelStyle('cohort'), overflowX: 'auto' }}>
          {mirror(node, {
            kids: [
              { kids: [{ text: `Financial year ${years.find((y) => y.key === fy)?.label ?? ''}` },
                { text: 'Group is what the business commits to. The three divisions are how it expects to get there.' }] },
              {
                kids: [
                  /* The cohort's own header and rows, with its narrow
                     SIGNED column left out. What is left is exactly
                     what a targets grid needs: a label column at the
                     file's own width, then equal cells. Index 2 is the
                     first of those cells in both the header and a row,
                     so every column here is a clone of one. */
                  {
                    from: 0,
                    kids: [
                      {},
                      ...COLUMNS.map((c) => ({ from: 2, text: c.name })),
                    ],
                  },
                  ...rows.map((r) => ({
                    from: 1,
                    kids: [
                      { text: r.label },
                      ...COLUMNS.map((c) => ({
                        from: 2,
                        style: blank,
                        slot: cell(r.month, c),
                      })),
                    ],
                  })),
                  {
                    from: 1,
                    kids: [
                      { text: 'Year' },
                      ...COLUMNS.map((c) => ({
                        from: 2,
                        style: blank,
                        text: money(totalFor(c.key)),
                      })),
                    ],
                  },
                ],
              },
              /* The footnote, in the kit's own foot row. Its scale
                 legend beside it is about retention and has nothing to
                 say here, so it is dropped rather than relabelled. */
              {
                kids: [
                  {
                    text: 'A box saves when you leave it. The group row is what the business commits to and '
                      + 'the three division rows are how it expects to get there, so the four year totals are '
                      + 'allowed to disagree. Only an administrator can change any of this, and the database '
                      + 'refuses the write as well as this screen.',
                  },
                  { drop: true },
                ],
              },
            ],
          })}
        </div>
      )}
    </Screen>
  );

  /* A cell: the field, and whichever of saving or saved is happening
     to it. Declared after the return because it closes over the draft
     and is only ever called from the patch above. */
  function cell(month: string, column: { key: DivisionSlug | 'group'; name: string }) {
    const key = cellKey(month, column.key);
    return (
      <span style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <Field
          value={shown(key)}
          ariaLabel={`${column.name} target for ${month}`}
          placeholder="No target"
          align="right"
          width="100%"
          onChange={(v) => setDraft((was) => ({ ...was, [key]: v }))}
          onBlur={() => commit(month, column.key)}
        />
        {saving === key && <Loader size={12} className="spin" />}
        {justSaved === key && <Check size={12} style={{ color: 'var(--success)' }} />}
      </span>
    );
  }
}

/* A heat cell without the heat. The background means a retention
   figure and there is none here, so it comes off and nothing else in
   the declaration is touched. */
const blank = (css: string) => css.replace(/background:[^;]+;?/, '');
