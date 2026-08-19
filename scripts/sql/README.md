# Running migrations 007 and 008 against real PostgreSQL

The mutation checks in `scripts/mutation-apply-check.ts` run against a fake
that behaves the way PostgREST is expected to behave. That proves the executor
sends the right call. It proves nothing about whether the SQL works, so
migration 007 is validated separately against a real server.

## What it needs

Postgres 16 server binaries. On this image they are at
`/usr/lib/postgresql/16/bin` and are not on `PATH`. No Docker image and no
remote database are required.

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGDATA=/var/tmp/pgtest/data
export PGHOST=/var/tmp/pgtest

rm -rf /var/tmp/pgtest && mkdir -p "$PGDATA"
chown -R postgres:postgres /var/tmp/pgtest && chmod 700 "$PGDATA"

su postgres -s /bin/bash -c "PATH=$PATH initdb -D $PGDATA -U postgres --auth=trust"
su postgres -s /bin/bash -c "PATH=$PATH pg_ctl -D $PGDATA \
  -o '-p 55432 -k /var/tmp/pgtest' -l /var/tmp/pgtest/log start"
```

## Building the database

```bash
./scripts/sql/build-test-db.sh
```

Two passes over `schema.sql` and migrations 001 to 006, because they are
written to be applied incrementally to a live database rather than to an empty
one, and `009` in between because `schema.sql` calls `is_list_member_safe` in a
policy and will not create that policy until the function exists. `009` runs
again at the end because the second pass of `schema.sql` recreates `crm_select`
in its recursive form.

## Running the assertions

```bash
psql -p 55432 -U postgres -d stctest -f scripts/sql/validate-007.sql 2>&1 \
  | grep -oE "(ok|FAIL) +[a-z].*"
```

48 assertions. Any `FAIL` is a failure. Rebuild before every run: a database
that has already been asserted against is a database whose state nobody can
describe, and two of the assertions here passed for the wrong reason on a
second run before that was true.

## What the prelude is, and what it is not

`test-prelude.sql` is the smallest set of roles, schemas and functions this
project's SQL references, so the real schema can be applied locally: the `auth`
and `storage` schemas, `auth.uid()` and `auth.role()` reading session settings
so a test can say who it is, and stub tables for `auth.users`,
`storage.buckets` and `storage.objects`.

`auth.users` carries `email` and `raw_user_meta_data` because the project's own
`handle_new_user` trigger reads them. A stub with only an id makes every insert
fail inside that trigger, which is a fact about the stub and not about the
project.

**It carries no test-only security changes.** It used to carry two, and both
were there because the repository's list visibility policies could not be
evaluated at all:

- a copy of `is_list_member_safe`, which `schema.sql` calls and nothing in the
  repository defined
- `ALTER TABLE crm_list_members DISABLE ROW LEVEL SECURITY`, because
  `crm_select` consulted `crm_lists`, whose `lists_select` consulted
  `crm_list_members`, whose `members_all` consulted `crm_lists`, and Postgres
  stopped with `infinite recursion detected in policy for relation
  "crm_list_members"`

`migrations/009_list_visibility_recursion.sql` fixes both, so the assertions
run against the policies this repository actually contains. The four visibility
rules it preserves are asserted directly: no list, the global list, a list you
own, a list you were added to, and the one you were not.

## Tearing it down

```bash
su postgres -s /bin/bash -c "PATH=$PATH pg_ctl -D $PGDATA stop"
rm -rf /var/tmp/pgtest
```
