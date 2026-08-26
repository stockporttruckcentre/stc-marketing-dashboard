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
  fileDigest, readContextReference, resolveContext, type CommandContext,
} from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';
import { referenceMatchAny } from './ir/conditions';

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
  /**
   * An input that is simply the rest of the sentence.
   *
   * An address, a URL, a name: things nobody can enumerate and nobody
   * would want to. Everything after the word that named the operation,
   * with the record it is about taken out.
   */
  tail?: { key: string; after: string[]; kind?: 'url' };
  /**
   * An input that names ANOTHER record.
   *
   * "Link STC143580 to this deal" is about two rows: the deal it acts
   * on and the unit it puts against it. The second one is read the way
   * every other stock reference in this application is read, by its
   * stock number, and it becomes a `reference` expression so the
   * runtime resolves it against the caller's own rows and ASKS when two
   * match. Nothing here picks one.
   */
  names?: {
    key: string;
    entity: string;
    field: string;
    /**
     * How the sentence says which record.
     *
     * `code` is a stock number, which is how this application names a
     * unit. `after` is a name following one of a few words, which is
     * how it names anything else: "link Dawson Maintenance TO Dawson
     * Group".
     */
    by: 'code' | 'after';
    after?: string[];
  };
  /**
   * An operation that names no records.
   *
   * Refreshing the news makes rows out of what fourteen feeds are
   * carrying. There is nothing to resolve and nothing to point at, which
   * is different from a sentence that forgot to say.
   */
  subjectless?: boolean;
  /**
   * An operation whose subject matter is the file on the request.
   *
   * Like an import: with nothing attached the sentence is somebody
   * about to attach something, and reading it as an instruction would
   * produce a refusal where the right answer is the composer. The file
   * reaches the plan as its name and a digest, never its contents.
   */
  needsFile?: boolean;
}[] = [
  {
    capability: 'stock.sendToTracker',
    entity: 'trailers',
    verbs: ['send', 'put', 'add', 'move', 'push'],
    objects: ['tracker', 'sales tracker', 'my tracker', 'the tracker'],
    label: (n, what) => `Put ${what} on your sales tracker`,
  },
  {
    capability: 'crm.toTracker',
    entity: 'contacts',
    /* "Pull this customer onto my tracker" and "put Dawson on my
       tracker". The object words are the tracker, exactly as they are
       for sending a unit from stock; what differs is the entity, and a
       customer and a trailer cannot be confused for one another. */
    verbs: ['pull', 'put', 'add', 'move', 'copy', 'send', 'bring', 'take'],
    objects: ['tracker', 'sales tracker', 'my tracker', 'the tracker', 'my deals'],
    label: (n, what) => `Put ${what} on your sales tracker`,
    argument: {
      key: 'side',
      values: [
        { value: 'trailer_sales', words: ['trailer', 'trailers', 'sales', 'sale', 'unit'] },
        { value: 'maintenance', words: ['maintenance', 'service', 'servicing', 'repair', 'workshop'] },
      ],
      fallback: 'trailer_sales',
    },
  },
  {
    capability: 'crm.raiseProposal',
    entity: 'contacts',
    /* "Generate a proposal" is what the CRM's own button is called, and
       without the verb the sentence was read as generating a FILE. */
    verbs: ['raise', 'create', 'make', 'start', 'open', 'send', 'do', 'put',
            'generate', 'produce', 'draw up', 'prepare'],
    /* A contract is what the tracker calls a proposal that has been
       agreed. Both raise the same quoted row on the same side of the
       business, which is what the CRM screen's button does. */
    objects: ['proposal', 'proposals', 'quote', 'quotes', 'quotation',
              'contract', 'contracts'],
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
    capability: 'contact.addAddress',
    entity: 'contacts',
    verbs: ['add', 'put', 'record', 'register', 'create', 'new'],
    objects: ['site', 'sites', 'address', 'addresses', 'depot', 'yard', 'premises'],
    label: (n, what) => `Add a site to ${what}`,
    /* Everything after the object word is the address itself. */
    tail: { key: 'address', after: ['site', 'address', 'depot', 'yard', 'premises'] },
  },
  {
    capability: 'contact.primaryAddress',
    entity: 'contacts',
    verbs: ['make', 'set', 'mark'],
    objects: ['main address', 'primary address', 'head office', 'main site',
              'primary site', 'registered address'],
    label: (n, what) => `Make that the main address on ${what}`,
    tail: { key: 'address', after: ['main address', 'primary address', 'head office'] },
  },
  {
    capability: 'contact.addLink',
    entity: 'contacts',
    verbs: ['add', 'put', 'attach', 'record', 'save'],
    objects: ['link', 'links', 'website', 'web site', 'linkedin', 'linkedin profile',
              'facebook', 'instagram', 'twitter', 'url'],
    label: (n, what) => `Add a link to ${what}`,
    /* A link is recognisable by shape rather than by position: "add
       their linkedin profile to this account linkedin.com/company/x"
       has the word twice and only one of them is the address. */
    tail: { key: 'url', after: [], kind: 'url' },
  },
  {
    capability: 'contact.removeLink',
    entity: 'contacts',
    verbs: ['remove', 'delete', 'take off', 'drop', 'get rid of'],
    objects: ['link', 'links', 'website', 'linkedin', 'facebook', 'instagram'],
    label: (n, what) => `Take a link off ${what}`,
    tail: { key: 'which', after: ['link', 'website', 'linkedin', 'facebook', 'instagram'] },
  },
  {
    capability: 'news.refresh',
    /* It makes rows out of what the feeds are carrying. `subjectless`
       says there is nothing to name, which is why it is the one entry
       here that does not resolve records. */
    entity: 'news_items',
    subjectless: true,
    verbs: ['refresh', 'update', 'fetch', 'pull', 'reload', 'sync', 'get'],
    objects: ['news', 'news feed', 'news feeds', 'industry news', 'headlines',
              'stories', 'articles', 'feeds'],
    label: () => 'Refresh the industry news',
  },
  {
    capability: 'post.setImage',
    entity: 'posts',
    needsFile: true,
    verbs: ['add', 'put', 'attach', 'set', 'use', 'upload'],
    objects: ['image', 'picture', 'photo', 'graphic', 'artwork', 'image on this post',
              'picture on this post'],
    label: (n, what) => `Put this picture on ${what}`,
  },
  {
    capability: 'stock.duplicate',
    entity: 'trailers',
    verbs: ['duplicate', 'copy', 'clone', 'repeat'],
    /* The word that says WHICH operation is the noun for the thing
       being copied, because the verb alone is also how somebody copies
       a hex colour to the clipboard. */
    objects: ['unit', 'units', 'trailer', 'trailers', 'stock unit', 'stock',
              'stocklist', 'stock list'],
    label: (n, what) => `Make another stock unit from ${what}`,
  },
  {
    capability: 'deal.duplicate',
    entity: 'deals',
    verbs: ['duplicate', 'copy', 'clone', 'repeat'],
    objects: ['deal', 'deals', 'tracker row', 'tracker line', 'opportunity',
              'enquiry', 'quote'],
    label: (n, what) => `Make another deal from ${what}`,
  },
  {
    capability: 'deal.linkStock',
    entity: 'deals',
    verbs: ['link', 'attach', 'assign', 'put', 'add', 'set', 'against'],
    objects: ['deal', 'deals', 'tracker row', 'tracker line', 'opportunity'],
    label: (n, what) => `Put that stock unit against ${what}`,
    /* The unit, by its stock number, resolved by the runtime. */
    names: { key: 'unit', entity: 'trailers', field: 'stc_no', by: 'code' },
  },
  {
    capability: 'brand.upload',
    entity: 'brand',
    subjectless: true,
    needsFile: true,
    verbs: ['upload', 'add', 'put', 'save', 'store'],
    /* "The brand kit" has to be said. Without it, "upload this logo"
       and "add this image" are the same words the composer uses for a
       picture on a post, and the two would take each other's
       sentences. */
    objects: ['brand kit', 'brand assets', 'brand library', 'brand'],
    label: () => 'Put this file on the brand kit',
    argument: {
      key: 'kind',
      values: [
        { value: 'logo', words: ['logo', 'logos', 'emblem', 'wordmark'] },
        { value: 'font', words: ['font', 'fonts', 'typeface'] },
        { value: 'template', words: ['template', 'templates', 'artwork file'] },
        { value: 'image', words: ['image', 'images', 'picture', 'photo', 'graphic'] },
      ],
      /* What the screen's own upload menu calls anything else. */
      fallback: 'image',
    },
  },
  {
    capability: 'contact.link',
    entity: 'contacts',
    verbs: ['link', 'merge', 'connect', 'tie', 'join', 'attach'],
    /* What makes it this operation rather than a link on an account:
       the sentence says the two records are one business. */
    objects: ['same account', 'same business', 'same company', 'same customer',
              'one account', 'same group', 'main account', 'parent account'],
    label: (n, what) => `Link ${what} to the main account`,
    /* The account they all belong to, by name. Absent means the
       sentence did not say which one is the main one, and the
       capability's required input turns that into the question. */
    names: {
      key: 'parent', entity: 'contacts', field: 'company_name', by: 'after',
      after: ['to', 'under', 'into', 'onto', 'with'],
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
      // On the digits, so however the prefix is written it still finds
      // the unit. Migration of habits, not of data.
      where: referenceMatchAny(entity, title, named),
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

/**
 * Everything after the word that named the operation.
 *
 * The connecting words in front of it go, and so does the record's own
 * name when the sentence gave one, because "add a site to Dawson Group
 * at 4 Ashton Road" names the customer and the address in one breath.
 */
/**
 * The address in a sentence, by its shape.
 *
 * A link is recognisable rather than positional. Deliberately narrow:
 * something with a dot and a domain-looking end, so "4 Ashton Road" and
 * "e.g." are not links.
 */
function urlIn(raw: string): string | null {
  const m = raw.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,;]*)?/i);
  if (!m) return null;
  const url = m[0].replace(/[.,;]+$/, '');
  return url.length >= 4 ? url : null;
}

/**
 * The record a sentence acts on, when it names two.
 *
 * "Link Dawson Maintenance to Dawson Group" has the subject in front of
 * the joining word and the other record behind it. Everything between
 * the verb and that word, which is where a name sits in this shape.
 */
function nameBefore(raw: string, verbs: string[], after: string[]): string | null {
  const lower = raw.toLowerCase();
  for (const verb of verbs) {
    const at = lower.indexOf(` ${verb} `) >= 0 ? lower.indexOf(` ${verb} `) + verb.length + 2
      : lower.startsWith(`${verb} `) ? verb.length + 1 : -1;
    if (at < 0) continue;
    for (const word of after) {
      const to = lower.indexOf(` ${word} `, at);
      if (to < 0) continue;
      const name = raw.slice(at, to)
        .replace(/[^A-Za-z0-9&'. -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const words = name.split(' ').filter(Boolean);
      if (!words.length || words.length > 5) continue;
      if (name.length >= 2) return name;
    }
  }
  return null;
}

/**
 * A record named after a joining word.
 *
 * "Link Dawson Maintenance to Dawson Group as the main account" names
 * two companies and one of them is the parent. The word in front of it
 * says which: everything after "to" is the account the rest belong to.
 *
 * Deliberately narrow. It stops at the words that describe the
 * operation rather than the record, so "as the main account" is not
 * part of anybody's name, and a phrase longer than five words is not a
 * company name at all.
 */
function nameAfter(raw: string, after: string[], objects: string[]): string | null {
  /* SAID THE OTHER WAY ROUND.

     "Dawson Group is the main account" names the parent without any
     joining word in front of it, and it is how somebody answers the
     question this operation asks. Read first, because a sentence
     holding both shapes means this one. */
  const declared = raw.match(
    /\b([A-Za-z0-9&'. -]{2,60}?)\s+(?:is|should be|will be)\s+the\s+(?:main|parent|top|primary)\b/i,
  )?.[1];
  if (declared) {
    /* Everything up to and including the words that named the
       operation belongs to the instruction rather than to the company:
       "link these two as the same account, Dawson Group is the main
       one" has the name only in the last clause. */
    let head = declared;
    for (const object of objects) {
      const at = head.toLowerCase().lastIndexOf(object);
      if (at >= 0) head = head.slice(at + object.length);
    }
    const name = head.replace(/^[\s,;:.]+/, '').replace(/\s+/g, ' ').trim();
    const words = name.split(' ').filter(Boolean);
    /* The last few words, because the sentence in front of this clause
       is the rest of the instruction. */
    if (words.length) return words.slice(-4).join(' ');
  }

  for (const word of after) {
    const at = raw.toLowerCase().lastIndexOf(` ${word} `);
    if (at < 0) continue;
    let rest = raw.slice(at + word.length + 2);
    /* The words that say which operation this is come off, wherever
       they sit: "to Dawson Group as the same account". */
    for (const object of objects) {
      const said = rest.toLowerCase().indexOf(object);
      if (said >= 0) rest = rest.slice(0, said);
    }
    const name = rest
      .replace(/\b(?:as|the|a|an|its|their|main|parent|top|primary)\b/gi, ' ')
      .replace(/[^A-Za-z0-9&'. -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = name.split(' ').filter(Boolean);
    if (!words.length || words.length > 5) continue;
    if (name.length >= 2) return name;
  }
  return null;
}

function tailOf(
  raw: string, after: string[], named: string | null, pointed?: string | null,
): string | null {
  let best: string | null = null;
  for (const word of after) {
    const at = raw.toLowerCase().lastIndexOf(word);
    if (at < 0) continue;
    const rest = raw.slice(at + word.length)
      .replace(/^\s*(?:for|on|to|of|at|is|as|:|,)\s*/i, ' ')
      .trim();
    if (rest.length >= 3 && (!best || rest.length < best.length)) best = rest;
  }
  if (!best) return null;

  let out = best;
  const drop = (phrase: string) => {
    out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  };
  if (named) drop(named);
  /* AND THE WORDS THAT POINTED AT IT.

     "Add another site to this customer" put "this customer" in the
     address, so the sentence looked complete and was about to file the
     words somebody used to point at a record as the address of a new
     one. A pointing phrase names the record exactly as a company name
     does, and comes out for the same reason. */
  if (pointed) drop(pointed);
  out = out.replace(/^\s*(?:for|on|to|of|at|is|as|:|,|and)\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    .trim();
  return out.length >= 3 ? out : null;
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
    /* Nor an operation about a file, with no file on the request. */
    if (op.needsFile && !context.file?.text) continue;

    const subject = op.subjectless ? null : subjectOf(raw, op.entity, context, priorResult);

    /* A SENTENCE THAT POINTS AT THE SCREEN NAMES NOTHING ELSE.

       "Put these on my tracker as a maintenance deal" points at a
       selection of customers. Read against the operation that sends
       trailers, the pointing resolved to nothing, and the fallback
       then read "as a maintenance deal" as a company name and sent a
       unit called that. Somebody who pointed at the screen pointed at
       the screen: if it does not hold what this operation is about,
       this is not the operation. */
    const points = op.subjectless ? null : readContextReference(raw);
    const named = subject || op.subjectless || points
      ? null
      /* A SENTENCE THAT NAMES TWO RECORDS NAMES THIS ONE FIRST.

         "Link Dawson Maintenance to Dawson Group" is about Dawson
         Maintenance, and the ordinary company reader looks AFTER the
         word that named the operation, which is where the other one
         is. */
      : (op.names?.by === 'after'
          ? nameBefore(raw, op.verbs, op.names.after ?? [])
          : null)
        ?? companyIn(raw, op.objects);

    let where: Cond | null = subject?.where ?? null;
    let label = subject?.label ?? '';

    if (!subject && !op.subjectless) {
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

    /* An input that is the rest of the words. Taken from after the word
       that named the operation, with the customer's own name removed so
       "add a site to Dawson Group at 4 Ashton Road" does not file the
       company name as part of the address. */
    /* A VALUE NOBODY TYPED IS A QUESTION, NOT A SENTENCE NOBODY CAN
       READ.

       "Add their LinkedIn profile to this account" says which
       operation, which record and which kind of link. The only thing
       absent is the address itself. This used to give up on the whole
       sentence, so the bar answered a perfectly clear instruction with
       "I could not tell what you meant", and the person who typed it
       had no idea what to add.

       So the step is produced without the input. The capability
       declares it required, `completion` sees it missing, and the
       meaning comes back as a question with nothing running behind it.
       `planOneClause` holds that reading in case a later one reads the
       whole sentence, which is what keeps "add a note to this site" a
       field write. */
    if (op.tail) {
      const said = op.tail.kind === 'url'
        ? urlIn(raw)
        : tailOf(raw, op.tail.after, named, points?.words ?? null);
      if (said) args[op.tail.key] = { kind: 'literal', value: said };
    }
    /* ANOTHER RECORD, NAMED THE WAY THIS APPLICATION NAMES IT.

       A stock number, turned into a reference the runtime resolves. It
       is deliberately NOT resolved here: this reader has no store, and
       a reference carries `onAmbiguity: 'ask'` so two units matching is
       a question rather than a guess. Absent means the sentence did not
       say which, which the capability's required input turns into a
       question of its own. */
    if (op.names) {
      const said = op.names.by === 'code'
        ? [...readRecordRefs(raw).stc, ...readRecordRefs(raw).coded][0]
        : nameAfter(raw, op.names.after ?? [], op.objects);
      if (said) {
        args[op.names.key] = {
          kind: 'reference',
          entity: op.names.entity,
          where: {
            kind: 'cmp',
            /* A stock number is exact and a company name is how
               somebody would say it out loud. Two matches on a name is
               a question, which is what `onAmbiguity` is for. */
            op: op.names.by === 'code' ? 'eq' : 'contains',
            left: { kind: 'field', of: { entity: op.names.entity, field: op.names.field } },
            right: { kind: 'literal', value: said },
          },
          select: 'id',
          onAmbiguity: 'ask',
        };
      }
    }

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

    /* The file, as its name and a digest. Its contents never reach the
       plan: that is what makes previewing one file and confirming
       another a mismatch rather than a surprise. */
    if (op.needsFile && context.file) {
      args.file = { kind: 'literal', value: context.file.name };
      args.digest = { kind: 'literal', value: fileDigest(context.file.text) };
    }

    return {
      step: {
        op: 'invoke',
        id: 'o1',
        capability: op.capability,
        /* One when a single record was named, so "raise a proposal for
           Dawson" with two Dawsons asks rather than raising two. */
        ...(named ? { expect: 'one' as const } : {}),
        ...(op.subjectless ? {} : {
          subject: {
            op: 'select' as const,
            from: { entity: op.entity },
            ...(where ? { where } : {}),
            produces: { kind: 'rows' as const, entity: op.entity },
          },
        }),
        ...(Object.keys(args).length ? { args } : {}),
        /* WHAT IT PRODUCES IS THE CAPABILITY'S TO SAY.

           This used to declare a record whatever the operation was, and
           an operation that makes many, refreshing the news out of
           fourteen feeds, was fatally malformed: the validator saw a
           step claiming one record and a capability producing rows. It
           planned, it was permitted, and it could never run. */
        produces: {
          kind: cap.produces === 'rows' ? 'rows' as const : 'record' as const,
          entity: op.entity,
        },
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
