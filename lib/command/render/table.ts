/* =============================================================
   Rows, as a thing that can be rendered.

   One model, four renderers, and no renderer knows what a trailer is.
   That is the whole reason there is no "export customers as Word"
   command: the sentence produces a selection, the selection produces
   rows, the rows produce a table, and the table produces a file. Adding
   an entity adds nothing here. Adding a format adds one file.

   THE CELLS ARE FORMATTED ONCE, AND THE NUMBERS SURVIVE.

   A spreadsheet where £24,995 is the text "£24,995" is a spreadsheet
   nobody can sum, so the model carries the typed value beside the
   formatted one and each renderer takes what it can use. CSV and PDF
   take the text; Excel takes the number and applies its own format.
   ============================================================= */
import type { ColumnKind } from '../columns';

export type Cell = {
  /** What a person reads. */
  text: string;
  /** What a spreadsheet should hold, when it is not text. */
  value?: number | Date | null;
};

export type TableColumn = {
  key: string;
  label: string;
  kind: ColumnKind;
};

export type Table = {
  /** The sentence's own summary. What this file is. */
  title: string;
  /** Who asked for it and when. */
  subtitle: string;
  columns: TableColumn[];
  rows: Cell[][];
  /** How many rows, and whether the ceiling cut it short. */
  count: number;
  capped: boolean;
};

const MONEY = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/**
 * One value, in the shape its column says it is.
 *
 * The kind comes from the registry, which gets it from the database, so
 * a column that changes type stops being formatted as the old one
 * without anybody editing a renderer.
 */
export function cellFor(kind: ColumnKind, raw: unknown): Cell {
  if (raw == null || raw === '') return { text: '', value: null };

  if (kind === 'money') {
    const n = Number(raw);
    return Number.isFinite(n) ? { text: MONEY.format(n), value: n } : { text: String(raw) };
  }
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { text: String(raw) };
    return { text: NUMBER.format(n), value: n };
  }
  if (kind === 'date') {
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return { text: String(raw) };
    return {
      text: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      value: d,
    };
  }
  if (kind === 'bool') return { text: raw === true || raw === 'true' ? 'Yes' : 'No' };
  if (Array.isArray(raw)) return { text: raw.join(', ') };
  if (kind === 'enum') return { text: String(raw).replace(/_/g, ' ') };
  return { text: String(raw) };
}

export function buildTable(input: {
  title: string;
  subtitle: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  capped: boolean;
}): Table {
  return {
    title: input.title,
    subtitle: input.subtitle,
    columns: input.columns,
    rows: input.rows.map((r) => input.columns.map((c) => cellFor(c.kind, r[c.key]))),
    count: input.rows.length,
    capped: input.capped,
  };
}

/** A filename somebody can find again, from the sentence rather than a counter. */
export function stemFor(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem || 'export';
}

export type Artefact = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
};
