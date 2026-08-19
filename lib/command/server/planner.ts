/* =============================================================
   The authoritative planning environment.

   `planCommand` is one function and it was being called in two places
   with two different amounts of knowledge. The browser called it with
   the live vocabulary loaded; the server called it with an empty index.
   Same code, same sentence, different plan. The bar could show "count
   trailers where make is Chereau" and the server could run "count
   trailers", and every gate downstream would pass, because each side
   was internally consistent.

   One planner is not the same as one planning ENVIRONMENT. This is the
   environment: vocabulary loaded first, actor capabilities passed in,
   and a hash over the meaning that comes out.

   THE HASH IS A DRIFT DETECTOR, NOT A TOKEN.

   The server replans from the raw text on execution whatever the client
   sends, so nothing rests on the hash being unforgeable. What it
   catches is the case where the same sentence honestly means something
   different by the time somebody presses Enter, because a trailer was
   sold or a customer was added and a word that named nothing now names
   a make. Executing that silently is exactly the failure this
   architecture exists to remove: the reading that was agreed to is not
   the reading that runs.

   On a mismatch the answer is the newly planned meaning, for preview,
   and not the answer to a question nobody asked.

   A CLIENT PLAN IS NEVER ACCEPTED. This module takes a string. There is
   no parameter it could arrive through.
   ============================================================= */
import { createHash } from 'crypto';
import { planCommand, type CommandPlanning } from '../plan';
import type { VocabularySource } from './vocabulary';
import type { CommandContext } from '../context';
import type { Plan } from '../ir/types';
import type { MissingInput } from '../ir/validate';

/* -------------------------------------------------------------
   Hashing a meaning
   ------------------------------------------------------------- */

/**
 * Stable serialisation, so key order cannot make one meaning look like
 * two. Undefined properties are dropped rather than serialised, since
 * an absent field and a field set to undefined are the same plan.
 */
function canonical(x: unknown): string {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/**
 * A fingerprint of what a plan MEANS.
 *
 * Over the plan and nothing else. The summary is wording and the
 * confidence is a reader's report on itself, so neither is here: a
 * reworded summary is not a changed question, and refusing on one would
 * make the guard fire for no reason anybody could see.
 */
export function planHash(plan: Plan): string {
  return createHash('sha256').update(canonical(plan)).digest('hex').slice(0, 32);
}

/* -------------------------------------------------------------
   What a caller gets back
   ------------------------------------------------------------- */

/**
 * The meaning, as the server reads it. This is what the bar displays.
 *
 * Deliberately not the plan itself. Sending the plan back would invite
 * somebody to send it forward again, and the one thing that must never
 * happen is a client plan being treated as authority.
 */
export type PlannedMeaning = {
  hash: string;
  /** The interpreted command, in words. Authoritative. */
  summary: string;
  /** Safe to offer, and safe to run on Enter. */
  runnable: boolean;
  /** A preview and an explicit yes first. */
  confirm: boolean;
  completion: 'complete' | 'partial' | 'refused' | 'incomplete';
  /** Parts of the request that went unread. Shown, never swallowed. */
  unresolved: string[];
  /**
   * Required values the sentence did not carry, as questions.
   *
   * Present only when `completion` is `incomplete`. Nothing runs in
   * that state: the answer completes the raw sentence and the server
   * plans the whole thing again, so the browser never becomes the
   * authority on what was meant.
   */
  missing: MissingInput[];
  /** Why it is not runnable, when it is not. */
  blocked: string[];
  availability: {
    representable: boolean;
    permitted: boolean;
    executable: boolean;
    missingPermissions: string[];
  };
  requirements: { kind: string; id: string; because: string }[];
};

export type Planned = { meaning: PlannedMeaning; planning: CommandPlanning };

export type PlanRequest = {
  /** The sentence. The only input. */
  text: string;
  /** The actor's capabilities, derived from their role by the caller. */
  capabilities: Iterable<string>;
  /**
   * The vocabulary valid for THIS actor.
   *
   * Awaited here and handed to `planCommand`, which installs it and
   * reads in one synchronous run. Nothing is installed by this module,
   * so there is no window between resolving somebody's vocabulary and
   * planning with it in which another request could resolve theirs.
   */
  vocabulary: VocabularySource;
  /**
   * What the screen had open or selected.
   *
   * Arrives with the request, is planned with, and goes into the hash,
   * so the reading somebody agreed to includes what they were pointing
   * at. A client that sends none can point at nothing.
   */
  context?: CommandContext;
};

/**
 * Plan a sentence the way this application means it, right now.
 *
 * `null` when no reader made anything of it, which is different from a
 * plan that is refused: the first means the words named nothing here,
 * the second means they named something this will not do.
 */
export async function planAuthoritatively(req: PlanRequest): Promise<Planned | null> {
  /* Resolved first, then passed in. The last await in this function is
     this one: everything from here to the plan is synchronous, so the
     index that was installed is the index that was read. */
  const vocabulary = await req.vocabulary();

  const planning = planCommand(req.text, {
    actorCapabilities: req.capabilities,
    vocabulary,
    context: req.context,
  });
  if (!planning) return null;

  const { availability, completion } = planning;
  const blocked: string[] = [];
  if (!availability.representable) {
    blocked.push(...planning.problems
      .filter((p) => p.severity === 'fatal')
      .map((p) => `${p.at}: ${p.what}`));
  }
  if (availability.permitted === false) {
    blocked.push(`you do not have ${availability.missingPermissions.join(' or ')}`);
  }
  if (!availability.executable) {
    blocked.push(...availability.unavailable.map((u) => `${u.need}: ${u.why}`));
  }

  return {
    planning,
    meaning: {
      hash: planHash(planning.plan),
      summary: planning.presentation.summary,
      /* Every gate, in one boolean, decided here rather than in each
         caller's own idea of what "can I run this" means. */
      /* An incomplete command never runs. It is a question. */
      runnable: availability.representable
        && availability.permitted === true
        && availability.executable
        && completion.kind !== 'refused'
        && completion.kind !== 'incomplete',
      confirm: planning.confirm,
      completion: completion.kind,
      unresolved: completion.kind === 'partial' ? completion.unresolved : [],
      /* WHAT IT STILL NEEDS, AS A QUESTION.

         Understood and short of a value is a different state from not
         understood, and it has a different answer: "create a LinkedIn
         post" is not a sentence nobody can read, it is one waiting for
         its content. Deterministic, from the capability's own declared
         inputs, so a reader cannot forget to ask and nothing is
         guessed. */
      missing: completion.kind === 'incomplete' ? completion.missing : [],
      blocked,
      availability: {
        representable: availability.representable,
        /* A planning call always names an actor, so this is never
           unknown here. `null` means somebody forgot, and forgetting
           reads as no rather than as yes. */
        permitted: availability.permitted === true,
        executable: availability.executable,
        missingPermissions: availability.missingPermissions,
      },
      requirements: planning.requirements,
    },
  };
}

/* -------------------------------------------------------------
   Preview and execution have to agree
   ------------------------------------------------------------- */

export type AgreementResult =
  | { agreed: true; planned: Planned }
  | { agreed: false; reason: 'not understood' }
  | { agreed: false; reason: 'meaning changed'; planned: Planned };

/**
 * Replan, then check the reading against the one that was previewed.
 *
 * The plan that runs is always the one built here from the text. The
 * hash decides whether it is the plan somebody agreed to, and when it
 * is not the new reading goes back for preview instead of running.
 *
 * A caller that sends no hash never previewed anything, and gets the
 * same refusal: agreeing to a reading is part of running a command, not
 * an optional step a client may skip.
 */
export async function planForExecution(
  req: PlanRequest & { previewHash: string },
): Promise<AgreementResult> {
  const planned = await planAuthoritatively(req);
  if (!planned) return { agreed: false, reason: 'not understood' };
  if (planned.meaning.hash !== req.previewHash) {
    return { agreed: false, reason: 'meaning changed', planned };
  }
  return { agreed: true, planned };
}
