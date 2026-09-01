/* =============================================================
   What can somebody actually type, and what happens when they do.

   Not another check. Every existing check calls one function and
   asserts about its return value, which is why they can all be green
   while the bar feels useless in the hand: they test the pieces, and
   the bar is the assembly.

   So this walks the assembly. It builds the same candidate list
   `CommandBar` builds, in the same order, with the same caps and the
   same cap of seven, applies the same incomplete-plan filter, and then
   reports what a person would see.

   Two outputs:

     --list    every action with a phrasing that reaches it, per role,
               as the reference the business asked for
     --audit   the same sweep, reporting only what does NOT come out
               where it should, which is the answer to "why does it
               feel useless"

   npx tsx scripts/command-what-works.ts --list
   npx tsx scripts/command-what-works.ts --audit
   ============================================================= */
import { ACTIONS, suggestActions, type Action } from '../lib/command/actions';
import { composeSuggestions } from '../lib/command/compose';
import { suggestFeatures } from '../lib/command/features';
import { planCommand } from '../lib/command/plan';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary } from './sample-vocabulary';
import type { UserRole } from '../lib/types';

const VOCABULARY = loadSampleVocabulary();
const ROLES: UserRole[] = ['admin', 'sales', 'marketer', 'viewer'];
const CAPS = Object.fromEntries(
  ROLES.map((r) => [r, capabilitiesFor({ role: r })]),
) as Record<UserRole, ReturnType<typeof capabilitiesFor>>;

/** The same shape the bar puts in its list. */
type Shown = { kind: string; label: string; path?: string; phrase?: string; id?: string };

/**
 * What the bar would put on screen for this text, for this person.
 *
 * Mirrors `CommandBar`: actions, then screens, then composed questions,
 * deduped on where they lead, capped at seven. The record lookups are
 * left out because they need a live database, and the edit hints are
 * left out because they need a row on screen. Everything else is the
 * same call in the same order.
 */
function whatTheBarShows(text: string, role: UserRole): Shown[] {
  const caps = CAPS[role];
  const out: Shown[] = [];
  const seen = new Set<string>();

  const push = (s: Shown) => {
    const key = s.path ?? s.phrase ?? s.label;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const c of composeSuggestions(text, caps, 6)) {
    push({ kind: 'question', label: c.label, phrase: c.phrase });
  }
  for (const h of suggestActions(text, caps, 8).slice(0, 5)) {
    push({ kind: h.action.kind, label: h.action.label, path: h.action.path, id: h.action.id });
  }
  for (const f of suggestFeatures(text, 4)) {
    push({ kind: 'screen', label: f.title, path: f.path });
  }

  return out.slice(0, 7);
}

/**
 * The phrasings a person would plausibly type for one action.
 *
 * Generated from the action's own words rather than written out, so
 * this cannot claim coverage the registry does not have. Three shapes,
 * because those are the three ways people type into a bar: the bare
 * object, the verb and the object, and whatever full sentences the
 * action declares.
 */
function phrasingsFor(a: Action): string[] {
  const said: string[] = [];
  const objects = a.objects ?? [];
  const verbs = a.verbs ?? [];

  if (objects[0]) said.push(objects[0]);
  if (verbs[0] && objects[0]) said.push(`${verbs[0]} ${objects[0]}`);
  for (const p of a.phrases ?? []) said.push(p);
  return said;
}

function reaches(text: string, role: UserRole, id: string): boolean {
  return whatTheBarShows(text, role).some((s) => s.id === id);
}

/* -------------------------------------------------------------
   The audit: what does not come out where it should.
   ------------------------------------------------------------- */
function audit() {
  let checked = 0;
  const dead: { id: string; label: string; said: string; instead: string }[] = [];
  const unreachable: Action[] = [];

  for (const a of ACTIONS) {
    const allowed = ROLES.filter((r) => !a.capability || CAPS[r].has(a.capability));
    if (allowed.length === 0) { unreachable.push(a); continue; }
    const role = allowed[0]!;

    let anyWorked = false;
    for (const said of phrasingsFor(a)) {
      checked += 1;
      if (reaches(said, role, a.id)) { anyWorked = true; continue; }
      const shown = whatTheBarShows(said, role);
      dead.push({
        id: a.id,
        label: a.label,
        said,
        instead: shown.length ? shown.slice(0, 3).map((s) => s.label).join(' / ') : 'nothing at all',
      });
    }
    if (!anyWorked) unreachable.push(a);
  }

  console.log(`\n  ${ACTIONS.length} actions, ${checked} phrasings run through the bar's own assembly\n`);

  console.log(`  ACTIONS NOTHING REACHES: ${unreachable.length}`);
  for (const a of unreachable) {
    console.log(`    ${a.id.padEnd(24)} ${a.label}`);
  }

  console.log(`\n  PHRASINGS THAT DO NOT REACH THEIR OWN ACTION: ${dead.length}`);
  for (const d of dead.slice(0, 60)) {
    console.log(`    "${d.said}"`);
    console.log(`        wanted ${d.id}, got: ${d.instead}`);
  }
  if (dead.length > 60) console.log(`    ... and ${dead.length - 60} more`);

  const rate = checked ? Math.round(((checked - dead.length) / checked) * 100) : 0;
  console.log(`\n  ${checked - dead.length} of ${checked} phrasings land on the action they belong to (${rate}%)\n`);
}

/* -------------------------------------------------------------
   The list: what works, grouped, per role.
   ------------------------------------------------------------- */
function list() {
  const groups = new Map<string, Action[]>();
  for (const a of ACTIONS) {
    const kind = a.kind ?? 'other';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind)!.push(a);
  }

  for (const [kind, actions] of groups) {
    console.log(`\n## ${kind}\n`);
    for (const a of actions) {
      const allowed = ROLES.filter((r) => !a.capability || CAPS[r].has(a.capability));
      if (!allowed.length) continue;
      const role = allowed[0]!;
      const working = phrasingsFor(a).filter((s) => reaches(s, role, a.id));
      if (!working.length) continue;
      const who = a.capability ? allowed.join(', ') : 'everybody';
      console.log(`  ${a.label}  [${who}]`);
      for (const s of working) console.log(`      "${s}"`);
    }
  }
}

const mode = process.argv[2] ?? '--audit';
if (mode === '--list') list(); else audit();
