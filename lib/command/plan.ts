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
import { parseEdit, readRecordRefs, type EditPlan } from './mutate';
import { readOutput } from './output';
import { parseLifecycle } from './lifecycle';
import { parseRoleChange } from './roles';
import { ENTITIES } from './schema';
import { refersBack, splitClauses, type Clause } from './clauses';
import { composeProgramme } from './programme';
import {
  EMPTY_CONTEXT, readContextReference, resolveContext, type CommandContext,
} from './context';
import type { VocabularyIndex } from './vocab';
import { adaptQueryPlan } from './ir/adapt';
import { adaptEditPlan } from './ir/adapt-edit';
import type { CrmCapabilities, CrmCapability } from '@/lib/crm/permissions';
import {
  validate, completion, derivedRequirements, needsConfirmation,
  type Problem, type Requirement, type Completion,
} from './ir/validate';
import { executability, selectToQueryPayload, type QueryPayload, type Unavailable } from './ir/execute';
import { destination, entity as entityDef, FILE_EMIT_CAPABILITY } from './ir/registry';
import type { Emit, Plan, Select } from './ir/types';

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
  /**
   * A question or an instruction.
   *
   * Decided here, once, and never again by anybody downstream. The bar
   * used to decide it for itself by calling the instruction reader
   * directly, which meant the semantic authority for a write lived in
   * the browser while the semantic authority for a read lived on the
   * server. Two authorities for one sentence is one too many.
   */
  kind: 'read' | 'mutate';
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
    /**
     * What kind of file this clause asked for, when it asked for one.
     *
     * Carried separately from the summary so a clause that consumes an
     * earlier result can be described without the selection it no longer
     * makes. "Export it to Excel" plans a select and an emit; the
     * composer throws the select away, and a summary still saying "list
     * of customers" would tell somebody the file holds every customer.
     */
    outputLabel?: string | null;
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
export type PlanOptions = {
  actorCapabilities?: Iterable<string>;
  vocabulary?: VocabularyIndex;
  /**
   * What the screen the sentence was typed on has open or selected.
   *
   * Part of the meaning, so it goes into the plan and therefore into
   * the plan hash: "move these to Bredbury" with two trailers selected
   * and with three is not the same command. Absent means the sentence
   * cannot point at anything, which is a refusal rather than a licence.
   */
  context?: CommandContext;
  /**
   * What the clause before this one produced.
   *
   * Only the ENTITY, never the rows: which rows is decided at execution
   * by the `ResultRef` the composer wires in. This is what lets "export
   * it to Excel" know it is about customers without the words saying
   * so, in exactly the way the screen's selection does for "export
   * these".
   */
  priorResult?: { entity: string };
};

export function planCommand(
  text: string,
  opts?: PlanOptions,
): CommandPlanning | null {
  /* SEVERAL CLAUSES ARE ONE PROGRAMME, NOT SEVERAL COMMANDS.

     "Find the customers ..., create a list from them and export it to
     Excel" is one thing somebody wants, and reading it as three
     commands loses the only part that matters: "them" and "it" are the
     result of the clause before. Split first, plan each clause with the
     readers that were already there, and wire the pointing back with a
     `ResultRef`. A sentence with one clause, which is nearly all of
     them, goes straight past this. */
  const clauses = splitClauses(text);
  if (clauses.length > 1) {
    const programme = planProgramme(clauses, opts);
    if (programme) return programme;
  }

  return planOneClause(text, opts);
}

/**
 * Every clause, planned and wired together.
 *
 * `null` when any clause is not understood, because half a programme is
 * not a programme: running the clauses that parsed would create a list
 * and not export it, and say it had done both.
 */
function planProgramme(
  clauses: Clause[],
  opts?: PlanOptions,
): CommandPlanning | null {
  const planned: { planning: CommandPlanning; refersBack: boolean }[] = [];

  let prior: { entity: string } | undefined;

  for (const clause of clauses) {
    const one = planOneClause(clause.text, {
      ...opts,
      /* Only where the clause actually points back. A clause that names
         its own subject is planned as though it stood alone. */
      priorResult: clause.refersBack ? prior : undefined,
    });
    if (!one) return null;
    planned.push({ planning: one, refersBack: clause.refersBack });

    /* What this clause leaves behind, for the next one.
       An operation leaves its SUBJECT's entity, which is how "mark
       these as sold and export the result" knows what the result is:
       without it the second clause was read against nothing and the
       whole sentence fell back to a single reading. */
    const last = one.plan.steps[one.plan.steps.length - 1];
    const entity = last && 'target' in last ? (last as { target: { entity: string } }).target.entity
      : last && last.op === 'select' && 'entity' in last.from ? last.from.entity
        : last && last.op === 'invoke' ? entityBehind(last.subject) ?? prior?.entity
          : one.select && 'entity' in one.select.from ? one.select.from.entity
            : prior?.entity;
    if (entity) prior = { entity };
  }

  const composed = composeProgramme(planned);
  if (!composed) return null;

  const plan = composed.plan;
  const writes = plan.steps.some((s) => s.op !== 'select');

  return {
    text: clauses.map((c) => c.text).join(', '),
    kind: writes ? 'mutate' : 'read',
    plan,
    /* A programme's rows come from its own first step, not from one
       select somebody can point a compatibility layer at. */
    select: null,
    problems: validate(plan),
    completion: completion(plan),
    requirements: derivedRequirements(plan),
    permissions: [...new Set(
      derivedRequirements(plan).filter((r) => r.kind === 'permission').map((r) => r.id),
    )],
    confirm: needsConfirmation(plan),
    availability: availabilityOf(plan, opts?.actorCapabilities),
    presentation: {
      summary: composed.summary,
      /* The least confident clause decides. A programme is only as well
         understood as its worst part. */
      confidence: Math.min(...planned.map((p) => p.planning.presentation.confidence)),
      amountLabel: null, groupLabel: null, orderLabel: null, derivedLabel: null,
    },
  };
}

/**
 * The record an attachment goes on, as a selection of one.
 *
 * Every entity whose title column the words match, tried in registry
 * order. Nothing is named here: an entity added to the registry with a
 * reference-shaped title column can be attached to without this
 * changing.
 */
function attachTarget(words: string[] | string): Select | null {
  const text = Array.isArray(words) ? words.join(' ') : words;
  const refs = readRecordRefs(text);
  const named = [...refs.stc, ...refs.coded][0];
  if (!named) return null;

  for (const spec of ENTITIES) {
    const def = entityDef(spec.id);
    const title = def?.titleField;
    if (!title) continue;
    /* A stock reference is a stock reference wherever it appears, and
       the title column is what carries it. */
    if (!/^(stc_no|chassis_number|reference)$/.test(title)) continue;
    return {
      op: 'select',
      from: { entity: spec.id },
      where: {
        kind: 'cmp', op: 'eq',
        left: { kind: 'field', of: { entity: spec.id, field: title } },
        right: { kind: 'literal', value: named },
      },
      produces: { kind: 'rows', entity: spec.id },
    };
  }
  return null;
}

/** The entity a source names, however it names it. */
function entityBehind(source: unknown): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const s = source as { entity?: string; from?: { entity?: string }; op?: string };
  if (s.entity) return s.entity;
  if (s.op === 'select' && s.from?.entity) return s.from.entity;
  return undefined;
}

function planOneClause(
  text: string,
  opts?: PlanOptions,
): CommandPlanning | null {
  /* SENDING IS AN INSTRUCTION TOO, AND IT IS THE ONE THAT WAS MEANT.

     "Email the sold trailers to Dave as a PDF" starts with a word that
     is also a column on a customer, so the field reader took it and
     wrote Dave's name into an email address. A destination clause with
     its verb at the front of the sentence is not a field write, and
     deciding that here rather than teaching the field reader about
     destinations keeps each reader doing one thing. */
  const sending = readOutput(text);
  const outbound = sending && sending.to.kind !== 'download' && sending.to.kind !== 'display';

  /* AN INSTRUCTION WINS OVER THE QUESTION ITS WORDS COULD ALSO BE.

     "Add £1k refurb to STC143980" is a sentence about trailers, and
     answering it with a count looks like it worked. So the instruction
     reader goes first, exactly as it did in the bar, and what changes is
     only that the decision now happens here where the server can make
     it too. */
  const write = outbound ? null : readInstruction(text, opts);
  if (write) return write;

  /* Making a record and getting rid of one, which are the other two
     ways a row's life changes. Read after a field write, because
     "delete the customer on STC143580" empties a column and the
     instruction reader is the one that knows that. */
  /* A ROLE CHANGE BEFORE ANYTHING ELSE READS IT AS SOMETHING TAMER.

     "Make Dave an admin" contains a create word, and the lifecycle
     reader would otherwise read it as making a record called "Dave an
     admin". It is also the most dangerous write here, so it is decided
     by the reader that knows what it is rather than by whichever reader
     happens to match first. */
  const role = outbound ? null : readRoleChange(text, opts);
  if (role) return role;

  const lifecycle = outbound ? null : readLifecycle(text, opts);
  if (lifecycle) return lifecycle;

  /* WHAT COMES OUT IS NOT PART OF THE QUESTION.

     "Export the sold trailers as a Word document" is one selection and
     one output, and the reader below has no idea what a Word document
     is: it reported "word" and "document" as words it could not match,
     and "to Excel" ended up inside a filter. The clause comes off
     first, and what is left is an ordinary question. */
  const output = sending;
  const asked = output ? output.rest : text;

  /* "SHARE IT WITH DAVE" IS ALL DESTINATION AND NO QUESTION.

     Taking the destination clause out leaves nothing, and nothing names
     no entity. The word that pointed at what is being sent is the only
     part of that sentence which says what it is about, so it is put
     back in front of whatever is left before the entity is worked out. */
  const pointing = output?.pointer ? `${output.pointer} ${asked}`.trim() : asked;

  /* "EXPORT THESE TO EXCEL" NAMES NO ENTITY, AND DOES NOT NEED TO.

     The screen named it when somebody ticked the rows. The reader has
     nothing to work with in the word "these", so the entity comes from
     the context and the sentence is read again with it, which is how
     one word ends up meaning a selection of forty customers. */
  const pointedFirst = readContextReference(pointing);
  const pointedEntity = (pointedFirst
    ? resolveContext(pointedFirst, opts?.context ?? EMPTY_CONTEXT)?.entity
    : undefined)
    /* Or whatever the clause before produced. "Export it to Excel"
       names no entity and does not need to. */
    ?? (refersBack(pointing) ? opts?.priorResult?.entity : undefined);

  const read: QueryPlan | null = parseQuery(asked, opts?.vocabulary)
    ?? (pointedEntity ? parseQuery(`${asked} ${nounFor(pointedEntity)}`, opts?.vocabulary) : null);
  if (!read) return null;

  const { plan, select } = adaptQueryPlan(read);

  /* A QUESTION CAN POINT AT THE SCREEN TOO.

     "Export these to Excel" is a selection of exactly the rows somebody
     ticked, and narrowing it any other way would produce a file that
     does not hold what they were looking at. The condition is over ids
     and is added to whatever else the sentence said, so "export these
     that are still in stock" narrows twice. */
  const pointed = pointedFirst;
  const fromScreen = pointed
    ? resolveContext(
        pointed, opts?.context ?? EMPTY_CONTEXT,
        'entity' in select.from ? select.from.entity : undefined,
      )
    : null;
  if (fromScreen) {
    select.where = select.where
      ? { kind: 'and', of: [select.where, fromScreen.match] }
      : fromScreen.match;
  }

  /* One emit step, over the result of the select. Not a copy of the
     select: the file has to be built from exactly the rows the question
     described, and a second description of them is a second answer. */
  if (output && select.id) {
    /* WHERE IT GOES DECIDES WHICH PERMISSION NAMES IT.

       The step used to carry `rows.export` whatever the destination was,
       so "share the customer list with Dave" claimed to be permitted by
       the export capability. Building the file still requires
       `rows.export`, and `derivedRequirements` derives that from the
       output being a file, separately and in addition. */
    const to = destination(output.to.kind);

    /* Attaching names a record, and until the entity is known the
       reader cannot say which. It is resolved here, against the same
       reference reader every instruction uses, so "attach it to
       STC143580" reaches a real row rather than a blank entity. */
    let attachTo = output.to;
    if (output.to.kind === 'attach') {
      const target = attachTarget(output.recipients?.[0] ?? '');
      if (target) attachTo = { kind: 'attach', to: target };
      else {
        plan.unmet.push({
          part: 'destination',
          why: `nothing here matches the record to attach it to`,
        });
      }
    }

    const emit: Emit = {
      op: 'emit',
      id: 'e1',
      from: { ref: 'rows', step: select.id },
      output: output.output,
      to: attachTo,
      capability: to?.capability ?? FILE_EMIT_CAPABILITY,
      /* Only a file is a thing a later step can pick up. A share
         produces access, which is not an object anybody can hold. */
      ...(output.output.kind === 'file' ? { produces: { kind: 'artefact' as const } } : {}),
    };
    plan.steps.push(emit);
  }

  /* A SENTENCE THAT SENDS SOMETHING IS AN INSTRUCTION.

     "Share the Fleet Prospects list with Dave" is a selection and a
     grant, and the grant is a write. Read as a question it went to the
     query route, which never previews and never confirms, so the whole
     sentence did nothing at all. A download changes nothing and stays a
     read. */
  const sends = plan.steps.some(
    (s) => s.op === 'emit' && s.to.kind !== 'display' && s.to.kind !== 'download',
  );

  return {
    text,
    kind: sends ? 'mutate' : 'read',
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
      summary: [
        fromScreen ? `${read.summary}, ${fromScreen.label}` : read.summary,
        output ? `as ${/^[aeiou]/i.test(output.label) ? 'an' : 'a'} ${output.label}` : null,
      ].filter(Boolean).join(', '),
      confidence: read.confidence,
      amountLabel: read.amountLabel ?? null,
      groupLabel: read.groupBy?.label ?? null,
      orderLabel: read.order?.label ?? null,
      derivedLabel: read.derived?.label ?? null,
      outputLabel: output?.label ?? null,
    },
  };
}

/**
 * The instruction reader, if this sentence is one.
 *
 * The threshold is the one the bar has always used: nothing missing, and
 * confident enough to act on. A half instruction is somebody part way
 * through a sentence, and treating it as a refused mutation would take
 * the words away from the question engine for anybody who was about to
 * ask about the same column.
 *
 * `parseEdit` needs the actor because a field nobody may write is not a
 * field this sentence can be about. Passing no actor means no
 * instruction is read at all, which is the safe direction: the bar
 * always knows who it is, and a caller that does not should not be
 * planning writes.
 */
function readInstruction(
  text: string,
  opts?: PlanOptions,
): CommandPlanning | null {
  if (!opts?.actorCapabilities) return null;
  if (text.trim().length < 4) return null;

  const caps = new Set(opts.actorCapabilities) as CrmCapabilities;
  const edit: EditPlan | null = parseEdit(
    text, caps, opts.vocabulary, opts.context ?? EMPTY_CONTEXT,
  );
  if (!edit) return null;
  if (edit.missing.length > 0 || edit.confidence < INSTRUCTION_THRESHOLD) return null;

  const { plan } = adaptEditPlan(edit);

  return {
    text,
    kind: 'mutate',
    plan,
    select: null,
    problems: validate(plan),
    completion: completion(plan),
    requirements: derivedRequirements(plan),
    permissions: [...new Set(
      derivedRequirements(plan).filter((r) => r.kind === 'permission').map((r) => r.id),
    )],
    confirm: needsConfirmation(plan),
    availability: availabilityOf(plan, opts.actorCapabilities),
    presentation: {
      summary: edit.summary,
      confidence: edit.confidence,
      amountLabel: null,
      groupLabel: null,
      orderLabel: null,
      derivedLabel: null,
    },
  };
}

/** The plainest noun for an entity, so a pointing word can be read. */
function nounFor(entityId: string): string {
  return ENTITIES.find((e) => e.id === entityId)?.nouns[1]
    ?? ENTITIES.find((e) => e.id === entityId)?.nouns[0]
    ?? '';
}

/**
 * Creating a record, or deleting one.
 *
 * The same shape as every other planning result, so nothing downstream
 * knows there are three readers rather than one.
 */
/**
 * A role change, if this sentence is one.
 *
 * Before the lifecycle reader, because "make Dave an admin" contains a
 * create word and would otherwise be read as making a record called
 * "Dave an admin".
 */
function readRoleChange(
  text: string,
  opts?: PlanOptions,
): CommandPlanning | null {
  if (!opts?.actorCapabilities) return null;

  const caps = new Set(opts.actorCapabilities) as CrmCapabilities;
  const read = parseRoleChange(text, caps);
  if (!read) return null;

  const plan: Plan = { steps: [read.step], unmet: [] };

  return {
    text,
    kind: 'mutate',
    plan,
    select: null,
    problems: validate(plan),
    completion: completion(plan),
    requirements: derivedRequirements(plan),
    permissions: [...new Set(
      derivedRequirements(plan).filter((r) => r.kind === 'permission').map((r) => r.id),
    )],
    confirm: needsConfirmation(plan),
    availability: availabilityOf(plan, opts.actorCapabilities),
    presentation: {
      summary: read.summary,
      confidence: read.confidence,
      amountLabel: null, groupLabel: null, orderLabel: null, derivedLabel: null,
    },
  };
}

function readLifecycle(
  text: string,
  opts?: PlanOptions,
): CommandPlanning | null {
  if (!opts?.actorCapabilities) return null;

  const caps = new Set(opts.actorCapabilities) as CrmCapabilities;
  const read = parseLifecycle(text, caps, opts.context ?? EMPTY_CONTEXT, opts.priorResult);
  if (!read || read.confidence < INSTRUCTION_THRESHOLD) return null;

  const plan: Plan = { steps: [read.step], unmet: [] };

  return {
    text,
    kind: 'mutate',
    plan,
    select: null,
    problems: validate(plan),
    completion: completion(plan),
    requirements: derivedRequirements(plan),
    permissions: [...new Set(
      derivedRequirements(plan).filter((r) => r.kind === 'permission').map((r) => r.id),
    )],
    confirm: needsConfirmation(plan),
    availability: availabilityOf(plan, opts.actorCapabilities),
    presentation: {
      summary: read.summary,
      confidence: read.confidence,
      amountLabel: null, groupLabel: null, orderLabel: null, derivedLabel: null,
    },
  };
}

/**
 * How sure the instruction reader has to be before a sentence is an
 * instruction rather than a question.
 *
 * Named rather than typed inline in two places, because the bar and the
 * server disagreeing about this number is the same class of bug as them
 * disagreeing about the vocabulary.
 */
const INSTRUCTION_THRESHOLD = 10;

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
