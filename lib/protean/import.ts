/* =============================================================
   Reading the two Protean exports.

   Both files have fixed headers, because Protean writes them, so there
   is no column mapping step here and there should not be one. The
   generic import dialog asks a person what each column is because
   somebody's own spreadsheet could call it anything. This file always
   arrives the same way, and asking would be theatre.

   What is checked instead is that the file IS one of the two. A person
   dropping last month's stock list into the revenue import should be
   told so, not walked through mapping `Make` onto `Tax Point`.

   ---- The encoding ----

   Both exports are Windows-1252. Read as UTF-8 the pound sign becomes a
   replacement character, `proteanMoney` stops parsing every money
   column, and the import lands with a revenue figure of zero and no
   error anywhere. `proteanMoney` strips the replacement character for
   exactly that reason, so a file read the wrong way still parses, but
   the browser is told the right encoding up front.
   ============================================================= */
import Papa from 'papaparse';
import { CSV_OPTIONS, usableRows } from '@/lib/import/parse';
import { proteanDate, proteanMoney } from '@/lib/protean/customers';

export type InvoiceRow = {
  invoice_no: string;
  document_no: string | null;
  alpha: string;
  customer_ref: string | null;
  protean_name: string | null;
  site_name: string | null;
  created_on: string | null;
  tax_point: string | null;
  due_on: string | null;
  created_by: string | null;
  net: number | null;
  tax: number | null;
  gross: number | null;
};

export type OpenJobRow = {
  job_no: string;
  equip_no: string | null;
  job_type: string | null;
  status: string | null;
  protean_name: string;
  site: string | null;
  depot: string | null;
  logged_on: string | null;
  last_visit_on: string | null;
  entered_by: string | null;
  job_total: number | null;
  order_no: string | null;
  sales_rep: string | null;
  mileage: string | null;
};

/** The columns that say which export this is. */
const INVOICE_MARKERS = ['Invoice No', 'Alpha', 'Tax Point'];
const OPEN_JOB_MARKERS = ['Job No', 'Job Type', 'Customer'];

/* ---- And the third file, which is not Protean at all ----

   From the business:

     it's not accepting the attached file on Revenue which is from SAGE
     not protean. We can only take rental information from sage.

   Rental invoicing is raised in Sage. The export is the same report
   asked of a different system, so it lands in the same table and
   answers the same questions, and only the reading of it differs:

     Document No            the invoice number, zero padded
     Type                   Invoice or Credit Note
     Date                   24/08/2026, day first
     Code                   the account, which is Protean's alpha
     Customer Name          the account's name
     Invoiced Net Value     net
     Total Gross Value      gross

   No tax column, no site, no created by, no due date. Those come back
   null rather than invented, and every figure this application shows is
   built on net, the tax point and the account, all three of which are
   here. */
const SAGE_MARKERS = ['Document No', 'Code', 'Customer Name', 'Invoiced Net Value'];

export type Kind = 'invoices' | 'open_jobs';

/** The money column carries the currency in its name: `Net(£)`. */
function moneyColumn(headers: string[], starts: string): string | null {
  return headers.find((h) => h.toLowerCase().startsWith(starts.toLowerCase())) ?? null;
}

const text = (row: Record<string, unknown>, col: string): string | null => {
  const v = String(row[col] ?? '').trim();
  return v === '' ? null : v;
};

export type Read =
  | { ok: true; kind: 'invoices'; rows: InvoiceRow[]; read: number; unusable: number; blank: number }
  | { ok: true; kind: 'open_jobs'; rows: OpenJobRow[]; read: number; unusable: number; blank: number }
  | { ok: false; why: string };

/**
 * A row that is empty rather than wrong.
 *
 * The rental export lists every invoice number the system has ever
 * issued and fills in only the ones inside the date range asked for.
 * On the first real file that is 335 invoices and 2,653 bare numbers:
 * invoice 2654 is dated 1 April 2025, the first day of the range, and
 * everything numbered below it predates it.
 *
 * Those 2,653 are not rejected data. Counting them as "will not go in"
 * puts a four figure warning on a screen where nothing is wrong, and a
 * warning that is usually wrong is a warning nobody reads on the day it
 * is right.
 */
function isBlankRow(carries: unknown[]): boolean {
  return carries.every((v) => v === null || v === undefined || String(v).trim() === '');
}

/**
 * One dropped file, read as whichever export it is.
 *
 * `unusable` counts rows the database would refuse: no invoice number,
 * no date, no figure. They are counted here and again on the way in, so
 * the number on the screen before the import and the number in the log
 * afterwards come from the same rule.
 */
export function readProteanExport(csv: string): Read {
  const res = Papa.parse<Record<string, unknown>>(csv, CSV_OPTIONS);
  const headers = (res.meta?.fields ?? []).filter((h) => h && h.trim() !== '');
  const rows = usableRows((res.data ?? []) as Record<string, unknown>[]);
  return readProteanRows(headers as string[], rows);
}

/**
 * The same reader, from headers and rows rather than from text.
 *
 * A spreadsheet arrives already parsed and with real types on it: a
 * Date where a CSV has "27-Aug-26", a number where a CSV has "£250.30".
 * Both go through here, because two readers for two file formats is two
 * readers that will eventually disagree about what a column means, and
 * the rental export and the maintenance export are the same report out
 * of two systems.
 */
export function readProteanRows(headers: string[], rows: Record<string, unknown>[]): Read {
  if (!headers.length || !rows.length) {
    return {
      ok: false,
      why: 'that file has no header row with rows underneath it. '
        + 'Export it as CSV or XLSX and try again.',
    };
  }

  const has = (want: string[]) => want.every((c) => headers.includes(c));

  /* SAGE FIRST, because its markers are the more specific pair. Both
     files carry a `Document No`; only Sage carries `Invoiced Net
     Value`, and only Protean carries `Alpha`. Checking Protean first
     would be correct too, and ordering the more specific test first is
     the habit that stays correct when a fourth file arrives. */
  if (has(SAGE_MARKERS)) return readSage(rows);

  if (has(INVOICE_MARKERS)) {
    const netCol = moneyColumn(headers, 'Net');
    const taxCol = moneyColumn(headers, 'Tax(');
    const grossCol = moneyColumn(headers, 'Gross');
    if (!netCol) {
      return { ok: false, why: 'that invoice export has no Net column, so there is nothing to count.' };
    }

    const out: InvoiceRow[] = [];
    let unusable = 0;
    let blank = 0;
    for (const r of rows) {
      const invoice_no = text(r, 'Invoice No');
      const alpha = text(r, 'Alpha');
      const tax_point = proteanDate(r['Tax Point']);
      const net = proteanMoney(r[netCol]);

      /* Everything but the number missing means the export left the row
         behind, not that the row is broken. See `isBlankRow`. */
      if (isBlankRow([alpha, r['Tax Point'], r[netCol], r['Customer']])) { blank += 1; continue; }
      if (!invoice_no || !alpha || !tax_point || net === null) { unusable += 1; continue; }

      out.push({
        invoice_no,
        document_no: text(r, 'Document No'),
        alpha: alpha.toUpperCase(),
        customer_ref: text(r, 'Customer Ref'),
        protean_name: text(r, 'Customer'),
        site_name: text(r, 'Site Name'),
        created_on: proteanDate(r['Created']),
        tax_point,
        due_on: proteanDate(r['Due']),
        created_by: text(r, 'Created By'),
        net,
        tax: taxCol ? proteanMoney(r[taxCol]) : null,
        gross: grossCol ? proteanMoney(r[grossCol]) : null,
      });
    }
    return { ok: true, kind: 'invoices', rows: out, read: rows.length, unusable, blank };
  }

  if (has(OPEN_JOB_MARKERS)) {
    const totalCol = moneyColumn(headers, 'Job Total');

    const out: OpenJobRow[] = [];
    let unusable = 0;
    let blank = 0;
    for (const r of rows) {
      const job_no = text(r, 'Job No');
      const protean_name = text(r, 'Customer');
      if (isBlankRow([protean_name, r['Job Type'], r['Logged Date'], totalCol ? r[totalCol] : null])) {
        blank += 1; continue;
      }
      if (!job_no || !protean_name) { unusable += 1; continue; }

      out.push({
        job_no,
        equip_no: text(r, 'Equip No'),
        job_type: text(r, 'Job Type'),
        status: text(r, 'Status'),
        protean_name,
        site: text(r, 'Site'),
        depot: text(r, 'Depot'),
        logged_on: proteanDate(r['Logged Date']),
        last_visit_on: proteanDate(r['Last Visit Date']),
        entered_by: text(r, 'Entered By'),
        job_total: totalCol ? proteanMoney(r[totalCol]) : null,
        order_no: text(r, 'Order No'),
        sales_rep: text(r, 'Sales Rep'),
        mileage: text(r, 'Mileage'),
      });
    }
    return { ok: true, kind: 'open_jobs', rows: out, read: rows.length, unusable, blank };
  }

  return {
    ok: false,
    why: 'that is not one of the three exports this reads. '
      + 'Protean invoices have Invoice No, Alpha and Tax Point; '
      + 'Protean open jobs have Job No, Job Type and Customer; '
      + 'the Sage rental export has Document No, Code and Invoiced Net Value.',
  };
}

/**
 * The Sage rental export.
 *
 * ---- A credit note is negative and the file does not say so ----
 *
 * Sage writes the VALUE of a credit note, positive, and puts the sign
 * in the `Type` column. Taken at face value a credit note ADDS to
 * revenue, so every one of them is wrong by twice its own value: once
 * for not coming off, and once for going on.
 *
 * On the first real file that is fifteen of six hundred and thirteen
 * documents. Small enough that nobody would spot it in a total and
 * large enough to matter in a board meeting, which is the worst size
 * for a fault to be.
 *
 * Anything that is not an invoice is treated as a credit. There are two
 * types in the file and inverting the test would mean a third type
 * arriving one day and being counted as income by default.
 */
function readSage(rows: Record<string, unknown>[]): Read {
  const out: InvoiceRow[] = [];
  let unusable = 0;
  let blank = 0;

  for (const r of rows) {
    const invoice_no = text(r, 'Document No');
    const alpha = text(r, 'Code');
    const tax_point = proteanDate(r.Date);
    const raw = proteanMoney(r['Invoiced Net Value']);
    const gross = proteanMoney(r['Total Gross Value']);
    const kind = (text(r, 'Type') ?? '').toLowerCase();

    if (isBlankRow([alpha, r.Date, r['Invoiced Net Value'], r['Customer Name']])) {
      blank += 1; continue;
    }
    if (!invoice_no || !alpha || !tax_point || raw === null) { unusable += 1; continue; }

    /* `Math.abs` first, so a file that ever does write the sign itself
       is not flipped back to positive by this. */
    const credit = kind !== '' && kind !== 'invoice';
    const sign = credit ? -1 : 1;

    out.push({
      invoice_no,
      document_no: invoice_no,
      alpha: alpha.toUpperCase(),
      customer_ref: null,
      protean_name: text(r, 'Customer Name'),
      site_name: null,
      created_on: null,
      tax_point,
      due_on: null,
      created_by: null,
      net: sign * Math.abs(raw),
      /* Sage gives no tax column. The difference between gross and net
         IS the tax, and working it out here rather than storing null
         means the figure is there for anybody who asks. */
      tax: gross === null ? null : sign * Math.abs(gross - Math.abs(raw)),
      gross: gross === null ? null : sign * Math.abs(gross),
    });
  }

  return { ok: true, kind: 'invoices', rows: out, read: rows.length, unusable, blank };
}

/**
 * The accounts a file mentions, one row each.
 *
 * The invoice export carries the code, so it is the file that creates
 * accounts. The open jobs export carries only the name, which is why a
 * job can arrive with nowhere to go and why the moderation queue is
 * driven off the invoices.
 */
export function accountsIn(read: Read): { account: string; name: string }[] {
  if (!read.ok || read.kind !== 'invoices') return [];
  const seen = new Map<string, string>();
  for (const r of read.rows) {
    if (!seen.has(r.alpha)) seen.set(r.alpha, r.protean_name ?? r.alpha);
  }
  return [...seen.entries()].map(([account, name]) => ({ account, name }));
}

/**
 * Rows in slices.
 *
 * Twenty thousand invoices in one request is a request that times out
 * on a bad connection and takes the whole file with it. In slices, what
 * landed stays landed and re-sending the file finishes the job, because
 * every write is an upsert on Protean's own key.
 */
export function inBatches<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * The text of a dropped file, in whichever encoding it is actually in.
 *
 * ---- Why this is no longer just Windows-1252 ----
 *
 * The Protean exports are Windows-1252, and reading them as UTF-8 turns
 * the pound sign into a replacement character. That is what the header
 * of this file is about and it has not changed.
 *
 * The Sage rental export is UTF-8 WITH A BYTE ORDER MARK. Read as
 * Windows-1252 those three bytes become the characters `ï»¿`, which
 * land at the front of the first header, so the file's first column is
 * named `ï»¿Document No` and the marker test for it fails. The file
 * then reports as "not one of the exports this reads" with every column
 * present and correct, which is the least helpful way to be wrong.
 *
 * ---- The rule ----
 *
 * UTF-8 first, refusing anything that is not valid UTF-8, then
 * Windows-1252. That is not a guess:
 *
 *   A cp1252 file with a pound sign in it contains byte A3, which is
 *   not valid UTF-8 on its own, so the strict decode throws and the
 *   fallback is taken. Right answer.
 *
 *   A cp1252 file that IS valid UTF-8 is pure ASCII, where the two
 *   encodings agree byte for byte. Either answer is the same answer.
 *
 * So the only files that change behaviour are the ones that were being
 * read wrong.
 */
export async function readFileAsProtean(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    /* The BOM survives a successful decode as U+FEFF and would sit
       inside the first header name. Papa does not strip it. */
    return utf8.charCodeAt(0) === 0xFEFF ? utf8.slice(1) : utf8;
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/**
 * One dropped file, whatever it is.
 *
 * The maintenance export comes out of Protean as CSV. The rental one
 * arrives as a spreadsheet, and asking somebody to save it as CSV first
 * is a step they will forget on the week it matters, having also lost
 * the encoding on the way through.
 *
 * A workbook is read with the first sheet only. Both exports are one
 * report on one sheet, and quietly concatenating a second sheet would
 * double a figure nobody could then explain.
 */
export async function readDroppedFile(file: File): Promise<Read> {
  const isSheet = /\.xlsx?$/i.test(file.name);
  if (!isSheet) return readProteanExport(await readFileAsProtean(file));

  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheet = wb.worksheets[0];
  if (!sheet) return { ok: false, why: 'that workbook has no sheets in it.' };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return;
    const out: Record<string, unknown> = {};
    let any = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col - 1];
      if (!key) return;
      /* A formula cell carries both the formula and its last result.
         The result is what the report means. */
      const v = cell.value && typeof cell.value === 'object' && 'result' in cell.value
        ? (cell.value as { result: unknown }).result
        : cell.value;
      out[key] = v ?? null;
      if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
    });
    if (any) rows.push(out);
  });

  return readProteanRows(headers.filter(Boolean), rows);
}
