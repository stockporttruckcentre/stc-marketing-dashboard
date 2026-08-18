/* =============================================================
   Business operations a sentence can ask for.

     send STC143580 to my tracker
     put these units on my sales tracker
     raise a proposal for Dawson Group
     raise a maintenance proposal for these customers
     enrich Dawson Group

   THE READER IS ONE READER, OVER THE CAPABILITY REGISTRY.

   Each of these was a route with a button in front of it. What they
   have in common is the shape: a verb, a set of records, and sometimes
   one value the records do not hold. That is exactly what a capability
   declares, so this reads the verb, resolves the records the same way
   every other reader does, and takes the value from the declared
   inputs.

   Adding an operation is a row in `OPERATIONS` and a capability with
   its `inputs`. It is not a function here.

   WHAT IT WILL NOT DO.

   Guess which records. Every one of these writes, so the records come
   from a reference the sentence made, or from the screen, or from the
   clause before. A sentence that names none of those is not read as
   "all of them".
   ============================================================= */
import type { Cond, Expr, Invoke } from './ir/types';
import { capability, entity as entityDef } from './ir/registry';
import { readRecordRefs } from './mutate';
import {
  readContextReference, resolveContext, type CommandContext,
} from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type OperationPlan = {
  step: Invoke;
  summary: string;
  requires: string;
  confidence: number;
};

/**
 * How a sentence asks for each operation.
 *
 * `verbs` and `objects` both have to appear, which is what stops "send
 * the customers in Hyde to Dave" being read as sending a unit to a
 * tracker: it says nothing about a tracker.
 */
const OPERATIONS: {
  capability: string;
  /** The entity the sentence names, which is what gets resolved. */
  entity: string;
  verbs: string[];
  /** A word that says WHICH operation, not just that something happens. */
  objects: string[];
  /** In words, for the preview. */
  label: (n: number, what: string, argument: string) => string;
  /** A declared input read out of the sentence. */
  argument?: {
    key: string;
    /** Value to the words that mean it. */
    values: { value: string; words: string[] }[];
    /** Used when the sentence names none of them. */
    fallback: string;
  };
}[] = [
  {
    capability: 'stock.sendToTracker',
    entity: 'trailers',
    verbs: ['send', 'put', 'add', 'move', 'push'],
    objects: ['tracker', 'sales tracker', 'my tracker', 'the tracker'],
    label: (n, what) => `Put ${what} on your sales tracker`,
  },
  {
    capability: 'crm.raiseProposal',
    entity: 'contacts',
    verbs: ['raise', 'create', 'make', 'start', 'open', 'send', 'do', 'put'],
    objects: ['proposal', 'proposals', 'quote', 'quotes', 'quotation'],
    label: (n, what, kind) => `Raise a ${kind === 'trailer_sales' ? '' : `${kind} `}proposal for ${what}`,
    argument: {
      key: 'kind',
      values: [
        { value: 'trailer_sales', words: ['trailer', 'trailers', 'sales', 'sale', 'unit'] },
        { value: 'maintenance', words: ['maintenance', 'service', 'servicing', 'repair', 'workshop'] },
        { value: 'rental', words: ['rental', 'rent', 'hire'] },
        { value: 'refurb', words: ['refurb', 'refurbishment', 'respray', 'paint'] },
      ],
      /* What the business means when nobody says: the tracker's own
         default side. */
      fallback: 'trailer_sales',
    },
  },
  {
    capability: 'contact.enrich',
    entity: 'contacts',
    verbs: ['enrich', 'look up', 'lookup', 'find details for', 'fill in', 'top up'],
    objects: ['lusha', 'details', 'contact details', 'enrichment', 'enrich'],
    label: (n, what) => `Look ${what} up in Lusha`,
  },
];

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9£$€.,/:@'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The records the sentence names, however it names them. */
function subjectOf(
  raw: string, entity: string, context: CommandContext, priorResult?: { entity: string },
): { where: Cond | null; label: string } | null {
  /* The screen, or the clause before. */
  const pointed = readContextReference(raw);
  const fromScreen = pointed ? resolveContext(pointed, context, entity) : null;
  if (fromScreen) return { where: fromScreen.match, label: fromScreen.label };
  if (!pointed && priorResult?.entity === entity) return { where: null, label: 'them' };
  if (pointed && priorResult?.entity === entity) return { where: null, label: 'them' };

  /* A stock reference, for anything identified that way. */
  const refs = readRecordRefs(raw);
  const named = [...refs.stc, ...refs.coded];
  const def = entityDef(entity);
  const title = def?.titleField;
  if (named.length && title === 'stc_no') {
    return {
      where: named.length === 1
        ? {
            kind: 'cmp', op: 'eq',
            left: { kind: 'field', of: { entity, field: title } },
            right: { kind: 'literal', value: named[0] },
          }
        : {
            kind: 'or',
            of: named.map((n) => ({
              kind: 'cmp' as const, op: 'eq' as const,
              left: { kind: 'field' as const, of: { entity, field: title } },
              right: { kind: 'literal' as const, value: n },
            })),
          },
      label: named.join(' and '),
    };
  }

  return null;
}

/**
 * A company name, for an operation aimed at customers.
 *
 * Everything after the object word and the connecting preposition,
 * which is where a name sits in "raise a proposal for Dawson Group".
 */
function companyIn(raw: string, objects: string[]): string | null {
  for (const object of objects) {
    const at = raw.toLowerCase().indexOf(object);
    if (at < 0) continue;
    const after = raw.slice(at + object.length)
      .replace(/^\s*(?:for|against|to|on|with|about)\s+/i, ' ')
      .replace(/[^A-Za-z0-9&'. -]+/g, ' ')
      .trim();
    const words = after.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) continue;
    const name = words.join(' ').trim();
    if (name.length >= 2) return name;
  }
  return null;
}

export function parseOperation(
  raw: string,
  caps: CrmCapabilities | undefined,
  context: CommandContext,
  priorResult?: { entity: string },
): OperationPlan | null {
  const t = soften(raw);

  for (const op of OPERATIONS) {
    if (!op.verbs.some((v) => t.includes(` ${v} `))) continue;
    if (!op.objects.some((o) => t.includes(` ${o} `) || t.includes(` ${o}s `))) continue;

    const cap = capability(op.capability);
    if (!cap || !cap.requires) continue;
    /* Nothing you cannot do is ever offered. */
    if (caps && !caps.has(cap.requires)) continue;
    /* Nor anything nothing performs. */
    if (!cap.handler) continue;

    const subject = subjectOf(raw, op.entity, context, priorResult);
    const named = subject ? null : companyIn(raw, op.objects);

    let where: Cond | null = subject?.where ?? null;
    let label = subject?.label ?? '';

    if (!subject) {
      if (!named) continue;
      const def = entityDef(op.entity);
      const title = def?.titleField;
      if (!title) continue;
      where = {
        kind: 'cmp', op: 'contains',
        left: { kind: 'field', of: { entity: op.entity, field: title } },
        right: { kind: 'literal', value: named },
      };
      label = named;
    }

    /* The declared input, read out of the sentence. */
    const args: Record<string, Expr> = {};
    if (op.argument) {
      const said = op.argument.values
        .flatMap((v) => v.words.map((w) => ({ value: v.value, w })))
        .filter((x) => t.includes(` ${x.w} `))
        .sort((a, b) => b.w.length - a.w.length)[0];
      args[op.argument.key] = {
        kind: 'literal',
        value: said?.value ?? op.argument.fallback,
      };
    }

    return {
      step: {
        op: 'invoke',
        id: 'o1',
        capability: op.capability,
        /* One when a single record was named, so "raise a proposal for
           Dawson" with two Dawsons asks rather than raising two. */
        ...(named ? { expect: 'one' as const } : {}),
        subject: {
          op: 'select',
          from: { entity: op.entity },
          ...(where ? { where } : {}),
          produces: { kind: 'rows', entity: op.entity },
        },
        ...(Object.keys(args).length ? { args } : {}),
        produces: { kind: 'record', entity: op.entity },
      },
      summary: op.label(1, label, String(
        (args[op.argument?.key ?? ''] as { value?: unknown } | undefined)?.value ?? '',
      )).replace(/\s+/g, ' ').trim(),
      requires: cap.requires,
      confidence: 13,
    };
  }

  return null;
}
