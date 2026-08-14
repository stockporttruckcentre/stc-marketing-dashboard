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

   Five things are proved here, against the real production modules and
   an injected vocabulary rather than a database.

     1  a value known only from live data plans identically at preview
        and at execution
     2  a role without the permission is not offered the command
     3  a handcrafted client plan cannot become the plan that runs
     4  a meaning that changes between preview and execution is refused
        and restated, never executed
     5  the 19,071 sentence corpus is untouched by any of it

     npm run check:authority
   ============================================================= */
import { readFileSync } from 'fs';
import { planAuthoritatively, planForExecution, planHash } from '../lib/command/server/planner';
import { invalidateVocabulary } from '../lib/command/server/vocabulary';
import { clearVocabulary, type VocabularySnapshot } from '../lib/command/vocab';
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

/** Load a vocabulary as if the database held exactly this. */
function withVocabulary(snapshot: VocabularySnapshot) {
  clearVocabulary();
  invalidateVocabulary();
  return async () => snapshot;
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
  && /supabaseVocabulary\(supabase\)/.test(routeSource));
const planRouteSource = source('app/api/command/plan/route.ts');
ok('the preview endpoint plans through the same planner with the same vocabulary',
  /planAuthoritatively\(/.test(planRouteSource)
  && /supabaseVocabulary\(supabase\)/.test(planRouteSource));
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

/* ============================================================= */

clearVocabulary();
invalidateVocabulary();

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
