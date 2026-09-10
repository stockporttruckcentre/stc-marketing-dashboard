'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, Check, Loader, ArrowLeft } from 'lucide-react';
import { Button, Badge, Alert } from '@/components/kit/primitives';
import { Modal, Select } from '@/components/kit/forms';
import { createClient } from '@/lib/supabase/client';
import { extractCityFromAddress } from '@/lib/uk-cities';
import { readTable, type Sheet } from '@/lib/import/read-table';

/* =============================================================
   Filling in what the CRM is missing, from somebody else's file.

   From the business:

     on the attached spreadsheet is the email addresses, phone numbers
     and business addresses of the companies in the crm that is missing
     this data. Any customers on the attached that are not on the crm
     should not import as new accounts, only update existing records.
     The name might not be a 1:1 match from the attached to the crm and
     it needs to get around that without mistake.

   ---- Why this is not the Import dialog ----

   That one creates records. This one must never create one, and the
   two flows disagree about almost everything after the file is read:
   what a match means, what a non match means, and what "already here"
   should do. Folding an update only mode into it would have put a
   branch through every step of a dialog whose whole job is that
   nothing is written the user has not seen.

   ---- Where the thinking happens ----

   In the database, in `crm_enrichment_plan` (migration 106). It has the
   CRM in front of it and this page does not. It matches on the Protean
   account code first, which somebody has already confirmed by binding
   it, and falls back to a normalised name only where that name picks
   out exactly one record and appears once in the file.

   The whole file goes in one call rather than in batches, and that is
   deliberate rather than lazy: "this name appears twice in the file" is
   a judgement about the file, and a batch of two hundred rows cannot
   make it. Batching would have quietly turned a refusal into a match.

   Applying calls a second function that recomputes the plan rather than
   taking this one, so what is shown and what is written cannot differ.
   ============================================================= */

type Step = 'file' | 'review' | 'done';

type Row = {
  alpha: string; name: string; email: string; phone: string; address: string;
  /* The person at the customer, as one string. `contact_name` is a
     single free text field on the record and the drawer edits it as
     one, so "Alan & Ian Edwards" goes in exactly as Dean typed it. */
  contact: string;
  /* Worked out here rather than in the database, because
     `extractCityFromAddress` has the list of UK cities in it and a
     second implementation in SQL would disagree with this one the first
     time somebody edited either. It sets the city on the address row,
     which is what the map falls back to when it cannot place the full
     address. */
  city: string;
};

type Plan = {
  alpha: string;
  file_name: string;
  contact_id: string | null;
  crm_name: string | null;
  matched_by: string | null;
  verdict: string;
  fill_email: string | null;
  fill_phone: string | null;
  fill_contact: string | null;
  fill_address: string | null;
};

/* The order they are shown in, worst first, because the rows that need
   a person are the reason this screen exists. `fill` is last: it is the
   part that needs no decision. */
const VERDICTS = [
  'ambiguous name', 'name twice', 'name too short', 'no match',
  'file has nothing', 'same customer as another row', 'nothing to add', 'fill',
] as const;

const EXPLAIN: Record<string, string> = {
  'fill': 'Matched, and there is a blank to fill.',
  'nothing to add': 'Matched, and it already has everything this file offers.',
  'file has nothing': 'The file has no contact name, email, phone or address for this one.',
  'no match': 'Not in the CRM. Left alone, which is what you asked for.',
  'ambiguous name': 'The name picks out more than one CRM record. Refused rather than guessed.',
  'name twice': 'That name appears more than once in this file, so it cannot identify anybody.',
  'name too short': 'Too little of a name left to match on safely.',
  'same customer as another row': 'This customer has more than one account code on the file. '
    + 'Another of its rows is the one supplying the values, and the row whose own name matches the '
    + 'customer record is the one that wins. Nothing is being refused here.',
};

const TONE: Record<string, 'neutral' | 'info' | 'warning' | 'accent'> = {
  'fill': 'info',
  'nothing to add': 'neutral',
  'file has nothing': 'neutral',
  'no match': 'neutral',
  'ambiguous name': 'warning',
  'name twice': 'warning',
  'name too short': 'warning',
  'same customer as another row': 'neutral',
};

/** The fields that come from a column in the file. `city` is derived. */
type Mapped = 'alpha' | 'name' | 'contact' | 'email' | 'phone' | 'address';

/** Header names we recognise without being told. */
const GUESS: Record<Mapped, string[]> = {
  alpha: ['alpha', 'account', 'account code', 'code', 'customer code'],
  name: ['customer name', 'company name', 'customer', 'company'],
  /* Not a bare "Name". Sheet2 of `Dean_Customers.xlsx` is Alpha,
     FILENAME, Name, and a bare Name there is a company. Guessing it is
     a person would have written three hundred company names into the
     Contact field of records that had no contact, which is a write, not
     a miss. A column headed only "Name" gets mapped by hand or not at
     all. */
  contact: ['contact name', 'contact', 'person', 'contact person'],
  email: ['email', 'e-mail', 'email address', 'contact email'],
  phone: ['phone', 'telephone', 'tel', 'phone number', 'contact number', 'contact phone'],
  /* "location" is in here because Dean's workbook calls the column that
     and puts a full address in it. The CRM's own Location is the city
     off the primary address and is never typed into, so there is no
     clash: an address column is an address column whatever its heading
     says. */
  address: ['address', 'business address', 'site address', 'postal address', 'location'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function EnrichDialog({ onClose, onDone }: {
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetAt, setSheetAt] = useState(0);
  const [cols, setCols] = useState<Record<Mapped, string>>({
    alpha: '', name: '', contact: '', email: '', phone: '', address: '',
  });
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [show, setShow] = useState<string>('fill');

  /* Guessing which column is which, for one sheet. Re-run whenever the
     sheet changes, because the headers change with it. */
  const guess = useCallback((sheet: Sheet) => {
    const picked: Record<Mapped, string> = {
      alpha: '', name: '', contact: '', email: '', phone: '', address: '',
    };
    for (const field of Object.keys(GUESS) as Mapped[]) {
      picked[field] = sheet.headers.find((h) => GUESS[field].includes(norm(h))) ?? '';
    }
    setCols(picked);
  }, []);

  const read = useCallback(async (file: File) => {
    setFailed(null);
    setPlan(null);
    let read: Sheet[];
    try {
      read = await readTable(file);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'That file could not be read.');
      return;
    }
    if (read.length === 0 || read.every((sh) => sh.rows.length === 0)) {
      setFailed('That file has no rows in it.');
      return;
    }
    /* The first sheet that actually has rows, rather than the first
       sheet. A workbook whose front tab is a title page would otherwise
       open on nothing. */
    const at = Math.max(0, read.findIndex((sh) => sh.rows.length > 0));
    setSheets(read);
    setSheetAt(at);
    guess(read[at]);
  }, [guess]);

  const pickSheet = useCallback((i: number) => {
    setSheetAt(i);
    setPlan(null);
    guess(sheets[i]);
  }, [guess, sheets]);

  const sheet = sheets[sheetAt] as Sheet | undefined;
  const headers = sheet?.headers ?? [];
  const raw = useMemo(() => sheet?.rows ?? [], [sheet]);

  const rows: Row[] = useMemo(() => raw.map((r) => {
    const address = (cols.address ? r[cols.address] : '') ?? '';
    return {
      alpha: (cols.alpha ? r[cols.alpha] : '') ?? '',
      name: (cols.name ? r[cols.name] : '') ?? '',
      contact: (cols.contact ? r[cols.contact] : '') ?? '',
      email: (cols.email ? r[cols.email] : '') ?? '',
      phone: (cols.phone ? r[cols.phone] : '') ?? '',
      address,
      city: (address ? extractCityFromAddress(address) : null) ?? '',
    };
  }), [raw, cols]);

  const preview = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    /* The whole file, in one call. See the note at the top: "this name
       appears twice in the file" cannot be judged a batch at a time. */
    const { data, error } = await supabase.rpc('crm_enrichment_plan', { p_rows: rows });
    setBusy(false);
    if (error) { setFailed(error.message); return; }
    setPlan((data ?? []) as Plan[]);
    setStep('review');
  }, [supabase, rows]);

  const apply = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const { data, error } = await supabase.rpc('crm_apply_enrichment', { p_rows: rows });
    setBusy(false);
    if (error) { setFailed(error.message); return; }
    const d = (data ?? {}) as Record<string, number>;
    setStep('done');
    onDone(`${d.records ?? 0} records filled in: `
      + `${d.emails ?? 0} email addresses, ${d.phones ?? 0} phone numbers, `
      + `${d.people ?? 0} contact names, ${d.addresses ?? 0} addresses.`);
  }, [supabase, rows, onDone]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of plan ?? []) c[p.verdict] = (c[p.verdict] ?? 0) + 1;
    return c;
  }, [plan]);

  const listed = useMemo(
    () => (plan ?? []).filter((p) => p.verdict === show),
    [plan, show],
  );

  const ready = cols.alpha !== '' || cols.name !== '';

  return (
    <Modal
      title="Fill in blanks from a file"
      onClose={onClose}
      width={880}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
          {step === 'review' && (
            <Button variant="secondary" onClick={() => setStep('file')} disabled={busy}>
              <ArrowLeft size={13} /> Back
            </Button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>
              {step === 'done' ? 'Close' : 'Cancel'}
            </Button>
            {step === 'file' && (
              <Button variant="primary" onClick={preview} disabled={!ready || busy || rows.length === 0}>
                {busy ? <Loader size={13} className="spin" /> : null} See what it would do
              </Button>
            )}
            {step === 'review' && (
              <Button
                variant="primary"
                onClick={apply}
                disabled={busy || (counts.fill ?? 0) === 0}
              >
                {busy ? <Loader size={13} className="spin" /> : <Check size={13} />}
                {' '}Fill {counts.fill ?? 0} {(counts.fill ?? 0) === 1 ? 'record' : 'records'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {failed && <Alert tone="danger"><strong>That did not work.</strong> {failed}</Alert>}

      {step === 'file' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: '72ch' }}>
            This only fills in blanks. It never creates a record and never
            overwrites something that is already there, so a company on the
            file that is not in the CRM is left alone.
            {' '}An address goes on the customer&rsquo;s Addresses list as the head
            office, so it appears on the map, and not in the old single field.
            {' '}A contact name goes in exactly as it is written in the file: if a
            cell names two people, the record ends up naming two people.
          </p>

          <div
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void read(f);
            }}
            style={{
              border: '1px dashed var(--border)', borderRadius: 'var(--r)',
              padding: '28px 18px', textAlign: 'center', cursor: 'pointer',
            }}
          >
            <Upload size={20} style={{ opacity: 0.6 }} />
            <div style={{ fontSize: 13.5, marginTop: 8 }}>
              {raw.length > 0
                ? `${raw.length} rows read from ${sheet?.name ?? 'the file'}. `
                  + 'Drop another to start again.'
                : 'Drop a CSV or an Excel file here, or click to choose one'}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
          />

          {/* Which tab. Shown only when there is a choice, because a CSV
              is one sheet and a picker over it would be noise.

              It is not optional when there is one. `Dean_Customers.xlsx`
              has a second sheet of Alpha, FILENAME, Name. Take that one
              and the account code and a name both map themselves, every
              row matches a real customer, and every one of them reports
              "file has nothing" because a filename is not a person. */}
          {sheets.length > 1 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, width: 130 }}>Sheet</span>
              <Select
                value={String(sheetAt)}
                onChange={(v: string) => pickSheet(Number(v))}
              >
                {sheets.map((sh, i) => (
                  <option key={sh.name} value={String(i)}>
                    {sh.name} ({sh.rows.length} {sh.rows.length === 1 ? 'row' : 'rows'})
                  </option>
                ))}
              </Select>
            </div>
          )}

          {headers.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                Which column is which. The account code is the one that matches
                without guessing, so leave it set if the file has one.
              </div>
              {(Object.keys(GUESS) as Mapped[]).map((field) => (
                <div key={field} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, width: 130, textTransform: 'capitalize' }}>
                    {field === 'alpha' ? 'Account code'
                      : field === 'contact' ? 'Contact name' : field}
                  </span>
                  <Select
                    value={cols[field]}
                    onChange={(v: string) => setCols((c) => ({ ...c, [field]: v }))}
                  >
                    <option value="">
                      {field === 'alpha' || field === 'name' ? 'not in this file' : 'do not import'}
                    </option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              ))}
              {!ready && (
                <Alert tone="warning">
                  <span><strong>Nothing to match on.</strong> Set either the account code
                  or the customer name. Without one of them there is no way to tell
                  which record a row is about.</span>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'review' && plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Every outcome, as a row of chips that filter the table. The
              problems are first because they are the reason to look. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {VERDICTS.filter((v) => counts[v]).map((v) => (
              <button
                key={v}
                onClick={() => setShow(v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 28, padding: '0 10px', cursor: 'pointer',
                  borderRadius: 'var(--r)', fontSize: 12.5,
                  fontFamily: 'var(--inter)',
                  border: `1px solid ${show === v ? 'var(--accent)' : 'var(--border)'}`,
                  background: show === v ? 'var(--surface-2, transparent)' : 'transparent',
                  color: 'inherit',
                }}
              >
                <Badge tone={TONE[v]}>{counts[v]}</Badge> {v}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: '80ch' }}>
            {EXPLAIN[show]}
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--inter)' }}>
              <thead>
                <tr>
                  {['On the file', 'Account code', 'In the CRM', 'Matched by', 'Would fill'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', fontSize: 11.5, fontWeight: 600,
                      color: 'var(--text-subtle)', padding: '6px 10px',
                      borderBottom: '1px solid var(--border)',
                      position: 'sticky', top: 0, background: 'var(--surface, inherit)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.slice(0, 400).map((p, i) => (
                  <tr key={`${p.alpha}-${i}`}>
                    <td style={cell}>{p.file_name || <Dash />}</td>
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{p.alpha || <Dash />}</td>
                    <td style={cell}>{p.crm_name ?? <Dash />}</td>
                    <td style={cell}>{p.matched_by ?? <Dash />}</td>
                    <td style={cell}>
                      {[p.fill_contact && 'contact', p.fill_email && 'email',
                        p.fill_phone && 'phone', p.fill_address && 'address']
                        .filter(Boolean).join(', ') || <Dash />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listed.length > 400 && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '8px 10px' }}>
                Showing the first 400 of {listed.length}.
              </div>
            )}
          </div>

          {counts['ambiguous name'] ? (
            <Alert tone="warning">
              <span><strong>Some rows need a person.</strong> These are not being
              written. An ambiguous name is a question, and the answer is to bind
              the account code on the customer record so it never has to be asked
              again.</span>
            </Alert>
          ) : null}
        </div>
      )}

      {step === 'done' && (
        <Alert tone="success">
          <span><strong>Done.</strong> The blanks are filled. Nothing was created
          and nothing was overwritten.</span>
        </Alert>
      )}
    </Modal>
  );
}

const cell: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
};

const Dash = () => <span style={{ color: 'var(--text-subtle)' }}>—</span>;
