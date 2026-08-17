/* =============================================================
   What comes out, and where it goes.

   "Export a list of blue curtainsiders sold to Dawson in the last six
   months by Dave as a Word document" is one selection and one output.
   The selection is the same machinery every question uses. The output
   is four words at the end, and until this file existed the reader saw
   them as part of the question: "export" matched nothing, "Word
   document" matched nothing, and "to Excel" ended up inside a filter,
   so "export customers in Manchester to Excel" narrowed on a place
   called "Manchester To".

   THERE IS NO EXPORT-CUSTOMERS COMMAND, AND THERE NEVER WILL BE.

   This reads the output clause off any sentence and hands the rest to
   the reader that was already there. Adding a format is a row in
   `FORMATS`. Adding an entity is nothing at all, because the entity was
   never part of this. The combinations are the product of the two, and
   neither side knows the other exists.

   The words are grouped rather than listed, for the same reason the
   lexicon is: a table of phrasings goes stale the day somebody says
   "chuck it in a spreadsheet", and it cannot be read at the size it
   would have to be.
   ============================================================= */
import type { Cond, Destination, Expr, Output } from './ir/types';

export type FileFormat = 'csv' | 'xlsx' | 'pdf' | 'docx';

/**
 * A format, and the words people use for it.
 *
 * `noun` is what a person is told they are getting, and it is also what
 * the file extension will be, so the two cannot disagree.
 */
export const FORMATS: { format: FileFormat; noun: string; words: string[] }[] = [
  {
    format: 'csv', noun: 'CSV',
    words: ['csv', 'comma separated', 'comma delimited', 'plain text file'],
  },
  {
    format: 'xlsx', noun: 'Excel workbook',
    words: ['excel', 'xls', 'xlsx', 'spreadsheet', 'workbook', 'sheet'],
  },
  {
    format: 'pdf', noun: 'PDF',
    words: ['pdf', 'acrobat'],
  },
  {
    format: 'docx', noun: 'Word document',
    words: ['word', 'docx', 'doc', 'word doc'],
  },
];

/** Verbs that mean "put this in a file", rather than "tell me". */
const FILE_VERBS = [
  'export', 'download', 'save', 'save down', 'pull off', 'get me a file of',
  'produce', 'generate', 'write out', 'print', 'output',
];

/** Words that introduce the format rather than being part of it. */
const INTRO = ['as', 'to', 'in', 'into', 'via'];

/** Nouns that follow a format word without adding meaning. */
const FORMAT_TAIL = ['document', 'doc', 'file', 'sheet', 'workbook', 'format', 'version', 'copy'];

/* =============================================================
   Where it goes

   A download changes nothing. Sharing grants somebody access they did
   not have, an email leaves the company and cannot be recalled, and an
   attachment changes a record. Reading all four as "download" was not a
   simplification: it meant "email the customer list to Dave" produced a
   file in the browser and told somebody it had been sent.

   The verbs and the words that introduce the recipient are groups, not
   sentences, for the reason everything else here is: "share it with",
   "send it to" and "give Dave a copy of" are one idea.
   ============================================================= */

const DESTINATION_VERBS: {
  kind: 'share' | 'email' | 'attach';
  verbs: string[];
  /** What comes between the verb and who or what it goes to. */
  preps: string[];
}[] = [
  { kind: 'email', verbs: ['email', 'e mail', 'mail'], preps: ['to', 'over to', 'across to'] },
  { kind: 'share', verbs: ['share', 'send'], preps: ['with', 'to', 'over to'] },
  /* "Attach" only. "File it against Dawson" and "put it on Dawson" say
     the same thing, and both words do other jobs in this application:
     "put the price up" is a write and "file" is a format tail. A verb
     that reads two ways is a verb that will read the wrong one. */
  { kind: 'attach', verbs: ['attach'], preps: ['to', 'against', 'on', 'onto'] },
];

/** Words standing in for what the clause before produced. */
const IT = ['it', 'this', 'that', 'them', 'these', 'those', 'the file', 'the list',
            'the results', 'the result', 'a copy', 'copies', 'the lot'];

/**
 * How a recipient is named, as a lookup rather than as a row id.
 *
 * A plan holding a row id is a plan whose meaning changes when somebody
 * is renamed, which is the drift the plan hash exists to notice and
 * would then fire on for no reason a person could see. So the plan says
 * "the person called Dave" and `resolve` finds out who that is.
 */
function personNamed(name: string): Expr {
  const like: Cond = {
    kind: 'or',
    of: [
      { kind: 'cmp', op: 'contains', left: { kind: 'field', of: { entity: 'profiles', field: 'full_name' } }, right: { kind: 'literal', value: name } },
      { kind: 'cmp', op: 'eq', left: { kind: 'field', of: { entity: 'profiles', field: 'email' } }, right: { kind: 'literal', value: name } },
    ],
  };
  return {
    kind: 'reference',
    entity: 'profiles',
    where: like,
    select: 'id',
    /* Two people called Dave is a real possibility here, and granting
       the wrong one access to the CRM is not a thing to guess at. */
    onAmbiguity: 'ask',
  };
}

/** "Dave and Tom", "Dave, Tom and Alex" as the people they name. */
export function peopleIn(text: string): { names: string[]; refs: Expr[] } {
  const names = text
    .split(/\s*(?:,|\band\b|\+|&)\s*/i)
    .map((s) => s.trim().replace(/[.;:]+$/, ''))
    .filter((s) => s.length > 1 && s.length < 60);
  return { names, refs: names.map(personNamed) };
}

/**
 * What a sentence asked to be produced, if it asked for anything.
 *
 * `null` means the sentence is a question, which is the overwhelming
 * majority of them and must stay free of any of this.
 */
export type ReadOutput = {
  output: Output;
  to: Destination;
  format: FileFormat;
  /** In words, for the summary. */
  label: string;
  /** The sentence with the output clause taken out. */
  rest: string;
  /** Who or what it goes to, by name, for the preview. */
  recipients?: string[];
  /**
   * The word that pointed at what is being sent: "it", "these", "them".
   *
   * Carried rather than thrown away, because it is the only thing in
   * "share it with Dave" that says what "it" is. Taking it out with the
   * rest of the destination clause left an empty sentence, and an empty
   * sentence names no entity, so the clause planned as nothing at all.
   */
  pointer?: string;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest first, so "word doc" is not read as "word" with a stray doc. */
const formatAlternation = FORMATS
  .flatMap((f) => f.words)
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');

const verbAlternation = FILE_VERBS
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');

const tailAlternation = FORMAT_TAIL.map(escape).join('|');
const introAlternation = INTRO.map(escape).join('|');

/**
 * A format named where a format belongs.
 *
 * After "as", "to" or "into", AND at the end of the sentence. Not
 * anywhere at all: "customers in Word Street" names a place, and a
 * reader that took any mention of a format word exported it. The output
 * clause is the last thing somebody says, because it is what they want
 * doing with the answer once they have described it.
 */
const FORMAT_CLAUSE = new RegExp(
  String.raw`\s*\b(?:${introAlternation})\s+(?:an?\s+|the\s+)?(${formatAlternation})` +
  String.raw`(?:\s+(?:${tailAlternation}))?\s*[.,;]?\s*$`,
  'i',
);

/**
 * "A PDF of every sold trailer", where the format leads.
 *
 * The same words in the other order, which is how people ask when the
 * verb is "give me" or "send me" rather than "export".
 */
const FORMAT_OF = new RegExp(
  String.raw`\b(?:an?|the)\s+(${formatAlternation})(?:\s+(?:${tailAlternation}))?\s+of\b`,
  'i',
);

/** "Export as csv", where the verb and the format sit together. */
const VERB_FORMAT = new RegExp(
  String.raw`\b(?:${verbAlternation})\s+(?:an?\s+|the\s+)?(${formatAlternation})` +
  String.raw`(?:\s+(?:${tailAlternation}))?\b`,
  'i',
);

const FILE_VERB = new RegExp(String.raw`\b(?:${verbAlternation})\b`, 'i');

const itAlternation = IT.sort((a, b) => b.length - a.length).map(escape).join('|');

/**
 * Read where a result is meant to go, and give back the rest.
 *
 * The middle of the match goes back into the sentence, because in
 * "email the sold trailers to Dave" the middle IS the question. Only
 * the verb, the preposition and the recipients come out.
 *
 * `null` for the overwhelming majority of sentences, which say nothing
 * about a destination and get the download they have always had.
 */
function readDestinationClause(
  text: string,
): { to: Destination; rest: string; recipients: string[]; label: string; pointer?: string } | null {
  for (const d of DESTINATION_VERBS) {
    const verbs = d.verbs.map(escape).join('|');
    const preps = d.preps.sort((a, b) => b.length - a.length).map(escape).join('|');
    /* THE VERB HAS TO BE THE VERB.

       Anchored at the start of the clause, because "set the email on
       Dawson to dave@stc.co.uk" contains the word "email" followed by
       "to" followed by a recipient, and reading that as a destination
       turned a field write into an outbound send. Clauses are already
       split by the time this runs, so the first word of a clause is the
       thing being asked for. */
    const re = new RegExp(
      String.raw`^\s*(?:please\s+)?(?:${verbs})\b(?:\s+(${itAlternation}))?(.*?)\s+\b(?:${preps})\s+(.+?)\s*[.;]?\s*$`,
      'i',
    );
    const m = re.exec(text);
    if (!m) continue;

    const pointer = m[1]?.trim() || undefined;
    const tail = m[3].trim();
    /* "Export it to Excel" is a format, not a person, and "send it to
       stock" is a different operation entirely. A destination whose
       recipients are a format word is not a destination. */
    if (!tail || new RegExp(String.raw`^(?:an?\s+|the\s+)?(?:${formatAlternation})\b`, 'i').test(tail)) {
      continue;
    }

    const middle = m[2].trim();
    const rest = `${text.slice(0, m.index)} ${middle}`.replace(/\s+/g, ' ').trim();

    if (d.kind === 'attach') {
      /* Attaching names a record, and a record is a set of one. The
         entity it belongs to is decided by the reader that reads the
         rest of the sentence, so this carries the words and nothing
         more. */
      return {
        to: { kind: 'attach', to: { entity: '' } },
        rest, recipients: [tail], label: `attached to ${tail}`, pointer,
      };
    }

    const { names, refs } = peopleIn(tail);
    if (!names.length) continue;
    return {
      to: d.kind === 'email' ? { kind: 'email', to: refs } : { kind: 'share', with: refs },
      rest,
      recipients: names,
      label: `${d.kind === 'email' ? 'emailed to' : 'shared with'} ${names.join(' and ')}`,
      pointer,
    };
  }
  return null;
}

/** The words for a format, once, so a sentence can say it twice. */
function formatFor(word: string): FileFormat | null {
  const w = word.toLowerCase().trim();
  for (const f of FORMATS) if (f.words.includes(w)) return f.format;
  return null;
}

export function nounFor(format: FileFormat): string {
  return FORMATS.find((f) => f.format === format)?.noun ?? format.toUpperCase();
}

/**
 * Read the output clause, and give back the rest of the sentence.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE.
 *
 * Nothing about entities, filters, dates or ordering. This removes four
 * words from the end of a sentence and says what they meant. Everything
 * else is the reader's, unchanged, which is why every question that
 * already worked still works with a format on the end of it.
 */
export function readOutput(text: string): ReadOutput | null {
  const raw = text.trim();
  if (!raw) return null;

  let rest = raw;
  let format: FileFormat | null = null;

  const clause = FORMAT_CLAUSE.exec(rest);
  if (clause) {
    format = formatFor(clause[1]);
    if (format) rest = `${rest.slice(0, clause.index)} ${rest.slice(clause.index + clause[0].length)}`;
  }

  if (!format) {
    const of = FORMAT_OF.exec(rest);
    if (of) {
      format = formatFor(of[1]);
      if (format) {
        rest = `${rest.slice(0, of.index)} ${rest.slice(of.index + of[0].length)}`;
      }
    }
  }

  if (!format) {
    const verbFormat = VERB_FORMAT.exec(rest);
    if (verbFormat) {
      format = formatFor(verbFormat[1]);
      /* Only the format words come out. The verb stays for the moment
         and is taken out below, so "export excel of trailers" and
         "export trailers as excel" leave the same sentence behind. */
      if (format) {
        rest = `${rest.slice(0, verbFormat.index)} ${verbFormat[0].replace(new RegExp(String.raw`\s*(?:${formatAlternation})(?:\s+(?:${tailAlternation}))?\b`, 'i'), '')} ${rest.slice(verbFormat.index + verbFormat[0].length)}`;
      }
    }
  }

  /* Where it goes, read off what is left once the format has come out.
     "Email the sold trailers to Dave as a PDF" says both, at opposite
     ends of the sentence, and the question is the bit in the middle. */
  const going = readDestinationClause(rest);
  if (going) rest = going.rest;

  const verb = FILE_VERB.exec(rest);
  /* A destination is a reason to produce something even where no verb
     said "export". Nobody writes "export the leads to Dave"; they write
     "send the leads to Dave", and the file is implied by the sending. */
  if (!format && !verb && !going) return null;

  /* A file verb with no format named is a spreadsheet, because that is
     what the export screen in this application produces. Saying so
     rather than asking is right: somebody who wanted a PDF says PDF. */
  const chosen: FileFormat = format ?? 'xlsx';

  if (verb) {
    rest = `${rest.slice(0, verb.index)} ${rest.slice(verb.index + verb[0].length)}`;
  }

  /* "A list of" and "me" are what is left of "export me a list of
     trailers" once the verb has gone, and they are not part of the
     question either. */
  rest = rest
    .replace(/^\s*(?:me|us)\b/i, ' ')
    .replace(/^\s*(?:an?|the)\s+list\s+of\b/i, ' list of ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    /* SHARING IS ACCESS, NOT A FILE.

       Sharing a list with a colleague in this application means they can
       open it. Producing a spreadsheet as well would be doing something
       nobody asked for with data that has just become somebody else's to
       read, and it made every share require the export capability on top
       of the one that actually governs it. */
    output: going?.to.kind === 'share' ? { kind: 'rows' } : { kind: 'file', format: chosen },
    /* Downloading changes nothing and leaves nothing behind, so it is
       not a destructive act and does not ask twice. Sharing and
       emailing are different and are gated separately. */
    to: going?.to ?? { kind: 'download' },
    format: chosen,
    label: going ? `${nounFor(chosen)}, ${going.label}` : nounFor(chosen),
    rest,
    recipients: going?.recipients,
    pointer: going?.pointer,
  };
}
