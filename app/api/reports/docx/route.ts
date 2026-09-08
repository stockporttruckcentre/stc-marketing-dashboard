import { NextRequest, NextResponse } from 'next/server';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';
import { requireCapability } from '@/lib/api/guard';
import { buildReport } from '@/lib/reports/build';
import { fromParams, slugFromParams } from '@/lib/reports/link';
import type { Report, Section } from '@/lib/reports/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   A report as a real Word document.

   The same treatment the customer export already gets, and the same
   reason for it: somebody prints this, writes on it, and takes it into a
   meeting. HTML with a .doc extension opens in Word and looks like a web
   page that has fallen over.

   ---- Why this reads the Report shape and not the database ----

   Because a report is data by the time it reaches here. `buildReport`
   has already asked every question, so this file only has to know how to
   draw four kinds of section. Adding a tenth report gives you the Word
   version for nothing, which is the entire point of the shape.

   The filters come out of the URL through the same reader the print page
   uses, so the Word copy of a link cannot differ from the printed copy
   of the same link.
   ============================================================= */

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

const hairline = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function sectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 320, after: 110 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
    children: [new TextRun({
      text: text.toUpperCase(), bold: true, size: 19, color: RED, characterSpacing: 30,
    })],
  });
}

function note(text: string) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 17, color: MUTED, italics: true })],
  });
}

function emptyLine(text: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 19, color: MUTED, italics: true })],
  });
}

/** Headline figures, as a row of cells rather than a paragraph of numbers. */
function statsTable(stats: { label: string; value: string; sub?: string }[]) {
  const width = Math.max(1, Math.round(100 / stats.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({
      children: stats.map((s) => new TableCell({
        width: { size: width, type: WidthType.PERCENTAGE },
        borders: noBorders,
        shading: { type: ShadingType.CLEAR, fill: 'F7F7F5' },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [
          new Paragraph({
            spacing: { after: 30 },
            children: [new TextRun({
              text: s.label.toUpperCase(), bold: true, size: 14, color: MUTED, characterSpacing: 24,
            })],
          }),
          new Paragraph({
            spacing: { after: s.sub ? 20 : 0 },
            children: [new TextRun({ text: s.value, bold: true, size: 28, color: NAVY })],
          }),
          ...(s.sub ? [new Paragraph({
            children: [new TextRun({ text: s.sub, size: 15, color: MUTED })],
          })] : []),
        ],
      })),
    })],
  });
}

function dataTable(
  columns: { key: string; label: string; align?: 'left' | 'right' }[],
  rows: Record<string, string | number | null>[],
) {
  const width = Math.max(1, Math.round(100 / columns.length));
  const head = new TableRow({
    tableHeader: true,
    children: columns.map((c) => new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      borders: {
        ...hairline,
        bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY },
      },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: c.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({
          text: c.label.toUpperCase(), bold: true, size: 14, color: MUTED, characterSpacing: 20,
        })],
      })],
    })),
  });

  const body = rows.map((r, i) => new TableRow({
    children: columns.map((c) => new TableCell({
      borders: hairline,
      shading: i % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'FAFAF8' } : undefined,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: c.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: String(r[c.key] ?? '—'), size: 18, color: NAVY })],
      })],
    })),
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [head, ...body],
  });
}

function sectionBlocks(s: Section): any[] {
  if (s.kind === 'note') {
    return [
      ...(s.title ? [sectionHeading(s.title)] : []),
      new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: s.text, size: 19, color: NAVY })],
      }),
    ];
  }

  const head = [sectionHeading(s.title), ...(s.note ? [note(s.note)] : [])];

  if (s.kind === 'stats') return [...head, statsTable(s.stats)];

  if (s.kind === 'list') {
    if (s.items.length === 0) return [...head, emptyLine(s.empty ?? 'Nothing to show.')];
    const out: any[] = [...head];
    for (const i of s.items) {
      const marker = i.tone === 'danger' ? RED : i.tone === 'warning' ? 'B7791F' : NAVY;
      out.push(new Paragraph({
        spacing: { before: 130, after: 20 },
        indent: { left: 140 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: marker, space: 8 } },
        children: [new TextRun({ text: i.title, bold: true, size: 20, color: NAVY })],
      }));
      if (i.detail) {
        out.push(new Paragraph({
          spacing: { after: 20 }, indent: { left: 140 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: marker, space: 8 } },
          children: [new TextRun({ text: i.detail, size: 19, color: NAVY })],
        }));
      }
      if (i.meta) {
        out.push(new Paragraph({
          spacing: { after: 40 }, indent: { left: 140 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: marker, space: 8 } },
          children: [new TextRun({ text: i.meta, size: 16, color: MUTED })],
        }));
      }
    }
    return out;
  }

  if (s.rows.length === 0) return [...head, emptyLine(s.empty ?? 'Nothing to show.')];
  return [...head, dataTable(s.columns, s.rows)];
}

/** A filename somebody can find again. No spaces, no punctuation Windows dislikes. */
function stem(report: Report): string {
  const day = new Date(report.generatedAt).toISOString().slice(0, 10);
  const name = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `stc-${name}-${day}`;
}

export async function GET(req: NextRequest) {
  const gate = await requireCapability('crm.export');
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  const slug = slugFromParams(params);
  if (!slug) return NextResponse.json({ error: 'No such report.' }, { status: 400 });

  const filters = fromParams(slug, params);
  const made = await buildReport(gate.supabase as never, slug, filters);
  if ('error' in made) return NextResponse.json(made, { status: 400 });

  const children: any[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({
        text: 'STOCKPORT TRUCK CENTRE', bold: true, size: 16, color: MUTED, characterSpacing: 40,
      })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 60 },
      children: [new TextRun({ text: made.title, bold: true, size: 44, color: NAVY })],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: made.subtitle, size: 21, color: MUTED })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 6 } },
      children: [new TextRun({
        text: `Run by ${gate.fullName} on ${new Date(made.generatedAt).toLocaleString('en-GB')}`,
        size: 17, italics: true, color: MUTED,
      })],
    }),
  ];

  if (made.sections.length === 0) {
    children.push(emptyLine('Every section was switched off, so this report has no content.'));
  }
  for (const s of made.sections) children.push(...sectionBlocks(s));

  children.push(new Paragraph({
    spacing: { before: 400 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: 'Figures come from the systems that own them: invoiced revenue from Protean, '
        + 'deals from the sales tracker, stock from the stock list.',
      size: 15, color: MUTED,
    })],
  }));

  const doc = new Document({
    creator: 'Stockport Truck Centre',
    title: made.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 20, color: NAVY } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  return new NextResponse(buf as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${stem(made)}.docx"`,
    },
  });
}
