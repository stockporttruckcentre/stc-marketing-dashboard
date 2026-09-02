/* =============================================================
   What a person sees when the database is behind the application.

   The code reaches main and deploys the moment it is merged. The SQL is
   run by hand afterwards. So there is always a window, and during it
   every screen calling a changed function fails.

   What it said during that window was:

     Could not find the function public.group_revenue(p_division,
     p_upto) in the schema cache

   which is true, is about PostgREST's internals, and tells the person
   reading it nothing they can act on.

   This is an error path, so nobody exercises it by accident and the
   wording rots quietly. Hence a check.

   npm run check:rpc-errors
   ============================================================= */
import { readable } from '../lib/protean/rpc';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

/* -------------------------------------------------------------
   1. THE ONE THAT HAPPENED.
   ------------------------------------------------------------- */
{
  const real = readable({
    code: 'PGRST202',
    message: 'Could not find the function public.group_revenue(p_division, p_upto) '
      + 'in the schema cache',
  });
  ok('it says what to do rather than what went wrong',
    real.message.includes('Run the latest revenue migrations'), real.message);
  ok('and it does not repeat the phrase that confused somebody',
    !real.message.includes('schema cache'), real.message);
  ok('but it does mention the lag, because that is the second half of the answer',
    real.message.includes('few seconds'), real.message);
}

/* -------------------------------------------------------------
   2. Recognised by the code, not by the wording.

   The wording is PostgREST's to change. The code is a contract.
   ------------------------------------------------------------- */
{
  const byCode = readable({ code: 'PGRST202', message: 'something else entirely' });
  ok('the code alone is enough',
    byCode.message.includes('Run the latest revenue migrations'), byCode.message);

  const byWords = readable({ message: 'Could not find the function public.whatever(x)' });
  ok('and the wording alone is enough, in case the code is missing',
    byWords.message.includes('Run the latest revenue migrations'), byWords.message);
}

/* -------------------------------------------------------------
   3. A missing table is the same problem one step earlier.
   ------------------------------------------------------------- */
{
  const table = readable({
    code: '42P01',
    message: 'relation "protean_invoices" does not exist',
  });
  ok('a missing table says run the migrations too',
    table.message.includes('revenue migrations'), table.message);
  ok('and says it is the tables rather than a function',
    table.message.includes('tables'), table.message);
}

/* -------------------------------------------------------------
   4. EVERYTHING ELSE IS PASSED THROUGH UNCHANGED.

   The important half. A permission refusal, a constraint, a genuine
   fault: those messages are written for the person reading them and
   replacing them with a guess about migrations would send somebody to
   the SQL editor to fix a problem that is not there.
   ------------------------------------------------------------- */
{
  const refused = readable({
    code: 'P0001',
    message: 'Company revenue needs access to the CRM.',
  });
  ok('a permission refusal comes through word for word',
    refused.message === 'Company revenue needs access to the CRM.', refused.message);

  const clash = readable({
    code: '23505',
    message: 'duplicate key value violates unique constraint "idx_customer_groups_name"',
  });
  ok('a constraint violation is not mistaken for a missing migration',
    !clash.message.includes('migrations'), clash.message);

  const nothing = readable({ message: 'Failed to fetch' });
  ok('a network failure is passed through as itself',
    nothing.message === 'Failed to fetch', nothing.message);
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  A database behind the application says so in a sentence somebody can act on, '
  + 'and every other error is still its own.\n');
