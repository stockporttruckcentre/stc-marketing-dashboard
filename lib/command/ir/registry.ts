/* =============================================================
   What the application contains, as data.

   Four registries: entities, fields, relationships, capabilities. The
   planner and the validator read these. Nothing here parses English.

   Entities and fields are DERIVED from `columns.ts` and `fields.ts`
   rather than hand-written, because a hand-written list is how the
   query engine ended up addressing 4 tables out of 20 and 21 columns
   out of 180. A derived registry cannot silently fall behind the
   schema: adding a column to `columns.ts` adds it here.

   Relationships are hand-declared and cannot be derived, for a reason
   worth stating plainly. This application has almost no foreign keys.
   A trailer is linked to its customer by `stock_trailers.customer`
   holding text that matches `crm_contacts.company_name`. There is no
   `contact_id`. Four of the seven real relationships are value matches
   or join tables, so a registry generated from keys would have found
   three and missed the most important one in the business.
   ============================================================= */
import { TABLES, type ColumnKind } from '../columns';
import { ENTITIES } from '../schema';
import { WRITABLE_FIELDS } from '../fields';
import type { CrmCapability } from '../../crm/permissions';
import type { ProducesKind, AmbiguityPolicy } from './types';

/* =============================================================
   Fields
   ============================================================= */

export type FieldRole =
  | 'identifier'   // names the row to a person
  | 'measure'      // a number worth aggregating
  | 'dimension'    // worth grouping by
  | 'date'
  | 'text'
  | 'enum'
  | 'system';

export type FieldDef = {
  entity: string;
  field: string;
  label: string;
  kind: ColumnKind;
  role: FieldRole;
  filterable: boolean;
  groupable: boolean;
  aggregatable: boolean;
  writable: boolean;
  /**
   * May it be emptied?
   *
   * Absent from the writable dictionary means no. A column the database
   * declares NOT NULL cannot be cleared, and offering to clear it
   * produces a constraint error at the last moment that nobody can act
   * on. Unknown nullability reads as not clearable, which costs a
   * command rather than costing data.
   */
  clearable: boolean;
  /** Capability required to write. Reads are gated at the entity. */
  writeRequires?: CrmCapability;
  /** Values a person may say, mapped to what is stored. */
  vocabulary?: Record<string, string>;
  /**
   * Columns this field's value may actually live in.
   *
   * Body type is recorded in `category` on some rows and in `model` on
   * others, and `model` is the one the team fills in. A filter that
   * reads only the tidy column answered "how many curtainsiders" with 1
   * when the real figure was in the thousands.
   */
  spans?: string[];
};

/* =============================================================
   Entities
   ============================================================= */

export type EntityDef = {
  id: string;
  table: string;
  label: string;
  labelOne: string;
  /** Present when a query engine entity exists. Absent means read-only census. */
  addressable: boolean;
  titleField?: string;
  subtitleFields: string[];
  defaultDateField?: string;
  fields: FieldDef[];
  /** Capability required to read this entity at all. */
  readRequires?: CrmCapability;
  /**
   * What it takes to make one of these rows, or get rid of one.
   *
   * A property of the OPERATION and the entity, never of whichever
   * column happens to identify the record. Deriving a deletion's
   * permission from the writable entry for the title field made
   * `crm.edit` enough to delete a customer, and the permission model
   * distinguishes `crm.edit` from `crm.delete` on purpose.
   *
   * Absent means a sentence cannot create or delete one of these at
   * all, which is the safe way round.
   */
  createRequires?: CrmCapability;
  deleteRequires?: CrmCapability;
  /**
   * What it takes to hang a file off one of these rows.
   *
   * Migration 014 derives it from the target table and this is the same
   * answer on the near side, so a permission set that holds one and not
   * the other is offered exactly what it may do. Absent means a file
   * cannot be attached to this entity at all.
   */
  attachRequires?: CrmCapability;
};

/* =============================================================
   Relationships
   ============================================================= */

/**
 * How two entities are actually joined.
 *
 * `key` is a declared identifier column. `match` is value equality
 * between two ordinary columns, which is the common case here and the
 * one that needs care. `through` is a join table. `resolver` is
 * anything the database cannot express on its own.
 */
export type Join =
  | { via: 'key'; localField: string; remoteField: string }
  | {
      via: 'match';
      on: { local: string; remote: string; op: 'eq' | 'contains' }[];
      /**
       * Applied to BOTH sides before comparing. Order matters and is
       * the declared order.
       *
       * Without this, "Don Bur" and "DonBur" are different customers,
       * and both appear in the real make column. Normalisation is part
       * of the relationship, not a convenience the executor applies
       * when it remembers to.
       */
      normalise: Normalisation[];
      /** What to do when the match is not unique. Never "pick one". */
      onAmbiguity: AmbiguityPolicy;
    }
  | { via: 'through'; table: string; localKey: string; remoteKey: string }
  | { via: 'resolver'; name: string; onAmbiguity: AmbiguityPolicy };

export type Normalisation =
  | 'trim'
  | 'casefold'
  | 'collapse-space'
  | 'strip-punctuation'
  | 'strip-company-suffix';

/**
 * What happens when a value match finds more than one row.
 *
 * Declared in `types.ts`, because expressions carry one too: a value
 * that names a row without saying which row has to say what happens
 * when the name fits two. Re-exported here so a relationship reads as
 * one thing.
 *
 * There is deliberately no `first` and no `closest`. Silently picking
 * one of several matching customers produces a confident wrong answer,
 * and a confident wrong answer is the failure this whole architecture
 * exists to stop. If the caller wants every match they say so with
 * `all`; otherwise the plan stops and asks, or refuses.
 */
export type { AmbiguityPolicy } from './types';

export type RelationshipDef = {
  id: string;
  from: string;
  to: string;
  /** Cardinality seen from the `from` side. */
  cardinality: 'one' | 'many';
  label: string;
  /** The reverse edge id, so traversal works both ways. */
  inverse?: string;
  join: Join;
  /** Capabilities needed to traverse. Checked server side, not here. */
  requires?: CrmCapability[];
  /** True when the join is not backed by a declared key. */
  approximate: boolean;
};

/* =============================================================
   Capabilities
   ============================================================= */

/**
 * A value a business operation needs that the records do not hold.
 *
 * Declared rather than read out of a handler, so the reader can look
 * for it in the sentence, the preview can say what is still missing,
 * and neither has to know what a sale is. `from` names a column on the
 * subject that already answers it, which is what makes most sales need
 * nothing typed: the price is on the deal.
 */
export type CapabilityInput = {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Refuse rather than run without it. */
  required: boolean;
  /**
   * The question to put when a sentence did not carry it.
   *
   * Only where the generic one would be wrong. "Which address" and
   * "what is the address" are both about an address, and asking
   * somebody making one the main address to type it out is not the
   * question: they are choosing between the ones already there.
   */
  ask?: string;
  /**
   * How an answer goes back into the sentence.
   *
   * `%s` is what they typed. The answer to "what should it say" is not
   * a field the browser posts: it is added to the raw command text and
   * the server plans the whole thing again, which is what keeps one
   * authority over what a sentence means. Absent means the answer is
   * appended as it stands, which is right for anything the reader finds
   * by shape rather than by position.
   */
  fills?: string;
  /** A column on the operated entity that supplies it when it is there. */
  from?: string;
  /**
   * A column to read so the preview can show it, which does NOT supply
   * the input.
   *
   * The difference matters where the column is the value being
   * REPLACED. A role change reads the role somebody holds so the
   * preview can say "sales to admin", and declaring that with `from`
   * made the current role satisfy the required new one: "change Dave to
   * admin" and "change Dave" were both complete, and the second one
   * meant changing him to what he already is.
   */
  shows?: string;
  /**
   * Which group of inputs this one belongs to.
   *
   * A day and a time are one question to a person and two values to the
   * database. Asking "which day" and then "what time" one after the
   * other is the form talking rather than somebody being asked when
   * they want the meeting, so inputs that answer one question say so
   * and `inputGroups` on the capability carries the question.
   */
  group?: string;
  /**
   * Required only when another input has a particular value.
   *
   * Answering an invitation takes no time unless the answer is a
   * counter proposal, and then it takes one. Declaring it plainly
   * required would ask for a time in order to accept.
   */
  requiredWhen?: { arg: string; is: string };
  /**
   * Another input this one is worked out from.
   *
   * `city` is what `place` means to Lusha, which the reader derives
   * from the place somebody named. It is required, and it is never a
   * question of its own: asking "where should I search" twice, once in
   * their words and once in Lusha's, would be nonsense. Supplying the
   * input it is derived from supplies it.
   */
  derivedFrom?: string;
};

export type CapabilityDef = {
  id: string;
  label: string;
  /** Values it needs beyond the records themselves. */
  inputs?: CapabilityInput[];
  /**
   * Which step operation may name it.
   *
   * Checked, not decorative. `record.updateField` operates `update`, so
   * an `invoke` step naming it is a malformed plan: it would have gone
   * through the invoke path and never reached the field level write
   * gate that `update` steps go through.
   */
  operates: 'select' | 'create' | 'update' | 'delete' | 'invoke' | 'emit';
  /** Entities it applies to. Absent or empty means any. */
  entities?: string[];
  requires?: CrmCapability;
  /** Whether a preview and confirmation is mandatory before execution. */
  confirm: boolean;
  /**
   * What an `invoke` or `emit` naming this makes available downstream.
   *
   * Absent means the result cannot be referenced. Nothing else can be
   * derived about a capability's output from the step alone, so a
   * capability that does not declare this cannot be chained from.
   */
  produces?: ProducesKind;
  /**
   * Safe to perform twice with the same outcome.
   *
   * Read by the unmet gate. A plan carrying something it did not
   * understand may still run a repeatable step, because the worst case
   * is a wasted call. Spending an enrichment credit is not repeatable
   * and does not get to run on a half understood sentence.
   */
  idempotent: boolean;
  /** Present when something actually performs it. Absent means declared only. */
  handler?: string;
  /**
   * An operation that MAKES a record rather than acting on ones that
   * already exist.
   *
   * Every other operation here starts from a set of records a sentence
   * named. Writing a social post starts from nothing: the content, the
   * platforms and the date are the whole of it, and there is no subject
   * to resolve. Declared rather than inferred from an empty subject,
   * because a sentence that failed to say which records is exactly what
   * the subject check exists to catch.
   */
  creates?: boolean;
  /**
   * Work that happens OUTSIDE the database, before the transaction.
   *
   * Names an entry in `server/prepare.ts`. Looking a company up in
   * Lusha is an HTTP call to somebody else's service that spends a
   * credit and cannot be rolled back, so it cannot be inside a
   * transaction and must not be after one: it runs where a file is
   * rendered, and what it produces are changes the transaction writes.
   */
  prepares?: string;
  /**
   * Questions that several inputs answer between them.
   *
   * "When?" is one question and a start is one timestamp, and in
   * between are a day and a clock time, either of which somebody may
   * leave out. A group asks once for whatever is still missing.
   *
   * `oneOf` is the other shape: the inputs are alternatives rather than
   * parts, so the question is asked only when NONE of them is there.
   * Moving a meeting takes a moment or a clock time and never both.
   */
  inputGroups?: { id: string; ask: string; fills?: string; oneOf?: boolean }[];
  /**
   * Its result can be worked out exactly, before it happens.
   *
   * For operations whose post-state is calculated inside SQL. A sale
   * works out a commission from a rate on the deal, so the command
   * layer cannot describe the result with `effect` alone and used to
   * declare those columns unpredictable, which made "mark these sold
   * and export the result" a refusal.
   *
   * The store asks the operation itself instead. `effect` below stays,
   * and stays honest: it is what this application can say when nothing
   * can be asked, and a store with no projection falls back to it.
   */
  projects?: boolean;
  /**
   * What it leaves on its subjects, for a step that reads the result.
   *
   * A programme's file is rendered before its transaction opens, so
   * "mark these as sold and export the result" would otherwise export
   * the rows as they were before the sale. Declared rather than
   * inferred: a value may be a constant or one of the operation's own
   * arguments, written `{ arg: 'role' }`.
   *
   * Absent means nothing downstream may claim to know what this leaves
   * behind, which is the safe way round. A guess would be worse than the
   * old rows, because at least those were true once.
   */
  effect?: import('./overlay').DeclaredEffect;
  /**
   * What is missing, exactly, when there is no handler.
   *
   * "Nothing performs it yet" is true of a capability nobody has got to
   * and of one that cannot be built here at all, and those are
   * completely different situations for whoever reads the message. A
   * capability blocked on something outside this repository says which
   * thing, by name, so the answer is a decision somebody can make rather
   * than a wait for work that is not coming.
   */
  needs?: string;
};

/* =============================================================
   Building the registry from what the app already declares
   ============================================================= */

function roleFor(kind: ColumnKind, name: string): FieldRole {
  if (kind === 'system') return 'system';
  if (kind === 'money' || kind === 'number') return 'measure';
  if (kind === 'date') return 'date';
  if (kind === 'enum') return 'dimension';
  if (kind === 'bool') return 'dimension';
  if (/name|no$|number|title/.test(name)) return 'identifier';
  return 'text';
}

let CACHE: EntityDef[] | null = null;

/**
 * What somebody needs before they may read an entity at all.
 *
 * `crm.view` is defined in `permissions.ts` as "see the CRM tab at
 * all", so it is the existing rule for the tables that tab is built on,
 * not a new gate invented here. Trailers are visible from stock screens
 * outside the CRM, so they carry no entity level requirement and are
 * gated per action instead.
 */
function readRequiresFor(table: string): CrmCapability | undefined {
  return /^(crm_|contact_)/.test(table) ? 'crm.view' : undefined;
}

/** Fields for one entity, given its table and its optional query spec. */
function fieldsFor(
  id: string,
  t: (typeof TABLES)[number],
  spec: (typeof ENTITIES)[number] | undefined,
  writable: Map<string, (typeof WRITABLE_FIELDS)[number]>,
): FieldDef[] {
  return t.columns.map((c) => {
    const filterSpec = spec?.filters.find((f) => f.column === c.name);
    const dimSpec = spec?.dimensions.find((d) => d.column === c.name);
    const amtSpec = spec?.amounts.find((a) => a.column === c.name);
    const dateSpec = spec?.dates?.find((d) => d.column === c.name);
    const w = writable.get(c.name);
    const role = roleFor(c.kind, c.name);

    return {
      entity: id,
      field: c.name,
      label: w?.label ?? filterSpec?.label ?? dimSpec?.label ?? amtSpec?.label
        ?? dateSpec?.label ?? c.name.replace(/_/g, ' '),
      kind: c.kind,
      role,
      filterable: !!filterSpec,
      groupable: !!dimSpec,
      aggregatable: !!amtSpec || role === 'measure',
      writable: c.writable !== false && !!w,
      clearable: c.writable !== false && !!w && w.clearable === true,
      writeRequires: w?.capability,
      vocabulary: filterSpec?.vocabulary,
      spans: filterSpec?.key === 'category' && id === 'trailers'
        ? ['category', 'model', 'description'] : undefined,
    };
  });
}

/**
 * Every entity the application holds, whether or not it is queryable.
 *
 * Built entity first, then tables. Two entities can share one table:
 * `deals` and `contacts` are both `crm_contacts`, distinguished by
 * scope and by which columns matter. A table-first build silently lost
 * whichever of the pair was not first, which the equivalence check
 * caught immediately as "unknown entity deals".
 */
export function entities(): EntityDef[] {
  if (CACHE) return CACHE;

  const writableByEntity = new Map<string, Map<string, (typeof WRITABLE_FIELDS)[number]>>();
  for (const f of WRITABLE_FIELDS) {
    const m = writableByEntity.get(f.entity) ?? new Map();
    m.set(f.key, f);
    writableByEntity.set(f.entity, m);
  }

  const out: EntityDef[] = [];
  const claimed = new Set<string>();

  for (const spec of ENTITIES) {
    const t = TABLES.find((x) => x.table === spec.table);
    if (!t) continue;
    claimed.add(spec.table);
    out.push({
      id: spec.id,
      table: spec.table,
      label: spec.label,
      labelOne: spec.labelOne,
      addressable: true,
      titleField: spec.titleColumn,
      subtitleFields: spec.subtitleColumns,
      defaultDateField: spec.dateColumn,
      fields: fieldsFor(spec.id, t, spec, writableByEntity.get(spec.id) ?? new Map()),
      readRequires: readRequiresFor(spec.table),
      createRequires: t.lifecycle?.create as CrmCapability | undefined,
      deleteRequires: t.lifecycle?.delete as CrmCapability | undefined,
      attachRequires: t.lifecycle?.attach as CrmCapability | undefined,
    });
  }

  /* Tables with no query entity. Present so coverage is measured
     against everything the app holds rather than against the subset
     somebody already wired up. */
  /* What a row of a table nobody wrote a query spec for is CALLED.
     Without this every such row was previewed by its uuid, so "share it
     with Dave" asked somebody to confirm granting access to
     "7f3ac1e2-...". First column present wins, and a table with none of
     them keeps the id it always had. */
  const TITLE_BY_CONVENTION = ['full_name', 'name', 'title', 'company_name', 'stc_no', 'label'];

  for (const t of TABLES) {
    if (claimed.has(t.table)) continue;
    out.push({
      id: t.table,
      table: t.table,
      label: t.label,
      labelOne: t.label,
      addressable: false,
      titleField: TITLE_BY_CONVENTION.find((c) => t.columns.some((x) => x.name === c)),
      subtitleFields: [],
      fields: fieldsFor(t.table, t, undefined, writableByEntity.get(t.table) ?? new Map()),
      readRequires: readRequiresFor(t.table),
      createRequires: t.lifecycle?.create as CrmCapability | undefined,
      deleteRequires: t.lifecycle?.delete as CrmCapability | undefined,
      attachRequires: t.lifecycle?.attach as CrmCapability | undefined,
    });
  }

  CACHE = out;
  return out;
}

export function entity(id: string): EntityDef | undefined {
  const all = entities();
  return all.find((e) => e.id === id) ?? all.find((e) => e.table === id);
}

export function field(entityId: string, fieldName: string): FieldDef | undefined {
  return entity(entityId)?.fields.find((f) => f.field === fieldName);
}

/* -------------------------------------------------------------
   Relationships, declared.

   Hand-written on purpose, and each one records whether it is backed by
   a key. `approximate: true` is not a warning that it might be wrong,
   it is a statement that the join is by value and therefore needs a
   normalisation list and an ambiguity policy.
   ------------------------------------------------------------- */
export const RELATIONSHIPS: RelationshipDef[] = [
  {
    id: 'trailer.customer',
    from: 'trailers', to: 'contacts', cardinality: 'one',
    label: 'the customer who bought it',
    inverse: 'customer.trailers',
    approximate: true,
    /* It lands on crm_contacts, so traversing it is reading the CRM. */
    requires: ['crm.view'],
    join: {
      via: 'match',
      on: [{ local: 'customer', remote: 'company_name', op: 'eq' }],
      normalise: ['trim', 'casefold', 'collapse-space', 'strip-punctuation', 'strip-company-suffix'],
      /* One trailer has one buyer, so several matching customers means
         the CRM holds duplicates. Asking is the only honest answer. */
      onAmbiguity: 'ask',
    },
  },
  {
    id: 'customer.trailers',
    from: 'contacts', to: 'trailers', cardinality: 'many',
    label: 'trailers they have bought',
    inverse: 'trailer.customer',
    approximate: true,
    join: {
      via: 'match',
      on: [{ local: 'company_name', remote: 'customer', op: 'eq' }],
      normalise: ['trim', 'casefold', 'collapse-space', 'strip-punctuation', 'strip-company-suffix'],
      /* Many is the point here, so every match is intended. */
      onAmbiguity: 'all',
    },
  },
  {
    /* The one link between a unit and its deal that is a real foreign
       key rather than a name match. `crm_contacts.stock_trailer_id`
       points at `stock_trailers.id`, and the sales tracker has used it
       since the tracker existed. It was missing from here, so a command
       about a trailer had no declared way to reach the deal that sells
       it, which is why marking a set of units sold had nothing to
       operate on. */
    id: 'trailer.deal',
    from: 'trailers', to: 'deals', cardinality: 'one',
    label: 'the deal it is being sold on',
    inverse: 'deal.trailer',
    approximate: false,
    requires: ['crm.view'],
    join: { via: 'key', localField: 'id', remoteField: 'stock_trailer_id' },
  },
  {
    id: 'deal.trailer',
    from: 'deals', to: 'trailers', cardinality: 'one',
    label: 'the unit it is for',
    inverse: 'trailer.deal',
    approximate: false,
    join: { via: 'key', localField: 'stock_trailer_id', remoteField: 'id' },
  },
  {
    id: 'trailer.rep',
    from: 'trailers', to: 'profiles', cardinality: 'one',
    label: 'the rep who sold it',
    approximate: true,
    join: {
      via: 'match',
      on: [{ local: 'sales_rep', remote: 'full_name', op: 'eq' }],
      normalise: ['trim', 'casefold', 'collapse-space'],
      /* Two people called Dave is a real possibility and picking either
         attributes somebody else's sale. */
      onAmbiguity: 'ask',
    },
  },
  {
    id: 'contact.owner',
    from: 'contacts', to: 'profiles', cardinality: 'one',
    label: 'who owns the account',
    approximate: true,
    join: {
      via: 'match',
      on: [{ local: 'assigned_to', remote: 'full_name', op: 'eq' }],
      normalise: ['trim', 'casefold', 'collapse-space'],
      onAmbiguity: 'ask',
    },
  },
  {
    id: 'contact.lists',
    from: 'contacts', to: 'crm_lists', cardinality: 'many',
    label: 'lists it appears on',
    approximate: false,
    requires: ['crm.view'],
    // `crm_list_members` is who may SEE a list. Which companies are ON
    // one is `crm_list_contacts`, and pointing at the wrong table meant
    // "the lists Dawson appears on" answered with nothing at all.
    join: { via: 'through', table: 'crm_list_contacts', localKey: 'contact_id', remoteKey: 'list_id' },
  },
  {
    id: 'contact.addresses',
    from: 'contacts', to: 'contact_addresses', cardinality: 'many',
    label: 'its sites',
    approximate: false,
    requires: ['crm.view'],
    join: { via: 'key', localField: 'id', remoteField: 'contact_id' },
  },
  {
    id: 'contact.notes',
    from: 'contacts', to: 'contact_notes', cardinality: 'many',
    label: 'notes against it',
    approximate: false,
    requires: ['crm.view'],
    join: { via: 'key', localField: 'id', remoteField: 'contact_id' },
  },
];

export function relationship(id: string): RelationshipDef | undefined {
  return RELATIONSHIPS.find((r) => r.id === id);
}

export function relationshipsFrom(entityId: string): RelationshipDef[] {
  return RELATIONSHIPS.filter((r) => r.from === entityId);
}

/* -------------------------------------------------------------
   Capabilities.

   Deliberately small at this stage. The 149 entries in `actions.ts`
   stay where they are until they have handlers; listing them here as
   capabilities would repeat the mistake of counting declarations as
   ability. Only operations with a real route are recorded, so the
   figure is honest and grows as handlers are written.
   ------------------------------------------------------------- */
export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'data.read',
    label: 'Answer a question about records',
    operates: 'select',
    confirm: false,
    idempotent: true,
    handler: 'app/api/command/query/route.ts',
  },
  {
    id: 'record.updateField',
    label: 'Change a field on a record',
    operates: 'update',
    confirm: true,
    /* Setting a field to a value twice leaves the same value. The unmet
       gate stops it anyway, because every mutation is stopped. */
    idempotent: true,
    handler: 'lib/command/server/mutation.ts',
  },
  {
    id: 'record.create',
    label: 'Create a record',
    operates: 'create',
    confirm: true,
    /* Running it twice makes two records. */
    idempotent: false,
    produces: 'record',
    handler: 'lib/command/server/mutation.ts',
  },
  {
    id: 'record.delete',
    label: 'Delete a record',
    operates: 'delete',
    /* The one operation with no undo. Everything else this application
       does can be typed back in. */
    requires: 'crm.delete',
    confirm: true,
    idempotent: false,
    handler: 'lib/command/server/mutation.ts',
  },
  {
    id: 'contact.enrich',
    label: 'Look up a contact through Lusha',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.enrich',
    confirm: true,
    produces: 'record',
    /* Every call spends a purchased credit whether or not it finds
       anything, so running it on a sentence that was only partly
       understood costs real money for a guess. */
    idempotent: false,
    handler: 'lib/crm/enrich.ts',
    /* NOT SQL, AND NEVER CAN BE.
       An HTTP call to somebody else's service. It happens before the
       programme's transaction opens, in the same place a file is
       rendered and for the same reason, and what it finds becomes
       changes the transaction writes. See `server/prepare.ts`. */
    prepares: 'contact.enrich',
    /* The columns a lookup can fill in, so the resolver reads what is
       on the record before deciding whether it has anything to work
       from. */
    inputs: [
      { key: 'email', label: 'email address', kind: 'text', required: false, from: 'email' },
      { key: 'companyName', label: 'company name', kind: 'text', required: false, from: 'company_name' },
      { key: 'contactName', label: 'contact name', kind: 'text', required: false, from: 'contact_name' },
      /* The website lives inside `links`, not in a column of its own.
         This read `website`, which `crm_contacts` has never had, so the
         whole lookup failed on a column name nobody typed. */
      { key: 'website', label: 'website', kind: 'text', required: false, from: 'links' },
    ],
  },
  {
    id: 'rows.export',
    label: 'Put rows into a file',
    operates: 'emit',
    requires: 'crm.export',
    confirm: false,
    produces: 'artefact',
    idempotent: true,
    /* The route exists and builds the file. It does not currently check
       a capability of its own, so on the IR path the derived
       requirement is what gates it. */
    handler: 'app/api/crm/export/xlsx/route.ts',
  },
  {
    id: 'deal.markSold',
    label: 'Mark a deal sold and carry it through to the stock unit',
    operates: 'invoke',
    entities: ['deals'],
    /* The same capability the manual route gates on, because it is the
       same operation. */
    requires: 'stock.edit',
    confirm: true,
    produces: 'record',
    /* It raises a commission line and flips a stock unit. Running it
       twice is not the same as running it once. */
    idempotent: false,
    handler: 'lib/crm/mark-sold.ts',
    /* THE SALE ANSWERS FOR ITSELF.

       `command_project_sale` runs the same arithmetic
       `command_mark_sold` runs, without the writes, so the exact rows
       are known before the transaction and "mark these sold and export
       the result" holds the sale rather than the state before it.
       Migration 037. */
    projects: true,
    /* What a sale leaves on the tracker row. The commission and the
       stock unit are the operation's other two writes and are not on
       this record, so nothing here claims them. */
    /* A SALE IS NOT ONE COLUMN.

       The deal takes the status, the price and the dates the sentence
       supplied. The commission is computed from a rate this cannot see,
       and the stock unit and every other deal against it are changed
       too. The last three are declared as unpredictable rather than
       guessed, so "mark it sold and export the result" refuses if it
       would have to show any of them, instead of showing what they said
       a moment ago. */
    effect: {
      table: 'crm_contacts',
      set: {
        status: 'customer',
        sale_price: { arg: 'salePrice' },
        dispatch_date: { arg: 'dispatchDate' },
      },
      opaque: ['commission', 'profit', 'profit_pct', 'order_date'],
      /* The unit the sentence named. It goes sold, to that customer,
         under that rep. The money on it is computed from a rate this
         cannot see, so those columns are named rather than guessed. */
      via: {
        table: 'stock_trailers',
        set: { status: 'sold', sales_price: { arg: 'salePrice' } },
        opaque: ['profit', 'order_date', 'dispatch_date', 'customer', 'sales_rep'],
      },
    },
    /* A sale needs a price. Almost always the deal already carries one,
       which is why `from` is here: the operation reads it off the record
       and asks for nothing. A deal with no price anywhere is the one
       case that genuinely cannot proceed, and the preview says which
       deals those are rather than writing a sale worth nothing. */
    inputs: [
      { key: 'salePrice', label: 'sale price', kind: 'money', required: true, from: 'sale_price' },
      { key: 'dispatchDate', label: 'dispatch date', kind: 'date', required: false, from: 'dispatch_date' },
    ],
  },
  {
    id: 'stock.duplicate',
    label: 'Make a second copy of a stock unit',
    operates: 'invoke',
    entities: ['trailers'],
    /* NOT `creates`. It makes a row and it also ACTS ON one: there is
       nothing to copy without the unit somebody pointed at, and a
       capability that creates is one the runtime resolves no subjects
       for. */
    /* The same capability the Duplicate item on the stock list gates
       on, because it is the same operation: `canEdit` there is
       `stock.edit` here. */
    requires: 'stock.edit',
    confirm: true,
    produces: 'rows',
    /* Twice is two copies. That is what duplicating means. */
    idempotent: false,
    handler: 'supabase/migrations/038_duplicate_and_link.sql',
  },
  {
    id: 'deal.duplicate',
    label: 'Make a second deal for the same customer',
    operates: 'invoke',
    entities: ['deals'],
    /* Not `creates`, for the same reason as the unit above: the row it
       makes is a copy of the row it acts on. */
    /* Starting a deal, which is what every other way onto the tracker
       gates on. */
    requires: 'crm.create',
    confirm: true,
    produces: 'rows',
    idempotent: false,
    handler: 'supabase/migrations/038_duplicate_and_link.sql',
  },
  {
    id: 'deal.linkStock',
    label: 'Put a stock unit against a deal',
    operates: 'invoke',
    entities: ['deals'],
    /* Editing the deal. The unit is not changed by linking: it changes
       when the deal is sold, which is `deal.markSold`. */
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    /* Linking the same unit to the same deal twice leaves one link. */
    idempotent: true,
    handler: 'supabase/migrations/038_duplicate_and_link.sql',
    inputs: [
      {
        key: 'unit', label: 'which unit', kind: 'text', required: true,
        ask: 'Which stock unit?',
      },
    ],
  },
  {
    id: 'brand.upload',
    label: 'Put a file on the brand kit',
    operates: 'invoke',
    entities: ['brand'],
    creates: true,
    /* What the Upload button on the brand kit gates on: the table's own
       policy is admin and marketer, which is `marketing.edit`. */
    requires: 'marketing.edit',
    confirm: true,
    produces: 'record',
    /* A second upload of the same file is a second asset row. */
    idempotent: false,
    handler: 'lib/social/media.ts',
    /* The bytes are the browser's and a bucket is not a table, so the
       file is staged before the transaction and the row that points at
       it is written inside one. Exactly the shape a picture on a post
       has. */
    prepares: 'brand.upload',
    inputs: [
      { key: 'file', label: 'the file', kind: 'text', required: true },
      { key: 'kind', label: 'what kind of asset', kind: 'text', required: false },
      { key: 'category', label: 'which category', kind: 'text', required: false },
    ],
  },
  {
    id: 'list.create',
    label: 'Make a list out of these records',
    operates: 'invoke',
    entities: ['contacts'],
    /* "Make and share working lists" is what crm.manageLists means in
       permissions.ts, which is where the meeting put it. */
    requires: 'crm.manageLists',
    confirm: true,
    produces: 'record',
    /* A second run makes a second list with the same name. */
    idempotent: false,
    handler: 'supabase/migrations/012_command_create_list.sql',
    inputs: [
      { key: 'name', label: 'list name', kind: 'text', required: true },
    ],
  },
  {
    id: 'stock.sendToTracker',
    label: 'Put these units on your sales tracker',
    operates: 'invoke',
    entities: ['trailers'],
    /* The same capability the manual route gates on, because it is the
       same operation: it inserts a lead. */
    requires: 'crm.create',
    confirm: true,
    produces: 'record',
    /* A second run makes a second lead against the same unit. */
    idempotent: false,
    handler: 'supabase/migrations/020_command_tracker_operations.sql',
  },
  {
    id: 'crm.toTracker',
    label: 'Put a customer on your sales tracker',
    operates: 'invoke',
    entities: ['contacts'],
    /* Starting a deal, which is what the tracker screen's own button
       gates on. */
    requires: 'crm.create',
    confirm: true,
    produces: 'record',
    /* A second run is a second deal against the same customer, which is
       a real thing somebody may want and not the same as the first. */
    idempotent: false,
    handler: 'supabase/migrations/033_command_tracker_from_crm.sql',
    inputs: [
      { key: 'side', label: 'which side', kind: 'enum', required: false },
      { key: 'what', label: 'what they want', kind: 'text', required: false },
    ],
  },
  {
    id: 'crm.raiseProposal',
    label: 'Raise a proposal against these customers',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.proposal',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/020_command_tracker_operations.sql',
    inputs: [
      { key: 'kind', label: 'what the proposal is for', kind: 'enum', required: true },
    ],
  },
  {
    id: 'list.add',
    label: 'Put these records on an existing list',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.manageLists',
    confirm: true,
    produces: 'record',
    /* Moving records onto the list they are already on leaves them
       where they are. */
    idempotent: true,
    handler: 'supabase/migrations/015_command_add_to_list.sql',
    inputs: [
      { key: 'list', label: 'list name', kind: 'text', required: true },
    ],
  },
  {
    id: 'user.setRole',
    label: 'Change what somebody is allowed to do',
    operates: 'invoke',
    entities: ['people'],
    /* The same capability the admin screen gates on, because it is the
       same operation. */
    requires: 'admin.users',
    confirm: true,
    produces: 'record',
    /* Setting a role to what it already is raises rather than passing,
       so this is not repeatable in the sense the unmet gate means. */
    idempotent: false,
    handler: 'supabase/migrations/018_command_set_role.sql',
    effect: { table: 'profiles', set: { role: { arg: 'role' } } },
    inputs: [
      /* `shows` rather than `from`: the column is read so the preview
         can say what somebody IS as well as what they are being made,
         and it does not answer the question of what to make them. */
      {
        key: 'role', label: 'role', kind: 'enum', required: true, shows: 'role',
        ask: 'Which role? Admin, marketer, sales or viewer.',
      },
    ],
  },
  {
    id: 'news.refresh',
    label: 'Refresh the industry news',
    operates: 'invoke',
    /* It makes rows out of what fourteen feeds are carrying. There is
       nothing to act on. */
    entities: ['news_items'],
    creates: true,
    /* The same capability the button gates on. This one deletes: it
       sweeps every story past the cutoff. */
    requires: 'marketing.edit',
    confirm: true,
    produces: 'rows',
    /* Refreshing twice is the same news. It also deletes twice, which is
       the same deletion. */
    idempotent: true,
    handler: 'lib/news/refresh.ts',
    /* Fourteen HTTP calls to somebody else's servers. Not SQL, and not
       something a transaction can hold. */
    prepares: 'news.refresh',
  },
  {
    id: 'contact.addAddress',
    label: 'Add a site to a customer',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/029_customer_details.sql',
    inputs: [
      {
        key: 'address', label: 'the address', kind: 'text', required: true,
        fills: 'at %s',
      },
      { key: 'label', label: 'what the site is called', kind: 'text', required: false },
      { key: 'primary', label: 'whether it is the main one', kind: 'bool', required: false },
    ],
  },
  {
    id: 'contact.primaryAddress',
    label: 'Make an address the main one',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    /* Marking the address that is already primary changes nothing. */
    idempotent: true,
    handler: 'supabase/migrations/029_customer_details.sql',
    inputs: [
      {
        key: 'address', label: 'which address', kind: 'text', required: true,
        ask: 'Which address should be the main one?',
      },
    ],
  },
  {
    id: 'contact.addLink',
    label: 'Add a link to a customer',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    /* The function refuses a link that is already there. */
    idempotent: false,
    handler: 'supabase/migrations/029_customer_details.sql',
    inputs: [
      {
        key: 'url', label: 'the address', kind: 'text', required: true,
        ask: 'What is the web address?',
      },
      { key: 'label', label: 'what to call it', kind: 'text', required: false },
    ],
  },
  {
    id: 'contact.removeLink',
    label: 'Take a link off a customer',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/029_customer_details.sql',
    inputs: [
      { key: 'which', label: 'which link', kind: 'text', required: true },
    ],
  },
  {
    id: 'contact.link',
    label: 'Link two customer records as the same business',
    operates: 'invoke',
    entities: ['contacts'],
    requires: 'crm.edit',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/029_customer_details.sql',
    inputs: [
      { key: 'parent', label: 'the account it belongs to', kind: 'text', required: true },
    ],
  },
  {
    id: 'rows.import',
    label: 'Import a spreadsheet of customers',
    operates: 'invoke',
    entities: ['contacts'],
    /* It makes records out of a file. There is nothing to act on. */
    creates: true,
    requires: 'crm.import',
    confirm: true,
    produces: 'rows',
    /* Importing the same file twice is the same customers twice. */
    idempotent: false,
    handler: 'supabase/migrations/023_command_import.sql',
    /* Reading the file is not SQL: the browser is the only place that
       has it. The preparer parses it against the import dictionary and
       hands the database rows it has already checked. */
    prepares: 'rows.import',
    inputs: [
      { key: 'file', label: 'the file', kind: 'text', required: true },
      /* The fingerprint of what was previewed, so confirming a
         different file is a mismatch rather than a surprise. */
      { key: 'digest', label: 'the file', kind: 'text', required: true },
      { key: 'list', label: 'list name', kind: 'text', required: false },
    ],
  },
  {
    id: 'crm.findCompanies',
    label: 'Find companies that are not customers yet',
    operates: 'invoke',
    entities: ['contacts'],
    /* It makes customers out of what Lusha returned. There is nothing
       here to act on. */
    creates: true,
    /* The same capability every other Lusha call needs, which is also
       what the rollout lock switches off for everybody.

       NOT A PURCHASE. `lib/lusha.ts` is explicit that
       /prospecting/company/search is free and counts only against a
       daily call quota; a credit is spent revealing a PERSON. This
       entry said "paid" for a while and was wrong, which matters
       because the preview is the only thing anybody has to go on. */
    requires: 'crm.enrich',
    confirm: true,
    produces: 'rows',
    /* A second search is a second search against the same shared daily
       quota, and the companies it returns are inserted again. */
    idempotent: false,
    handler: 'lib/crm/finder.ts',
    /* A read of somebody else's index, which no transaction can hold
       and no rollback can take back. It is not a debit, so it does not
       go through the purchase ledger: that exists to make an
       irreversible charge recoverable and there is no charge here. It
       happens once, on confirmation, and the rows it produces go into
       the programme's own transaction through the same import a
       spreadsheet uses. */
    prepares: 'crm.findCompanies',
    inputs: [
      {
        key: 'place', label: 'where to look', kind: 'text', required: true,
        fills: 'near %s',
      },
      { key: 'city', label: 'where to look', kind: 'text', required: true, derivedFrom: 'place' },
      { key: 'count', label: 'how many', kind: 'number', required: false },
      { key: 'radius', label: 'how far', kind: 'number', required: false },
      { key: 'industry', label: 'what kind', kind: 'number', required: false },
      { key: 'industryLabel', label: 'what kind', kind: 'text', required: false },
      { key: 'minEmployees', label: 'smallest', kind: 'number', required: false },
      { key: 'maxEmployees', label: 'largest', kind: 'number', required: false },
      { key: 'list', label: 'list name', kind: 'text', required: false },
    ],
  },
  {
    id: 'post.setImage',
    label: 'Put a picture on a social post',
    operates: 'invoke',
    entities: ['posts'],
    /* The same capability the composer's upload button gates on. */
    requires: 'marketing.edit',
    confirm: true,
    produces: 'record',
    /* Putting the same file on the same post twice leaves the post with
       that picture on it, and the second upload is a second object on
       the bucket rather than a second effect anybody can see. */
    idempotent: true,
    handler: 'lib/social/media.ts',
    /* A file on a bucket and a URL in a column. The bucket cannot be in
       a transaction, so it is a preparer, and the column write goes
       into the programme's own transaction like any other. */
    prepares: 'post.setImage',
    inputs: [
      { key: 'file', label: 'the picture', kind: 'text', required: true },
    ],
  },
  {
    id: 'stock.import',
    label: 'Import a supplier stock file',
    operates: 'invoke',
    entities: ['trailers'],
    /* It makes units out of a file. There is nothing to act on. */
    creates: true,
    /* The same capability the import button on the stock screen gates
       on, which is also what the grid gates cell edits on. */
    requires: 'stock.edit',
    confirm: true,
    produces: 'rows',
    /* Loading the same file twice is the same trailers twice. */
    idempotent: false,
    handler: 'supabase/migrations/031_command_stock_import.sql',
    /* Reading the file is not SQL: the browser is the only place that
       has it. The preparer matches it against the stock dictionary, the
       same one the import dialog uses, and hands the database rows it
       has already checked against what is on the stock list. */
    prepares: 'stock.import',
    inputs: [
      { key: 'file', label: 'the file', kind: 'text', required: true },
      { key: 'digest', label: 'the file', kind: 'text', required: true },
    ],
  },
  {
    id: 'post.create',
    label: 'Write a social post',
    operates: 'invoke',
    /* The entity it MAKES. `creates` is what says there is nothing for
       it to act on, so no subject is required and none is read. */
    entities: ['posts'],
    creates: true,
    requires: 'marketing.edit',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/022_command_social_posts.sql',
    inputs: [
      {
        key: 'content', label: 'what the post says', kind: 'longtext', required: true,
        fills: 'saying "%s"',
      },
      /* Comma separated, because a plan's literals are single values and
         a post goes out on several platforms. The composer's own
         default applies when the sentence names none. */
      { key: 'platform', label: 'platforms', kind: 'text', required: false },
      { key: 'scheduledDate', label: 'the date it goes out', kind: 'date', required: false },
    ],
  },
  {
    id: 'meeting.create',
    label: 'Book a meeting',
    operates: 'invoke',
    entities: ['meetings'],
    creates: true,
    requires: 'crm.delegate',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/024_command_calendar.sql',
    /* WHEN IS ONE QUESTION AND TWO VALUES.

       A person says "next Friday at 10". The database takes one
       timestamp. The reader composes it once both halves are there, and
       until then whichever half is missing is what gets asked about:
       one of them missing asks for that one, both missing asks once. */
    inputGroups: [
      { id: 'when', ask: 'When? Say the day and the time.' },
    ],
    inputs: [
      { key: 'title', label: 'what the meeting is', kind: 'text', required: true },
      {
        key: 'day', label: 'which day', kind: 'text', required: true,
        group: 'when', ask: 'Which day?', fills: 'on %s',
      },
      {
        key: 'time', label: 'what time', kind: 'text', required: true,
        group: 'when', ask: 'What time?', fills: 'at %s',
      },
      /* The moment itself, worked out from the two above. Never asked
         for: nobody types an ISO timestamp. */
      { key: 'start', label: 'when it is', kind: 'date', required: true, derivedFrom: 'day' },
      { key: 'minutes', label: 'how long', kind: 'number', required: false },
      /* The customer it is with, when the CRM holds one by that name. A
         meeting with somebody who is not a customer is still a meeting,
         so this is optional and an unmatched name is simply not a link. */
      { key: 'contact', label: 'the customer', kind: 'text', required: false },
    ],
  },
  {
    id: 'meeting.answer',
    label: 'Answer a meeting invitation',
    operates: 'invoke',
    entities: ['meetings'],
    /* Answering an invitation you were sent is not a privilege. The
       function refuses an invitation that is not yours. */
    requires: 'crm.view',
    confirm: true,
    produces: 'record',
    idempotent: false,
    handler: 'supabase/migrations/024_command_calendar.sql',
    inputs: [
      { key: 'action', label: 'what to say', kind: 'enum', required: true },
      /* Only a counter proposal needs a time. Declaring it plainly
         required would ask for one in order to accept. */
      {
        key: 'start', label: 'the time being suggested', kind: 'date', required: false,
        requiredWhen: { arg: 'action', is: 'propose' },
        ask: 'What time do you want to suggest?',
        fills: '%s',
      },
    ],
  },
  {
    id: 'meeting.reschedule',
    label: 'Move a meeting to another time',
    operates: 'invoke',
    entities: ['meetings'],
    /* The capability the calendar itself gates booking on. */
    requires: 'crm.delegate',
    confirm: true,
    produces: 'record',
    /* Moving a meeting to the time it is already at is a no-op the
       function refuses rather than performs, because the people on it
       would be told twice. */
    idempotent: false,
    handler: 'supabase/migrations/021_command_meetings.sql',
    /* Writing the start alone leaves a meeting that ends before it
       begins. The function moves the end by the same amount, and this
       is what a chained export sees. */
    /* Both ends move, and the end moves by however much the start did,
       which is what keeps an hour long meeting an hour long. A file
       built from a moved meeting shows both, or the programme refuses. */
    effect: {
      table: 'calendar_events',
      set: {
        start_at: { arg: 'start' },
        end_at: { movedWith: { anchor: 'start_at', arg: 'start' } },
      },
    },
    /* Two ways to say when, and neither is required on its own: the
       reader supplies exactly one and the operation refuses if it gets
       neither. "Move it to Friday at 2pm" gives a moment; "move it to
       4:30" gives a clock time and the meeting keeps its own day, which
       is not something planning can know because the record has not
       been read yet. */
    /* ONE OF THE TWO, AND ASKED FOR WHEN NEITHER IS THERE.

       "Move Friday's site visit" is a whole instruction with the
       destination left off, and the reader used to throw the sentence
       away for it. The two inputs are alternatives rather than parts,
       so the question is asked only when neither arrived. */
    inputGroups: [
      { id: 'when', ask: 'When should it move to?', oneOf: true },
    ],
    inputs: [
      {
        key: 'start', label: 'new time', kind: 'date', required: false,
        /* Read for the preview, which says where it is moving FROM. It
           does not answer where it moves to. */
        shows: 'start_at', group: 'when',
      },
      { key: 'time', label: 'new time', kind: 'text', required: false, group: 'when' },
    ],
  },
  {
    id: 'meeting.invite',
    label: 'Ask somebody to a meeting',
    operates: 'invoke',
    entities: ['meetings'],
    requires: 'crm.delegate',
    confirm: true,
    produces: 'record',
    /* Inviting somebody already invited puts the invitation back with
       them, which is what the calendar's own button does. */
    idempotent: true,
    handler: 'supabase/migrations/021_command_meetings.sql',
    inputs: [
      { key: 'who', label: 'who to invite', kind: 'text', required: true },
    ],
  },
  {
    id: 'rows.share',
    label: 'Share rows with colleagues',
    operates: 'emit',
    /* "Make and share working lists" is what crm.manageLists already
       means in permissions.ts. */
    requires: 'crm.manageLists',
    confirm: true,
    /* Granting the same people the same access twice leaves the same
       access. */
    idempotent: true,
    /* Sharing in this application is list membership, which is what the
       CRM's own read policies consult. The command bar grants the same
       thing the CRM screen grants, through the same table. */
    entities: ['contacts'],
    handler: 'supabase/migrations/013_command_share_list.sql',
  },
  {
    id: 'list.share',
    label: 'Share a list with colleagues',
    operates: 'invoke',
    /* THE LIST IS THE THING, NOT THE ROWS ON IT.

       `rows.share` takes the exact set of records somebody ticked and
       refuses unless that set IS the list, which is right off a screen
       and wrong for a sentence: it made a person select every record on
       a list before they could share the list. Sharing here is list
       membership, so a named list needs no records at all.

       The entity is still `contacts`, because what a share grants is
       sight of customers. The list is how this schema expresses that. */
    entities: ['contacts'],
    /* It grants access. There is nothing on the screen to act on. */
    creates: true,
    requires: 'crm.manageLists',
    confirm: true,
    produces: 'rows',
    /* Granting the same people the same access twice leaves the same
       access. */
    idempotent: true,
    handler: 'supabase/migrations/032_command_share_named_list.sql',
    inputs: [
      { key: 'list', label: 'the list', kind: 'text', required: true },
      { key: 'users', label: 'who to share it with', kind: 'text', required: true },
    ],
  },
  {
    id: 'rows.email',
    label: 'Email rows out of the company',
    operates: 'emit',
    /* Data leaving the business is the same permission as any other
       bulk export. */
    requires: 'crm.export',
    confirm: true,
    /* An email cannot be unsent, and a second send is a second email. */
    idempotent: false,
    /* THE ONE THING HERE THAT CANNOT BE BUILT HERE.
       Everything around it is finished: the sentence is read, the
       recipients are resolved to real people by name, the permission is
       derived, the confirmation is required and the file is the same
       file an export produces. What is absent is the transport, and it
       is absent from the repository and from the environment alike:
       package.json carries no mail client of any kind, and there is no
       SMTP host, no API key and no sender address anywhere in the
       environment or in the Supabase project. Choosing a provider and
       holding its credentials is a decision for the business, not a
       gap in this layer. */
    needs: 'an outbound email transport, which this application does not have: '
      + 'no mail client in package.json, and no SMTP or provider credentials '
      + 'in the environment. A provider has to be chosen and its key held first.',
  },
  {
    id: 'record.attach',
    label: 'Attach a file to a record',
    operates: 'emit',
    /* NO CAPABILITY OF ITS OWN, AND THAT IS THE POINT.

       What it takes to attach is what it takes to write the record it
       goes on: `crm.edit` for a customer, `stock.edit` for a trailer.
       The entity declares it, the validator derives it per plan, and
       migration 028 reads the same generated table. A flat `crm.edit`
       here was the same answer only while the role bundles overlap, and
       per-user grants are exactly what the admin panel is for. */
    confirm: true,
    /* A second run leaves a second copy on the record. */
    idempotent: false,
    /* Bytes on the row, covered by the row's own policy. A bucket would
       put an export of the CRM behind a second set of access rules
       written separately from the ones on the records it is about. */
    handler: 'supabase/migrations/014_command_attachments.sql',
  },
];

export function capability(id: string): CapabilityDef | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/**
 * The capability that gates turning rows into a file.
 *
 * Separate from the destination, because building the file and deciding
 * where it goes are two different permissions. Emailing a spreadsheet
 * of the CRM needs both.
 */
export const FILE_EMIT_CAPABILITY = 'rows.export';

/* =============================================================
   Destinations

   An `Emit` was one step kind covering "put this on the screen" and
   "send this to somebody outside the company", and the difference was
   not written down anywhere. It was therefore not enforced anywhere:
   the unresolved-request gate exempted every emit, so a sentence that
   was only half understood could not update a row and could email the
   half it understood to a customer.

   The difference lives here, as data, for the same reason relationships
   do. Nothing in the parser knows the word "email".
   ============================================================= */

export type DestinationKind =
  'display' | 'download' | 'clipboard' | 'share' | 'email' | 'attach';

export type DestinationDef = {
  kind: DestinationKind;
  label: string;
  /**
   * What actually happens.
   *
   *   read      nothing leaves and nothing changes
   *   artefact  a file exists that did not exist before
   *   client    something happens in the browser and nowhere else
   *   external  it leaves the application and cannot be recalled
   *   mutation  a record changes
   */
  effect: 'read' | 'artefact' | 'client' | 'external' | 'mutation';
  /** The capability an emit to here must name. Absent means read only. */
  capability?: string;
  /** A preview and an explicit yes before it happens. */
  confirm: boolean;
  /**
   * May this run when part of the request went unresolved.
   *
   * True for the screen alone, and only because the screen can show
   * what was not understood alongside what was. Everything else is a
   * result somebody receives with no record of the question, so a
   * partial answer is indistinguishable from a complete one.
   */
  allowsUnresolved: boolean;
};

export const DESTINATIONS: Record<DestinationKind, DestinationDef> = {
  display: {
    kind: 'display', label: 'On screen', effect: 'read',
    confirm: false,
    /* Allowed, but never as a completed command. See `completion`. */
    allowsUnresolved: true,
  },
  clipboard: {
    kind: 'clipboard', label: 'On your clipboard', effect: 'client',
    /* DECLARED, RATHER THAN PRETENDED.

       "Copy the navy hex" is a question with one more thing done to the
       answer, and the browser is the only place that can do it: no
       server anywhere can write to somebody's clipboard. The old answer
       was an action that opened the brand kit and called that copying,
       which is navigation wearing the word.

       So it is a destination with its own effect. The plan says the
       answer goes on the clipboard, the reader knows it changes
       nothing, and the browser carries it out. Nothing about it is a
       write, so it needs no capability beyond reading what it copies
       and no confirmation. */
    confirm: false,
    /* A partial answer copied is indistinguishable from a complete one
       once it is in somebody's paste buffer. */
    allowsUnresolved: false,
  },
  download: {
    kind: 'download', label: 'As a file to download', effect: 'artefact',
    capability: 'rows.export', confirm: false, allowsUnresolved: false,
  },
  share: {
    kind: 'share', label: 'Shared with colleagues', effect: 'external',
    capability: 'rows.share', confirm: true, allowsUnresolved: false,
  },
  email: {
    kind: 'email', label: 'Emailed out', effect: 'external',
    capability: 'rows.email', confirm: true, allowsUnresolved: false,
  },
  attach: {
    kind: 'attach', label: 'Attached to a record', effect: 'mutation',
    capability: 'record.attach', confirm: true, allowsUnresolved: false,
  },
};

export function destination(kind: string): DestinationDef | undefined {
  return DESTINATIONS[kind as DestinationKind];
}

/* -------------------------------------------------------------
   Coverage, for the metrics the audit defined. Computed, never
   asserted, so the figures cannot drift from the registry.
   ------------------------------------------------------------- */
export function coverage() {
  const es = entities();
  const fields = es.flatMap((e) => e.fields).filter((f) => f.role !== 'system');
  return {
    entities: es.length,
    entitiesAddressable: es.filter((e) => e.addressable).length,
    fields: fields.length,
    filterable: fields.filter((f) => f.filterable).length,
    groupable: fields.filter((f) => f.groupable).length,
    aggregatable: fields.filter((f) => f.aggregatable).length,
    writable: fields.filter((f) => f.writable).length,
    clearable: fields.filter((f) => f.clearable).length,
    relationships: RELATIONSHIPS.length,
    relationshipsApproximate: RELATIONSHIPS.filter((r) => r.approximate).length,
    capabilities: CAPABILITIES.length,
    capabilitiesWithHandler: CAPABILITIES.filter((c) => c.handler).length,
  };
}
