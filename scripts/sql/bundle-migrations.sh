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
  cat "$file"
  echo
done < scripts/sql/order.txt

echo "COMMIT;"
echo
echo "-- PostgREST caches the schema. Without this the functions exist"
echo "-- and the API still says they do not."
echo "NOTIFY pgrst, 'reload schema';"
