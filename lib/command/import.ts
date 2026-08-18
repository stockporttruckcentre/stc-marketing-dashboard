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
const IMPORT_WORDS = ['import', 'upload', 'load', 'bring in', 'pull in', 'ingest'];

/** What the file is, said out loud. Any of these is enough with a file. */
const FILE_WORDS = [
  'file', 'spreadsheet', 'csv', 'sheet', 'this', 'these', 'that', 'attachment',
  'customers', 'contacts', 'leads', 'companies', 'prospects', 'list',
];

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

  const t = soften(text);
  if (!IMPORT_WORDS.some((w) => t.includes(` ${w} `))) return null;
  if (!FILE_WORDS.some((w) => t.includes(` ${w} `))) return null;

  const cap = capability('rows.import');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  const list = listIn(text);

  const args: Record<string, Expr> = {
    file: { kind: 'literal', value: file.name },
    digest: { kind: 'literal', value: fileDigest(file.text) },
  };
  if (list) args.list = { kind: 'literal', value: list };

  return {
    step: {
      op: 'invoke',
      id: 'i1',
      capability: 'rows.import',
      args,
      produces: { kind: 'rows', entity: 'contacts' },
    },
    summary: list
      ? `Import ${file.name} onto the ${list} list`
      : `Import ${file.name}`,
    requires: cap.requires,
    confidence: 13,
  };
}
