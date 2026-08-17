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
import type { Destination, Output } from './ir/types';

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

  const verb = FILE_VERB.exec(rest);
  if (!format && !verb) return null;

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
    output: { kind: 'file', format: chosen },
    /* Downloading changes nothing and leaves nothing behind, so it is
       not a destructive act and does not ask twice. Sharing and
       emailing are different and are gated separately. */
    to: { kind: 'download' },
    format: chosen,
    label: nounFor(chosen),
    rest,
  };
}
