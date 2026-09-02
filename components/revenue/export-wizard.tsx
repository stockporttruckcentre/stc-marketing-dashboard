'use client';

import { useCallback, useMemo, useState } from 'react';
import { Download, Loader, FileSpreadsheet } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { Checkbox, Field, Modal, Select } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';
import {
  yearOnYear, groupRevenue, groupBreakdown, everyOpenJob, companyRevenue,
  waitingOnUs, type Division,
} from '@/lib/protean/rpc';
import {
  exportWindow, inWindow, iso, nice, PERIODS, type PeriodKey,
} from '@/lib/protean/export-window';

/* =============================================================
   Taking the numbers out.

   From the business:

     Have an exports wizard so you can select how much data you want
     from this. Allow it to let you add more tabs on so you could export
     a spreadsheet that covers both customers, groups and open work and
     just a 3 month period if you wanted. Ensure it's nicely formatted
     like the webpage.

   ---- What it exports ----

   The same figures the screen shows, from the same functions the screen
   calls. Not a second query written to be convenient for a spreadsheet:
   an export that computes its own totals is an export that eventually
   disagrees with the page it came from, and the person holding the
   spreadsheet is the one in the meeting.

   ---- The period ----

   Every revenue figure on this screen is measured from the start of the
   company's year, so a period here does NOT change what "this year"
   means. It filters the rows: which invoices, which jobs. A three month
   export is three months of documents with the year to date totals
   still reading as the year to date, because moving the goalposts
   silently is how two people end up quoting different numbers from the
   same file.

   ---- The formatting ----

   Panton for headings, tabular figures, the company's navy in the
   header row, and every money column formatted as money by the
   spreadsheet rather than as text that looks like money. A finance team
   that has to re-type a column has been handed a picture of data.
   ============================================================= */

type SheetKey = 'customers' | 'groups' | 'open' | 'accounts' | 'summary';

const SHEETS: { key: SheetKey; label: string; what: string }[] = [
  { key: 'summary', label: 'Summary', what: 'The headline figures, as the screen shows them' },
  { key: 'customers', label: 'Customers', what: 'Every customer, this year against last' },
  { key: 'groups', label: 'Groups', what: 'Each group, and every account inside it' },
  { key: 'open', label: 'Open work', what: 'Every job open on the system' },
  { key: 'accounts', label: 'Accounts waiting', what: 'Protean accounts with no customer yet' },
];

const NAVY = 'FF09163A';

export function ExportWizard({ division, divisionName, fyStarted, onClose }: {
  division: Division;
  divisionName: string;
  /** The day the company's year began, so a period can start there. */
  fyStarted: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const { say } = useToast();

  const [chosen, setChosen] = useState<Set<SheetKey>>(new Set(['summary', 'customers']));
  const [period, setPeriod] = useState<PeriodKey>('fy');
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = (k: SheetKey) => setChosen((was) => {
    const next = new Set(was);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  /* The window, worked out once and shown on the screen before the
     button is pressed, so nobody has to guess what "3 months" counted
     from. The arithmetic lives in lib/protean/export-window.ts because
     it ends up in a spreadsheet somebody acts on: three months back
     from 31 May is 28 February, and the obvious way to write it lands
     on 3 March and quietly drops February. */
  const window = useMemo(() => exportWindow(period, fyStarted), [period, fyStarted]);

  const run = useCallback(async () => {
    if (!chosen.size) return;
    setBusy('Reading the figures');
    try {
      const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      wb.creator = 'STC Workspace';
      wb.created = new Date();

      const within = (d: string | null | undefined) => inWindow(d, window);

      if (chosen.has('summary')) {
        setBusy('Reading the summary');
        const c = await companyRevenue(supabase, division);
        const s = sheet(wb, 'Summary', [
          { header: 'Figure', width: 34 },
          { header: 'Amount', width: 18, money: true },
        ]);
        const rows: [string, number | string][] = [
          [`Invoiced since ${c?.fy_started ? nice(c.fy_started) : 'the year began'}`, Number(c?.this_year ?? 0)],
          ['Same point last year', Number(c?.last_year ?? 0)],
          ['The whole of last year', Number(c?.last_year_full ?? 0)],
          ['Up or down', Number(c?.change ?? 0)],
          ['Jobs open', Number(c?.open_jobs ?? 0)],
          ['Value of open jobs', Number(c?.open_value ?? 0)],
          ['Customers billing', Number(c?.customers ?? 0)],
          ['On accounts with no customer yet', Number(c?.unattributed ?? 0)],
          ['On accounts set aside', Number(c?.set_aside ?? 0)],
        ];
        for (const r of rows) s.addRow(r);
        /* Counts are not money, so they do not get the money format. */
        for (const n of [5, 7]) s.getCell(`B${n}`).numFmt = '#,##0';
      }

      if (chosen.has('customers')) {
        setBusy('Reading the customers');
        const rows = await yearOnYear(supabase, division);
        const s = sheet(wb, 'Customers', [
          { header: 'Customer', width: 40 },
          { header: 'This year', width: 15, money: true },
          { header: 'Last year', width: 15, money: true },
          { header: 'Whole of last year', width: 18, money: true },
          { header: 'Change', width: 15, money: true },
          { header: 'Jobs open', width: 11, count: true },
          { header: 'Open value', width: 15, money: true },
          { header: 'Last billed', width: 14 },
          { header: 'Protean accounts', width: 26 },
        ]);
        for (const r of rows) {
          s.addRow([
            r.company_name, Number(r.this_year), Number(r.last_year),
            Number(r.last_year_full ?? 0), Number(r.change),
            Number(r.open_jobs), Number(r.open_value),
            r.last_billed ?? '', (r.alphas ?? []).join(', '),
          ]);
        }
        total(s, [2, 3, 4, 5, 7], [6]);
      }

      if (chosen.has('groups')) {
        setBusy('Reading the groups');
        const groups = await groupRevenue(supabase);
        const s = sheet(wb, 'Groups', [
          { header: 'Group', width: 32 },
          { header: 'Customer', width: 34 },
          { header: 'Protean account', width: 20 },
          { header: 'This year', width: 15, money: true },
          { header: 'Last year', width: 15, money: true },
          { header: 'Change', width: 15, money: true },
          { header: 'Jobs open', width: 11, count: true },
          { header: 'Open value', width: 15, money: true },
        ]);
        for (const g of groups) {
          s.addRow([
            g.group_name, 'All of it', `${g.customers} customers, ${g.accounts} accounts`,
            Number(g.this_year), Number(g.last_year), Number(g.change),
            Number(g.open_jobs), Number(g.open_value),
          ]).font = { bold: true, name: 'Arial' };
          const lines = await groupBreakdown(supabase, g.group_id);
          for (const l of lines) {
            s.addRow([
              '', l.company_name, `${l.protean_name} (${l.alpha})`,
              Number(l.this_year), Number(l.last_year), Number(l.change),
              Number(l.open_jobs), Number(l.open_value),
            ]);
          }
        }
      }

      if (chosen.has('open')) {
        setBusy('Reading the open work');
        const jobs = (await everyOpenJob(supabase, division)).filter((j) => within(j.logged_on));
        const s = sheet(wb, 'Open work', [
          { header: 'Job', width: 12 },
          { header: 'Customer', width: 38 },
          { header: 'Type', width: 22 },
          { header: 'Depot', width: 14 },
          { header: 'Logged', width: 13 },
          { header: 'Days open', width: 11, count: true },
          { header: 'Value', width: 14, money: true },
          { header: 'Account', width: 14 },
        ]);
        for (const j of jobs) {
          s.addRow([
            j.job_no, j.protean_name, j.job_type ?? '', j.depot ?? '',
            j.logged_on ?? '', daysSince(j.logged_on) ?? '',
            Number(j.job_total ?? 0), j.alpha ?? 'no account',
          ]);
        }
        total(s, [7], [6]);
      }

      if (chosen.has('accounts')) {
        setBusy('Reading the queue');
        const waiting = await waitingOnUs(supabase, division);
        const s = sheet(wb, 'Accounts waiting', [
          { header: 'Protean account', width: 16 },
          { header: 'As Protean names them', width: 40 },
          { header: 'Invoices', width: 11, count: true },
          { header: 'Billed', width: 15, money: true },
          { header: 'First billed', width: 13 },
          { header: 'Last billed', width: 13 },
          { header: 'Jobs open', width: 11, count: true },
        ]);
        for (const w of waiting) {
          s.addRow([
            w.alpha, w.protean_name, Number(w.invoices), Number(w.net),
            w.first_billed ?? '', w.last_billed ?? '', Number(w.open_jobs),
          ]);
        }
        total(s, [4], [3, 7]);
      }

      setBusy('Building the spreadsheet');
      const buf = await wb.xlsx.writeBuffer();
      const name = `STC ${divisionName} revenue ${iso(new Date())}.xlsx`;
      download(new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }), name);

      say({ tone: 'success', title: `${name} is in your downloads.` });
      onClose();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'The export would not build.' });
    } finally {
      setBusy(null);
    }
  }, [chosen, supabase, division, divisionName, window, say, onClose]);

  return (
    <Modal
      title="Export"
      description={`${divisionName}, as a spreadsheet.`}
      onClose={busy ? undefined : onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={!!busy || !chosen.size}>
            {busy ? <Loader size={14} className="spin" /> : <Download size={14} />}
            {busy ?? `Export ${chosen.size} ${chosen.size === 1 ? 'sheet' : 'sheets'}`}
          </Button>
        </>
      }
    >
      <Label>What goes in it</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '8px 0 18px' }}>
        {SHEETS.map((s) => (
          <div
            key={s.key}
            style={{
              padding: '9px 10px',
              border: '1px solid var(--border)', borderRadius: 'var(--r)',
              background: chosen.has(s.key) ? 'var(--surface-sunken)' : 'transparent',
            }}
          >
            <Checkbox
              checked={chosen.has(s.key)}
              onChange={() => toggle(s.key)}
              label={s.label}
              hint={s.what}
            />
          </div>
        ))}
      </div>

      <Field
        label="How far back"
        hint={`Filters which invoices and jobs go in: ${window.label}. The year to date totals still read as the year to date.`}
      >
        <Select value={period} onChange={(v: string) => setPeriod(v as PeriodKey)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </Select>
      </Field>

      {chosen.has('groups') && (
        <div style={{ marginTop: 14 }}>
          <Alert tone="info">
            Groups are the whole company rather than one division, because a group spans them.
            Every other sheet is {divisionName}.
          </Alert>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
        fontSize: 12, color: 'var(--text-subtle)',
      }}>
        <FileSpreadsheet size={13} />
        One workbook, one sheet each, formatted as money rather than as text that looks like money.
        {chosen.size > 0 && <Badge tone="neutral">{chosen.size}</Badge>}
      </div>
    </Modal>
  );
}

/* ---------- the spreadsheet itself ---------- */

type ColSpec = { header: string; width: number; money?: boolean; count?: boolean };

/**
 * A sheet with the company's header row and its columns already
 * formatted.
 *
 * Money is a NUMBER with a currency format on it, never a string
 * carrying a pound sign. A finance team that has to re-type a column
 * has been handed a picture of data rather than data.
 */
function sheet(wb: any, name: string, cols: ColSpec[]) {
  const s = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  s.columns = cols.map((c) => ({ header: c.header, width: c.width }));

  const head = s.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;

  cols.forEach((c, i) => {
    const col = s.getColumn(i + 1);
    if (c.money) { col.numFmt = '£#,##0.00'; col.alignment = { horizontal: 'right' }; }
    else if (c.count) { col.numFmt = '#,##0'; col.alignment = { horizontal: 'right' }; }
  });
  s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return s;
}

/** A totals row, so nobody adds the column up by hand and gets it wrong. */
function total(s: any, moneyCols: number[], countCols: number[]) {
  const last = s.rowCount;
  if (last < 2) return;
  const row = s.addRow([]);
  row.getCell(1).value = 'Total';
  row.font = { bold: true, name: 'Arial' };
  row.border = { top: { style: 'thin' } };
  for (const c of [...moneyCols, ...countCols]) {
    row.getCell(c).value = { formula: `SUM(${letter(c)}2:${letter(c)}${last})` };
  }
}

const letter = (n: number) => String.fromCharCode(64 + n);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Freed on the next tick rather than immediately: revoking before the
     browser has started the download cancels it in Safari. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function daysSince(d: string | null): number | null {
  if (!d) return null;
  return Math.round((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86_400_000);
}
