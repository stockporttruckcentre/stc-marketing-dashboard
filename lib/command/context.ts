/* =============================================================
   "This customer", "these", "the ones I have selected".

   Half of what people type at a bar that sits above a screen is about
   what is on that screen. Typing the company name again when it is open
   in front of you is the sort of thing that makes somebody stop using
   the bar and go back to clicking.

   WHAT A CONTEXT WORD MEANS IS A FACT, NOT A GUESS.

   It resolves to explicit typed references: an entity, a set of record
   ids, and how many the sentence meant. Never "whatever is open": the
   screen SENDS what it has, the server receives it as part of the
   request, and every id in it is read back through the actor's own
   session before anything is done with it. A context the server did not
   receive is a context that does not exist, and one it received but
   cannot see through row level security narrows to nothing rather than
   widening to everything.

   THE CARDINALITY COMES FROM THE WORD.

   "This customer" is one record and "these" is however many are
   selected. A sentence that says one and finds three is an ambiguity to
   raise, exactly as it is when somebody types half a company name.
   ============================================================= */
import type { Cardinality, Cond, Expr } from './ir/types';
import { ENTITIES } from './schema';
import { MANY_WORDS, ONE_WORDS } from './pointing';

/**
 * What the screen has, sent with the sentence.
 *
 * Every field is optional because a screen may have none of it. What is
 * absent is absent: nothing here is filled in from the last request.
 */
export type CommandContext = {
  /** The record the screen has open, from its own URL. */
  record?: { entity: string; id: string; label?: string };
  /** The rows somebody has ticked. */
  selection?: { entity: string; ids: string[] };
  /**
   * The working list the screen has open.
   *
   * Not the same fact as a selection. A CRM screen with nothing ticked
   * still has a list open, and "share this list with Dave" is about the
   * list rather than about any rows on it. Like every other piece of
   * context the browser supplies it and the server decides what it
   * means: the id is read back through the caller's own session before
   * anything is granted.
   */
  list?: { id: string; name: string };
  /**
   * A file somebody attached to the bar.
   *
   * Context, like a selection: the browser supplies it, the server
   * decides what it means. Nothing about the file's contents reaches
   * the plan except its `digest`, which is what makes previewing one
   * file and confirming another a mismatch rather than a surprise.
   */
  file?: { name: string; mime: string; size: number; text: string };
};

/**
 * A short fingerprint of a file's contents.
 *
 * FNV-1a, in plain arithmetic, because this runs in the browser as well
 * as on the server and pulling a crypto implementation into the reader
 * for the sake of a change detector would be the wrong trade. It is not
 * a security boundary: the server re-reads the file it is given on both
 * passes, and this only has to notice that the file changed.
 */
export function fileDigest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}-${text.length.toString(16)}`;
}

export const EMPTY_CONTEXT: CommandContext = {};

/* -------------------------------------------------------------
   The words
   ------------------------------------------------------------- */

/* The words themselves are `pointing.ts`, so the clause reader and the
   create reader cannot disagree with this one about what points at
   something. */
const THIS_WORDS: readonly string[] = ONE_WORDS;
const THESE_WORDS: readonly string[] = MANY_WORDS;

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

export type ContextReference = {
  kind: 'record' | 'selection';
  /** The words that named it, for the summary. */
  words: string;
  /** How many the sentence meant, from the word rather than the count. */
  expect: Cardinality;
};

/**
 * Did the sentence point at the screen?
 *
 * "These" on its own is enough, because a plural pointing word with
 * nothing after it can only mean the selection. "This" needs a noun,
 * since "this" alone is not a record: "set this to Bredbury" is a
 * sentence about a field with a missing value, not about a trailer.
 */
export function readContextReference(text: string): ContextReference | null {
  const t = soften(text);

  const these = THESE_WORDS
    .filter((w) => t.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (these) return { kind: 'selection', words: these, expect: 'many' };

  const nouns = ENTITIES.flatMap((e) => e.nouns);
  for (const word of THIS_WORDS) {
    if (!t.includes(` ${word} `)) continue;
    /* A noun after the pointing word, or "record" for anything.

       EVERY OCCURRENCE, NOT THE FIRST.

       "Add this image to this post" points twice and only the second
       one names a record. Looking at the first alone found "image",
       which is not a noun for anything, and the sentence came back
       pointing at nothing at all. */
    const parts = t.split(` ${word} `).slice(1);
    for (const after of parts) {
      const first = after.trim().split(' ')[0] ?? '';
      if (first === 'record' || first === 'one' || nouns.includes(first)) {
        return { kind: 'record', words: `${word} ${first}`.trim(), expect: 'one' };
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------
   What it resolves to
   ------------------------------------------------------------- */

export type ResolvedContext = {
  entity: string;
  ids: string[];
  expect: Cardinality;
  /** The condition, over ids and nothing else. */
  match: Cond;
  label: string;
};

const field = (entity: string, name: string): Expr =>
  ({ kind: 'field', of: { entity, field: name } });

/**
 * The reference, as a condition over record ids.
 *
 * Ids and nothing else. A context that resolved to a name or a filter
 * could match a record nobody was looking at, and the whole point of
 * pointing at the screen is that the answer is the thing on it.
 *
 * `null` when the screen has nothing to point at, which is a sentence
 * that cannot be carried out rather than one that means everything.
 */
export function resolveContext(
  reference: ContextReference,
  context: CommandContext,
  /** The entity the sentence is about, when it named one. */
  wanted?: string,
): ResolvedContext | null {
  const source = reference.kind === 'record'
    ? (context.record ? { entity: context.record.entity, ids: [context.record.id] } : null)
    : (context.selection?.ids.length ? context.selection : null);

  if (!source || !source.ids.length) return null;

  /* A sentence that names an entity and points at a different one is
     not a sentence about either. "Move these trailers" with customers
     selected is somebody who has changed screen since they ticked. */
  if (wanted && wanted !== source.entity) return null;

  const values = source.ids.map((id) => ({ kind: 'literal' as const, value: id }));
  const match: Cond = values.length === 1
    ? { kind: 'cmp', op: 'eq', left: field(source.entity, 'id'), right: values[0] }
    : { kind: 'in', of: field(source.entity, 'id'), values };

  return {
    entity: source.entity,
    ids: source.ids,
    expect: reference.expect,
    match,
    label: reference.kind === 'record'
      ? (context.record?.label ?? 'the open record')
      : `the ${source.ids.length} you have selected`,
  };
}
