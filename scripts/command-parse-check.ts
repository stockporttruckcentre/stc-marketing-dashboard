/**
 * Parser check for the command bar.
 *
 * Run: npm run check:command
 *
 * There is no test runner in this project, so this is a script that
 * prints what the parser understood and exits non-zero if any case does
 * not land on its expected intent. Add a line whenever somebody finds a
 * phrasing it gets wrong.
 */
import { parse } from '../lib/command/intents';

const CASES: { input: string; intent: string; slots?: Record<string, string> }[] = [
  { input: 'generate a FleetSmart+ gold contract for Dawson for 3 6x2 vehicles with an added £500 wear and tear each unit',
    intent: 'create_contract', slots: { contact: 'Dawson', count: '3', axle: '6x2' } },
  { input: 'how many trailers have we sold to TIP Trailers in the past 8 weeks',
    intent: 'query_sold', slots: { contact: 'TIP Trailers' } },
  { input: 'how much do Birkenhead need to invoice until they hit their target',
    intent: 'query_target_gap', slots: { contact: 'Birkenhead' } },
  { input: 'schedule a call for dave this Thursday', intent: 'schedule_call', slots: { contact: 'dave' } },
  { input: 'create trailer STC142345 in the stocklist', intent: 'create_stock_trailer', slots: { stockNo: 'STC142345' } },
  { input: 'add prospect Dawson Group', intent: 'create_prospect' },
  { input: 'book a meeting with Culina Logistics next Tuesday', intent: 'schedule_call', slots: { contact: 'Culina Logistics' } },
  { input: 'show me Wincanton', intent: 'find_record', slots: { contact: 'Wincanton' } },
  { input: 'new lead Gregory Distribution', intent: 'create_prospect' },
  { input: 'genrate a quote for TIP Trailers', intent: 'create_proposal' },
  { input: 'scedule a cal for Dawson tomorow', intent: 'schedule_call' },
  { input: 'how many units did we sel to Wincanton last month', intent: 'query_sold' },
];

let failed = 0;
for (const c of CASES) {
  const r = parse(c.input);
  const got = r.intent?.id ?? 'NONE';
  const slots = Object.fromEntries(r.filled.map((f) => [f.key, f.display]));
  const problems: string[] = [];
  if (got !== c.intent) problems.push(`intent ${got}, wanted ${c.intent}`);
  for (const [k, v] of Object.entries(c.slots ?? {})) {
    if (slots[k] !== v) problems.push(`${k}="${slots[k] ?? ''}", wanted "${v}"`);
  }
  if (problems.length) { failed++; console.log(`FAIL  "${c.input}"\n      ${problems.join('; ')}`); }
  else console.log(`ok    ${got.padEnd(22)} ${c.input.slice(0, 62)}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passing`);
process.exit(failed ? 1 : 0);
