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
#
# A DATABASE THAT IS ONLY A LITTLE BEHIND.
#
# `--since <migration>` bundles only what comes AFTER that one in
# `order.txt`, for a database known to be level up to it. The whole file
# is always safe to run, so this is a convenience for whoever has to
# paste it, not a different guarantee: the same one transaction, the
# same replaces or skips.
#
#   ./scripts/sql/bundle-migrations.sh --since 039_rows_forward
#
# A SEED THAT SITS EARLY IN THE ORDER AND KEEPS CHANGING.
#
# `--with <migration>` puts one migration at the front of the bundle
# whatever `--since` says. It exists for `016_capability_roles_seed`,
# which is generated from `lib/crm/permissions.ts` and is rewritten
# every time a capability is added, but which sits at position five in
# `order.txt` because a fresh install needs it before 011.
#
# Without this, a `--since` bundle covering a branch that added a
# capability is a bundle that quietly leaves it out, and the feature it
# belongs to answers every read with nothing. Rerunning that seed is
# safe by construction: it empties the table and refills it.
#
#   ./scripts/sql/bundle-migrations.sh --since 058_work_workflow \
#     --with 016_capability_roles_seed
# =============================================================
set -u
cd "$(dirname "$0")/../.."

SINCE=""
WITH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since|--with)
      flag="$1"
      name="${2:-}"
      if [ -z "$name" ]; then
        echo "$flag needs the name of a migration in order.txt" >&2
        exit 1
      fi
      if ! grep -qx "$name" scripts/sql/order.txt; then
        echo "no migration called $name in scripts/sql/order.txt" >&2
        exit 1
      fi
      if [ "$flag" = "--since" ]; then SINCE="$name"; else WITH="$name"; fi
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

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

emit() {
  file="supabase/migrations/${1}.sql"
  if [ ! -f "$file" ]; then
    echo "-- MISSING: $file" >&2
    exit 1
  fi
  echo "-- ============================================================="
  echo "-- $file"
  echo "-- ============================================================="
  awk "$STRIP_OWN_TRANSACTION" "$file"
  echo
}

if [ -n "$SINCE" ]; then
  echo "-- The command runtime, everything after ${SINCE}, as one file."
else
  echo "-- The command runtime, as one file."
fi
[ -n "$WITH" ] && echo "-- Plus ${WITH}, which is a seed and is rerun on purpose."
echo "-- Generated from scripts/sql/order.txt. Do not edit by hand."
echo "-- Safe to run more than once: every statement replaces or skips."
echo
echo "BEGIN;"
echo

# The named seed first, so anything after it that reads the seed sees
# the new rows rather than the ones it is replacing.
[ -n "$WITH" ] && emit "$WITH"

# Everything before and including --since is skipped, in file order.
skipping=0
[ -n "$SINCE" ] && skipping=1

while read -r name; do
  case "$name" in ''|\#*) continue ;; esac
  if [ "$skipping" = "1" ]; then
    if [ "$name" = "$SINCE" ]; then skipping=0; fi
    continue
  fi
  # Not twice, where --with named something that comes after --since.
  [ "$name" = "$WITH" ] && continue
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
