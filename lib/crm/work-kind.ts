/* =============================================================
   What a maintenance lead is for, in five words the business uses.

   ---- The complaint ----

   From production testing:

     There are too many filters on Maintenance in the sales tracker,
     things like maintenance/brake tests and maintenance/refurb mean the
     same thing really. Need cleaning to just the status filters and just
     a few relative to the type of work the lead is for.

   The chips were built from `crm_leads.what` grouped by its own text,
   folded only for case. That is the right answer to "show me the
   distinct values" and the wrong answer to "what kind of work is this",
   because `what` came off a spreadsheet where people wrote whatever
   described the job: "Maintenance", "maintenance/brake tests",
   "maintenance/refurb", "Maintenance and MOT" are four strings and one
   kind of work. A filter row that offers four ways to say maintenance is
   a filter row nobody reads to the end.

   ---- Why fold in the reader and not in the data ----

   The spelling on the record is the spelling on the sheet it came from,
   and a filter is the wrong place to start rewriting somebody's typing.
   The raw text still shows in the grid, in the drawer, and in every
   export. This decides one thing only: which chip a row sits behind.

   ---- Precedence, and why it is in this order ----

   The strings are phrases, not tags, so most of them match more than
   one pattern: "Van Maintenance and Repair" carries maintenance AND
   repair, "All Services and Parking" carries a contract AND parking.
   First match wins, so the order below IS the rule:

     1. a contract    Trukplan, all services, a maintenance agreement.
                      The thing being sold is cover, whatever jobs it
                      then includes.
     2. an inspection MOT, brake test, tacho, inspection, on their own.
     3. a repair      accident work, refurbishment, bodyshop.
     4. parking       storage and parking, which STC sells separately.
     5. other         anything that matched nothing, kept rather than
                      hidden. A row behind no chip is a row that cannot
                      be found.

   So "maintenance/brake tests" and "maintenance/refurb" both land on
   Contract maintenance, which is the fold the business asked for, and
   "MOT only" lands on its own because that is a different sale.
   ============================================================= */

export type WorkKind = 'contract' | 'inspection' | 'repair' | 'parking' | 'other';

/** In the order they appear as chips. */
export const WORK_KINDS: WorkKind[] = ['contract', 'inspection', 'repair', 'parking', 'other'];

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  contract:   'Contract maintenance',
  inspection: 'MOT and inspection',
  repair:     'Repair and refurb',
  parking:    'Parking and storage',
  other:      'Other work',
};

/** One line each, for the chip's title attribute. */
export const WORK_KIND_HINT: Record<WorkKind, string> = {
  contract:   'Trukplan, all services, and maintenance agreements',
  inspection: 'MOT, brake tests, tacho and inspections on their own',
  repair:     'Accident work, refurbishment and bodyshop',
  parking:    'Parking and storage sold on its own',
  other:      'Anything the wording does not place',
};

/* Tested in order. Each entry is the kind and the words that put a job
   in it. Kept as one table rather than a chain of ifs so the check can
   read the rule rather than restate it. */
const RULES: { kind: WorkKind; words: RegExp }[] = [
  { kind: 'contract',   words: /trukplan|all\s*service|contract|maintenance|servicing|r\s*&\s*m/i },
  { kind: 'inspection', words: /\bmot\b|brake\s*test|\brbt\b|tacho|inspection|\bloler\b|\bpmi\b/i },
  { kind: 'repair',     words: /accident|refurb|repair|bodyshop|body\s*shop|paint|damage/i },
  { kind: 'parking',    words: /park|storage|compound/i },
];

/**
 * Which chip a job sits behind.
 *
 * Blank is `other` rather than its own kind. A maintenance lead with
 * nothing in `what` is a lead somebody has not finished filling in, and
 * a chip called "Blank" invites people to leave it that way.
 */
export function workKindOf(what: string | null | undefined): WorkKind {
  const text = (what ?? '').trim();
  if (!text) return 'other';
  for (const rule of RULES) if (rule.words.test(text)) return rule.kind;
  return 'other';
}

/* =============================================================
   What a new maintenance lead can be raised as.

   The old list was nine phrasings of four jobs, offered as a select on
   the new lead modal and again as the grid's editor, so the tracker was
   generating the very sprawl the fold above exists to undo. These are
   the words that go on a NEW record. Anything already written stays
   exactly as it was typed.
   ============================================================= */
export const MAINTENANCE_WHAT: string[] = [
  'Maintenance contract',
  'Trukplan',
  'All services',
  'MOT and inspection',
  'Accident repair',
  'Refurbishment',
  'Parking and storage',
];

/** The same idea for rental, which had no vocabulary at all. */
export const RENTAL_WHAT: string[] = [
  'Trailer hire',
  'Vehicle hire',
  'Contract hire',
  'Leasing',
  'Spot hire',
];
