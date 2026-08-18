/* =============================================================
   Importing the file somebody just attached.

     import this
     import these customers onto the Fleet Prospects list
     load this spreadsheet into the CRM

   THE FILE IS CONTEXT, THE MEANING IS THE SERVER'S.

   A selection arrives from the browser and the server decides what may
   be done with it. A file is the same kind of thing: the browser is the
   only place that has it, and everything about what it means, which
   columns it holds, which rows are usable and what gets written is
   decided on the server against the same dictionary the import screen
   uses.

   NOTHING OF THE FILE REACHES THE PLAN EXCEPT ITS FINGERPRINT.

   The plan names the file and carries a digest of its contents. That is
   what makes previewing one file and confirming another a mismatch
   rather than a surprise, and it keeps the plan and its hash the size of
   a sentence rather than the size of a spreadsheet.

   The rows themselves are read twice, once for the preview and once for
   the write, from the file the request carried. A plan that held the
   rows would be a client deciding what gets written.
   ============================================================= */
import type { Expr, Invoke } from './ir/types';
import { capability } from './ir/registry';
import { fileDigest, type CommandContext } from './context';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type ImportPlanning = {
  step: Invoke;
  summary: string;
  requires: string;
  confidence: number;
};

/** Words that mean "take what is in this file and put it in here". */
const IMPORT_WORDS = [
  'import', 'upload', 'load', 'bring in', 'pull in', 'ingest', 'sync', 'resync',
];

/** What the file is, said out loud. Any of these is enough with a file. */
const FILE_WORDS = [
  'file', 'spreadsheet', 'csv', 'sheet', 'this', 'these', 'that', 'attachment',
  'customers', 'contacts', 'leads', 'companies', 'prospects', 'list',
  'stock', 'trailers', 'units', 'fleet', 'inventory',
];

/**
 * WHICH LIST A FILE IS FOR.
 *
 * Two things in this application are loaded from a spreadsheet, and they
 * are not interchangeable: customers onto a CRM list, and units onto the
 * stock list. The sentence says which, and where it does not the screen
 * does.
 *
 * Where neither does, this reads it as customers, which is what "import
 * this" has always meant here. That is not a guess with a write behind
 * it: a supplier's stock file has no company name in it, so every row is
 * refused and the preview says so by name before anybody confirms
 * anything.
 */
const STOCK_WORDS = [
  'stock', 'stock list', 'trailer', 'trailers', 'unit', 'units', 'fleet',
  'inventory', 'supplier', 'suppliers',
];
const CONTACT_WORDS = [
  'customer', 'customers', 'contact', 'contacts', 'lead', 'leads',
  'company', 'companies', 'prospect', 'prospects', 'crm',
];

type Destination = { capability: 'rows.import'; entity: 'contacts' }
  | { capability: 'stock.import'; entity: 'trailers' };

const CONTACTS: Destination = { capability: 'rows.import', entity: 'contacts' };
const STOCK: Destination = { capability: 'stock.import', entity: 'trailers' };

function destinationOf(t: string, context: CommandContext): Destination {
  const says = (words: string[]) => words.some((w) => t.includes(` ${w} `));

  /* The sentence, first. Somebody who said "stock" meant stock even
     with a CRM list open behind the bar. */
  if (says(STOCK_WORDS) && !says(CONTACT_WORDS)) return STOCK;
  if (says(CONTACT_WORDS)) return CONTACTS;

  /* Then the screen. "Import this" on the stock list is the stock list. */
  const on = context.selection?.entity ?? context.record?.entity;
  return on === 'trailers' ? STOCK : CONTACTS;
}

/**
 * WORDS THAT SAY THE FILE IS NOT A LIST OF ANYTHING.
 *
 * "Upload this logo to the brand kit" has an import word in it, and a
 * file on the request, and is not an import. Attaching a document to a
 * record is `record.attach` and putting a logo on the brand kit is a
 * screen. Reading either of them as an import would produce a mapping
 * refusal where the right answer is somewhere else entirely.
 */
const NOT_A_LIST = [
  'logo', 'logos', 'brand', 'brand kit', 'emblem', 'artwork', 'image', 'images',
  'photo', 'photos', 'picture', 'pictures', 'attachment', 'attach', 'document',
  'invoice', 'proposal', 'contract', 'signature', 'post',
];

/**
 * AND A FILE THAT IS NOT A TABLE IS NOT AN IMPORT EITHER.
 *
 * A spreadsheet has rows and columns. A PNG does not, and the sentence
 * saying "load this in" cannot make it one, so this asks the file rather
 * than the sentence.
 */
const TABLE_TYPES = [
  'text/csv', 'text/tab-separated-values', 'text/plain', 'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const TABLE_NAMES = /\.(csv|tsv|txt|xls|xlsx)$/i;

function looksTabular(file: { name: string; mime: string }): boolean {
  return TABLE_TYPES.includes((file.mime ?? '').toLowerCase())
    || TABLE_NAMES.test(file.name ?? '');
}

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9.'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The list the sentence names, if it named one. */
function listIn(raw: string): string | null {
  const named = raw.match(/\b(?:onto|into|to|on)\s+(?:the\s+)?(?:list\s+(?:called|named)\s+)?(.{2,60}?)\s*(?:\blist\b)?\s*[.;]?\s*$/i)?.[1]
    ?? raw.match(/\blist\s+(?:called|named)\s+(.{2,60}?)\s*[.;]?\s*$/i)?.[1];
  const name = named?.trim().replace(/[.,;]+$/, '');
  if (!name) return null;
  /* "into the CRM" is where every customer already goes, and a list of
     that name does not exist. */
  if (/^(?:crm|database|system|contacts|customers|leads)$/i.test(name)) return null;
  return name.length >= 2 ? name : null;
}

export function parseImport(
  raw: string,
  caps: CrmCapabilities | undefined,
  context: CommandContext,
): ImportPlanning | null {
  const file = context.file;
  /* NO FILE, NO IMPORT.

     "Import the customers" with nothing attached is somebody about to
     attach one, and reading it as an instruction would produce a
     refusal where the right answer is the import screen. */
  if (!file || !file.text) return null;

  const text = raw.trim();
  if (text.length < 4) return null;
  if (text.endsWith('?')) return null;

  if (!looksTabular(file)) return null;

  const t = soften(text);
  if (!IMPORT_WORDS.some((w) => t.includes(` ${w} `))) return null;
  if (!FILE_WORDS.some((w) => t.includes(` ${w} `))) return null;
  if (NOT_A_LIST.some((w) => t.includes(` ${w} `))) return null;

  const going = destinationOf(t, context);

  const cap = capability(going.capability);
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* A stock file goes on the stock list, which is one list and is not
     named. Only a CRM import has somewhere to choose. */
  const list = going.capability === 'rows.import' ? listIn(text) : null;

  const args: Record<string, Expr> = {
    file: { kind: 'literal', value: file.name },
    digest: { kind: 'literal', value: fileDigest(file.text) },
  };
  if (list) args.list = { kind: 'literal', value: list };

  return {
    step: {
      op: 'invoke',
      id: 'i1',
      capability: going.capability,
      args,
      produces: { kind: 'rows', entity: going.entity },
    },
    summary: going.capability === 'stock.import'
      ? `Load ${file.name} onto the stock list`
      : list
        ? `Import ${file.name} onto the ${list} list`
        : `Import ${file.name}`,
    requires: cap.requires,
    confidence: 13,
  };
}
