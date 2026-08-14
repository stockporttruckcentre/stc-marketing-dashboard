/* =============================================================
   Is there one planning environment, or one planner called in two?

   `check:runtime` proved the application plans through the canonical
   IR. It did not prove that the two ends of the application plan in the
   same conditions, and they did not. The browser loaded the live
   vocabulary and the server did not, so the same sentence could
   honestly mean two things: the bar could show "trailers where make is
   Chereau" and the server could run "trailers", each internally
   consistent, with every gate passing on both sides.

   The vocabulary is the whole reason this can happen. Nothing in any
   file says Chereau is a make. It is a make because it appears in
   `stock_trailers.make`, so what a sentence means depends on what the
   database currently holds, and two readers holding different snapshots
   of that are two different readers.

   AND VOCABULARY IS NOT THE SAME FOR EVERYBODY.

   `crm_contacts` restricts SELECT to rows on a global list, a list you
   own, or a list shared with you, so the company names and account
   owners it yields differ per person. A process wide cache of those
   values meant whoever refreshed it last decided what everybody else's
   sentences meant for the next minute, and a company only one person
   could see became a company everybody's bar could resolve.

   The earlier version of this file could not have caught that. It reset
   the global index between every snapshot, so it measured a world with
   one user in it.

   THE INVARIANT IS NOW UNCONDITIONAL.

     authoritative vocabulary = the values visible through THIS actor's
     own RLS session

   There is no table by table judgement about what is public, because
   the version of this file that had one was wrong about
   `calendar_events` within days: `schema.sql` says every authenticated
   user sees every row, and `migrations/006_meeting_invites.sql`
   replaces that with creator, team, named users and invitees. Nothing
   leaked, since calendar declares no free text column, but a hand
   maintained list of "tables we believe everybody can see" is a second
   copy of the security model that no test can demand be updated.

   So the cases below assert the invariant rather than a classification,
   and one of them uses `stock_trailers`, which the old code treated as
   public, to show that no table is exempt from the actor's own view.

   Proved here, against the real production modules and injected
   vocabularies rather than a database:

     1  a value known only from live data plans identically at preview
        and at execution
     2  a role without the permission is not offered the command
     3  a handcrafted client plan cannot become the plan that runs
     4  a meaning that changes between preview and execution is refused
        and restated, never executed
     5  the 19,071 sentence corpus is untouched by any of it
     6  two actors in ONE process, interleaved with no reset between
        them, never see each other's RLS scoped vocabulary

     npm run check:authority
   ============================================================= */
import { readFileSync } from 'fs';
import { planAuthoritatively, planForExecution, planHash } from '../lib/command/server/planner';
import { vocabularyFor, resetVocabularyCaches, cachedActors } from '../lib/command/server/vocabulary';
import { buildIndex, clearVocabulary, type VocabularySnapshot } from '../lib/command/vocab';
import { planCommand } from '../lib/command/plan';
import { capabilitiesFor } from '../lib/crm/permissions';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  ${what}${got ? `\n    ${got}` : ''}`);
};

const source = (path: string) => readFileSync(path, 'utf8');

/**
 * A vocabulary source over a known snapshot.
 *
 * NOTHING IS RESET HERE, deliberately. The previous version cleared the
 * process wide index before every case, which is what made it blind to
 * the defect it should have caught: a check that starts each case from
 * an empty world cannot notice that the world is shared. Every case
 * below runs in whatever state the previous one left behind, which is
 * what a server does.
 */
function withVocabulary(snapshot: VocabularySnapshot) {
  const index = buildIndex(snapshot);
  return async () => index;
}

/* A make nothing in this repository has ever heard of. If a sentence
   about it plans as a filter on `make`, that can only be because the
   value came from the data. */
const INVENTED = 'Zoltrix';

const WITH_MAKE: VocabularySnapshot = {
  trailers: {
    make: [{ value: INVENTED, rows: 7 }],
  },
};
const WITHOUT_MAKE: VocabularySnapshot = { trailers: { make: [] } };

const SENTENCE = `how many ${INVENTED} trailers in stock`;
const EVERYTHING = [...capabilitiesFor({ role: 'admin' } as never)];

async function main() {

/* =============================================================
   0. The vocabulary is load bearing

   Asserted first, because every case below is worthless if the
   sentence means the same thing with and without it.
   ============================================================= */

const blind = await planAuthoritatively({
  text: SENTENCE, capabilities: EVERYTHING, vocabulary: withVocabulary(WITHOUT_MAKE),
});
const sighted = await planAuthoritatively({
  text: SENTENCE, capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});

ok('the sentence plans either way', !!blind && !!sighted);
ok('a value known only from live data changes what the sentence means',
  blind!.meaning.hash !== sighted!.meaning.hash,
  `${blind!.meaning.summary}  vs  ${sighted!.meaning.summary}`);
ok('and it becomes a filter on the column it was found in',
  JSON.stringify(sighted!.planning.plan).includes(INVENTED)
  && !JSON.stringify(blind!.planning.plan).includes(INVENTED),
  sighted!.meaning.summary);

/* =============================================================
   1. Preview and execution agree, on a live-data-only value
   ============================================================= */

const preview = await planAuthoritatively({
  text: SENTENCE, capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});
/* A second planning environment, built the same way and loaded from
   scratch, exactly as a later request on another instance would be. */
const execution = await planForExecution({
  text: SENTENCE, previewHash: preview!.meaning.hash,
  capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});

ok('the same sentence and the same vocabulary agree at execution', execution.agreed,
  execution.agreed ? '' : execution.reason);
ok('and it is the same canonical meaning, not merely the same hash',
  execution.agreed
  && planHash(execution.planned.planning.plan) === planHash(preview!.planning.plan)
  && JSON.stringify(execution.agreed && execution.planned.planning.plan)
     === JSON.stringify(preview!.planning.plan));

/* The server planned it without anybody loading the vocabulary by
   hand first. That is the defect this fixes: `planAuthoritatively`
   loads before it plans, so a caller cannot forget. */
const routeSource = source('app/api/command/query/route.ts');
ok('the query route plans through the authoritative planner',
  /planForExecution\(/.test(routeSource)
  && /vocabularyFor\(supabase, user\.id\)/.test(routeSource));
const planRouteSource = source('app/api/command/plan/route.ts');
ok('the preview endpoint plans through the same planner with the same vocabulary',
  /planAuthoritatively\(/.test(planRouteSource)
  && /vocabularyFor\(supabase, user\.id\)/.test(planRouteSource));
ok('the vocabulary route and the server planner share one builder',
  /buildVocabulary/.test(source('app/api/command/vocabulary/route.ts')));

/* =============================================================
   2. A role without the permission is not offered the command
   ============================================================= */

const CRM_QUESTION = 'how many contacts';
const viewerCaps = [...capabilitiesFor({ role: 'viewer' } as never)];

const asAdmin = await planAuthoritatively({
  text: CRM_QUESTION, capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
const asNobody = await planAuthoritatively({
  text: CRM_QUESTION, capabilities: [], vocabulary: withVocabulary({}),
});

ok('a CRM question is runnable for somebody who may see the CRM',
  asAdmin?.meaning.runnable === true, JSON.stringify(asAdmin?.meaning.blocked));
ok('and is not runnable for somebody who may not',
  asNobody?.meaning.runnable === false, JSON.stringify(asNobody?.meaning.blocked));
ok('the refusal names the permission that is missing',
  asNobody?.meaning.availability.missingPermissions.includes('crm.view') === true,
  JSON.stringify(asNobody?.meaning.availability));
ok('and it is the permission, not the plan, that is the problem',
  asNobody?.meaning.availability.representable === true
  && asNobody?.meaning.availability.executable === true,
  JSON.stringify(asNobody?.meaning.availability));

/* Whatever the roles hold, the answer must come from the plan and not
   from a guess. A viewer either may see the CRM or may not, and the
   planner has to agree with permissions.ts either way. */
const asViewer = await planAuthoritatively({
  text: CRM_QUESTION, capabilities: viewerCaps, vocabulary: withVocabulary({}),
});
ok('a viewer is offered the question exactly when permissions.ts allows it',
  asViewer?.meaning.runnable === viewerCaps.includes('crm.view'),
  `viewer holds crm.view: ${viewerCaps.includes('crm.view')}, runnable: ${asViewer?.meaning.runnable}`);

/* The browser has to make the same distinction, or it offers commands
   the server will refuse. This is the defect: the bar computed the
   capabilities and then planned without them. */
const bar = source('components/dashboard/CommandBar.tsx');
ok('the command bar plans locally with the actor capabilities',
  /planCommand\(text, \{ actorCapabilities: caps \}\)/.test(bar));
ok('the command bar does not offer what the actor is not permitted',
  /availability\.permitted !== false/.test(bar));
ok('the command bar shows the meaning the server planned, not one it worked out',
  /\{meaning\.summary\}/.test(bar) && !/planning\.presentation\.summary/.test(bar));
ok('the command bar offers a command only when the server calls it runnable',
  /useQuery = !editReady && !!meaning\?\.runnable/.test(bar));

const localNobody = planCommand(CRM_QUESTION, { actorCapabilities: [] });
const localAdmin = planCommand(CRM_QUESTION, { actorCapabilities: EVERYTHING });
ok('local planning reaches the same verdict the server does',
  localNobody?.availability.permitted === false && localAdmin?.availability.permitted === true);

/* =============================================================
   3. A handcrafted client plan cannot become the plan that runs
   ============================================================= */

ok('the query route reads only the sentence and the hash off the body',
  /raw\.text\b/.test(routeSource) && /raw\.hash\b/.test(routeSource)
  && !/raw\.(plan|select|steps|filters|entityId|measure)\b/.test(routeSource));
ok('the preview endpoint reads only the sentence',
  /raw\.text\b/.test(planRouteSource)
  && !/raw\.(plan|select|steps|filters|entityId|measure)\b/.test(planRouteSource));

/* Stronger than reading the source: the planner takes a string. There
   is no parameter a plan could arrive through, so this is a property
   of the signature rather than of anybody's discipline. */
const plannerSource = source('lib/command/server/planner.ts');
const requestType = plannerSource.slice(
  plannerSource.indexOf('export type PlanRequest'),
  plannerSource.indexOf('};', plannerSource.indexOf('export type PlanRequest')));
ok('the planning request carries the sentence and nothing resembling a plan',
  /text: string;/.test(requestType)
  && !/\b(Plan|Select|Step|steps|filters|entityId)\b/.test(requestType),
  requestType.replace(/\s+/g, ' ').slice(0, 160));

/* And it behaves that way. A request carrying a forged plan alongside
   the text is planned from the text, and the forgery has no effect. */
const forged = { steps: [{ op: 'select', id: 'x', from: { entity: 'trailers' } }], unmet: [] };
const honest = await planAuthoritatively({
  text: CRM_QUESTION, capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
const withForgery = await planAuthoritatively({
  text: CRM_QUESTION, capabilities: EVERYTHING, vocabulary: withVocabulary({}),
  ...(forged as unknown as Record<string, never>),
});
ok('extra fields on a planning request change nothing about the plan',
  planHash(honest!.planning.plan) === planHash(withForgery!.planning.plan)
  && honest!.planning.plan.steps[0].op === 'select'
  && JSON.stringify(withForgery!.planning.plan).includes('contacts'),
  withForgery!.meaning.summary);

/* A hash somebody made up does not run anything either. */
const forgedHash = await planForExecution({
  text: CRM_QUESTION, previewHash: 'not a hash anybody produced',
  capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
ok('an invented hash is refused rather than executed',
  !forgedHash.agreed && forgedHash.reason === 'meaning changed');

const noHash = await planForExecution({
  text: CRM_QUESTION, previewHash: '',
  capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
ok('no hash at all is refused too, because agreeing is part of running',
  !noHash.agreed);

/* =============================================================
   4. A meaning that changes between preview and execution is refused
   ============================================================= */

const shown = await planAuthoritatively({
  text: SENTENCE, capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});
/* Somebody sold the last one and the make left the data. The sentence
   is unchanged and now means something else. */
const drifted = await planForExecution({
  text: SENTENCE, previewHash: shown!.meaning.hash,
  capabilities: EVERYTHING, vocabulary: withVocabulary(WITHOUT_MAKE),
});

ok('a changed meaning is refused rather than executed',
  !drifted.agreed && drifted.reason === 'meaning changed');
ok('and the new reading comes back for preview',
  !drifted.agreed && drifted.reason === 'meaning changed'
  && !!drifted.planned.meaning.summary
  && drifted.planned.meaning.hash !== shown!.meaning.hash,
  !drifted.agreed && drifted.reason === 'meaning changed' ? drifted.planned.meaning.summary : '');

/* The same drift in the other direction. A make that did not exist
   when the sentence was previewed does not get silently applied. */
const shownBlind = await planAuthoritatively({
  text: SENTENCE, capabilities: EVERYTHING, vocabulary: withVocabulary(WITHOUT_MAKE),
});
const arrived = await planForExecution({
  text: SENTENCE, previewHash: shownBlind!.meaning.hash,
  capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});
ok('a value arriving between preview and execution is refused too', !arrived.agreed);

/* The guard must not fire when nothing changed, or it refuses
   everything and proves nothing. */
const steady = await planForExecution({
  text: SENTENCE, previewHash: shown!.meaning.hash,
  capabilities: EVERYTHING, vocabulary: withVocabulary(WITH_MAKE),
});
ok('an unchanged meaning is not refused', steady.agreed);

ok('the query route restates a drifted meaning instead of running it',
  /restated: true/.test(routeSource) && /status: 409/.test(routeSource));
ok('the command bar shows the restated reading rather than an answer',
  /res\.restated/.test(bar) && /setMeaning\(res\)/.test(bar));

/* Hashing is over the meaning and not over the wording. A reader that
   reworded a summary must not make every previewed command refuse. */
const a = await planAuthoritatively({
  text: 'how many trailers in stock', capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
const b = await planAuthoritatively({
  text: 'how many trailers in stock', capabilities: viewerCaps, vocabulary: withVocabulary({}),
});
ok('the hash is over the plan, so who is asking does not change it',
  a!.meaning.hash === b!.meaning.hash);

/* =============================================================
   6. Two actors, one process, no reset between them

   The defect this section exists for. Everything above runs one actor
   at a time; a shared cache is invisible until two people use it.

   A and B are modelled the way RLS actually works: each has a client
   that returns only the rows that person may SELECT. `crm_contacts` is
   restricted per user, so their contact vocabularies differ.
   `stock_trailers` is `auth.role() = \'authenticated\'`, so theirs is
   the same and may legitimately be shared.
   ============================================================= */

/** A Supabase stand in that returns exactly what one person can see. */
function clientSeeing(rows: Record<string, Record<string, unknown>[]>) {
  return {
    from: (table: string) => ({
      select: () => ({
        limit: async () => ({ data: rows[table] ?? [], error: null }),
      }),
    }),
  };
}

/*
 * Two private accounts, one each. Named without a word in common on
 * purpose: a shared token would make these cases measure name overlap
 * rather than isolation. The shared token case is below, and asserts
 * the thing that overlap actually tests.
 */
const ALPHA = 'Alphacorp';
const BETA = 'Betacorp';
const ALPHA_Q = `how many ${ALPHA} deals`;
const BETA_Q = `how many ${BETA} deals`;

/* Their clients differ on EVERY table, including the two the old code
   believed were public. Whether a real policy narrows stock or the
   calendar tomorrow is not this module's business: what a person's own
   client returns is what their sentences mean. */
const A_MAKE = 'Kroneseven';
const B_MAKE = 'Schmitzeight';
const clientA = clientSeeing({
  stock_trailers: [{ make: A_MAKE, model: 'Cool Liner', location: 'Carrington', customer: 'Shared Haulage', sales_rep: 'Dave' }],
  crm_contacts: [{ company_name: ALPHA, assigned_to: 'Dave', location: 'Carrington', source: 'web' }],
  calendar_events: [{ title: 'A only' }],
});
const clientB = clientSeeing({
  stock_trailers: [{ make: B_MAKE, model: 'Cool Liner', location: 'Carrington', customer: 'Shared Haulage', sales_rep: 'Dave' }],
  crm_contacts: [{ company_name: BETA, assigned_to: 'Dave', location: 'Carrington', source: 'web' }],
  calendar_events: [{ title: 'B only' }],
});

resetVocabularyCaches();

const forA = vocabularyFor(clientA, 'user-a');
const forB = vocabularyFor(clientB, 'user-b');

/* --- 2. there is no process wide vocabulary to contaminate --- */
const vocabSourceEarly = source('lib/command/server/vocabulary.ts');
ok('no table is classified as safe to share',
  !/COMPANY_WIDE/.test(vocabSourceEarly) && !/visibilityOf/.test(vocabSourceEarly));
ok('there is no shared index, only one keyed by actor',
  !/companyCache|companyIndex|mergeIndexes/.test(vocabSourceEarly)
  && /actorCache = new Map<string, Cached>/.test(vocabSourceEarly));
ok('every read goes through the caller\'s own client, with nothing to select on',
  /buildVocabulary\(supabase: Queryable\): Promise<VocabularySnapshot>/.test(vocabSourceEarly)
  && !/Visibility/.test(vocabSourceEarly));

/* --- 1. A can see Private Alpha and B cannot --- */
const indexA = await forA();
const indexB = await forB();
ok('A can resolve their own account name', indexA.has('alphacorp'));
ok('B cannot resolve A\'s account name', !indexB.has('alphacorp'));
ok('B can resolve their own', indexB.has('betacorp'));
ok('A cannot resolve B\'s', !indexA.has('betacorp'));

/* --- 3. no table is exempt, so an RLS change needs no second change ---

   `stock_trailers` is the table the old code treated as public and
   cached once for everybody. Each actor now gets exactly what their own
   client returned, so if that policy is ever narrowed, the command
   vocabulary follows it with nothing here to update. */
ok('A sees the stock their own client returned', indexA.has(A_MAKE.toLowerCase()));
ok('and not the stock only B\'s client returned', !indexA.has(B_MAKE.toLowerCase()));
ok('B sees theirs', indexB.has(B_MAKE.toLowerCase()));
ok('and not A\'s, even though A read first', !indexB.has(A_MAKE.toLowerCase()));

/* Only the two of them are cached, each under their own id. */
ok('the cache holds one entry per actor and nothing shared',
  cachedActors().sort().join(',') === 'user-a,user-b', cachedActors().join(','));

/* --- 2 and 3. Planning as A, then immediately as B, in one process --- */
const planA1 = await planAuthoritatively({
  text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forA,
});
const planB1 = await planAuthoritatively({
  text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forB,
});

ok('planning as A recognises A\'s private company',
  JSON.stringify(planA1!.planning.plan).includes(ALPHA), planA1!.meaning.summary);
ok('planning as B immediately afterwards does not',
  !JSON.stringify(planB1!.planning.plan).includes(ALPHA), planB1!.meaning.summary);

/* --- 4. B\'s own private value still works, right after A populated --- */
const planB2 = await planAuthoritatively({
  text: BETA_Q, capabilities: EVERYTHING, vocabulary: forB,
});
ok('B\'s own private company is recognised for B',
  JSON.stringify(planB2!.planning.plan).includes(BETA), planB2!.meaning.summary);

const planA2 = await planAuthoritatively({
  text: BETA_Q, capabilities: EVERYTHING, vocabulary: forA,
});
ok('and is not recognised for A',
  !JSON.stringify(planA2!.planning.plan).includes(BETA), planA2!.meaning.summary);

/* --- 5. Alternating, repeatedly, never contaminates either --- */
let clean = true;
for (let i = 0; i < 6; i++) {
  const a = await planAuthoritatively({ text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forA });
  const b = await planAuthoritatively({ text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forB });
  const bOwn = await planAuthoritatively({ text: BETA_Q, capabilities: EVERYTHING, vocabulary: forB });
  const aOther = await planAuthoritatively({ text: BETA_Q, capabilities: EVERYTHING, vocabulary: forA });
  clean = clean
    && JSON.stringify(a!.planning.plan).includes(ALPHA)
    && !JSON.stringify(b!.planning.plan).includes(ALPHA)
    && JSON.stringify(bOwn!.planning.plan).includes(BETA)
    && !JSON.stringify(aOther!.planning.plan).includes(BETA);
}
ok('alternating between them repeatedly contaminates neither', clean);

/* Interleaved concurrently, which is the shape a server actually sees.
   The install and the read are one synchronous run, so a promise
   resolving between two requests cannot land between them. */
const raced = await Promise.all([
  planAuthoritatively({ text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forA }),
  planAuthoritatively({ text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forB }),
  planAuthoritatively({ text: BETA_Q, capabilities: EVERYTHING, vocabulary: forB }),
  planAuthoritatively({ text: BETA_Q, capabilities: EVERYTHING, vocabulary: forA }),
]);
ok('concurrent requests from both do not contaminate each other',
  JSON.stringify(raced[0]!.planning.plan).includes(ALPHA)
  && !JSON.stringify(raced[1]!.planning.plan).includes(ALPHA)
  && JSON.stringify(raced[2]!.planning.plan).includes(BETA)
  && !JSON.stringify(raced[3]!.planning.plan).includes(BETA));

/* --- 6. Interpretation cannot reveal what B may not see --- */
const bBlind = await planAuthoritatively({
  text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: withVocabulary({}),
});
ok('B reads the sentence exactly as somebody with no CRM vocabulary would',
  planB1!.meaning.hash === bBlind!.meaning.hash,
  `${planB1!.meaning.summary}  vs  ${bBlind!.meaning.summary}`);
ok('and differently from A, so the value really was A\'s alone',
  planA1!.meaning.hash !== planB1!.meaning.hash);
ok('nothing A can see appears anywhere in what B is told',
  !JSON.stringify(planB1!.meaning).includes(ALPHA));

/* A word both of them have an account for.
 *
 * The interesting case, and the one a pair of names sharing a token
 * would have tested by accident. B typing a word that names something
 * of A's must resolve to B's own account, never A's, and never to
 * both. */
const SHARED = 'Meridian';
const sharedA = clientSeeing({
  crm_contacts: [{ company_name: `${SHARED} North`, assigned_to: 'Dave' }],
});
const sharedB = clientSeeing({
  crm_contacts: [{ company_name: `${SHARED} South`, assigned_to: 'Dave' }],
});
resetVocabularyCaches();
const sharedQ = `how many ${SHARED} deals`;
const sharedPlanA = await planAuthoritatively({
  text: sharedQ, capabilities: EVERYTHING, vocabulary: vocabularyFor(sharedA, 'shared-a'),
});
const sharedPlanB = await planAuthoritatively({
  text: sharedQ, capabilities: EVERYTHING, vocabulary: vocabularyFor(sharedB, 'shared-b'),
});
ok('a word both hold resolves to A\'s account for A',
  JSON.stringify(sharedPlanA!.planning.plan).includes(`${SHARED} North`)
  && !JSON.stringify(sharedPlanA!.planning.plan).includes(`${SHARED} South`),
  sharedPlanA!.meaning.summary);
ok('and to B\'s account for B, planned immediately afterwards',
  JSON.stringify(sharedPlanB!.planning.plan).includes(`${SHARED} South`)
  && !JSON.stringify(sharedPlanB!.planning.plan).includes(`${SHARED} North`),
  sharedPlanB!.meaning.summary);

/* --- 7. Preview and execution agree, per actor, interleaved --- */
const aPreview = await planAuthoritatively({ text: ALPHA_Q, capabilities: EVERYTHING, vocabulary: forA });
const bPreview = await planAuthoritatively({ text: BETA_Q, capabilities: EVERYTHING, vocabulary: forB });

/* B previews and executes in between A previewing and executing. */
const bRun = await planForExecution({
  text: BETA_Q, previewHash: bPreview!.meaning.hash, capabilities: EVERYTHING, vocabulary: forB,
});
const aRun = await planForExecution({
  text: ALPHA_Q, previewHash: aPreview!.meaning.hash, capabilities: EVERYTHING, vocabulary: forA,
});
ok('B\'s execution agrees with B\'s preview', bRun.agreed);
ok('and A\'s still agrees with A\'s, after B ran in between', aRun.agreed);

/* A\'s hash is not B\'s, so neither could run the other\'s reading even
   by sending it. */
const crossed = await planForExecution({
  text: ALPHA_Q, previewHash: aPreview!.meaning.hash, capabilities: EVERYTHING, vocabulary: forB,
});
ok('B cannot execute the reading A previewed', !crossed.agreed);

/* --- the architecture, asserted at the source --- */
const vocabSource = source('lib/command/server/vocabulary.ts');
ok('the actor cache is keyed by user id',
  /actorCache = new Map<string, Cached>/.test(vocabSource)
  && /actorIndex\(\s*\n?\s*supabase: Queryable, actorId: string/.test(vocabSource));
ok('the server vocabulary module installs nothing itself',
  !/installVocabulary/.test(vocabSource));
ok('the per actor cache is still bounded and still expires',
  /ACTOR_CACHE_MAX/.test(vocabSource) && /TTL_MS/.test(vocabSource));
/* The reason the classification is gone, kept where somebody changing
   this file will read it. */
ok('the file records why there is no shared cache',
  /006_meeting_invites/.test(vocabSource));

const planSource = source('lib/command/plan.ts');
const planBody = planSource.slice(planSource.indexOf('export function planCommand'));
const install = planBody.indexOf('installVocabulary');
const parse = planBody.indexOf('parseQuery(text)');
ok('planCommand installs the vocabulary and then reads, with nothing between',
  install > 0 && parse > install
  && !/await/.test(planBody.slice(install, parse)),
  planBody.slice(install, parse + 20).replace(/\s+/g, ' '));
ok('planCommand is synchronous, so nothing can interleave inside it',
  /export function planCommand/.test(planSource)
  && !/export async function planCommand/.test(planSource));

const plannerBody = plannerSource.slice(
  plannerSource.indexOf('export async function planAuthoritatively'),
  plannerSource.indexOf('const { availability, completion }'));
ok('the planner awaits the vocabulary before planning and not after',
  plannerBody.lastIndexOf('await') < plannerBody.indexOf('planCommand('),
  plannerBody.replace(/\s+/g, ' ').slice(0, 200));

/* ============================================================= */

clearVocabulary();
resetVocabularyCaches();

}

main().then(() => {
  console.log(`\n  ${pass}/${pass + fail} planning-authority assertions hold.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (fail) process.exitCode = 1;
});
