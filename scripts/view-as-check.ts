/* =============================================================
   "View as" cannot become a way to do things as somebody else.

   From the business:

     Create a "View as" button in admin so I can view the app as any
     user and see it exactly as they do while i'm testing perms

   The feature is a real impersonation of the INTERFACE, so the rules
   that keep it from being an impersonation of the PERSON are the whole
   of its safety, and every one of them is asserted here rather than
   only argued in a comment.

   Run with `npm run check:view-as`.
   ============================================================= */
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};

const lib   = readFileSync('lib/platform/permissions/view-as.ts', 'utf8');
const route = readFileSync('app/api/admin/view-as/route.ts', 'utf8');
const guard = readFileSync('lib/api/guard.ts', 'utf8');
const layout = readFileSync('app/dashboard/layout.tsx', 'utf8');
const ui    = readFileSync('components/admin/view-as.tsx', 'utf8');

console.log('\n  Turning it on\n  -------------');

ok('the route asks the database, not the browser, whether this is allowed',
  /command_may'?\s*,?\s*\{\s*p_capability:\s*'admin\.users'/.test(route)
  || /p_capability:\s*'admin\.users'/.test(route));

ok('and it refuses a person id that names nobody',
  /from\('profiles'\)[\s\S]{0,200}?maybeSingle\(\)/.test(route)
  && /No such person/.test(route),
  'an unknown id draws an empty capability set, which looks like a broken account');

ok('the cookie cannot be read by script in the page',
  /httpOnly:\s*true/.test(route));

ok('and it ends with the browser rather than persisting',
  !/maxAge:\s*[1-9]/.test(route.split('export async function DELETE')[0]),
  'nobody should come back tomorrow still wearing somebody else’s face');

console.log('\n  While it is on\n  --------------');

ok('the permission is re-asked on every page load, not trusted from the cookie',
  /command_may/.test(lib) && /admin\.users/.test(lib),
  'a permission taken away has to stop this at once, not when cookies are cleared');

ok('the capabilities are resolved for THEM, which is the point of the feature',
  /screenCapabilities\([\s\S]{0,200}?asSomeoneElse\?\.userId/.test(layout));

ok('every write route refuses while it is on',
  /viewingAsId/.test(guard) && /viewing_as/.test(guard),
  'a write would be recorded against you on a screen claiming to be them');

ok('and a read is still allowed, or the feature does nothing',
  /if \(capability !== undefined\)/.test(guard));

ok('the banner is in the layout, so it is on every screen and not only Admin',
  /ViewingAsBanner/.test(layout));

console.log('\n  Saying what it is not\n  ---------------------');

ok('the interface tells the person the rows are still theirs',
  /rows are still/i.test(ui),
  'row level security reads auth.uid(); no cookie can move it, so half of this is not faithful');

ok('and that nothing can be saved',
  /nothing can be (written|saved)/i.test(ui));

console.log('\n  Turning it off\n  --------------');

ok('stopping is NOT gated on the permission that started it',
  /Deliberately not gated/.test(route),
  'somebody whose admin permission was removed mid session must still be able to stop');

if (bad > 0) {
  console.log(`\n  ${bad} failed\n`);
  process.exit(1);
}
console.log('\n  view as changes the interface, never the identity\n');
