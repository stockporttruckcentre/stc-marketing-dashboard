/* =============================================================
   A purchase ledger with the same claim semantics and no database.

   The SQL is proved against a real server by
   `scripts/sql/external-claim-race.sh`, which runs twenty simultaneous
   claims and asserts exactly one is granted. This is the other half:
   the RUNTIME behaving correctly when it is told `claimed`,
   `in_progress`, `done`, `failed` or `uncertain`, with a fake provider
   whose paid-call count can be counted.

   The claim is a `Map.has` followed by a `Map.set` with nothing awaited
   between them, which in one JavaScript thread is as atomic as the
   INSERT is in PostgreSQL. That is the property being modelled: the
   decision to call the provider is taken in one indivisible step.
   ============================================================= */
import type { Claim, ExternalEffectStore, Settlement } from '../../lib/command/external';

export type LedgerRow = {
  key: string;
  actor: string;
  state: 'pending' | 'done' | 'failed' | 'uncertain';
  result?: Record<string, unknown> | null;
  why?: string | null;
  claimedAt: number;
  seen: number;
};

export function fakeLedger(opts: { now?: () => number; staleAfterMs?: number } = {}) {
  const rows = new Map<string, LedgerRow>();
  const now = opts.now ?? (() => 0);
  const staleAfter = opts.staleAfterMs ?? 5 * 60_000;

  const store: ExternalEffectStore = {
    async claim(input) {
      const held = rows.get(input.key);

      if (!held) {
        /* THE CLAIM, IN ONE STEP.

           Nothing is awaited between the look and the write, so no
           other caller can interleave. That is what the primary key
           does for the real one. */
        rows.set(input.key, {
          key: input.key, actor: input.actor, state: 'pending',
          claimedAt: now(), seen: 0,
        });
        return { state: 'claimed' } as Claim;
      }

      held.seen += 1;
      if (held.state === 'done') {
        return { state: 'done', result: held.result ?? {} } as Claim;
      }
      if (held.state === 'failed') {
        return { state: 'failed', why: held.why ?? 'the provider refused' } as Claim;
      }
      if (held.state === 'uncertain') {
        return { state: 'uncertain', why: held.why ?? 'unsettled' } as Claim;
      }
      if (now() - held.claimedAt >= staleAfter) {
        held.state = 'uncertain';
        held.why = 'a claim was made and never settled, so whether the provider charged for it is unknown';
        return { state: 'uncertain', why: held.why } as Claim;
      }
      return { state: 'in_progress' } as Claim;
    },

    async settle(input) {
      const held = rows.get(input.key);
      if (!held) return { ok: false, why: 'there is no attempt with that key to settle' };
      if (held.actor !== input.actor) return { ok: false, why: 'that attempt belongs to somebody else' };
      if (held.state !== 'pending') return { ok: true, settled: false };
      held.state = input.state as Settlement;
      held.result = input.result ?? null;
      held.why = input.why ?? null;
      return { ok: true, settled: true };
    },

    async read(key) {
      const held = rows.get(key);
      return held ? { ...held } : { state: 'absent' };
    },
  };

  return { store, rows };
}
