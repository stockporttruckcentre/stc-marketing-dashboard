#!/usr/bin/env bash
# =============================================================
# The readback, told to look at a database that IS behind.
#
# `whats-applied.sql` is what somebody runs after pasting a catch-up
# file, to see whether it landed. A readback that answers "yes" to
# everything is worth nothing: it looks the same whether the migrations
# ran or whether the question is broken.
#
# The old version of that file was broken in exactly that direction. It
# stopped at 054, so a database missing 074 was told it had everything
# it needed, and the Admin requests screen answered
#
#   Could not find the function public.access_requests_waiting
#   without parameters in the schema cache
#
# with no way to find out why. One row of it was also broken in the
# other direction: it looked for a table called `opportunities`, which
# has never existed in this repository, so it said NO on a fully
# migrated database and sent whoever read it to run a file they did not
# need.
#
# So this builds two databases and asserts BOTH answers.
#
#   1. level to the end of order.txt          every row says yes
#   2. level to a chosen migration and no more  every row after it says
#                                               NO, and every row up to
#                                               and including it says yes
#
# Run as the postgres user, against the disposable server:
#
#   su postgres -c "bash scripts/sql/whats-applied-check.sh"
#
# The migration the second database stops at, and which rows of the
# readback that means should be missing. Kept here rather than derived,
# because deriving it from the same order.txt the readback is built from
# would make the check agree with a wrong file.
# =============================================================
set -u
cd "$(dirname "$0")/../.."
export PGHOST=/var/tmp/pgtest

STOP_AT=073_the_permission_hub
# Every "Migration" cell that must say NO on the database that stops there.
MISSING="074 075 076 077 078 079 080 081 082 083 084 085 086 087 088 089 090 091 092 093 094"

FAILED=0
say() { printf '  %-6s %s\n' "$1" "$2"; }

build() {           # build <dbname> [stop-after-migration]
  local db=$1 stop=${2:-}
  psql -p 55432 -U postgres -q -c "DROP DATABASE IF EXISTS $db" \
                               -c "CREATE DATABASE $db" 2>/dev/null
  local P="psql -p 55432 -U postgres -d $db -q"
  $P -f scripts/sql/test-prelude.sql                          >/dev/null 2>&1
  $P -f supabase/schema.sql                                   >/dev/null 2>&1
  $P -f supabase/migrations/009_list_visibility_recursion.sql >/dev/null 2>&1
  for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"    >/dev/null 2>&1; done
  $P -f supabase/schema.sql                                   >/dev/null 2>&1
  for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"    >/dev/null 2>&1; done
  while read -r name; do
    case "$name" in ''|\#*) continue ;; esac
    $P -v ON_ERROR_STOP=1 -f "supabase/migrations/${name}.sql" >/dev/null 2>&1 || {
      say FAIL "could not apply $name to $db"; exit 1; }
    [ -n "$stop" ] && [ "$name" = "$stop" ] && break
  done < scripts/sql/order.txt
}

# `migration|yes-or-NO`, one line per row of the readback.
verdicts() {
  psql -p 55432 -U postgres -d "$1" -tAqF'|' -f scripts/sql/whats-applied.sql 2>/dev/null \
    | awk -F'|' 'NF>=3 { gsub(/^ +| +$/, "", $1); gsub(/^ +| +$/, "", $3); print $1 "|" $3 }'
}

echo
echo "  The readback, against a database that has everything"
echo "  ---------------------------------------------------"

build stcapplied
LEVEL=$(verdicts stcapplied)
ROWS=$(printf '%s\n' "$LEVEL" | grep -c '|')
NOES=$(printf '%s\n' "$LEVEL" | grep '|NO$' | cut -d'|' -f1 | tr '\n' ' ')

if [ "$ROWS" -lt 50 ]; then
  say FAIL "only $ROWS rows: the readback stops short of the migrations we have"
  FAILED=1
else
  say ok "$ROWS rows, one per migration"
fi

if [ -n "$NOES" ]; then
  say FAIL "said NO on a fully migrated database: $NOES"
  FAILED=1
else
  say ok "every row says yes, so no row is asking a question that cannot be answered"
fi

echo
echo "  The same readback, against a database level only to $STOP_AT"
echo "  ------------------------------------------------------------------------"

build stcbehind "$STOP_AT"
BEHIND=$(verdicts stcbehind)

# THE READBACK HAS TO RUN AT ALL ON A DATABASE THAT IS BEHIND.
#
# It is the only database it will ever be run on that matters, and it is
# the one most likely to break it: half the tables the markers name do
# not exist there yet. Naming one directly makes the whole statement
# fail to PARSE, and an empty result then reads as "every migration is
# missing", which passed the two checks below without either of them
# noticing. That is exactly what happened when a row was added for 093.
BROWS=$(printf '%s\n' "$BEHIND" | grep -c '|')
if [ "$BROWS" != "$ROWS" ]; then
  say FAIL "the readback returned $BROWS rows against a database that is behind, and $ROWS against one that is not"
  say ""    "an empty result is not 'everything is missing', it is a readback that did not run"
  FAILED=1
else
  say ok "it runs against a database that is behind, and returns every row"
fi

for m in $MISSING; do
  ANS=$(printf '%s\n' "$BEHIND" | awk -F'|' -v m="$m" '$1 == m { print $2 }')
  if [ -z "$ANS" ]; then
    say FAIL "$m is not a row of the readback at all"
    FAILED=1
  elif [ "$ANS" != "NO" ]; then
    say FAIL "$m says '$ANS' on a database that does not have it"
    FAILED=1
  fi
done
[ "$FAILED" = 0 ] && say ok "every missing migration says NO, 074 among them"

# And the other direction: nothing already applied is reported missing.
WRONG=$(printf '%s\n' "$BEHIND" | grep '|NO$' | cut -d'|' -f1 \
        | grep -vxF -f <(printf '%s\n' $MISSING) | tr '\n' ' ')
if [ -n "$WRONG" ]; then
  say FAIL "reported missing but actually applied: $WRONG"
  FAILED=1
else
  say ok "nothing that IS applied is reported missing"
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "  The readback tells a database that is behind from one that is not."
  echo
  exit 0
fi
echo "  It does not. A readback that cannot see a gap is worse than none."
echo
exit 1
