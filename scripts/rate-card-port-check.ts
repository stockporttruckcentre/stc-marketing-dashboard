/* =============================================================
   The Rate Card port against the pack it came from.

   From CLAUDE.md, about a kit sent for a screen:

     `docs/source/STCUIAnalytics.html` and `STCUIReports.html` are
     finished designs ... No value is chosen. Not a length, not a
     colour, not a weight, not a gap.

   The rate card pack is the same kind of thing, and its own HANDOFF.md
   says so in as many words: "Reproduce each .html file and the
   stylesheets exactly."

   A rule of the form "does this match the kit" cannot be kept by
   intention, because whoever writes the mismatch is the same person
   judging the match. So this is mechanical:

     1. The kit's component stylesheet is in the repository byte for
        byte.
     2. The tokens differ from the kit's in exactly the ways the port
        declares and no others.
     3. Every class the port uses is a class the kit defines. A class
        invented here is a value invented here.
     4. Every deliberate departure is in `port.css`, with the business's
        own words above it, and the count may only fall.

   Run with `npm run check:rate-card-port`.
   ============================================================= */
import { readFileSync, readdirSync } from 'node:fs';

const KIT = 'docs/source/rate_cards';
const PORT = 'components/sales/ratecards';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const read = (p: string) => readFileSync(p, 'utf8');

/** Every component in the port, so a new one is covered without being
    added to a list somebody has to remember. */
const tsxFiles = (): string[] =>
  readdirSync(PORT).filter((f) => f.endsWith('.tsx')).map((f) => `${PORT}/${f}`);

/* -------------------------------------------------------------
   1. The component stylesheet, byte for byte.
   ------------------------------------------------------------- */
head('The kit’s stylesheet is the one that ships');
{
  const kit = read(`${KIT}/rate-card-components.css`);
  const port = read(`${PORT}/rate-card-components.css`);
  ok('rate-card-components.css is byte for byte the kit’s', kit === port,
    kit.length === port.length
      ? 'same length, different bytes'
      : `kit is ${kit.length} bytes, the port is ${port.length}`);
}

/* -------------------------------------------------------------
   2. The tokens, which differ in exactly three declared ways.
   ------------------------------------------------------------- */
head('The tokens differ from the kit only where the port says so');
{
  const kit = read(`${KIT}/rate-card-tokens.css`);
  const port = read(`${PORT}/rate-card-tokens.css`);

  /* Strip the port's own header comment, which explains the changes. */
  const body = port.slice(port.indexOf('*/') + 2).trim();

  /* Apply the three declared changes to the KIT and see whether what
     comes out is the port. Deriving it this way means an undeclared
     fourth change cannot pass. */
  let derived = kit
    .replace(':root{', '.rc-6a{')
    .replace('[data-stc-theme="dark"]{',
      '.rc-6a[data-stc-theme="dark"],[data-stc-theme="dark"] .rc-6a,[data-theme="dark"] .rc-6a{');
  for (const rule of [
    '*{box-sizing:border-box}\n',
    'body{margin:0;background:var(--bg);color:var(--text);font-family:var(--inter);letter-spacing:-0.01em}\n',
    'a{color:var(--accent);text-decoration:none}\n',
    'a:hover{color:var(--accent-hover)}\n',
  ]) derived = derived.replace(rule, '');

  ok('the tokens are the kit’s with the two selectors rescoped and the three global rules moved',
    derived.trim() === body,
    'something else in the token file differs from the kit');

  /* And no colour was invented while doing it. */
  const kitHexes = new Set(kit.match(/#[0-9A-Fa-f]{3,8}/g) ?? []);
  const portHexes = new Set(body.match(/#[0-9A-Fa-f]{3,8}/g) ?? []);
  const invented = [...portHexes].filter((h) => !kitHexes.has(h));
  ok('no colour in the token file that the kit does not define',
    invented.length === 0, invented.join(', '));
}

/* -------------------------------------------------------------
   3. Every class used is a class the kit defines.
   ------------------------------------------------------------- */
head('Every class the screens use is the kit’s');
{
  const css = read(`${PORT}/rate-card-components.css`);
  const defined = new Set<string>();
  for (const m of css.matchAll(/\.((?:rc-[0-9a-z]+)|(?:rate-[a-z-]+))\b/g)) defined.add(m[1]!);

  /* The port's own wrapper classes, declared in port.css and named here
     so they are a short list somebody can read rather than a pattern
     that would let anything through. */
  const MINE = new Set(['rc-scrim', 'rc-pop-scrim', 'rc-pop', 'rc-toasts', 'sheet', 'noprint']);

  const files = tsxFiles();
  const strays: string[] = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
      const names = (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s${}?:'"]+/).filter(Boolean);
      for (const n of names) {
        if (!n.startsWith('rc-') && !n.startsWith('rate-')) continue;
        if (defined.has(n) || MINE.has(n)) continue;
        strays.push(`${f.split('/').pop()}: ${n}`);
      }
    }
    /* Class names held in variables and arrays, which is how the row
       states and the basis chips are chosen. */
    for (const m of src.matchAll(/'((?:rc-[0-9a-z]+)|(?:rate-[a-z-]+))'/g)) {
      const n = m[1]!;
      if (defined.has(n) || MINE.has(n)) continue;
      strays.push(`${f.split('/').pop()}: ${n}`);
    }
  }
  ok(`${defined.size} classes defined by the kit, and nothing else used`,
    strays.length === 0, [...new Set(strays)].slice(0, 12).join('\n        '));
}

/* -------------------------------------------------------------
   4. Every departure is declared, quoted and counted.
   ------------------------------------------------------------- */
head('Every departure from the kit is declared and quoted');
{
  const port = read(`${PORT}/port.css`);

  /* A departure is a rule that restyles a kit class. Rules that place
     the kit inside the application, the wrapper classes and the reset
     are not departures: they say where the kit sits, not what it looks
     like. */
  const departures = [...port.matchAll(/^\.rc-6a \.(rc-[0-9a-z]+)[^{]*\{([^}]*)\}/gm)]
    .map((m) => m[1]!);

  const DECLARED = [
    /* Deviation 1: the thick borders. */
    'rc-2s', 'rc-8l', 'rc-8n', 'rc-8p', 'rc-2h',
    /* Deviation 2: typing fields the height of their own text. */
    'rc-29', 'rc-5x', 'rc-6j', 'rc-6o', 'rc-7s',
    /* Layout, which is where the kit sits rather than how it looks. */
    'rc-3z', 'rc-42', 'rc-46', 'rc-4d', 'rc-3f', 'rc-6x', 'rc-6z', 'rc-6g',
  ];

  const undeclared = [...new Set(departures)].filter((c) => !DECLARED.includes(c));
  ok('no kit class is restyled without being on the declared list',
    undeclared.length === 0,
    `${undeclared.join(', ')} are restyled in port.css but not declared here`);

  /* Each deviation carries the instruction that caused it. */
  ok('deviation 1 quotes the instruction that caused it',
    port.includes('overly-thick borders'));
  ok('deviation 2 quotes the instruction that caused it',
    port.includes('the box height is the same as the text'));
  ok('the removed sidebar quotes the instruction that caused it',
    port.includes('do not add in the navy sidebar'));

  /* And the kit's own rail is never rendered.

     Comments out first: the hub's header explains that `.rc-6b` is the
     class being left out, and a check that reads its own explanation as
     the offence is a check that punishes documenting the decision. */
  const files = tsxFiles();
  const code = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const rail = files.filter((f) => code(read(f)).includes('rc-6b'));
  ok('the kit’s navy rail is never rendered', rail.length === 0, rail.join(', '));
}

/* -------------------------------------------------------------
   5. The data contract is the kit's, and generated.
   ------------------------------------------------------------- */
head('Every number came out of the kit');
{
  const gen = read('lib/ratecards/kit.generated.ts');
  ok('the generated file says it is generated', gen.startsWith('/* GENERATED'));

  const model = JSON.parse(read(`${KIT}/rate-model.json`)) as {
    rates: unknown[]; labourPools: Record<string, number>;
    fleetsmartInclusions: unknown[];
  };
  const rates = (gen.match(/"rate_id"|"id": "r\d\d"/g) ?? []).length;
  ok(`all ${model.rates.length} of the kit’s rates are in it`,
    rates >= model.rates.length, `found ${rates}`);

  for (const [pool, rate] of Object.entries(model.labourPools)) {
    ok(`the ${pool} labour rate is the kit’s ${rate}`,
      new RegExp(`"${pool}": ${rate}\\b`).test(gen));
  }

  ok(`all ${model.fleetsmartInclusions.length} inclusions are in it`,
    (gen.match(/"inclusion":/g) ?? []).length === model.fleetsmartInclusions.length);
}

console.log(bad === 0
  ? '\n  The port is the kit, and every departure from it was asked for.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
