/* =============================================================
   The sidebar, and the one list every screen comes from.

   Written because two pairs of rows were drawn with the same glyph:
   `news` and `tracker` were both TrendingUp, `crm` and `team` were both
   Users. Nobody reads a sidebar. It is scanned by shape, so a glyph
   that appears twice makes both of its rows harder to find than either
   would be on its own, and it is invisible in review because each row
   looks right by itself.

   npm run check:nav
   ============================================================= */
import { NAVIGATION, NAV_ITEMS, type NavIcon } from '../lib/nav';
import { ICONS_FOR_CHECKING } from '../components/nav-icons';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

/* -------------------------------------------------------------
   1. One glyph, one row.
   ------------------------------------------------------------- */
{
  const byGlyph = new Map<unknown, NavIcon[]>();
  for (const [name, glyph] of Object.entries(ICONS_FOR_CHECKING)) {
    const seen = byGlyph.get(glyph);
    if (seen) seen.push(name as NavIcon);
    else byGlyph.set(glyph, [name as NavIcon]);
  }
  const shared = [...byGlyph.values()].filter((names) => names.length > 1);
  ok('no two rows are drawn with the same glyph',
    shared.length === 0,
    shared.map((n) => n.join(' and ')).join('; '));
}

/* -------------------------------------------------------------
   2. Every screen has a glyph, and no glyph is for a screen that
      does not exist.
   ------------------------------------------------------------- */
{
  const used = new Set(NAV_ITEMS.map((i) => i.icon));
  const drawn = new Set(Object.keys(ICONS_FOR_CHECKING));
  const missing = [...used].filter((i) => !drawn.has(i));
  const spare = [...drawn].filter((i) => !used.has(i as NavIcon));
  ok('every screen in the navigation has a glyph', missing.length === 0, missing.join(', '));
  ok('and no glyph is kept for a screen that is gone', spare.length === 0, spare.join(', '));
}

/* -------------------------------------------------------------
   3. One row per screen, and one label per row.

   A duplicated href is two rows that highlight together, and a
   duplicated label is two rows nobody can tell apart in the command
   bar's results.
   ------------------------------------------------------------- */
{
  const hrefs = NAV_ITEMS.map((i) => i.href);
  const labels = NAV_ITEMS.map((i) => i.label);
  const twice = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
  ok('no screen is listed twice', twice(hrefs).length === 0, twice(hrefs).join(', '));
  ok('no two rows share a label', twice(labels).length === 0, twice(labels).join(', '));
  ok('every row goes somewhere', NAV_ITEMS.every((i) => i.href.startsWith('/')));
  ok('every section has a key and rows in it',
    NAVIGATION.every((s) => s.key && s.items.length > 0));
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  Every row has its own glyph, its own label and somewhere to go.\n');
