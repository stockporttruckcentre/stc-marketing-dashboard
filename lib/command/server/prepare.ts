/* =============================================================
   Operations whose work is not SQL.

   Everything else the command runtime performs is SQL, and every
   database effect of one programme goes into one transaction. Two kinds
   of work cannot be:

     a lookup in somebody else's service   spends a credit, cannot roll back
     a file the browser is holding         the database has never seen it

   THE ORDER IS THE SAME AS A FILE'S.

     resolve      which records, nothing written
     describe     what it WOULD do, for the preview. Safe.
     prepare      the outside work happens here
     transact     everything the database does, in one commit

   `describe` and `prepare` are separate because the preview runs one and
   the confirmation runs the other. Describing an enrichment must not
   spend a credit, and describing an import must say how many records
   are going to appear before anybody agrees to it. A single function
   used for both would have to choose which of those to break.

   WHAT A PREPARER RETURNS.

   Steps for the programme's transaction. Usually a set of changes, and
   for an import an operation the database performs, so the preview, the
   allowlist, the permission derivation and the atomicity keep working
   without knowing what Lusha or a spreadsheet is.

   Registered by capability id, so a capability that declares `prepares`
   and has no entry here is refused by name rather than silently doing
   nothing.
   ============================================================= */
import { lookUpInLusha } from '@/lib/crm/enrich';
import { LUSHA_LOCKED } from '@/lib/crm/permissions';
import { readSheet } from '@/lib/import/parse';
import { matchColumns } from '@/lib/import/match';
import { buildPlan, countPlan } from '@/lib/import/plan';
import { CRM_CONTACTS } from '@/lib/import/dictionary';
import { prepareImport, IMPORT_CEILING } from '@/lib/import/commit';
import { fileDigest, type CommandContext } from '../context';
import type { TransactionStep } from '../ir/store';

export type PreparedOperation =
  | { ok: true; steps: TransactionStep[]; describe: string }
  | { ok: false; why: string };

/** What the preview says, without doing any of it. */
export type PreparedDescription =
  | { ok: true; says: string; count: number }
  | { ok: false; why: string };

export type PrepareInput = {
  /** The records the operation runs on, as resolved rows. */
  subjects: { id: string; label: string; values: Record<string, unknown> }[];
  args: Record<string, unknown>;
  /** What the request carried: a selection, a record, a file. */
  context: CommandContext;
};

export type Preparer = {
  /** Safe. Never spends anything, never calls out, never writes. */
  describe: (input: PrepareInput) => Promise<PreparedDescription>;
  run: (input: PrepareInput) => Promise<PreparedOperation>;
};

/* -------------------------------------------------------------
   Looking customers up in Lusha
   ------------------------------------------------------------- */

/**
 * One lookup per record, because Lusha answers about one company at a
 * time. Any of them failing fails the whole thing: a command that
 * enriched four of six and reported success would leave somebody to
 * work out which two, having spent six credits either way.
 */
const enrich: Preparer = {
  async describe({ subjects }) {
    if (LUSHA_LOCKED) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }
    return {
      ok: true,
      count: subjects.length,
      says: `Looks ${subjects.length} up in Lusha, which spends ${subjects.length === 1 ? 'a credit' : `${subjects.length} credits`}.`,
    };
  },

  async run({ subjects }) {
    if (LUSHA_LOCKED) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }

    const changes = [];
    const found: string[] = [];

    for (const subject of subjects) {
      const got = await lookUpInLusha({
        email: subject.values.email as string | null,
        companyName: subject.values.company_name as string | null,
        contactName: subject.values.contact_name as string | null,
        websiteUrl: subject.values.website as string | null,
      });
      if (!got.ok) return { ok: false, why: `${subject.label}: ${got.why}` };

      changes.push({ op: 'update' as const, table: 'crm_contacts', id: subject.id, set: got.fields });
      found.push(`${subject.label} by ${got.strategy}`);
    }

    return {
      ok: true,
      steps: [{ op: 'changes', changes }],
      describe: `Looked up ${found.join(', ')}.`,
    };
  },
};

/* -------------------------------------------------------------
   Importing a file the browser is holding
   ------------------------------------------------------------- */

/**
 * The file, read the way the import screen reads it.
 *
 * Same parser, same column dictionary, same row rules. A second set of
 * them is how one of the two starts inventing records called Unknown
 * again, which is the bug the import screen was built to end.
 *
 * The digest in the plan is checked here rather than trusted. Previewing
 * one file and confirming another is a mismatch, and it says so.
 */
function read(input: PrepareInput) {
  const file = input.context.file;
  if (!file?.text) {
    return { ok: false as const, why: 'there is no file on this request to import' };
  }
  if (input.args.digest && fileDigest(file.text) !== input.args.digest) {
    return {
      ok: false as const,
      why: 'that is not the file that was previewed. Have another look at what it is going to do.',
    };
  }

  const sheet = readSheet(file.text);
  if (!sheet.ok) return { ok: false as const, why: sheet.why };

  if (sheet.rows.length > IMPORT_CEILING) {
    return {
      ok: false as const,
      why: `that is ${sheet.rows.length.toLocaleString('en-GB')} rows, which is more than `
        + `${IMPORT_CEILING.toLocaleString('en-GB')}. Split the file and import it in parts.`,
    };
  }

  /* Nothing is compared against what is already here. The import screen
     has the rows in front of it and can offer to merge; a sentence has
     no such screen, so every readable row is a new record and a
     duplicate is a duplicate. Said out loud in the preview rather than
     decided quietly. */
  const columns = matchColumns(sheet.headers, sheet.rows, CRM_CONTACTS);
  const plan = buildPlan(columns, sheet.rows, [], CRM_CONTACTS);
  const counts = countPlan(plan);
  const values = plan.rows.filter((r) => r.decision === 'import').map((r) => r.values);
  const { records, refused } = prepareImport(values);

  return {
    ok: true as const,
    file, plan, counts, records,
    refused: refused + (sheet.rows.length - values.length),
    mapped: columns.filter((c) => c.target).map((c) => `${c.header} to ${c.field?.label ?? c.target}`),
  };
}

const importRows: Preparer = {
  async describe(input) {
    const got = read(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return {
        ok: false,
        why: 'none of those rows had a company name, so there is nothing to file them under.',
      };
    }

    /* What it will do, in the order somebody checking it would ask:
       how many records, what was thrown away, and what the columns were
       read as. The last one is the part the old import never showed and
       the part that goes wrong. */
    const parts = [
      `${got.records.length.toLocaleString('en-GB')} `
        + `${got.records.length === 1 ? 'customer' : 'customers'} from ${got.file.name}.`,
      got.refused
        ? `${got.refused} ${got.refused === 1 ? 'row has' : 'rows have'} no company name and will be left out.`
        : '',
      got.counts.unknown
        ? `${got.counts.unknown} ${got.counts.unknown === 1 ? 'column' : 'columns'} could not be read.`
        : '',
      got.mapped.length ? `Columns read as: ${got.mapped.join(', ')}.` : '',
    ];

    return { ok: true, count: got.records.length, says: parts.filter(Boolean).join(' ') };
  },

  async run(input) {
    const got = read(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return {
        ok: false,
        why: 'none of those rows had a company name, so there is nothing to file them under.',
      };
    }

    /* The write is the database's. The list is named rather than
       numbered and is resolved inside the same transaction that does the
       inserting, so a list renamed between the preview and the
       confirmation cannot end up with somebody's customers on it. */
    return {
      ok: true,
      steps: [{
        op: 'invoke',
        capability: 'rows.import',
        subjects: [],
        args: {
          rows: got.records,
          list: (input.args.list as string | undefined) ?? null,
        },
      }],
      describe: `Imported ${got.records.length.toLocaleString('en-GB')} from ${got.file.name}.`,
    };
  },
};

export const PREPARERS: Record<string, Preparer> = {
  'contact.enrich': enrich,
  'rows.import': importRows,
};
