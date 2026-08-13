/* =============================================================
   Intent catalogue and the matcher.

   Each intent declares the canonical tokens that suggest it, the slots
   it needs, and how to phrase what it is about to do. The parser scores
   every intent, fills what it can from the extracted entities, and
   reports what is still missing so the UI can ask.
   ============================================================= */
import { tokenise, hasWord, type Token } from './normalise';
import { extract, type Extracted } from './entities';

export type SlotType =
  | 'contact'      // resolved against crm_contacts, may need disambiguation
  | 'person'       // a teammate, resolved against profiles
  | 'stockNo'
  | 'count'
  | 'axle'
  | 'money'
  | 'date'
  | 'range'
  | 'product'
  | 'text';

export type SlotSpec = {
  key: string;
  type: SlotType;
  label: string;
  required: boolean;
  /** Shown when the slot is missing and we have to ask. */
  ask: string;
};

export type IntentSpec = {
  id: string;
  title: string;
  /** Canonical tokens that pull towards this intent. */
  verbs: string[];
  nouns: string[];
  /** Raw phrases that are a strong signal on their own. */
  phrases?: RegExp[];
  slots: SlotSpec[];
  /** What the bar offers as an example. */
  example: string;
  /** Does running this change data? Destructive-ish actions confirm first. */
  writes: boolean;
};

export const INTENTS: IntentSpec[] = [
  {
    id: 'create_contract',
    title: 'Generate a contract',
    verbs: ['create'], nouns: ['contract'],
    slots: [
      { key: 'contact', type: 'contact', label: 'Customer', required: true, ask: 'Which customer is this contract for?' },
      { key: 'product', type: 'product', label: 'Product', required: false, ask: 'Which product or tier?' },
      { key: 'count', type: 'count', label: 'Vehicles', required: false, ask: 'How many vehicles?' },
      { key: 'axle', type: 'axle', label: 'Configuration', required: false, ask: 'What axle configuration?' },
      { key: 'money', type: 'money', label: 'Additional charge', required: false, ask: 'Any additional charge per unit?' },
    ],
    example: 'generate a FleetSmart+ gold contract for Dawson for 3 6x2 vehicles with £500 wear and tear each',
    writes: true,
  },
  {
    id: 'create_stock_trailer',
    title: 'Add a trailer to stock',
    verbs: ['create'], nouns: ['trailer', 'stock'],
    slots: [
      { key: 'stockNo', type: 'stockNo', label: 'STC number', required: true, ask: 'What is the STC number?' },
      { key: 'make', type: 'text', label: 'Make', required: true, ask: 'Which make?' },
      { key: 'model', type: 'text', label: 'Model', required: false, ask: 'Which model?' },
      { key: 'category', type: 'text', label: 'Category', required: false, ask: 'Which category?' },
    ],
    example: 'create trailer STC142345 in the stocklist',
    writes: true,
  },
  {
    id: 'schedule_call',
    title: 'Schedule a call',
    verbs: ['schedule'], nouns: ['call', 'meeting'],
    slots: [
      { key: 'contact', type: 'contact', label: 'Who with', required: true, ask: 'Who is the call with?' },
      { key: 'date', type: 'date', label: 'When', required: true, ask: 'When should it be?' },
    ],
    example: 'schedule a call for Dave this Thursday',
    writes: true,
  },
  {
    id: 'create_prospect',
    title: 'Add a prospect',
    verbs: ['create'], nouns: ['contact'],
    slots: [
      { key: 'contact', type: 'text', label: 'Company', required: true, ask: 'What is the company called?' },
    ],
    example: 'add prospect Dawson Group',
    writes: true,
  },
  {
    id: 'create_proposal',
    title: 'Generate a proposal',
    verbs: ['create'], nouns: ['proposal'],
    slots: [
      { key: 'contact', type: 'contact', label: 'Customer', required: true, ask: 'Who is the proposal for?' },
      { key: 'product', type: 'product', label: 'Type', required: false, ask: 'Trailer sales, maintenance, rental or refurb?' },
    ],
    example: 'generate a proposal for TIP Trailers',
    writes: true,
  },
  {
    id: 'query_sold',
    title: 'Count what was sold',
    verbs: ['count', 'find'], nouns: ['sold', 'trailer'],
    phrases: [/how many .*(sold|sell)/i],
    slots: [
      { key: 'contact', type: 'contact', label: 'Customer', required: false, ask: 'Which customer?' },
      { key: 'range', type: 'range', label: 'Period', required: false, ask: 'Over what period?' },
    ],
    example: 'how many trailers have we sold to TIP Trailers in the past 8 weeks',
    writes: false,
  },
  {
    id: 'query_target_gap',
    title: 'Distance to target',
    verbs: ['count'], nouns: ['target', 'invoice'],
    phrases: [/how much .*(target|invoice)/i, /(until|til|till).*(target|goal)/i],
    slots: [
      { key: 'contact', type: 'text', label: 'Depot or rep', required: false, ask: 'Whose target?' },
    ],
    example: 'how much do Birkenhead need to invoice to hit their target',
    writes: false,
  },
  {
    id: 'list_meetings',
    title: 'Show your meetings',
    verbs: ['find'], nouns: ['meeting'],
    phrases: [/\b(my|our)\s+(meetings|diary|calendar|schedule)\b/i, /\bwhat('s| is)\s+(on|in my diary)\b/i],
    slots: [
      { key: 'range', type: 'range', label: 'Period', required: false, ask: 'Over what period?' },
    ],
    example: 'show my meetings this week',
    writes: false,
  },
  {
    id: 'find_record',
    title: 'Open a record',
    verbs: ['find'], nouns: ['contact', 'trailer', 'stock'],
    phrases: [/^\s*(show|find|open|pull up|get)\s+(me\s+)?[A-Z]/],
    slots: [
      { key: 'contact', type: 'text', label: 'What to find', required: true, ask: 'What should I look for?' },
    ],
    example: 'show me TIP Trailers',
    writes: false,
  },
];

export type FilledSlot = {
  key: string; type: SlotType; label: string;
  value: any; display: string;
  /** Needs a server lookup before it can be used. */
  needsResolve?: boolean;
};

export type ParseResult = {
  input: string;
  intent: IntentSpec | null;
  confidence: number;
  filled: FilledSlot[];
  missing: SlotSpec[];
  entities: Extracted;
  alternatives: { intent: IntentSpec; confidence: number }[];
};

function scoreIntent(spec: IntentSpec, tokens: Token[], input: string): number {
  let verbHit = 0, nounHit = 0, phraseHit = 0;
  for (const v of spec.verbs) if (hasWord(tokens, v)) verbHit++;
  for (const n of spec.nouns) if (hasWord(tokens, n)) nounHit++;
  for (const p of spec.phrases ?? []) if (p.test(input)) phraseHit++;

  let score = verbHit * 3 + nounHit * 3 + phraseHit * 6;
  // A verb and a noun from the same intent together is a much stronger
  // signal than either alone, and is what separates "generate a contract"
  // from a sentence that merely mentions trailers.
  if (verbHit && nounHit) score += 4;
  return score;
}

/**
 * Words sitting inside a company or person name must not vote on intent.
 * Without this, "TIP Trailers" pulls every sentence towards the stock list
 * and "Dawson Group" towards anything mentioning groups.
 */
function maskProperNouns(tokens: Token[], properNouns: string[]): Token[] {
  const masked = new Set<string>();
  for (const p of properNouns) {
    for (const w of p.toLowerCase().split(/\s+/)) if (w.length > 2) masked.add(w);
  }
  if (!masked.size) return tokens;
  return tokens.filter((t) => !masked.has(t.norm));
}

export function parse(input: string): ParseResult {
  const tokens = tokenise(input);
  const entities = extract(input, tokens);

  const scoringTokens = maskProperNouns(tokens, entities.properNouns);
  const scored = INTENTS
    .map((spec) => ({ intent: spec, confidence: scoreIntent(spec, scoringTokens, input) }))
    .filter((s) => s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best) {
    return { input, intent: null, confidence: 0, filled: [], missing: [], entities, alternatives: [] };
  }

  const filled: FilledSlot[] = [];
  const missing: SlotSpec[] = [];
  // Each extracted value is used once. Three free-text slots should not
  // all silently fill with the same company name.
  const usedNouns = new Set<string>();

  for (const slot of best.intent.slots) {
    let value: any = null;
    let display = '';
    let needsResolve = false;

    switch (slot.type) {
      case 'contact': {
        const preferred = entities.contactHint && !usedNouns.has(entities.contactHint)
          ? entities.contactHint
          : entities.properNouns.find((n) => !usedNouns.has(n));
        if (preferred) { value = preferred; display = preferred; needsResolve = true; usedNouns.add(preferred); }
        break;
      }
      case 'text': {
        const free = entities.properNouns.find((n) => !usedNouns.has(n));
        // Only the first free-text slot is worth guessing at. Filling
        // "model" and "category" from a company name is worse than asking.
        if (free && usedNouns.size === 0) { value = free; display = free; usedNouns.add(free); }
        break;
      }
      case 'stockNo':
        if (entities.stockNos.length) { value = entities.stockNos[0]; display = value; }
        break;
      case 'count':
        if (entities.counts.length) { value = entities.counts[0]; display = String(value); }
        break;
      case 'axle':
        if (entities.axles.length) { value = entities.axles[0]; display = value; }
        break;
      case 'money':
        if (entities.money.length) {
          const m = entities.money[0];
          value = m;
          display = `£${m.amount.toLocaleString()}${m.per === 'unit' ? ' per unit' : ''}${m.label ? ` (${m.label})` : ''}`;
        }
        break;
      case 'date':
        if (entities.date) { value = entities.date.at.toISOString(); display = entities.date.label; }
        break;
      case 'range':
        if (entities.range) {
          value = { from: entities.range.from.toISOString(), to: entities.range.to.toISOString() };
          display = entities.range.label;
        }
        break;
      case 'product':
        if (entities.productHints.length) {
          value = entities.productHints.join(' ');
          display = value;
        }
        break;
      case 'person':
        if (entities.properNouns.length) { value = entities.properNouns[0]; display = value; needsResolve = true; }
        break;
    }

    if (value == null || value === '') {
      if (slot.required) missing.push(slot);
    } else {
      filled.push({ key: slot.key, type: slot.type, label: slot.label, value, display, needsResolve });
    }
  }

  return {
    input,
    intent: best.intent,
    confidence: best.confidence,
    filled,
    missing,
    entities,
    alternatives: scored.slice(1, 3),
  };
}
