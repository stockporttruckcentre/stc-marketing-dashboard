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
import { PROVIDER, nextStrategy, type EnrichStrategy } from '@/lib/crm/enrich';
import { LUSHA_GATE } from '@/lib/crm/permissions';
import { readSheet } from '@/lib/import/parse';
import { matchColumns } from '@/lib/import/match';
import { buildPlan, countPlan, type ExistingRow } from '@/lib/import/plan';
import { CRM_CONTACTS } from '@/lib/import/dictionary';
import { prepareImport, IMPORT_CEILING } from '@/lib/import/commit';
import { fileDigest, type CommandContext } from '../context';
import { createHash } from 'crypto';
import type { Store, TransactionStep } from '../ir/store';

export type PreparedOperation =
  | { ok: true; steps: TransactionStep[]; describe: string }
  | { ok: false; why: string };

/** What the preview says, without doing any of it. */
export type PreparedDescription =
  | {
      ok: true;
      says: string;
      count: number;
      /**
       * A fingerprint of everything the preparation decided.
       *
       * The file is not the whole input. Which rows are duplicates of
       * records already here, and which list they are going on, are
       * DATABASE state, and both can move between the preview and the
       * confirmation. This goes into the programme hash, so a customer
       * that arrived in between means a fresh preview rather than
       * previewing a hundred records and importing ninety nine.
       */
      fingerprint: string;
    }
  | { ok: false; why: string };

export type PrepareInput = {
  /** The records the operation runs on, as resolved rows. */
  subjects: { id: string; label: string; values: Record<string, unknown> }[];
  args: Record<string, unknown>;
  /** What the request carried: a selection, a record, a file. */
  context: CommandContext;
  /**
   * The caller's own view of the database.
   *
   * An import has to know what is already here before it can say what it
   * is going to do, and it reads that through the same store every other
   * read goes through, so row level security decides what counts as a
   * duplicate for THIS person.
   */
  store: Store;
  /**
   * What this confirmation is, as one opaque string.
   *
   * The two hashes the apply request already carries. It is what makes a
   * retry of the same confirmed command the same purchase rather than a
   * second one.
   */
  confirmation: string;
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
    if (LUSHA_GATE.locked) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }

    /* WHAT THIS CONFIRMATION CAN COST, EXACTLY.

       One purchased call per record, chosen before anything is spent.
       A record with nothing to look up by costs nothing and is named,
       rather than being counted and then refused. */
    const planned = subjects.map((s) => ({
      label: s.label,
      strategy: nextStrategy(detailsOf(s.values)),
    }));
    const payable = planned.filter((p) => p.strategy);
    if (!payable.length) {
      return {
        ok: false,
        why: 'none of those records have an email address, a name and company, or a website '
          + 'for Lusha to work from.',
      };
    }

    const nothing = planned.filter((p) => !p.strategy).map((p) => p.label);
    return {
      ok: true,
      count: payable.length,
      says: `Spends at most ${payable.length === 1 ? 'one credit' : `${payable.length} credits`}, `
        + `one per record: ${payable.map((p) => `${p.label} by ${p.strategy}`).join(', ')}.`
        + (nothing.length
          ? ` ${nothing.join(', ')} ${nothing.length === 1 ? 'has' : 'have'} nothing to look up by `
            + 'and will be left alone.'
          : ''),
      fingerprint: payable.map((p) => `${p.label}:${p.strategy}`).join('|'),
    };
  },

  async run({ subjects, store, confirmation }) {
    if (LUSHA_GATE.locked) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }

    const changes = [];
    const found: string[] = [];

    for (const subject of subjects) {
      const details = detailsOf(subject.values);
      const strategy = nextStrategy(details);
      if (!strategy) continue;

      /* THE PURCHASE IS RECORDED BEFORE IT HAPPENS.

         Lusha cannot join the transaction below. So the attempt is
         claimed in its own transaction, the answer is stored as soon as
         it arrives, and the programme consumes what is stored. If the
         programme then fails, this same confirmation retried finds the
         answer already bought and does not buy it again. */
      const key = attemptKey(confirmation, 'contact.enrich', subject.id, strategy);
      const claimed = await store.invoke({
        capability: 'external.begin',
        subjects: [],
        args: {
          key, capability: 'contact.enrich', subject: subject.id, strategy,
        },
      });
      if (!claimed.ok) return { ok: false, why: claimed.why };

      const before = (claimed.results?.[0] ?? {}) as {
        state?: string; result?: Record<string, unknown>; why?: string;
      };

      let fields: Record<string, unknown> | null = null;
      let via = strategy as string;

      if (before.state === 'done' && before.result) {
        /* Already paid for. This is the retry path, and it costs
           nothing. */
        fields = (before.result.fields ?? {}) as Record<string, unknown>;
        via = String(before.result.strategy ?? strategy);
      } else if (before.state === 'failed') {
        return { ok: false, why: `${subject.label}: ${before.why ?? 'that lookup already failed'}` };
      } else {
        const got = await PROVIDER.lookUp({ ...details, strategy });
        await store.invoke({
          capability: 'external.finish',
          subjects: [],
          args: {
            key,
            ok: got.ok,
            result: got.ok ? { fields: got.fields, strategy: got.strategy } : null,
            why: got.ok ? null : got.why,
          },
        });
        if (!got.ok) return { ok: false, why: `${subject.label}: ${got.why}` };
        fields = got.fields;
        via = got.strategy;
      }

      changes.push({ op: 'update' as const, table: 'crm_contacts', id: subject.id, set: fields });
      found.push(`${subject.label} by ${via}`);
    }

    if (!changes.length) {
      return { ok: false, why: 'there was nothing on those records for Lusha to work from.' };
    }

    return {
      ok: true,
      steps: [{ op: 'changes', changes }],
      describe: `Looked up ${found.join(', ')}.`,
    };
  },
};

/** What a resolved subject holds, as the lookup wants it. */
function detailsOf(values: Record<string, unknown>) {
  return {
    email: values.email as string | null,
    companyName: values.company_name as string | null,
    contactName: values.contact_name as string | null,
    websiteUrl: values.website as string | null,
  };
}

/**
 * The idempotency key for one purchase.
 *
 * Server generated, from the confirmation the request already carries
 * plus the record and the strategy. The same confirmed command retried
 * is the same key and therefore the same purchase; a different sentence,
 * customer or strategy is a different one, which it is.
 */
function attemptKey(
  confirmation: string, capability: string, subject: string, strategy: EnrichStrategy,
): string {
  return createHash('sha256')
    .update([confirmation, capability, subject, strategy].join('|'))
    .digest('hex');
}

/* -------------------------------------------------------------
   Importing a file the browser is holding
   ------------------------------------------------------------- */

/**
 * The file, read the way the import screen reads it.
 *
 * Same parser, same column dictionary, same row rules, and the same
 * comparison against what is already here. A second set of them is how
 * one of the two starts inventing records called Unknown again, which is
 * the bug the import screen was built to end.
 *
 * WHAT IS ALREADY HERE IS PART OF THE ANSWER.
 *
 * The dialog passes the rows on the screen so it can say "this one is
 * already in the CRM" and default it to skip. A sentence has no screen,
 * which is a reason to read the matching records rather than a reason to
 * skip the comparison: importing a file twice would otherwise double
 * every customer in it and report success.
 *
 * Only the records the FILE could match are read, by the dictionary's
 * own duplicate keys, so a file of forty names does not load the CRM.
 *
 * The digest in the plan is checked here rather than trusted. Previewing
 * one file and confirming another is a mismatch, and it says so.
 */
async function read(input: PrepareInput) {
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

  const columns = matchColumns(sheet.headers, sheet.rows, CRM_CONTACTS);

  /* Which list, exactly. A name that fits two lists is a question, not a
     reason to take whichever the database returned first. */
  const list = await destination(input.store, input.args.list as string | undefined);
  if (!list.ok) return list;

  /* The records this file could be a duplicate of, by the dictionary's
     own keys, read through the caller's own session. */
  const draft = buildPlan(columns, sheet.rows, [], CRM_CONTACTS);
  const existing = await matching(input.store, draft);
  if (!existing.ok) return existing;

  const plan = buildPlan(columns, sheet.rows, existing.rows, CRM_CONTACTS);
  const counts = countPlan(plan);
  const wanted = plan.rows.filter((r) => r.decision === 'import');
  const { records, refused } = prepareImport(wanted.map((r) => r.values));

  const mapped = columns.filter((c) => c.target)
    .map((c) => `${c.header} to ${c.field?.label ?? c.target}`);

  /* EVERYTHING THE PREPARATION DECIDED, IN ONE STRING.

     The file, how its columns were read, which records here it matched,
     what it is going to write and where. Any of those moving between the
     preview and the confirmation is a different import, and the
     programme hash carries this so it comes back as a fresh preview
     rather than as ninety nine of a hundred records. */
  const fingerprint = fileDigest([
    fileDigest(file.text),
    mapped.join('|'),
    plan.rows.filter((r) => r.duplicateOf).map((r) => `${r.index}:${r.duplicateOf?.id}`).join('|'),
    JSON.stringify(records),
    list.id ?? 'global',
  ].join('\n'));

  return {
    ok: true as const,
    file, plan, counts, records, list,
    refused: refused + (sheet.rows.length - wanted.length),
    mapped,
    fingerprint,
  };
}

type Destination = { ok: true; id: string | null; label: string } | { ok: false; why: string };

/**
 * The list the rows are going on, resolved exactly.
 *
 * No name means the global list every customer starts on. A name means
 * that list and no other: none refuses by name, several asks, and there
 * is deliberately no rule that picks one of them.
 */
async function destination(store: Store, named?: string): Promise<Destination> {
  const wanted = (named ?? '').trim();
  const found = await store.read({
    table: 'crm_lists',
    columns: ['id', 'name', 'is_global'],
    /* A superset, narrowed exactly below. Nobody types a list's
       capitalisation from memory, and there is no case insensitive
       equality in the condition language, so this asks for anything
       containing the name and then decides here. */
    where: wanted
      ? {
          kind: 'cmp', op: 'contains',
          left: { kind: 'field', of: { entity: 'lists', field: 'name' } },
          right: { kind: 'literal', value: wanted },
        }
      : {
          kind: 'cmp', op: 'eq',
          left: { kind: 'field', of: { entity: 'lists', field: 'is_global' } },
          right: { kind: 'literal', value: true },
        },
    limit: 100,
  });
  if (!found.ok) return { ok: false, why: found.why };

  const read = {
    ok: true as const,
    rows: wanted
      ? found.rows.filter((r) => String(r.name ?? '').trim().toLowerCase() === wanted.toLowerCase())
      : found.rows,
  };

  if (!read.rows.length) {
    return {
      ok: false,
      why: wanted
        ? `there is no list called ${wanted}`
        : 'there is no global list for imported customers to go on',
    };
  }
  if (read.rows.length > 1) {
    const names = read.rows.slice(0, 5).map((r) => String(r.name)).join(', ');
    return {
      ok: false,
      why: `${read.rows.length} lists match ${wanted || 'that'}, so it is not clear which one: ${names}`,
    };
  }
  return { ok: true, id: String(read.rows[0].id), label: String(read.rows[0].name) };
}

/** How many keys one lookup carries. A request size, nothing semantic. */
const KEY_PAGE = 200;

/**
 * The records already here that this file could be a duplicate of.
 *
 * By the dictionary's own duplicate keys and only the values the file
 * actually holds, so the read is the size of the file rather than the
 * size of the CRM. Read through the caller's own store, so a customer
 * somebody cannot see is not a duplicate for them, which is the same
 * answer the import screen gets.
 */
async function matching(
  store: Store, draft: { rows: { values: Record<string, unknown> }[] },
): Promise<{ ok: true; rows: ExistingRow[] } | { ok: false; why: string }> {
  const found = new Map<string, ExistingRow>();

  for (const key of CRM_CONTACTS.duplicateKeys) {
    const values = [...new Set(
      draft.rows.map((r) => r.values[key]).filter((v) => v != null && String(v).trim() !== '')
        .map((v) => String(v)),
    )];
    for (let from = 0; from < values.length; from += KEY_PAGE) {
      const slice = values.slice(from, from + KEY_PAGE);
      const read = await store.read({
        table: 'crm_contacts',
        columns: [...new Set(['id', 'company_name', ...CRM_CONTACTS.duplicateKeys])],
        where: {
          kind: 'in',
          of: { kind: 'field', of: { entity: 'contacts', field: key } },
          values: slice.map((v) => ({ kind: 'literal' as const, value: v })),
        },
        limit: slice.length,
      });
      if (!read.ok) return { ok: false, why: read.why };
      for (const row of read.rows) found.set(String(row.id), row as ExistingRow);
    }
  }

  return { ok: true, rows: [...found.values()] };
}

const importRows: Preparer = {
  async describe(input) {
    const got = await read(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return {
        ok: false,
        why: got.counts.duplicates
          ? `every readable row in that file is already in the CRM, so there is nothing to import.`
          : 'none of those rows had a company name, so there is nothing to file them under.',
      };
    }

    /* What it will do, in the order somebody checking it would ask: how
       many records, what is already here, what was thrown away, and what
       the columns were read as. The last one is the part the old import
       never showed and the part that goes wrong. */
    const already = got.plan.rows.filter((r) => r.duplicateOf).length;
    const inFile = got.plan.rows.filter((r) => r.duplicateInFile !== undefined).length;
    const bad = got.refused - already - inFile;

    const parts = [
      `${got.records.length.toLocaleString('en-GB')} new `
        + `${got.records.length === 1 ? 'customer' : 'customers'} from ${got.file.name} `
        + `onto ${got.list.label}.`,
      already
        ? `${already} ${already === 1 ? 'row is' : 'rows are'} already in the CRM and will be left alone.`
        : '',
      inFile
        ? `${inFile} ${inFile === 1 ? 'row repeats' : 'rows repeat'} another row in the same file.`
        : '',
      bad > 0
        ? `${bad} ${bad === 1 ? 'row has' : 'rows have'} no company name and will be left out.`
        : '',
      got.counts.unknown
        ? `${got.counts.unknown} ${got.counts.unknown === 1 ? 'column' : 'columns'} could not be read.`
        : '',
      got.mapped.length ? `Columns read as: ${got.mapped.join(', ')}.` : '',
    ];

    return {
      ok: true,
      count: got.records.length,
      says: parts.filter(Boolean).join(' '),
      fingerprint: got.fingerprint,
    };
  },

  async run(input) {
    const got = await read(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return { ok: false, why: 'there is nothing left in that file to import.' };
    }

    /* The write is the database's, into the list this resolved by id, so
       a list renamed between the preview and the confirmation cannot
       take the rows somewhere else. */
    return {
      ok: true,
      steps: [{
        op: 'invoke',
        capability: 'rows.import',
        subjects: [],
        args: { rows: got.records, listId: got.list.id },
      }],
      describe: `Imported ${got.records.length.toLocaleString('en-GB')} from ${got.file.name} `
        + `onto ${got.list.label}.`,
    };
  },
};

export const PREPARERS: Record<string, Preparer> = {
  'contact.enrich': enrich,
  'rows.import': importRows,
};
