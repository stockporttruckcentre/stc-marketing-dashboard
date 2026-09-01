/* The saved arrangement, round tripped.

   Not a browser test: it exercises the module's own contract, which is
   the part that goes wrong quietly. A saved state that reads back as
   null puts the grid in its default arrangement and looks exactly like
   the feature not being built. */
import { describeView, type SavedView } from '../lib/crm/grid-view';

let pass = 0; let fail = 0;
const ok = (what: string, cond: boolean) => {
  if (cond) { pass += 1; console.log(`ok    ${what}`); }
  else { fail += 1; console.log(`FAIL  ${what}`); }
};

const header = (id: string) => ({ email: 'Email', status: 'Status', company_name: 'Company' }[id] ?? id);

const sortedByEmail: SavedView = {
  columns: [{ colId: 'email', sort: 'asc' }, { colId: 'status', sort: null }],
  filter: {}, version: 1,
};
ok('one sort reads as the column somebody clicked',
  describeView(sortedByEmail, header) === 'sorted by Email');

const desc: SavedView = { columns: [{ colId: 'status', sort: 'desc' }], filter: {}, version: 1 };
ok('descending says so, because the order is the surprising half',
  describeView(desc, header) === 'sorted by Status, highest first');

const two: SavedView = {
  columns: [{ colId: 'email', sort: 'asc' }, { colId: 'status', sort: 'desc' }],
  filter: {}, version: 1,
};
ok('two sorts are counted rather than listed',
  describeView(two, header) === 'sorted by 2 columns');

const filtered: SavedView = {
  columns: [{ colId: 'email', sort: 'asc' }], filter: { status: { x: 1 } }, version: 1,
};
ok('a column filter is named, because a filter nobody remembers is blamed on the data',
  describeView(filtered, header) === 'sorted by Email, 1 column filter');

const hidden: SavedView = {
  columns: [{ colId: 'email', sort: null }, { colId: 'status', hide: true }],
  filter: {}, version: 1,
};
ok('a hidden column is counted, because a missing column reads as a bug',
  describeView(hidden, header) === '1 hidden');

const plain: SavedView = { columns: [{ colId: 'email', sort: null }], filter: {}, version: 1 };
ok('an arrangement doing nothing says nothing, rather than an empty line',
  describeView(plain, header) === null);

const widthOnly: SavedView = {
  columns: [{ colId: 'email', sort: null, width: 320 }], filter: {}, version: 1,
};
ok('a width change alone is kept but not announced',
  describeView(widthOnly, header) === null);

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
