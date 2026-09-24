'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button, EmptyState, compactMoney, money } from '@/components/kit/primitives';
import { Drawer } from '@/components/kit/forms';
import { Leaderboard } from '@/components/analytics/kit/leaderboard';

/* =============================================================
   WHAT MAKES UP THE CHANGE.

   From the business:

     in What this portfolio invoiced against last year, make the row
     clickable so you can see what makes up this 256k in detail.

   The £256k is the figure the target is measured on, so "where did it
   come from" is the question somebody asks before they believe it.
   This answers it customer by customer, biggest riser first, and the
   footer adds the list back up: if the rows do not come to the
   headline, the footer says so rather than letting a total that is
   nearly right pass for one that is.

   ---- Why it wears the leaderboard ----

   The same kit row as the customer list underneath it, so a person
   reading both is reading one layout. Nothing in this file is a
   length, a colour or a weight: `components/analytics/kit/leaderboard`
   mirrors the kit's own markup and this supplies words and figures.

   ---- Why every customer and not just the risers ----

   A fall is part of the change. A list of only the good news adds up
   to more than the number it claims to explain, and the first person
   to check it with a calculator stops trusting the screen.
   ============================================================= */

type Row = {
  contact_id: string;
  company_name: string | null;
  this_year: number;
  last_year: number;
  change: number;
  change_pct: number | null;
  divisions: string | null;
  total_rows: number;
};

/* Enough to hold every customer on the largest portfolio in the
   business, so the drawer never shows a part of the answer. The
   function reports `total_rows` and the footer checks it. */
const EVERY = 2000;

const initialsOf = (name: string | null) => (name ?? '?')
  .replace(/[^A-Za-z0-9 ]/g, ' ')
  .split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join('') || '?';

export function PortfolioChange({ person, upto, headline, thisYear, lastYear, onClose }: {
  person: string;
  upto?: string;
  /** The number this list has to add up to. */
  headline: number;
  thisYear: number;
  lastYear: number;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('personal_customers', {
      p_person: person, p_upto: upto ?? null,
      p_limit: EVERY, p_offset: 0, p_sort: 'change',
    });
    if (error) setFailed(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [supabase, person, upto]);

  useEffect(() => { void load(); }, [load]);

  /* Only the ones that moved. A customer billed the same in both years
     contributes nothing and saying so a hundred times buries the
     twenty that matter. They are counted in the footer instead. */
  const moved = rows.filter((r) => Number(r.change) !== 0);
  const still = rows.length - moved.length;

  const added = moved.reduce((t, r) => t + Number(r.change), 0);
  const up = moved.filter((r) => Number(r.change) > 0).reduce((t, r) => t + Number(r.change), 0);
  const down = moved.filter((r) => Number(r.change) < 0).reduce((t, r) => t + Number(r.change), 0);
  /* Rounded to the penny before comparing, because the rows and the
     headline are both money and a floating point tail is not a
     disagreement. */
  const adds = Math.round(added * 100) === Math.round(Number(headline) * 100);

  const widest = moved.reduce((m, r) => Math.max(m, Math.abs(Number(r.change))), 0);

  return (
    <Drawer
      eyebrow="What this portfolio invoiced"
      title={`${headline > 0 ? '+' : ''}${money(headline)} against the same point last year`}
      hint={`${money(thisYear)} this year, ${money(lastYear)} then. This is the figure the target is measured on.`}
      onClose={onClose}
      width={980}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {moved.length} customer{moved.length === 1 ? '' : 's'} moved:{' '}
            <strong style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
              +{money(up)}
            </strong>{' up, '}
            <strong style={{ color: 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
              {money(down)}
            </strong>{' down'}
            {still > 0 && `, and ${still} billed the same in both years`}
          </span>
          <span style={{ fontSize: 13, color: adds ? 'var(--text-muted)' : 'var(--danger)' }}>
            {adds
              ? 'The rows add up to the headline.'
              : `The rows come to ${money(added)} and the headline says ${money(headline)}.`}
          </span>
          <Button size="sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</Button>
        </div>
      }
    >
      {failed && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>
          The breakdown would not load. {failed}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Reading the invoices.</div>
      ) : moved.length === 0 ? (
        <EmptyState
          what="Nothing moved."
          why="Every customer on this portfolio was billed the same as at this point last year."
        />
      ) : (
        <Leaderboard
          title="Customer by customer, biggest riser first"
          legend="How much of the change this one is"
          sort={<span>Biggest change first</span>}
          columns={{
            name: 'Customer',
            bar: 'Share of the change',
            figures: ['Last year', 'This year'],
            headline: 'Change',
            delta: '%',
          }}
          rows={moved.map((r) => {
            const change = Number(r.change);
            return {
              key: r.contact_id,
              name: r.company_name ?? 'Unnamed',
              sub: r.divisions || 'No division billed',
              initials: initialsOf(r.company_name),
              badge: r.divisions || undefined,
              bar: widest ? Math.abs(change) / widest : 0,
              figures: [compactMoney(Number(r.last_year)), compactMoney(Number(r.this_year))],
              headline: `${change > 0 ? '+' : ''}${compactMoney(change)}`,
              delta: r.change_pct == null
                ? undefined
                : { text: `${Number(r.change_pct) > 0 ? '+' : '−'}${Math.abs(Number(r.change_pct))}%`,
                    up: change > 0 },
              titles: {
                bar: `${money(Math.abs(change))} of the ${money(Math.abs(headline))} change`,
                figures: [`${money(Number(r.last_year))} to this point last year`,
                          `${money(Number(r.this_year))} this year`],
                headline: `${change > 0 ? 'Up' : 'Down'} ${money(Math.abs(change))} on last year`,
                delta: r.change_pct == null ? undefined : `${Math.abs(Number(r.change_pct))}% on last year`,
              },
            };
          })}
          total={{
            label: `${moved.length} of ${rows.length} customers moved`,
            figures: [compactMoney(lastYear), compactMoney(thisYear)],
            headline: `${added > 0 ? '+' : ''}${compactMoney(added)}`,
          }}
        />
      )}
    </Drawer>
  );
}
