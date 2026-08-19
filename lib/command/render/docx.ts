/* =============================================================
   The table as a real Word document.

   The `docx` library, which this application already uses for the single
   customer export in `app/api/crm/export/docx/route.ts`, and the same
   house colours. That file writes a fixed shape for one record; this
   writes whatever rows a sentence selected.

   Landscape, because a selection can name a lot of columns and a
   portrait page turns a fifteen column table into unreadable slivers.
   ============================================================= */
import {
  AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph,
  ShadingType, Table as DocTable, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { stemFor, type Artefact, type Table } from './table';

const NAVY = '09163A';
const RED = 'CF2417';
const MUTED = '7A7A74';
const RULE = 'E2E2DE';
const PAPER = 'F7F7F5';

const thin = { style: BorderStyle.SINGLE, size: 2, color: RULE };
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };

function headerCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: NAVY },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    borders: cellBorders,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 15, color: 'FFFFFF' })],
    })],
  });
}

function bodyCell(text: string, width: number, striped: boolean, numeric: boolean) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: striped ? { type: ShadingType.CLEAR, fill: PAPER } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    borders: cellBorders,
    children: [new Paragraph({
      alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text, size: 15, color: NAVY })],
    })],
  });
}

export async function renderDocx(table: Table): Promise<Artefact> {
  const width = Math.floor(100 / Math.max(table.columns.length, 1));

  const grid = new DocTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: table.columns.map((c) => headerCell(c.label, width)),
      }),
      ...table.rows.map((cells, r) => new TableRow({
        children: cells.map((cell, i) => bodyCell(
          cell.text, width, r % 2 === 1,
          table.columns[i].kind === 'money' || table.columns[i].kind === 'number',
        )),
      })),
    ],
  });

  const doc = new Document({
    creator: 'Stockport Truck Centre',
    title: table.title,
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, bottom: 720, left: 720, right: 720 },
        },
      },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: table.title, bold: true, size: 30, color: NAVY })],
        }),
        new Paragraph({
          spacing: { after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED, space: 6 } },
          children: [new TextRun({ text: table.subtitle, size: 17, color: MUTED, italics: true })],
        }),
        ...(table.rows.length
          ? [grid]
          : [new Paragraph({
              children: [new TextRun({ text: 'Nothing matched that.', size: 19, color: MUTED })],
            })]),
        new Paragraph({
          spacing: { before: 240 },
          children: [new TextRun({
            text: `${table.count} ${table.count === 1 ? 'row' : 'rows'}.`,
            size: 15, color: MUTED, italics: true,
          })],
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    filename: `${stemFor(table.title)}.docx`,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: new Uint8Array(buffer),
  };
}
