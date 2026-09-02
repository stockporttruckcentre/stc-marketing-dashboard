'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, Check, AlertTriangle, Loader, X, Send,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, SectionHead, money,
} from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';
import {
  readDroppedFile, inBatches,
  type Read, type InvoiceRow, type OpenJobRow,
} from '@/lib/protean/import';
import {
  startImport, sendInvoices, sendOpenJobs, closeWhatWentAway, wouldClose,
  relinkJobs, addUp,
  type BatchResult, type WouldClose, type Division,
} from '@/lib/protean/rpc';

/* =============================================================
   Putting the week's Protean export in.

   From the business:

     a page in the CRM where I can update the sales once or twice a week
     with a spreadsheet of what's been invoiced and what's open

   Two files, and the screen reads each one before it offers to send
   anything. What it shows before the send is the whole point: how many
   rows, how much money, how many rows it will not take and why. A file
   read the wrong way is a total of zero, and a total of zero looks
   exactly like a quiet week.

   ---- Nothing is written until the button is pressed ----

   Reading happens in the browser. The file is parsed, counted and
   totalled with nothing sent anywhere, so dropping the wrong file
   costs a sentence on screen rather than an import to undo.

   ---- Why it goes in slices ----

   Twenty thousand invoices in one request is a request that times out
   on a bad connection and takes the whole file with it. In slices, what
   landed stays landed, and re-sending the file finishes the job rather
   than doubling it, because every write is an upsert on Protean's own
   key.

   ---- The last step of a snapshot, and why it asks ----

   The open jobs file is everything open at the moment it was run, so a
   job that has stopped appearing has been finished, invoiced or
   cancelled. Closing those is a separate call made once, after every
   slice has landed. Done per slice, the first slice of a file would
   close every job the later slices were about to confirm.

   It is also the only destructive thing the import does, and it cannot
   tell a week's work finishing from a partial export. Somebody runs the
   report filtered to one depot, drops it in, and a thousand jobs at
   every other depot are marked finished on the strength of not being
   mentioned.

   There is no number that separates those two cases, so there is no
   threshold here. The figure goes on the screen and a person presses
   the button. A normal week is one extra glance; the week this exists
   for is the one where the glance says 812 rather than 140.

   Declining is safe. The jobs stay open and the next whole export
   closes them, because the file is a snapshot and not a diff.
   ============================================================= */

type Dropped = {
  fileName: string;
  read: Read;
};

type Sent = {
  kind: 'invoices' | 'open_jobs';
  fileName: string;
  result: Required<BatchResult>;
  /** Null while the closing question is still on the screen. */
  closed: number | null;
};

/* The one destructive step in the whole import, held back until
   somebody has read what it would do. See the header. */
type Closing = { importId: string; fileName: string; would: WouldClose };

function totalOf(read: Read): number {
  if (!read.ok) return 0;
  return read.kind === 'invoices'
    ? read.rows.reduce((s, r) => s + (r.net ?? 0), 0)
    : read.rows.reduce((s, r) => s + (r.job_total ?? 0), 0);
}

const WHAT_IT_IS: Record<'invoices' | 'open_jobs', string> = {
  invoices: 'Invoiced',
  open_jobs: 'Open jobs',
};

export function ImportPanel({ division, divisionName, onDone }: {
  /* Which system this file came out of. Stated by the screen rather
     than guessed from the file, because the two exports are the same
     report out of two systems and look alike on purpose. */
  division: Division;
  divisionName: string;
  onDone: () => void;
}) {
  const supabase = createClient();
  const { say } = useToast();
  const picker = useRef<HTMLInputElement>(null);

  const [dropped, setDropped] = useState<Dropped[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [linkedNow, setLinkedNow] = useState(0);

  const take = useCallback(async (files: FileList | File[]) => {
    const next: Dropped[] = [];
    for (const file of Array.from(files)) {
      next.push({ fileName: file.name, read: await readDroppedFile(file) });
    }
    /* One file of each kind. Dropping a newer invoices file replaces the
       one already sitting there rather than queueing two. */
    setDropped((was) => {
      const keep = was.filter((d) => !next.some((n) =>
        n.read.ok && d.read.ok && n.read.kind === d.read.kind));
      return [...keep, ...next];
    });
  }, []);

  const send = useCallback(async () => {
    /* INVOICES ALWAYS FIRST.

       The open jobs export carries no account code, only a customer
       name, and the accounts it matches against are created by the
       invoice file. Sent the other way round there is nothing to match,
       so every job lands with no account and the screen says "No
       account" on all of them.

       The relink pass after the loop makes the order not matter, and
       this makes it not matter twice. Two cheap guards on a mistake
       whose symptom is a thousand rows looking wrong. */
    const usable = dropped
      .filter((d) => d.read.ok)
      .sort((a, b) => {
        const rank = (d: Dropped) => (d.read.ok && d.read.kind === 'invoices' ? 0 : 1);
        return rank(a) - rank(b);
      });
    if (!usable.length) return;

    const landed: Sent[] = [];
    try {
      for (const d of usable) {
        if (!d.read.ok) continue;
        const kind = d.read.kind;
        setBusy(`Reading ${d.fileName} in`);
        const importId = await startImport(supabase, kind, d.fileName, division);

        const results: BatchResult[] = [];
        if (kind === 'invoices') {
          const batches = inBatches(d.read.rows as InvoiceRow[]);
          for (let i = 0; i < batches.length; i += 1) {
            setBusy(`${d.fileName}: slice ${i + 1} of ${batches.length}`);
            results.push(await sendInvoices(supabase, importId, batches[i]!));
          }
        } else {
          const batches = inBatches(d.read.rows as OpenJobRow[]);
          for (let i = 0; i < batches.length; i += 1) {
            setBusy(`${d.fileName}: slice ${i + 1} of ${batches.length}`);
            results.push(await sendOpenJobs(supabase, importId, batches[i]!));
          }
        }

        /* Closing is NOT done here. A snapshot marks everything absent
           from it as finished, which is right for a whole export and
           ruinous for a partial one, and nothing in the data tells the
           two apart. So it is read, shown, and pressed. */
        let closed: number | null = 0;
        if (kind === 'open_jobs' && d.read.rows.length) {
          setBusy(`${d.fileName}: working out what has finished`);
          const would = await wouldClose(supabase, importId);
          if (would.would_close > 0) {
            closed = null;
            setClosing({ importId, fileName: d.fileName, would });
          }
        }

        landed.push({ kind, fileName: d.fileName, result: addUp(results), closed });
      }

      /* Link any job that had nothing to point at when it landed. It
         only ever fills a blank, so running it every time is free and
         it repairs an earlier import made in the wrong order. */
      let linked = 0;
      if (landed.some((l) => l.kind === 'open_jobs') || landed.some((l) => l.kind === 'invoices')) {
        setBusy('Matching jobs to their accounts');
        linked = await relinkJobs(supabase);
      }
      setLinkedNow(linked);

      setSent(landed);
      setDropped([]);
      say({ tone: 'success', title: 'That is in. Anything the matcher could not place is waiting under Accounts.' });
      onDone();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'The import stopped part way through.' });
    } finally {
      setBusy(null);
    }
  }, [dropped, supabase, say, onDone, division]);

  const confirmClose = useCallback(async () => {
    if (!closing) return;
    setBusy('Marking them finished');
    try {
      const closed = await closeWhatWentAway(supabase, closing.importId);
      setSent((was) => was.map((s) =>
        s.fileName === closing.fileName && s.kind === 'open_jobs' ? { ...s, closed } : s));
      setClosing(null);
      say({ tone: 'success', title: `${closed} jobs marked as finished.` });
      onDone();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [closing, supabase, say, onDone]);

  const ready = dropped.some((d) => d.read.ok);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <SectionHead
          title="This week's export"
          /* WHICH SYSTEM, because they are not the same one.

             Maintenance is raised in Protean and comes out as two
             reports. Rental is raised in Sage and comes out as one:
             "We can only take rental information from sage." A panel
             that says Protean on the S&L screen is telling somebody to
             go and find a file that does not exist. */
          hint={division === 'rental'
            ? 'From Sage: the invoiced report, covering invoices and credit notes.'
            : 'Both files from Protean: everything invoiced, and everything still open.'}
        />
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files?.length) void take(e.dataTransfer.files);
          }}
          onClick={() => picker.current?.click()}
          style={{
            padding: '30px 20px', borderRadius: 'var(--r-md)',
            border: `1px dashed ${over ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: over ? 'var(--surface-sunken)' : 'transparent',
            textAlign: 'center', cursor: 'pointer',
          }}
        >
          <Upload size={20} style={{ color: 'var(--text-subtle)' }} />
          <div style={{
            marginTop: 8, fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
            color: 'var(--text)',
          }}>
            Drop the {divisionName} export here
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-subtle)' }}>
            CSV or XLSX. Nothing is sent anywhere until you say so, and it goes
            in as {divisionName}.
          </div>
          <input
            ref={picker}
            type="file"
            /* THE PICKER HAS TO ACCEPT WHAT THE READER ACCEPTS.

               The line above says "CSV or XLSX" and this said CSV, so
               the only way to hand it a spreadsheet was to switch the
               dialog to All Files and hope. From the business: "i've
               tested bypassing that and uploading xlsx and it works
               fine so it shouldn't restrict that in the picker."

               `readDroppedFile` has taken .xls and .xlsx since the
               rental import, and the drop zone beside this button has
               never restricted anything at all. This was the one place
               left saying otherwise.

               Both MIME types as well as both extensions, because a
               file that arrived by email or out of a zip often reaches
               the disk with no useful type on it and macOS in
               particular then greys it out on the extension alone. */
            accept={'.csv,.xlsx,.xls,text/csv,'
              + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
              + 'application/vnd.ms-excel'}
            multiple
            hidden
            onChange={(e) => { if (e.target.files?.length) void take(e.target.files); e.target.value = ''; }}
          />
        </div>
      </Card>

      {dropped.map((d, i) => (
        <Card key={`${d.fileName}-${i}`}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <FileSpreadsheet
              size={18}
              style={{ color: d.read.ok ? 'var(--success)' : 'var(--danger)', flexShrink: 0, marginTop: 2 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14, color: 'var(--text)',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                {d.fileName}
                {d.read.ok && <Badge tone="info">{WHAT_IT_IS[d.read.kind]}</Badge>}
              </div>

              {d.read.ok ? (
                <div style={{
                  display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 10,
                }}>
                  <Figure label="Rows" value={d.read.rows.length.toLocaleString('en-GB')} />
                  <Figure
                    label={d.read.kind === 'invoices' ? 'Net invoiced' : 'Open work'}
                    value={money(totalOf(d.read))}
                  />
                  <Figure
                    label="Will not go in"
                    value={d.read.unusable.toLocaleString('en-GB')}
                    quiet={d.read.unusable === 0}
                  />
                  {d.read.blank > 0 && (
                    <Figure label="Empty rows" value={d.read.blank.toLocaleString('en-GB')} quiet />
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {d.read.why}
                </div>
              )}

              {d.read.ok && d.read.blank > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Alert tone="info">
                    {d.read.blank.toLocaleString('en-GB')} rows carry an invoice number and nothing
                    else. That is how this export lists documents outside the date range asked for,
                    so they are skipped rather than counted as a problem.
                  </Alert>
                </div>
              )}

              {d.read.ok && d.read.unusable > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Alert tone="warning">
                    {d.read.unusable.toLocaleString('en-GB')} of {d.read.read.toLocaleString('en-GB')} rows
                    are missing something the import needs, so they will be left out and counted.
                    {d.read.kind === 'invoices'
                      ? ' An invoice needs a number, a customer code, a tax point and a net figure.'
                      : ' A job needs a number and a customer.'}
                  </Alert>
                </div>
              )}

              {d.read.ok && d.read.kind === 'open_jobs' && (
                <div style={{ marginTop: 12 }}>
                  <Alert tone="info">
                    This file is a snapshot of right now. Anything open on the system that is not
                    in it will be marked as finished, which is the only way to know a job is done.
                  </Alert>
                </div>
              )}
            </div>

            <button
              onClick={() => setDropped((was) => was.filter((_, j) => j !== i))}
              aria-label="Take this file back off"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--text-subtle)', padding: 2, display: 'flex',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </Card>
      ))}

      {ready && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => void send()} disabled={!!busy}>
            {busy ? <Loader size={14} className="spin" /> : <Send size={14} />}
            {busy ?? 'Put this week in'}
          </Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Sending the same file twice is safe. Every row is keyed on the document number
            the accounting system gave it,
            so it updates what is there rather than adding it again.
          </span>
        </div>
      )}

      {closing && (
        <Card style={{ borderColor: 'var(--warning)' }}>
          <SectionHead
            title="Which jobs have finished"
            hint={`From ${closing.fileName}.`}
          />
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, margin: '0 0 12px' }}>
            {closing.would.in_this_file.toLocaleString('en-GB')} jobs were in that file.
            {' '}
            <strong>{closing.would.would_close.toLocaleString('en-GB')}</strong> of the
            {' '}{closing.would.open_now.toLocaleString('en-GB')} open on the system are not in it,
            so they have been finished, invoiced or cancelled since the last export.
          </p>

          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 12 }}>
            <Figure label="Would be finished" value={closing.would.would_close.toLocaleString('en-GB')} />
            <Figure label="Their value" value={money(closing.would.biggest_value)} />
            {closing.would.biggest_job && (
              <Figure label="Largest of them" value={closing.would.biggest_job} />
            )}
          </div>

          <Alert tone="warning">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Check that figure against the week you have had. This is the only step that
              takes anything away, and a report run for one depot rather than all of them
              looks exactly like a very quiet fortnight from here. If it reads high, say no:
              the jobs stay open and the next whole export closes them properly.
            </span>
          </Alert>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Button variant="primary" disabled={!!busy} onClick={() => void confirmClose()}>
              {busy ? <Loader size={14} className="spin" /> : <Check size={14} />}
              Yes, mark {closing.would.would_close.toLocaleString('en-GB')} as finished
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => {
              setClosing(null);
              say({ tone: 'neutral', title: 'Left open. The next whole export will close them.' });
            }}>
              No, leave them open
            </Button>
          </div>
        </Card>
      )}

      {sent.length > 0 && (
        <Card>
          <SectionHead title="What landed" hint="From the last import." />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
            {sent.map((s) => (
              <div key={s.fileName}>
                <div style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13.5,
                  color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <Check size={14} style={{ color: 'var(--success)' }} />
                  {s.fileName}
                </div>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 9 }}>
                  <Figure label="New" value={s.result.rows_new.toLocaleString('en-GB')} />
                  <Figure label="Updated" value={s.result.rows_updated.toLocaleString('en-GB')} />
                  <Figure label="Left out" value={s.result.rows_skipped.toLocaleString('en-GB')}
                    quiet={s.result.rows_skipped === 0} />
                  {s.kind === 'invoices' && (
                    <Figure label="New accounts" value={s.result.accounts_new.toLocaleString('en-GB')} />
                  )}
                  {s.kind === 'open_jobs' && (
                    <>
                      <Figure
                        label="Now finished"
                        value={s.closed == null ? 'waiting on you' : s.closed.toLocaleString('en-GB')}
                        quiet={s.closed == null}
                      />
                      <Figure label="No account yet"
                        value={s.result.rows_unmatched.toLocaleString('en-GB')}
                        quiet={s.result.rows_unmatched === 0} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {linkedNow > 0 && (
            <div style={{ marginTop: 14 }}>
              <Alert tone="info">
                {linkedNow.toLocaleString('en-GB')} open jobs were matched to their Protean
                account by name. The open jobs export carries no account code, so this happens
                after the invoices land.
              </Alert>
            </div>
          )}

          {sent.some((s) => s.result.accounts_new > 0) && (
            <div style={{ marginTop: 14 }}>
              <Alert tone="warning">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Some of these codes are new. Their invoices are stored and counted in the company
                  total, and they will not appear on anybody&apos;s customer record until somebody
                  says who they are. That is waiting under Accounts.
                </span>
              </Alert>
            </div>
          )}
        </Card>
      )}

      {!dropped.length && !sent.length && (
        <EmptyState
          what="Nothing dropped yet"
          why={division === 'rental'
            ? 'Run the invoiced report out of Sage and drop it above.'
            : 'Run both reports out of Protean, save them as CSV, and drop them above.'}
        />
      )}
    </div>
  );
}

/** A small labelled number. Panton, tabular, because these get compared. */
function Figure({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19,
        color: quiet ? 'var(--text-subtle)' : 'var(--text)',
        fontVariantNumeric: 'tabular-nums', marginTop: 3,
      }}>{value}</div>
    </div>
  );
}
