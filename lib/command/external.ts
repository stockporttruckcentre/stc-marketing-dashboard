/* =============================================================
   The record of a purchase that cannot be undone.

   A Lusha credit leaves the building. The database transaction that
   records what it bought may then fail, and the credit is still gone.
   So the purchase is claimed before it happens and settled as soon as
   it answers, in its own transaction, outside the programme's, and the
   programme consumes what is stored.

   THREE THINGS THIS PORT EXISTS TO ESTABLISH.

   1. AT MOST ONE PROVIDER CALL PER KEY, UNDER CONCURRENCY.

      `claim` is a single INSERT decided by a primary key. Exactly one
      of any number of simultaneous callers is told `claimed`, and only
      `claimed` permits a provider call. Everybody else is told what is
      happening to the attempt and consumes, waits, or stops.

   2. NO CLIENT MAY MANUFACTURE PROVIDER EVIDENCE.

      The runtime turns a stored `done` result into database changes. A
      browser that could write here could invent a Lusha answer. The
      functions behind this port are revoked from `authenticated` and
      granted to the service role only, and this module is server side.
      Permission for the OPERATION is unchanged and unaffected: the
      actor still needs `crm.enrich`, checked the ordinary way, and the
      actual CRM writes still go through the actor's own session under
      row level security. The service role records the purchase and
      nothing else.

   3. AN UNCERTAIN CALL IS NOT A RETRYABLE ONE.

      A process that claims, calls Lusha and dies leaves a claim behind.
      Whether the credit was spent is unknowable from here. Retrying is
      only safe when the provider deduplicates on a key we supply, and
      Lusha does not: `lib/lusha.ts` is the whole surface this
      application uses, and there is no idempotency key in any of it.
      So a stale claim comes back `uncertain` and the runtime stops.
      Reconciling it against the Lusha console is a person's job.
   ============================================================= */

/** What a caller is told when it asks for an attempt. */
export type Claim =
  /** You own it. Call the provider, then settle it. */
  | { state: 'claimed' }
  /** Somebody else owns it and has not settled it yet. */
  | { state: 'in_progress' }
  /** It was bought and the answer is here. */
  | { state: 'done'; result: Record<string, unknown> }
  /** The provider refused, and said why. */
  | { state: 'failed'; why: string }
  /**
   * A claim was made and never settled.
   *
   * The provider may have been charged. Nothing here may call it again.
   */
  | { state: 'uncertain'; why: string };

export type Settlement = 'done' | 'failed' | 'uncertain';

export type ExternalEffectStore = {
  /**
   * Ask for the right to make one paid call.
   *
   * `claimed` is the only answer that permits it.
   */
  claim(input: {
    key: string;
    capability: string;
    subject: string | null;
    strategy: string;
    /** The real person whose command this is. */
    actor: string;
  }): Promise<Claim | { state: 'error'; why: string }>;

  /** Record what the provider did, once. */
  settle(input: {
    key: string;
    actor: string;
    state: Settlement;
    result?: Record<string, unknown> | null;
    why?: string | null;
  }): Promise<{ ok: true; settled: boolean } | { ok: false; why: string }>;

  /** What the ledger holds. Claims nothing. */
  read(key: string): Promise<Record<string, unknown>>;
};

/**
 * What a caller with no ledger wired up gets.
 *
 * A refusal, not a claim. A command that would have spent a credit with
 * nowhere to record it is a command that must not spend one.
 */
export const NO_LEDGER: ExternalEffectStore = {
  async claim() {
    return { state: 'error', why: 'there is nowhere to record a paid call on this request' };
  },
  async settle() {
    return { ok: false, why: 'there is nowhere to record a paid call on this request' };
  },
  async read() {
    return { state: 'absent' };
  },
};

/** The narrowest slice of the service-role client this needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const said = (error: unknown) => String((error as { message?: string })?.message ?? error);

/**
 * The real ledger, over the service-role client.
 *
 * The only place in this application that reaches the attempt table.
 * Called from the server, on behalf of an actor who has already been
 * checked for `crm.enrich` by the canonical runtime.
 */
export function ledgerStore(connect: () => Rpc): ExternalEffectStore {
  /* Built on first use rather than on construction. A request that
     never reaches a paid operation never builds a service-role client,
     which is what lets the route be exercised with no Supabase
     environment at all: the client that is never needed is never
     made. */
  let held: Rpc | null = null;
  const client = () => (held ??= connect());

  return {
    async claim(input) {
      const { data, error } = await client().rpc('command_external_claim', {
        p_key: input.key,
        p_capability: input.capability,
        p_subject: input.subject,
        p_strategy: input.strategy,
        p_actor: input.actor,
      });
      if (error) return { state: 'error', why: said(error) };

      const body = (data ?? {}) as { state?: string; result?: unknown; why?: string };
      switch (body.state) {
        case 'claimed': return { state: 'claimed' };
        case 'in_progress': return { state: 'in_progress' };
        case 'done':
          return { state: 'done', result: (body.result ?? {}) as Record<string, unknown> };
        case 'failed':
          return { state: 'failed', why: body.why ?? 'the provider refused' };
        case 'uncertain':
          return {
            state: 'uncertain',
            why: body.why ?? 'a claim was made and never settled',
          };
        default:
          return { state: 'error', why: `the ledger answered "${body.state}"` };
      }
    },

    async settle(input) {
      const { data, error } = await client().rpc('command_external_settle', {
        p_key: input.key,
        p_actor: input.actor,
        p_state: input.state,
        p_result: input.result ?? null,
        p_why: input.why ?? null,
      });
      if (error) return { ok: false, why: said(error) };
      return { ok: true, settled: Boolean((data as { settled?: boolean })?.settled) };
    },

    async read(key) {
      const { data, error } = await client().rpc('command_external_read', { p_key: key });
      if (error) return { state: 'error', why: said(error) };
      return (data ?? { state: 'absent' }) as Record<string, unknown>;
    },
  };
}
