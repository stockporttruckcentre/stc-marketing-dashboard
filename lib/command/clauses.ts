/* =============================================================
   One sentence, several clauses, one programme.

     find customers with more than 20 trailers who haven't had a
     proposal this year, create a list called Fleet Prospects from them,
     export it to Excel and share it with Dave

   That is one thing somebody wants, and reading it as three independent
   commands loses the only part that matters: "them" and "it" are the
   result of the clause before. Three commands would reparse "export it
   to Excel" against nothing and answer a question about the word "it".

   WHAT THIS DOES AND DOES NOT DO.

   It splits. That is all. Each clause goes to the readers that were
   already there, and the only thing this adds is the wiring: clause two
   consumes clause one's result through a `ResultRef`, which the IR has
   had since it was designed and nothing produced.

   The joining words are generated from small groups rather than listed,
   for the usual reason: somebody will write "then", somebody else will
   write "and then", and a table of phrasings is stale the day it is
   written.

   A CLAUSE THAT NAMES NOTHING IS NOT A CLAUSE.

   "Trailers at Hyde and Bredbury" is one selection with two places in
   it, not two commands, and splitting it would produce a question about
   Hyde and a question about Bredbury. So a split only happens where the
   part after the joining word begins with something that could START a
   command: a verb this application knows. Everything else stays where
   it is.
   ============================================================= */

import { DESTINATION_VERBS, FILE_VERBS } from './output';
import { CREATE_WORDS, DELETE_WORDS } from './lifecycle';
import { CLEAR_WORDS, MOVE_WORDS, SET_WORDS } from './mutate';
import { FIND_VERBS } from './finder';

/** What joins two clauses. Order matters: longest first. */
const JOINERS = [
  'and then',
  'then',
  ', and',
  ',',
  ' and ',
];

/**
 * Verbs that can begin a clause.
 *
 * DERIVED, NOT LISTED. Every word comes from the reader that responds to
 * it: the output reader's file verbs and destination verbs, the
 * lifecycle reader's create and delete words, the instruction reader's
 * set, clear and move words, and the finder's search verbs.
 *
 * The first version said it was taken from the readers and was actually
 * a hand copy of them, which is the same failure as a lookup table of
 * phrasings: it was already missing words the readers had, and a new
 * operation would have been unchainable until somebody remembered to
 * come back here. Now an operation whose verb a reader knows is
 * chainable the day it lands.
 *
 * Only the first word of each entry, because this asks whether a
 * fragment BEGINS a clause. "Set up" and "get rid of" contribute "set"
 * and "get".
 */

/**
 * Words the readers treat as verbs that cannot open a clause.
 *
 * Small and explicit, because it is a statement about English rather
 * than about this application: these are the entries in the derived
 * lists that are grammar rather than instruction.
 */
const NOT_A_CLAUSE_START = new Set([
  'is', 'are', 'to', 'now', 'should', 'equals', 'any', 'who', 'the',
]);

const OPENERS = [
  ...FILE_VERBS,
  ...DESTINATION_VERBS.flatMap((d) => d.verbs),
  ...CREATE_WORDS,
  ...DELETE_WORDS,
  ...SET_WORDS,
  ...CLEAR_WORDS,
  ...MOVE_WORDS,
  ...FIND_VERBS,
]
  .map((w) => w.trim().split(/\s+/)[0].toLowerCase())
  /* Words that are verbs to one reader and grammar to a sentence. "To",
     "is" and "now" are set words because "the price is 20k" is a write,
     and none of them starts a clause. Splitting on them would cut
     "trailers at Hyde and now at Bredbury" in half. */
  .filter((w) => !NOT_A_CLAUSE_START.has(w))
  .filter((w) => w.length > 2);

/** Words that mean "what the clause before produced". */
const BACK_REFERENCES = [
  'them', 'these', 'those', 'it', 'that', 'the result', 'the results',
  'the list', 'that list', 'the lot',
];

export type Clause = {
  text: string;
  /** True when it points back at what the clause before produced. */
  refersBack: boolean;
};

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

function startsAClause(fragment: string): boolean {
  const first = fragment.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return OPENERS.includes(first);
}

export function refersBack(text: string): boolean {
  const t = soften(text);
  return BACK_REFERENCES.some((w) => t.includes(` ${w} `));
}

/**
 * Split a sentence into clauses, or leave it alone.
 *
 * One clause back means the sentence was never a programme, which is
 * the overwhelming majority of them and must stay untouched.
 */
export function splitClauses(text: string): Clause[] {
  const parts: string[] = [];
  let rest = text.trim();

  /* Repeatedly take the earliest joining word that is followed by
     something which could begin a command. */
  for (;;) {
    let cut: { at: number; length: number } | null = null;

    for (const joiner of JOINERS) {
      const at = rest.toLowerCase().indexOf(joiner, 1);
      if (at < 0) continue;
      const after = rest.slice(at + joiner.length);
      if (!startsAClause(after)) continue;
      if (!cut || at < cut.at) cut = { at, length: joiner.length };
    }

    if (!cut) break;
    parts.push(rest.slice(0, cut.at).trim());
    rest = rest.slice(cut.at + cut.length).trim();
  }

  parts.push(rest);

  const clauses = parts.filter((p) => p.length > 1);
  if (clauses.length < 2) return [{ text: text.trim(), refersBack: false }];

  return clauses.map((c, i) => ({
    text: c,
    /* The first clause cannot point back at anything. */
    refersBack: i > 0 && refersBack(c),
  }));
}
