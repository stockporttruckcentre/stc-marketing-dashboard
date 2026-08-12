'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Loader, Check, X, ArrowRight, Sparkles } from 'lucide-react';
import { parse, type ParseResult, type SlotSpec } from '@/lib/command/intents';
import { suggestFeatures, type Suggestion } from '@/lib/command/features';
import { Label, Badge, Button } from '@/components/kit/primitives';

/* =============================================================
   The toolbar.

   One input that understands what you meant and then does it. No model
   involved: lib/command normalises the words, pulls out the entities,
   scores the intents and reports what is still missing. This component
   is the conversation on top of that, and it only ever asks for what it
   genuinely could not work out.
   ============================================================= */

type Candidate = { id: string; label: string; sub?: string; status?: string };
type Stage = 'idle' | 'choosing' | 'asking' | 'ready' | 'running' | 'done';
type Outcome = { ok: boolean; message: string; detail?: string; link?: { href: string; label: string } };

const EXAMPLES = [
  'generate a FleetSmart+ gold contract for Dawson for 3 6x2 vehicles with £500 wear and tear each',
  'how many trailers have we sold to TIP Trailers in the past 8 weeks',
  'schedule a call for Dave this Thursday',
  'create trailer STC142345 in the stocklist',
  'how much do we need to invoice to hit target',
];

/**
 * `seed` lets the quick action buttons drive this bar instead of each
 * one growing its own modal. Bump the nonce to re-apply the same text.
 */
export function CommandBar({ seed }: { seed?: { text: string; nonce: number } }) {
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

  // A quick action button was pressed. Drop its phrasing in and hand the
  // user the caret so they finish the sentence.
  useEffect(() => {
    if (!seed?.text) return;
    setText(seed.text);
    setStage('idle'); setOutcome(null); setChoices(null); setAsking(null);
    const el = inputRef.current;
    if (el) { el.focus(); requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length)); }
  }, [seed?.nonce, seed?.text]);

  // Live understanding, so the bar shows it is following along. Two
  // characters is enough: "cr" should already be offering something.
  const parsed = useMemo(() => (text.trim().length >= 2 ? parse(text) : null), [text]);
  // A bare noun like "stock" scores 3 on the nearest intent, which is not
  // enough to present as a command. Below this it is a browse, not an
  // instruction, and only the suggestions below should show.
  const preview = parsed && parsed.confidence >= 6 ? parsed : null;
  // Everything the app can do, ranked against what has been typed. This is
  // what stops a bare word like "meeting" hitting a dead end.
  const suggestions = useMemo(() => suggestFeatures(text, 5), [text]);
  const [cursor, setCursor] = useState(-1);
  useEffect(() => { setCursor(-1); }, [text]);

  const reset = useCallback(() => {
    setStage('idle'); setResult(null); setSlots({}); setChoices(null);
    setAsking(null); setAnswer(''); setOutcome(null); setText('');
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

  async function submit() {
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

  return (
    <div className="kit" style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
    }}>
      {/* the input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 52 }}>
        <Search size={17} style={{ color: understood ? 'var(--accent)' : 'var(--text-subtle)', flexShrink: 0 }} />
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
          placeholder={EXAMPLES[exampleIdx]}
          style={{
            flex: 1, minWidth: 0, height: 40, border: 'none', outline: 'none',
            background: 'transparent', color: 'var(--text)',
            fontFamily: 'var(--inter)', fontSize: 14.5, letterSpacing: '-0.01em',
          }}
        />
        {text && (
          <button onClick={reset} aria-label="Clear"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
            <X size={15} />
          </button>
        )}
        <kbd style={{
          fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          padding: '2px 6px', flexShrink: 0,
        }}>Ctrl K</kbd>
      </div>

      {/* what it thinks you meant, and everything else it could be */}
      {stage === 'idle' && text.trim().length >= 2 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {preview?.intent && (
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
  );
}
