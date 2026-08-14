'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Loader, Check, X, ArrowRight, Sparkles, Pencil } from 'lucide-react';
import { parse, type ParseResult, type SlotSpec } from '@/lib/command/intents';
import { type Suggestion } from '@/lib/command/features';
import { suggestActions } from '@/lib/command/actions';
import { composeSuggestions } from '@/lib/command/compose';
import { parseEdit, composeEdits, type EditPlan } from '@/lib/command/mutate';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { UserRole } from '@/lib/types';
import { planCommand } from '@/lib/command/plan';
import type { PlannedMeaning } from '@/lib/command/server/planner';
import { applyVocabulary } from '@/lib/command/vocab';
import { Label, Badge, Button } from '@/components/kit/primitives';

/* =============================================================
   The toolbar.

   One input that understands what you meant and then does it. No model
   involved: lib/command normalises the words, pulls out the entities,
   scores the intents and reports what is still missing. This component
   is the conversation on top of that, and it only ever asks for what it
   genuinely could not work out.
   ============================================================= */

/**
 * Words that can only be a read.
 *
 * "Export a list of all trailers in stock" was being offered as Add a
 * trailer to stock, with slot chips and Enter to run, because the create
 * intent matched on "trailer" and "stock" and any write intent outranked
 * the query. A sentence that opens by asking for a list, a count or a
 * file is not an instruction to create a record, whatever nouns follow.
 */
export function readsOnlyText(text: string): boolean {
  return /\b(export|download|list|show me|how many|how much|count|total|value of|give me|what are|which|report on)\b/i
    .test(text);
}

type Candidate = { id: string; label: string; sub?: string; status?: string };
type Stage = 'idle' | 'choosing' | 'asking' | 'ready' | 'running' | 'done' | 'answered' | 'confirming';

/** What the server says a write is about to do, before it does it. */
type EditPreview = {
  recordId?: string;
  recordIds?: string[];
  recordLabel: string;
  recordSub?: string;
  fieldLabel: string;
  before: string;
  after: string;
  unchanged?: boolean;
  caution?: string | null;
  /** Several records at once, or every record matching a description. */
  bulk?: boolean;
  count?: number;
  /** Understood here, finished somewhere else. Nothing to save. */
  handoff?: 'markSold';
  link?: { href: string; label: string };
};
type Outcome = { ok: boolean; message: string; detail?: string; link?: { href: string; label: string } };

const EXAMPLES = [
  'generate a FleetSmart+ gold contract for Dawson for 3 6x2 vehicles with £500 wear and tear each',
  'how many trailers have we sold to TIP Trailers in the past 8 weeks',
  'schedule a call for Dave this Thursday',
  'create trailer STC142345 in the stocklist',
  'how much do we need to invoice to hit target',
];

/**
 * The same ideas, short enough to finish inside a top bar. The long ones
 * clip mid word at this width, which teaches nothing and looks broken.
 */
const SHORT_EXAMPLES = [
  'how many trailers are in stock',
  'schedule a call for Dave on Thursday',
  'open Bredbury Haulage',
  'add a trailer to the stocklist',
  'what have we sold this month',
];

/**
 * `seed` lets the quick action buttons drive this bar instead of each
 * one growing its own modal. Bump the nonce to re-apply the same text.
 */
export function CommandBar({ seed, variant = 'panel', role = 'viewer' }: {
  seed?: { text: string; nonce: number };
  /**
   * What this person may do. Actions they cannot reach are never
   * offered, because a suggestion that then refuses teaches people the
   * bar is unreliable. "Elevate Dave to admin" exists for one person.
   */
  role?: UserRole;
  /**
   * `panel` is the dashboard card. `bar` is the form that lives in the
   * top bar on every page: a 38px input, centred, whose results float
   * below it rather than growing the header.
   */
  variant?: 'panel' | 'bar';
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [slots, setSlots] = useState<Record<string, any>>({});
  const [choices, setChoices] = useState<{ slot: string; label: string; candidates: Candidate[]; allowNew: boolean } | null>(null);
  const [asking, setAsking] = useState<SlotSpec | null>(null);
  const [answer, setAnswer] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [exampleIdx, setExampleIdx] = useState(0);

  // Rotate the placeholder so people discover what it can do.
  useEffect(() => {
    if (text || stage !== 'idle') return;
    const t = setInterval(() => setExampleIdx((i) => (i + 1) % EXAMPLES.length), 5200);
    return () => clearInterval(t);
  }, [text, stage]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * What the data calls things, loaded once.
   *
   * "DAFs older than 2022" resolved to nothing, because no word in it
   * named a thing the app holds and there was no way to know DAF is a
   * make. A list of manufacturers in a file would have fixed that one
   * sentence and gone stale on the next delivery. The make column
   * already knows, so it is asked.
   *
   * Failure is silent on purpose. Without it the bar behaves exactly as
   * it did before, so a slow or unavailable load costs coverage rather
   * than the whole feature.
   */
  useEffect(() => {
    let live = true;
    fetch('/api/command/vocabulary')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.vocabulary) return;
        applyVocabulary(j.vocabulary);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // A quick action button was pressed. Drop its phrasing in and hand the
  // user the caret so they finish the sentence.
  const seedWith = useCallback((phrase: string) => {
    setText(phrase);
    setStage('idle'); setOutcome(null); setChoices(null); setAsking(null);
    const el = inputRef.current;
    if (el) { el.focus(); requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length)); }
  }, []);

  useEffect(() => {
    if (seed?.text) seedWith(seed.text);
  }, [seed?.nonce, seed?.text, seedWith]);

  /**
   * Now that the bar lives in the layout's top bar, the quick actions on
   * the dashboard are in a different tree and cannot pass a prop to it.
   * An event is the seam. Anything anywhere can say "put this in the
   * command bar" without knowing where the bar currently is.
   */
  useEffect(() => {
    function onSeed(e: Event) {
      const phrase = (e as CustomEvent<string>).detail;
      if (typeof phrase === 'string' && phrase.trim()) seedWith(phrase);
    }
    window.addEventListener('stc:command', onSeed as EventListener);
    return () => window.removeEventListener('stc:command', onSeed as EventListener);
  }, [seedWith]);

  // Live understanding, so the bar shows it is following along. Two
  // characters is enough: "cr" should already be offering something.
  const parsed = useMemo(() => (text.trim().length >= 2 ? parse(text) : null), [text]);
  // A bare noun like "stock" scores 3 on the nearest intent, which is not
  // enough to present as a command. Below this it is a browse, not an
  // instruction, and only the suggestions below should show.
  const preview = parsed && parsed.confidence >= 6 ? parsed : null;
  // Everything the app can do, ranked against what has been typed. This is
  // what stops a bare word like "meeting" hitting a dead end.
  const caps = useMemo(() => capabilitiesFor({ role }), [role]);

  /**
   * Everything the product can do, filtered to this person, ahead of the
   * plain screen list. An action is a better answer than a screen: "add
   * a contact" should offer adding a contact, not just opening the CRM.
   */
  const actions = useMemo(
    () => suggestActions(text, caps, 8)
      /* A sentence that opens by asking for a list is not offering to
         create one. "Export a list of all trailers in stock" was putting
         Add a trailer at the top, above four correct export
         suggestions. */
      .filter((h) => !(readsOnlyText(text) && h.action.kind === 'create'))
      .slice(0, 5)
      .map((h) => ({
      kind: 'action' as const,
      label: h.action.label,
      sub: h.action.blurb,
      path: h.action.seed ? undefined : h.action.path,
      phrase: h.action.seed,
      score: h.score,
    })),
    [text, caps],
  );

  /* The old feature registry used to supply these. It had no notion of
     permission, so a read only viewer typing "elevate dave to admin" was
     still offered the Team screen: the action was hidden and the door to
     it was left open. Screens come from the action registry now, which
     knows who may see them. */
  const features: Suggestion[] = [];

  /**
   * Concrete questions built from the data dictionary.
   *
   * This is what a bare verb should produce. Typing "export" is not a
   * failed search for an action called Export, it is somebody asking
   * what they can export, and the answer is hundreds of real sentences.
   */
  /**
   * An instruction, as opposed to a question.
   *
   * "Add £1k refurb value to STC143980" used to be read as a question
   * about trailers and answered with a list, which looks like it worked
   * and is not. An instruction that names its record, its field and its
   * value beats every question the same words could be read as.
   */
  const edit = useMemo(
    () => (text.trim().length >= 4 ? parseEdit(text, caps) : null),
    [text, caps],
  );
  const editReady = !!edit && edit.missing.length === 0 && edit.confidence >= 10;

  /**
   * Half a sentence is not a failure.
   *
   * Somebody who types a stock number and stops is part way through an
   * instruction, and the bar knows every field that instruction could
   * end in. These are the endings, offered rather than waited for.
   */
  const editHints = useMemo(
    () => composeEdits(text, caps, 5).map((e) => ({
      kind: 'action' as const,
      label: e.label,
      sub: e.sub,
      phrase: e.phrase,
      score: e.score,
    })),
    [text, caps],
  );

  const composed = useMemo(
    () => composeSuggestions(text, caps, 6).map((c) => ({
      kind: 'action' as const,
      label: c.label,
      sub: c.sub,
      phrase: c.phrase,
      score: c.score,
    })),
    [text, caps],
  );

  /**
   * Records that match what has been typed.
   *
   * The top bar used to carry a second input that did nothing but this:
   * type a company, jump to its record. Folding it in here is what let
   * that input go, rather than running two search boxes in a 52px bar.
   *
   * Deliberately last in the list. A bare word is more often a place you
   * want to go than a company you want to open, and a live lookup that
   * outranks the navigation makes the bar feel like it is guessing.
   */
  const [records, setRecords] = useState<Suggestion[]>([]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3 || stage !== 'idle') { setRecords([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/command/lookup?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        setRecords((json.contacts ?? []).map((c: any) => ({
          kind: 'feature' as const,
          label: c.company_name,
          sub: [c.contact_name, c.location, c.list_name].filter(Boolean).join(' · ') || 'Open this record',
          path: `/dashboard/crm?list=${c.list_id}&contact=${c.id}`,
          score: 0,
        })));
      } catch { if (!cancelled) setRecords([]); }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, stage]);

  const suggestions = useMemo(() => {
    // Actions first, then screens the action list did not already cover,
    // then matching records. Deduped on where they lead, so "stock" does
    // not offer the stock list twice.
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    // Composed questions outrank bare actions, because "Export customers
    // at Carrington" is a better answer to "export" than an entry called
    // Export a list that then asks which list.
    for (const s of [...editHints, ...composed, ...actions, ...features, ...records] as Suggestion[]) {
      const key = s.path ?? s.phrase ?? s.label;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out.slice(0, 7);
  }, [editHints, composed, actions, features, records]);
  // A composed question: count / total / average / list of anything in the
  // dictionary. This is what covers the hundreds of phrasings that no
  // hand-written intent list ever would.
  /* A local read, for deciding whether a half typed sentence is worth
     asking the server about. Planned with the actor's capabilities, so
     a command somebody may not run is not offered as one: an action
     that appears and then refuses teaches people the bar is
     unreliable. This is a filter on what to ask, never the answer. */
  const local = useMemo(
    () => (text.trim().length >= 3 ? planCommand(text, { actorCapabilities: caps }) : null),
    [text, caps]);

  /* THE READING SOMEBODY IS SHOWN COMES FROM THE SERVER.
     The two sides do not know the same things. The live vocabulary is
     what makes a word a make or a customer, and the browser and the
     server load it at different moments, so the same sentence can
     honestly mean two things. The one that counts is the one the server
     will act on, and it arrives with a hash of its meaning. */
  const [meaning, setMeaning] = useState<PlannedMeaning | null>(null);

  const worthAsking = !!local
    && local.presentation.confidence >= 8
    && local.availability.representable
    && local.availability.executable
    && local.availability.permitted !== false;

  useEffect(() => {
    if (!worthAsking) { setMeaning(null); return; }
    let live = true;
    /* Typing is faster than a round trip. Ask about the sentence that
       stopped changing, not every keystroke on the way to it. */
    const timer = setTimeout(() => {
      fetch('/api/command/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (live) setMeaning(j?.ok && j.understood ? j : null); })
        .catch(() => { if (live) setMeaning(null); });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [text, worthAsking]);
  // An instruction always beats a question: "create trailer STC1" must not
  // be answered as "count trailers". Otherwise a confident query wins.
  /* Words that can only be a read.
     "Export a list of all trailers in stock" was being offered as Add a
     trailer to stock, with slot chips and Enter to run, because the
     create intent matched on "trailer" and "stock" and any write intent
     outranked the query. A sentence that opens by asking for a list, a
     count or a file is not an instruction to create a record, whatever
     nouns come after it. */
  const readsOnly = readsOnlyText(text);

  // An instruction outranks the question its words could also be, and a
  // question outranks a browse. A read verb outranks a write intent.
  /* Offered only when the server says it is runnable. `runnable` is
     every gate at once, decided in one place rather than in each
     caller's own idea of what "can I run this" means: well formed,
     permitted for this person, something performs it, and not refused. */
  const useQuery = !editReady && !!meaning?.runnable
    && (readsOnly || !preview?.intent?.writes);

  /* Said out loud rather than left for the answer to imply. */
  const partial = meaning?.unresolved ?? [];
  const [answered, setAnswered] = useState<any | null>(null);
  const [editPreview, setEditPreview] = useState<EditPreview | null>(null);
  const [editChoices, setEditChoices] = useState<Candidate[] | null>(null);
  const [cursor, setCursor] = useState(-1);
  useEffect(() => { setCursor(-1); }, [text]);

  const reset = useCallback(() => {
    setStage('idle'); setResult(null); setSlots({}); setChoices(null);
    setAsking(null); setAnswer(''); setOutcome(null); setText(''); setAnswered(null);
    setEditPreview(null); setEditChoices(null);
  }, []);

  /** Walk forward: resolve references, then ask for anything still missing. */
  const advance = useCallback(async (parsed: ParseResult, current: Record<string, any>) => {
    if (!parsed.intent) return;

    // Anything still missing that we cannot infer?
    const stillMissing = parsed.intent.slots.filter(
      (s) => s.required && (current[s.key] == null || current[s.key] === ''),
    );

    // Resolve references against the database first.
    const needsResolve = parsed.filled.some((f) => f.needsResolve) || current.stockNo;
    if (needsResolve && !current.__resolved) {
      const res = await fetch('/api/command/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: parsed.intent.id, slots: current }),
      }).then((r) => r.json());

      const next: Record<string, any> = { ...current, __resolved: true };

      if (res.stockNo?.exists && parsed.intent.id === 'create_stock_trailer') {
        setOutcome({
          ok: false,
          message: `${res.stockNo.value} is already in the stock list.`,
          detail: [res.stockNo.record?.make, res.stockNo.record?.model].filter(Boolean).join(' ') || undefined,
          link: { href: `/dashboard/sales?stock=${res.stockNo.record.id}`, label: 'Open it' },
        });
        setStage('done');
        return;
      }

      if (res.contact) {
        if (res.contact.resolved) {
          next.contactId = res.contact.resolved.id;
          next.contactLabel = res.contact.resolved.company_name;
        } else if (res.contact.candidates?.length > 1) {
          setSlots(next); setResult(parsed);
          setChoices({
            slot: 'contact',
            label: `Which ${res.contact.term}?`,
            candidates: res.contact.candidates,
            allowNew: true,
          });
          setStage('choosing');
          return;
        } else if (res.contact.none) {
          setSlots(next); setResult(parsed);
          setChoices({
            slot: 'contact',
            label: `Nothing in the CRM matches "${res.contact.term}".`,
            candidates: [],
            allowNew: true,
          });
          setStage('choosing');
          return;
        }
      }
      return advance(parsed, next);
    }

    if (stillMissing.length) {
      setSlots(current); setResult(parsed);
      setAsking(stillMissing[0]); setAnswer('');
      setStage('asking');
      return;
    }

    setSlots(current); setResult(parsed); setStage('ready');
  }, []);

  function takeSuggestion(s: Suggestion) {
    if (s.path) { router.push(s.path); reset(); return; }
    if (s.phrase) {
      setText(s.phrase);
      setCursor(-1);
      const el = inputRef.current;
      if (el) { el.focus(); requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length)); }
    }
  }

  /**
   * Run the reading that was shown.
   *
   * The sentence and the hash of the meaning go up; nothing else. The
   * server replans from the text in the same environment it previewed
   * in, and the hash is how it knows whether the reading it arrives at
   * is the one somebody agreed to. A client cannot send a plan, so
   * there is nothing here to hand craft.
   */
  async function runQuery(m: PlannedMeaning) {
    setStage('running');
    const res = await fetch('/api/command/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, hash: m.hash }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));

    /* The words mean something else now, because the data moved under
       them. Show the new reading rather than the answer to a question
       nobody asked, and let them press Enter on what it says now. */
    if (!res.ok && res.restated) {
      setMeaning(res);
      setOutcome({ ok: false, message: 'What that means has changed. Check the reading and press Enter again.' });
      setStage('idle');
      return;
    }
    if (!res.ok) {
      setOutcome({ ok: false, message: res.error ?? 'That query did not run.' });
      setStage('done');
      return;
    }
    setAnswered(res);
    setStage('answered');
  }

  /**
   * Ask the server what the instruction would do, without doing it.
   *
   * Nothing is written on this pass. The record is matched, the current
   * value comes back beside the proposed one, and only a deliberate
   * confirm sends the change. A bar that edits a record the moment you
   * press Enter is a bar people stop trusting with real data.
   */
  async function previewEdit(p: EditPlan, recordId?: string) {
    setStage('running');
    const res = await fetch('/api/command/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity: p.entity, fieldKey: p.field.key, op: p.op, value: p.value,
        targets: p.targets.map((t) => (t.kind === 'filter'
          ? { kind: 'filter', column: t.column, value: t.value, label: t.text }
          : { kind: t.kind, text: t.text })),
        recordId, handoff: p.handoff,
      }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, message: e.message }));

    if (res.needsChoice) {
      setEditChoices(res.candidates ?? []);
      setStage('confirming');
      return;
    }
    if (!res.ok) {
      setOutcome({ ok: false, message: res.message ?? 'That change did not go through.' });
      setStage('done');
      return;
    }
    setEditChoices(null);
    setEditPreview(res as EditPreview);
    setStage('confirming');
  }

  /** The second pass, which is the one that writes. */
  async function applyEdit() {
    if (!edit || !editPreview) return;
    setStage('running');
    const res = await fetch('/api/command/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity: edit.entity, fieldKey: edit.field.key, op: edit.op, value: edit.value,
        // A bulk change is defined by its description, not by ids, so the
        // targets go back up rather than the rows they matched.
        targets: edit.targets.map((t) => (t.kind === 'filter'
          ? { kind: 'filter', column: t.column, value: t.value, label: t.text }
          : { kind: t.kind, text: t.text })),
        recordIds: editPreview.recordIds, recordId: editPreview.recordId,
        confirm: true,
      }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, message: e.message }));
    setEditPreview(null);
    setOutcome(res);
    setStage('done');
  }

  async function submit() {
    // An instruction first. "Add £1k refurb to STC143980" is not a
    // question about trailers, however much it reads like one.
    if (editReady && edit) return previewEdit(edit);
    if (useQuery && meaning) return runQuery(meaning);
    const parsed = parse(text);
    if (!parsed.intent) {
      setOutcome({
        ok: false,
        message: 'I could not tell what you wanted there.',
        detail: 'Try naming the thing and the action, like "schedule a call for Dawson on Friday".',
      });
      setStage('done');
      return;
    }
    const initial: Record<string, any> = {};
    for (const f of parsed.filled) initial[f.key] = f.value;
    if (parsed.entities.range) initial.rangeLabel = parsed.entities.range.label;
    await advance(parsed, initial);
  }

  async function run() {
    if (!result?.intent) return;
    setStage('running');
    const res = await fetch('/api/command/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentId: result.intent.id, slots }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, message: e.message }));
    setOutcome(res);
    setStage('done');
  }

  function pickCandidate(c: Candidate | null) {
    if (!choices || !result) return;
    const next = { ...slots };
    if (c) {
      next.contactId = c.id;
      next.contactLabel = c.label;
    } else {
      // "Add it as new" keeps whatever they typed as the name.
      next.contactId = null;
      next.createContact = true;
    }
    setChoices(null);
    advance(result, next);
  }

  function answerSlot() {
    if (!asking || !result) return;
    const v = answer.trim();
    if (!v) return;
    const next = { ...slots, [asking.key]: v, __resolved: false };
    if (asking.key === 'contact') next.contactLabel = v;
    setAsking(null);
    advance(result, next);
  }

  const understood = preview?.intent ?? result?.intent ?? null;

  const bar = variant === 'bar';
  /** Is there anything below the input worth floating? */
  const hasPanel =
    (stage === 'idle' && text.trim().length >= 2) ||
    stage === 'choosing' || stage === 'asking' || stage === 'ready' ||
    stage === 'running' || stage === 'done' || stage === 'answered' ||
    stage === 'confirming';

  return (
    <div className="kit" style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      overflow: bar ? 'visible' : 'hidden',
      position: bar ? 'relative' : undefined,
      width: '100%',
    }}>
      {/* the input */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: bar ? 9 : 10,
        padding: bar ? '0 12px' : '0 14px',
        /* 38, not 30. This is the way into the whole product and at 30px
           in a 52px bar it read as a search box somebody bolted on. */
        height: bar ? 38 : 52,
      }}>
        <Search size={bar ? 15 : 17} style={{ color: understood ? 'var(--accent)' : 'var(--text-subtle)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); if (stage === 'done') { setOutcome(null); setStage('idle'); } }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && stage === 'idle') {
              e.preventDefault(); setCursor((c) => Math.min(c + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp' && stage === 'idle') {
              e.preventDefault(); setCursor((c) => Math.max(c - 1, -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (stage === 'idle' && cursor >= 0 && suggestions[cursor]) takeSuggestion(suggestions[cursor]);
              else submit();
            } else if (e.key === 'Escape') reset();
          }}
          placeholder={(bar ? SHORT_EXAMPLES : EXAMPLES)[exampleIdx]}
          style={{
            flex: 1, minWidth: 0, height: bar ? 36 : 40, border: 'none', outline: 'none',
            background: 'transparent', color: 'var(--text)',
            fontFamily: 'var(--inter)', fontSize: bar ? 13.5 : 14.5, letterSpacing: '-0.01em',
          }}
        />
        {text && (
          <button onClick={reset} aria-label="Clear"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
            <X size={bar ? 13 : 15} />
          </button>
        )}
        <kbd style={{
          fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          padding: '2px 6px', flexShrink: 0,
        }}>Ctrl K</kbd>
      </div>
      {bar
        /* In the top bar the panel cannot push the page around, so it
           floats under the input as a dropdown. Same content, same
           states, different container. */
        ? (hasPanel && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 80,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3)", overflow: "hidden",
            maxHeight: "70vh", overflowY: "auto",
          }}>
            <div style={{ marginTop: -1 }}>

        {/* what it thinks you meant, and everything else it could be */}
        {stage === 'idle' && text.trim().length >= 2 && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {editReady && edit && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Pencil size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{edit.summary}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to check it
                </span>
              </div>
            )}
            {useQuery && meaning && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  {meaning.summary}
                </span>
                {partial.length > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    answers part of that
                  </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to answer
                </span>
              </div>
            )}
            {!useQuery && preview?.intent && !(readsOnly && preview.intent.writes) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{preview.intent.title}</span>
                {preview.filled.map((f) => (
                  <Badge key={f.key} tone="info">{f.label}: {f.display}</Badge>
                ))}
                {preview.missing.map((m) => (
                  <Badge key={m.key} tone="warning">{m.label}?</Badge>
                ))}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to run
                </span>
              </div>
            )}

            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                onMouseDown={(e) => { e.preventDefault(); takeSuggestion(s); }}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  textAlign: 'left', minHeight: 38, padding: '7px 14px',
                  border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : '1px solid var(--border)',
                  background: cursor === i ? 'var(--bg-subtle)' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--inter)',
                }}
              >
                {s.kind === 'feature'
                  ? <ArrowRight size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                  : <Sparkles size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                <span style={{ fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{s.label}</span>
                <span style={{
                  fontSize: 12, color: 'var(--text-subtle)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.sub}</span>
              </button>
            ))}

            {!preview?.intent && suggestions.length === 0 && (
              <div style={{ padding: '11px 14px' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 7 }}>
                  Nothing matches that yet. Things that work:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {EXAMPLES.slice(0, 3).map((ex) => (
                    <button key={ex} onMouseDown={(e) => { e.preventDefault(); setText(ex); inputRef.current?.focus(); }}
                      style={{
                        textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                        color: 'var(--text-subtle)', fontSize: 12, fontFamily: 'var(--inter)', padding: 0,
                      }}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* disambiguation */}
        {stage === 'choosing' && choices && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>{choices.label}</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {choices.candidates.map((c) => (
                <button key={c.id} onClick={() => pickCandidate(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    minHeight: 36, padding: '6px 10px', borderRadius: 'var(--r)',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--text)', cursor: 'pointer', fontSize: 13,
                  }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{c.label}</span>
                  {c.sub && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{c.sub}</span>}
                  {c.status && <Badge tone="neutral">{c.status}</Badge>}
                </button>
              ))}
              {choices.allowNew && (
                <button onClick={() => pickCandidate(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    minHeight: 36, padding: '6px 10px', borderRadius: 'var(--r)',
                    border: '1px dashed var(--border-strong)', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
                  }}>
                  Add it as a new record instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* one question at a time */}
        {stage === 'asking' && asking && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>{asking.ask}</Label>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                autoFocus value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answerSlot(); } }}
                placeholder={asking.label}
                style={{
                  flex: 1, height: 32, padding: '0 10px', borderRadius: 'var(--r)',
                  border: '1px solid var(--border-strong)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, fontFamily: 'var(--inter)',
                }}
              />
              <Button variant="primary" onClick={answerSlot} disabled={!answer.trim()}>Continue</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {/* confirm before writing */}
        {stage === 'ready' && result?.intent && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>About to {result.intent.title.toLowerCase()}</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0 12px' }}>
              {result.intent.slots.map((s) => {
                const v = slots[s.key === 'contact' ? (slots.contactLabel ? 'contactLabel' : 'contact') : s.key];
                if (v == null || v === '') return null;
                const display = typeof v === 'object'
                  ? (v.amount ? `£${Number(v.amount).toLocaleString()}${v.per === 'unit' ? ' per unit' : ''}` : JSON.stringify(v))
                  : String(v);
                return <Badge key={s.key} tone="info">{s.label}: {display}</Badge>;
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant={result.intent.writes ? 'accent' : 'primary'} onClick={run}>
                {result.intent.writes ? 'Confirm' : 'Run'} <ArrowRight size={13} />
              </Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {stage === 'running' && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Loader size={14} className="spin" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Working on it</span>
          </div>
        )}

        {/* the answer to a question */}
        {stage === 'answered' && answered && (
          <Answer
            answered={answered}
            onGo={(href) => router.push(href)}
            onReset={reset}
          />
        )}

        {/* what it is about to change, before it changes it */}
        {stage === 'confirming' && (
          <EditConfirm
            preview={editPreview}
            candidates={editChoices}
            summary={edit?.summary ?? 'This change'}
            onPick={(id) => { if (edit) previewEdit(edit, id); }}
            onApply={applyEdit}
            onCancel={reset}
            onGo={(href) => { router.push(href); reset(); }}
          />
        )}

        {/* what happened, and where it went */}
        {stage === 'done' && outcome && (
          <div style={{
            borderTop: '1px solid var(--border)', padding: 14,
            borderLeft: `2px solid ${outcome.ok ? 'var(--success)' : 'var(--warning)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              {outcome.ok
                ? <Check size={15} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
                : <X size={15} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{outcome.message}</div>
                {outcome.detail && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{outcome.detail}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {outcome.link && (
                    <Button variant="primary" size="sm" onClick={() => router.push(outcome.link!.href)}>
                      {outcome.link.label} <ArrowRight size={12} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={reset}>Do something else</Button>
                </div>
              </div>
            </div>
          </div>
        )}
            </div>
          </div>
        ))
        : <>

        {/* what it thinks you meant, and everything else it could be */}
        {stage === 'idle' && text.trim().length >= 2 && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {editReady && edit && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Pencil size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{edit.summary}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to check it
                </span>
              </div>
            )}
            {useQuery && meaning && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  {meaning.summary}
                </span>
                {partial.length > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    answers part of that
                  </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to answer
                </span>
              </div>
            )}
            {!useQuery && preview?.intent && !(readsOnly && preview.intent.writes) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{preview.intent.title}</span>
                {preview.filled.map((f) => (
                  <Badge key={f.key} tone="info">{f.label}: {f.display}</Badge>
                ))}
                {preview.missing.map((m) => (
                  <Badge key={m.key} tone="warning">{m.label}?</Badge>
                ))}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  <CornerDownLeft size={12} /> to run
                </span>
              </div>
            )}

            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                onMouseDown={(e) => { e.preventDefault(); takeSuggestion(s); }}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  textAlign: 'left', minHeight: 38, padding: '7px 14px',
                  border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : '1px solid var(--border)',
                  background: cursor === i ? 'var(--bg-subtle)' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--inter)',
                }}
              >
                {s.kind === 'feature'
                  ? <ArrowRight size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                  : <Sparkles size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                <span style={{ fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{s.label}</span>
                <span style={{
                  fontSize: 12, color: 'var(--text-subtle)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.sub}</span>
              </button>
            ))}

            {!preview?.intent && suggestions.length === 0 && (
              <div style={{ padding: '11px 14px' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 7 }}>
                  Nothing matches that yet. Things that work:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {EXAMPLES.slice(0, 3).map((ex) => (
                    <button key={ex} onMouseDown={(e) => { e.preventDefault(); setText(ex); inputRef.current?.focus(); }}
                      style={{
                        textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                        color: 'var(--text-subtle)', fontSize: 12, fontFamily: 'var(--inter)', padding: 0,
                      }}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* disambiguation */}
        {stage === 'choosing' && choices && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>{choices.label}</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {choices.candidates.map((c) => (
                <button key={c.id} onClick={() => pickCandidate(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    minHeight: 36, padding: '6px 10px', borderRadius: 'var(--r)',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--text)', cursor: 'pointer', fontSize: 13,
                  }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{c.label}</span>
                  {c.sub && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{c.sub}</span>}
                  {c.status && <Badge tone="neutral">{c.status}</Badge>}
                </button>
              ))}
              {choices.allowNew && (
                <button onClick={() => pickCandidate(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    minHeight: 36, padding: '6px 10px', borderRadius: 'var(--r)',
                    border: '1px dashed var(--border-strong)', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
                  }}>
                  Add it as a new record instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* one question at a time */}
        {stage === 'asking' && asking && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>{asking.ask}</Label>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                autoFocus value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answerSlot(); } }}
                placeholder={asking.label}
                style={{
                  flex: 1, height: 32, padding: '0 10px', borderRadius: 'var(--r)',
                  border: '1px solid var(--border-strong)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, fontFamily: 'var(--inter)',
                }}
              />
              <Button variant="primary" onClick={answerSlot} disabled={!answer.trim()}>Continue</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {/* confirm before writing */}
        {stage === 'ready' && result?.intent && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
            <Label>About to {result.intent.title.toLowerCase()}</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0 12px' }}>
              {result.intent.slots.map((s) => {
                const v = slots[s.key === 'contact' ? (slots.contactLabel ? 'contactLabel' : 'contact') : s.key];
                if (v == null || v === '') return null;
                const display = typeof v === 'object'
                  ? (v.amount ? `£${Number(v.amount).toLocaleString()}${v.per === 'unit' ? ' per unit' : ''}` : JSON.stringify(v))
                  : String(v);
                return <Badge key={s.key} tone="info">{s.label}: {display}</Badge>;
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant={result.intent.writes ? 'accent' : 'primary'} onClick={run}>
                {result.intent.writes ? 'Confirm' : 'Run'} <ArrowRight size={13} />
              </Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {stage === 'running' && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Loader size={14} className="spin" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Working on it</span>
          </div>
        )}

        {/* the answer to a question */}
        {stage === 'answered' && answered && (
          <Answer
            answered={answered}
            onGo={(href) => router.push(href)}
            onReset={reset}
          />
        )}

        {/* what it is about to change, before it changes it */}
        {stage === 'confirming' && (
          <EditConfirm
            preview={editPreview}
            candidates={editChoices}
            summary={edit?.summary ?? 'This change'}
            onPick={(id) => { if (edit) previewEdit(edit, id); }}
            onApply={applyEdit}
            onCancel={reset}
            onGo={(href) => { router.push(href); reset(); }}
          />
        )}

        {/* what happened, and where it went */}
        {stage === 'done' && outcome && (
          <div style={{
            borderTop: '1px solid var(--border)', padding: 14,
            borderLeft: `2px solid ${outcome.ok ? 'var(--success)' : 'var(--warning)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              {outcome.ok
                ? <Check size={15} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
                : <X size={15} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{outcome.message}</div>
                {outcome.detail && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{outcome.detail}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {outcome.link && (
                    <Button variant="primary" size="sm" onClick={() => router.push(outcome.link!.href)}>
                      {outcome.link.label} <ArrowRight size={12} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={reset}>Do something else</Button>
                </div>
              </div>
            </div>
          </div>
        )}
          </>}
    </div>
  );
}

/* =============================================================
   The answer.

   One copy. There were two, byte for byte, because the bar renders in
   two places and the block was pasted rather than lifted. Adding a
   result shape meant remembering to add it twice, and the one nobody
   remembered would look like the feature had not been built.
   ============================================================= */
function Answer({ answered, onGo, onReset }: {
  answered: any;
  onGo: (href: string) => void;
  onReset: () => void;
}) {
  const gbp = (v: number) => new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(v);

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
      <Label>{answered.summary}</Label>

      {/* What was asked for and could not be answered here. The server
          sends this with the answer, and an answer that carries any of
          it is not the question having been answered. */}
      {(answered.unresolved ?? []).length > 0 && (
        <div style={{
          marginTop: 8, fontSize: 12, color: 'var(--text-muted)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <span style={{ fontWeight: 600 }}>This answers part of what you asked.</span>
          {answered.unresolved.map((u: string) => (
            <span key={u}>Could not do this part: {u}</span>
          ))}
        </div>
      )}

      {answered.kind === 'number' && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 34, lineHeight: 1,
            letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
          }}>
            {answered.money ? gbp(answered.value)
              : `${Number(answered.value).toLocaleString()}${answered.unit ? ` ${answered.unit}` : ''}`}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {answered.money || answered.unit
              ? `${answered.amountLabel ?? ''} across ${answered.rowCount} ${answered.entity}`
              : answered.entity}
          </span>
        </div>
      )}

      {answered.kind === 'number' && (answered.sample ?? []).length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {answered.sample.map((s: any) => (
            <div key={s.id} style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{s.title}</span>
              <span style={{ color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub}</span>
            </div>
          ))}
          {answered.value > answered.sample.length && (
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
              and {answered.value - answered.sample.length} more
            </div>
          )}
        </div>
      )}

      {/* A few rows in a stated order. "The five cheapest" is a list of
          five, and answering it with the number five is a different
          question. */}
      {answered.kind === 'rows' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(answered.rows ?? []).map((r: any) => (
            <div key={r.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10,
              alignItems: 'baseline', fontSize: 12.5,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.title}</span>
                <span style={{ color: 'var(--text-subtle)', marginLeft: 8 }}>{r.sub}</span>
              </span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                {r.figure == null ? <span style={{ color: 'var(--text-subtle)' }}>—</span>
                  : r.money ? gbp(Number(r.figure))
                  : Number(r.figure).toLocaleString()}
              </span>
            </div>
          ))}
          {answered.total > (answered.rows ?? []).length && (
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
              {answered.orderLabel ? `${answered.orderLabel}, ` : ''}
              out of {answered.total.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {answered.kind === 'grouped' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(() => {
            const top = Math.max(...answered.groups.map((g: any) => answered.measure === 'count' ? g.count : g.total), 1);
            return answered.groups.map((g: any) => {
              const v = answered.measure === 'count' ? g.count : g.total;
              return (
                <div key={g.key} style={{ display: 'grid', gridTemplateColumns: '132px minmax(60px,1fr) 74px', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.key}</span>
                  <div style={{ height: 5, borderRadius: 'var(--r-full)', background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(v / top) * 100}%`, background: 'var(--accent)', borderRadius: 'var(--r-full)' }} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                    {answered.measure === 'count' ? v.toLocaleString()
                      : answered.money === false ? Math.round(v).toLocaleString()
                      : gbp(v)}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" onClick={() => onGo(answered.listHref ?? answered.href ?? '/dashboard')}>
          See them <ArrowRight size={12} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>Ask something else</Button>
      </div>
    </div>
  );
}

/* =============================================================
   The confirmation before a write.

   Shown for every field edit, without exception. It names the record it
   matched, the field, and the value before and after, because the record
   was found from a partial name and the person typing has no other way
   to know which row it landed on.

   Where more than one record matched, it asks instead of guessing. A bar
   that picks the first Dawson and writes to it is a bar that eventually
   writes to the wrong Dawson.
   ============================================================= */
function EditConfirm({ preview, candidates, summary, onPick, onApply, onCancel, onGo }: {
  preview: EditPreview | null;
  candidates: Candidate[] | null;
  summary: string;
  onPick: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onGo: (href: string) => void;
}) {
  if (candidates) {
    return (
      <div style={{ borderTop: '1px solid var(--border)', padding: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          Which one?
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
          {summary} needs one record, and more than one matched.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                textAlign: 'left', width: '100%', padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
                fontFamily: 'var(--inter)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
              {c.sub && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.sub}</span>}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div style={{
      borderTop: '1px solid var(--border)', padding: 14,
      borderLeft: '2px solid var(--accent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <Pencil size={15} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
            {preview.recordLabel}
          </div>
          {preview.recordSub && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{preview.recordSub}</div>
          )}

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 10, padding: '8px 10px',
            background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
          }}>
            <Label>{preview.fieldLabel}</Label>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
              {preview.before}
            </span>
            <ArrowRight size={13} style={{ color: 'var(--text-subtle)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{preview.after}</span>
          </div>

          {preview.unchanged && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>
              That is what it already says, so nothing would change.
            </div>
          )}
          {preview.caution && (
            <div style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 8, lineHeight: 1.5 }}>
              {preview.caution}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {/* Selling is understood here and finished on the stock
                list, where the price and the commission line are. A
                Save button that quietly changed a status column would
                leave the tracker out of step with the yard. */}
            {preview.handoff === 'markSold'
              ? (
                <Button variant="primary" size="sm" onClick={() => onGo(preview.link?.href ?? '/dashboard/sales')}>
                  {preview.link?.label ?? 'Open the trailer'} <ArrowRight size={12} />
                </Button>
              )
              : (
                <Button variant="primary" size="sm" onClick={onApply}>
                  <Check size={12} /> {preview.bulk ? `Change all ${preview.count}` : 'Save it'}
                </Button>
              )}
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
