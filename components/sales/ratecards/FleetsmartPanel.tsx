'use client';

import Link from 'next/link';
import { ITick, IMinus } from './icons';
import { shortDate } from '@/lib/ratecards/format';
import type { FleetsmartSide } from '@/lib/ratecards/types';

/* =============================================================
   The FleetSmart+ side of the sheet.

   Ported from `rate-fs-panel.html`, `rate-fs-hidden.html`,
   `rate-fs-none.html` and `rate-fs-extras.html`, which are the same
   component in four states.

   From the handoff, and it is the rule that decides the whole
   component:

     The FleetSmart+ section is generated from the contract, never
     typed. Hiding it is presentational only and must not unlink the
     contract.

   So there is no editable cell anywhere in the matrix. A tick is what
   the tier says, full stop. The only control is whether the section
   prints, and `rate_card_show_fleetsmart` writes that without touching
   `contract_id`.
   ============================================================= */

export function FleetsmartPanel({ side, editable, onToggle }: {
  side: FleetsmartSide;
  editable: boolean;
  onToggle: () => void;
}) {
  const contract = side.contract;
  const tier = contract?.plan ?? null;

  /* ---- No contract ----

     A real state and a common one: most customers are not on
     FleetSmart+, and the card simply has no such section. Saying so is
     better than an empty matrix, which reads as a load that failed. */
  if (!contract) {
    return (
      <div className="rc-77">
        <div className="rc-58">
          <div className="rc-59">
            <div className="rc-1h">
              <span className="rc-5a">FleetSmart+ section</span>
              <span className="rc-1f">No contract</span>
            </div>
            <span className="rc-5b">
              This customer is not on FleetSmart+, so the card has no inclusions section and
              nothing is printed for it. If they take a contract out, it appears here on its own
              and the section starts printing.
            </span>
          </div>
        </div>

        <div className="rc-2u">
          <div className="rc-5g">
            <div className="rc-5h">WHAT WOULD APPEAR</div>
            <div className="rc-3l">SILVER</div>
            <div className="rc-3l">GOLD</div>
            <div className="rc-5i">PLATINUM</div>
          </div>
          {side.inclusions.slice(0, 6).map((i) => (
            <div className="rc-5j" key={i.inclusion} style={{ opacity: .5 }}>
              <div className="rc-13">{i.inclusion}</div>
              <Cell on={i.silver} />
              <Cell on={i.gold} />
              <Cell on={i.platinum} last />
            </div>
          ))}
          <div style={{ padding: '10px 14px' }}>
            <span className="rc-y">
              and {Math.max(0, side.inclusions.length - 6)} more, once there is a contract to read them from.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const extras = side.extras ?? [];

  return (
    <div className="rc-77">
      <div className="rc-58">
        <div className="rc-59">
          <div className="rc-1h">
            <span className="rc-5a">FleetSmart+ section</span>
            <span className={side.shown ? 'rc-2q' : 'rc-1f'}>
              {side.shown ? 'Pulled from live contract' : 'Hidden from the printed card'}
            </span>
          </div>
          <span className="rc-5b">
            This customer holds a live {tier} contract, so these ticks are read from it and cannot
            drift. Editing the contract updates every card that shows it.
            {!side.shown && ' The section is linked and up to date; it just does not print.'}
          </span>
        </div>
        <div className="rc-5c">
          <button
            className="rc-5d"
            role="switch"
            aria-checked={side.shown}
            aria-label="Show the FleetSmart+ section on the printed card"
            disabled={!editable}
            title={editable
              ? (side.shown ? 'Stop this section printing on the card' : 'Print this section on the card')
              : 'An approved card does not change'}
            onClick={onToggle}
          >
            <span className={side.shown ? 'rc-78' : 'rc-79'}>
              <span className="rc-5e" />
            </span>
          </button>
          <span className="rc-3w">Show on card</span>
        </div>
      </div>

      <div className="rc-5f">
        <div className="rc-1m">
          <span className="rc-17">CONTRACT STATUS</span>
          <span className="rc-2k">On FleetSmart+</span>
        </div>
        <div className="rc-1m">
          <span className="rc-17">TIER</span>
          <span className="rc-2k">{tier}</span>
        </div>
        <div className="rc-1m">
          <span className="rc-17">EXTRA INCLUSIONS</span>
          <span className="rc-2k">
            {extras.length === 0 ? 'None agreed' : `${extras.length} agreed`}
          </span>
        </div>
        <div className="rc-1m">
          <span className="rc-17">CONTRACT REF</span>
          <span className="rc-4j">{contract.ref ?? 'no reference yet'}</span>
        </div>
        <div className="rc-1m">
          <span className="rc-17">STARTS</span>
          <span className="rc-2k">{shortDate(contract.starts_on) || 'not set'}</span>
        </div>
      </div>

      <div className="rc-2s">
        <span className="rc-2t">
          Extra contractual inclusions for this specific customer, if any, appear in the table below.
          <Link className="rc-3k" href={`/dashboard/fleetsmart?contract=${contract.id}`}>
            Open the contract
          </Link>
        </span>
      </div>

      <div className="rc-2u">
        <div className="rc-5g">
          <div className="rc-5h">FLEETSMART+ INCLUSIONS</div>
          <div className="rc-3l">SILVER</div>
          <div className="rc-3l">GOLD</div>
          <div className="rc-5i">PLATINUM</div>
        </div>

        {side.inclusions.map((i) => (
          <div className="rc-5j" key={i.inclusion}>
            <div className="rc-13">{i.inclusion}</div>
            <Cell on={i.silver} />
            <Cell on={i.gold} />
            <Cell on={i.platinum} last />
          </div>
        ))}

        {/* Extras agreed with this one customer, which is what the
            master workbook's note under the matrix refers to. */}
        {extras.map((e) => (
          <div className="rc-5j" key={`extra-${e.inclusion}`}>
            <div className="rc-13">
              {e.inclusion}
              <span className="rc-12">agreed for this customer</span>
            </div>
            <Cell on={e.tiers.includes('Silver')} />
            <Cell on={e.tiers.includes('Gold')} />
            <Cell on={e.tiers.includes('Platinum')} last />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A tick or nothing. Never an input: the matrix is read, never typed. */
function Cell({ on, last }: { on: boolean; last?: boolean }) {
  return (
    <div className={last ? 'rc-14' : 'rc-k'}>
      {on
        ? <span className="rc-c"><ITick size={13} /></span>
        : <span className="rc-6" aria-label="not included"><IMinus size={12} /></span>}
    </div>
  );
}
