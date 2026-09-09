/* =============================================================
   One column for a face, one circle to draw it in.

   This bug was not hard. `profiles` had two columns meaning the same
   thing, the uploader wrote one and the team directory read the other,
   and a photograph uploaded in Settings appeared on the person's own
   sidebar and nowhere else in the product. Nothing was broken enough
   to throw. It just quietly did not work, for months.

   Two rules, and both of them are about the same failure returning:

     1. ONE COLUMN. Nothing outside the migration that removed it may
        mention `avatar_url` again. A second column is how a picture
        gets written somewhere nothing reads.
     2. ONE CIRCLE. There is one Avatar implementation. There were
        three, and the two that could not show a picture were the two
        on the screens people actually work in all day.

   And one that is about the rules above being kept honestly:

     3. EVERY PLACE THAT HAS A PICTURE PASSES IT. A call site that
        renders a colleague from a record carrying `photo_url` and does
        not hand it over is initials for somebody who uploaded a face.

   Run with `npm run check:avatars`.
   ============================================================= */
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0;
const failures: string[] = [];

function must(what: string, ok: boolean, detail?: string) {
  if (ok) { passed += 1; console.log(`  ok    ${what}`); }
  else { failures.push(detail ? `${what}\n        ${detail}` : what); console.log(`  FAIL  ${what}`); }
}

function everyFileUnder(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') return [];
      return everyFileUnder(path, ext);
    }
    return ext.some((x) => e.name.endsWith(x)) ? [path] : [];
  });
}

const code = [
  ...everyFileUnder('app', ['.ts', '.tsx']),
  ...everyFileUnder('components', ['.ts', '.tsx']),
  ...everyFileUnder('lib', ['.ts', '.tsx']),
];
const migrations = everyFileUnder('supabase/migrations', ['.sql']);

console.log('\n  1. One column\n  ---------');

/* The migrations that created and removed it are allowed to say the
   word. Nothing else is, because anything else saying it is either a
   reader that will find nothing or a writer nobody reads. */
const MAY_SAY_AVATAR_URL = new Set([
  'supabase/migrations/099_red_amber_green.sql',
  'supabase/migrations/101_one_column_for_a_face.sql',
]);

/* Comments are stripped first, deliberately. A file explaining why the
   second column went is doing the right thing and should keep saying
   the word; the rule is about code that still reads or writes it. A
   check that cannot tell the difference gets switched off. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
    .join('\n');
}

const stillSaying = [...code, ...migrations]
  .filter((f) => !MAY_SAY_AVATAR_URL.has(f))
  .filter((f) => /\bavatar_url\b/.test(withoutComments(readFileSync(f, 'utf8'))));

must('no code outside migrations 099 and 101 reads or writes avatar_url',
     stillSaying.length === 0, stillSaying.join('\n        '));

const one01 = readFileSync('supabase/migrations/101_one_column_for_a_face.sql', 'utf8');
must('101 moves the pictures across before it drops anything',
     one01.indexOf('SET photo_url = avatar_url') < one01.indexOf('DROP COLUMN avatar_url'));
must('101 drops the second column rather than leaving both',
     /ALTER TABLE profiles DROP COLUMN avatar_url/.test(one01));
must('assignable_people can see a picture',
     /CREATE OR REPLACE VIEW assignable_people[\s\S]*p\.photo_url/.test(one01));

/* CREATE OR REPLACE VIEW may only append. Putting photo_url anywhere
   but last fails against a database that already has the view, and
   passes against an empty one, which is the worst way round. */
const viewBody = one01.slice(one01.indexOf('CREATE OR REPLACE VIEW assignable_people'));
const selectList = viewBody.slice(0, viewBody.indexOf('FROM profiles p'));
const lastColumn = selectList.trimEnd().split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).pop() ?? '';
must('and it is the last column, because a view may only be appended to',
     lastColumn.includes('photo_url'), `last column was: ${lastColumn.trim()}`);

console.log('\n  2. One circle\n  ---------');

const KIT = 'components/kit/avatar.tsx';
must('the shared avatar exists', code.includes(KIT));

const kit = readFileSync(KIT, 'utf8');
must('it can draw a picture', /<img/.test(kit));
must('it falls back to initials when the picture will not load',
     /onError/.test(kit) && /setBroke/.test(kit));
must('it holds the kit rule that Panton is never below 11px',
     /Math\.max\(11,/.test(kit));

/* Anything that defines its own component called Avatar is a second
   implementation, unless it is a thin wrapper that renders the shared
   one. The wrapper is fine and is what work/parts.tsx does. */
const ownAvatar = code
  .filter((f) => f !== KIT)
  .filter((f) => /export function Avatar\s*\(/.test(readFileSync(f, 'utf8')))
  .filter((f) => !/from '@\/components\/kit\/avatar'/.test(readFileSync(f, 'utf8')));

must('no screen defines an Avatar that is not the shared one',
     ownAvatar.length === 0, ownAvatar.join('\n        '));

/* The old home of the good one. Deleted rather than left as a
   re-export, so nobody imports the shim and wonders which is which. */
must('the old components/team/avatar.tsx is gone',
     !code.includes('components/team/avatar.tsx'));
must('and nothing still imports it',
     !code.some((f) => /components\/team\/avatar/.test(readFileSync(f, 'utf8'))));

console.log('\n  3. Every place with a picture passes it\n  ---------');

/* Each of these is a screen that draws a colleague from a record which
   carries the column. The file has to both read the column and hand it
   to an avatar, because reading it and not passing it is exactly the
   state this whole change is undoing. */
const MUST_PASS: [string, string][] = [
  ['components/TeamPanel.tsx', 'the team directory'],
  ['components/AdminPanel.tsx', 'the admin panel'],
  ['components/work/parts.tsx', 'the assignee chip on a task'],
  ['components/work/drawer.tsx', 'the author of a note'],
  ['components/work/layouts.tsx', 'the workload rail'],
  ['components/calendar/parts.tsx', 'a meeting attendee'],
  ['components/Sidebar.tsx', 'your own face in the sidebar'],
  ['components/settings/AvatarField.tsx', 'the preview on your settings tab'],
];

for (const [file, what] of MUST_PASS) {
  const src = readFileSync(file, 'utf8');
  must(`${what} passes a picture through`,
       /photo(_u|U)rl/.test(src), `${file} names no picture column`);
}

/* The two queries that feed the diary and the assignee picker. A
   component ready to draw a face is no use if the row never carried
   one, and this is the half of the wiring that has no type error when
   it is missing. */
for (const page of ['app/dashboard/work/page.tsx', 'app/dashboard/calendar/page.tsx']) {
  const src = readFileSync(page, 'utf8');
  must(`${page} asks for the picture when it reads people`,
       /from\('profiles'\)\.select\('id, full_name, email, photo_url'/.test(src));
}

/* The uploader is the one writer. Through the RPC, because a direct
   table update is how it came to write the wrong column with nothing
   noticing for months. */
const field = readFileSync('components/settings/AvatarField.tsx', 'utf8');
must('the uploader writes through update_my_profile, not the table',
     /rpc\('update_my_profile'/.test(field) && !/from\('profiles'\)\s*\n?\s*\.update/.test(field));

/* An attendee who is a guest or a typed email has no profile, so their
   face must be null rather than guessed from a matching address. */
const diary = readFileSync('lib/calendar/diary.ts', 'utf8');
must('a guest gets no face, because there is no profile to take one from',
     /guestId: g\.id,[\s\S]{0,400}?photoUrl: null/.test(diary));

console.log('\n  ---------\n');
if (failures.length) {
  console.log(`  ${failures.length} failing:\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`  ${passed}/${passed} passing`);
console.log('  One column, one circle, and every screen that has a face draws it\n');
