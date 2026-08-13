import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { loadExportModel } from '@/lib/crm/load-export';
import { exportStem } from '@/lib/crm/export-model';

export const dynamic = 'force-dynamic';

/**
 * A real spreadsheet, not a renamed CSV.
 *
 * Somebody opening this wants to work with the figures: sort the notes by
 * date, sum a column, paste a block into a report. So numbers are stored
 * as numbers with a currency format rather than as text, dates are real
 * dates, headers are frozen, and each kind of record gets its own sheet.
 */

const NAVY = 'FF09163A';
const PAPER = 'FFF7F7F5';

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: NAVY } } };
  });
  row.height = 20;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const m = await loadExportModel(id);
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stockport Truck Centre';
  wb.created = new Date();

  // ---- Customer ----
  const cs = wb.addWorksheet('Customer', { views: [{ state: 'frozen', ySplit: 4 }] });
  cs.columns = [
    { key: 'a', width: 26 },
    { key: 'b', width: 52 },
  ];
  cs.mergeCells('A1:B1');
  const title = cs.getCell('A1');
  title.value = m.company;
  title.font = { bold: true, size: 16, color: { argb: NAVY } };
  cs.getRow(1).height = 24;

  cs.mergeCells('A2:B2');
  const sub = cs.getCell('A2');
  sub.value = m.subtitle;
  sub.font = { size: 10, color: { argb: 'FF7A7A74' } };

  cs.mergeCells('A3:B3');
  cs.getCell('A3').value = `Exported by ${m.generatedBy} on ${m.generatedAt}`;
  cs.getCell('A3').font = { size: 9, italic: true, color: { argb: 'FF7A7A74' } };

  let r = 5;
  for (const section of m.sections) {
    cs.mergeCells(`A${r}:B${r}`);
    const h = cs.getCell(`A${r}`);
    h.value = section.title.toUpperCase();
    h.font = { bold: true, size: 10, color: { argb: 'FFCF2417' } };
    h.border = { bottom: { style: 'thin', color: { argb: 'FFE2E2DE' } } };
    r += 1;
    for (const f of section.fields) {
      const row = cs.getRow(r);
      row.getCell(1).value = f.label;
      row.getCell(1).font = { size: 10, color: { argb: 'FF46527A' } };
      if (f.numeric != null && /value|price|turnover/i.test(f.label)) {
        row.getCell(2).value = f.numeric;
        row.getCell(2).numFmt = '£#,##0';
      } else if (f.numeric != null) {
        row.getCell(2).value = f.numeric;
        row.getCell(2).numFmt = '#,##0';
      } else {
        row.getCell(2).value = f.value;
      }
      row.getCell(2).font = { size: 11 };
      r += 1;
    }
    r += 1;
  }

  // ---- Addresses ----
  if (m.addresses.length) {
    const as = wb.addWorksheet('Addresses', { views: [{ state: 'frozen', ySplit: 1 }] });
    as.columns = [
      { header: 'Site', key: 'label', width: 24 },
      { header: 'Address', key: 'address', width: 56 },
      { header: 'Town or city', key: 'city', width: 22 },
      { header: 'Primary', key: 'primary', width: 11 },
    ];
    styleHeader(as.getRow(1));
    for (const a of m.addresses) {
      as.addRow({ label: a.label, address: a.address, city: a.city, primary: a.primary ? 'Yes' : '' });
    }
    as.eachRow((row, i) => {
      if (i === 1) return;
      row.alignment = { vertical: 'top', wrapText: true };
      if (i % 2 === 0) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } }; });
    });
  }

  // ---- Notes ----
  if (m.notes.length) {
    const ns = wb.addWorksheet('Notes', { views: [{ state: 'frozen', ySplit: 1 }] });
    ns.columns = [
      { header: 'Date', key: 'at', width: 20 },
      { header: 'Author', key: 'author', width: 20 },
      { header: 'Note', key: 'text', width: 84 },
    ];
    styleHeader(ns.getRow(1));
    for (const n of m.notes) {
      const row = ns.addRow({ at: new Date(n.atISO), author: n.author, text: n.text });
      row.getCell(1).numFmt = 'dd mmm yyyy hh:mm';
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }

  // ---- Links ----
  if (m.links.length) {
    const ls = wb.addWorksheet('Links', { views: [{ state: 'frozen', ySplit: 1 }] });
    ls.columns = [
      { header: 'Label', key: 'label', width: 26 },
      { header: 'Kind', key: 'kind', width: 16 },
      { header: 'URL', key: 'url', width: 62 },
    ];
    styleHeader(ls.getRow(1));
    for (const l of m.links) {
      const row = ls.addRow({ label: l.label, kind: l.kind, url: l.url });
      row.getCell(3).value = { text: l.url, hyperlink: l.url } as any;
      row.getCell(3).font = { color: { argb: 'FF2B3F78' }, underline: true };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportStem(m.company)}.xlsx"`,
    },
  });
}
