/* =============================================================
   Does the canonical IR carry everything the instruction reader
   carried?

   The same method that proved it for questions, applied to writes. One
   canonical description of what an instruction MEANS is built from the
   `EditPlan`, a second is built independently by reading the adapted
   `Mutate` back out, and the two objects are compared for deep
   equality. Anything dropped, altered or invented is a difference, and
   a difference is a failure.

   THE SENTENCES ARE GENERATED, NOT LISTED.

   Every one is built from the writable dictionary itself: a field, one
   of its own aliases, an operation the field supports, and a target the
   reader already recognises. No phrasing is written down here that is
   not already in `fields.ts`, so this measures the translation rather
   than rewarding a list somebody tuned until it passed.

   That matters more for writes than it did for reads. A corpus of
   hand-picked instructions is exactly how a mutation layer comes to
   handle the twenty sentences in its test file and nothing else.

     npm run check:ir-edit
   ============================================================= */
import { parseEdit, type EditPlan } from '../lib/command/mutate';
import { adaptEditPlan } from '../lib/command/ir/adapt-edit';
import { validate } from '../lib/command/ir/validate';
import type { Cond, Expr, Mutate, Select } from '../lib/command/ir/types';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { titleColumnOf } from '../lib/command/ir/adapt-edit';
import { capabilitiesFor } from '../lib/crm/permissions';

const CAPS = capabilitiesFor({ role: 'admin' } as never);

let checked = 0, failed = 0;
const failures: string[] = [];
const ok = (sentence: string, what: string, cond: boolean, detail = '') => {
  checked++;
  if (cond) return;
  failed++;
  if (failures.length < 15) failures.push(`  "${sentence}"\n    ${what}${detail ? `\n${detail}` : ''}`);
};

/* =============================================================
   The canonical description of an instruction's meaning
   ============================================================= */

type Semantics = {
  entity: string;
  field: string;
  /** What happens to the value, as the operation it really is. */
  operation: 'replace' | 'clear' | 'append' | 'increase' | 'decrease';
  value: string | null;
  expect: 'one' | 'many' | null;
  /**
   * Which rows, as the condition itself.
   *
   * This used to be a list of facts recovered from two different
   * representations, because the reader had its own target union and the
   * IR had conditions. There is one representation now, so the honest
   * assertion is that the adapter carries the reader's `Cond` through
   * unchanged: it may wrap it in a `Select`, it may not reshape it, drop
   * a disjunct or invent a comparison.
   */
  match: string;
  unmet: string[];
  /** A discrete operation rather than a column write. */
  invokes: string | null;
};

function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/* -------------------------------------------------------------
   Side one: straight off the EditPlan
   ------------------------------------------------------------- */

function fromEditPlan(p: EditPlan): Semantics {
  const longtext = p.field.kind === 'longtext';
  const operation: Semantics['operation'] =
    p.op === 'clear' ? 'clear'
      : p.op === 'add' ? (longtext ? 'append' : 'increase')
        : p.op === 'subtract' ? 'decrease'
          : 'replace';

  return {
    entity: p.entity,
    field: p.field.key,
    operation,
    value: p.op === 'clear' ? null : (p.value == null ? null : String(p.value)),
    /* A handoff writes no column, so it has no cardinality to carry. */
    expect: p.handoff ? null : (p.match ? p.expect : null),
    match: canonical(p.match ?? null),
    unmet: (p.missing ?? []).slice().sort(),
    invokes: p.handoff === 'markSold' ? 'deal.markSold' : null,
  };
}

/**
 * Every named record must be recognised on the entity's own title.
 *
 * Separate from the equivalence, because it is a fact about the reader
 * rather than about the crossing. "Set the contact name on STC144504"
 * is an instruction about a contact, and a condition comparing
 * `stc_no` on `crm_contacts` matches nothing however faithfully it
 * survives the adapter.
 */
function namedOnTitle(sentence: string, p: EditPlan): void {
  if (!p.named.length || !p.match) return;
  const title = titleColumnOf(p.entity);
  const columns = new Set(
    disjuncts(p.match)
      .map((c) => (c.kind === 'cmp' ? plainField(c.left) : null))
      .filter((x): x is string => x !== null),
  );
  ok(sentence, `a named record is matched on ${p.entity}'s own title column`,
    !!title && columns.size === 1 && columns.has(title),
    `      title ${title}, matched on ${[...columns].join(', ')}`);
}

/* -------------------------------------------------------------
   Side two: recovered from the IR by walking it
   ------------------------------------------------------------- */

function plainField(e: Expr): string | null {
  return e.kind === 'field' && !('via' in e.of) ? e.of.field : null;
}
function literal(e: Expr): string | null {
  return e.kind === 'literal' && e.value != null ? String(e.value) : null;
}

function disjuncts(c: Cond | undefined): Cond[] {
  if (!c) return [];
  return c.kind === 'or' ? c.of.flatMap(disjuncts) : [c];
}

/** The condition a step selects rows with, or nothing. */
function recoverMatch(match: Select | undefined): string {
  return canonical(match?.where ?? null);
}

function recoverOperation(a: Mutate['set'] extends (infer U)[] | undefined ? U : never):
{ operation: Semantics['operation']; value: string | null } {
  const to = a.to;
  if (to.kind === 'literal' && to.value === null) return { operation: 'clear', value: null };
  if (a.mode === 'append') return { operation: 'append', value: literal(to) };
  if (to.kind === 'binary') {
    /* The field plus an amount, which is what an increase is. Reading
       the operator back is how this stays an expression rather than
       becoming a flag again. */
    return {
      operation: to.op === '+' ? 'increase' : to.op === '-' ? 'decrease' : 'replace',
      value: literal(to.right),
    };
  }
  return { operation: 'replace', value: literal(to) };
}

function fromIR(adapted: ReturnType<typeof adaptEditPlan>): Semantics {
  const step = adapted.plan.steps[0];

  if (step && step.op === 'invoke') {
    const subject = step.subject as Select | undefined;
    return {
      entity: 'deals',
      /* A capability names no column. Filled from the plan's own shape
         so the two sides compare like for like. */
      field: '',
      operation: 'replace',
      value: null,
      expect: null,
      match: recoverMatch(subject && 'op' in subject ? subject : undefined),
      unmet: adapted.plan.unmet.map((u) => u.part).sort(),
      invokes: step.capability,
    };
  }

  const m = adapted.mutate;
  if (!m || m.op === 'create') {
    return {
      entity: '', field: '', operation: 'replace', value: null, expect: null,
      match: canonical(null), unmet: adapted.plan.unmet.map((u) => u.part).sort(), invokes: null,
    };
  }

  const assignment = m.set?.[0];
  const { operation, value } = assignment
    ? recoverOperation(assignment)
    : { operation: 'replace' as const, value: null };

  const match = m.match && 'op' in m.match ? (m.match as Select) : undefined;

  return {
    entity: m.target.entity,
    field: assignment ? assignment.field.field : '',
    operation,
    value,
    expect: m.expect,
    match: recoverMatch(match),
    unmet: adapted.plan.unmet.map((u) => u.part).sort(),
    invokes: null,
  };
}

/* =============================================================
   The comparison
   ============================================================= */

function difference(a: Semantics, b: Semantics): string {
  const lines: string[] = [];
  for (const k of Object.keys(a).sort() as (keyof Semantics)[]) {
    const left = canonical(a[k]);
    const right = canonical(b[k]);
    if (left !== right) lines.push(`      ${k}\n        edit: ${left}\n        ir:   ${right}`);
  }
  return lines.join('\n');
}

function compare(sentence: string, p: EditPlan): void {
  const adapted = adaptEditPlan(p);
  namedOnTitle(sentence, p);

  ok(sentence, 'the adapter recorded nothing as lost', adapted.lost.length === 0,
    `      ${adapted.lost.map((l) => `${l.part}: ${l.why}`).join('; ')}`);

  const want = fromEditPlan(p);
  const got = fromIR(adapted);

  /* An instruction missing its record or its value produces no step,
     which both sides describe as an empty plan carrying what is
     missing. A half instruction is not a plan with a hole in it. */
  const incomplete = (!p.match || (p.op !== 'clear' && p.value == null)) && !p.handoff;
  if (incomplete) {
    ok(sentence, 'a half read instruction produces no step',
      adapted.plan.steps.length === 0 && adapted.plan.unmet.length > 0,
      `      steps ${adapted.plan.steps.length}, unmet ${JSON.stringify(adapted.plan.unmet)}`);
    return;
  }

  ok(sentence, 'the meaning recovered from the IR is identical to the meaning of the instruction',
    canonical(want) === canonical(got), difference(want, got));

  const fatal = validate(adapted.plan).filter((x) => x.severity === 'fatal');
  /* A plan carrying an unmet part is refused by design, and that
     refusal is the unmet gate rather than a defect in the adapter. */
  const expectedRefusal = adapted.plan.unmet.length > 0;
  ok(sentence, expectedRefusal ? 'an unresolved instruction is refused' : 'the adapted plan validates',
    expectedRefusal ? fatal.length > 0 : fatal.length === 0,
    `      ${fatal.map((x) => `${x.at}: ${x.what}`).join('; ')}`);
}

/* =============================================================
   Sentences, generated from the dictionary itself
   ============================================================= */

/* Records the reader already recognises, and a described subset. None
   of these is a phrase: they are a stock number shape, a company name
   and the collective word the reader already requires. */
const NAMED = ['STC143580', 'STC144504'];

type Case = { text: string; note: string };
const cases: Case[] = [];

for (const f of WRITABLE_FIELDS) {
  const alias = f.aliases[0];
  if (!alias) continue;

  for (const record of NAMED) {
    /* Set, in the plainest shape the reader supports. */
    const value =
      f.kind === 'money' || f.kind === 'number' ? '1500'
        : f.kind === 'date' ? '14/03/2027'
          : f.vocabulary ? Object.keys(f.vocabulary)[0]
            : 'Bredbury';
    if (!value) continue;
    cases.push({ text: `set the ${alias} on ${record} to ${value}`, note: 'set' });

    if (f.arithmetic && (f.kind === 'money' || f.kind === 'number')) {
      cases.push({ text: `add 250 ${alias} to ${record}`, note: 'add' });
      cases.push({ text: `take 250 off the ${alias} on ${record}`, note: 'subtract' });
    }
    if (f.arithmetic && f.kind === 'longtext') {
      cases.push({ text: `add a ${alias} to ${record}: chasing tyres`, note: 'append' });
    }
    if (f.clearable) {
      cases.push({ text: `clear the ${alias} on ${record}`, note: 'clear' });
    }
  }

  /* Two records at once, which is one instruction about two units. */
  cases.push({ text: `set the ${alias} on ${NAMED[0]} and ${NAMED[1]} to 1500`, note: 'two records' });

  /* An instruction with no record at all, which must not become a plan
     that touches every row. */
  cases.push({ text: `set the ${alias} to 1500`, note: 'no record' });
}

/* A described subset, using the collective word the reader already
   requires alongside a named state. Built from the enum vocabularies
   rather than written out. */
for (const f of WRITABLE_FIELDS) {
  if (!f.vocabulary) continue;
  const states = Object.keys(f.vocabulary);
  if (states.length < 2) continue;
  const noun = f.entity === 'posts' ? 'social posts'
    : f.entity === 'trailers' ? 'trailers'
      : f.entity === 'contacts' ? 'customers' : 'meetings';
  cases.push({
    text: `mark all ${states[0]} ${noun} as ${states[1]}`,
    note: 'bulk',
  });
}

/* ------------------------------------------------------------- */

let read = 0, identical = 0;
for (const c of cases) {
  const p = parseEdit(c.text, CAPS);
  if (!p) continue;
  read++;
  const before = failed;
  compare(c.text, p);
  if (failed === before) identical++;
}

console.log(`\n  ${cases.length.toLocaleString('en-GB')} instructions generated from the dictionary, `
  + `${read.toLocaleString('en-GB')} produced an EditPlan.`);
console.log(`  ${identical.toLocaleString('en-GB')}/${read.toLocaleString('en-GB')} `
  + `crossed into the IR with an identical canonical meaning.`);
console.log(`  ${(checked - failed).toLocaleString('en-GB')}/${checked.toLocaleString('en-GB')} checks hold.\n`);

if (failures.length) {
  console.log('  first differences:');
  for (const f of failures) console.log(f);
  console.log();
}
if (failed) process.exitCode = 1;
