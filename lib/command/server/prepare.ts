/* =============================================================
   Operations whose work happens outside the database.

   Everything else the command runtime performs is SQL, and every
   database effect of one programme goes into one transaction. Some
   operations are not SQL and never can be: looking a company up in
   Lusha is an HTTP call to somebody else's service that spends a credit
   and cannot be rolled back.

   THE ORDER IS THE SAME AS A FILE'S.

     resolve      which records, nothing written
     PREPARE      the outside work happens here
     transact     everything the database does, in one commit

   A file is rendered in the same place and for the same reason: a
   renderer that throws must leave nothing written. An enrichment that
   fails must leave nothing written either, and one that succeeds
   against a transaction that then fails has spent a credit and recorded
   nothing, which is a wasted lookup rather than a customer holding half
   of somebody else's details.

   WHAT A PREPARER RETURNS.

   Changes, for the programme's transaction. That is the whole contract:
   the outside work produces column values and the transaction writes
   them, so the preview, the allowlist, the permission derivation and
   the atomicity all keep working without knowing what Lusha is.

   Registered by capability id, so a capability that declares
   `prepares` and has no entry here is refused by name rather than
   silently doing nothing.
   ============================================================= */
import { lookUpInLusha } from '@/lib/crm/enrich';
import { LUSHA_LOCKED } from '@/lib/crm/permissions';
import type { Change } from '../ir/store';

export type PreparedOperation =
  | { ok: true; changes: Change[]; describe: string }
  | { ok: false; why: string };

export type Preparer = (input: {
  /** The records the operation runs on, as resolved rows. */
  subjects: { id: string; label: string; values: Record<string, unknown> }[];
  args: Record<string, unknown>;
}) => Promise<PreparedOperation>;

/**
 * Looking customers up in Lusha, and the changes that follow.
 *
 * One lookup per record, because Lusha answers about one company at a
 * time. Any of them failing fails the whole thing: a command that
 * enriched four of six and reported success would leave somebody to
 * work out which two, having spent six credits either way.
 */
const enrich: Preparer = async ({ subjects }) => {
  if (LUSHA_LOCKED) {
    return {
      ok: false,
      why: 'Lusha is switched off for everybody at the moment, so no credit can be spent.',
    };
  }

  const changes: Change[] = [];
  const found: string[] = [];

  for (const subject of subjects) {
    const got = await lookUpInLusha({
      email: subject.values.email as string | null,
      companyName: subject.values.company_name as string | null,
      contactName: subject.values.contact_name as string | null,
      websiteUrl: subject.values.website as string | null,
    });
    if (!got.ok) return { ok: false, why: `${subject.label}: ${got.why}` };

    changes.push({ op: 'update', table: 'crm_contacts', id: subject.id, set: got.fields });
    found.push(`${subject.label} by ${got.strategy}`);
  }

  return {
    ok: true,
    changes,
    describe: `Looked up ${found.join(', ')}.`,
  };
};

export const PREPARERS: Record<string, Preparer> = {
  'contact.enrich': enrich,
};
