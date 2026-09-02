'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, Plus, CircleSlash, Loader, Search, Link2, Wrench,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, SectionHead, money,
} from '@/components/kit/primitives';
import { Field, Modal, TextInput } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';
import { decide, type Verdict, type CrmCustomer } from '@/lib/protean/customers';
import {
  waitingOnUs, bindAccount, makeCustomer, setAside,
  jobsWithoutAccount, placeOpenWork, makeCustomerForWork,
  type Waiting, type Division, type DivisionFilter, type OrphanJobs,
} from '@/lib/protean/rpc';

/* =============================================================
   Saying who a Protean account is.

   From the business:

     Going forward it'll need tight moderation and should tell us when
     it's found similar matches or couldn't find a match at all and if
     we want it to create a crm record.

   So three states, and the screen never hides which one it is in:

     the same name       offered together, bound in one press
     a similar name      the candidates, and the decision is a person's
     nothing like it     offered as a new customer

   ---- Why the default is always to create ----

   The two ways this goes wrong are not symmetrical. Wrongly creating a
   customer leaves a duplicate somebody can see and merge. Wrongly
   binding merges two companies' revenue into one record, silently,
   forever, and the first symptom is a figure in a board meeting that
   nobody can explain.

   So nothing is preselected on a similar name, and the create button
   sits where the eye lands.

   ---- Done once ----

   The answer is stored against Protean's code, so this queue empties
   and stays empty. Next week's import joins on the code and only a
   genuinely new account appears here. That is what makes it worth
   being slow about today.
   ============================================================= */

type Decision = { alpha: string; verdict: Verdict; row: Waiting };

export function ModeratePanel({ division, onChanged }: {
  /* Null on a screen that shows every division at once. The account
     itself always knows which one it is, so a decision is never made
     without one. */
  division: DivisionFilter;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const { say } = useToast();

  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [crm, setCrm] = useState<CrmCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<Decision | null>(null);
  /* Work with no account at all. A separate list because it is a
     different question: the queue above asks which ACCOUNTS need a
     customer, and this asks which WORK does. Answering only the first
     is why SAF Holland was invisible on a screen showing its jobs. */
  const [orphans, setOrphans] = useState<OrphanJobs[]>([]);
  const [pickingWork, setPickingWork] = useState<OrphanJobs | null>(null);
  const [aside, setAsideFor] = useState<Decision | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, contacts, unplaced] = await Promise.all([
        waitingOnUs(supabase, division),
        supabase.from('crm_contacts').select('id, company_name').order('company_name'),
        jobsWithoutAccount(supabase, division),
      ]);
      setWaiting(queue);
      setCrm((contacts.data ?? []) as CrmCustomer[]);
      setOrphans(unplaced);
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'The queue would not load.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, say, division]);

  useEffect(() => { void load(); }, [load]);

  const decisions = useMemo<Decision[]>(
    () => waiting.map((row) => ({
      alpha: row.alpha,
      row,
      verdict: decide(row.alpha, row.protean_name, crm),
    })),
    [waiting, crm],
  );

  const exact = decisions.filter((d) => d.verdict.kind === 'exact');
  const similar = decisions.filter((d) => d.verdict.kind === 'confirm');
  const strangers = decisions.filter((d) => d.verdict.kind === 'create');

  const after = useCallback(async () => { await load(); onChanged(); }, [load, onChanged]);

  const bind = useCallback(async (d: Division, alpha: string, contact: string, name: string) => {
    setBusy(alpha);
    try {
      await bindAccount(supabase, d, alpha, contact);
      say({ tone: 'success', title: `${alpha} is ${name}.` });
      await after();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [supabase, say, after]);

  const create = useCallback(async (d: Division, alpha: string, name: string) => {
    setBusy(alpha);
    try {
      await makeCustomer(supabase, d, alpha);
      say({ tone: 'success', title: `${name} is in the CRM.` });
      await after();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [supabase, say, after]);

  const bindAllExact = useCallback(async () => {
    setBusy('exact');
    try {
      for (const d of exact) {
        if (d.verdict.kind !== 'exact') continue;
        await bindAccount(supabase, d.row.division, d.alpha, d.verdict.contact.id);
      }
      say({ tone: 'success', title: `${exact.length} accounts matched their customer exactly.` });
      await after();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [exact, supabase, say, after]);

  if (loading) {
    return <Card><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading the queue.</span></Card>;
  }

  const placeWork = async (o: OrphanJobs, contact: string | null, name: string) => {
    setBusy(`work:${o.protean_name}`);
    try {
      if (contact) await placeOpenWork(supabase, o.division, o.protean_name, contact);
      else await makeCustomerForWork(supabase, o.division, o.protean_name);
      say({ tone: 'success', title: `${o.jobs} ${o.jobs === 1 ? 'job is' : 'jobs are'} now ${name}.` });
      await after();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  };

  const nothingWaiting = !decisions.length && !orphans.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {nothingWaiting ? (
        <EmptyState
          what="Every Protean account has a customer"
          why="Nothing is waiting on a decision. Next week's import joins on Protean's own code, so only a genuinely new account will appear here."
        />
      ) : (
        <Alert tone="info">
          {decisions.length} Protean {decisions.length === 1 ? 'account is' : 'accounts are'} waiting
          on a decision, worth {money(decisions.reduce((s, d) => s + Number(d.row.net || 0), 0))} since
          January. Their invoices are already counted in the company total. They will not appear on
          anybody&apos;s customer record until they are placed.
        </Alert>
      )}

      {exact.length > 0 && (
        <Card>
          <SectionHead
            title="The same name"
            hint="These match a customer exactly once the Ltd and the punctuation are set aside."
            action={
              <Button variant="primary" onClick={() => void bindAllExact()} disabled={!!busy}>
                {busy === 'exact' ? <Loader size={14} className="spin" /> : <Check size={14} />}
                Bind all {exact.length}
              </Button>
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {exact.map((d) => d.verdict.kind === 'exact' && (
              <Row key={d.alpha} row={d.row}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  <Link2 size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                  {d.verdict.contact.name}
                </span>
              </Row>
            ))}
          </div>
        </Card>
      )}

      {similar.length > 0 && (
        <Card>
          <SectionHead
            title="A similar name"
            hint="Close, and close is not the same company. Nothing is chosen for you here."
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {similar.map((d) => d.verdict.kind === 'confirm' && (
              <div key={d.alpha} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 12,
              }}>
                <Row row={d.row} />
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {d.verdict.candidates.map((c) => (
                    <Button
                      key={c.id}
                      variant="secondary"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void bind(d.row.division, d.alpha, c.id, c.name)}
                    >
                      <Check size={13} />
                      This is {c.name}
                    </Button>
                  ))}
                  <Button variant="primary" size="sm" disabled={!!busy}
                    onClick={() => void create(d.row.division, d.alpha, d.row.protean_name)}>
                    <Plus size={13} />
                    None of those, add it
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!!busy}
                    onClick={() => setPicking(d)}>
                    <Search size={13} />
                    Somebody else
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!!busy}
                    onClick={() => setAsideFor(d)}>
                    <CircleSlash size={13} />
                    Not a customer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {strangers.length > 0 && (
        <Card>
          <SectionHead
            title="Nothing like it in the CRM"
            hint="No customer shares a name with these, so they are new."
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {strangers.map((d) => (
              <div key={d.alpha} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                borderBottom: '1px solid var(--border)', paddingBottom: 8,
              }}>
                <div style={{ flex: 1, minWidth: 220 }}><Row row={d.row} /></div>
                <Button variant="primary" size="sm" disabled={!!busy}
                  onClick={() => void create(d.row.division, d.alpha, d.row.protean_name)}>
                  {busy === d.alpha ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                  Add to the CRM
                </Button>
                <Button variant="ghost" size="sm" disabled={!!busy}
                  onClick={() => setPicking(d)}>
                  <Search size={13} />
                  Pick a customer
                </Button>
                <Button variant="ghost" size="sm" disabled={!!busy}
                  onClick={() => setAsideFor(d)}>
                  <CircleSlash size={13} />
                  Not a customer
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {orphans.length > 0 && (
        <Card>
          <SectionHead
            title="Work with no account"
            hint="Open on the system, and never invoiced since the export began, so no account was ever made."
          />
          <Alert tone="info">
            Accounts come from the invoice file, which is the only export carrying a code. These
            companies have work on the ramps and no invoice in the range, so they could not appear
            above. Placing them puts the work on a customer record now, and an invoice arriving
            later takes it over cleanly.
          </Alert>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {orphans.map((o) => (
              <div key={`${o.division}:${o.protean_name}`} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                borderBottom: '1px solid var(--border)', paddingBottom: 8,
              }}>
                <Wrench size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14, color: 'var(--text)',
                  }}>{o.protean_name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3 }}>
                    {o.jobs} {o.jobs === 1 ? 'job' : 'jobs'} open
                    {o.oldest ? `, oldest since ${o.oldest}` : ''}
                  </div>
                </div>
                <div style={{
                  fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
                  color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                }}>{money(o.value)}</div>
                <Button variant="primary" size="sm" disabled={!!busy}
                  onClick={() => void placeWork(o, null, o.protean_name)}>
                  {busy === `work:${o.protean_name}`
                    ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                  Add to the CRM
                </Button>
                <Button variant="ghost" size="sm" disabled={!!busy}
                  onClick={() => setPickingWork(o)}>
                  <Search size={13} />
                  Pick a customer
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pickingWork && (
        <PickForWork
          work={pickingWork}
          crm={crm}
          onClose={() => setPickingWork(null)}
          onPick={(c) => {
            const o = pickingWork;
            setPickingWork(null);
            void placeWork(o, c.id, c.company_name);
          }}
        />
      )}

      {/* Group suggestions used to sit here and were worked out from
          this queue, which holds only the accounts nobody has placed.
          So they vanished at the moment they became usable: place the
          three Dawson accounts and the Dawson suggestion went with
          them. They live on the Groups tab now, asked of every customer
          rather than of whoever is still waiting. */}

      {picking && (
        <PickCustomer
          decision={picking}
          crm={crm}
          onClose={() => setPicking(null)}
          onPick={(c) => { setPicking(null); void bind(picking.row.division, picking.alpha, c.id, c.company_name); }}
        />
      )}

      {aside && (
        <SetAside
          decision={aside}
          onClose={() => setAsideFor(null)}
          onDone={async (why) => {
            setAsideFor(null);
            setBusy(aside.alpha);
            try {
              await setAside(supabase, aside.row.division, aside.alpha, why);
              say({ tone: 'success', title: `${aside.row.protean_name} is set aside.` });
              await after();
            } catch (e) {
              say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
            } finally { setBusy(null); }
          }}
        />
      )}
    </div>
  );
}

/** One account, as Protean has it, with what it is worth. */
function Row({ row, children }: { row: Waiting; children?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '6px 0',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14, color: 'var(--text)',
        }}>{row.protean_name}</div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3,
          display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          <span>{row.alpha}</span>
          <span>{row.invoices} {row.invoices === 1 ? 'invoice' : 'invoices'}</span>
          {row.last_billed && <span>last billed {row.last_billed}</span>}
          {row.open_jobs > 0 && <span>{row.open_jobs} open</span>}
        </div>
      </div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16, color: 'var(--text)',
        fontVariantNumeric: 'tabular-nums',
      }}>{money(row.net)}</div>
      {children}
    </div>
  );
}

/** Who this open work is for. */
function PickForWork({ work, crm, onPick, onClose }: {
  work: OrphanJobs;
  crm: CrmCustomer[];
  onPick: (c: CrmCustomer) => void;
  onClose: () => void;
}) {
  return (
    <PickAnybody
      title={`Whose work is ${work.protean_name}?`}
      note={`${work.jobs} ${work.jobs === 1 ? 'job' : 'jobs'} worth ${money(work.value)}.`}
      crm={crm}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/** Any customer in the CRM, found by typing. */
function PickCustomer({ decision, crm, onPick, onClose }: {
  decision: Decision;
  crm: CrmCustomer[];
  onPick: (c: CrmCustomer) => void;
  onClose: () => void;
}) {
  return (
    <PickAnybody
      title={`Who is ${decision.row.protean_name}?`}
      crm={crm}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/**
 * The picker itself, once.
 *
 * Two of these grew separately when open work needed one too, and two
 * search boxes over one list is two behaviours that drift.
 */
function PickAnybody({ title, note, crm, onPick, onClose }: {
  title: string;
  note?: string;
  crm: CrmCustomer[];
  onPick: (c: CrmCustomer) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return crm.slice(0, 30);
    return crm.filter((c) => c.company_name.toLowerCase().includes(needle)).slice(0, 30);
  }, [q, crm]);

  return (
    <Modal
      title={title}
      description={note}
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Leave it waiting</Button>}
    >
      <Field label="Search the CRM">
        <TextInput value={q} onChange={setQ} placeholder="Company name" autoFocus />
      </Field>
      <div style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
        {found.length === 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            No customer of that name. Close this and use Add to the CRM instead.
          </span>
        )}
        {found.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', border: 'none', background: 'transparent',
              borderBottom: '1px solid var(--border)', cursor: 'pointer',
              fontFamily: 'var(--inter)', fontSize: 13, color: 'var(--text)',
            }}
          >{c.company_name}</button>
        ))}
      </div>
    </Modal>
  );
}

/** Not a customer at all, and why. */
function SetAside({ decision, onDone, onClose }: {
  decision: Decision;
  onDone: (why: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [why, setWhy] = useState('');
  return (
    <Modal
      title={`Set ${decision.row.protean_name} aside`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!why.trim()} onClick={() => void onDone(why)}>
            Set aside
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 0 }}>
        Its {money(decision.row.net)} stays in the company total and stops counting towards
        anybody&apos;s customers. Cash sales and our own leasing company belong here.
      </p>
      <Field label="Why" hint="The next person should not have to guess.">
        <TextInput value={why} onChange={setWhy} placeholder="Our own leasing company" autoFocus />
      </Field>
    </Modal>
  );
}
