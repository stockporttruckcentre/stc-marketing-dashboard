'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import {
  Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle,
  X, Loader, CircleSlash, Copy,
} from 'lucide-react';
import { Button, Alert, Badge } from '@/components/kit/primitives';
import { Modal, Select } from '@/components/kit/forms';
import { matchColumns, type ColumnMatch } from '@/lib/import/match';
import { buildPlan, countPlan, type ImportPlan, type PlannedRow } from '@/lib/import/plan';
import type { Dictionary } from '@/lib/import/dictionary';

/* =============================================================
   Importing somebody else's spreadsheet.

   Three steps, and nothing is written until the third is confirmed.

     1. The file. Drop or browse.
     2. The columns. What we think each one is, what we are going to
        ignore, and why. Every guess is editable.
     3. The rows. What will be created, what is already here, and what
        we could not read. Duplicates default to skip.

   The rule the old import broke: never write something the user has not
   seen. It posted raw headers at the database and reported a count, so a
   file with the wrong column names produced hundreds of empty records
   and a cheerful success message.

   The plan built for the review screen is the same object the commit
   walks. A preview computed one way and an import executed another is
   how a preview ends up lying.
   ============================================================= */

type Step = 'file' | 'columns' | 'rows';

export function ImportDialog({ dict, existing, listName, onCommit, onClose }: {
  dict: Dictionary;
  existing: { id: string; company_name: string; email: string | null }[];
  listName: string;
  onCommit: (rows: Record<string, any>[]) => Promise<{ inserted: number; error?: string }>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [raw, setRaw] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<ColumnMatch[]>([]);
  const [decisions, setDecisions] = useState<Record<number, PlannedRow['decision']>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const targets = useMemo(
    () => dict.fields.filter((f) => f.target).map((f) => ({ target: f.target as string, label: f.label })),
    [dict],
  );

  const plan: ImportPlan = useMemo(() => {
    if (!columns.length) return { columns: [], rows: [], dropped: [], unknown: [] };
    const p = buildPlan(columns, raw, existing, dict);
    // The user's per row choices survive a column remap, which is the
    // whole reason you can go back a step without losing your work.
    p.rows = p.rows.map((r) => (decisions[r.index] ? { ...r, decision: decisions[r.index] } : r));
    return p;
  }, [columns, raw, existing, dict, decisions]);

  const counts = useMemo(() => countPlan(plan), [plan]);

  const takeFile = useCallback((file: File) => {
    setParseError(null);
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Excel exports carry trailing spaces on headers more often than not.
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const rows = (res.data as Record<string, any>[]).filter(
          (r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''),
        );
        const headers = (res.meta.fields ?? []).filter((h) => h && h.trim() !== '');
        if (!headers.length || !rows.length) {
          setParseError('That file has no readable header row and rows underneath it. If it came from Excel, save it as CSV first.');
          return;
        }
        setRaw(rows);
        setColumns(matchColumns(headers, rows, dict));
        setDecisions({});
        setStep('columns');
      },
      error: (e) => setParseError(e.message),
    });
  }, [dict]);

  function remap(index: number, target: string | null | undefined) {
    setColumns((cs) => cs.map((c) => {
      if (c.index !== index) return c;
      const field = target ? dict.fields.find((f) => f.target === target) : undefined;
      return { ...c, target, field, manual: true, confidence: target ? 100 : 0, reason: 'you set this' };
    }));
  }

  function setDecision(index: number, decision: PlannedRow['decision']) {
    setDecisions((d) => ({ ...d, [index]: decision }));
  }

  function decideAllDuplicates(decision: PlannedRow['decision']) {
    const next = { ...decisions };
    for (const r of plan.rows) {
      if (r.duplicateOf || r.duplicateInFile !== undefined) next[r.index] = decision;
    }
    setDecisions(next);
  }

  async function commit() {
    setBusy(true); setResult(null);
    const payload = plan.rows.filter((r) => r.decision === 'import').map((r) => r.values);
    const res = await onCommit(payload);
    setBusy(false);
    if (res.error) { setResult(res.error); return; }
    onClose();
  }

  /* ---------------------------------------------------------- */

  if (step === 'file') {
    return (
      <Modal
        title="Import a spreadsheet"
        description={`Rows go onto ${listName}. Nothing is saved until you have seen what it is going to do.`}
        onClose={onClose}
        width={520}
        footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}
      >
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) takeFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
            padding: '34px 24px', textAlign: 'center', cursor: 'pointer',
            borderRadius: 'var(--r-md)',
            border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: dragging ? 'var(--surface-sunken)' : 'transparent',
            transition: 'border-color 120ms, background 120ms',
          }}
        >
          <span style={{
            width: 42, height: 42, borderRadius: 'var(--r-full)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-subtle)', color: 'var(--text-subtle)',
          }}><Upload size={19} /></span>
          <span style={{ fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
            Drop a CSV here
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            or click to pick one. Column names do not have to match ours.
          </span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) takeFile(f); e.target.value = ''; }} />
        </div>
        {parseError && <Alert tone="danger">{parseError}</Alert>}
      </Modal>
    );
  }

  /* ---------------------------------------------------------- */

  if (step === 'columns') {
    const matched = columns.filter((c) => c.target);
    const requiredMapped = columns.some((c) => c.target === dict.required);
    return (
      <Modal
        title="Check the columns"
        description={`${fileName}, ${raw.length} rows. ${matched.length} of ${columns.length} columns will be imported.`}
        onClose={onClose}
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStep('file')}><ArrowLeft size={14} /> Back</Button>
            <span style={{ flex: 1 }} />
            <Button variant="primary" onClick={() => setStep('rows')} disabled={!requiredMapped}>
              Check the rows <ArrowRight size={14} />
            </Button>
          </>
        }
      >
        {!requiredMapped && (
          <Alert tone="danger">
            Nothing is mapped to {dict.required.replace('_', ' ')}, and a record cannot be filed
            without it. Point one of the columns below at it.
          </Alert>
        )}

        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {columns.map((c) => (
            <ColumnRow key={c.index} col={c} targets={targets} onChange={(t) => remap(c.index, t)} />
          ))}
        </div>
      </Modal>
    );
  }

  /* ---------------------------------------------------------- */

  const problems = plan.rows.filter((r) => r.duplicateOf || r.duplicateInFile !== undefined || r.issues.length);
  return (
    <Modal
      title="Check what will happen"
      description={`${fileName}, ${raw.length} rows read.`}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={() => setStep('columns')}><ArrowLeft size={14} /> Back</Button>
          <span style={{ flex: 1 }} />
          <Button variant="accent" onClick={commit} disabled={busy || counts.create === 0}>
            {busy ? <Loader size={14} className="spin" /> : <Check size={14} />}
            {counts.create === 0
              ? 'Nothing left to import'
              : `Import ${counts.create} ${counts.create === 1 ? 'contact' : 'contacts'}`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Tally label="Will be created" value={counts.create} />
        <Tally label="Skipped" value={counts.skip} />
        <Tally label="Already here" value={counts.duplicates} />
        <Tally label="With a problem cell" value={counts.withIssues} />
      </div>

      {(plan.dropped.length > 0 || plan.unknown.length > 0) && (
        <Alert tone="info">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {plan.dropped.map((d) => (
              <span key={d.header}><strong>{d.header}</strong> is not being imported: {d.why}.</span>
            ))}
            {plan.unknown.length > 0 && (
              <span>
                Nothing was matched to{' '}
                {plan.unknown.map((h, i) => (
                  <span key={h}>
                    {i > 0 && ', '}<strong>{h}</strong>
                  </span>
                ))}
                . Go back a step if any of those should go somewhere.
              </span>
            )}
          </div>
        </Alert>
      )}

      {counts.duplicates > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 13px', borderRadius: 'var(--r)',
          border: '1px solid var(--border)', background: 'var(--surface)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>
            {counts.duplicates} {counts.duplicates === 1 ? 'row is' : 'rows are'} already on this list.
          </span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => decideAllDuplicates('skip')}>Skip them all</Button>
          <Button size="sm" variant="secondary" onClick={() => decideAllDuplicates('import')}>Import them anyway</Button>
        </div>
      )}

      {problems.length > 0 ? (
        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {problems.map((r) => (
            <RowRow key={r.index} row={r} onDecide={(d) => setDecision(r.index, d)} />
          ))}
        </div>
      ) : (
        <div style={{
          padding: '14px 15px', borderRadius: 'var(--r)', background: 'var(--surface-sunken)',
          fontSize: 13, color: 'var(--text-muted)',
        }}>
          Nothing needs a decision. Every row is new and every cell read cleanly.
        </div>
      )}

      {result && <Alert tone="danger">{result}</Alert>}
    </Modal>
  );
}

/* ---------- pieces ---------- */

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      flex: '1 1 130px', padding: '10px 13px', borderRadius: 'var(--r)',
      border: '1px solid var(--border)', background: 'var(--surface)',
    }}>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11, letterSpacing: '0.13em',
        textTransform: 'uppercase', color: 'var(--text-subtle)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22, color: 'var(--text)',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
      }}>{value}</div>
    </div>
  );
}

function ColumnRow({ col, targets, onChange }: {
  col: ColumnMatch;
  targets: { target: string; label: string }[];
  onChange: (t: string | null | undefined) => void;
}) {
  const dropped = col.target === null;
  const unmapped = col.target === undefined;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '9px 12px', borderRadius: 'var(--r)',
      border: '1px solid var(--border)',
      background: dropped || unmapped ? 'var(--surface-sunken)' : 'var(--surface)',
      opacity: dropped ? 0.75 : 1,
    }}>
      <div style={{ flex: '1 1 190px', minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          {col.header}
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {col.samples.length ? col.samples.slice(0, 3).join(' · ') : 'no values in this column'}
        </div>
      </div>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 9 }}>
        {col.manual
          ? <Badge tone="info">Yours</Badge>
          : dropped
            ? <Badge tone="neutral">Ignored</Badge>
            : unmapped
              ? <Badge tone="warning">No match</Badge>
              : <Badge tone={col.confidence >= 90 ? 'success' : 'warning'}>
                  {col.confidence >= 90 ? 'Confident' : 'Best guess'}
                </Badge>}

        <div style={{ width: 178 }}>
          <Select
            value={col.target === null ? '__drop' : col.target ?? ''}
            onChange={(v) => onChange(v === '__drop' ? null : v === '' ? undefined : v)}
          >
            <option value="">Do not import</option>
            <option value="__drop">Ignore on purpose</option>
            {targets.map((t) => <option key={t.target} value={t.target}>{t.label}</option>)}
          </Select>
        </div>
      </div>

      <div style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--text-subtle)' }}>
        {col.reason === 'no match'
          ? 'Nothing in our dictionary matches this header or its values.'
          : col.reason.charAt(0).toUpperCase() + col.reason.slice(1) + '.'}
      </div>
    </div>
  );
}

function RowRow({ row, onDecide }: { row: PlannedRow; onDecide: (d: PlannedRow['decision']) => void }) {
  const dupe = row.duplicateOf;
  const inFile = row.duplicateInFile !== undefined;
  const blocked = row.issues.some((i) => i.why.startsWith('missing a '));

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
      padding: '9px 12px', borderRadius: 'var(--r)',
      border: '1px solid var(--border)', background: 'var(--surface)',
      borderLeft: `2px solid ${blocked ? 'var(--danger)' : dupe || inFile ? 'var(--warning)' : 'var(--border-strong)'}`,
    }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
          <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginRight: 7 }}>
            Row {row.index + 2}
          </span>
          {row.display}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.5 }}>
          {dupe && <div>Already on this list as <strong>{dupe.company_name}</strong>, matched on {dupe.matchedOn}.</div>}
          {inFile && <div>The same record appears earlier in this file, on row {(row.duplicateInFile ?? 0) + 2}.</div>}
          {row.issues.map((i, n) => (
            <div key={n}>
              {i.why.startsWith('missing a ')
                ? `This row is ${i.why}.`
                : `${i.column}${i.value ? `, "${i.value}",` : ''} is ${i.why}.`}
            </div>
          ))}
        </div>
      </div>

      {!blocked && (
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          <Choice on={row.decision === 'import'} onClick={() => onDecide('import')} icon={<Check size={12} />} label="Import" />
          <Choice on={row.decision === 'skip'} onClick={() => onDecide('skip')} icon={<CircleSlash size={12} />} label="Skip" />
        </div>
      )}
      {blocked && <Badge tone="danger">Cannot import</Badge>}
    </div>
  );
}

function Choice({ on, onClick, icon, label }: {
  on: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
      borderRadius: 'var(--r)', cursor: 'pointer',
      border: `1px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`,
      background: on ? 'var(--primary)' : 'transparent',
      color: on ? 'var(--primary-fg)' : 'var(--text-muted)',
      fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
    }}>{icon}{label}</button>
  );
}
