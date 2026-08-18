/* =============================================================
   Making a record, and getting rid of one.

   The third and fourth things that happen to a row. Changing one has
   had a reader since the command bar could write at all; creating and
   deleting went through hand written intents, one per entity, each with
   its own slots and its own route branch:

     create_prospect          a contact
     create_stock_trailer     a trailer
     create_proposal          a contact with different columns

   Three handlers for one idea, and nothing at all for the entities
   nobody had got round to.

   THIS IS ONE READER OVER THE REGISTRY.

   An entity's own nouns say which table, its title field says what the
   name goes in, and the writable dictionary says what else a sentence
   may fill in. Adding an entity adds both sentences.

     create a lead for Smith Logistics
     add a new customer called Dawson Group
     new trailer STC142345
     delete STC143580
     cancel Friday's site visit

   WHAT IT WILL NOT DO.

   Delete a set. "Delete the sold trailers" is a sentence this reads and
   refuses, because a described set is exactly where a wrong word costs
   the most and there is no undo. A deletion names its record.

   Nor will it delete when a FIELD was named: "delete the customer on
   STC143580" empties a column and is the clear the instruction reader
   already handles. The difference is whether a field was named, which
   is a question the writable dictionary answers.
   ============================================================= */
import { entity as entityDef } from './ir/registry';
import { ENTITIES } from './schema';
import { WRITABLE_FIELDS } from './fields';
import type { Cond, Mutate } from './ir/types';
import { capability } from './ir/registry';
import {
  EMPTY_CONTEXT, readContextReference, resolveContext, type CommandContext,
} from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type LifecyclePlan = {
  op: 'create' | 'delete';
  entity: string;
  /** The canonical step, ready for the plan. */
  step: Mutate;
  /** Plain English, shown before anything happens. */
  summary: string;
  /** The capability the whole thing needs. */
  requires: string;
  confidence: number;
};

/* -------------------------------------------------------------
   Words
   ------------------------------------------------------------- */

export const CREATE_WORDS = [
  'create', 'add', 'new', 'make', 'open', 'raise', 'start', 'set up', 'register', 'log',
];

export const DELETE_WORDS = [
  'delete', 'remove', 'get rid of', 'bin', 'bin off', 'drop', 'cancel', 'call off',
];

/** Words between the verb and the name that are not part of either. */
const FILLER = [
  'a', 'an', 'the', 'new', 'record', 'entry', 'row', 'called', 'named', 'for', 'to',
  'in', 'on', 'up', 'please', 'me', 'us', 'off', 'of',
  /* Where the record is going, which is not part of its name. "Add
     trailer STC142345 to stock" was creating a trailer called
     "STC142345 to stock", and "add Dawson Group as a prospect" a
     customer called "Dawson Group as". */
  'as', 'stock', 'list', 'crm', 'system', 'database', 'tracker', 'onto', 'into',
];

/**
 * Words that point at a record rather than naming a new one.
 *
 * The same words `context.ts` reads a selection from. A name holding one
 * of them is a sentence about something that already exists.
 */
const POINTING = new Set([
  'this', 'that', 'these', 'those', 'them', 'it', 'they', 'their', 'theirs',
  'him', 'her', 'his', 'hers', 'my', 'mine', 'our', 'ours', 'selected',
]);

/** Every word that names a thing rather than one of its columns. */
const ENTITY_NOUNS = new Set(ENTITIES.flatMap((e) => e.nouns));

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9£$€.,/:@'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which entity a sentence is about, by its own declared nouns.
 *
 * The same nouns the question reader uses, so "customer", "lead" and
 * "proposal" mean here exactly what they mean when somebody asks a
 * question about them.
 */
function entityFrom(text: string): { id: string; noun: string } | null {
  const t = soften(text);
  let best: { id: string; noun: string } | null = null;
  for (const e of ENTITIES) {
    for (const noun of e.nouns) {
      if (!t.includes(` ${noun} `)) continue;
      if (!best || noun.length > best.noun.length) best = { id: e.id, noun };
    }
  }
  return best;
}

/**
 * The name a new record is being given.
 *
 * Everything after the verb and the entity noun, with the filler taken
 * out. Deliberately not clever: a company is called whatever somebody
 * types, and a reader that tries to be selective about it drops the
 * second half of "Smith Logistics Ltd".
 */
function nameFrom(text: string, noun: string, verb: string): string | null {
  const stripped = text
    .replace(new RegExp(`\\b${escape(verb)}\\b`, 'i'), ' ')
    .replace(new RegExp(`\\b${escape(noun)}\\b`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = stripped.split(/\s+/).filter(Boolean);
  while (words.length && FILLER.includes(words[0].toLowerCase())) words.shift();
  while (words.length && FILLER.includes(words[words.length - 1].toLowerCase())) words.pop();

  /* A name, not a sentence. "Find customers with more than 20 trailers
     who haven't had a proposal this year" was read as creating a
     customer called all of that, because nothing bounded it. Six words
     is longer than any real company name in this database and shorter
     than any clause. */
  if (words.length > 6) return null;

  /* A NAME DOES NOT POINT AT ANYTHING.

     "Add their LinkedIn profile to this account" was read as creating a
     customer called "their LinkedIn profile to this", which is a
     sentence about a record already on the screen. A pointing word
     inside a name means the sentence is about something that exists,
     and this is not the reader for it. */
  if (words.some((w) => POINTING.has(w.toLowerCase()))) return null;

  const name = words.join(' ').replace(/[.,:;]+$/, '').trim();
  return name.length >= 2 ? name : null;
}

/** A word that means every match, rather than one record. */
const COLLECTIVE = /\b(all|every|any|each|everything|the lot)\b/;

/** A record reference, which is what a deletion has to name. */
function referenceFrom(text: string): string | null {
  const stc = text.match(/\bSTC\s?\d{3,}\b/i);
  if (stc) return stc[0].replace(/\s+/g, '').toUpperCase();
  return null;
}

/**
 * The writable dictionary entry for an entity's own title.
 *
 * Matched by TABLE, because two entities can be two readings of one
 * table and only one of them tends to appear in the dictionary.
 */
function writableEntityFor(entityId: string): string | null {
  const table = entityDef(entityId)?.table;
  if (!table) return null;
  const owner = WRITABLE_FIELDS.find((f) => entityDef(f.entity)?.table === table);
  return owner?.entity ?? null;
}

function writableFor(entityId: string, title: string) {
  const table = entityDef(entityId)?.table;
  return WRITABLE_FIELDS.find((f) => f.entity === entityId && f.key === title)
    ?? WRITABLE_FIELDS.find((f) => entityDef(f.entity)?.table === table && f.key === title)
    ?? WRITABLE_FIELDS.find((f) => entityDef(f.entity)?.table === table)
    ?? null;
}

/* -------------------------------------------------------------
   The reader
   ------------------------------------------------------------- */

/**
 * "Put these on the Fleet Prospects list."
 *
 * The other half of the same job. `list.create` makes a new one; this
 * moves records onto one somebody already has, which is what the CRM
 * screen's move-to-list menu does and what no sentence could reach.
 *
 * The name goes into the plan as words, and the list is resolved inside
 * the transaction that does the move. Resolving it here would put a
 * uuid in the plan, and a list renamed between the preview and the
 * confirmation could then end up with somebody's customers on it.
 */
function readListAdd(
  raw: string, caps: CrmCapabilities | undefined, context: CommandContext,
  priorResult?: { entity: string },
): LifecyclePlan | null {
  const t = soften(raw);
  if (!/\blist\b/.test(t)) return null;
  /* A create wins. "Create a list called X from these" makes a list;
     "add these to the X list" moves them onto one. Both contain "add". */
  if (/\b(?:create|make|start|set up|new)\b/.test(t)) return null;
  if (!/\b(?:add|move|put|stick|file)\b/.test(t)) return null;

  const cap = capability('list.add');
  if (!cap || !cap.requires) return null;
  if (caps && !caps.has(cap.requires)) return null;

  const pointed = readContextReference(raw);
  const from = pointed ? resolveContext(pointed, context, 'contacts') : null;
  const fromClause = !from && priorResult?.entity === 'contacts';
  if (!from && !fromClause) return null;

  /* The list's name, said either way round: "onto the Fleet Prospects
     list" and "onto the list called Fleet Prospects". */
  const named = raw.match(/\b(?:to|onto|on|into|in)\s+(?:the\s+)?(?:list\s+(?:called|named)\s+)?(.{2,60}?)\s*(?:\blist\b)?\s*[.;]?\s*$/i)?.[1]?.trim()
    ?? raw.match(/\blist\s+(?:called|named)\s+(.{2,60}?)\s*[.;]?\s*$/i)?.[1]?.trim();

  return {
    op: 'create',
    entity: 'contacts',
    step: {
      op: 'invoke',
      id: 'l1',
      capability: 'list.add',
      subject: from
        ? {
            op: 'select',
            from: { entity: 'contacts' },
            where: from.match,
            produces: { kind: 'rows', entity: 'contacts' },
          }
        : { entity: 'contacts' },
      ...(named ? { args: { list: { kind: 'literal' as const, value: named } } } : {}),
      produces: { kind: 'record', entity: 'contacts' },
    } as unknown as Mutate,
    summary: named
      ? `Put ${from?.label ?? 'them'} on the ${named} list`
      : `Put ${from?.label ?? 'them'} on a list`,
    requires: cap.requires,
    confidence: 12,
  };
}

/**
 * "Make a list of these, called Tipper prospects."
 *
 * A business operation rather than a create, because it is two writes
 * where the second needs the first: the list has to exist before
 * anything can go in it. The orchestrator refuses that shape by design,
 * and the answer is to put the ordered pair somewhere that can order
 * it, which is `command_create_list`.
 *
 * The records come from the screen, which is where a list is made from
 * in practice: you tick some rows and you want them together. The name
 * is a declared input on the capability, read here and reported as
 * missing by the runtime if the sentence did not give one.
 */
function readListCreate(
  raw: string, caps: CrmCapabilities | undefined, context: CommandContext,
  priorResult?: { entity: string },
): LifecyclePlan | null {
  const t = soften(raw);
  if (!/\b(list|group|set)\b/.test(t)) return null;
  if (!CREATE_WORDS.some((w) => t.includes(` ${w} `))) return null;

  const cap = capability('list.create');
  if (!cap || !cap.requires) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* The records come from the screen, or from the clause before.
     "Make a list of these" points at a selection; "create a list from
     them" points at what the sentence just found, and which rows that
     is gets decided at execution rather than here. */
  const pointed = readContextReference(raw);
  const from = pointed ? resolveContext(pointed, context, 'contacts') : null;
  const fromClause = !from && priorResult?.entity === 'contacts';
  if (!from && !fromClause) return null;

  /* The name, from the words after "called" or "named". Not guessed
     from the rest of the sentence: a list nobody named is a list nobody
     will find again, and the runtime says so rather than inventing one. */
  /* The name stops where the sentence starts saying WHERE the records
     come from. Without that, "create a list called Fleet Prospects from
     them" named the list "Fleet Prospects from them", and the preview
     read "Make a list called Fleet Prospects from them from them". */
  const named = raw
    .match(/\b(?:called|named|titled)\s+(.{2,60}?)(?:\s+(?:from|out of|using|containing|with)\s.*)?$/i)
    ?.[1]?.trim();

  return {
    op: 'create',
    entity: 'contacts',
    step: {
      /* An invoke wearing the lifecycle reader's return type, because
         what it produces is a plan step either way. */
      op: 'invoke',
      id: 'l1',
      capability: 'list.create',
      /* A placeholder the composer replaces with a reference to the
         clause before, when there is one. */
      subject: from
        ? {
            op: 'select',
            from: { entity: 'contacts' },
            where: from.match,
            produces: { kind: 'rows', entity: 'contacts' },
          }
        : { entity: 'contacts' },
      ...(named ? { args: { name: { kind: 'literal' as const, value: named } } } : {}),
      produces: { kind: 'record', entity: 'contacts' },
    } as unknown as Mutate,
    summary: named
      ? `Make a list called ${named} from ${from?.label ?? 'them'}`
      : `Make a list from ${from?.label ?? 'them'}`,
    requires: cap.requires,
    confidence: 12,
  };
}

export function parseLifecycle(
  input: string, caps?: CrmCapabilities, context: CommandContext = EMPTY_CONTEXT,
  priorResult?: { entity: string },
): LifecyclePlan | null {
  const raw = input.trim();
  if (raw.length < 5) return null;
  if (raw.endsWith('?')) return null;
  if (/^\s*(how|what|which|who|when|where|why|is there|are there|do we|did we)\b/i.test(raw)) return null;

  const t = soften(raw);

  /* A named FIELD means this is a change to a column, whatever verb is
     in front of it. "Delete the customer on STC143580" empties a
     column; "delete STC143580" gets rid of the unit.

     An alias that is also an ENTITY noun does not count. "Customer" is
     a column on a trailer and the word people use for the thing itself,
     so "add a new customer called Dawson Group" looked like a field
     write and was refused. Which of the two it is depends on whether
     the sentence is about that entity, and it is: it named it. */
  const namesAField = WRITABLE_FIELDS.some((f) => {
    if (caps && !caps.has(f.capability)) return false;
    return f.aliases.some((a) => t.includes(` ${a} `) && !ENTITY_NOUNS.has(a));
  });

  /* Making a list out of what is on the screen, before the plain
     create, because "create a list from these" names an entity noun
     ("list" is not one) and would otherwise fall through. */
  /* Moving onto a list somebody has, before making a new one. Both
     shapes contain "add", and "add these to the Fleet Prospects list"
     read as a create because the create reader looked at the verb and
     not at the preposition. */
  const list = readListAdd(raw, caps, context, priorResult)
    ?? readListCreate(raw, caps, context, priorResult);
  if (list) return list;

  const deleteVerb = DELETE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (deleteVerb && !namesAField) {
    /* One named record first. A set is only ever the records somebody
       has in front of them. */
    return readDelete(raw, deleteVerb, caps)
      ?? readBulkDelete(raw, deleteVerb, caps, context);
  }

  const createVerb = CREATE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (createVerb && !namesAField) return readCreate(raw, createVerb, caps);

  return null;
}

function readCreate(raw: string, verb: string, caps?: CrmCapabilities): LifecyclePlan | null {
  const found = entityFrom(raw);
  if (!found) return null;

  const def = entityDef(found.id);
  const title = def?.titleField;
  if (!def || !title) return null;

  /* THE ENTITY THAT OWNS THE COLUMNS, NOT THE ONE THE WORD NAMED.

     `deals` and `contacts` are two readings of `crm_contacts`, and the
     writable dictionary holds one of them. A create aimed at the
     reading rather than at the table produced a step writing a column
     the registry says is not writable, and the plan was refused as
     malformed. */
  const target = writableEntityFor(found.id) ?? found.id;

  /* The capability to create is the capability to write the entity's
     own title, which the writable dictionary already states.

     By table, not by entity id. `deals` and `contacts` are two ways of
     reading `crm_contacts`, and only one of them appears in the
     writable dictionary, so "create a new lead" found no field to take
     a column from and came back as a question. */
  const spec = writableFor(target, title);
  if (!spec) return null;

  /* WHAT IT TAKES TO MAKE ONE, not what it takes to write its name.
     Creating a customer is `crm.create`; writing `company_name` on one
     that already exists is `crm.edit`, and a role can hold the second
     without the first. */
  const requires = entityDef(target)?.createRequires ?? def.createRequires;
  if (!requires) return null;
  if (caps && !caps.has(requires)) return null;

  const name = nameFrom(raw, found.noun, verb);
  if (!name) return null;

  const set: NonNullable<Mutate['set']> = [{
    field: { entity: target, field: title },
    to: { kind: 'literal', value: name },
  }];

  /* THE NOUN OFTEN SAYS WHAT KIND OF RECORD IT IS.

     "Create a new lead" and "add a customer" both insert a row into
     crm_contacts, and the word that named the entity is also a value of
     its status column. Taking it from the same vocabulary the question
     reader narrows on means the two agree about what a lead is. */
  const state = WRITABLE_FIELDS.find((f) =>
    f.entity === target && f.kind === 'enum' && f.vocabulary
    && Object.keys(f.vocabulary).includes(found.noun)
    && (!caps || caps.has(f.capability)));
  if (state?.vocabulary) {
    set.push({
      field: { entity: target, field: state.key },
      to: { kind: 'literal', value: state.vocabulary[found.noun] },
    });
  }

  const step: Mutate = {
    op: 'create',
    id: 'c1',
    target: { entity: target },
    set,
    produces: { kind: 'record', entity: target },
  };

  return {
    op: 'create',
    entity: target,
    step,
    summary: `Create ${def.labelOne} ${name}`,
    requires,
    /* A verb, an entity and a name. Anything less does not get here. */
    confidence: 11,
  };
}

/**
 * "Delete all 12 selected test leads."
 *
 * A described set is still refused: "delete the sold trailers" is one
 * wrong word away from the worst thing this application could do, and
 * the words describe rows nobody has looked at. Records ON THE SCREEN
 * are different. Somebody ticked them, they can see them, and the
 * sentence can state how many there are.
 *
 * THE COUNT IN THE SENTENCE IS CHECKED AGAINST THE SELECTION.
 *
 * "Delete all 12 selected test leads" with nine ticked is somebody
 * working from a screen that has moved under them, and it is refused
 * rather than run over the nine. Where the sentence gives no number the
 * selection still decides, and the preview names every record.
 *
 * A refusal is not the finished functionality. What makes this safe is
 * that the records are the ones in front of the person, the count is
 * agreed, and the confirmation is a stronger one than an ordinary
 * write's.
 */
function readBulkDelete(
  raw: string, verb: string, caps: CrmCapabilities | undefined, context: CommandContext,
): LifecyclePlan | null {
  const pointed = readContextReference(raw);
  if (!pointed || pointed.kind !== 'selection') return null;

  const from = resolveContext(pointed, context);
  if (!from) return null;

  const def = entityDef(from.entity);
  const title = def?.titleField;
  if (!def) return null;

  const requires = def.deleteRequires;
  if (!requires) return null;
  if (caps && !caps.has(requires)) return null;

  /* A number in the sentence has to be the number on the screen. */
  const said = raw.match(/\b(\d{1,5})\b/)?.[1];
  if (said && Number(said) !== from.ids.length) return null;

  const step: Mutate = {
    op: 'delete',
    id: 'd1',
    expect: 'many',
    target: { entity: from.entity },
    match: {
      op: 'select',
      from: { entity: from.entity },
      where: from.match,
      produces: { kind: 'rows', entity: from.entity },
    },
    produces: { kind: 'rows', entity: from.entity },
  };

  return {
    op: 'delete',
    entity: from.entity,
    step,
    summary: `Delete ${from.ids.length} ${from.ids.length === 1 ? def.labelOne : def.label}, `
      + 'and there is no undo',
    requires,
    /* Below a plain named delete, so a sentence that names one record
       is never read as a set. */
    confidence: 12,
  };
}

function readDelete(raw: string, verb: string, caps?: CrmCapabilities): LifecyclePlan | null {
  const found = entityFrom(raw);
  const reference = referenceFrom(raw);

  /* A WORD THAT MEANS EVERY MATCH IS NOT A RECORD NAME.

     "Delete all the sold trailers" came back as a deletion of a record
     called "all the sold", which matches nothing and is harmless
     exactly once. There is no undo here, so a deletion names one record
     and a sentence that describes a set is refused rather than read as
     well as it can be. */
  if (!reference && COLLECTIVE.test(soften(raw))) return null;

  /* One record, named. A described set is refused: there is no undo,
     and "delete the sold trailers" is one wrong word away from the
     worst thing this application could do. */
  const entityId = reference ? 'trailers' : found?.id;
  if (!entityId) return null;

  /* A MEETING IS NOT NAMED THE WAY EVERY OTHER RECORD IS.

     "Cancel Friday's site visit" gives a day and a description, and
     reading it here produced a meeting called "Friday's site". Meetings
     have their own reader, which runs before this one. */
  if (entityId === 'meetings') return null;

  const def = entityDef(entityId);
  const title = def?.titleField;
  if (!def || !title) return null;

  /* WHAT IT TAKES TO DELETE ONE, not what it takes to write its name.
     This used to read the writable dictionary entry for the title
     column, which for a customer is `company_name` and therefore
     `crm.edit`. A marketer may edit every field on a customer and
     delete nothing. */
  const requires = def.deleteRequires;
  if (!requires) return null;
  if (caps && !caps.has(requires)) return null;

  const name = reference ?? (found ? nameFrom(raw, found.noun, verb) : null);
  if (!name) return null;

  const match: Cond = {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: entityId, field: title } },
    right: { kind: 'literal', value: name },
  };

  const step: Mutate = {
    op: 'delete',
    id: 'd1',
    expect: 'one',
    target: { entity: entityId },
    match: {
      op: 'select',
      from: { entity: entityId },
      where: match,
      produces: { kind: 'rows', entity: entityId },
    },
    produces: { kind: 'rows', entity: entityId },
  };

  return {
    op: 'delete',
    entity: entityId,
    step,
    summary: `Delete ${def.labelOne} ${name}`,
    requires,
    confidence: reference ? 13 : 11,
  };
}
