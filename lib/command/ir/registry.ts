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
import type { ProducesKind } from './types';

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
 * There is deliberately no `first` and no `closest`. A relationship
 * that silently picks one of several matching customers produces a
 * confident wrong answer, and a confident wrong answer is the failure
 * this whole architecture exists to stop. If the caller wants every
 * match they say so with `all`; otherwise the plan stops and asks, or
 * refuses.
 */
export type AmbiguityPolicy =
  /** Stop and ask which one. The default for anything user facing. */
  | 'ask'
  /** Refuse the step. For writes, where asking is not safe enough. */
  | 'fail'
  /** Every match is intended, as in a one-to-many traversal. */
  | 'all';

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

export type CapabilityDef = {
  id: string;
  label: string;
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
    });
  }

  /* Tables with no query entity. Present so coverage is measured
     against everything the app holds rather than against the subset
     somebody already wired up. */
  for (const t of TABLES) {
    if (claimed.has(t.table)) continue;
    out.push({
      id: t.table,
      table: t.table,
      label: t.label,
      labelOne: t.label,
      addressable: false,
      subtitleFields: [],
      fields: fieldsFor(t.table, t, undefined, writableByEntity.get(t.table) ?? new Map()),
      readRequires: readRequiresFor(t.table),
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
    join: { via: 'through', table: 'crm_list_members', localKey: 'contact_id', remoteKey: 'list_id' },
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
    handler: 'app/api/command/edit/route.ts',
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
    handler: 'app/api/lusha/enrich/route.ts',
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
    /* Declared, not built. Nothing in this application shares a result
       yet, and recording a handler that does not exist is how a
       registry starts lying about what the product can do. */
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
  },
  {
    id: 'record.attach',
    label: 'Attach a file to a record',
    operates: 'emit',
    requires: 'crm.edit',
    confirm: true,
    idempotent: false,
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

export type DestinationKind = 'display' | 'download' | 'share' | 'email' | 'attach';

export type DestinationDef = {
  kind: DestinationKind;
  label: string;
  /**
   * What actually happens.
   *
   *   read      nothing leaves and nothing changes
   *   artefact  a file exists that did not exist before
   *   external  it leaves the application and cannot be recalled
   *   mutation  a record changes
   */
  effect: 'read' | 'artefact' | 'external' | 'mutation';
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
    relationships: RELATIONSHIPS.length,
    relationshipsApproximate: RELATIONSHIPS.filter((r) => r.approximate).length,
    capabilities: CAPABILITIES.length,
    capabilitiesWithHandler: CAPABILITIES.filter((c) => c.handler).length,
  };
}
