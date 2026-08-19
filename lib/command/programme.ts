/* =============================================================
   Several clauses, wired into one plan.

   The readers each produce a step. This gives them ids, and where a
   clause points back at what the one before produced, it consumes that
   step's result through a `ResultRef` instead of selecting again.

     find customers with more than 20 trailers      s1  select
     create a list called Fleet Prospects from them s2  invoke  <- s1
     export it to Excel                             s3  emit    <- s2

   THE POINTING BACK IS THE WHOLE POINT.

   Three separate commands would reparse "export it to Excel" against
   nothing and answer a question about the word "it". One programme
   carries the selection through, which is why the file holds the
   customers the first clause described and not a second reading of
   anything.

   WHAT IS STILL REFUSED.

   Dependent FIELD WRITES. "Put the price up 10% then set the margin
   from the new price" is two steps where the second reads what the
   first wrote, and `dependence.ts` refuses it because every change in a
   programme is computed from the rows as they stand. That refusal is
   unchanged and is not what this file is about: a select feeding an
   operation feeding an emit is a pipeline, not two writes racing.
   ============================================================= */
import type { CommandPlanning } from './plan';
import { isResultRef, type Emit, type Invoke, type Mutate, type Plan, type ResultRef,
  type Select, type Source, type Step } from './ir/types';
import { nounFor, type FileFormat } from './output';

/** What a step makes available to the one after it. */
function produces(step: Step): ResultRef | null {
  const id = step.id;
  if (!id) return null;
  switch (step.op) {
    case 'select': return { ref: 'rows', step: id };
    case 'update':
    case 'delete': return { ref: 'rows', step: id };
    case 'create': return { ref: 'record', step: id };
    /* WHAT AN OPERATION LEAVES BEHIND IS THE OPERATION'S TO SAY.

       Most of them make or act on one record, and this said `record`
       for all of them. The finder makes a set: "find 20 waste companies
       near Hyde and put them on Fleet Prospects" hands twenty
       companies to the next clause, and a reference calling that one
       record is a malformed plan the validator refuses. The step
       already declares its shape, derived from the registry. */
    case 'invoke': {
      const kind = (step as Invoke).produces?.kind;
      return { ref: kind === 'rows' ? 'rows' : 'record', step: id };
    }
    case 'emit': return { ref: 'artefact', step: id };
    default: return null;
  }
}

/**
 * Where a step takes its rows from, when it takes them from anywhere.
 *
 * One accessor for four different property names, so nothing below has
 * to switch on the step kind twice.
 */
function sourceOf(step: Step): Source | undefined {
  switch (step.op) {
    case 'emit': return (step as Emit).from;
    case 'invoke': return (step as Invoke).subject;
    case 'create':
    case 'update':
    case 'delete': return (step as Mutate).match;
    case 'select': return (step as Select).from;
    default: return undefined;
  }
}

function withSource(step: Step, from: Source): Step {
  switch (step.op) {
    case 'emit': return { ...(step as Emit), from };
    case 'invoke': return { ...(step as Invoke), subject: from };
    case 'create':
    case 'update':
    case 'delete': return { ...(step as Mutate), match: from } as Step;
    case 'select': return { ...(step as Select), from };
    default: return step;
  }
}

/**
 * Can this step take the previous clause's result?
 *
 * A select cannot. Not because its `from` will not hold a reference, but
 * because a clause that re-selects has already read the sentence a
 * second time, and pointing that reading at the earlier rows keeps the
 * filters it invented. Those clauses lose their select entirely.
 */
function canConsume(step: Step): boolean {
  return step.op === 'emit' || step.op === 'invoke'
    || step.op === 'update' || step.op === 'delete';
}

/**
 * Is this step the one before it, said again?
 *
 * The same table, the same columns, the same values, and the rows this
 * one acts on are the rows that one produced. Anything else is a second
 * change: "put it back to draft and take the picture off it" writes two
 * columns and is two things.
 */
function restates(step: Step | undefined, before: Step | undefined): boolean {
  if (!step || !before) return false;
  if (step.op !== 'update' || before.op !== 'update') return false;

  const mine = step as Mutate;
  const theirs = before as Mutate;
  if (mine.target.entity !== theirs.target.entity) return false;

  /* It has to be acting on what the step before produced. A clause that
     found its own rows is about its own rows. */
  const from = mine.match;
  if (!from || !isResultRef(from) || from.step !== theirs.id) return false;

  return JSON.stringify(mine.set) === JSON.stringify(theirs.set);
}

/** Every reference a step holds, rewritten. */
function remap(step: Step, move: (ref: ResultRef) => ResultRef): Step {
  let out = step;
  const from = sourceOf(step);
  if (from && isResultRef(from)) out = withSource(out, move(from));

  if (out.op === 'invoke') {
    const invoke = out as Invoke;
    if (invoke.args) {
      const args: Record<string, (typeof invoke.args)[string]> = {};
      for (const [k, v] of Object.entries(invoke.args)) {
        args[k] = isResultRef(v as never) ? move(v as ResultRef) : v;
      }
      out = { ...invoke, args };
    }
  }
  return out;
}

/**
 * The steps a clause planned.
 *
 * A read clause plans as a select plus, if it asked for a file, an
 * emit. Only the select is the thing later clauses point at.
 */
function stepsOf(planning: CommandPlanning): Step[] {
  return planning.plan.steps;
}

/**
 * What a clause did, in words, for the preview.
 *
 * A clause whose selection was dropped must not be described by it. The
 * reader wrote "list of customers, as an Excel workbook" for "export it
 * to Excel", and leaving that in the preview tells somebody the file
 * holds every customer when it holds the result of the clause before.
 */
function describe(planning: CommandPlanning, consumed: boolean, instead?: string): string {
  const { summary, outputLabel } = planning.presentation;
  const label = instead ?? outputLabel;
  if (!consumed || !label) return summary;
  return `that result as ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * A clause that takes an earlier clause's FILE takes that file.
 *
 * "Export the sold curtainsiders as a PDF and attach it to STC143580"
 * is one file, produced once and then put somewhere. Read clause by
 * clause the second one names no format, defaults to a spreadsheet, and
 * the programme downloads a PDF and attaches an Excel workbook. The
 * output is adopted from the step being consumed, so there is one file
 * and the preview names it correctly.
 */
function adoptOutput(consumer: Step, from: ResultRef, steps: Step[]): Step {
  if (consumer.op !== 'emit' || from.ref !== 'artefact') return consumer;
  const source = steps.find((s) => s.id === from.step);
  if (!source || source.op !== 'emit') return consumer;
  return { ...(consumer as Emit), output: (source as Emit).output };
}

export type Composed = {
  plan: Plan;
  /** In words, clause by clause. */
  summary: string;
};

/**
 * Wire a list of clause plans into one programme.
 *
 * Steps are renumbered so ids are unique across the whole thing, and
 * every clause that pointed back is given the reference it needs.
 */
export function composeProgramme(
  clauses: { planning: CommandPlanning; refersBack: boolean }[],
): Composed | null {
  if (!clauses.length) return null;

  const steps: Step[] = [];
  const summaries: string[] = [];
  let previous: ResultRef | null = null;

  clauses.forEach((clause, i) => {
    const mine = stepsOf(clause.planning);
    if (!mine.length) return;

    const earlier = previous;

    /* WHICH STEP CONSUMES, AND WHICH STEPS GO.

       The step that DOES something is the one that consumes, not
       necessarily the first. "Export it to Excel" plans as a select and
       an emit, and it is the emit that wanted the earlier rows. The
       select in front of it is a second reading of the word "it",
       complete with whatever filter that reading invented, so it is
       dropped and anything still pointing at it is redirected. */
    let at = -1;
    const dropped = new Set<string>();
    if (earlier && clause.refersBack) {
      at = mine.findIndex(canConsume);
      if (at >= 0) {
        for (const s of mine.slice(0, at)) {
          if (s.op === 'select' && s.id) dropped.add(s.id);
        }
      }
    }

    const survivors = mine.filter((s) => !dropped.has(s.id ?? ''));
    if (!survivors.length) return;

    /* Unique ids, in clause order, so a reference can name one. Numbered
       after the drop, so the ids run without gaps and nothing reads as a
       step that went missing. */
    const ids = new Map<string, string>();
    survivors.forEach((s, j) => { if (s.id) ids.set(s.id, `c${i + 1}s${j + 1}`); });

    const resolve = (ref: ResultRef): ResultRef => {
      /* Anything pointing at a dropped select points at what the clause
         before produced instead, whatever kind that is. Keeping the old
         `ref` kind and only moving the step id would claim a set of rows
         where an operation made one record. */
      if (dropped.has(ref.step) && earlier) return earlier;
      const to = ids.get(ref.step);
      return to ? { ...ref, step: to } : ref;
    };

    const consumer = at >= 0 ? mine[at] : null;
    let adopted: string | undefined;

    const kept = survivors
      .map((s, j) => ({ ...s, id: `c${i + 1}s${j + 1}` } as Step))
      .map((s, j) => {
        if (survivors[j] !== consumer || !earlier) return s;
        const wired = withSource(s, earlier);
        const taken = adoptOutput(wired, earlier, steps);
        if (taken !== wired && taken.op === 'emit' && taken.output.kind === 'file') {
          adopted = nounFor(taken.output.format as FileFormat);
        }
        return taken;
      })
      .map((s) => remap(s, resolve));

    /* THE SAME THING SAID TWICE IS ONE THING.

       "Reject this post and send it back to draft" is one instruction
       in two halves: the second describes the state the first puts the
       post in. Read as two steps it writes draft over draft, and the
       preview says a change is happening twice.

       So a clause whose only step writes exactly the same columns to
       exactly the same values, on the rows the step before it produced,
       is a restatement rather than a second change. Narrow on purpose:
       a different column, a different value or different rows is a
       second change and stays one. */
    const restated = kept.length === 1 && restates(kept[0], steps[steps.length - 1]);
    if (!restated) {
      steps.push(...kept);
      summaries.push(describe(clause.planning, dropped.size > 0, adopted));
    }

    /* What the LAST step of this clause makes available. A restatement
       makes available what the step it restated does. */
    if (!restated) previous = produces(kept[kept.length - 1]) ?? previous;
  });

  if (!steps.length) return null;

  return {
    plan: {
      steps,
      unmet: clauses.flatMap((c) => c.planning.plan.unmet ?? []),
    },
    summary: summaries.join(', then '),
  };
}

/** Is a plan a select whose rows a later step can consume? */
export function isSelect(step: Step): step is Select {
  return step.op === 'select';
}
