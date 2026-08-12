/**
 * Coverage check for the composed query engine.
 *
 * Run: npm run check:query
 *
 * The point of the dictionary is that combinations produce the coverage,
 * so this is a breadth check rather than a correctness proof: every line
 * must compose into a plan, and the printed summary is what the user
 * would see before it runs. Add any phrasing somebody finds that misses.
 */
import { parseQuery } from '../lib/command/query';

const CASES = [
  'how many trailers in stock', 'how many trailers are in stock', 'how much stock do we have',
  'how many sold trailers', 'total value of sold trailers', 'average profit on sold trailers',
  'how many trailers by make', 'trailers by category', 'how many trailers in Hyde',
  'how many Schmitz trailers', 'how many new builds', 'how many quoted proposals',
  'what is my pipeline worth', 'my quoted deals by customer', 'how many leads',
  'total commission this year', 'how many customers in Manchester', 'how many meetings this week',
  'how many trailers sold to TIP Trailers in the past 8 weeks', 'list rental trailers',
  'how many scrapped units', 'average sale price by make', 'how many trailers on sales order',
  'value of my open pipeline', 'how many used trailers', 'trailers by depot',
  'how many deals by status', 'total revenue last month', 'how many fridges in stock',
];

let missed = 0;
for (const c of CASES) {
  const p = parseQuery(c);
  if (!p) { missed++; console.log(`MISS  "${c}"`); }
  else console.log(`ok    ${p.summary}`);
}
console.log(`\n${CASES.length - missed}/${CASES.length} composed`);
process.exit(missed ? 1 : 0);
