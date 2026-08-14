/* =============================================================
   The two rules that must hold before anything executes.

   1  A ResultRef is type checked. A step producing rows cannot be
      consumed where a single record is required, and the reverse.
      Without this, "share that new list" could silently receive a
      rowset and act on whichever row came back first, which is the
      class of failure this architecture exists to remove.

   2  A relationship joined by value declares how it normalises and
      what it does when the match is not unique. There is no policy
      that means "pick one", so a plan cannot express it.

   These are asserted as REFUSALS. Every case below is a plan that must
   be rejected, plus the matching well formed plan that must be
   accepted, so a validator that refused everything would fail this as
   loudly as one that accepted everything.

     npm run check:ir-safety
   ============================================================= */
import { validate, derivedRequirements, needsConfirmation } from '../lib/command/ir/validate';
import { RELATIONSHIPS, relationship, entities, coverage } from '../lib/command/ir/registry';
import type { Plan } from '../lib/command/ir/types';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  ${what}${got ? `\n    got: ${got}` : ''}`);
};

const fatal = (p: Plan) => validate(p).filter((x) => x.severity === 'fatal');
const why = (p: Plan) => fatal(p).map((x) => `${x.at}: ${x.what}`).join('; ');

/* =============================================================
   1. ResultRef typing
   ============================================================= */

const rowsStep = {
  op: 'select' as const, id: 'rows', from: { entity: 'contacts' },
  produces: { kind: 'rows' as const, entity: 'contacts' },
};
const recordStep = {
  op: 'create' as const, id: 'rec', target: { entity: 'crm_lists' },
  produces: { kind: 'record' as const, entity: 'crm_lists' },
};
const scalarStep = {
  op: 'select' as const, id: 'num', from: { entity: 'trailers' },
  produces: { kind: 'scalar' as const },
};

/* --- rows must not satisfy a record reference --- */
ok('rows consumed as a record is refused',
  fatal({
    steps: [rowsStep, {
      op: 'invoke', id: 'x', capability: 'record.updateField',
      subject: { ref: 'record', step: 'rows' },
    }],
    unmet: [],
  }).length > 0);

/* --- a record IS a valid source, since one row is a set of one --- */
ok('a record consumed as a source is accepted',
  fatal({
    steps: [recordStep, {
      op: 'invoke', id: 'x', capability: 'record.updateField',
      subject: { ref: 'record', step: 'rec' },
    }],
    unmet: [],
  }).length === 0,
  why({ steps: [recordStep, { op: 'invoke', id: 'x', capability: 'record.updateField', subject: { ref: 'record', step: 'rec' } }], unmet: [] }));

/* --- a scalar must not be a source --- */
ok('a scalar consumed as a rowset is refused',
  fatal({
    steps: [scalarStep, {
      op: 'emit', id: 'e', from: { ref: 'rows', step: 'num' },
      output: { kind: 'rows' }, to: { kind: 'display' },
    }],
    unmet: [],
  }).length > 0);

/* --- rows are a valid thing to emit --- */
ok('rows emitted to a file is accepted',
  fatal({
    steps: [rowsStep, {
      op: 'emit', id: 'e', from: { ref: 'rows', step: 'rows' },
      output: { kind: 'file', format: 'csv' }, to: { kind: 'download' },
    }],
    unmet: [],
  }).length === 0,
  why({ steps: [rowsStep, { op: 'emit', id: 'e', from: { ref: 'rows', step: 'rows' }, output: { kind: 'file', format: 'csv' }, to: { kind: 'download' } }], unmet: [] }));

/* --- forward and self references --- */
ok('a forward reference is refused',
  fatal({
    steps: [
      { op: 'emit', id: 'e', from: { ref: 'rows', step: 'later' },
        output: { kind: 'rows' }, to: { kind: 'display' } },
      { ...rowsStep, id: 'later' },
    ],
    unmet: [],
  }).length > 0);

ok('a reference to a missing step is refused',
  fatal({
    steps: [{ op: 'emit', id: 'e', from: { ref: 'rows', step: 'nope' },
              output: { kind: 'rows' }, to: { kind: 'display' } }],
    unmet: [],
  }).length > 0);

ok('a step that declares nothing cannot be referenced',
  fatal({
    steps: [
      { op: 'select', id: 'silent', from: { entity: 'contacts' } },
      { op: 'emit', id: 'e', from: { ref: 'rows', step: 'silent' },
        output: { kind: 'rows' }, to: { kind: 'display' } },
    ],
    unmet: [],
  }).length > 0);

ok('duplicate step ids are refused',
  fatal({ steps: [rowsStep, { ...rowsStep }], unmet: [] }).length > 0);

/* --- the four class shapes from the design must all validate --- */
ok('class: filtered set to export validates',
  fatal({
    steps: [
      { op: 'select', id: 's1', from: { entity: 'trailers' },
        where: { kind: 'cmp', op: 'eq', left: { kind: 'field', of: { entity: 'trailers', field: 'location' } }, right: { kind: 'literal', value: 'Carrington' } },
        produces: { kind: 'rows', entity: 'trailers' } },
      { op: 'emit', id: 's2', from: { ref: 'rows', step: 's1' },
        output: { kind: 'file', format: 'csv' }, to: { kind: 'download' } },
    ],
    unmet: [],
  }).length === 0,
  why({ steps: [{ op: 'select', id: 's1', from: { entity: 'trailers' }, produces: { kind: 'rows', entity: 'trailers' } }, { op: 'emit', id: 's2', from: { ref: 'rows', step: 's1' }, output: { kind: 'file', format: 'csv' }, to: { kind: 'download' } }], unmet: [] }));

const chained: Plan = {
  steps: [
    { op: 'select', id: 's1', from: { entity: 'contacts' },
      where: { kind: 'related', via: 'customer.trailers', count: { op: 'gt', n: 20 } },
      produces: { kind: 'rows', entity: 'contacts' } },
    { op: 'create', id: 's2', target: { entity: 'crm_lists' },
      produces: { kind: 'record', entity: 'crm_lists' } },
    { op: 'invoke', id: 's3', capability: 'record.updateField',
      subject: { ref: 'record', step: 's2' },
      args: { members: { ref: 'rows', step: 's1' } } },
    { op: 'invoke', id: 's4', capability: 'record.updateField',
      subject: { ref: 'record', step: 's2' } },
  ],
  unmet: [],
};
ok('class: select to create to act on the created record validates',
  fatal(chained).length === 0, why(chained));

ok('that chained plan needs confirmation', needsConfirmation(chained));

const contextual: Plan = {
  steps: [
    { op: 'select', id: 's1', from: { entity: 'trailers' },
      produces: { kind: 'rows', entity: 'trailers' } },
    { op: 'update', id: 's2', target: { entity: 'trailers' },
      match: { ref: 'rows', step: 's1' },
      set: [{ field: { entity: 'trailers', field: 'location' }, to: { kind: 'literal', value: 'Hyde' } }],
      produces: { kind: 'rows', entity: 'trailers' } },
  ],
  unmet: [],
};
ok('class: contextual selection to bulk mutation validates',
  fatal(contextual).length === 0, why(contextual));

ok('an update with no match is refused',
  fatal({
    steps: [{ op: 'update', id: 'u', target: { entity: 'trailers' },
              set: [{ field: { entity: 'trailers', field: 'location' }, to: { kind: 'literal', value: 'Hyde' } }] }],
    unmet: [],
  }).length > 0);

ok('writing a non writable field is refused',
  fatal({
    steps: [{ op: 'update', id: 'u', target: { entity: 'trailers' },
              match: { entity: 'trailers' },
              set: [{ field: { entity: 'trailers', field: 'profit' }, to: { kind: 'literal', value: 1 } }] }],
    unmet: [],
  }).length > 0);

/* =============================================================
   2. Relationship ambiguity and normalisation
   ============================================================= */

for (const r of RELATIONSHIPS) {
  if (r.join.via === 'match') {
    ok(`${r.id} declares an ambiguity policy`, !!r.join.onAmbiguity);
    ok(`${r.id} declares normalisation`, r.join.normalise.length > 0);
    ok(`${r.id} is marked approximate`, r.approximate === true);
    /* A one-sided traversal that returns many rows without saying so
       would let a caller treat several customers as one. */
    if (r.cardinality === 'one') {
      ok(`${r.id} is one-to-one and does not silently take all`,
        r.join.onAmbiguity !== 'all', r.join.onAmbiguity);
    }
  }
  if (r.join.via === 'key' || r.join.via === 'through') {
    ok(`${r.id} is not marked approximate`, r.approximate === false);
  }
  if (r.inverse) {
    const back = relationship(r.inverse);
    ok(`${r.id} inverse ${r.inverse} exists`, !!back);
    if (back) ok(`${r.id} inverse points back`, back.to === r.from && back.from === r.to);
  }
}

/* The type has no member meaning "pick one". Asserted on the values in
   use, since a future edit adding one would show up here. */
const policies = new Set(RELATIONSHIPS.map((r) =>
  r.join.via === 'match' || r.join.via === 'resolver' ? r.join.onAmbiguity : null).filter(Boolean));
ok('no relationship resolves ambiguity by choosing one',
  ![...policies].some((p) => p === ('first' as unknown) || p === ('closest' as unknown)),
  [...policies].join(','));

ok('an unknown relationship is refused',
  fatal({
    steps: [{ op: 'select', id: 's', from: { entity: 'contacts' },
              where: { kind: 'related', via: 'not.a.relationship' } }],
    unmet: [],
  }).length > 0);

/* =============================================================
   3. Requirements are derived, never taken from the plan
   ============================================================= */

const lying: Plan = {
  steps: [{ op: 'select', id: 's', from: { entity: 'trailers' },
            produces: { kind: 'rows', entity: 'trailers' } }],
  advisoryRequires: [],
  unmet: [],
};
ok('requirements are derived even when the plan claims none',
  derivedRequirements(lying).length > 0,
  JSON.stringify(derivedRequirements(lying)));

/* ============================================================= */

const c = coverage();
console.log('\n  REGISTRY COVERAGE');
console.log(`    entities           ${c.entitiesAddressable}/${c.entities} addressable`);
console.log(`    fields             ${c.fields} non-system`);
console.log(`      filterable       ${c.filterable}`);
console.log(`      groupable        ${c.groupable}`);
console.log(`      aggregatable     ${c.aggregatable}`);
console.log(`      writable         ${c.writable}`);
console.log(`    relationships      ${c.relationships} (${c.relationshipsApproximate} joined by value)`);
console.log(`    capabilities       ${c.capabilitiesWithHandler}/${c.capabilities} with a handler`);

console.log(`\n  ${pass}/${pass + fail} safety assertions hold.\n`);
if (failures.length) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  console.log();
}
if (fail) process.exitCode = 1;
