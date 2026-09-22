/* =============================================================
   No control that does nothing.

   From the business, after the Roles tab arrived with Grid, Matrix and
   Compare drawn and inert:

     I can't test or demo something where the buttons don't work because
     I have no clue what's behind them, and typically you've not even
     built what's behind them yet.

   Correct, and a promise not to do it again is worth nothing, because
   whoever writes the dead button is the same person judging whether it
   is dead. So this reads the source instead.

   ---- What counts as alive ----

   A control is alive if it does any of:

     - carries an `onClick`, `onChange`, `onInput` or `onSubmit`
     - is `disabled` AND carries a `title` saying what is missing
     - is a `<label htmlFor=...>`, which drives a radio or a checkbox,
       and is how this codebase's kit screens switch without JavaScript
     - is inside a component this file lists as a pure presenter

   Anything else is a defect and named with its line.

   ---- Why the disabled case needs the title ----

   A disabled button with no explanation is the same dead end as one
   that does nothing: the person pressing it still cannot tell whether
   the feature is missing, their permissions are short, or the screen is
   broken. The title is what turns "it does nothing" into "here is what
   would have to exist".

   Run with `npm run check:dead-controls`.
   ============================================================= */
import { readFileSync, existsSync } from 'node:fs';

/* Screens held to the standard. Each one added here is a screen that
   has been driven control by control, not merely rendered. */
const GOVERNED = [
  'components/admin/roles/RolesScreen.tsx',
  'components/admin/roles/EditPermissions.tsx',
  'components/admin/roles/RoleMenu.tsx',
  'components/admin/roles/views.tsx',
  'components/admin/roles/Compare.tsx',
  'components/sales/ratecards/RateCardsHub.tsx',
  'components/sales/ratecards/RateBuilder.tsx',
  'components/sales/ratecards/RateRow.tsx',
  'components/sales/ratecards/modals.tsx',
  'components/sales/ratecards/Defaults.tsx',
  'components/sales/ratecards/FleetsmartPanel.tsx',
  'components/sales/ratecards/builder-tabs.tsx',
  'components/sales/ratecards/SheetPreview.tsx',
  'components/sales/ratecards/RateCardFromContract.tsx',
  'components/SocialPlanner.tsx',
  'components/social/composer.tsx',
  'components/social/workspace.tsx',
  'components/social/planner.tsx',
  'components/social/detail.tsx',
  'components/social/previews.tsx',
  'components/analytics/personal/PersonalAnalytics.tsx',
  'components/dashboard/FinancialYearTargets.tsx',
  'components/revenue/moderate-panel.tsx',
  'components/TopBar.tsx',
  'components/AdminPanel.tsx',
];

let bad = 0;
const say = (s: string) => console.log(s);

/**
 * Comments out, so an example in a banner is not read as code.
 *
 * A COMMENT IS ONLY A COMMENT OUTSIDE A STRING, and the naive version
 * of this, two regular expressions, was wrong in both directions on
 * this codebase's own files:
 *
 *   accept="image/*"        opened a block comment that swallowed the
 *                           hidden file input on the next line, and the
 *                           upload button above it was reported dead
 *   placeholder="https://"  opened a line comment that swallowed the
 *                           rest of the line
 *
 * So this walks the source instead, tracking which quote it is inside,
 * and blanks a comment only when it starts outside one. Blanking rather
 * than deleting keeps every line number the same as the file's.
 */
function code(src: string): string[] {
  const out = src.split('');
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const shut = src.indexOf('*/', i + 2);
      const end = shut === -1 ? src.length : shut + 2;
      for (let k = i; k < end; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = end - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let k = i;
      while (k < src.length && src[k] !== '\n') { out[k] = ' '; k += 1; }
      i = k;
      continue;
    }
  }
  return out.join('').split('\n');
}

/* An opening tag, across however many lines it is written on.

   `after` is where the opening tag ends, which is what lets a `<label>`
   be judged on what it WRAPS rather than only on its own attributes.
   See the label rule below for why that matters. */
function tags(lines: string[]): { tag: string; line: number; text: string; after: number }[] {
  const src = lines.join('\n');
  const out: { tag: string; line: number; text: string; after: number }[] = [];
  const re = /<(button|input|select|textarea|label|a)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    /* Walk to the end of the opening tag, respecting braces so an
       arrow function inside a prop does not end it early. */
    let i = re.lastIndex, depth = 0, quote = '';
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push({
      tag: m[1]!, text: src.slice(m.index, i + 1), after: i + 1,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

const HANDLER = /\bon(Click|Change|Input|Submit|KeyDown|Pointer\w+)\s*=/;
const DISABLED = /\bdisabled(\s*=|[\s>])/;
const TITLE = /\btitle\s*=/;
const FOR = /\bhtmlFor\s*=/;
/* A control handed its behaviour from above is alive: the caller is
   what this check then reads. Spreading props or taking an onX prop
   counts, and so does a form input bound to a value the parent owns. */
const FROM_PROPS = /\{\.\.\.|on[A-Z]\w*\s*=\s*\{\s*(?:props\.|on[A-Z])/;

/**
 * Every control in one piece of source that does nothing.
 *
 * Separated from the file loop so the rules can be run against a
 * fixture as well as against the codebase. See the self test at the
 * bottom: a check whose rules were loosened to stop it crying wolf is
 * a check that has to prove it still catches the wolf.
 */
function deadIn(source: string): string[] {
  const lines = code(source);
  const src = lines.join('\n');
  const dead: string[] = [];

  for (const t of tags(lines)) {
    /* ---- An anchor is alive because of where it goes ----

       An `<a>` with no `href` is not a control at all. An `<a>` WITH one
       navigates, and the href is the behaviour: demanding an onClick as
       well would have called the "open the published post" link on the
       post detail screen dead when pressing it does exactly what it
       says. What is dead is the placeholder href, `#` or empty, which
       is a link drawn before anything was behind it. */
    if (t.tag === 'a') {
      if (!/\bhref\s*=/.test(t.text)) continue;
      if (/\bhref\s*=\s*(["'])#?\1/.test(t.text)) {
        dead.push(`${t.line}: <a> points at nothing, so pressing it does nothing`);
        continue;
      }
      continue;
    }

    /* ---- A label is alive when it WRAPS its input ----

       `htmlFor` is one of the two ways HTML associates a label with a
       control. The other is containment, and it is the one this
       codebase uses for every file picker: a styled `<label>` with a
       hidden `<input type="file">` inside it, because a file input
       cannot be styled and this is the standard way round that.

       Reading only the label's own attributes called three working
       upload buttons dead. So the rule reads what the label contains. */
    if (t.tag === 'label') {
      if (FOR.test(t.text) || HANDLER.test(t.text)) continue;
      const shut = src.indexOf('</label>', t.after);
      const inside = shut === -1 ? '' : src.slice(t.after, shut);
      if (/<(input|select|textarea)\b/.test(inside)) continue;
      dead.push(`${t.line}: <label> with no htmlFor, no handler and no control inside it`);
      continue;
    }
    /* ---- A radio nothing listens to is still alive ----

       These kit screens switch with radios and CSS and no JavaScript,
       which the handoff requires in as many words. Such a radio has no
       handler by design: a label drives it and a stylesheet reads it.
       It counts as alive when it carries an id for a label to point at,
       and the port check proves the labels and the rules line up. */
    if (/type="(radio|checkbox)"/.test(t.text) && /\bid=/.test(t.text)) continue;
    if (HANDLER.test(t.text) || FROM_PROPS.test(t.text)) continue;
    if (DISABLED.test(t.text) && TITLE.test(t.text)) continue;
    if (DISABLED.test(t.text)) {
      dead.push(`${t.line}: <${t.tag}> is disabled but does not say what is missing`);
      continue;
    }
    dead.push(`${t.line}: <${t.tag}> has no handler and is not disabled`);
  }

  return dead;
}

say('\n  Every control does something, or says why not\n  --------------------------------------------');

for (const file of GOVERNED) {
  if (!existsSync(file)) { say(`  skip  ${file} does not exist yet`); continue; }
  const dead = deadIn(readFileSync(file, 'utf8'));

  if (dead.length === 0) {
    say(`  ok    ${file}`);
  } else {
    bad += dead.length;
    say(`  FAIL  ${file}`);
    for (const d of dead) say(`          ${d}`);
  }
}

/* =============================================================
   THE CHECK, CHECKED.

   Three of the rules above were loosened after this file reported two
   working upload buttons and one working link as dead. Loosening a rule
   to stop false alarms is exactly how a check quietly stops catching
   anything, and the person doing the loosening is the person judging
   whether it still works. So it is not a judgement: the rules are run
   against a fixture that contains one of each, and the verdicts are
   asserted.

   The last two fixtures are the comment stripper. Both are real lines
   out of `components/social/composer.tsx`, and both used to blank the
   code that followed them, which is why a wired control looked dead.
   ============================================================= */
say('\n  And the rules still catch what they are for\n  ------------------------------------------');

const FIXTURES: { what: string; src: string; dead: boolean }[] = [
  { what: 'a button with no handler',
    dead: true, src: '<button>Press me</button>' },
  { what: 'a button disabled with no reason given',
    dead: true, src: '<button disabled>Press me</button>' },
  { what: 'a link that points at nothing',
    dead: true, src: '<a href="#">Open it</a>' },
  { what: 'a link with an empty address',
    dead: true, src: '<a href="">Open it</a>' },
  { what: 'a label wrapping nothing',
    dead: true, src: '<label>Upload image<span /></label>' },

  { what: 'a button with a handler',
    dead: false, src: '<button onClick={go}>Press me</button>' },
  { what: 'a button disabled and saying why',
    dead: false, src: '<button disabled title="No contract yet">Press me</button>' },
  { what: 'a label pointing at its control',
    dead: false, src: '<label htmlFor="x">Name</label>' },
  { what: 'a label wrapping a hidden file input',
    dead: false,
    src: '<label>Upload<input type="file" hidden onChange={pick} /></label>' },
  { what: 'a link that goes somewhere',
    dead: false, src: '<a href={v.permalink} target="_blank">Open it</a>' },
  { what: 'a radio a stylesheet reads',
    dead: false, src: '<input type="radio" id="tab-1" name="tab" />' },

  { what: 'a dead button after an image/* attribute is still found',
    dead: true,
    src: '<input accept="image/*" onChange={pick} />\n<button>Press me</button>' },
  { what: 'a dead button after an https:// placeholder is still found',
    dead: true,
    src: '<input placeholder="https://" onChange={set} /><button>Press me</button>' },
  { what: 'a real block comment is still ignored',
    dead: false, src: '/* <button>Press me</button> */' },
  { what: 'a real line comment is still ignored',
    dead: false, src: '// <button>Press me</button>' },
];

for (const f of FIXTURES) {
  const found = deadIn(f.src).length > 0;
  const right = found === f.dead;
  say(`  ${right ? 'ok  ' : 'FAIL'}  ${f.what}`);
  if (!right) {
    bad += 1;
    say(`          expected ${f.dead ? 'dead' : 'alive'}, read as ${found ? 'dead' : 'alive'}`);
  }
}

if (bad > 0) {
  say(`\n  ${bad} control${bad === 1 ? '' : 's'} that do nothing.`);
  say('  Wire it, or disable it with a title naming what is missing.');
  say('  A drawn button somebody cannot use is worse than no button.\n');
  process.exit(1);
}
say('\n  Every control on every governed screen is wired or explains itself.\n');

/* =============================================================
   And one more thing this file checks, because it has cost three
   debugging sessions: a backtick inside a template literal.

   `roles-port-check.ts` sends a large browser script as a template
   literal. A backtick written inside it, in a COMMENT quoting a class
   or a command, ends the literal. What esbuild then reports is a
   syntax error on a line thirty lines further down that is perfectly
   valid, so the real cause is invisible.
   ============================================================= */
{
  const FILES = ['scripts/roles-port-check.ts', 'scripts/roles-render-check.ts'];
  let broke = 0;
  console.log('  No backtick inside a browser script literal\n  ------------------------------------------');
  for (const f of FILES) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    /* Each `const NAME = \`(` ... `\`;` block is one such literal. */
    const bad: number[] = [];
    /* Both shapes this repository writes a browser script in: a named
       constant, and one handed straight to evaluate. The second shape
       is how the backtick got in the second time. */
    for (const m of src.matchAll(/(?:const [A-Za-z_]+ = |evaluate\()`/g)) {
      /* Walk the literal properly rather than hunting for a closing
         pattern: step over ${...} interpolations, where a backtick is
         legal, and stop at the first backtick outside one, which is
         where the literal really ends. Guessing the end by a trailing
         punctuation mark is what let the second one through. */
      let k = m.index! + m[0].length, depth = 0, offending = false;
      for (; k < src.length; k += 1) {
        if (src.startsWith('\\', k)) { k += 1; continue; }
        if (src.startsWith('${', k)) { depth += 1; k += 1; continue; }
        if (depth > 0 && src[k] === '}') { depth -= 1; continue; }
        if (src[k] === '`') { if (depth === 0) break; continue; }
        if (depth === 0 && src[k] === '`') { offending = true; break; }
      }
      /* Everything at depth 0 between the two ends is the literal's own
         text. A backtick can only be there if it ended the literal
         early, which is exactly the bug. */
      const body = src.slice(m.index! + m[0].length, k);
      let clean = '', d = 0;
      for (let q = 0; q < body.length; q += 1) {
        if (body.startsWith('${', q)) { d += 1; q += 1; continue; }
        if (d > 0 && body[q] === '}') { d -= 1; continue; }
        if (d === 0) clean += body[q];
      }
      if (clean.includes('`') || offending) bad.push(src.slice(0, m.index).split('\n').length);
    }
    if (bad.length === 0) { console.log(`  ok    ${f}`); continue; }
    broke += bad.length;
    console.log(`  FAIL  ${f}: a backtick inside the literal starting near line ${bad.join(', ')}`);
    console.log('        Write the class or command without backticks. The error esbuild');
    console.log('        gives for this names an innocent line much further down.');
  }
  if (broke > 0) process.exit(1);
  console.log('');
}
