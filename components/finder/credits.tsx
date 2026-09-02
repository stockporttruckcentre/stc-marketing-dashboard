'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Coins, Loader, RotateCcw } from 'lucide-react';

/* =============================================================
   The Lusha allowance, on the screen that spends it.

   From the business:

     It only costed 1 credit for a lookup and we get 50 a month so that
     should be safe to use again. Just show the lusha balance on that
     page, not back in the global top bar.

   ---- Why the page and not the top bar ----

   Fifty a month is not a lot, and a credit is spent by pressing one
   button on one screen. A number in the top bar is on every screen,
   which sounds like more visibility and is less: it is furniture
   everywhere and information nowhere, and it is furthest from the eye
   at the moment it matters, which is the second before somebody presses
   Search.

   Beside the button, it is read exactly when it is relevant and never
   otherwise.

   ---- What it does when the number cannot be had ----

   Nothing dramatic. Lusha's usage endpoint is rate limited at five
   requests a minute and the route behind this serves a cached figure
   for forty five seconds, so a busy afternoon can land on a stale one.
   A stale figure says it is stale. A missing one says the balance could
   not be read, and does NOT stop anybody searching: a credit meter that
   blocks the work when the meter itself is broken is worse than no
   meter.
   ============================================================= */

type Balance =
  | { state: 'reading' }
  | { state: 'known'; credits: number; stale: boolean }
  | { state: 'unknown'; why: string };

/** Under this and the strip says so rather than only showing a number. */
const RUNNING_LOW = 10;

export function LushaCredits({ spent }: {
  /**
   * Bumped by the caller after anything that costs a credit, so the
   * figure catches up without polling. The endpoint is rate limited;
   * asking it every thirty seconds for a number that changes when
   * somebody presses a button is how the limit gets hit.
   */
  spent: number;
}) {
  const [balance, setBalance] = useState<Balance>({ state: 'reading' });

  const read = useCallback(async (force = false) => {
    setBalance({ state: 'reading' });
    try {
      const res = await fetch(`/api/lusha/balance${force ? '?fresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (typeof json.balance === 'number') {
        setBalance({ state: 'known', credits: json.balance, stale: !!json.stale });
        return;
      }
      setBalance({
        state: 'unknown',
        why: res.status === 429
          ? 'Lusha is rate limiting us. The figure will be back in a minute.'
          : String(json.error ?? 'The balance could not be read.'),
      });
    } catch {
      setBalance({ state: 'unknown', why: 'The balance could not be read.' });
    }
  }, []);

  useEffect(() => { void read(); }, [read, spent]);

  const low = balance.state === 'known' && balance.credits <= RUNNING_LOW;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '9px 12px', borderRadius: 'var(--r-md, 6px)',
      background: low ? 'var(--stc-warning-bg, rgba(245,166,35,0.10))' : 'var(--cf-surface-1)',
      border: `1px solid ${low ? 'var(--stc-warning, #C77A06)' : 'var(--cf-border)'}`,
      fontSize: 13, color: 'var(--cf-text-1)',
    }}>
      {low ? <AlertTriangle size={14} style={{ flexShrink: 0 }} />
        : <Coins size={14} style={{ flexShrink: 0, opacity: 0.75 }} />}

      {balance.state === 'reading' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, opacity: 0.75 }}>
          <Loader size={12} className="spin" /> Reading the Lusha balance
        </span>
      )}

      {balance.state === 'known' && (
        <>
          <span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {balance.credits.toLocaleString('en-GB')}
            </strong>
            {' '}Lusha {balance.credits === 1 ? 'credit' : 'credits'} left this month
          </span>
          <span style={{ opacity: 0.65, fontSize: 12 }}>
            A search or a lookup costs one.
          </span>
          {balance.stale && (
            <span style={{ opacity: 0.65, fontSize: 12 }}>
              This figure is a moment old: Lusha limits how often it can be asked.
            </span>
          )}
        </>
      )}

      {balance.state === 'unknown' && (
        <span style={{ opacity: 0.8 }}>
          {balance.why} Searching still works, and each one still costs a credit.
        </span>
      )}

      <button
        type="button"
        onClick={() => void read(true)}
        disabled={balance.state === 'reading'}
        title="Ask Lusha again"
        style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--cf-text-2)', fontSize: 12, padding: '2px 4px',
        }}
      >
        <RotateCcw size={12} /> Refresh
      </button>
    </div>
  );
}
