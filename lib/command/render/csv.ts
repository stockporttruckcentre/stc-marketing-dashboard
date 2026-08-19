/* =============================================================
   The table as a CSV.

   Papaparse, which this application already uses to READ csv on the
   import screen. Writing it with the same library means one idea of what
   a quoted comma is.
   ============================================================= */
import Papa from 'papaparse';
import { stemFor, type Artefact, type Table } from './table';

export function renderCsv(table: Table): Artefact {
  const body = Papa.unparse({
    fields: table.columns.map((c) => c.label),
    data: table.rows.map((r) => r.map((c) => c.text)),
  }, { newline: '\r\n' });

  /* The title and the count go at the top, commented the way a
     spreadsheet will show them: one cell on their own row. Somebody
     opening this six months later needs to know which question it
     answered, and a bare grid of rows does not say. */
  const header = Papa.unparse({
    fields: [],
    data: [[table.title], [table.subtitle], []],
  }, { newline: '\r\n' });

  const text = `${header}${body}\r\n`;
  return {
    filename: `${stemFor(table.title)}.csv`,
    mime: 'text/csv; charset=utf-8',
    /* A byte order mark, because Excel on Windows opens a UTF-8 CSV as
       Windows-1252 without one and every pound sign comes out wrong. */
    bytes: new TextEncoder().encode(`﻿${text}`),
  };
}
