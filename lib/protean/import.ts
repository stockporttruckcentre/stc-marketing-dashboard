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
  | { ok: true; kind: 'invoices'; rows: InvoiceRow[]; read: number; unusable: number }
  | { ok: true; kind: 'open_jobs'; rows: OpenJobRow[]; read: number; unusable: number }
  | { ok: false; why: string };

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

  if (!headers.length || !rows.length) {
    return {
      ok: false,
      why: 'that file has no header row with rows underneath it. '
        + 'Export it from Protean as CSV and try again.',
    };
  }

  const has = (want: string[]) => want.every((c) => headers.includes(c));

  if (has(INVOICE_MARKERS)) {
    const netCol = moneyColumn(headers, 'Net');
    const taxCol = moneyColumn(headers, 'Tax(');
    const grossCol = moneyColumn(headers, 'Gross');
    if (!netCol) {
      return { ok: false, why: 'that invoice export has no Net column, so there is nothing to count.' };
    }

    const out: InvoiceRow[] = [];
    let unusable = 0;
    for (const r of rows) {
      const invoice_no = text(r, 'Invoice No');
      const alpha = text(r, 'Alpha');
      const tax_point = proteanDate(String(r['Tax Point'] ?? ''));
      const net = proteanMoney(String(r[netCol] ?? ''));
      if (!invoice_no || !alpha || !tax_point || net === null) { unusable += 1; continue; }

      out.push({
        invoice_no,
        document_no: text(r, 'Document No'),
        alpha: alpha.toUpperCase(),
        customer_ref: text(r, 'Customer Ref'),
        protean_name: text(r, 'Customer'),
        site_name: text(r, 'Site Name'),
        created_on: proteanDate(String(r['Created'] ?? '')),
        tax_point,
        due_on: proteanDate(String(r['Due'] ?? '')),
        created_by: text(r, 'Created By'),
        net,
        tax: taxCol ? proteanMoney(String(r[taxCol] ?? '')) : null,
        gross: grossCol ? proteanMoney(String(r[grossCol] ?? '')) : null,
      });
    }
    return { ok: true, kind: 'invoices', rows: out, read: rows.length, unusable };
  }

  if (has(OPEN_JOB_MARKERS)) {
    const totalCol = moneyColumn(headers, 'Job Total');

    const out: OpenJobRow[] = [];
    let unusable = 0;
    for (const r of rows) {
      const job_no = text(r, 'Job No');
      const protean_name = text(r, 'Customer');
      if (!job_no || !protean_name) { unusable += 1; continue; }

      out.push({
        job_no,
        equip_no: text(r, 'Equip No'),
        job_type: text(r, 'Job Type'),
        status: text(r, 'Status'),
        protean_name,
        site: text(r, 'Site'),
        depot: text(r, 'Depot'),
        logged_on: proteanDate(String(r['Logged Date'] ?? '')),
        last_visit_on: proteanDate(String(r['Last Visit Date'] ?? '')),
        entered_by: text(r, 'Entered By'),
        job_total: totalCol ? proteanMoney(String(r[totalCol] ?? '')) : null,
        order_no: text(r, 'Order No'),
        sales_rep: text(r, 'Sales Rep'),
        mileage: text(r, 'Mileage'),
      });
    }
    return { ok: true, kind: 'open_jobs', rows: out, read: rows.length, unusable };
  }

  return {
    ok: false,
    why: 'that is not one of the two Protean exports. '
      + 'The invoice export has Invoice No, Alpha and Tax Point; '
      + 'the open jobs export has Job No, Job Type and Customer.',
  };
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

/** Windows-1252, for the reason in the header. */
export async function readFileAsProtean(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return new TextDecoder('windows-1252').decode(buf);
}
