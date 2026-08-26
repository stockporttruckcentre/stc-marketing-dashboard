#!/usr/bin/env bash
# =============================================================
# A disposable PostgreSQL with this repository's schema on it.
#
# Rebuilt from nothing every time, because a database that has been
# migrated in place is a database whose state nobody can describe.
#
# Two passes over schema.sql and migrations 001 to 006, because they are
# written to be applied incrementally to a live database rather than to
# an empty one, and 009 in between because schema.sql calls
# `is_list_member_safe` in a policy and will not create that policy until
# the function exists. 009 runs again at the end because the second pass
# of schema.sql recreates `crm_select` in its recursive form.
#
# The order of the command runtime's own migrations is `order.txt`, one
# list, so the database the checks run against and the file somebody
# pastes into a Supabase SQL editor cannot drift apart.
#
# `test-legacy-rows.sql` goes in between, and is the reason a migration
# is now proved against a database with rows in it rather than an empty
# one. Read its header before removing it.
# =============================================================
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=/var/tmp/pgtest
P="psql -p 55432 -U postgres -d stctest -q"

psql -p 55432 -U postgres -q -c "DROP DATABASE IF EXISTS stctest" -c "CREATE DATABASE stctest" 2>/dev/null

$P -f scripts/sql/test-prelude.sql                                  >/dev/null 2>&1
$P -f supabase/schema.sql                                           >/dev/null 2>&1
$P -f supabase/migrations/009_list_visibility_recursion.sql         >/dev/null 2>&1
for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"            >/dev/null 2>&1; done
$P -f supabase/schema.sql                                           >/dev/null 2>&1
for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"            >/dev/null 2>&1; done

# Rows that are already there, before anything under test runs. A
# migration applied to an empty table is a migration nobody has proved.
# See the header of the file for the one that got through without this.
$P -v ON_ERROR_STOP=1 -f scripts/sql/test-legacy-rows.sql >/dev/null || {
  echo "  the legacy fixture failed"; exit 1; }

while read -r m; do
  case "$m" in ''|\#*) continue ;; esac
  $P -v ON_ERROR_STOP=1 -f "supabase/migrations/$m.sql" >/dev/null || {
    echo "  $m failed"; exit 1; }
done < scripts/sql/order.txt
echo "  stctest built"
