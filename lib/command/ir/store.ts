/* =============================================================
   Where rows come from, and where changes go.

   The command language has to outlive the database underneath it. We
   intend to replace the current access layer, so nothing above this line
   may know that rows arrive over PostgREST, that a change is applied by
   a Postgres function, or that any of it is Supabase. A canonical Plan
   that mentions `rpc` is a Plan that cannot be executed anywhere else.

   So this is the whole contract between the language and the data:

     read    a table, some columns, a condition, a ceiling
     apply   every change, all of them or none of them

   ATOMICITY IS PART OF THE CONTRACT, NOT PART OF AN IMPLEMENTATION.

   `apply` promises that either every change lands or none does. Any
   store claiming to satisfy this interface has to keep that promise by
   whatever means it has, because the preview said "these eleven records"
   and somebody agreed to eleven. A store that cannot be atomic is not a
   store this can use, and saying so here is what stops the requirement
   quietly becoming optional the next time the storage changes.

   `read` reports a condition it cannot express separately from a failure
   to read. They are different problems: one is a plan this store will
   never be able to carry out, the other is today.
   ============================================================= */
import type { Cond } from './types';

/**
 * One change to one row.
 *
 * `op` absent means update, which is what every caller sent before rows
 * could be created and deleted through here. An insert names no id
 * because it has not got one yet; a delete names no columns because it
 * is not setting any.
 */
export type Change = {
  op?: 'update' | 'insert' | 'delete';
  table: string;
  id?: string;
  set?: Record<string, unknown>;
};

export type ReadRequest = {
  table: string;
  columns: string[];
  where: Cond;
  /**
   * How to order the rows, when the sentence said.
   *
   * Part of the contract because "the five cheapest" is a question
   * whose answer depends on it, and ordering after the ceiling has been
   * applied returns the five that came back first rather than the five
   * that are cheapest.
   */
  orderBy?: { column: string; direction: 'asc' | 'desc' }[];
  /**
   * The most rows to return.
   *
   * Always given. A read with no ceiling is how a command that names
   * half the CRM takes the process down before anybody sees a preview.
   * It is a PAGE size rather than a semantic ceiling: a caller that
   * wants every row pages until the pages stop coming.
   */
  limit: number;
  /** How many rows to skip, for the page after the first. */
  offset?: number;
};

export type ReadOutcome =
  | { ok: true; rows: Record<string, unknown>[] }
  | {
      ok: false;
      /**
       * `unsupported` is a plan this store will never carry out.
       * `failed` is one it could not carry out now.
       */
      reason: 'unsupported' | 'failed';
      why: string;
    };

export type ApplyOutcome =
  | { ok: true; changed: number }
  | { ok: false; why: string };

/**
 * A business operation, run over several subjects at once.
 *
 * Not a field write. Marking a deal sold raises a commission line,
 * flips the stock unit and tells every other rep chasing that unit it
 * is gone, and those three things are one operation rather than three
 * changes that happen to be issued together.
 *
 * `subjects` is a list because a sentence can name a set, and the whole
 * list is one transaction for the same reason a set of changes is: a
 * command that sells six of eleven units and reports failure leaves
 * somebody to work out which six.
 */
export type Invocation = {
  capability: string;
  subjects: string[];
  args: Record<string, unknown>;
};

export type InvokeOutcome =
  | { ok: true; performed: number; results: unknown[] }
  | { ok: false; why: string };

/**
 * One row an operation is going to leave behind, exactly.
 *
 * Not a guess and not a re-implementation. It comes from the operation
 * itself, asked without the writes: the same function that performs the
 * sale works out the numbers, and this is what it says they will be.
 *
 * `was` is the same columns as they stand now, so a preview can show a
 * change rather than a destination, and both halves of the line come
 * from one read of one row.
 */
export type ProjectedRow = {
  table: string;
  id: string;
  /** The row's own name, for the preview. */
  label?: string;
  set: Record<string, unknown>;
  was?: Record<string, unknown>;
};

export type ProjectOutcome =
  | { ok: true; rows: ProjectedRow[] }
  | { ok: false; why: string };

/**
 * A value one step takes from an earlier step's result.
 *
 * Sharing the list a previous step created needs that list's id, and
 * that id does not exist until the step runs. This is the same idea as
 * the plan's `ResultRef` and it is separate from it on purpose: the
 * plan's version is semantic and this one is a position in a
 * transaction, which is the only place the ordering can be honoured.
 */
export type ValueRef = { $from: { step: number; key: string } };

export const isValueRef = (v: unknown): v is ValueRef =>
  typeof v === 'object' && v !== null && '$from' in (v as Record<string, unknown>);

/**
 * One database effect of a programme.
 *
 * A set of column writes, or one business operation. Both go into the
 * same ordered list, because a programme that changes a field and then
 * performs an operation is one thing somebody confirmed.
 */
export type TransactionStep =
  | { op: 'changes'; changes: Change[] }
  | {
      op: 'invoke';
      capability: string;
      subjects: (string | ValueRef)[];
      args: Record<string, unknown>;
    };

export type PerformOutcome =
  | { ok: true; changed: number; results: unknown[] }
  | { ok: false; why: string };

export type Store = {
  read(req: ReadRequest): Promise<ReadOutcome>;
  /** Every change, in one transaction. All of them, or none of them. */
  apply(changes: Change[]): Promise<ApplyOutcome>;
  /** One business operation over every subject, in one transaction. */
  invoke(call: Invocation): Promise<InvokeOutcome>;
  /**
   * What an operation would leave behind, without doing any of it.
   *
   * For operations whose result is computed inside SQL. A sale's
   * commission comes from a rate on the deal, and the command layer
   * neither knows it nor should: duplicating that arithmetic in
   * TypeScript is two implementations of one business rule, and the one
   * that drifts is the one somebody was shown.
   *
   * Optional. A store that cannot project is a store where an operation
   * declaring a projection falls back to what the registry can describe,
   * which for a sale is "these columns cannot be worked out in advance"
   * and a refusal to export them in the same breath. That is the old
   * behaviour, kept honest rather than assumed away.
   */
  project?(call: Invocation): Promise<ProjectOutcome>;
  /**
   * EVERY database effect of one programme, in one transaction.
   *
   * The one a confirmed command goes through. `apply` and `invoke` are
   * each one kind of effect and a programme can hold both, plus effects
   * that used to run after the transaction had already committed: a
   * share that failed left a list nobody asked for and reported success
   * with a sentence about the rest not happening. Somebody who confirmed
   * one thing got half of it and a note.
   */
  perform(steps: TransactionStep[]): Promise<PerformOutcome>;
};
