/* =============================================================
   May this person write this field?

   One function, called by the server before any command writes
   anything. Not by the bar: the bar already hides what somebody cannot
   do, and hiding is a courtesy, not a boundary. Everything a browser
   sends is a request from an untrusted party, and the request that
   matters is the one that did not come from the bar at all.

   THE BOUNDARY THIS IS, AND THE ONE IT IS NOT.

     application, server side   this file: the actor's capabilities
                                against the field's declared
                                requirement, derived from the same
                                dictionary the parser reads

     PostgreSQL                 row level security, then the writable
                                column shape, then constraints, then
                                one transaction

   They are not the same boundary and neither substitutes for the other.
   `command_writable_columns` says which columns a command may ever name;
   it says nothing about who is asking, and describing it as
   authorisation would be describing a shape check as a permission check.
   Row level security decides which ROWS somebody may write and, in this
   application today, says nothing about which COLUMN: `crm_update` is
   `current_role_safe() IN ('admin','marketer','sales')`, so at the
   database level any of those three may write any writable column of any
   contact they can see.

   THAT GAP IS REAL AND IS RECORDED RATHER THAN PAPERED OVER.

   `crm.assign` and `marketing.approve` are finer than the table level
   policies underneath them, so this check is the only thing enforcing
   them, and it only holds for writes that come through our own server.
   Anything holding a Supabase key can still reach PostgREST directly
   with the coarser permissions. That is existing security debt, written
   down in `docs/command-security-boundaries.md`, and it goes when
   database access moves behind our own server layer. It is not a reason
   to skip this check: the application's own write path is the path this
   application uses.
   ============================================================= */
import { WRITABLE_FIELDS, type WritableField, type WritableEntity } from './fields';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type FieldWriteAuthority =
  | { ok: true; field: WritableField }
  | {
      ok: false;
      /**
       * `unknown field` is a name no command can write, whoever is
       * asking. `not permitted` is a field this person may not write.
       * Different problems, and telling them apart is what lets the
       * second be reported honestly rather than as confusion.
       */
      reason: 'unknown field' | 'not permitted';
      why: string;
      /** The capability the write needed, when it needed one. */
      needed?: string;
    };

/**
 * The field a command names, if this actor may write it.
 *
 * The lookup and the permission check are the same call on purpose. Two
 * calls is two places for one of them to be forgotten, and the one that
 * gets forgotten is always the second.
 */
export function authoriseFieldWrite(
  entity: WritableEntity | string,
  fieldKey: string,
  caps: CrmCapabilities,
): FieldWriteAuthority {
  const field = WRITABLE_FIELDS.find((f) => f.entity === entity && f.key === fieldKey);
  if (!field) {
    return { ok: false, reason: 'unknown field', why: 'that is not a field I can write' };
  }
  if (!caps.has(field.capability)) {
    return {
      ok: false,
      reason: 'not permitted',
      why: `you do not have access to change ${field.label.toLowerCase()}`,
      needed: field.capability,
    };
  }
  return { ok: true, field };
}
