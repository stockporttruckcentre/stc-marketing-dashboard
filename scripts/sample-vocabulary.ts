/* =============================================================
   What the database actually holds, for the checks.

   The bar learns its values from the database: makes from
   `stock_trailers.make`, depots from `location`, customers from
   `customer`. A check has no database, so it needs a stand in for what
   /api/command/vocabulary returns.

   The first version of this file was written from memory and was wrong
   in a way that mattered. It listed DAF, Volvo, Scania, MAN, Mercedes,
   Iveco and Renault as trailer makes. Those are truck manufacturers.
   STC sells trailers, and the real make column holds Don Bur, Tiger,
   SDC, Dennison, Cartwright, Krone, Montracon, Gray & Adams and
   Schmitz. A check running against invented values proves the parser
   handles invented values.

   So this reads the real rows instead. `app/api/admin/import-sold-2026`
   carries a hundred and ten genuine STC stock records, and the distinct
   values of their columns are exactly what the vocabulary endpoint
   would return from a small database. Nothing here is typed by hand.

   It comes with the messiness intact, which is the point: `Don Bur` and
   `DonBur` are both in that column, and so are `Dukinfield` and
   `DUKINFIELD`. A fixture that tidied those up would be testing a
   database STC does not have.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, type VocabularyIndex } from '../lib/command/vocab';

const SOURCE = join(process.cwd(), 'app/api/admin/import-sold-2026/rows.json');

type Row = Record<string, unknown>;

function realRows(): Row[] {
  try {
    const parsed = JSON.parse(readFileSync(SOURCE, 'utf8'));
    return Array.isArray(parsed) ? parsed as Row[] : [];
  } catch {
    return [];
  }
}

/** Distinct values of a column, commonest first, the way the endpoint returns them. */
function distinct(rows: Row[], column: string): { value: string; rows: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[column] ?? '').trim();
    if (v.length < 2 || v.length > 60) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, n]) => ({ value, rows: n }))
    .sort((a, b) => b.rows - a.rows);
}

/**
 * Depots the business has, beyond the ones this sold-stock extract
 * happens to mention.
 *
 * Not invented: `DEPOTS` in the lexicon is the list somebody wrote down
 * from the business, and the extract only covers the sites that sold
 * something in one period. Taking it from there keeps the fixture and
 * the app agreeing about where STC has yards.
 */
import { DEPOTS } from '../lib/command/lexicon';

export function loadSampleVocabulary(): VocabularyIndex {
  const rows = realRows();

  const depots = [
    ...distinct(rows, 'location'),
    ...[...new Set(Object.values(DEPOTS))].map((value) => ({ value, rows: 1 })),
  ];

  return buildIndex({
    trailers: {
      make: distinct(rows, 'make'),
      model: distinct(rows, 'model'),
      location: depots,
      customer: distinct(rows, 'customer'),
      sales_rep: distinct(rows, 'sales_rep'),
    },
    /* The CRM side of the same records. A company that bought a trailer
       is a company in the CRM, and the reps are the same people. */
    contacts: {
      location: depots,
      assigned_to: distinct(rows, 'sales_rep'),
    },
    deals: {
      company_name: distinct(rows, 'customer'),
      location: depots,
      assigned_to: distinct(rows, 'sales_rep'),
    },
    /* The brand kit's own rows. There are exactly two colours in it and
       everybody calls them by half their name, which is what a live
       vocabulary is for: "the navy" reaches "Navy Primary" because that
       is what the row is called. */
    brand: {
      name: [
        { value: 'Navy Primary', rows: 1 },
        { value: 'STC Red', rows: 1 },
      ],
    },
  });
}

/** What the fixture found, so a check can say when it found nothing. */
export function sampleSize(): number {
  return realRows().length;
}
