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
psql -p 55432 -U postgres -c "DROP DATABASE IF EXISTS stctest" -c "CREATE DATABASE stctest"
psql -p 55432 -U postgres -d stctest -f scripts/sql/test-prelude.sql

# Twice, because schema.sql and migrations 001 to 006 are written to be
# applied incrementally to a live database rather than to an empty one.
for pass in 1 2; do
  psql -p 55432 -U postgres -d stctest -f supabase/schema.sql
  for m in supabase/migrations/00[1-6]*.sql; do psql -p 55432 -U postgres -d stctest -f "$m"; done
done

psql -p 55432 -U postgres -d stctest -f scripts/sql/test-prelude.sql
psql -p 55432 -U postgres -d stctest -v ON_ERROR_STOP=1 -f supabase/migrations/007_command_apply.sql
psql -p 55432 -U postgres -d stctest -v ON_ERROR_STOP=1 -f supabase/migrations/008_writable_columns_seed.sql

psql -p 55432 -U postgres -d stctest -f scripts/sql/validate-007.sql 2>&1 \
  | grep -oE "(ok|FAIL) +[a-z].*"
```

37 assertions. Any `FAIL` is a failure.

## What the prelude is, and what it is not

`test-prelude.sql` is the smallest set of roles, schemas and functions this
project's SQL references, so the real schema can be applied locally: the `auth`
and `storage` schemas, `auth.uid()` and `auth.role()` reading session settings
so a test can say who it is, and two things worth naming.

**`is_list_member_safe` is defined in the prelude and nowhere in this
repository.** `migrations/001_dashboard.sql` says so in its own header:
schema.sql calls it, so a fresh run of schema.sql fails partway. The live
database must have it. It has to be `SECURITY DEFINER`, and the prelude's
version is.

**Row level security on `crm_list_members` is switched off in the test database
only.** The `crm_select` policy on `crm_contacts` inlines
`EXISTS (SELECT 1 FROM crm_list_members ...)` rather than calling
`is_list_member_safe`, and that consults `members_all`, which consults
`crm_lists`, whose `lists_select` consults `crm_list_members` again. Postgres
stops with "infinite recursion detected in policy". The policies that read
notes avoid this by calling the helper; the one on contacts does not. That is a
property of the repository's SQL, reported rather than fixed here, because
changing a live security policy is not a change to make as a side effect of
building a test harness.

## Tearing it down

```bash
su postgres -s /bin/bash -c "PATH=$PATH pg_ctl -D $PGDATA stop"
rm -rf /var/tmp/pgtest
```
