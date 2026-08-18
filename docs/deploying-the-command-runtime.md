# Catching a database up with this branch

The symptom, from a deployment where every command reaches the
confirmation and then stops:

```
Could not find the function public.command_perform(p_steps)
in the schema cache
```

Nothing is wrong with the code. The database that deployment is pointed
at is older than the branch in front of it: `command_perform` arrived in
migration 017 and this branch runs to 039.

This file is how to tell, how to fix it, and how to prove it is fixed.
None of it needs a shell, a CLI or a token: every step is a query in the
Supabase SQL editor.

## 1. Which database is that deployment pointed at

The repository does not say and cannot say. There is no `config.toml`,
no `.vercel` directory and no project reference in any file: the only
thing that decides is the environment variable the deployment was built
with.

In Vercel, open the project, then **Settings, Environment Variables**,
and read `NEXT_PUBLIC_SUPABASE_URL` **for the environment you are
testing**. Preview and Production are separate values and are often
separate projects. The subdomain is the project reference:

```
https://<project-ref>.supabase.co
```

Open that project in Supabase. Everything below happens there.

**Check the reference before running anything.** A Preview that points
at the Production database is the case where catching it up is a
production change, and it is worth knowing that before running a file
rather than after.

## 2. Catch it up

```
./scripts/sql/bundle-migrations.sh > catch-up.sql
```

That is every migration the command runtime needs, in the order
`scripts/sql/order.txt` declares, wrapped in one transaction. Paste it
into the SQL editor and run it.

Three things worth knowing before you do:

- **It is safe to run more than once.** Every statement is
  `CREATE OR REPLACE`, `CREATE TABLE IF NOT EXISTS`, or a seed that
  replaces its own rows. Running it against a database that is already
  half way through is the intended use.
- **It does not include `schema.sql` or migrations 001 to 006.** Those
  create the tables and the policies, and a database that has been in
  use has them. This is the command runtime's own half: functions, two
  seeds, and the two tables only it uses.
- **The order is not the numeric order.** 009 runs before 007, 016
  before 011, and 018 and 019 last. `order.txt` says why. Running them
  by filename leaves a database that looks migrated and refuses half the
  commands.

## 3. Prove it, before opening a browser

```
npx tsx scripts/rpc-contract-check.ts --sql
```

That prints a single read-only query listing every database function
this branch's runtime can call, with the argument names PostgREST
matches on and the role that has to be able to execute each one. Paste
it into the same SQL editor. Every row should say `ok`:

```
 command_perform            | ok
 command_project_sale       | ok
 ...
```

Anything else names its own problem: `MISSING` means the migration did
not run, `WRONG ARGUMENTS` means an older version of the function is
still there, `NOT GRANTED` means the grant at the bottom of that
migration did not run.

The list comes out of the code, not out of a list somebody maintains: it
is read from the store's own dispatch table, its projections, and every
`.rpc(` call in `lib/` and `app/`. A function added to the runtime
appears here without anybody remembering to add it.

## 4. Reload the schema cache

PostgREST caches the functions it will expose. Until it looks again, the
function exists and the API still says it does not. The bundle ends with
this, and it is worth running on its own if you applied migrations any
other way:

```sql
NOTIFY pgrst, 'reload schema';
```

## 5. Then the browser

With the same account you normally use, in the deployment you just
caught up:

```
schedule a call with Dawson next Friday
```

The bar should say it understood it and ask **What time?** Nothing is
written at this point. Answer `10am`. It replans the whole sentence,
shows a preview, and the meeting is created only after you confirm it.

Any customer whose name your account can see works in place of Dawson.
If the CRM has none, `create a new lead for Smith Logistics` first: that
is the same path and writes one row.

## What this repository can and cannot prove

It can prove, and does, on every run:

- that a database built from every migration in `order.txt` answers all
  36 functions the runtime calls, with the right argument names and
  grants (`npm run check:rpc`)
- that the same database carries out the sentences correctly, in real
  PostgreSQL, 276 assertions in `scripts/sql/validate-007.sql` and
  `npm run check:postgres`
- that a database which is BEHIND is brought up by the bundle: the same
  two checks were run against a database built to the state before
  migration 007, then caught up with `catch-up.sql`, and went from
  `command_perform` missing to 36/36 callable and 276 assertions passing

It cannot prove anything about a particular Supabase project. No
repository can: the project reference lives in a deployment's
environment, the keys live with whoever owns the account, and a check
that cannot reach the database is a check that says nothing about it.
The three steps above are what closes that gap, and they take a couple
of minutes.
