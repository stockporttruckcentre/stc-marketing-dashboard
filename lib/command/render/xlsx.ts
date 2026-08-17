/* =============================================================
   The table as a real spreadsheet.

   ExcelJS, the same library and the same house style as
   `app/api/crm/export/xlsx/route.ts`, which builds the single customer
   export. That file writes a fixed shape for one record; this writes
   whatever rows a sentence selected. The styling is shared through
   `THEME` so the two cannot drift into looking like different products.

   Numbers stay numbers and dates stay dates. A spreadsheet where
   £24,995 is the text "£24,995" is a spreadsheet nobody can sum, and
   somebody who exports a list of sold trailers is going to sum it.
   ============================================================= */
import ExcelJS from 'exceljs';
import { stemFor, type Artefact, type Table } from './table';

export const THEME = {
  navy: 'FF09163A',
  red: 'FFCF2417',
  muted: 'FF7A7A74',
  rule: 'FFE2E2DE',
  paper: 'FFF7F7F5',
};

export async function renderXlsx(table: Table): Promise<Artefact> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stockport Truck Centre';
  wb.created = new Date();

  const ws = wb.addWorksheet('Export', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = table.columns.map((c) => ({
    key: c.key,
    width: Math.min(Math.max(c.label.length + 4, 12), 40),
  }));

  const lastColumn = String.fromCharCode(64 + Math.min(table.columns.length, 26));

  ws.mergeCells(`A1:${lastColumn}1`);
  const title = ws.getCell('A1');
  title.value = table.title;
  title.font = { bold: true, size: 14, color: { argb: THEME.navy } };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${lastColumn}2`);
  const sub = ws.getCell('A2');
  sub.value = table.subtitle;
  sub.font = { size: 9, italic: true, color: { argb: THEME.muted } };

  const header = ws.getRow(4);
  table.columns.forEach((c, i) => { header.getCell(i + 1).value = c.label; });
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.navy } };
    cell.alignment = { vertical: 'middle' };
  });
  header.height = 18;

  table.rows.forEach((cells, r) => {
    const row = ws.getRow(5 + r);
    cells.forEach((cell, i) => {
      const target = row.getCell(i + 1);
      const kind = table.columns[i].kind;
      if (cell.value == null) {
        target.value = cell.text || null;
      } else if (kind === 'money') {
        target.value = cell.value as number;
        target.numFmt = '£#,##0.00';
      } else if (kind === 'number') {
        target.value = cell.value as number;
        target.numFmt = '#,##0';
      } else if (kind === 'date') {
        target.value = cell.value as Date;
        target.numFmt = 'dd mmm yyyy';
      } else {
        target.value = cell.text;
      }
      target.font = { size: 10 };
      target.alignment = { vertical: 'top', wrapText: kind === 'longtext' };
    });
    if (r % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.paper } };
      });
    }
  });

  const foot = ws.getRow(6 + table.rows.length);
  /* Every row the selection described. A file that holds fewer than
     it says is refused before it is built, so this figure is the whole
     answer rather than as much of it as fitted. */
  foot.getCell(1).value = `${table.count} ${table.count === 1 ? 'row' : 'rows'}.`;
  foot.getCell(1).font = { size: 9, italic: true, color: { argb: THEME.muted } };

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: table.columns.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    filename: `${stemFor(table.title)}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: new Uint8Array(buffer as ArrayBuffer),
  };
}
