import Papa from 'papaparse';

/* =============================================================
   One dropped file, as a list of sheets.

   A CSV is one sheet. A workbook is as many as it has, and this returns
   all of them rather than the first, which is the whole point.

   ---- Why not just take the first sheet ----

   `Dean_Customers.xlsx` has two. Sheet1 is the people: Alpha, Customer
   Name, Contact Name, Contact Number, Contact Email, Location. Sheet2
   is Alpha, FILENAME, Name, which is a list of files and not a person.

   Reading the first sheet and getting on with it would have worked here
   by luck. The next workbook has the summary tab first, and it would
   have auto matched the two columns it recognised, filled nothing, and
   reported a thousand rows of "file has nothing" with no clue why.
   `lib/protean/import.ts` takes the first sheet on purpose, because
   both Protean exports are one report on one sheet. This is not that.

   ---- The encoding ----

   Same as everywhere else: UTF-8 first, Windows-1252 if that produced
   replacement characters. Protean writes 1252 and reading it as UTF-8
   damages an address with an en dash in it. Nothing valid in UTF-8
   contains U+FFFD, so it is a reliable signal rather than a guess.
   ============================================================= */

export type Sheet = {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
};

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  /* A formula cell carries the formula and its last result. The result
     is what the sheet means. A date arrives as a Date. */
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return text(o.result);
    if ('text' in o) return text(o.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((p) => p.text ?? '').join('');
    }
    if ('hyperlink' in o) return text(o.text ?? o.hyperlink);
    return '';
  }
  return String(v);
};

function decode(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
}

export async function readTable(file: File): Promise<Sheet[]> {
  const buffer = await file.arrayBuffer();

  if (!/\.xlsx?$/i.test(file.name)) {
    const res = Papa.parse<Record<string, string>>(decode(buffer), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const rows = (res.data ?? []).filter((r) => Object.values(r).some((v) => v?.trim()));
    return [{
      name: file.name,
      headers: rows.length ? Object.keys(rows[0]) : [],
      rows,
    }];
  }

  /* Loaded on demand. ExcelJS is large and most people drop a CSV. */
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  return wb.worksheets.map((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = text(cell.value).trim();
    });

    const rows: Record<string, string>[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      const out: Record<string, string> = {};
      let any = false;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const key = headers[col - 1];
        if (!key) return;
        /* A non breaking space is a space. Protean and Excel both
           produce them and a phone number with one in it compares
           unequal to the same number without. */
        const v = text(cell.value).replace(/ /g, ' ').trim();
        out[key] = v;
        if (v !== '') any = true;
      });
      if (any) rows.push(out);
    });

    return { name: sheet.name, headers: headers.filter(Boolean), rows };
  }).filter((s) => s.headers.length > 0);
}
