/* =============================================================
   What must hold before anything executes.

   Six properties, each asserted as REFUSALS AND ACCEPTANCES in pairs,
   so a validator that refused everything fails this as loudly as one
   that accepted everything. Every refusal also asserts the REASON it
   was refused, so a case cannot pass by being rejected for an
   unrelated typo.

   1  DATAFLOW IS TYPED, AND EVERY SHAPE PARTICIPATES.
      A rowset cannot be consumed where a single record is required. A
      series, which is what a grouped aggregate is, can be produced and
      then consumed, without a cast anywhere.

   2  A STEP'S DECLARED OUTPUT IS NOT BELIEVED.
      The plan is untrusted data. Its `produces` is checked against what
      the step actually yields, derived here, and a claim that disagrees
      is fatal. Trusting the claim made every downstream guarantee
      circular: a client could write `produces: record` on a select over
      ten thousand contacts and be waved through.

   3  IDENTITY IS CHECKED, NOT ONLY SHAPE.
      Rows of contacts and rows of trailers are the same shape and are
      not interchangeable. Neither is a write whose target and whose
      fields disagree about which table they are on.

   4  CAPABILITY CONTRACTS ARE ENFORCED.
      A capability declares which operation may name it and which
      entities it applies to, and both are checked. Requirements are
      derived from every entity, field and relationship a plan reaches,
      including the ones it reaches by traversal.

   5  AN UNRESOLVED REQUEST DOES NOT GET TO WRITE.
      Executing the understood half of an instruction is the most
      dangerous outcome available, because it looks like the whole
      instruction was carried out.

   6  WHERE A RESULT GOES DECIDES WHAT IT IS.
      Screen, download, share, email and attach were one step kind with
      no declared difference. Each now declares its effect, the
      capability that permits it, whether it is confirmed, and whether
      it may run at all on a request that was only partly understood.
      Only the screen may, and even then the result is `partial` and
      never reported as the command having been carried out.

     npm run check:ir-safety
   ============================================================= */
import {
  validate, derivedRequirements, needsConfirmation, completion,
} from '../lib/command/ir/validate';
import {
  RELATIONSHIPS, CAPABILITIES, DESTINATIONS, relationship, coverage, field,
} from '../lib/command/ir/registry';
import type { Plan, Select, Mutate, Step, Emit, Expr } from '../lib/command/ir/types';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  ${what}${got ? `\n    got: ${got}` : ''}`);
};

const fatal = (p: Plan) => validate(p).filter((x) => x.severity === 'fatal');
const why = (p: Plan) => fatal(p).map((x) => `${x.at}: ${x.what}`).join('; ');

/**
 * Asserted refused, and refused FOR THE STATED REASON.
 *
 * A refusal test that only counts problems passes when the plan was
 * rejected by accident, for a typo in a field name rather than for the
 * property under test. `because` is matched against the refusal
 * messages, so each case has to fail the way it claims to.
 */
const refuses = (what: string, because: string, steps: Step[], unmet: Plan['unmet'] = []) => {
  const problems = fatal({ steps, unmet });
  const text = problems.map((x) => x.what).join(' | ');
  ok(what, problems.length > 0 && text.includes(because), text || 'accepted');
};

/** Asserted accepted, with the refusal reason printed on failure. */
const accepts = (what: string, steps: Step[], unmet: Plan['unmet'] = []) =>
  ok(what, fatal({ steps, unmet }).length === 0, why({ steps, unmet }));

const requirementsOf = (steps: Step[]) => derivedRequirements({ steps, unmet: [] });

/* =============================================================
   Building blocks. Real entities, real fields, real capabilities.
   ============================================================= */

const contactRows: Select = {
  op: 'select', id: 'contactRows', from: { entity: 'contacts' },
  produces: { kind: 'rows', entity: 'contacts' },
};
const trailerRows: Select = {
  op: 'select', id: 'trailerRows', from: { entity: 'trailers' },
  produces: { kind: 'rows', entity: 'trailers' },
};
const newContact: Mutate = {
  op: 'create', id: 'newContact', target: { entity: 'contacts' },
  produces: { kind: 'record', entity: 'contacts' },
};
const trailerCount: Select = {
  op: 'select', id: 'trailerCount', from: { entity: 'trailers' },
  select: [{ as: 'count', expr: { kind: 'agg', fn: 'count' } }],
  produces: { kind: 'scalar' },
};
/* A grouped aggregate. Several keyed numbers, not one. */
const byDepot: Select = {
  op: 'select', id: 'byDepot', from: { entity: 'trailers' },
  select: [{ as: 'count', expr: { kind: 'agg', fn: 'count' } }],
  shape: { groupBy: [{ kind: 'field', of: { entity: 'trailers', field: 'location' } }] },
  produces: { kind: 'series', entity: 'trailers' },
};

/* =============================================================
   1. Dataflow typing, including series
   ============================================================= */

refuses('rows consumed as a record is refused',
  'wants record, but step "contactRows" produces rows', [
  contactRows,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'record', step: 'contactRows' } },
]);

accepts('a record consumed as a subject is accepted', [
  newContact,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'record', step: 'newContact' } },
]);

refuses('a scalar consumed as a rowset is refused',
  'wants rows, but step "trailerCount" produces scalar', [
  trailerCount,
  { op: 'emit', id: 'e', from: { ref: 'rows', step: 'trailerCount' }, output: { kind: 'rows' }, to: { kind: 'display' } },
]);

accepts('rows emitted to a file is accepted', [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'csv' }, to: { kind: 'download' }, capability: 'rows.export',
  },
]);

/* --- the series path, end to end, with no cast anywhere --- */
accepts('a series is produced, referenced as a series and emitted', [
  byDepot,
  { op: 'emit', id: 'e', from: { ref: 'series', step: 'byDepot' }, output: { kind: 'series' }, to: { kind: 'display' } },
]);

refuses('a series consumed as a scalar is refused',
  'wants scalar, but step "byDepot" produces series', [
  byDepot,
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{
      field: { entity: 'trailers', field: 'status' },
      to: { kind: 'result', of: { ref: 'scalar', step: 'byDepot' } },
    }],
  },
]);

refuses('a series consumed as a source is refused',
  'a series result cannot be used here', [
  byDepot,
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    match: { ref: 'series', step: 'byDepot' },
    set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
  },
]);

/* --- one value out of a set has to say which reduction it means --- */
refuses('a field taken from rows is refused, because a set has many values',
  'wants field, but step "contactRows" produces rows', [
  contactRows,
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'contacts' },
    match: { ref: 'rows', step: 'contactRows' },
    /* `location` rather than `status`, which stopped being writable by
       hand with migration 043: a company's status is derived from its
       leads. These cases are about the SHAPE of a reference, so the
       column only has to be one somebody could actually write. */
    set: [{
      field: { entity: 'contacts', field: 'location' },
      to: { kind: 'result', of: { ref: 'field', step: 'contactRows', field: 'location' } },
    }],
  },
]);

accepts('a field taken from a record is accepted', [
  newContact,
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'contacts' },
    match: { ref: 'record', step: 'newContact' },
    set: [{
      field: { entity: 'contacts', field: 'location' },
      to: { kind: 'result', of: { ref: 'field', step: 'newContact', field: 'location' } },
    }],
  },
]);

/* --- references that name nothing usable --- */
refuses('a forward reference is refused',
  'does not come earlier', [
  { op: 'emit', id: 'e', from: { ref: 'rows', step: 'later' }, output: { kind: 'rows' }, to: { kind: 'display' } },
  { ...contactRows, id: 'later' },
]);

refuses('a reference to a missing step is refused',
  'does not exist', [
  { op: 'emit', id: 'e', from: { ref: 'rows', step: 'nope' }, output: { kind: 'rows' }, to: { kind: 'display' } },
]);

refuses('a step that yields nothing referenceable cannot be referenced',
  'produces nothing that can be referenced', [
  contactRows,
  { op: 'emit', id: 'shown', from: { ref: 'rows', step: 'contactRows' }, output: { kind: 'rows' }, to: { kind: 'display' } },
  { op: 'emit', id: 'e', from: { ref: 'artefact', step: 'shown' }, output: { kind: 'rows' }, to: { kind: 'display' } },
]);

refuses('duplicate step ids are refused',
  'duplicate step id', [contactRows, { ...contactRows }]);

/* =============================================================
   2. The declared output is checked, never believed
   ============================================================= */

refuses('a select over contacts claiming to produce a crm_lists record is refused',
  'declares record, but this select step produces rows', [
  { op: 'select', id: 's', from: { entity: 'contacts' }, produces: { kind: 'record', entity: 'crm_lists' } },
]);

refuses('a create of crm_lists claiming to produce trailer rows is refused',
  'declares rows, but this create step produces record', [
  { op: 'create', id: 's', target: { entity: 'crm_lists' }, produces: { kind: 'rows', entity: 'trailers' } },
]);

refuses('a select over contacts claiming to produce trailer rows is refused',
  'declares rows of trailers, but this select step produces rows of contacts', [
  { op: 'select', id: 's', from: { entity: 'contacts' }, produces: { kind: 'rows', entity: 'trailers' } },
]);

refuses('an aggregating select claiming to produce rows is refused',
  'declares rows, but this select step produces scalar', [
  { ...trailerCount, produces: { kind: 'rows', entity: 'trailers' } },
]);

refuses('a grouped aggregate claiming to produce one scalar is refused',
  'declares scalar, but this select step produces series', [
  { ...byDepot, produces: { kind: 'scalar' } },
]);

refuses('an emit to the screen claiming to produce a file is refused',
  'nothing about this emit step establishes an output', [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'rows' }, to: { kind: 'display' }, produces: { kind: 'artefact' },
  },
]);

/* The other half: the claim is not needed at all, because the contract
   is derived. A step that declares nothing is still referenceable. */
accepts('a step that declares nothing is still referenceable, because the contract is derived', [
  { op: 'select', id: 'undeclared', from: { entity: 'contacts' } },
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'undeclared' },
    output: { kind: 'file', format: 'csv' }, to: { kind: 'download' }, capability: 'rows.export',
  },
]);

/* And a lie cannot buy anything: the reference is judged on the
   derivation, so the false claim neither helps nor is consulted. */
refuses('a select lying that it produces a record cannot then be used as one',
  'wants record, but step "liar" produces rows', [
  { op: 'select', id: 'liar', from: { entity: 'contacts' }, produces: { kind: 'record', entity: 'contacts' } },
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'record', step: 'liar' } },
]);

/* =============================================================
   3. Entity identity
   ============================================================= */

refuses('rows of contacts cannot choose which trailers a write touches',
  'produces rows of contacts, but trailers is required here', [
  contactRows,
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    match: { ref: 'rows', step: 'contactRows' },
    set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
  },
]);

refuses('a bare set of contacts cannot match a write to trailers',
  'this is a set of contacts, but trailers is required here', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'contacts' },
    set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
  },
]);

refuses('a write to trailers cannot set a field belonging to contacts',
  'sets contacts.location, but this update targets trailers', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{ field: { entity: 'contacts', field: 'location' }, to: { kind: 'literal', value: 'live' } }],
  },
]);

refuses('a select over trailers cannot filter on a contacts field without a relationship',
  'is not reachable from trailers without a relationship', [
  {
    op: 'select', id: 's', from: { entity: 'trailers' },
    where: {
      kind: 'cmp', op: 'eq',
      left: { kind: 'field', of: { entity: 'contacts', field: 'location' } },
      right: { kind: 'literal', value: 'live' },
    },
  },
]);

accepts('the same reach is fine when it goes through a declared relationship', [
  {
    op: 'select', id: 's', from: { entity: 'trailers' },
    where: { kind: 'related', via: 'trailer.customer' },
    produces: { kind: 'rows', entity: 'trailers' },
  },
]);

refuses('a relationship that does not start at this entity is refused',
  'relationship "contact.lists" starts at contacts, not trailers', [
  {
    op: 'select', id: 's', from: { entity: 'trailers' },
    where: { kind: 'related', via: 'contact.lists' },
  },
]);

refuses('an unknown relationship is refused',
  'unknown relationship "not.a.relationship"', [
  { op: 'select', id: 's', from: { entity: 'contacts' }, where: { kind: 'related', via: 'not.a.relationship' } },
]);

refuses('an update with no match is refused',
  'update with no match would touch every row', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
  },
]);

refuses('writing a field that is not writable is refused',
  'profit is not writable', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{ field: { entity: 'trailers', field: 'profit' }, to: { kind: 'literal', value: 1 } }],
  },
]);

/* =============================================================
   4. Capability contracts
   ============================================================= */

refuses('an invoke naming an update capability is refused',
  'operates update, so an invoke step cannot name it', [
  newContact,
  { op: 'invoke', id: 'x', capability: 'record.updateField', subject: { ref: 'record', step: 'newContact' } },
]);

refuses('an invoke naming an unregistered capability is refused',
  'capability "contact.teleport" is not registered', [
  newContact,
  { op: 'invoke', id: 'x', capability: 'contact.teleport', subject: { ref: 'record', step: 'newContact' } },
]);

refuses('an invoke whose subject is the wrong entity is refused',
  'capability "contact.enrich" does not apply to trailers', [
  trailerRows,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'rows', step: 'trailerRows' } },
]);

refuses('an entity scoped capability invoked with no subject is refused',
  'applies to contacts and needs a subject', [
  { op: 'invoke', id: 'x', capability: 'contact.enrich' },
]);

accepts('an invoke on the entity it applies to is accepted', [
  contactRows,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'rows', step: 'contactRows' } },
]);

refuses('an export naming no capability is refused',
  'as a file to download must name the capability that permits it', [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'xlsx' }, to: { kind: 'download' },
  },
]);

refuses('an emit naming a select capability is refused',
  'operates select, so an emit step cannot name it', [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'xlsx' }, to: { kind: 'download' }, capability: 'data.read',
  },
]);

/* --- requirements come from everything a plan reaches --- */
/** Permission atoms only: what the actor must be allowed to do. */
const caps = (steps: Step[]) =>
  requirementsOf(steps).filter((r) => r.kind === 'permission').map((r) => r.id);

ok('reading contacts requires seeing the CRM',
  caps([contactRows]).includes('crm.view'), caps([contactRows]).join(','));

ok('reading trailers alone does not require seeing the CRM',
  !caps([trailerRows]).includes('crm.view'), caps([trailerRows]).join(','));

const writeStatus: Step[] = [{
  op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
  set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
}];
ok('writing a trailer field requires the capability that field declares',
  caps(writeStatus).includes('stock.edit'), caps(writeStatus).join(','));

const enrichPlan: Step[] = [
  contactRows,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'rows', step: 'contactRows' } },
];
ok('invoking enrichment requires the credit spending capability',
  caps(enrichPlan).includes('crm.enrich'), caps(enrichPlan).join(','));

const exportPlan: Step[] = [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'xlsx' }, to: { kind: 'download' }, capability: 'rows.export',
  },
];
ok('putting rows in a file requires the export capability',
  caps(exportPlan).includes('crm.export'), caps(exportPlan).join(','));

/* A traversal reaches an entity the step is not over, and the
   requirement has to come with it. */
const traversalPlan: Step[] = [{
  op: 'select', id: 's', from: { entity: 'contacts' },
  where: { kind: 'related', via: 'contact.lists' },
  produces: { kind: 'rows', entity: 'contacts' },
}];
ok('traversing a relationship carries its own requirement',
  requirementsOf(traversalPlan).some((r) => r.because === 'traverses contact.lists'),
  JSON.stringify(requirementsOf(traversalPlan)));

const pathPlan: Step[] = [{
  op: 'select', id: 's', from: { entity: 'trailers' },
  select: [{ as: 'buyer', expr: { kind: 'field', of: { entity: 'trailers', via: ['trailer.customer'], field: 'company_name' } } }],
}];
ok('a field reached through a path carries the traversal requirement',
  requirementsOf(pathPlan).some((r) => r.because === 'traverses trailer.customer'),
  JSON.stringify(requirementsOf(pathPlan)));

ok('a plan claiming to need nothing still has its requirements derived',
  derivedRequirements({ steps: [contactRows], advisoryRequires: [], unmet: [] }).length > 0);

/* --- registry invariants --- */
for (const c of CAPABILITIES) {
  ok(`${c.id} says whether it is repeatable`, typeof c.idempotent === 'boolean');
  if (c.produces) {
    /* An output is only meaningful where a later step can consume it.
       A create makes a record and a `ResultRef` can name it, which is
       what "find these customers and make a list of them" needs. A
       select's output is derived from the select itself and a delete
       leaves nothing behind, so neither declares one. */
    ok(`${c.id} only declares an output because something can name it`,
      c.operates === 'invoke' || c.operates === 'emit' || c.operates === 'create',
      c.operates);
  }
}

/* =============================================================
   5. An unresolved request does not get to write
   ============================================================= */

const unmet = [{ part: 'order', why: 'nothing here records mileage' }];

refuses('a plan with an unresolved part may not update',
  'went unresolved', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{ field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } }],
  },
], unmet);

refuses('a plan with an unresolved part may not delete',
  'went unresolved', [
  { op: 'delete', id: 'd', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' } },
], unmet);

refuses('a plan with an unresolved part may not spend a credit',
  'went unresolved', [
  contactRows,
  { op: 'invoke', id: 'x', capability: 'contact.enrich', subject: { ref: 'rows', step: 'contactRows' } },
], unmet);

accepts('a plan with an unresolved part may still answer the question', [contactRows], unmet);

/* This used to be an acceptance, and it was the defect. A spreadsheet
   in somebody's downloads folder carries no record of the question, so
   a partial answer in one is indistinguishable from a complete one. */
refuses('a plan with an unresolved part may not produce a download',
  'went unresolved', exportPlan, unmet);

/* An unmet severity problem found by the validator itself counts the
   same as one the reader reported. Both mean part of the request went
   unresolved. */
refuses('an unknown field found during validation also stops a write',
  'went unresolved', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [
      { field: { entity: 'trailers', field: 'status' }, to: { kind: 'literal', value: 'sold' } },
    ],
    // a second write to a column nothing has
  },
  {
    op: 'update', id: 'u2', expect: 'many', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{ field: { entity: 'trailers', field: 'mileage' }, to: { kind: 'literal', value: 1 } }],
  },
]);

/* =============================================================
   The plan classes from the design, end to end
   ============================================================= */

const filteredExport: Step[] = [
  {
    op: 'select', id: 's1', from: { entity: 'trailers' },
    where: {
      kind: 'cmp', op: 'eq',
      left: { kind: 'field', of: { entity: 'trailers', field: 'location' } },
      right: { kind: 'literal', value: 'Carrington' },
    },
    produces: { kind: 'rows', entity: 'trailers' },
  },
  {
    op: 'emit', id: 's2', from: { ref: 'rows', step: 's1' },
    output: { kind: 'file', format: 'csv' }, to: { kind: 'download' }, capability: 'rows.export',
  },
];
accepts('class: a filtered set exported to a file', filteredExport);

const chained: Step[] = [
  {
    op: 'select', id: 's1', from: { entity: 'contacts' },
    where: { kind: 'related', via: 'customer.trailers', count: { op: 'gt', n: 20 } },
    produces: { kind: 'rows', entity: 'contacts' },
  },
  { op: 'create', id: 's2', target: { entity: 'contacts' }, produces: { kind: 'record', entity: 'contacts' } },
  {
    op: 'update', id: 's3', expect: 'many', target: { entity: 'contacts' }, match: { ref: 'record', step: 's2' },
    set: [{ field: { entity: 'contacts', field: 'location' }, to: { kind: 'literal', value: 'live' } }],
  },
];
accepts('class: select, create, then act on the created record', chained);
ok('that chained plan needs confirmation', needsConfirmation({ steps: chained, unmet: [] }));

const contextual: Step[] = [
  { op: 'select', id: 's1', from: { entity: 'trailers' }, produces: { kind: 'rows', entity: 'trailers' } },
  {
    op: 'update', id: 's2', expect: 'many', target: { entity: 'trailers' }, match: { ref: 'rows', step: 's1' },
    set: [{ field: { entity: 'trailers', field: 'location' }, to: { kind: 'literal', value: 'Hyde' } }],
  },
];
accepts('class: a contextual selection driving a bulk write', contextual);

const artefactChain: Step[] = [
  contactRows,
  {
    op: 'emit', id: 'file', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'xlsx' }, to: { kind: 'download' }, capability: 'rows.export',
  },
  {
    op: 'emit', id: 'sent', from: { ref: 'artefact', step: 'file' },
    output: { kind: 'file', format: 'xlsx' },
    to: { kind: 'email', to: [{ kind: 'context', slot: 'actor' }] },
    capability: 'rows.email',
  },
];
accepts('class: rows to a file, then the file onward', artefactChain);

/* =============================================================
   6. Destinations: where a result goes decides what it is

   An emit was one step kind covering "put this on the screen" and "send
   this to a customer", with no declared difference between them, so
   neither had a capability to derive and the unresolved-request gate
   exempted both. A half understood sentence could not update a row and
   could email the half it understood out of the company.
   ============================================================= */

const emitTo = (to: Emit['to'], capability?: string): Step[] => [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'rows' }, to, ...(capability ? { capability } : {}),
  },
];

const someone: Expr = { kind: 'context', slot: 'actor' };

/* --- 1 and 2: an unresolved request produces no outcome anywhere --- */

refuses('an unresolved part refuses a csv download',
  'went unresolved', [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'csv' }, to: { kind: 'download' }, capability: 'rows.export',
  },
], unmet);

refuses('an unresolved part refuses an email',
  'went unresolved', emitTo({ kind: 'email', to: [someone] }, 'rows.email'), unmet);

refuses('an unresolved part refuses a share',
  'went unresolved', emitTo({ kind: 'share', with: [someone] }, 'rows.share'), unmet);

refuses('an unresolved part refuses an attachment',
  'went unresolved', emitTo({ kind: 'attach', to: { entity: 'contacts' } }, 'record.attach'), unmet);

/* --- 3, 4 and 5: an effect with no capability named --- */

refuses('an email naming no capability is refused',
  'emailed out must name the capability that permits it',
  emitTo({ kind: 'email', to: [someone] }));

refuses('a share naming no capability is refused',
  'shared with colleagues must name the capability that permits it',
  emitTo({ kind: 'share', with: [someone] }));

refuses('an attachment naming no capability is refused',
  'attached to a record must name the capability that permits it',
  emitTo({ kind: 'attach', to: { entity: 'contacts' } }));

/* Naming the wrong one is not naming one. An export capability does
   not authorise sending the file to somebody. */
refuses('the export capability does not authorise an email',
  'email is permitted by "rows.email", not by "rows.export"',
  emitTo({ kind: 'email', to: [someone] }, 'rows.export'));

refuses('a capability on a display emit is refused, because it claims an effect it does not have',
  'claims an effect this step does not have',
  emitTo({ kind: 'display' }, 'rows.export'));

accepts('an email naming the email capability is accepted',
  emitTo({ kind: 'email', to: [someone] }, 'rows.email'));
accepts('a share naming the share capability is accepted',
  emitTo({ kind: 'share', with: [someone] }, 'rows.share'));
accepts('an attachment naming the attach capability is accepted',
  emitTo({ kind: 'attach', to: { entity: 'contacts' } }, 'record.attach'));

refuses('an email addressed to nobody is refused',
  'an email to nobody is not an email',
  emitTo({ kind: 'email', to: [] }, 'rows.email'));

/* --- 6: effects are confirmed, reads are not --- */

const confirms = (steps: Step[]) => needsConfirmation({ steps, unmet: [] });

ok('an email is confirmed before it is sent',
  confirms(emitTo({ kind: 'email', to: [someone] }, 'rows.email')));
ok('a share is confirmed before it happens',
  confirms(emitTo({ kind: 'share', with: [someone] }, 'rows.share')));
ok('an attachment is confirmed before it happens',
  confirms(emitTo({ kind: 'attach', to: { entity: 'contacts' } }, 'record.attach')));
ok('putting an answer on the screen is not confirmed',
  !confirms(emitTo({ kind: 'display' })));
ok('a download is not confirmed, because the file goes to the person who asked',
  !confirms([
    contactRows,
    {
      op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
      output: { kind: 'file', format: 'csv' }, to: { kind: 'download' }, capability: 'rows.export',
    },
  ]));

/* --- 7: the destination's requirement is derived --- */

ok('emailing rows out requires the export capability',
  caps(emitTo({ kind: 'email', to: [someone] }, 'rows.email')).includes('crm.export'),
  caps(emitTo({ kind: 'email', to: [someone] }, 'rows.email')).join(','));

ok('sharing rows requires the list managing capability',
  caps(emitTo({ kind: 'share', with: [someone] }, 'rows.share')).includes('crm.manageLists'),
  caps(emitTo({ kind: 'share', with: [someone] }, 'rows.share')).join(','));

ok('attaching to a record requires the capability to change one',
  caps(emitTo({ kind: 'attach', to: { entity: 'contacts' } }, 'record.attach')).includes('crm.edit'),
  caps(emitTo({ kind: 'attach', to: { entity: 'contacts' } }, 'record.attach')).join(','));

ok('showing an answer on screen requires nothing beyond reading it',
  !caps(emitTo({ kind: 'display' })).includes('crm.export'),
  caps(emitTo({ kind: 'display' })).join(','));

/* Building the file and sending it are two permissions, and a plan
   that does both derives both. */
const emailedFile: Step[] = [
  contactRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'contactRows' },
    output: { kind: 'file', format: 'xlsx' },
    to: { kind: 'email', to: [someone] }, capability: 'rows.email',
  },
];
ok('emailing a spreadsheet derives both the file and the sending requirement',
  requirementsOf(emailedFile).some((r) => r.because.startsWith('puts rows into a'))
  && requirementsOf(emailedFile).some((r) => r.because.startsWith('sends it')),
  JSON.stringify(requirementsOf(emailedFile)));

/* A destination that reaches a record reads that record, and the
   requirement has to come from the destination and not only the rows. */
const attachToContact: Step[] = [
  trailerRows,
  {
    op: 'emit', id: 'e', from: { ref: 'rows', step: 'trailerRows' },
    output: { kind: 'rows' },
    to: { kind: 'attach', to: { entity: 'contacts' } }, capability: 'record.attach',
  },
];
ok('a destination pointing at contacts derives the requirement to read contacts',
  requirementsOf(attachToContact).some((r) => r.because === 'reads contacts'),
  JSON.stringify(requirementsOf(attachToContact)));

/* --- 8 and 9: what the screen may and may not claim --- */

const cleanDisplay: Plan = { steps: emitTo({ kind: 'display' }), unmet: [] };
const partialDisplay: Plan = { steps: emitTo({ kind: 'display' }), unmet };

ok('a clean read that goes to the screen is allowed', fatal(cleanDisplay).length === 0,
  why(cleanDisplay));
ok('a clean read that goes to the screen is a completed command',
  completion(cleanDisplay).kind === 'complete', completion(cleanDisplay).kind);

ok('a screen result with an unresolved part is still allowed to run',
  fatal(partialDisplay).length === 0, why(partialDisplay));

const partial = completion(partialDisplay);
ok('a screen result with an unresolved part is never reported as complete',
  partial.kind === 'partial', partial.kind);
ok('and it carries what went unresolved, so the screen can show it',
  partial.kind === 'partial' && partial.unresolved.length === unmet.length,
  JSON.stringify(partial));

/* The three states are distinct. A refused plan is not a partial one. */
ok('a refused plan is reported as refused, not as partial',
  completion({ steps: emitTo({ kind: 'email', to: [someone] }), unmet: [] }).kind === 'refused');

/* --- every destination is declared, and declares its own contract --- */
for (const kind of Object.keys(DESTINATIONS) as (keyof typeof DESTINATIONS)[]) {
  const d = DESTINATIONS[kind];
  ok(`${kind} says whether it may run on an unresolved request`,
    typeof d.allowsUnresolved === 'boolean');
  /* Only the screen may, because only the screen can show the question
     alongside the answer. */
  if (d.allowsUnresolved) ok(`${kind} is read only`, d.effect === 'read', d.effect);
  /* A CLIENT EFFECT LEAVES NOTHING BEHIND ANYWHERE A SERVER CAN SEE.

     Copying puts what the screen was already showing into somebody's
     paste buffer. Nothing is stored, nothing is sent, no record
     changes, and there is no capability that could govern it beyond
     the one that permitted reading the answer in the first place. It
     is asserted separately rather than lumped in below, so "needs no
     capability" is a stated property rather than an omission. */
  if (d.effect === 'client') {
    ok(`${kind} needs no capability of its own`, !d.capability, d.capability);
    ok(`${kind} is not confirmed`, !d.confirm);
    ok(`${kind} may not run on an unresolved request`, d.allowsUnresolved === false);
  }

  /* Anything that is not read only or client side leaves something
     behind and needs a capability naming who may do it. */
  if (d.effect !== 'read' && d.effect !== 'client') {
    ok(`${kind} names the capability that permits it`, !!d.capability);
    ok(`${kind} may not run on an unresolved request`, d.allowsUnresolved === false);
    const cap = d.capability ? CAPABILITIES.find((c) => c.id === d.capability) : undefined;
    ok(`${kind} names a registered capability`, !!cap, d.capability);
    ok(`${kind} names a capability that operates on an emit`, cap?.operates === 'emit', cap?.operates);
  }
  /* Everything that leaves the company or changes a record is
     confirmed first. A file to the person who asked for it is not. */
  if (d.effect === 'external' || d.effect === 'mutation') {
    ok(`${kind} is confirmed before it happens`, d.confirm);
  }
}

/* =============================================================
   7. Mutations: cardinality, clearability, references, intervals

   The pieces a write needs that a read does not. Every one of these is
   a way for an instruction to do more than it said.
   ============================================================= */

const trailer = (field: string) => ({ entity: 'trailers', field });
const lit = (value: string | number | null): Expr => ({ kind: 'literal', value });

/* --- cardinality comes from the sentence --- */

/* The type requires `expect` on update and delete. A plan arriving as
   JSON has not been through the type, so the validator checks it too. */
refuses('an update that does not say how many rows the request named is refused',
  'must say whether the request named one row or many', [
  {
    op: 'update', id: 'u', target: { entity: 'trailers' }, match: { entity: 'trailers' },
    set: [{ field: trailer('location'), to: lit('Hyde') }],
  } as unknown as Step,
]);

refuses('a delete that does not say how many is refused',
  'must say whether the request named one row or many', [
  { op: 'delete', id: 'd', target: { entity: 'trailers' }, match: { entity: 'trailers' } } as unknown as Step,
]);

accepts('a named record says one', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: {
      op: 'select', from: { entity: 'trailers' },
      where: { kind: 'cmp', op: 'eq', left: { kind: 'field', of: trailer('stc_no') }, right: lit('STC143580') },
    },
    set: [{ field: trailer('retail_price'), to: lit(24995) }],
  },
]);

accepts('a described set says many', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    match: {
      op: 'select', from: { entity: 'trailers' },
      where: {
        kind: 'and',
        of: [
          { kind: 'cmp', op: 'eq', left: { kind: 'field', of: trailer('status') }, right: lit('in_stock') },
          { kind: 'cmp', op: 'eq', left: { kind: 'field', of: trailer('location') }, right: lit('Hyde') },
        ],
      },
    },
    set: [{ field: trailer('location'), to: lit('Bredbury') }],
  },
]);

/* A create has no selection to be ambiguous about, so it declares no
   cardinality and must not be asked for one. */
accepts('a create needs no cardinality', [
  { op: 'create', id: 'c', target: { entity: 'contacts' } },
]);

/* --- clearing --- */

refuses('emptying a column the database will not accept as empty is refused',
  'status cannot be emptied', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    match: { entity: 'trailers' }, set: [{ field: trailer('status'), to: lit(null) }],
  },
]);

accepts('emptying a nullable column is accepted', [
  {
    op: 'update', id: 'u', expect: 'many', target: { entity: 'trailers' },
    match: { entity: 'trailers' }, set: [{ field: trailer('location'), to: lit(null) }],
  },
]);

ok('a field nobody has checked for nullability is not clearable',
  field('trailers', 'status')?.clearable === false
  && field('trailers', 'location')?.clearable === true);

/* --- appending --- */

refuses('appending to something that is not long text is refused',
  'so nothing can be appended to it', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{ field: trailer('location'), to: lit(' extra'), mode: 'append' }],
  },
]);

accepts('appending to long text is accepted', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{ field: trailer('notes'), to: lit('chasing tyres'), mode: 'append' }],
  },
]);

/* --- arithmetic is an expression, not a mode --- */

accepts('adding to a number is the number plus the amount', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{
      field: trailer('refurb_costs'),
      to: { kind: 'binary', op: '+', left: { kind: 'field', of: trailer('refurb_costs') }, right: lit(1000) },
    }],
  },
]);

/* The same shape carries a proportion, which is why it is an expression
   and not an `add` flag: nothing had to be added to express it. */
accepts('a proportional change needs no new operator', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{
      field: trailer('retail_price'),
      to: {
        kind: 'binary', op: '*',
        left: { kind: 'field', of: trailer('retail_price') }, right: lit(1.1),
      },
    }],
  },
]);

/* --- references stay symbolic --- */

const ownerNamedDave: Expr = {
  kind: 'reference', entity: 'profiles', select: 'full_name', onAmbiguity: 'ask',
  where: {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: 'profiles', field: 'full_name' } },
    right: lit('Dave'),
  },
};

accepts('a value that names a row without saying which row is accepted', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'contacts' },
    match: { entity: 'contacts' },
    set: [{ field: { entity: 'contacts', field: 'assigned_to' }, to: ownerNamedDave }],
  },
]);

/* Reading profiles needs nothing, per `profiles_select_all`, so that
   reference derives no permission and correctly says so. A reference
   into a gated entity must derive its gate. */
const customerNamed: Expr = {
  kind: 'reference', entity: 'contacts', select: 'company_name', onAmbiguity: 'ask',
  where: {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: 'contacts', field: 'company_name' } },
    right: lit('Dawson'),
  },
};
const setCustomer: Step[] = [{
  op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
  match: { entity: 'trailers' },
  set: [{ field: trailer('customer'), to: customerNamed }],
}];
ok('a reference derives the requirement to read what it looks in',
  requirementsOf(setCustomer).some((r) => r.because === 'reads contacts' && r.id === 'crm.view'),
  JSON.stringify(requirementsOf(setCustomer)));
ok('and the write still derives the capability the field itself needs',
  requirementsOf(setCustomer).some((r) => r.because === 'writes trailers.customer'),
  JSON.stringify(requirementsOf(setCustomer)));

refuses('a reference into an entity nothing knows about is refused',
  'unknown entity "wizards"', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'contacts' },
    match: { entity: 'contacts' },
    set: [{
      field: { entity: 'contacts', field: 'assigned_to' },
      to: { ...ownerNamedDave, entity: 'wizards' },
    }],
  },
]);

refuses('a reference that would take every match is not one value',
  'not a single value', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'contacts' },
    match: { entity: 'contacts' },
    set: [{
      field: { entity: 'contacts', field: 'assigned_to' },
      to: { ...ownerNamedDave, onAmbiguity: 'all' },
    }],
  },
]);

/* --- moving a date by an interval --- */

accepts('a date moved by an interval is accepted', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{
      field: trailer('mot_date'),
      to: {
        kind: 'shift', of: { kind: 'field', of: trailer('mot_date') },
        by: { n: 1, unit: 'month' }, direction: 'back',
      },
    }],
  },
]);

refuses('moving something that is not a date by an interval is refused',
  'cannot be moved by an interval', [
  {
    op: 'update', id: 'u', expect: 'one', target: { entity: 'trailers' },
    match: { entity: 'trailers' },
    set: [{
      field: trailer('retail_price'),
      to: {
        kind: 'shift', of: { kind: 'field', of: trailer('retail_price') },
        by: { n: 1, unit: 'month' }, direction: 'forward',
      },
    }],
  },
]);

/* --- the discrete operation stays an invoke --- */

ok('marking a deal sold is a capability, not a field write',
  CAPABILITIES.find((c) => c.id === 'deal.markSold')?.operates === 'invoke');
ok('and it has something behind it',
  !!CAPABILITIES.find((c) => c.id === 'deal.markSold')?.handler);

/* =============================================================
   Relationship ambiguity and normalisation
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
