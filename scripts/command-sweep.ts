/* =============================================================
   Forty seven sentences, put through the bar exactly as the bar runs.

   Not a pass or fail list. It prints what each sentence resolves to, in
   the same order the component decides: an instruction beats a question
   the same words could be read as, an action beats a query when the
   verb is unmistakable, and a question falls through to the planner.

   The point is to see the whole surface at once. A sweep that only
   called parseQuery would report "no plan" for "approve all outstanding
   social posts", which is not a failure of the planner: it is an action,
   and the bar reaches it another way.

     npm run check:sweep
   ============================================================= */
import { parseQuery } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { parseSelection } from '../lib/command/select';
import { suggestActions } from '../lib/command/actions';
import { parse } from '../lib/command/intents';
import { readsOnlyText, INSTRUCTION } from '../lib/command/arbitrate';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary, sampleSize } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });
loadSampleVocabulary();

const SENTENCES = [
  'Carrington, how many curtainsiders have we got sat there?',
  'show me the five cheapest available trailers',
  'which stock has been here the longest?',
  "what's the total NBV of everything currently in stock?",
  'average profit on trailers sold this year',
  'how many fridges are on hire by depot?',
  'which trailers in stock have no retail price?',
  'show me trailers with an MOT due in the next 30 days',
  'stock with refurb costs over £2,000',
  'which sold trailers made more than £5,000 profit?',
  "show trailers ordered this month that haven't been dispatched yet",
  'how many new builds are due in this month?',
  'break the current stock down by make',
  'available box trailers under £20k, cheapest first',
  'show me customers with no email address',
  'unassigned customers in Manchester',
  "which customers haven't been contacted in 60 days?",
  'customers with a fleet over 50 and no next action',
  'show existing customers with more than 20 trucks on their fleet',
  'which customers have more than 30 trailers on their fleet?',
  'prospects with turnover above £5 million',
  'give me the top 10 customers by turnover',
  'how many customers does each owner have?',
  'customers added this month with no contact name',
  'show quoted opportunities worth more than £50k',
  'how many quoted proposals are on my tracker?',
  "my leads that I haven't contacted in the last 14 days",
  "what's the total estimated value of my quoted proposals?",
  'show maintenance proposals worth over £10,000',
  'show me the month to date analytics',
  'who has sold the most this quarter?',
  'how much commission has the team earned year to date?',
  "what's our current pipeline value?",
  "what's the conversion rate for the last 90 days?",
  'who are our top customers by revenue year to date?',
  "what's the average deal size this quarter?",
  'show revenue and profit month by month',
  'how many social posts are still awaiting approval?',
  'show scheduled social posts going out this week',
  'break the social posts down by status',
  'show me all social posts that are still drafts',
  'what meetings have I got this week?',
  'show private meetings this month',
  'approve all outstanding social posts',
  'create a new CRM list',
  'what do I need to do today?',
  'what needs chasing?',
];

/** The order the bar itself decides in. */
function resolve(s: string): { kind: string; detail: string; unmet: string[] } {
  const edit = parseEdit(s, caps);
  if (edit && edit.missing.length === 0 && edit.confidence >= 10) {
    return { kind: 'write', detail: edit.summary, unmet: [] };
  }

  const plan = parseQuery(s);
  const actions = suggestActions(s, caps, 3);
  const intent = parse(s);

  /* The same arbitration the component uses, imported rather than
     restated. A sweep that approximated it was testing a bar that does
     not exist, and reported "Add a contact" for questions the real one
     answers correctly. */
  const readsOnly = readsOnlyText(s);
  const told = INSTRUCTION.test(s.trim());
  const usable = readsOnly ? actions.filter((a) => a.action.kind !== 'create') : actions;

  /* An instruction first, then the question its words could also be.
     Otherwise the plan, provided it narrowed something: a plan with a
     filter on it has understood the sentence, and letting a loosely
     scored action outrank it answered "stock with refurb costs over
     £2,000" with Accept an invitation. */
  if (told && usable.length && usable[0].score >= 6) {
    return { kind: 'action', detail: usable[0].action.label, unmet: [] };
  }
  const planUnderstood = !!plan
    && (plan.confidence >= 8 || plan.filters.length > 0 || !!plan.groupBy || !!plan.order);
  if (planUnderstood && (readsOnly || !intent?.intent?.writes)) {
    return { kind: 'question', detail: plan!.summary, unmet: plan!.unmet ?? [] };
  }
  if (usable.length && usable[0].score >= 6) {
    return { kind: 'action', detail: usable[0].action.label, unmet: [] };
  }
  if (intent?.intent && intent.confidence >= 6) {
    return { kind: 'intent', detail: intent.intent.id, unmet: [] };
  }
  if (plan) return { kind: 'question', detail: plan.summary, unmet: plan.unmet ?? [] };

  const sel = parseSelection(s, 'Lucy');
  if (sel) return { kind: 'rows', detail: sel.label, unmet: [] };
  if (usable.length) return { kind: 'action', detail: usable[0].action.label, unmet: [] };
  return { kind: 'NOTHING', detail: 'the bar does not answer this', unmet: [] };
}

console.log(`\n  ${SENTENCES.length} sentences, values read from ${sampleSize()} real stock rows.\n`);

const tally = new Map<string, number>();
SENTENCES.forEach((s, i) => {
  const r = resolve(s);
  tally.set(r.kind, (tally.get(r.kind) ?? 0) + 1);
  console.log(`  ${String(i + 1).padStart(2)}. ${s}`);
  console.log(`      ${r.kind.padEnd(9)} ${r.detail}`);
  for (const u of r.unmet) console.log(`      ${''.padEnd(9)} said: ${u}`);
  console.log();
});

console.log('  ' + [...tally.entries()].map(([k, n]) => `${k} ${n}`).join(', ') + '\n');
