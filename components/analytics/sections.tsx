'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Button, Label, compactMoney, money } from '@/components/kit/primitives';
import {
  OPEN_STAGES, STAGE_LABEL, makeCustomerForTrailer,
  type AgeBand, type Deal, type Person, type Reconciliation, type Stage,
  type TrailerWaiting,
} from '@/lib/protean/finance';

/* =============================================================
   What each division column carries beneath its figures.

   ---- What this used to be ----

   Seven tabs across the top of the page, each holding a sortable table:
   every trailer deal, every person, every stage, every mover, every
   ageing band, the reconciliation. From the business:

     Tabulating all the deals/who is selling etc - not keen on these
     tabulated lists. We have this data in the crm already, it's more
     duplication than quick summary for the finance team Not keen on
     tabs here, people miss tabs. I'm sure you could fit it in the
     columns still.

   Both halves are right, and they point the same way.

   A hundred row table of every trailer sold is not a summary, it is the
   trailer sales screen rebuilt worse, on a page nobody goes to for a
   list. And a tab is a place to hide something: seven of them across a
   screen whose whole point was that three columns sit side by side was
   the same mistake the tabs were introduced to avoid.

   So each division carries the SHAPE of its detail, in the column it
   belongs to, and every figure that would have been a row goes through
   to the screen that owns the rows.
   ============================================================= */

const nowt = <span style={{ color: 'var(--text-subtle)' }}>—</span>;

/** A line of the small print inside a column. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5, padding: '3px 0',
    }}>
      <span style={{ color: 'var(--text-subtle)', minWidth: 96 }}>{label}</span>
      <span style={{
        flex: 1, textAlign: 'right', color: 'var(--text)',
        fontVariantNumeric: 'tabular-nums',
      }}>{children}</span>
    </div>
  );
}

function Block({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <Label>{title}</Label>
        {hint && (
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 'auto' }}>
            {hint}
          </span>
        )}
      </div>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------
   The detail for one division.
   ------------------------------------------------------------- */
export function DivisionDetail({ division, name, colour, deep }: {
  division: string;
  name: string;
  colour: string;
  deep: {
    deals: Deal[];
    people: Person[];
    stages: Stage[];
    bands: AgeBand[];
  } | null;
}) {
  if (!deep) {
    return (
      <div style={{
        marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
        fontSize: 12.5, color: 'var(--text-subtle)',
        display: 'flex', alignItems: 'center', gap: 7,
      }}>
        <Loader size={12} className="spin" /> Reading the detail
      </div>
    );
  }

  return (
    <>
      {division === 'trailer' && <Deals deals={deep.deals} people={deep.people} />}
      {division !== 'trailer' && <Ageing division={division} bands={deep.bands} />}
      <Funnel division={division} name={name} stages={deep.stages} colour={colour} />
    </>
  );
}

/* -------------------------------------------------------------
   Trailer sales: the deals, as a shape rather than a list.
   ------------------------------------------------------------- */
function Deals({ deals, people }: { deals: Deal[]; people: Person[] }) {
  const thin = deals.filter((d) => d.profit_pct != null && Number(d.profit_pct) < 5);
  const sellers = useMemo(
    () => people.filter((p) => p.trailers > 0)
      .sort((a, b) => Number(b.trailer_value) - Number(a.trailer_value))
      .slice(0, 4),
    [people],
  );

  if (!deals.length) {
    return (
      <Block title="Deals">
        <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
          Nothing dispatched this year yet. A trailer counts on the day it leaves the yard.
        </span>
      </Block>
    );
  }

  const best = [...deals].sort((a, b) => Number(b.profit ?? 0) - Number(a.profit ?? 0))[0];

  return (
    <>
      <Block title="Deals" hint="Every one is on Trailer sales">
        <Line label="Best margin">
          {best?.stc_no ?? '—'}
          <span style={{ color: 'var(--text-subtle)' }}>
            {' '}{best?.profit != null ? money(best.profit) : ''}
          </span>
        </Line>
        {/* THE ONE ROW WORTH SURFACING. A deal review only ever wants
            the thin ones, and a table of forty was making somebody find
            them. */}
        <Line label="Under 5% margin">
          {thin.length === 0
            ? <span style={{ color: 'var(--text-subtle)' }}>none</span>
            : (
              <span style={{ color: 'var(--danger)', fontFamily: 'var(--panton)', fontWeight: 700 }}>
                {thin.length}, worth {compactMoney(thin.reduce((s, d) => s + Number(d.sales_price ?? 0), 0))}
              </span>
            )}
        </Line>
      </Block>

      {sellers.length > 0 && (
        <Block title="Who sold them">
          {sellers.map((p) => (
            <Line key={p.person} label={p.person}>
              {p.trailers}
              <span style={{ color: 'var(--text-subtle)' }}>
                {' '}{compactMoney(Number(p.trailer_value))}
              </span>
            </Line>
          ))}
          {people.some((p) => p.trailers > 0 && !p.has_login) && (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.5 }}>
              A name here that matches nobody who can sign in is somebody who has left, or a
              name typed differently on the stock list. It is shown rather than merged into the
              nearest match.
            </div>
          )}
        </Block>
      )}
    </>
  );
}

/* -------------------------------------------------------------
   The two Protean divisions: how old the open work is.
   ------------------------------------------------------------- */
function Ageing({ division, bands }: { division: string; bands: AgeBand[] }) {
  const mine = bands.filter((b) => b.division === division)
    .sort((a, b) => a.band_at - b.band_at);
  const total = mine.reduce((s, b) => s + Number(b.value || 0), 0);
  if (!total) return null;

  const old = mine.find((b) => b.band_at === 4);
  const most = Math.max(1, ...mine.map((b) => Number(b.value || 0)));

  return (
    <Block title="How old the open work is" hint="From the day it was raised">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {mine.filter((b) => b.jobs > 0).map((b) => (
          <div key={b.band} style={{
            display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5,
          }}>
            <span style={{ color: 'var(--text-subtle)', minWidth: 92 }}>{b.band}</span>
            <span style={{
              flex: 1, height: 5, borderRadius: 'var(--r-full)',
              background: 'var(--surface-sunken)', overflow: 'hidden',
            }}>
              <span style={{
                display: 'block', height: '100%',
                width: `${(Number(b.value) / most) * 100}%`,
                /* The oldest band always in red. Anything past ninety
                   days on the ramps is why this block exists. */
                background: b.band_at === 4 ? 'var(--danger)' : 'var(--chart-company)',
              }} />
            </span>
            <span style={{
              minWidth: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              color: b.band_at === 4 ? 'var(--danger)' : 'var(--text)',
            }}>{compactMoney(Number(b.value))}</span>
          </div>
        ))}
      </div>
      {old && old.jobs > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 7 }}>
          {((Number(old.value) / total) * 100).toFixed(0)}% of it has been open over ninety days,
          across {old.jobs} {old.jobs === 1 ? 'job' : 'jobs'}.
        </div>
      )}
    </Block>
  );
}

/* -------------------------------------------------------------
   What is coming, for this division.
   ------------------------------------------------------------- */
function Funnel({ division, name, stages, colour }: {
  division: string; name: string; stages: Stage[]; colour: string;
}) {
  const mine = stages.filter((s) => s.division === division)
    .sort((a, b) => a.stage_at - b.stage_at);
  const open = mine.filter((s) => OPEN_STAGES.has(s.stage));
  const total = open.reduce((s, r) => s + r.leads, 0);
  if (!mine.length) return null;

  const widest = Math.max(1, ...open.map((s) => s.leads));

  return (
    <Block title="What is coming" hint={total ? `${total} open` : undefined}>
      {total === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
          Nothing open on {name.toLowerCase()}. A lead raised on the tracker appears here.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {open.map((s) => (
            <div key={s.stage} style={{
              display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5,
            }}>
              <span style={{ color: 'var(--text-subtle)', minWidth: 92 }}>
                {STAGE_LABEL[s.stage] ?? s.stage}
              </span>
              <span style={{
                flex: 1, height: 5, borderRadius: 'var(--r-full)',
                background: 'var(--surface-sunken)', overflow: 'hidden',
              }}>
                <span style={{
                  display: 'block', height: '100%',
                  width: `${(s.leads / widest) * 100}%`, background: colour,
                }} />
              </span>
              <span style={{
                minWidth: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              }}>
                {s.leads}
                <span style={{ color: 'var(--text-subtle)' }}>
                  {' '}{s.value ? compactMoney(Number(s.value)) : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

/* -------------------------------------------------------------
   What is not on a customer record, and what to do about it.

   ---- The alert this replaces ----

   It said the money was "waiting under Revenue, Accounts". That is the
   Protean moderation queue, which trailer customers have never been in
   and never will be: they come off the stock list, not out of Protean,
   and have no account code. From the business:

     "8 of these are on an account with no CRM record ... They are
     waiting under Revenue, Accounts." but nothing is under accounts so
     this is broken hardcoded code.

   So each division points at the thing that can actually close its own
   gap. For Protean that is still the moderation queue. For trailer
   sales it is a button, here, because there was nowhere else and the
   business asked for the records to exist.
   ------------------------------------------------------------- */
export function WaitingOnARecord({ division, recon, waiting }: {
  division: string;
  recon: Reconciliation;
  waiting: TrailerWaiting[];
}) {
  const gap = Number(recon.unattributed || 0);
  const aside = Number(recon.set_aside || 0);
  if (gap <= 0 && aside <= 0) return null;

  return (
    <Block title="Not on a customer record">
      {gap > 0 && (division === 'trailer'
        ? <TrailerRecords recon={recon} waiting={waiting} />
        : (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            <span style={{ color: 'var(--warning)', fontFamily: 'var(--panton)', fontWeight: 700 }}>
              {money(gap)}
            </span>
            {' '}across {recon.unattributed_n} Protean{' '}
            {recon.unattributed_n === 1 ? 'account' : 'accounts'} nobody has placed. It is in
            the total above and on nobody&apos;s customer page.
            <div style={{ marginTop: 7 }}>
              <Link href={`/dashboard/revenue/${division}?tab=accounts`} style={{ textDecoration: 'none' }}>
                <Button variant="secondary" size="sm">
                  Place them
                  <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </div>
        ))}

      {aside > 0 && (
        <div style={{
          fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5,
          marginTop: gap > 0 ? 9 : 0,
        }}>
          {money(aside)} more is on {recon.set_aside_n}{' '}
          {recon.set_aside_n === 1 ? 'account' : 'accounts'} set aside as not customers: cash
          sales, and the group&apos;s own leasing company. Real revenue, nobody&apos;s
          portfolio.
        </div>
      )}
    </Block>
  );
}

/**
 * The trailer customers with nobody behind them, and a button.
 *
 * From the business: "customers should exist if they don't already have
 * a CRM record". So this is not a link somewhere, it is the thing
 * itself: one press makes the record and moves every trailer that
 * haulier ever bought onto it.
 */
function TrailerRecords({ recon, waiting }: {
  recon: Reconciliation; waiting: TrailerWaiting[];
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [snag, setSnag] = useState<string | null>(null);

  const left = waiting.filter((w) => !done.has(w.customer));

  const make = async (w: TrailerWaiting) => {
    setBusy(w.customer);
    setSnag(null);
    try {
      /* The suggestion is bound to rather than duplicated where there
         is one. Two records for one haulier is worse than none: the
         revenue then splits across both and neither page is right. */
      await makeCustomerForTrailer(supabase, w.customer, w.looks_like);
      setDone((s) => new Set(s).add(w.customer));
    } catch (e) {
      setSnag(e instanceof Error ? e.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
      <span style={{ color: 'var(--warning)', fontFamily: 'var(--panton)', fontWeight: 700 }}>
        {money(recon.unattributed)}
      </span>
      {' '}of trailers went to {recon.unattributed_n}{' '}
      {recon.unattributed_n === 1 ? 'customer' : 'customers'} with no CRM record.

      {left.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {left.slice(0, 6).map((w) => (
            <div key={w.customer} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 7px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)',
            }}>
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: 'var(--text)',
              }}>
                {w.customer}
                <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>
                  {' '}{w.trailers} {w.trailers === 1 ? 'trailer' : 'trailers'},{' '}
                  {compactMoney(Number(w.value))}
                </span>
                {/* A record spelled almost the same. Named, so the
                    press binds to it rather than making a second
                    Dawson. */}
                {w.looks_like_name && (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--info)' }}>
                    looks like {w.looks_like_name}
                  </span>
                )}
              </span>
              <Button
                variant="secondary" size="sm"
                disabled={busy === w.customer}
                onClick={() => void make(w)}
              >
                {busy === w.customer
                  ? <Loader size={11} className="spin" />
                  : <UserPlus size={11} />}
                {w.looks_like ? 'Link' : 'Create'}
              </Button>
            </div>
          ))}
          {left.length > 6 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              and {left.length - 6} more.
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
          {done.size} {done.size === 1 ? 'record' : 'records'} made. The figures above catch up
          on the next reload.
        </div>
      )}

      {snag && (
        <div style={{ marginTop: 8 }}>
          <Alert tone="danger">{snag}</Alert>
        </div>
      )}

      {left.length === 0 && done.size === 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-subtle)' }}>
          Every one of them was sold in an earlier year, so there is nothing to make here for
          the year being read.
        </div>
      )}
    </div>
  );
}

export { nowt };
