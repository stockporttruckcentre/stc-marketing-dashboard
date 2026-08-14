/* =============================================================
   The existing instruction reader, expressed as canonical IR.

   An ADAPTER, exactly as `adapt.ts` is for questions. `parseEdit` is
   untouched and still produces what it produced before; this reads its
   output and says the same thing in the canonical types, so the two can
   be proven equivalent before any reader changes.

   THE POINT THIS MAKES.

     set the retail price of STC143580 to £24,995
     move every available curtainsider at Hyde to Bredbury

   come out of here as the same step with different contents. One says
   `expect: 'one'` and matches on a stock number; the other says
   `expect: 'many'` and matches on a status and a place. There is no
   "set price" operation and no "bulk move" operation, and adding a
   field to the dictionary adds both sentences at once.

   Losslessness is the contract. Every field of `EditPlan` crosses over
   or is recorded as unmet:

     entity      -> Mutate.target
     field       -> Mutate.set[0].field
     op + value  -> Mutate.set[0].to, as an expression
     targets     -> Mutate.match, a Select whose where is a Cond
     missing     -> Plan.unmet
     handoff     -> an Invoke naming a capability, never a field write

   `summary` and `confidence` are deliberately NOT carried. They are
   presentation and scoring, not meaning, and the equivalence check
   knows to ignore them.
   ============================================================= */
import type { EditPlan, EditTarget, EditOp } from '../mutate';
import type { WritableField } from '../fields';
import type { Cardinality, Cond, Expr, Mutate, Plan, Select, Step, Unmet } from './types';
import { entity as entityDef } from './registry';

/* -------------------------------------------------------------
   Which rows
   ------------------------------------------------------------- */

/**
 * The column a named record is recognised by.
 *
 * The entity's own title, from the registry, rather than the column the
 * words happened to look like. "Set the contact name on STC144504" is
 * an instruction about a contact, and contacts have no stock number: an
 * adapter that wrote `stc_no` into a query over `crm_contacts` produced
 * a plan that could only ever match nothing.
 */
export function titleColumnOf(entityId: string): string | null {
  return entityDef(entityId)?.titleField ?? null;
}

/**
 * How a named record is recognised.
 *
 * Loosely, because people type the last few digits of a stock number
 * and the first word of a company. That is why `expect: 'one'` matters:
 * the loose match is what makes several rows possible, and the
 * cardinality is what makes that an ambiguity to ask about rather than
 * a set to write.
 */
function condForTarget(entity: string, title: string, t: EditTarget): Cond {
  const field = (name: string): Expr => ({ kind: 'field', of: { entity, field: name } });
  const lit = (v: string): Expr => ({ kind: 'literal', value: v });

  if (t.kind === 'filter') {
    return { kind: 'cmp', op: 'eq', left: field(t.column), right: lit(t.value) };
  }
  return { kind: 'cmp', op: 'contains', left: field(title), right: lit(t.text) };
}

/**
 * Several named records are an `or`, not several statements.
 *
 * "Mark STC143580 and 144504 as sold" is one instruction about two
 * units, and splitting it into two plans is how one of them succeeds
 * and the other does not.
 */
function matchFor(entity: string, targets: EditTarget[]): Select | null {
  if (!targets.length) return null;
  const title = titleColumnOf(entity);
  /* Without a title column there is no way to recognise a named record,
     and guessing one is how a plan comes to match nothing. */
  if (!title && targets.some((t) => t.kind !== 'filter')) return null;
  const conds = targets.map((t) => condForTarget(entity, title ?? '', t));
  return {
    op: 'select',
    from: { entity },
    where: conds.length === 1 ? conds[0] : { kind: 'or', of: conds },
    produces: { kind: 'rows', entity },
  };
}

/**
 * How many rows the SENTENCE named.
 *
 * `many` only where the reader found a described subset, which it only
 * produces for a word that genuinely means every match alongside a
 * named subset. Everything else is one. Nothing here counts anything:
 * a company name that turns out to fit forty accounts is an ambiguity
 * for `resolve` to raise, not permission to write forty.
 */
export function cardinalityOf(targets: EditTarget[]): Cardinality {
  return targets.some((t) => t.kind === 'filter') ? 'many' : 'one';
}

/* -------------------------------------------------------------
   What to write
   ------------------------------------------------------------- */

/**
 * The new value, as an expression.
 *
 * Arithmetic is the field plus an amount rather than a flag saying
 * "add", which is why "put the retail price up ten percent" needs
 * nothing new to express. Appending survives as a mode because adding a
 * note must not overwrite the notes.
 */
export function valueExpr(
  entity: string, spec: WritableField, op: EditOp, value: string | number | null,
): { to: Expr; mode?: 'replace' | 'append' } {
  const self: Expr = { kind: 'field', of: { entity, field: spec.key } };

  if (op === 'clear') return { to: { kind: 'literal', value: null } };

  if (op === 'add' && spec.kind === 'longtext') {
    return { to: { kind: 'literal', value: value as string }, mode: 'append' };
  }
  if (op === 'add' || op === 'subtract') {
    return {
      to: {
        kind: 'binary',
        op: op === 'add' ? '+' : '-',
        left: self,
        right: { kind: 'literal', value: Number(value) },
      },
    };
  }
  return { to: { kind: 'literal', value: value as string | number | null } };
}

/* -------------------------------------------------------------
   The adapter
   ------------------------------------------------------------- */

export type AdaptedEdit = {
  plan: Plan;
  /** The mutation, when the instruction is one. */
  mutate: Mutate | null;
  /** Anything the old shape carried that this could not express. */
  lost: Unmet[];
};

export function adaptEditPlan(p: EditPlan): AdaptedEdit {
  const entity = p.entity;
  const lost: Unmet[] = [];
  const unmet: Unmet[] = (p.missing ?? []).map((part) => ({
    part,
    why: part === 'target' ? 'the instruction did not say which record'
      : 'the instruction did not say what to change it to',
  }));

  const match = matchFor(entity, p.targets);

  /* A discrete business operation, not a column.
     Selling raises a commission line, flips the stock unit and tells
     every other rep chasing it that it is gone. Writing a status column
     is one third of that, and the third that looks like all of it. */
  if (p.handoff === 'markSold') {
    const invoke: Step = {
      op: 'invoke',
      id: 's1',
      capability: 'deal.markSold',
      /* The tracker row is a deal. The reader found it on whichever
         entity its field lived on, and the operation is about the deal. */
      subject: match ? { ...match, from: { entity: 'deals' } } : { entity: 'deals' },
      produces: { kind: 'record', entity: 'deals' },
    };
    return { plan: { steps: [invoke], unmet }, mutate: null, lost };
  }

  if (!match) {
    /* Nothing said which rows. The reader already reports that as
       missing, so the plan carries no step rather than carrying an
       update with no match, which would mean every row. */
    return { plan: { steps: [], unmet }, mutate: null, lost };
  }

  /* A value the reader could not find is not the value `null`.
     "Set the location on STC143580 to" and "clear the location on
     STC143580" are different instructions, and an adapter that turned
     the first into the second would empty a column because a sentence
     trailed off. Only `clear` clears. */
  if (p.op !== 'clear' && p.value == null) {
    if (!unmet.some((u) => u.part === 'value')) {
      unmet.push({ part: 'value', why: 'the instruction did not say what to change it to' });
    }
    return { plan: { steps: [], unmet }, mutate: null, lost };
  }

  const { to, mode } = valueExpr(entity, p.field, p.op, p.value);

  const mutate: Mutate = {
    op: 'update',
    id: 's1',
    expect: cardinalityOf(p.targets),
    target: { entity },
    match,
    set: [{ field: { entity, field: p.field.key }, to, ...(mode ? { mode } : {}) }],
    produces: { kind: 'rows', entity },
  };

  return { plan: { steps: [mutate], unmet }, mutate, lost };
}
