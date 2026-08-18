#!/usr/bin/env bash
# =============================================================
# Every command runtime migration, in order, as one file.
#
# For catching a database up: a Supabase project whose SQL editor is the
# only way in, a staging database somebody has to bring level with a
# branch, a preview that answers every command with
#
#   Could not find the function public.command_perform(p_steps)
#   in the schema cache
#
# which means the code is ahead of the database it is pointed at.
#
# The order comes from `order.txt`, which is also what builds the
# disposable server every check runs against, so what gets pasted into
# an editor and what the checks prove are the same sequence.
#
# WHAT THIS DOES NOT INCLUDE.
#
# `schema.sql` and migrations 001 to 006. Those create tables and
# policies, and a database that has been live has them already. This is
# the command runtime's own half: functions, seeds and the two tables
# only it uses. Every statement in it is CREATE OR REPLACE, CREATE TABLE
# IF NOT EXISTS or an idempotent seed, so running the whole file against
# a database that is only part way through is the intended use.
#
#   ./scripts/sql/bundle-migrations.sh > /tmp/catch-up.sql
# =============================================================
set -u
cd "$(dirname "$0")/../.."

# -------------------------------------------------------------
# Two of these migrations open and close a transaction of their own,
# because each is also meant to be runnable on its own: the writable
# columns seed and the capability roles seed both empty a table and
# refill it, and neither wants to be interrupted half way.
#
# Concatenated, that inner COMMIT ends the OUTER transaction, and every
# migration after it runs one statement at a time. The file still
# succeeds, so nothing says so, and the guarantee on the tin quietly
# stops being true: a failure at migration 30 leaves 29 applied.
#
# So the boundaries come out here and the bundle's own BEGIN and COMMIT
# are the only ones. Nothing else about the migration changes, and the
# files themselves keep their boundaries for anybody running one alone.
#
# `BEGIN` also opens a block inside a PL/pgSQL body, which is why this
# counts dollar quote tags and only strips at the top level. It matches
# a line that is nothing but the keyword, so a `BEGIN` that starts a
# function body, which never carries a semicolon, is left where it is.
# -------------------------------------------------------------
STRIP_OWN_TRANSACTION='
{
  rest = $0; tags = 0;
  while (match(rest, /\$[A-Za-z_0-9]*\$/)) {
    tags++; rest = substr(rest, RSTART + RLENGTH);
  }
  if (inside == 0 && $0 ~ /^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;[[:space:]]*$/) {
    print "-- (bundled) " $0 " removed: this file is one transaction.";
  } else {
    print;
  }
  if (tags % 2 == 1) inside = 1 - inside;
}'

echo "-- The command runtime, as one file."
echo "-- Generated from scripts/sql/order.txt. Do not edit by hand."
echo "-- Safe to run more than once: every statement replaces or skips."
echo
echo "BEGIN;"
echo

while read -r name; do
  case "$name" in ''|\#*) continue ;; esac
  file="supabase/migrations/${name}.sql"
  if [ ! -f "$file" ]; then
    echo "-- MISSING: $file" >&2
    exit 1
  fi
  echo "-- ============================================================="
  echo "-- $file"
  echo "-- ============================================================="
  awk "$STRIP_OWN_TRANSACTION" "$file"
  echo
done < scripts/sql/order.txt

echo "COMMIT;"
echo
echo "-- PostgREST caches the schema. Without this the functions exist"
echo "-- and the API still says they do not."
echo "NOTIFY pgrst, 'reload schema';"
