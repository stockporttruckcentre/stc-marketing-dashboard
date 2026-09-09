'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Button, compactMoney, money } from '@/components/kit/primitives';
import {
  makeCustomerForTrailer,
  type Reconciliation, type TrailerWaiting,
} from '@/lib/protean/finance';

/* =============================================================
   Revenue that is on nobody's customer page, and how to fix it.

   ---- Why this is its own panel and no longer part of a column ----

   It used to hang off the bottom of whichever division card it belonged
   to, which is what the business was looking at when they said:

     ui broken on lower section, columns all different sized

   Both of those were this. A card carrying a list of records with a
   button on each one is a card whose height is decided by how much
   unplaced revenue there happens to be that month, so the three columns
   could never line up, and on the division with the most gaps the form
   grew out of the bottom of the card.

   A thing you DO does not belong inside a thing you READ. So it is one
   panel, full width, at the foot of the page, listing every division's
   gap in one place with the action beside each one.

   ---- What the alert before it got wrong ----

   It said the money was "waiting under Revenue, Accounts". That is the
   Protean moderation queue, which trailer customers have never been in
   and never will be: they come off the stock list, not out of Protean,
   and have no account code. From the business:

     "8 of these are on an account with no CRM record ... They are
     waiting under Revenue, Accounts." but nothing is under accounts so
     this is broken hardcoded code.

   So each division points at the thing that can actually close its own
   gap: the moderation queue for Protean, and for trailer sales a button
   here, because there was nowhere else and the business asked for the
   records to exist.
   ============================================================= */

export function NeedsARecord({ recon, waiting, only }: {
  recon: Reconciliation[];
  waiting: TrailerWaiting[];
  /** The division the page is scoped to, or null for all of them. */
  only: string | null;
}) {
  const mine = recon
    .filter((r) => (only ? r.division === only : true))
    .filter((r) => Number(r.unattributed || 0) > 0 || Number(r.set_aside || 0) > 0);

  if (!mine.length) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
        Every pound billed is on a customer record. Nothing to place.
      </span>
    );
  }

  return (
    <div style={{
      display: 'grid', gap: 14, alignItems: 'start',
      gridTemplateColumns: `repeat(${Math.min(mine.length, 3)}, minmax(0, 1fr))`,
    }}>
      {mine.map((r) => (
        <div key={r.division} style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6,
          }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12.5, color: 'var(--text)',
            }}>{r.name}</span>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12.5,
              color: 'var(--warning)', fontVariantNumeric: 'tabular-nums',
            }}>{money(Number(r.unattributed || 0))}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              on {r.unattributed_n} {r.unattributed_n === 1 ? 'name' : 'names'}
            </span>
          </div>

          {Number(r.unattributed || 0) > 0 && (r.division === 'trailer'
            ? <TrailerRecords waiting={waiting} />
            : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Counted in the total above and on nobody&apos;s customer page.
                <div style={{ marginTop: 7 }}>
                  <Link href={`/dashboard/revenue/${r.division}?tab=accounts`}
                    style={{ textDecoration: 'none' }}>
                    <Button variant="secondary" size="sm">
                      Place them
                      <ArrowRight size={12} />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}

          {Number(r.set_aside || 0) > 0 && (
            <div style={{
              fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5, marginTop: 9,
            }}>
              {money(Number(r.set_aside))} more is on {r.set_aside_n}{' '}
              {r.set_aside_n === 1 ? 'account' : 'accounts'} set aside as not customers: cash
              sales, and the group&apos;s own leasing company. Real revenue, nobody&apos;s
              portfolio.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The trailer customers with nobody behind them, and a button each.
 *
 * From the business: "customers should exist if they don't already have
 * a CRM record". So this is not a link somewhere, it is the thing
 * itself: one press makes the record and moves every trailer that
 * haulier ever bought onto it.
 */
function TrailerRecords({ waiting }: { waiting: TrailerWaiting[] }) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [snag, setSnag] = useState<string | null>(null);

  const left = waiting.filter((w) => !done.has(w.customer));

  const make = async (w: TrailerWaiting) => {
    setBusy(w.customer);
    setSnag(null);
    try {
      /* Bound to the suggestion rather than duplicated where there is
         one. Two records for one haulier is worse than none: the revenue
         then splits across both and neither page is right. */
      await makeCustomerForTrailer(supabase, w.customer, w.looks_like);
      setDone((s) => new Set(s).add(w.customer));
    } catch (e) {
      setSnag(e instanceof Error ? e.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      {left.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {left.slice(0, 5).map((w) => (
            <div key={w.customer} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)',
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{w.customer}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)' }}>
                  {w.trailers} {w.trailers === 1 ? 'trailer' : 'trailers'},{' '}
                  {compactMoney(Number(w.value))}
                  {/* A record spelled almost the same, named, so the
                      press binds to it rather than making a second
                      Dawson. */}
                  {w.looks_like_name && (
                    <span style={{ color: 'var(--info)' }}> looks like {w.looks_like_name}</span>
                  )}
                </span>
              </span>
              <Button
                variant="secondary" size="sm"
                disabled={busy === w.customer}
                onClick={() => void make(w)}
              >
                {busy === w.customer ? <Loader size={11} className="spin" /> : <UserPlus size={11} />}
                {w.looks_like ? 'Link' : 'Create'}
              </Button>
            </div>
          ))}
          {left.length > 5 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              and {left.length - 5} more.
            </span>
          )}
        </div>
      )}

      {done.size > 0 && (
        <div style={{
          marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: 'var(--success)',
        }}>
          <Check size={12} />
          {done.size} {done.size === 1 ? 'record' : 'records'} made. The figures catch up on the
          next reload.
        </div>
      )}

      {snag && <div style={{ marginTop: 8 }}><Alert tone="danger">{snag}</Alert></div>}

      {left.length === 0 && done.size === 0 && (
        <span style={{ color: 'var(--text-subtle)' }}>
          Every one of them was sold in an earlier year, so there is nothing to make here for
          the year being read.
        </span>
      )}
    </div>
  );
}
