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

export type Store = {
  read(req: ReadRequest): Promise<ReadOutcome>;
  /** Every change, in one transaction. All of them, or none of them. */
  apply(changes: Change[]): Promise<ApplyOutcome>;
  /** One business operation over every subject, in one transaction. */
  invoke(call: Invocation): Promise<InvokeOutcome>;
};
