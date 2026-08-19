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
import { FINDER, asContactRows } from '@/lib/crm/finder';
import { FEEDS, MAX_AGE_DAYS, fetchNews } from '@/lib/news/refresh';
import { readSheet } from '@/lib/import/parse';
import { matchColumns } from '@/lib/import/match';
import { buildPlan, countPlan, type ExistingRow } from '@/lib/import/plan';
import { CRM_CONTACTS, STOCK_TRAILERS } from '@/lib/import/dictionary';
import { prepareImport, IMPORT_CEILING } from '@/lib/import/commit';
import { prepareStock, STOCK_CEILING } from '@/lib/import/stock';
import { fileDigest, type CommandContext } from '../context';
import { NO_FILES, stagingKey, type FileStore } from '../files';
import { NO_LEDGER, type ExternalEffectStore } from '../external';
import { storeImage, looksLikeAnImage } from '@/lib/social/media';
import { createHash } from 'crypto';
import type { Store, TransactionStep } from '../ir/store';

export type PreparedOperation =
  | {
      ok: true;
      steps: TransactionStep[];
      describe: string;
      /**
       * External objects this preparation put somewhere.
       *
       * A file is staged before the programme commits, so a transaction
       * that fails leaves an object nothing references. The caller
       * removes what is listed here when that happens. The key is
       * deterministic, so a retry of the same confirmed command reuses
       * the object rather than making a second one.
       */
      staged?: { key: string }[];
    }
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
   * Somewhere to put bytes that are not a row.
   *
   * A picture on a post is a file on a bucket and a URL in a column,
   * and neither half can be done by SQL alone. Absent by default, so a
   * caller that has not wired one up gets a refusal by name rather than
   * a command that reports success and puts nothing anywhere.
   */
  files?: FileStore;
  /**
   * Where an irreversible purchase is recorded.
   *
   * Server only, behind the service role, because the runtime turns a
   * stored provider answer into database changes and a browser must not
   * be able to write one. Absent means no paid call may be made at all.
   */
  ledger?: ExternalEffectStore;
  /**
   * Whose command this is.
   *
   * The ledger runs under the service role, where there is no
   * `auth.uid()` to take, so the real actor is passed and recorded. It
   * is not a permission: the capability check has already happened
   * against this person's own session.
   */
  actor?: string;
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

  async run({ subjects, ledger, actor, confirmation }) {
    if (LUSHA_GATE.locked) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }
    if (!actor) {
      return { ok: false, why: 'nothing said whose command this is, and a purchase belongs to somebody.' };
    }

    const changes = [];
    const found: string[] = [];

    for (const subject of subjects) {
      const details = detailsOf(subject.values);
      const strategy = nextStrategy(details);
      if (!strategy) continue;

      /* THE CLAIM IS THE PERMISSION TO SPEND.

         Not a look followed by a decision: exactly one of any number of
         simultaneous callers is told `claimed`, by a single insert under
         a primary key, and only that one calls Lusha. Everybody else
         consumes the settled answer, waits, or stops. */
      const key = attemptKey(confirmation, 'contact.enrich', subject.id, strategy);
      const claim = await (ledger ?? NO_LEDGER).claim({
        key, capability: 'contact.enrich', subject: subject.id, strategy, actor,
      });

      let fields: Record<string, unknown> | null = null;
      let via = strategy as string;

      if (claim.state === 'error') {
        return { ok: false, why: `${subject.label}: ${claim.why}` };
      }

      if (claim.state === 'done') {
        /* Already paid for. This is the retry path, and it costs
           nothing. */
        fields = (claim.result.fields ?? {}) as Record<string, unknown>;
        via = String(claim.result.strategy ?? strategy);
      } else if (claim.state === 'failed') {
        return { ok: false, why: `${subject.label}: ${claim.why}` };
      } else if (claim.state === 'in_progress') {
        /* Somebody else is buying this right now. Waiting here would
           hold a request open on a provider nobody can hurry, so it
           stops and says so: the same sentence a moment later finds the
           answer bought and uses it. */
        return {
          ok: false,
          why: `${subject.label} is being looked up right now by another request. `
            + 'Try that again in a moment and it will use what comes back.',
        };
      } else if (claim.state === 'uncertain') {
        /* A claim nobody settled. Lusha has no idempotency key, so
           calling again risks a second charge for an answer that may
           already exist. This stops and asks for the credit to be
           reconciled rather than gambling one. */
        return {
          ok: false,
          why: `${subject.label}: a Lusha call for this was started and never finished, `
            + 'so whether it was charged is unknown. It needs checking against the Lusha '
            + 'account before it is tried again.',
        };
      } else {
        /* claimed. The one caller that may spend. */
        let got: Awaited<ReturnType<typeof PROVIDER.lookUp>>;
        try {
          got = await PROVIDER.lookUp({ ...details, strategy });
        } catch (e) {
          /* The call threw. It may have reached Lusha and been charged,
             and it may never have left. Settled as uncertain rather
             than as failed, because `failed` would let the next attempt
             at this key give up cleanly on a credit that may be gone. */
          await (ledger ?? NO_LEDGER).settle({
            key, actor, state: 'uncertain',
            why: `the call threw: ${e instanceof Error ? e.message : String(e)}`,
          });
          return {
            ok: false,
            why: `${subject.label}: the Lusha call did not come back, so whether it was `
              + 'charged is unknown. It needs checking against the Lusha account.',
          };
        }

        await (ledger ?? NO_LEDGER).settle({
          key, actor,
          state: got.ok ? 'done' : 'failed',
          result: got.ok ? { fields: got.fields, strategy: got.strategy } : null,
          why: got.ok ? null : got.why,
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

/* -------------------------------------------------------------
   Loading a supplier's stock file
   ------------------------------------------------------------- */

/**
 * The units already on the stock list this file could repeat.
 *
 * By the stock dictionary's own duplicate keys, the stock number and the
 * chassis number, and only the values the file holds, so a file of
 * twenty units does not load the stock list. Read through the caller's
 * own store, which is the same comparison the import dialog makes from
 * the rows on its screen.
 */
async function matchingStock(
  store: Store, draft: { rows: { values: Record<string, unknown> }[] },
): Promise<{ ok: true; rows: ExistingRow[] } | { ok: false; why: string }> {
  const found = new Map<string, ExistingRow>();

  for (const key of STOCK_TRAILERS.duplicateKeys) {
    const values = [...new Set(
      draft.rows.map((r) => r.values[key]).filter((v) => v != null && String(v).trim() !== '')
        .map((v) => String(v)),
    )];
    for (let from = 0; from < values.length; from += KEY_PAGE) {
      const slice = values.slice(from, from + KEY_PAGE);
      const read = await store.read({
        table: 'stock_trailers',
        columns: [...new Set(['id', 'stc_no', ...STOCK_TRAILERS.duplicateKeys])],
        where: {
          kind: 'in',
          of: { kind: 'field', of: { entity: 'trailers', field: key } },
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

/**
 * The file, read against the stock dictionary and against the stock list.
 *
 * The same shape as the CRM import's `read`, and for the same reason: a
 * sentence has no mapping screen, which is a reason to compare against
 * what is already on the stock list rather than a reason to skip the
 * comparison. Loading a supplier's file twice would otherwise double
 * every unit on it and report success.
 */
async function readStock(input: PrepareInput) {
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

  if (sheet.rows.length > STOCK_CEILING) {
    return {
      ok: false as const,
      why: `that is ${sheet.rows.length.toLocaleString('en-GB')} rows, which is more than `
        + `${STOCK_CEILING.toLocaleString('en-GB')}. Split the file and import it in parts.`,
    };
  }

  const columns = matchColumns(sheet.headers, sheet.rows, STOCK_TRAILERS);

  const draft = buildPlan(columns, sheet.rows, [], STOCK_TRAILERS);
  const existing = await matchingStock(input.store, draft);
  if (!existing.ok) return existing;

  const plan = buildPlan(columns, sheet.rows, existing.rows, STOCK_TRAILERS);
  const counts = countPlan(plan);
  const wanted = plan.rows.filter((r) => r.decision === 'import');
  const { records, refused } = prepareStock(wanted.map((r) => r.values));

  const mapped = columns.filter((c) => c.target)
    .map((c) => `${c.header} to ${c.field?.label ?? c.target}`);

  const fingerprint = fileDigest([
    fileDigest(file.text),
    mapped.join('|'),
    plan.rows.filter((r) => r.duplicateOf).map((r) => `${r.index}:${r.duplicateOf?.id}`).join('|'),
    JSON.stringify(records),
    'stock',
  ].join('\n'));

  return {
    ok: true as const,
    file, plan, counts, records,
    refused: refused + (sheet.rows.length - wanted.length),
    mapped,
    fingerprint,
  };
}

const importStock: Preparer = {
  async describe(input) {
    const got = await readStock(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return {
        ok: false,
        why: got.counts.duplicates
          ? 'every readable row in that file is already on the stock list, so there is nothing to import.'
          : 'none of those rows had a stock number, so there is nothing to identify them by.',
      };
    }

    const already = got.plan.rows.filter((r) => r.duplicateOf).length;
    const inFile = got.plan.rows.filter((r) => r.duplicateInFile !== undefined).length;
    const bad = got.refused - already - inFile;

    const parts = [
      `${got.records.length.toLocaleString('en-GB')} new `
        + `${got.records.length === 1 ? 'trailer' : 'trailers'} from ${got.file.name} `
        + 'onto the stock list.',
      already
        ? `${already} ${already === 1 ? 'row is' : 'rows are'} already on the stock list and will be left alone.`
        : '',
      inFile
        ? `${inFile} ${inFile === 1 ? 'row repeats' : 'rows repeat'} another row in the same file.`
        : '',
      bad > 0
        ? `${bad} ${bad === 1 ? 'row has' : 'rows have'} no stock number and will be left out.`
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
    const got = await readStock(input);
    if (!got.ok) return got;
    if (!got.records.length) {
      return { ok: false, why: 'there is nothing left in that file to import.' };
    }

    return {
      ok: true,
      steps: [{
        op: 'invoke',
        capability: 'stock.import',
        subjects: [],
        args: { rows: got.records },
      }],
      describe: `Loaded ${got.records.length.toLocaleString('en-GB')} from ${got.file.name} `
        + 'onto the stock list.',
    };
  },
};

/* -------------------------------------------------------------
   Looking for companies that are not customers yet
   ------------------------------------------------------------- */

/**
 * A read of somebody else's index, then ordinary rows.
 *
 * The same SHAPE as an enrichment and not the same COST. `lib/lusha.ts`
 * is explicit that /prospecting/company/search is free and counts only
 * against a daily call quota, so this does not go through the purchase
 * ledger: that exists to make an irreversible debit recoverable and
 * there is no debit here. `describe` still calls nothing, because a
 * preview that used up somebody's quota would be doing the thing it was
 * describing.
 *
 * An incomplete sentence never reaches here. The reader refuses to plan
 * a search with no place at all, because a search of the whole country
 * is one Lusha will answer, against the same shared quota, with a page
 * of companies nobody asked about.
 */
const findCompanies: Preparer = {
  async describe({ args, store }) {
    if (LUSHA_GATE.locked) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }
    const place = String(args.place ?? '').trim();
    if (!place) {
      return {
        ok: false,
        why: 'nothing said where to look, and a search with no place is a search of the whole country.',
      };
    }

    /* Which list, exactly, before anything is spent. A search that
       succeeded and then had nowhere to put what it found would have
       cost the credits either way. */
    const list = await destination(store, args.list as string | undefined);
    if (!list.ok) return list;

    const count = Number(args.count ?? 25) || 25;
    const kind = String(args.industryLabel ?? '').trim();
    const size = sizeSaid(args);

    return {
      ok: true,
      count,
      says: `Searches Lusha for up to ${count} ${kind || 'companies'} `
        + (args.radius ? `within ${args.radius} miles of ${place}` : `near ${place}`)
        + `${size ? `, ${size}` : ''}. One search. `
        /* Said plainly, because the other Lusha operation in this
           application does spend money and somebody reading two
           previews should be able to tell them apart. */
        + 'A company search costs no credits, only one call off the daily quota. '
        + `What it finds goes onto ${list.label} as new customers.`,
      /* The search and where its results go. A list that moved between
         the preview and the confirmation is a different operation. */
      fingerprint: [
        place, args.city, count, args.radius ?? '', args.industry ?? '',
        args.minEmployees ?? '', args.maxEmployees ?? '', list.id ?? 'global',
      ].join('|'),
    };
  },

  async run({ args, store }) {
    if (LUSHA_GATE.locked) {
      return {
        ok: false,
        why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
      };
    }
    const city = String(args.city ?? '').trim();
    if (!city) return { ok: false, why: 'nothing said where to look' };

    const list = await destination(store, args.list as string | undefined);
    if (!list.ok) return list;

    const count = Number(args.count ?? 25) || 25;
    const found = await FINDER.search({
      city,
      radiusMiles: args.radius == null ? undefined : Number(args.radius),
      industryIds: args.industry == null ? undefined : [Number(args.industry)],
      minEmployees: args.minEmployees == null ? undefined : Number(args.minEmployees),
      maxEmployees: args.maxEmployees == null ? undefined : Number(args.maxEmployees),
      limit: count,
    });

    if (!found.length) {
      return {
        ok: false,
        why: `Lusha found nothing matching that near ${args.place ?? city}. Nothing has been added.`,
      };
    }

    return {
      ok: true,
      steps: [{
        op: 'invoke',
        capability: 'rows.import',
        subjects: [],
        args: { rows: asContactRows(found), listId: list.id },
      }],
      describe: `Found ${found.length} ${found.length === 1 ? 'company' : 'companies'} `
        + `and added ${found.length === 1 ? 'it' : 'them'} to ${list.label}.`,
    };
  },
};

/** The size filter, in the words the preview shows. */
function sizeSaid(args: Record<string, unknown>): string {
  const min = args.minEmployees == null ? null : Number(args.minEmployees);
  const max = args.maxEmployees == null ? null : Number(args.maxEmployees);
  if (min != null && max != null) return `with ${min} to ${max} staff`;
  if (min != null) return `with more than ${min} staff`;
  if (max != null) return `with fewer than ${max} staff`;
  return '';
}

/* -------------------------------------------------------------
   Putting a picture on a post
   ------------------------------------------------------------- */

/**
 * A post's image is a file on a bucket and a URL in a column.
 *
 * Neither half is visual. The bytes cannot go in the row, so they go
 * where the composer has always put them, and the column write goes
 * into the programme's own transaction like any other.
 *
 * Taking one off is not here and does not need to be: `image_url` is an
 * ordinary writable column, so "remove the image from this post" is a
 * field clear through the same preview and the same allowlist as any
 * other write.
 */
const postImage: Preparer = {
  async describe({ subjects, context }) {
    const file = context.file;
    if (!file) {
      return { ok: false, why: 'there is no file on this request to put on the post' };
    }
    if (!looksLikeAnImage(file)) {
      return { ok: false, why: `${file.name} is not an image, so it cannot go on a post` };
    }
    if (subjects.length !== 1) {
      return {
        ok: false,
        why: subjects.length
          ? `that matches ${subjects.length} posts, so it is not clear which one the picture goes on`
          : 'nothing said which post the picture goes on',
      };
    }

    const already = String(subjects[0].values.image_url ?? '').trim();
    return {
      ok: true,
      count: 1,
      says: `Puts ${file.name} on ${subjects[0].label}.`
        + (already ? ' It already has a picture, and this replaces it.' : ''),
      /* The file and the post. A different file or a different post is a
         different operation and comes back as a fresh preview. */
      fingerprint: fileDigest([fileDigest(file.text), file.name, subjects[0].id].join('\n')),
    };
  },

  async run({ subjects, context, files, confirmation }) {
    const file = context.file;
    if (!file) {
      return { ok: false, why: 'there is no file on this request to put on the post' };
    }
    if (subjects.length !== 1) {
      return { ok: false, why: 'nothing said which post the picture goes on' };
    }

    /* THE KEY DOES NOT MOVE.

       Derived from the confirmation, the file's own digest, the
       operation and the post it is for, and from no clock at all. The
       first version of this used `Date.now()`, so every retry of the
       same confirmed command uploaded another copy under another key
       and left the first behind for good. */
    const key = stagingKey({
      confirmation,
      digest: fileDigest(file.text),
      operation: 'post.setImage',
      target: subjects[0].id,
      name: file.name,
    });

    const stored = await storeImage(files ?? NO_FILES, {
      key, name: file.name, mime: file.mime, bytes: bytesOf(file.text),
    });
    if (!stored.ok) return { ok: false, why: stored.why };

    /* The column write is the database's, in the programme's own
       transaction. The upload above could not be in it; this always
       could. `staged` is how the caller knows what to take away again
       if it does not commit. */
    return {
      ok: true,
      staged: [{ key: stored.key }],
      steps: [{
        op: 'changes',
        changes: [{
          op: 'update',
          table: 'social_posts',
          id: subjects[0].id,
          set: { image_url: stored.url },
        }],
      }],
      describe: `Put ${file.name} on ${subjects[0].label}.`,
    };
  },
};

/* -------------------------------------------------------------
   A file on the brand kit
   ------------------------------------------------------------- */

/**
 * The same two halves a picture on a post has.
 *
 * The bytes go on the bucket before the transaction, because a bucket
 * cannot be in one, and the row that points at them goes inside it. The
 * key is derived from the confirmation and the file's own digest, so a
 * retry of the same confirmed command reuses the object rather than
 * leaving a second copy nothing references.
 *
 * WHAT THE SENTENCE MAY DECIDE, AND WHAT IT MAY NOT.
 *
 * The kind and the category, both of which the upload menu on the
 * screen also asks for. Everything else is derived here or checked in
 * the database: the name is the file's own, the url is the staged
 * object's, and the kind is one of five words `brand_assets` allows.
 */
const brandUpload: Preparer = {
  async describe({ context, args }) {
    const file = context.file;
    if (!file) {
      return { ok: false, why: 'there is no file on this request to put on the brand kit' };
    }
    if (!BRAND_KINDS.includes(String(args.kind ?? 'image'))) {
      return { ok: false, why: `${String(args.kind)} is not a kind of brand asset` };
    }

    const category = String(args.category ?? '').trim() || 'General';
    return {
      ok: true,
      count: 1,
      says: `Puts ${file.name} on the brand kit as a ${String(args.kind ?? 'image')}`
        + ` under ${category}.`,
      /* The file and what it will be filed as. A different file or a
         different kind is a different operation. */
      fingerprint: fileDigest(
        [fileDigest(file.text), file.name, String(args.kind ?? 'image'), category].join('\n')),
    };
  },

  async run({ context, args, files, confirmation }) {
    const file = context.file;
    if (!file) {
      return { ok: false, why: 'there is no file on this request to put on the brand kit' };
    }
    const kind = String(args.kind ?? 'image');
    if (!BRAND_KINDS.includes(kind)) {
      return { ok: false, why: `${kind} is not a kind of brand asset` };
    }

    const stored = await (files ?? NO_FILES).stage({
      key: stagingKey({
        confirmation,
        digest: fileDigest(file.text),
        operation: 'brand.upload',
        target: null,
        name: file.name,
      }),
      name: file.name,
      mime: file.mime,
      bytes: bytesOf(file.text),
    });
    if (!stored.ok) return { ok: false, why: stored.why };

    return {
      ok: true,
      staged: [{ key: stored.key }],
      steps: [{
        op: 'invoke',
        capability: 'brand.upload',
        subjects: [],
        args: {
          name: file.name,
          kind,
          url: stored.url,
          category: String(args.category ?? '').trim() || null,
        },
      }],
      describe: `Put ${file.name} on the brand kit.`,
    };
  },
};

/** What `brand_assets` allows itself to hold. */
const BRAND_KINDS = ['logo', 'font', 'color', 'template', 'image'];

/**
 * The bytes a request carried, out of the text it carried them as.
 *
 * The bar reads a file as text so a spreadsheet can be parsed on the
 * server, and an image read that way is a data URL. Both shapes end up
 * here as bytes.
 */
function bytesOf(text: string): Uint8Array {
  const base64 = /^data:[^;]*;base64,(.*)$/s.exec(text)?.[1];
  if (base64) return Uint8Array.from(Buffer.from(base64, 'base64'));
  return Uint8Array.from(Buffer.from(text, 'binary'));
}

/* -------------------------------------------------------------
   Refreshing the industry news
   ------------------------------------------------------------- */

/**
 * Fourteen feeds, then the rows.
 *
 * Not SQL and not something a transaction can hold, which is why it is
 * here rather than in the database. Unlike a Lusha lookup it costs
 * nothing, so a failed write is recovered by asking again: there is
 * nothing to be idempotent about.
 *
 * The write is the one in `lib/news/refresh.ts`, which the button uses
 * too, and it happens through the caller's own client so row level
 * security still decides.
 */
const refreshNews: Preparer = {
  async describe() {
    return {
      ok: true,
      count: 0,
      says: `Reads ${FEEDS.length} feeds, drops anything older than ${MAX_AGE_DAYS} days, `
        + 'and adds whatever is new. Nothing is bought and nothing is sent.',
      /* Nothing to fingerprint. What the feeds hold changes second by
         second and refusing on that would refuse every refresh. */
      fingerprint: 'news',
    };
  },

  async run({ store }) {
    const { records, report } = await fetchNews();
    const carried = report.filter((r) => r.itemCount > 0).length;

    /* The rows go into the programme's own transaction, through the
       operation the button uses. The fetch above could not be in it; the
       write always could. */
    return {
      ok: true,
      steps: [{
        op: 'invoke',
        capability: 'news.refresh',
        subjects: [],
        args: { items: records, maxAge: MAX_AGE_DAYS },
      }],
      describe: `Read ${carried} of ${FEEDS.length} feeds and found `
        + `${records.length} ${records.length === 1 ? 'story' : 'stories'} inside the cutoff.`,
    };
  },
};

export const PREPARERS: Record<string, Preparer> = {
  'contact.enrich': enrich,
  'news.refresh': refreshNews,
  'rows.import': importRows,
  'stock.import': importStock,
  'post.setImage': postImage,
  'crm.findCompanies': findCompanies,
  'brand.upload': brandUpload,
};
