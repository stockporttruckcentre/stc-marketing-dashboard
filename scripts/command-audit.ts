/* =============================================================
   Parse is not execute.

   Every check in this repo until now has called a parser in memory and
   asserted what came back. That proves the bar UNDERSTOOD a sentence.
   It proves nothing whatsoever about whether pressing Enter does
   anything, and the two have been reported as if they were the same
   thing.

   The question that exposed it: "cancel Friday's site visit" can score
   a perfect parse against a diary that contains no site visit, and
   nobody would know the difference from any output this repo produces.

   So this audits three separate states, and never conflates them:

     PARSE      the sentence resolved to the right action or plan
     PATH       there is somewhere for it to go: a screen, a seeded
                phrase, a query, a field write, or a handler in
                /api/command/execute
     EXECUTE    that path actually carries out the operation, rather
                than opening the screen where a person does it by hand

   An action in the registry is not a capability. An action with no
   path is a dead entry that appears in the bar, gets picked, and does
   nothing, which is worse than not being offered.

   Nothing here writes to a database. It reads the registry, the execute
   route and the component, and reports what is wired to what.

     npm run check:audit
   ============================================================= */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, suggestActions } from '../lib/command/actions';
import { parseEdit } from '../lib/command/mutate';
import { planCommand } from '../lib/command/plan';
import { parseQuery as readQuery } from '../lib/command/query';
import { parse } from '../lib/command/intents';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });
/* The fixture, as a value. `parseQuery` takes the index it should read
   with, so this binds it once rather than installing it anywhere. */
const VOCABULARY = loadSampleVocabulary();
const parseQuery = (text: string) => readQuery(text, VOCABULARY);

const read = (p: string) => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return ''; }
};

const EXECUTE = read('app/api/command/execute/route.ts');
/* The canonical mutation runtime: what plans and previews a change, and
   what writes it. Both, because a preview with nothing behind it is not
   a wired path. */
const MUTATION = !!read('app/api/command/plan/route.ts')
  && !!read('app/api/command/apply/route.ts')
  && !!read('lib/command/server/mutation.ts');
const BAR = read('components/dashboard/CommandBar.tsx');

/* -------------------------------------------------------------
   1. Which actions can actually go somewhere.
   ------------------------------------------------------------- */
type Wiring = 'screen' | 'seed' | 'handler' | 'none';

/** Intent ids the execute route has a branch for. */
function handledIntents(): Set<string> {
  const ids = new Set<string>();
  /* Every string compared against the intent id, however the route
     spells the comparison. Deliberately generous: a false positive here
     understates the problem, and understating it is the safer error
     when the output is a list of things to go and wire up. */
  for (const m of EXECUTE.matchAll(/intent(?:Id)?\s*===\s*['"]([a-z0-9_.]+)['"]/gi)) ids.add(m[1]);
  for (const m of EXECUTE.matchAll(/case\s+['"]([a-z0-9_.]+)['"]/gi)) ids.add(m[1]);
  return ids;
}

const HANDLED = handledIntents();

function wiringFor(a: typeof ACTIONS[number]): { how: Wiring; detail: string } {
  if (a.path) return { how: 'screen', detail: `opens ${a.path}` };
  if (a.seed) {
    /* A seed puts a phrase back in the bar, so it only leads anywhere
       if some OTHER path understands that phrase. A seed pointing at a
       sentence nothing handles is a loop. */
    const s = a.seed;
    const asEdit = parseEdit(s, caps);
    const asIntent = parse(s);
    const reaches = (asEdit && asEdit.confidence >= 6)
      || (asIntent?.intent && HANDLED.has(asIntent.intent.id));
    return reaches
      ? { how: 'seed', detail: `seeds "${s}", which is handled` }
      : { how: 'none', detail: `seeds "${s}", which nothing handles` };
  }
  /* There is no third option. CommandActionSpec has `path` and `seed`
     and nothing else: no field naming an execution handler, so no
     action in this registry can carry out an operation on its own.
     That is the finding, not a gap in this check. */
  return { how: 'none', detail: 'no path and no seed, so picking it does nothing' };
}

console.log('\n  ACTION REGISTRY AGAINST WHAT ACTUALLY RUNS\n');

const byWiring = new Map<Wiring, { id: string; label: string; detail: string }[]>();
for (const a of ACTIONS) {
  const w = wiringFor(a);
  byWiring.set(w.how, [...(byWiring.get(w.how) ?? []),
    { id: a.id, label: a.label, detail: w.detail }]);
}

for (const how of ['handler', 'seed', 'screen', 'none'] as Wiring[]) {
  const list = byWiring.get(how) ?? [];
  const what = how === 'handler' ? 'carry out the operation from the bar'
    : how === 'seed' ? 'put a phrase back in the bar for the user to finish'
    : how === 'screen' ? 'open the screen where a person does it by hand'
    : 'GO NOWHERE';
  console.log(`  ${String(list.length).padStart(3)}  ${what}`);
  if (how === 'none') for (const x of list) console.log(`         ${x.id.padEnd(26)} ${x.detail}`);
}

console.log(`\n  ${ACTIONS.length} actions declared.`);
console.log(`  ${(byWiring.get('handler') ?? []).length} of them do the thing from the bar.`);
console.log(`  ${(byWiring.get('none') ?? []).length} of them are dead entries.\n`);

/* -------------------------------------------------------------
   2. Fifty write commands, parsed only.

   Parsed ONLY. None of these run. A write that parses is a write that
   somebody could reach, and reaching it is a third of the job.
   ------------------------------------------------------------- */
const WRITES = [
  'move STC143580 to Bredbury',
  'set the MOT on STC143580 to 30 September 2026',
  'add £1,250 refurb cost to STC143580',
  'change the retail price on STC143580 to £24,995',
  'mark the deposit as received on STC143580',
  'mark STC143580 as paid in full',
  'set the expected delivery on STC143580 to 1 October 2026',
  'change the supplier on STC143580 to Tiger Trailers',
  'add a refurb update to STC143580 saying curtains repaired and floor replaced',
  'duplicate STC143580 as another stock unit',
  'put this trailer onto my sales tracker',
  'move all the selected trailers to Hyde',
  'create a new lead for Smith Logistics',
  'pull this customer from the CRM onto my tracker',
  'link STC143580 to this deal',
  'duplicate this deal for a second unit',
  'switch my tracker over to the maintenance side',
  'link these two customer records as the same account',
  'generate a trailer sales proposal for this customer',
  'send this proposal for signature through DocuSign',
  'assign this account to Dave',
  'take this account off me and put it back in the unassigned pool',
  'set the next action on this customer to call them on Friday',
  "change this customer's phone number to 0161 555 0142",
  'add a note to this customer saying fleet review completed',
  'add another site to this customer',
  'make this address their main address',
  'add their LinkedIn profile to this account',
  'share this CRM list with Dave',
  'book a site visit with this customer next Tuesday at 10am',
  'schedule a callback with this customer for tomorrow afternoon',
  'move my 3pm meeting tomorrow to 4:30',
  "cancel Friday's site visit",
  'make this meeting private',
  'invite Dave to this meeting',
  'suggest Friday at 2pm instead for this invitation',
  'create a new LinkedIn post',
  'add an image to this social post',
  'put this post on LinkedIn and Instagram',
  'send this social post for approval',
  'reject this post and send it back to draft',
  'mark this social post as published',
  'upload this logo to the brand kit',
  'copy the navy brand colour hex',
  'refresh the industry news feeds',
  'find waste companies within 20 miles of Hyde',
  'import this spreadsheet into the CRM',
  'download this CRM list as a CSV',
  'make Dave a read-only user',
  'add Jane as a new user',
];

type Outcome = {
  parse: string;
  parseOk: boolean;
  wiring: Wiring;
  detail: string;
};

/**
 * The screen the sentences are typed on.
 *
 * Half of them say "this customer" or "this meeting", which is a word
 * about what somebody is looking at rather than a gap in the sentence.
 * The bar always has this and the audit has to, or it measures a person
 * typing at a screen with nothing on it. The file is here for the same
 * reason: "import this spreadsheet" is only ever typed with one
 * attached.
 */
const SCREEN = {
  record: { entity: 'contacts', id: '11111111-1111-1111-1111-111111111111' },
  selection: { entity: 'trailers', ids: ['22222222-2222-2222-2222-222222222222'] },
  file: {
    name: 'leads.csv', mime: 'text/csv', size: 64,
    text: 'Company,Email\nDawson Group,sam@dawson.co.uk',
  },
};

function audit(s: string): Outcome {
  /* THE PRODUCTION ENTRY POINT, FIRST.

     This used to ask `parseEdit` and then the action registry, which
     between them know about field writes and screens and nothing else.
     Everything the runtime has grown since then, creating, deleting,
     business operations, role changes, meetings, posts and imports,
     came back DEAD from a check that had never been told to ask. The
     planner is what the bar calls, so it is what this asks. */
  const planned = planCommand(s, {
    actorCapabilities: caps, vocabulary: VOCABULARY, context: SCREEN,
  });
  if (planned
    && planned.kind === 'mutate'
    && planned.availability.representable
    && planned.availability.executable
    && planned.availability.permitted !== false
    && planned.presentation.confidence >= 10) {
    return {
      parse: `runs: ${planned.presentation.summary}`,
      parseOk: true,
      wiring: MUTATION ? 'handler' : 'none',
      detail: MUTATION
        ? '/api/command/plan then /api/command/apply, previewed then confirmed'
        : 'no mutation runtime',
    };
  }

  /* A field write. This is the one path that previews before it writes,
     and it now reaches a record somebody named or a set they described,
     through the canonical planner. */
  const edit = parseEdit(s, caps);
  if (edit && edit.missing.length === 0 && edit.confidence >= 10) {
    return {
      parse: `write: ${edit.summary}`,
      parseOk: true,
      wiring: MUTATION ? 'handler' : 'none',
      detail: MUTATION
        ? '/api/command/plan then /api/command/apply, previewed then confirmed'
        : 'no mutation runtime',
    };
  }
  if (edit) {
    return {
      parse: `write, incomplete: ${edit.summary}`,
      parseOk: false,
      wiring: 'none',
      detail: `still needs ${edit.missing.join(', ') || 'a record'}`,
    };
  }

  const hits = suggestActions(s, caps, 3);
  if (hits.length && hits[0].score >= 6) {
    const a = hits[0].action;
    const w = wiringFor(a);
    return { parse: `action: ${a.label}`, parseOk: true, wiring: w.how, detail: w.detail };
  }

  const intent = parse(s);
  if (intent?.intent && intent.confidence >= 6) {
    const handled = HANDLED.has(intent.intent.id);
    return {
      parse: `intent: ${intent.intent.id}`,
      parseOk: intent.missing.length === 0,
      wiring: handled ? 'handler' : 'none',
      detail: handled ? 'execute route handles it' : 'no handler in the execute route',
    };
  }

  const plan = parseQuery(s);
  if (plan) {
    return {
      parse: `read as a question: ${plan.summary}`,
      parseOk: false,
      wiring: 'none',
      detail: 'an instruction answered with a list is not the instruction',
    };
  }
  return { parse: 'nothing', parseOk: false, wiring: 'none', detail: 'the bar does not reach this' };
}

console.log('  FIFTY WRITE COMMANDS, PARSED ONLY. NOTHING HERE RUNS.\n');

let parsed = 0, runnable = 0;
WRITES.forEach((s, i) => {
  const o = audit(s);
  if (o.parseOk) parsed++;
  if (o.parseOk && o.wiring === 'handler') runnable++;
  const flag = !o.parseOk ? 'PARSE' : o.wiring === 'handler' ? '  ok ' : 'DEAD ';
  console.log(`  ${flag} ${String(i + 1).padStart(2)}. ${s}`);
  console.log(`          ${o.parse}`);
  console.log(`          ${o.detail}`);
});

console.log(`\n  ${parsed}/${WRITES.length} understood.`);
console.log(`  ${runnable}/${WRITES.length} both understood AND wired to something that carries it out.`);
console.log(`  The gap between those two numbers is the honest state of the bar.\n`);
