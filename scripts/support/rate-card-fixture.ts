/* =============================================================
   One rate card, for every check that needs one.

   `check:rate-card-export` compares a workbook against the master and
   `check:rate-card-pdf` compares a PDF against that workbook. If each
   built its own card, the parity between them would be a parity
   between two different cards, which is no parity at all.

   It is the KNDS card, because that is the one the signed master
   carries and the one the export check reads back cell by cell.
   ============================================================= */
import { KIT_RATES, LABOUR_POOLS, FS_INCLUSIONS } from '../../lib/ratecards/kit.generated';
import { round2 } from '../../lib/ratecards/format';
import type { FullCard } from '../../lib/ratecards/types';

export function kndsCard(): FullCard {
  const rates = KIT_RATES.flatMap((r) => {
    const cols = r.axles ?? [0];
    return cols.map((axle, c) => {
      const signed = r.signed[c];
      const pool = r.pool ? LABOUR_POOLS[r.pool]! : null;
      return {
        id: `${r.id}-${axle}`, card_id: 'x', rate_id: r.id, section: r.section, item: r.item,
        axle: r.axles ? axle : 0, basis: r.basis,
        hours: r.hours?.[c] ?? null, pool: r.pool,
        amount: typeof signed === 'number' && r.basis !== 'derived' ? signed : null,
        text_value: typeof signed === 'string' ? signed : null,
        override_value: null, overridden_by: null, overridden_at: null,
        cap: r.cap, cap_by: r.capBy, position: 0,
        price: r.basis === 'derived' && r.hours ? round2(r.hours[c]! * pool!)
          : typeof signed === 'number' ? signed : null,
        price_stc: null, would_be: null, over_cap: false,
      };
    });
  });

  return {
    card: {
      id: 'x', ref: 'RC-1', contact_id: null, customer_name: 'KNDS UK',
      effective_from: '2026-09-15', good_until: '2027-09-15', status: 'draft',
      main_contact: 'Sarah Bradd', address: 'Sir Richard Fairey Road, Stockport, SK4 5DY',
      telephone: '0161 9755729', email: 'sarah.bradd@knds.co.uk',
      other_detail: null, accounts_detail: null, contract_id: 'c1', show_fleetsmart: true,
      extra_inclusions: [], owner_id: null, approved_by: null, approved_at: null,
      updated_at: new Date().toISOString(), days_old: 0, ageing: false, expired: false, editable: true,
    },
    labour: [], rates: rates as FullCard['rates'], managers: [],
    fleetsmart: {
      contract: { id: 'c1', ref: 'FS-1', plan: 'Platinum', starts_on: '2026-09-15', status: 'accepted', extras: {} },
      shown: true, extras: [],
      inclusions: FS_INCLUSIONS.map((i, n) => ({ ...i, position: n })),
    },
    parts: [], missing: [],
  };
}
