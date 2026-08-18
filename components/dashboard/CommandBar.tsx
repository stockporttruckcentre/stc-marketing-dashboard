'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Loader, Check, X, ArrowRight, Sparkles, Pencil, Paperclip } from 'lucide-react';
import { type Suggestion } from '@/lib/command/features';
import { suggestActions } from '@/lib/command/actions';
import { composeSuggestions } from '@/lib/command/compose';
import { composeEdits } from '@/lib/command/mutate';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { UserRole } from '@/lib/types';
import { planCommand } from '@/lib/command/plan';
import type { PlannedMeaning } from '@/lib/command/server/planner';
import type { MutationPreview } from '@/lib/command/server/mutation';
import { buildIndex, EMPTY_VOCABULARY, type VocabularyIndex } from '@/lib/command/vocab';
import { currentSelection, onSelectionChange, type ScreenSelection } from '@/lib/command/selection';
import type { CommandContext } from '@/lib/command/context';
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

/**
 * Which query parameter each screen keeps its open record in.
 *
 * These are the parameters the screens already use, so nothing had to
 * change for the bar to know what is open.
 */
const OPEN_RECORD: [string, string][] = [
  ['contact', 'contacts'],
  ['stock', 'trailers'],
  ['event', 'meetings'],
];

type Stage = 'idle' | 'running' | 'done' | 'answered' | 'confirming';

/**
 * What the server says a write is about to do, before it does it.
 *
 * The server's own type, imported rather than restated. The bar used to
 * describe the preview itself from a plan it had parsed in the browser,
 * which meant the shape somebody was shown and the shape that would be
 * written were two independent descriptions of one change.
 */
type ServerMeaning = PlannedMeaning & {
  kind?: 'read' | 'mutate';
  /** A file, when the sentence asked for one. */
  emit?: { format: string; to: string } | null;
  mutation?: { fields: { label: string; requires: string }[] } | null;
  preview?: MutationPreview | null;
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
  /* Held here rather than in the module it came from. The bar serves
     one person, but an index that lives in a module is an index two
     callers can disagree about, and there is no longer anywhere to put
     one. */
  const [vocabulary, setVocabularyIndex] = useState<VocabularyIndex>(EMPTY_VOCABULARY);
  useEffect(() => {
    let live = true;
    fetch('/api/command/vocabulary')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.vocabulary) return;
        setVocabularyIndex(buildIndex(j.vocabulary));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // A quick action button was pressed. Drop its phrasing in and hand the
  // user the caret so they finish the sentence.
  const seedWith = useCallback((phrase: string) => {
    setText(phrase);
    setStage('idle'); setOutcome(null);
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

  /* THERE IS NO SECOND READER.

     This used to run a second parser on every keystroke, show what THAT
     thought the sentence meant, and then execute it through a route of
     its own whenever the canonical path had not produced a runnable
     meaning. Two readers over one sentence is two answers to
     what it means, and the one that ran was whichever happened to be
     confident. What the bar shows and what it runs now both come from
     the server's canonical plan, and a sentence it refuses is refused. */
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
      /* WHAT IT WILL ACTUALLY DO, SAID IN THE SUGGESTION.

         An action that opens a screen opens a screen; one that seeds
         the bar puts a sentence in it for you to finish. Both were shown
         identically, so half the list looked like things that would
         happen on Enter and did not. */
      sub: h.runnable ? h.action.blurb : `${h.action.blurb}. Fills the bar in for you`,
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
  /* An instruction, as opposed to a question, is decided by the server.

     This used to call the instruction reader in the browser and act on
     what it said, which made the browser the semantic authority for
     writes while the server was the semantic authority for reads. The
     same sentence could be an instruction here and a question there,
     because the two sides load the vocabulary at different moments.
     `planCommand` decides it now, and `kind` is what comes back. */

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
  /* A FILE SOMEBODY ATTACHED, WHICH IS CONTEXT LIKE A SELECTION.

     The browser is the only place that has it, so it goes up with the
     sentence and the server decides what it means. Read as text here
     because a spreadsheet is text: nothing is parsed, mapped or
     validated in the browser. */
  const [attached, setAttached] = useState<
    { name: string; mime: string; size: number; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const takeFile = useCallback(async (file: File) => {
    const body = await file.text();
    setAttached({
      name: file.name,
      mime: file.type || 'text/csv',
      size: file.size,
      text: body,
    });
  }, []);

  const local = useMemo(
    () => (text.trim().length >= 3
      ? planCommand(text, {
          actorCapabilities: caps,
          vocabulary,
          context: attached ? { file: attached } : undefined,
        })
      : null),
    [text, caps, vocabulary, attached]);

  /* WHAT THE SCREEN HAS, SO "THESE" MEANS SOMETHING.

     The record from the page's own URL, which is where every screen in
     this application already keeps it, and the selection from whichever
     grid published one. Both go up with the sentence and neither is
     trusted on the way back: the server reads every id through the
     caller's own session. */
  const [selection, setSelection] = useState<ScreenSelection | null>(currentSelection());
  useEffect(() => onSelectionChange(setSelection), []);

  const context = useMemo<CommandContext>(() => {
    const out: CommandContext = {};
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const open = OPEN_RECORD.find(([key]) => params.get(key));
      if (open) {
        const id = params.get(open[0]);
        if (id) out.record = { entity: open[1], id };
      }
    }
    if (selection) out.selection = selection;
    if (attached) out.file = attached;
    return out;
    /* Recomputed when the selection changes or the page does. The bar
       reads the URL directly, so a screen that opens a record without a
       navigation is picked up on the next keystroke rather than never. */
  }, [selection, text, attached]);

  /* THE READING SOMEBODY IS SHOWN COMES FROM THE SERVER.
     The two sides do not know the same things. The live vocabulary is
     what makes a word a make or a customer, and the browser and the
     server load it at different moments, so the same sentence can
     honestly mean two things. The one that counts is the one the server
     will act on, and it arrives with a hash of its meaning. */
  const [meaning, setMeaning] = useState<ServerMeaning | null>(null);

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
        body: JSON.stringify({ text, context }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (live) setMeaning(j?.ok && j.understood ? j : null); })
        .catch(() => { if (live) setMeaning(null); });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [text, worthAsking, context]);
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
  /** The server read it as an instruction and will carry it out. */
  const instructionReady = meaning?.kind === 'mutate' && meaning.runnable;

  /** It asked for a file rather than an answer on screen. */
  const wantsFile = !!meaning?.emit && meaning.runnable;

  const useQuery = !instructionReady && !wantsFile && meaning?.kind !== 'mutate' && !!meaning?.runnable
    && readsOnly;

  /* Said out loud rather than left for the answer to imply. */
  const partial = meaning?.unresolved ?? [];
  const [answered, setAnswered] = useState<any | null>(null);
  const [editPreview, setEditPreview] = useState<MutationPreview | null>(null);
  const [cursor, setCursor] = useState(-1);
  useEffect(() => { setCursor(-1); }, [text]);

  const reset = useCallback(() => {
    setStage('idle'); setOutcome(null); setText(''); setAnswered(null);
    setEditPreview(null); setAttached(null);
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
  /**
   * The file the sentence asked for.
   *
   * The same sentence and the same hash go up. What comes back is the
   * file itself rather than a link to one, so nothing is stored and
   * there is no bucket with somebody's customer list sitting in it.
   */
  /**
   * Put a file in front of the person who asked for it.
   *
   * One place, because a command that writes AND produces a file now
   * comes back through the apply route, and a second copy of this would
   * be the one that stopped working.
   */
  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadArtefact(m: ServerMeaning) {
    setStage('running');
    const res = await fetch('/api/command/emit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, hash: m.hash, context }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const why = await res?.json().catch(() => null);
      setOutcome({ ok: false, message: why?.error ?? 'That file did not come back.' });
      setStage('done');
      return;
    }

    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
      ?? 'export';
    save(blob, name);

    const rows = Number(res.headers.get('X-Command-Rows') ?? 0);
    setOutcome({
      ok: true,
      message: `${name} downloaded, ${rows.toLocaleString('en-GB')} ${rows === 1 ? 'row' : 'rows'}.`,
    });
    setStage('done');
  }

  async function runQuery(m: ServerMeaning) {
    setStage('running');
    const res = await fetch('/api/command/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, hash: m.hash, context }),
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
   * The same planning endpoint that produced the reading, asked one
   * level deeper: `preview` makes it resolve the rows and report exactly
   * what each one holds now beside what it would hold. Nothing is
   * written on this pass, and the sentence is all that goes up.
   *
   * Deliberately not asked for on every keystroke. Resolving reads rows,
   * and a bar that queries the database for every letter typed is a bar
   * somebody turns off.
   */
  async function previewInstruction() {
    setStage('running');
    const res = await fetch('/api/command/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, preview: true, context }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));

    if (!res?.ok || !res.understood) {
      setOutcome({ ok: false, message: 'I could not make anything of that.' });
      setStage('done');
      return;
    }

    setMeaning(res as ServerMeaning);
    const p = res.preview as MutationPreview | null;

    if (!p) {
      setOutcome({ ok: false, message: 'That is not an instruction I can carry out.' });
      setStage('done');
      return;
    }
    if (!p.ok) {
      /* An ambiguity is a question with several answers, and the bar
         does not answer it on somebody's behalf. The candidates are
         shown so the next sentence can name one of them. */
      setEditPreview(p);
      setStage('confirming');
      return;
    }

    setEditPreview(p);
    setStage('confirming');
  }

  /**
   * The second pass, which is the one that writes.
   *
   * The sentence and two fingerprints. No record ids, no values, no
   * plan: the server plans and resolves again from the text, and the
   * fingerprints only decide whether what it arrives at is what was
   * shown here.
   */
  async function applyEdit(acknowledge?: number) {
    if (!meaning || !editPreview?.ok) return;
    setStage('running');
    const sent = await fetch('/api/command/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        planHash: meaning.hash,
        programmeHash: editPreview.programmeHash,
        confirm: true,
        acknowledge,
        context,
      }),
    }).catch(() => null);

    if (!sent) {
      setOutcome({ ok: false, message: 'That did not reach the server.' });
      setStage('done');
      return;
    }

    /* A CONFIRMED COMMAND CAN PRODUCE A FILE TOO.

       "Create a list from them and export it to Excel" is one thing
       somebody confirmed, and the file comes back from the same request
       that made the change. It arrives as the response BODY rather than
       as base64 in JSON, because a workbook of a complete selection can
       be tens of megabytes and a JSON round trip would hold three
       copies of it. What the command did is in the headers. */
    if (!sent.headers.get('Content-Type')?.includes('application/json')) {
      const blob = await sent.blob();
      const name = /filename="([^"]+)"/.exec(sent.headers.get('Content-Disposition') ?? '')?.[1]
        ?? 'export';
      save(blob, name);

      setEditPreview(null);
      setOutcome({
        ok: true,
        message: decodeURIComponent(sent.headers.get('X-Command-Message') ?? '')
          || `${name} downloaded.`,
      });
      setStage('done');
      return;
    }

    const res = await sent.json().catch((e) => ({ ok: false, message: e.message }));

    /* The world moved between looking and agreeing. Show what it says
       now rather than an error about what it used to say. */
    if (!res.ok && res.preview) {
      setEditPreview(res.preview as MutationPreview);
      setOutcome({ ok: false, message: res.message ?? 'Those records have changed. Check it and confirm again.' });
      setStage('confirming');
      return;
    }
    if (!res.ok && res.restated) {
      setMeaning(res.restated as ServerMeaning);
      setEditPreview(null);
      setOutcome({ ok: false, message: 'What that means has changed. Check the reading and press Enter again.' });
      setStage('idle');
      return;
    }

    setEditPreview(null);
    setOutcome(res);
    setStage('done');
  }

  async function submit() {
    /* An instruction first. "Add £1k refurb to STC143980" is not a
       question about trailers, however much it reads like one. Which it
       is was decided by the server, not here. */
    if (instructionReady) return previewInstruction();
    if (wantsFile && meaning) return downloadArtefact(meaning);
    if (useQuery && meaning) return runQuery(meaning);

    /* A SENTENCE THE CANONICAL PLANNER DOES NOT UNDERSTAND IS NOT
       UNDERSTOOD.

       There is nowhere else for it to go. Handing it to a second parser
       that might decide it means something else is how a refusal became
       an execution, and it is the one thing this architecture exists to
       stop. */
    setOutcome({
      ok: false,
      message: meaning?.blocked?.length
        ? meaning.blocked.join('; ')
        : 'I could not tell what you wanted there.',
      detail: meaning?.unresolved?.length
        ? `I did not read: ${meaning.unresolved.join(', ')}`
        : 'Try naming the thing and the action, like "book a call with Dawson on Friday at 10".',
    });
    setStage('done');
  }


  const bar = variant === 'bar';
  /** Is there anything below the input worth floating? */
  const hasPanel =
    (stage === 'idle' && text.trim().length >= 2) ||
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
        {/* The magnifier lights up when the SERVER has made something of
            the sentence, which is the only reading that counts. */}
        <Search size={bar ? 15 : 17} style={{ color: meaning ? 'var(--accent)' : 'var(--text-subtle)', flexShrink: 0 }} />
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
        {/* A SPREADSHEET, ATTACHED TO THE SENTENCE.

            Nothing is read from it here beyond its text. What its
            columns are, which rows are usable and what gets written are
            decided on the server, against the same dictionary the import
            screen uses. */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) takeFile(f);
            e.target.value = '';
          }}
        />
        {attached ? (
          <button
            onClick={() => setAttached(null)}
            title={`${attached.name}, attached. Click to take it off.`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              background: 'var(--surface-sunken)', color: 'var(--text-muted)',
              padding: '2px 7px', fontFamily: 'var(--inter)', fontSize: 11.5,
              cursor: 'pointer', maxWidth: 180,
            }}
          >
            <Paperclip size={11} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {attached.name}
            </span>
            <X size={11} />
          </button>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a spreadsheet"
            title="Attach a spreadsheet"
            style={{
              border: 'none', background: 'transparent', color: 'var(--text-subtle)',
              cursor: 'pointer', display: 'flex', flexShrink: 0,
            }}
          >
            <Paperclip size={bar ? 13 : 15} />
          </button>
        )}
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
            {instructionReady && meaning && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Pencil size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{meaning.summary}</span>
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

            {suggestions.length === 0 && (
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
            summary={meaning?.summary ?? 'This change'}
            onApply={applyEdit}
            onCancel={reset}
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
            {instructionReady && meaning && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 14px', background: 'var(--surface-sunken)',
                borderBottom: suggestions.length ? '1px solid var(--border)' : 'none',
                outline: cursor === -1 && suggestions.length ? '2px solid var(--focus)' : 'none',
                outlineOffset: -2,
              }}>
                <Pencil size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{meaning.summary}</span>
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

            {suggestions.length === 0 && (
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
            summary={meaning?.summary ?? 'This change'}
            onApply={applyEdit}
            onCancel={reset}
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

   Shown for every change, without exception, from the server's own
   description of what it is about to do. It names each record it
   matched and what that record holds now beside what it would hold,
   because the rows were found from a partial name or a description and
   the person typing has no other way to know which ones it landed on.

   PER ROW, NOT ONE SHARED LINE.

   A bulk change usually starts from different values. "They were
   outstanding" was true when the only thing a bulk instruction could
   narrow on was the column it was writing, and became a lie the moment
   it could narrow on anything else. Eleven rows holding eleven numbers
   get eleven lines, and one line only when they genuinely agree.

   WHERE SEVERAL RECORDS MATCHED A SENTENCE ABOUT ONE, IT ASKS.

   It does not offer to pick one. The only thing that reaches the server
   is the sentence, so resolving an ambiguity here would mean the browser
   deciding which record a command is about, which is the decision this
   whole path exists to keep on the server. What it does instead is show
   what matched, so the next sentence can name one of them.
   ============================================================= */
function EditConfirm({ preview, summary, onApply, onCancel }: {
  preview: MutationPreview | null;
  summary: string;
  /** The count, for a deletion. Absent for everything else. */
  onApply: (acknowledge?: number) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  if (!preview) return null;

  if (!preview.ok) {
    const candidates = preview.candidates ?? preview.referenceCandidates ?? [];
    return (
      <div style={{
        borderTop: '1px solid var(--border)', padding: 14,
        borderLeft: '2px solid var(--warning)',
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {candidates.length ? 'Which one?' : 'Nothing was changed'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: candidates.length ? 10 : 0 }}>
          {preview.why}
        </div>
        {candidates.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {candidates.slice(0, 8).map((c) => (
                <div key={c.id} style={{
                  padding: '7px 10px', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)', background: 'var(--surface)',
                  fontSize: 13, color: 'var(--text)',
                }}>
                  {c.label}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8, lineHeight: 1.5 }}>
              Say which one and press Enter again.
            </div>
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  const fields = preview.fields.map((f) => f.label).join(' and ');
  const shown = preview.uniform ? preview.rows.slice(0, 1) : preview.rows;
  const more = preview.count - preview.rows.length;

  return (
    <div style={{
      borderTop: '1px solid var(--border)', padding: 14,
      borderLeft: '2px solid var(--accent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <Pencil size={15} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
            {summary}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {fields} on {preview.count} {preview.count === 1 ? 'record' : 'records'}
            {preview.uniform && preview.count > 1 ? ', all the same' : ''}
          </div>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 1,
            marginTop: 10, padding: '8px 10px',
            background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
          }}>
            {shown.map((r, i) => (
              <div key={`${r.label}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '2px 0',
              }}>
                {!preview.uniform && <Label>{r.label}</Label>}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                  {r.before}
                </span>
                <ArrowRight size={13} style={{ color: 'var(--text-subtle)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.after}</span>
              </div>
            ))}
            {more > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', paddingTop: 4 }}>
                and {more} more
              </div>
            )}
          </div>

          {/* WHAT AN OPERATION OUTSIDE THE DATABASE SAYS IT WILL DO.

              For an import this is the only account anybody gets before
              agreeing to it: how many customers, what is being left out,
              and what the columns were read as. The last one is the part
              the old import never showed and the part that goes wrong. */}
          {preview.operations.filter((o) => o.says).map((o) => (
            <div key={o.capability} style={{
              fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.55,
            }}>
              {o.says}
            </div>
          ))}

          {preview.rows.length > 0 && preview.rows.every((r) => r.before === r.after) && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>
              That is what it already says, so nothing would change.
            </div>
          )}
          {preview.cautions.map((c) => (
            <div key={c} style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 8, lineHeight: 1.5 }}>
              {c}
            </div>
          ))}

          {/* A DELETION IS AGREED TO BY NUMBER.

              Everything else here can be put back by typing the old
              value in. Removing records cannot, so the same keystroke
              that confirms a price change must not confirm this: the
              number has to be typed, and the server checks it against
              the set as it stands rather than against this preview. */}
          {preview.severity === 'destructive' ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--danger, var(--warning))', marginTop: 10, lineHeight: 1.5 }}>
                This removes {preview.count} {preview.count === 1 ? 'record' : 'records'} and
                there is no undo. Type {preview.count} to confirm.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  inputMode="numeric"
                  aria-label={`Type ${preview.count} to confirm`}
                  style={{
                    width: 72, padding: '6px 8px', fontSize: 13,
                    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                    background: 'var(--surface)', color: 'var(--text)',
                  }}
                />
                <Button
                  variant="primary" size="sm"
                  disabled={Number(typed) !== preview.count}
                  onClick={() => onApply(preview.count)}
                >
                  <Check size={12} /> Delete {preview.count}
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="primary" size="sm" onClick={() => onApply()}>
                <Check size={12} /> {preview.count > 1 ? `Change all ${preview.count}` : 'Save it'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

