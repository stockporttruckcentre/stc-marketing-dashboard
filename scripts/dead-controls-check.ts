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
];

let bad = 0;
const say = (s: string) => console.log(s);

/** Comments out, so an example in a banner is not read as code. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .split('\n').map((l) => l.replace(/\/\/.*$/, ''));

/* An opening tag, across however many lines it is written on. */
function tags(lines: string[]): { tag: string; line: number; text: string }[] {
  const src = lines.join('\n');
  const out: { tag: string; line: number; text: string }[] = [];
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
      tag: m[1]!, text: src.slice(m.index, i + 1),
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

say('\n  Every control does something, or says why not\n  --------------------------------------------');

for (const file of GOVERNED) {
  if (!existsSync(file)) { say(`  skip  ${file} does not exist yet`); continue; }
  const lines = code(readFileSync(file, 'utf8'));
  const dead: string[] = [];

  for (const t of tags(lines)) {
    /* A closing or self-describing element with no interactive intent. */
    if (t.tag === 'a' && !/\bhref\s*=/.test(t.text)) continue;
    if (t.tag === 'label') {
      if (FOR.test(t.text) || HANDLER.test(t.text)) continue;
      dead.push(`${t.line}: <label> with no htmlFor and no handler`);
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

  if (dead.length === 0) {
    say(`  ok    ${file}`);
  } else {
    bad += dead.length;
    say(`  FAIL  ${file}`);
    for (const d of dead) say(`          ${d}`);
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
    for (const m of src.matchAll(/const [A-Z_]+ = `\(/g)) {
      const start = m.index! + m[0].length;
      const end = src.indexOf('`;', start);
      if (end < 0) continue;
      /* A backtick inside a ${...} interpolation is legal: that is a
         nested template literal and the parser handles it. Only a
         backtick in the literal's own TEXT ends it early. */
      let body = src.slice(start, end), out = '', depth = 0;
      for (let k = 0; k < body.length; k += 1) {
        if (body.startsWith('${', k)) { depth += 1; k += 1; continue; }
        if (depth > 0 && body[k] === '}') { depth -= 1; continue; }
        if (depth === 0) out += body[k];
      }
      body = out;
      if (body.includes('`')) {
        bad.push(src.slice(0, start).split('\n').length);
      }
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
