/* =============================================================
   Sharing a list somebody named.

     share Fleet Prospects with Dave
     give Tom access to the Hyde Prospects list
     share the Fleet Prospects list with Dave and Tom

   WHY THIS IS NOT THE DESTINATION READER.

   "Share these with Dave" is an output clause: a selection on the
   screen, sent somewhere. `output.ts` reads it, `rows.share` performs
   it, and the database refuses unless the selection IS the whole list,
   because there is no record level grant in this schema to do the
   narrow thing with.

   "Share Fleet Prospects with Dave" names no records at all. Reading it
   through the destination reader made the sentence mean "every trailer,
   shared with Dave": the list name was dropped, the entity fell back to
   trailers, and the plan was not representable. Worse, the honest way to
   satisfy the old shape was to make somebody select every record on the
   list first, and selecting ninety nine of a hundred is a refusal.

   Sharing in this application IS list membership, so a named list needs
   no records. This reads the name and the people, and the list itself is
   resolved in the database, exactly: none refuses by name, one is used,
   several asks.
   ============================================================= */
import type { Expr, Invoke } from './ir/types';
import { capability } from './ir/registry';
import type { CommandContext } from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type SharePlanning = {
  step: Invoke;
  summary: string;
  requires: string;
  confidence: number;
};

/** Words that mean "let somebody else see this". */
const SHARE_WORDS = ['share', 'give access to', 'grant access to', 'give', 'grant'];

/** How the people are named after the list. */
const WITH_WORDS = ['with', 'to'];

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9.'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tidy = (s: string) =>
  s.trim().replace(/^(?:the|my|our|that|this)\s+/i, '').replace(/[.,;]+$/, '').trim();

/** Pointing words name the screen, not a list. */
const POINTS_AT_SCREEN =
  /^(?:this|that|these|those|it|them|the|crm|all|everything|everyone|everybody)$/i;

/**
 * A LIST SAID OUT LOUD.
 *
 * "The Fleet Prospects list", or "list called Fleet Prospects". Either
 * way round, because people write it both ways.
 */
function listNamed(raw: string): string | null {
  const before = raw.match(/\b(.{2,60}?)\s+list\b/i)?.[1];
  const after = raw.match(/\blist\s+(?:called\s+|named\s+)?(.{2,60}?)\s*$/i)?.[1];
  const name = before !== undefined || after !== undefined
    ? tidy(before ?? after ?? '') : null;
  if (!name) return null;
  if (POINTS_AT_SCREEN.test(name)) return null;
  return name.length >= 2 ? name : null;
}

/**
 * A NAME WITH NO WORD "LIST" NEXT TO IT.
 *
 * "Share Fleet Prospects with Dave" is how people actually write it, and
 * requiring the word "list" would be a syntax rule rather than a
 * meaning. What it must NOT swallow is a described set: "share the sold
 * trailers with Dave" selects rows and shares whatever list they are all
 * on, which is the destination reader's job and a different operation.
 *
 * So the test is whether the words describe a set. If the question
 * reader can make a query out of them they are a description, and this
 * leaves them alone. "Fleet Prospects" is not a query, and a list is the
 * only thing in this application it could be.
 */
function bareName(raw: string): string | null {
  const name = tidy(raw);
  if (!name || name.length < 3) return null;
  if (POINTS_AT_SCREEN.test(name)) return null;
  /* A name with a pointing word in it is pointing. */
  if (/\b(?:these|those|them|selected|ticked|highlighted)\b/i.test(name)) return null;
  return name;
}

/** Everybody the sentence named, split on the ways people write "and". */
function peopleIn(said: string): string[] {
  return said
    .split(/\s*(?:,|\band\b|&|\+)\s*/i)
    .map((s) => s.trim().replace(/[.,;]+$/, ''))
    .filter((s) => s.length >= 2 && !/^(?:the|a|an)$/i.test(s));
}

function personRef(name: string): Expr {
  return {
    kind: 'reference',
    entity: 'people',
    where: {
      kind: 'or',
      of: [
        {
          kind: 'cmp', op: 'contains',
          left: { kind: 'field', of: { entity: 'people', field: 'full_name' } },
          right: { kind: 'literal', value: name },
        },
        {
          kind: 'cmp', op: 'eq',
          left: { kind: 'field', of: { entity: 'people', field: 'email' } },
          right: { kind: 'literal', value: name },
        },
      ],
    },
    select: 'id',
    onAmbiguity: 'ask',
  };
}

export function parseShareList(
  raw: string,
  caps: CrmCapabilities | undefined,
  context: CommandContext = {},
  opts: {
    /**
     * Whether a name with no word "list" beside it counts.
     *
     * False on the first pass, so the general reader gets first refusal
     * on "share the sold trailers with Dave". True on the second, which
     * only runs when the general reader could not make a whole sentence
     * of it, and the words are therefore a name rather than a
     * description. See `plan.ts`.
     */
    bareName?: boolean;
  } = {},
): SharePlanning | null {
  const text = raw.trim();
  if (text.length < 8) return null;
  if (text.endsWith('?')) return null;

  const t = soften(text);
  const verb = SHARE_WORDS.filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const cap = capability('list.share');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* Two shapes, and both are ordinary English:

       share <list> with <people>
       give <people> access to <list>

     The second is read by looking for the list on the far side of the
     preposition, which is where its name always is. */
  let listPart: string | null = null;
  let whoPart: string | null = null;

  for (const prep of WITH_WORDS) {
    const split = text.match(new RegExp(
      `\\b${escape(verb)}\\b\\s+(.{2,80}?)\\s+\\b${escape(prep)}\\b\\s+(.{2,80}?)\\s*[.;]?\\s*$`,
      'i',
    ));
    if (!split) continue;

    /* Whichever side says "list" is the list. "Give Dave access to the
       Fleet Prospects list" puts the people first. */
    /* "SHARE THIS LIST WITH DAVE" IS THE LIST ON THE SCREEN.

       A pointing word names what somebody is looking at, and a CRM
       screen with nothing ticked still has a list open. Without this
       the sentence had nothing to point at and was read as a share of
       whatever happened to be selected, which is a different set. */
    const pointsAtOpen = (part: string) =>
      /\b(?:this|that|the current|the open)\s+(?:crm\s+)?list\b/i.test(part)
      || /^\s*(?:this|that|it)\s*$/i.test(part.trim());

    const left = listNamed(split[1]);
    const right = listNamed(split[2]);
    if (context.list && pointsAtOpen(split[1])) {
      listPart = context.list.name; whoPart = split[2];
    }
    else if (context.list && pointsAtOpen(split[2])) {
      listPart = context.list.name; whoPart = split[1];
    }
    else if (right) { listPart = right; whoPart = split[1]; }
    else if (left) { listPart = left; whoPart = split[2]; }
    else {
      /* Nobody said the word. The thing being shared is whatever came
         first, as long as it is a name rather than a description. */
      const bare = opts.bareName ? bareName(split[1]) : null;
      if (bare) { listPart = bare; whoPart = split[2]; }
    }
    if (listPart) break;
  }

  if (!listPart || !whoPart) return null;

  /* "access to" is how the second shape reads, and the word is not part
     of anybody's name. */
  /* WHO IS AN INPUT, NOT RECOGNITION.

     The shape of the sentence, a list and somebody to share it with,
     is what says this is a share. Whether the words after "with" turn
     out to be a name this can resolve is a different question: "share
     the Fleet Prospects list with the team" names no person, and
     throwing the sentence away for it said the bar had not understood
     a sentence it had read completely. The capability declares `users`
     required and the question is asked where every other one is. */
  const people = peopleIn(whoPart.replace(/\b(?:access|permission|sight|rights?)\b/gi, '').trim());

  const step: Invoke = {
    op: 'invoke',
    id: 'sh1',
    capability: 'list.share',
    args: {
      list: { kind: 'literal', value: listPart },
      /* Always a list, even for one person. The operation takes a set of
         people and an argument whose shape depends on how many were
         named is two operations wearing one name. */
      ...(people.length ? { users: { kind: 'list' as const, of: people.map(personRef) } } : {}),
    },
    produces: { kind: 'rows', entity: 'contacts' },
  };

  return {
    step,
    summary: people.length
      ? `Share the ${listPart} list with ${people.join(' and ')}`
      : `Share the ${listPart} list`,
    requires: cap.requires,
    confidence: 13,
  };
}
