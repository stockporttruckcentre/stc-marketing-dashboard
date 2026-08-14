/* =============================================================
   The one place raw command text becomes a plan.

   Before this, the bar parsed a sentence and then made every decision
   from the `QueryPlan` that came back: whether to run it, what to show,
   what to post to the server. The IR existed beside that arrangement
   and nothing consulted it.

   Now there is one path:

     raw text -> normalise -> reader -> canonical Plan

   `parseQuery` is still underneath and is untouched. It is a READER
   here, not an authority: its output crosses into the canonical IR
   immediately and nothing past this function sees a `QueryPlan` again.
   When the reader is rewritten to emit IR directly, this signature does
   not change and neither does anything that calls it.

   That ordering matters. Moving the application onto the IR and
   rewriting the parser in one change would mean two things could have
   caused any difference in behaviour.

   WHAT COMES BACK, AND WHY ALL OF IT.

   A caller needs more than the plan. It needs to know whether the plan
   answers the whole question, what permissions it implies, whether it
   has to be confirmed first, and whether this application can carry it
   out at all. Those were four separate judgements made in four places,
   each with its own idea of the answer. They are computed here, once,
   from the plan.
   ============================================================= */
import { parseQuery, type QueryPlan } from './query';
import type { VocabularyIndex } from './vocab';
import { adaptQueryPlan } from './ir/adapt';
import {
  validate, completion, derivedRequirements, needsConfirmation,
  type Problem, type Requirement, type Completion,
} from './ir/validate';
import { executability, selectToQueryPayload, type QueryPayload, type Unavailable } from './ir/execute';
import type { Plan, Select } from './ir/types';

/* =============================================================
   Availability

   Three different questions that were one word. A capability can be
   expressible, allowed, and still impossible.
   ============================================================= */

export type Availability = {
  /** The plan is well formed. Nothing about the actor is involved. */
  representable: boolean;
  /**
   * The actor holds every permission the plan derives.
   *
   * `null` when nobody said who the actor is, which is the case in the
   * browser: the bar can narrow what it offers, but the answer that
   * counts is the server's. A null here must never be read as a yes.
   */
  permitted: boolean | null;
  /** Missing permissions, when the actor is known. */
  missingPermissions: string[];
  /**
   * Something in this application actually performs every step.
   *
   * False for a plan that emails a result, because no handler exists.
   * A capability with no handler is representable and can be permitted
   * and is still not something the bar can carry out, and offering it
   * anyway teaches people the tool is unreliable.
   */
  executable: boolean;
  unavailable: Unavailable[];
};

export type CommandPlanning = {
  /** Exactly what was typed. */
  text: string;
  /** The canonical plan. The single semantic authority. */
  plan: Plan;
  /**
   * The plan's one select, for the read path.
   *
   * Present when the plan is a single read, which is every plan this
   * slice produces. Absent once the readers emit multi step plans.
   */
  select: Select | null;
  problems: Problem[];
  completion: Completion;
  requirements: Requirement[];
  /** Permission atoms only, which is what a gate compares against. */
  permissions: string[];
  confirm: boolean;
  availability: Availability;
  /**
   * Wording, carried beside the meaning and never used to decide
   * anything. Confidence is a reader's report on itself, which is why
   * it is not in the IR: a plan is right or it is not, and a number
   * saying how sure something felt is not a semantic property.
   */
  presentation: {
    summary: string;
    confidence: number;
    amountLabel: string | null;
    groupLabel: string | null;
    orderLabel: string | null;
    derivedLabel: string | null;
  };
};

/* ------------------------------------------------------------- */

function availabilityOf(plan: Plan, actor?: Iterable<string>): Availability {
  const problems = validate(plan);
  const representable = !problems.some((p) => p.severity === 'fatal');
  const { executable, missing } = executability(plan);

  const wanted = derivedRequirements(plan)
    .filter((r) => r.kind === 'permission')
    .map((r) => r.id);

  let permitted: boolean | null = null;
  let missingPermissions: string[] = [];
  if (actor) {
    const held = new Set(actor);
    missingPermissions = [...new Set(wanted.filter((w) => !held.has(w)))];
    permitted = missingPermissions.length === 0;
  }

  return { representable, permitted, missingPermissions, executable, unavailable: missing };
}

/**
 * Plan a sentence.
 *
 * `null` when no reader could make anything of it, which is different
 * from a plan that is refused: the first means the words said nothing
 * this application recognises, the second means they said something it
 * will not do.
 *
 * THE VOCABULARY IS AN INPUT, NOT AMBIENT STATE.
 *
 * What a sentence means depends on what the database holds, and some of
 * what it holds is visible to one person and not another. While that
 * lived in a module global, the answer to "what does this mean"
 * depended on who had last refreshed a cache, which on a shared server
 * was somebody else.
 *
 * It is now an argument, passed straight through to the reader. There
 * is no installation step and nothing shared between two calls, so two
 * sentences read with two different indexes are two independent reads
 * and the order they happen in cannot matter.
 *
 * Omitting it means the empty index, which is a choice somebody made
 * rather than a load they forgot.
 */
export function planCommand(
  text: string,
  opts?: { actorCapabilities?: Iterable<string>; vocabulary?: VocabularyIndex },
): CommandPlanning | null {
  const read: QueryPlan | null = parseQuery(text, opts?.vocabulary);
  if (!read) return null;

  const { plan, select } = adaptQueryPlan(read);

  return {
    text,
    plan,
    select,
    problems: validate(plan),
    completion: completion(plan),
    requirements: derivedRequirements(plan),
    permissions: [...new Set(
      derivedRequirements(plan).filter((r) => r.kind === 'permission').map((r) => r.id),
    )],
    confirm: needsConfirmation(plan),
    availability: availabilityOf(plan, opts?.actorCapabilities),
    presentation: {
      summary: read.summary,
      confidence: read.confidence,
      amountLabel: read.amountLabel ?? null,
      groupLabel: read.groupBy?.label ?? null,
      orderLabel: read.order?.label ?? null,
      derivedLabel: read.derived?.label ?? null,
    },
  };
}

/**
 * The wire body for the existing read executor.
 *
 * Built from the canonical `Select`, never from the reader's output.
 * That is the whole point of the direction: the compatibility layer
 * reads the IR, so a difference between what the IR says and what the
 * executor runs is impossible rather than merely unlikely.
 */
export function planningToQueryPayload(p: CommandPlanning): QueryPayload | null {
  if (!p.select) return null;
  return selectToQueryPayload(p.select, {
    summary: p.presentation.summary,
    amountLabel: p.presentation.amountLabel,
    groupLabel: p.presentation.groupLabel,
    orderLabel: p.presentation.orderLabel,
    derivedLabel: p.presentation.derivedLabel,
  });
}
