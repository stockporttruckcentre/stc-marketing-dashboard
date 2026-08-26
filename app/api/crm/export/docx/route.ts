import { NextRequest, NextResponse } from 'next/server';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';
import { loadExportModel } from '@/lib/crm/load-export';
import { exportStem } from '@/lib/crm/export-model';
import { requireCapability } from '@/lib/api/guard';
import { keepAndTell } from '@/lib/notifications/exports';

export const dynamic = 'force-dynamic';

/**
 * A real Word document, not HTML with a .doc extension.
 *
 * The likely use is a printed or emailed account summary that somebody
 * annotates before a meeting, so it is built as a document: styled
 * headings, proper tables with borders and column widths, and notes as
 * readable paragraphs rather than table cells.
 */

const NAVY = '09163A';
const RED = 'CF2417';
const MUTED = '46527A';
const RULE = 'E2E2DE';

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function sectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 19, color: RED, characterSpacing: 30 })],
  });
}

function fieldTable(rows: { label: string; value: string }[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: rows.map((r, i) => new TableRow({
      children: [
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          borders: noBorders,
          shading: i % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F7F7F5' } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r.label, size: 19, color: MUTED })] })],
        }),
        new TableCell({
          width: { size: 68, type: WidthType.PERCENTAGE },
          borders: noBorders,
          shading: i % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F7F7F5' } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r.value, size: 21, color: NAVY })] })],
        }),
      ],
    })),
  });
}

export async function GET(req: NextRequest) {
  /* Same gap as the spreadsheet route: no capability check at all, on
     a whole customer record in one file. See the note there. */
  const gate = await requireCapability('crm.export');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const m = await loadExportModel(id);
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const children: any[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: 'STOCKPORT TRUCK CENTRE', bold: true, size: 16, color: MUTED, characterSpacing: 40 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 60 },
      children: [new TextRun({ text: m.company, bold: true, size: 46, color: NAVY })],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: m.subtitle, size: 21, color: MUTED })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 6 } },
      children: [new TextRun({ text: `Exported by ${m.generatedBy} on ${m.generatedAt}`, size: 17, italics: true, color: MUTED })],
    }),
  ];

  for (const s of m.sections) {
    children.push(sectionHeading(s.title));
    children.push(fieldTable(s.fields.map((f) => ({ label: f.label, value: f.value }))));
  }

  if (m.addresses.length) {
    children.push(sectionHeading('Sites'));
    for (const a of m.addresses) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 20 },
        children: [
          new TextRun({ text: a.label, bold: true, size: 21, color: NAVY }),
          ...(a.primary ? [new TextRun({ text: '   PRIMARY', bold: true, size: 15, color: RED, characterSpacing: 20 })] : []),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: a.address.replace(/\n/g, ', '), size: 20, color: MUTED })],
      }));
    }
  }

  if (m.links.length) {
    children.push(sectionHeading('Links'));
    children.push(fieldTable(m.links.map((l) => ({ label: l.label, value: l.url }))));
  }

  if (m.notes.length) {
    children.push(sectionHeading('Notes and history'));
    for (const n of m.notes) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 20 },
        children: [new TextRun({ text: `${n.author}  ·  ${n.at}`, bold: true, size: 15, color: MUTED, characterSpacing: 20 })],
      }));
      for (const line of n.text.split('\n')) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          indent: { left: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 8 } },
          children: [new TextRun({ text: line, size: 21, color: NAVY })],
        }));
      }
    }
  }

  children.push(new Paragraph({
    spacing: { before: 400 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Stockport Truck Centre  ·  stc-uk.com', size: 16, color: MUTED })],
  }));

  const doc = new Document({
    creator: 'Stockport Truck Centre',
    title: `${m.company} account summary`,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 21, color: NAVY } } },
    },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);

  await keepAndTell(supabase, user.id, {
    bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    filename: `${exportStem(m.company)}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    company: m.company,
    contactId: id,
    what: 'a document',
  });

  return new NextResponse(buf as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${exportStem(m.company)}.docx"`,
    },
  });
}
