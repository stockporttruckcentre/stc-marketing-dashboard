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
 * Taken from what the readers themselves respond to rather than written
 * out for this: a clause starts with an instruction verb, a lifecycle
 * verb or an output verb, and each of those lists already exists.
 */
const OPENERS = [
  /* output */
  'export', 'download', 'save', 'send', 'email', 'share', 'attach', 'print', 'produce',
  /* lifecycle */
  'create', 'make', 'add', 'new', 'delete', 'remove', 'cancel',
  /* instruction */
  'set', 'change', 'update', 'move', 'mark', 'assign', 'approve', 'clear', 'put',
  /* read */
  'find', 'show', 'list', 'count', 'get',
];

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
