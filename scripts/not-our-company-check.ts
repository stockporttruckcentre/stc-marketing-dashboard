/* =============================================================
   Nothing in this repository belongs to somebody else.

   ---- The find this exists because of ----

   From the business, looking at a social post:

     why does one of my social post pages say "US English. STC and Frame
     use American spelling throughout." Why has frame made it through to
     this app? that's dangerous

   `lib/platform/compliance/copy-lint.ts` was another company's
   compliance policy, wired into the live save path for every social
   post. It carried a blockchain's name, a share ticker, "the protocol",
   transactions per second, token prices and a US spelling rule that
   would have told the marketing team to write Stockport Truck Center
   and to bill for labor.

   It cited `docs/source/STC_CONTEXT.md` as its authority. That file
   does not exist in this repository and never has.

   ---- Two rules, both mechanical ----

   1. WORDS THAT ARE NOT STC'S DO NOT APPEAR. Named, because they are
      specific and there is no clever way to recognise somebody else's
      brand in general. A new one gets added the day it is found.

   2. A SOURCE A FILE CITES EXISTS. The second rule is the one that
      would have caught this without anybody knowing the first. A
      comment claiming a document as its authority, where the document
      is not there, is either a file somebody forgot to commit or a file
      that was never about this company.

   Run with `npm run check:not-ours`.
   ============================================================= */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* Somebody else's, found in this repository and removed. Each is a
   whole word so "framework" and "frameBorder" are not hits. */
const NOT_OURS: { word: RegExp; what: string }[] = [
  { word: /\bFrame\b(?!\s*(?:rate|Border))/g, what: 'another product called Frame' },
  { word: /\bpaw[\s-]?chain\b/gi, what: 'a blockchain' },
  { word: /\bOTCID\b/g, what: 'a share ticker prefix' },
  { word: /\bCRCW\b/g, what: 'a share ticker' },
  { word: /\bRegulation\s+FD\b/gi, what: 'US securities regulation' },
  { word: /\bSEC\s+reporting\b/gi, what: 'US securities regulation' },
  { word: /\bpredecessor\s+chain\b/gi, what: 'a blockchain' },
  { word: /\bmarket\s?cap\b/gi, what: 'crypto trading language' },
  { word: /\bTPS\b/g, what: 'transactions per second, a blockchain measure' },
];

/* Where a mention is legitimate, and why.

   The migrations from 046 to 059 open with a line saying they were
   brought in from another company's intranet package and renumbered.
   That line is TRUE, it is the provenance of a third of this database,
   and deleting it would hide where this platform came from from
   whoever maintains it next. So those headers are allowed and the rest
   of each file is not: a mention below the header is content, not
   history.

   The other two name them in order to forbid them. */
const MAY_MENTION = new Set([
  'scripts/not-our-company-check.ts',
  'app/api/content/posts/[id]/route.ts',
]);

/* The provenance line itself, and nothing else on the line. */
const PROVENANCE = /^--\s*Brought in from the \w+ intranet package, renumbered\.$/m;

const SKIP = /node_modules|\.next|\.git|package-lock\.json|docs\/source\//;

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx?|css|sql|md|json)$/.test(name)) files.push(full);
  }
};
for (const root of ['app', 'components', 'lib', 'scripts', 'supabase', 'docs']) {
  if (existsSync(root)) walk(root);
}

head('Nothing in here belongs to another company');

let hits = 0;
for (const file of files) {
  if (MAY_MENTION.has(file)) continue;
  /* The provenance header is struck out before the scan, so a file can
     say where it came from and still be checked for content that came
     with it. */
  const src = readFileSync(file, 'utf8').replace(PROVENANCE, '-- (provenance)');
  for (const { word, what } of NOT_OURS) {
    const found = [...src.matchAll(word)];
    if (found.length === 0) continue;
    hits += 1;
    bad += 1;
    const line = src.slice(0, found[0]!.index).split('\n').length;
    console.log(`  FAIL  ${file}:${line} mentions ${found[0]![0]}`);
    console.log(`        ${what}. This is Stockport Truck Centre's repository.`);
  }
}
if (hits === 0) ok(`${files.length} files, and none of them name somebody else's product`, true);

head('Every source a file cites is actually here');

/* A document under the source folder, quoted in a comment as the
   thing a rule comes from. The copy lint cited a context document that was
   never in this repository, which is the tell that it came from
   somewhere else. */
const CITED = /\bdocs\/source\/[A-Za-z0-9_.-]+\.(?:md|html|xlsx|json)\b/g;
let missing = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of new Set([...src.matchAll(CITED)].map((x) => x[0]))) {
    if (existsSync(m)) continue;
    /* The two files that exist to record the removal have to be able to
       name the document the removed rules claimed as their authority.
       Naming a missing document in order to say it is missing is the
       opposite of the fault. */
    if (MAY_MENTION.has(file)) continue;
    missing += 1;
    bad += 1;
    const line = src.slice(0, src.indexOf(m)).split('\n').length;
    console.log(`  FAIL  ${file}:${line} cites ${m}, which is not in this repository`);
    console.log('        Either it was never committed, or the rule came from another project.');
  }
}
if (missing === 0) ok('every cited document under docs/source exists', true);

console.log(bad === 0
  ? '\n  This repository is Stockport Truck Centre\'s, and says so throughout.\n'
  : `\n  ${bad} thing(s) that are not ours.\n`);
process.exit(bad === 0 ? 0 : 1);
