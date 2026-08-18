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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, suggestActions } from '../lib/command/actions';
import { parseEdit } from '../lib/command/mutate';
import { planCommand } from '../lib/command/plan';
import { parseQuery as readQuery } from '../lib/command/query';
import { parse } from '../lib/command/intents';
import { capabilitiesFor, WITHHELD } from '../lib/crm/permissions';
import { FUNCTIONS } from '../lib/command/store/postgrest';
import { capability as capabilityDef } from '../lib/command/ir/registry';
import { loadSampleVocabulary } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });
/* The fixture, as a value. `parseQuery` takes the index it should read
   with, so this binds it once rather than installing it anywhere. */
const VOCABULARY = loadSampleVocabulary();
const parseQuery = (text: string) => readQuery(text, VOCABULARY);

const read = (p: string) => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return ''; }
};

/* THERE IS NO LONGER A SECOND EXECUTOR.

   `app/api/command/execute` performed nine hand written intents on its
   own, and the bar fell through to it whenever the canonical planner
   had not produced a runnable meaning. That made a canonical refusal
   into an invitation for a different parser to decide what the sentence
   meant. It is deleted, and this check now measures the canonical
   runtime only. */
const EXECUTE = '';
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

/**
 * Nothing in production may call the deleted executor again.
 *
 * A static check rather than a comment, because the fallback was easy to
 * write the first time and would be easy to write again. It reads the
 * production tree, not this file's own text.
 */
function noSecondExecutor(): string[] {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const body = readFileSync(full, 'utf8');
      /* The route's own path, and the legacy parser being used to decide
         what happens rather than to suggest words. */
      if (/api\/command\/execute/.test(body)) offenders.push(`${full} calls /api/command/execute`);
      if (/from '@\/lib\/command\/intents'/.test(body) && /\bawait fetch\(/.test(body)) {
        offenders.push(`${full} reads intents.ts and fetches in the same file`);
      }
    }
  };
  for (const dir of ['app', 'components']) walk(join(process.cwd(), dir));
  return offenders;
}

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

const OFFENDERS = noSecondExecutor();
console.log(`\n  ONE RUNTIME`);
console.log(OFFENDERS.length
  ? `  ${OFFENDERS.length} production file(s) can still execute outside the canonical runtime:`
  : '  nothing in app/ or components/ executes outside the canonical runtime.');
for (const o of OFFENDERS) console.log(`    ${o}`);

console.log(`\n  ${ACTIONS.length} actions declared.`);
console.log(`  ${(byWiring.get('handler') ?? []).length} of them do the thing from the bar.`);
console.log(`  ${(byWiring.get('none') ?? []).length} of them are dead entries.\n`);

/* -------------------------------------------------------------
   2. Fifty write commands, parsed only.

   Parsed ONLY. None of these run. A write that parses is a write that
   somebody could reach, and reaching it is a third of the job.
   ------------------------------------------------------------- */
const WRITES: { text: string; on?: Screen }[] = [
  { text: 'move STC143580 to Bredbury', on: { open: 'trailer' } },
  { text: 'set the MOT on STC143580 to 30 September 2026', on: { open: 'trailer' } },
  { text: 'add £1,250 refurb cost to STC143580', on: { open: 'trailer' } },
  { text: 'change the retail price on STC143580 to £24,995', on: { open: 'trailer' } },
  { text: 'mark the deposit as received on STC143580', on: { open: 'trailer' } },
  { text: 'mark STC143580 as paid in full', on: { open: 'trailer' } },
  { text: 'set the expected delivery on STC143580 to 1 October 2026', on: { open: 'trailer' } },
  { text: 'change the supplier on STC143580 to Tiger Trailers', on: { open: 'trailer' } },
  { text: 'add a refurb update to STC143580 saying curtains repaired and floor replaced', on: { open: 'trailer' } },
  { text: 'duplicate STC143580 as another stock unit', on: { open: 'trailer' } },
  { text: 'put this trailer onto my sales tracker', on: { open: 'trailer' } },
  { text: 'move all the selected trailers to Hyde', on: { selected: 'trailer' } },
  { text: 'create a new lead for Smith Logistics' },
  { text: 'pull this customer from the CRM onto my tracker', on: { open: 'customer' } },
  { text: 'link STC143580 to this deal', on: { open: 'deal' } },
  { text: 'duplicate this deal for a second unit', on: { open: 'deal' } },
  { text: 'switch my tracker over to the maintenance side', on: { open: 'deal' } },
  { text: 'link these two customer records as the same account', on: { selected: 'customer' } },
  { text: 'generate a trailer sales proposal for this customer', on: { open: 'customer' } },
  { text: 'send this proposal for signature through DocuSign', on: { open: 'customer' } },
  { text: 'assign this account to Dave', on: { open: 'customer' } },
  { text: 'take this account off me and put it back in the unassigned pool', on: { open: 'customer' } },
  { text: 'set the next action on this customer to call them on Friday', on: { open: 'customer' } },
  { text: "change this customer's phone number to 0161 555 0142", on: { open: 'customer' } },
  { text: 'add a note to this customer saying fleet review completed', on: { open: 'customer' } },
  { text: 'add another site to this customer', on: { open: 'customer' } },
  { text: 'make this address their main address', on: { open: 'customer' } },
  { text: 'add their LinkedIn profile to this account', on: { open: 'customer' } },
  { text: 'share this CRM list with Dave', on: { list: true } },
  { text: 'book a site visit with this customer next Tuesday at 10am', on: { open: 'customer' } },
  { text: 'schedule a callback with this customer for tomorrow afternoon', on: { open: 'customer' } },
  { text: 'move my 3pm meeting tomorrow to 4:30' },
  { text: "cancel Friday's site visit" },
  { text: 'make this meeting private', on: { open: 'meeting' } },
  { text: 'invite Dave to this meeting', on: { open: 'meeting' } },
  { text: 'suggest Friday at 2pm instead for this invitation', on: { open: 'meeting' } },
  { text: 'create a new LinkedIn post' },
  { text: 'add an image to this social post', on: { open: 'post', file: 'picture' } },
  { text: 'put this post on LinkedIn and Instagram', on: { open: 'post' } },
  { text: 'send this social post for approval', on: { open: 'post' } },
  { text: 'reject this post and send it back to draft', on: { open: 'post' } },
  { text: 'mark this social post as published', on: { open: 'post' } },
  { text: 'upload this logo to the brand kit', on: { file: 'picture' } },
  { text: 'copy the navy brand colour hex' },
  { text: 'refresh the industry news feeds' },
  { text: 'find waste companies within 20 miles of Hyde' },
  { text: 'import this spreadsheet into the CRM', on: { file: 'sheet' } },
  { text: 'download this CRM list as a CSV', on: { list: true } },
  { text: 'make Dave a read-only user' },
  { text: 'add Jane as a new user' },
];

/**
 * What the CANONICAL runtime makes of a sentence.
 *
 * Four separate answers, because they fail separately and a single
 * number hides which. A sentence can be understood and not permitted, or
 * permitted and performed by nothing, and both of those are different
 * from not being understood at all.
 */
type Canonical =
  | 'executable'    // planned, permitted, and something performs it
  | 'asks'          // planned and permitted, short of a value it asks for
  | 'locked'        // planned and performed, switched off for everybody
  | 'permitted'     // planned and permitted, nothing performs it yet
  | 'understood'    // planned, and this actor may not run it
  | 'navigation'    // no plan; the action registry opens the screen
  | 'none';

type Outcome = {
  parse: string;
  parseOk: boolean;
  wiring: Wiring;
  detail: string;
  canonical: Canonical;
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
/**
 * WHICH SCREEN, PER SENTENCE.
 *
 * One fixed context measured the fixture rather than the runtime.
 * "Make this meeting private" typed against a CRM record points at
 * nothing, and came back not understood for a reason that has nothing
 * to do with meetings. Every sentence below declares the screen
 * somebody would actually be looking at when they typed it, and the
 * screens are exactly what those screens publish: an open record, a
 * selection, an open list, an attached file.
 */
const OPEN: Record<string, { entity: string; id: string }> = {
  customer: { entity: 'contacts', id: '11111111-1111-1111-1111-111111111111' },
  trailer: { entity: 'trailers', id: '22222222-2222-2222-2222-222222222222' },
  /* A tracker row is a `crm_contacts` row, and the tracker screen deep
     links to it with ?contact=, which is what the bar publishes. There
     is no "proposals" entity: `deals` and `contacts` are two readings
     of one table, and this said the label rather than the id. */
  deal: { entity: 'contacts', id: '33333333-3333-3333-3333-333333333333' },
  meeting: { entity: 'meetings', id: '44444444-4444-4444-4444-444444444444' },
  post: { entity: 'posts', id: '55555555-5555-5555-5555-555555555555' },
};

const SHEET = {
  name: 'leads.csv', mime: 'text/csv', size: 64,
  text: 'Company,Email\nDawson Group,sam@dawson.co.uk',
};

const PICTURE = {
  name: 'yard.png', mime: 'image/png', size: 4, text: 'data:image/png;base64,AAAA',
};

function screenFor(on?: Screen) {
  const context: Record<string, unknown> = {};
  if (on?.open) context.record = OPEN[on.open];
  if (on?.selected) {
    context.selection = {
      entity: OPEN[on.selected].entity,
      ids: [OPEN[on.selected].id, '66666666-6666-6666-6666-666666666666'],
    };
  }
  if (on?.list) context.list = { id: '77777777-7777-7777-7777-777777777777', name: 'Fleet Prospects' };
  if (on?.file === 'sheet') context.file = SHEET;
  if (on?.file === 'picture') context.file = PICTURE;
  return context;
}

type Screen = {
  /** A record the screen has open, by its URL. */
  open?: keyof typeof OPEN;
  /** Rows somebody has ticked. */
  selected?: keyof typeof OPEN;
  /** A working list the screen is showing. */
  list?: boolean;
  /** Something attached to the bar. */
  file?: 'sheet' | 'picture';
};

function audit(s: string, on?: Screen): Outcome {
  /* THE PRODUCTION ENTRY POINT, FIRST.

     This used to ask `parseEdit` and then the action registry, which
     between them know about field writes and screens and nothing else.
     Everything the runtime has grown since then, creating, deleting,
     business operations, role changes, meetings, posts and imports,
     came back DEAD from a check that had never been told to ask. The
     planner is what the bar calls, so it is what this asks. */
  const planned = planCommand(s, {
    actorCapabilities: caps, vocabulary: VOCABULARY, context: screenFor(on),
  });

  /* UNDERSTOOD AND SHORT OF A VALUE IS ITS OWN ANSWER.

     "Create a LinkedIn post" plans `post.create`, is permitted, and has
     nothing to say. Counting it executable would claim a sentence runs
     when what it does is ask a question, and counting it not understood
     would claim the opposite of what happened. It is neither: the
     runtime read it, and it is waiting on one value. Nothing is
     written until that value arrives, and then it is this same
     sentence, longer. */
  if (planned && planned.completion.kind === 'incomplete'
    && planned.availability.representable
    && planned.availability.permitted !== false
    && planned.availability.executable) {
    return {
      parse: `asks: ${planned.presentation.summary}`,
      parseOk: true,
      wiring: MUTATION ? 'handler' : 'none',
      detail: planned.completion.missing.map((m) => m.ask).join(' '),
      canonical: 'asks',
    };
  }

  if (planned && planned.kind === 'mutate'
    && planned.availability.representable
    && planned.presentation.confidence >= 10) {
    const permitted = planned.availability.permitted !== false;
    const performs = planned.availability.executable;
    return {
      parse: `runs: ${planned.presentation.summary}`,
      parseOk: true,
      wiring: permitted && performs && MUTATION ? 'handler' : 'none',
      detail: !permitted
        ? `not permitted: ${planned.availability.missingPermissions.join(', ')}`
        : !performs
          ? `nothing performs ${planned.availability.unavailable.map((u) => u.need).join(', ')}`
          : '/api/command/plan then /api/command/apply, previewed then confirmed',
      canonical: !permitted ? 'understood' : performs ? 'executable' : 'permitted',
    };
  }

  /* AN EFFECT IS NOT ALWAYS A WRITE.

     "Download this list as a CSV" and "copy the navy hex" change no
     record and are still carried out by the canonical runtime: one goes
     through /api/command/emit and produces a file, the other declares
     the clipboard and the browser does it. Counting them as navigation
     because they are not mutations measured the word rather than the
     effect. Display is excluded: an answer on screen is a question. */
  if (planned && planned.availability.representable
    && planned.availability.permitted !== false
    && planned.availability.executable) {
    const emit = planned.plan.steps.find((x) => x.op === 'emit');
    if (emit && emit.op === 'emit' && emit.to.kind !== 'display') {
      return {
        parse: `runs: ${planned.presentation.summary}`,
        parseOk: true,
        wiring: 'handler',
        detail: emit.to.kind === 'clipboard'
          ? '/api/command/query, then the browser puts it on the clipboard'
          : '/api/command/emit, which returns the file itself',
        canonical: 'executable',
      };
    }
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
      canonical: 'executable',
    };
  }
  if (edit) {
    return {
      parse: `write, incomplete: ${edit.summary}`,
      parseOk: false,
      wiring: 'none',
      detail: `still needs ${edit.missing.join(', ') || 'a record'}`,
      canonical: 'none',
    };
  }

  /* SWITCHED OFF IS NOT THE SAME AS MISSING.

     "Find waste companies within 20 miles of Hyde" is planned,
     performed and tested; no actor can run it because the rollout lock
     withholds `crm.enrich` from every role until somebody decides a
     usage policy. Reporting that as navigation, with no reason, reads
     as a hole in the runtime. It is a switch. */
  if (WITHHELD.length) {
    const unlocked = planCommand(s, {
      actorCapabilities: new Set([...caps, ...WITHHELD]) as never,
      vocabulary: VOCABULARY,
      context: screenFor(on),
    });
    if (unlocked && unlocked.availability.representable
      && unlocked.availability.permitted === true
      && unlocked.availability.executable
      && unlocked.completion.kind !== 'refused'
      /* And it is the LOCK that made the difference. Without this, any
         sentence that plans as an ordinary question comes back "locked"
         because lifting the lock did not stop it planning. */
      && unlocked.permissions.some((need) => (WITHHELD as string[]).includes(need))) {
      return {
        parse: `locked: ${unlocked.presentation.summary}`,
        parseOk: true,
        wiring: 'handler',
        detail: `carried out by the canonical runtime, and ${WITHHELD.join(', ')} `
          + 'is withheld from every role by the rollout lock',
        canonical: 'locked',
      };
    }
  }

  const hits = suggestActions(s, caps, 3);
  if (hits.length && hits[0].score >= 6) {
    const a = hits[0].action;
    const w = wiringFor(a);
    return {
      parse: `action: ${a.label}`, parseOk: true, wiring: w.how, detail: w.detail,
      canonical: w.how === 'screen' ? 'navigation' : 'none',
    };
  }

  const intent = parse(s);
  if (intent?.intent && intent.confidence >= 6) {
    const handled = HANDLED.has(intent.intent.id);
    return {
      parse: `intent: ${intent.intent.id}`,
      parseOk: intent.missing.length === 0,
      wiring: 'none',
      detail: 'the legacy parser reads it and nothing executes it',
      canonical: 'none',
    };
  }

  const plan = parseQuery(s);
  if (plan) {
    return {
      parse: `read as a question: ${plan.summary}`,
      parseOk: false,
      wiring: 'none',
      detail: 'an instruction answered with a list is not the instruction',
      canonical: 'none',
    };
  }
  return {
    parse: 'nothing', parseOk: false, wiring: 'none',
    detail: 'the bar does not reach this', canonical: 'none',
  };
}

console.log('  FIFTY WRITE COMMANDS, PARSED ONLY. NOTHING HERE RUNS.\n');

const tally: Record<Canonical, number> = {
  executable: 0, asks: 0, locked: 0, permitted: 0, understood: 0, navigation: 0, none: 0,
};
WRITES.forEach(({ text: s, on }, i) => {
  const o = audit(s, on);
  tally[o.canonical] += 1;
  const flag = o.canonical === 'executable' ? '  ok '
    : o.canonical === 'asks' ? ' ask '
      : o.canonical === 'locked' ? 'lock '
      : o.canonical === 'navigation' ? ' nav '
        : o.canonical === 'none' ? 'DEAD ' : 'PART ';
  console.log(`  ${flag} ${String(i + 1).padStart(2)}. ${s}`);
  console.log(`          ${o.parse}`);
  console.log(`          ${o.detail}`);
});

/* Four numbers rather than one, because they fail separately. Nothing
   here counts an action registry entry as coverage: an entry that opens
   a screen is navigation, and navigation is not execution. */
console.log(`\n  CANONICAL RUNTIME, ${WRITES.length} write sentences`);
console.log(`    executable       ${String(tally.executable).padStart(3)}  planned, permitted, and something performs it`);
console.log(`    asks             ${String(tally.asks).padStart(3)}  planned and permitted, waiting on one value it asks for`);
console.log(`    locked           ${String(tally.locked).padStart(3)}  planned and performed, switched off for every role`);
console.log(`    permitted        ${String(tally.permitted).padStart(3)}  planned and permitted, nothing performs it yet`);
console.log(`    understood       ${String(tally.understood).padStart(3)}  planned, and this actor may not run it`);
console.log(`    navigation only  ${String(tally.navigation).padStart(3)}  opens the screen where a person does it by hand`);
console.log(`    not understood   ${String(tally.none).padStart(3)}`);
console.log(`\n  ${tally.executable}/${WRITES.length} carried out by the canonical runtime.`);
/* SAID SEPARATELY, ON PURPOSE.

   A sentence that asks a question is not a sentence that ran, and
   adding the two into one figure is how "executable" started meaning
   more than it does. `executable` here means: a canonical plan exists,
   this actor is permitted, and a handler is declared. It does not mean
   the sentence has been run end to end against a database. What has is
   in `check:acceptance` and `check:postgres`, with their own
   denominators. */
console.log(`  ${tally.executable + tally.asks}/${WRITES.length} read by it, counting the ${tally.asks} it answers with a question.\n`);

/* =============================================================
   What "executable" means, and what it does not

   `executable` above is three facts: a canonical plan exists, this
   actor is permitted, and a handler is declared. It is NOT a claim that
   the sentence has been run end to end, and reporting one number
   invites it to be read as one.

   So the same fifty sentences are reported again against the checks
   that actually run them. The evidence is mechanical: a check covers a
   sentence when the sentence itself, the capability it plans, or the
   database function that performs it, appears in that check's own
   source. That is weaker than "this sentence was asserted" and it is
   stated rather than implied, because the alternative is a column
   nobody can verify.
   ============================================================= */
const EVIDENCE = [
  { key: 'fake', title: 'production runtime, fake store', file: 'scripts/command-acceptance-check.ts' },
  { key: 'http', title: 'HTTP routes, as the bar calls them', file: 'scripts/command-route-check.ts' },
  { key: 'pg', title: 'real PostgreSQL', file: 'scripts/sql/validate-007.sql' },
  { key: 'ext', title: 'the provider seam', file: 'scripts/command-acceptance-check.ts' },
] as const;

const SOURCES = new Map(EVIDENCE.map((e) => [e.file, read(e.file)]));

/** Every name a sentence could be recognised by in a check's source. */
function namesFor(text: string, on?: Screen): string[] {
  const planned = planCommand(text, {
    actorCapabilities: new Set([...caps, ...WITHHELD]) as never,
    vocabulary: VOCABULARY,
    context: screenFor(on),
  });
  const caught: string[] = [text];
  for (const step of planned?.plan.steps ?? []) {
    if (step.op === 'invoke') {
      caught.push(step.capability);
      const fn = FUNCTIONS[step.capability]?.name;
      if (fn) caught.push(fn);
      const prepares = ACTION_CAP(step.capability)?.prepares;
      if (prepares) caught.push(prepares);
      continue;
    }
    /* A FIELD WRITE HAS NOTHING CAPABILITY SHAPED TO NAME.

       Every one of them goes through one function, and that function is
       exercised by name. So a write is credited to the path it takes
       rather than to itself, which is a weaker claim and is the one
       that can be checked. */
    if (step.op === 'update' || step.op === 'create' || step.op === 'delete') {
      caught.push('command_apply', 'applyMutation');
    }
  }
  return caught;
}

const ACTION_CAP = (id: string) => capabilityDef(id);

console.log('  THE SAME FIFTY, AGAINST THE CHECKS THAT RUN THEM\n');
const covered: Record<string, number> = { fake: 0, http: 0, pg: 0, ext: 0 };
let external = 0;

for (const { text: s, on } of WRITES) {
  const names = namesFor(s, on);
  const marks: string[] = [];
  for (const e of EVIDENCE) {
    const source = SOURCES.get(e.file) ?? '';
    /* The provider seam only counts for a sentence that reaches one. */
    if (e.key === 'ext') {
      const touches = names.some((n) => /enrich|findCompanies|setImage|brand\.upload|import/.test(n));
      if (!touches) { marks.push('  .'); continue; }
      external += 1;
    }
    const hit = names.some((n) => source.includes(n));
    if (hit) covered[e.key] += 1;
    marks.push(hit ? ' ok' : '  -');
  }
  console.log(`   ${marks.join(' ')}  ${s}`);
}

console.log(`\n  CANONICAL RUNTIME, ${WRITES.length} write sentences`);
console.log(`    canonical plan exists      ${String(tally.executable + tally.asks + tally.locked + tally.permitted + tally.understood).padStart(3)}/${WRITES.length}`);
console.log(`    this actor permitted       ${String(tally.executable + tally.asks + tally.locked + tally.permitted).padStart(3)}/${WRITES.length}`);
console.log(`    a handler is declared      ${String(tally.executable + tally.asks + tally.locked).padStart(3)}/${WRITES.length}`);
for (const e of EVIDENCE) {
  const of = e.key === 'ext' ? external : WRITES.length;
  console.log(`    ${e.title.padEnd(26)} ${String(covered[e.key]).padStart(3)}/${of}`);
}
console.log('\n  Evidence is the sentence, its capability, its database function or');
console.log('  the one function every field write goes through, appearing in that');
console.log('  check. It is not a claim that this exact sentence was asserted there.\n');
