#!/usr/bin/env bash
# =============================================================
# The catch-up bundle, applied twice, to a database that is behind.
#
# `docs/deploying-the-command-runtime.md` tells somebody the file is
# safe to run more than once, and somebody running it against a database
# with real rows on it deserves better than being told. This is the
# telling, carried out:
#
#   1. build a database at the state BEFORE migration 007, which is what
#      a deployment answering "could not find the function
#      public.command_perform" actually looks like
#   2. apply the generated bundle
#   3. apply the byte for byte identical file again
#
# The second run has to finish with no error and no warning, and leave
# the two seeds at their own counts rather than doubled. A seed that
# grows on the second run is the failure this is looking for: it means
# the file adds rather than replaces, and a database somebody catches up
# twice ends up with a permission listed twice.
#
# Run as the postgres user, against the disposable server:
#
#   su postgres -c "bash scripts/sql/bundle-twice-check.sh"
#
# A DATABASE THAT IS ONLY A LITTLE BEHIND.
#
# `--since <migration>` is the other case, and the commoner one once a
# deployment is live: the database is level up to a known migration and
# the branch has added a few since. It builds the database TO that
# migration, then applies twice the bundle of everything after it. Same
# two runs, same rules.
#
#   su postgres -c "bash scripts/sql/bundle-twice-check.sh --since 039_rows_forward"
#
# `--with <migration>` is passed straight through to the bundler, for
# the capability seed that sits early in the order and is rewritten
# every time a capability is added. Rerunning it is the case this whole
# file exists to prove: the seed empties its table and refills it, so
# the count after the second run has to be the count after the first.
# =============================================================
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=/var/tmp/pgtest
cd "$(dirname "$0")/../.."

SINCE=""
WITH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE="${2:-}"; shift 2 ;;
    --with)  WITH="${2:-}";  shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
BUNDLE_ARGS=""
[ -n "$SINCE" ] && BUNDLE_ARGS="--since $SINCE"
[ -n "$WITH" ]  && BUNDLE_ARGS="$BUNDLE_ARGS --with $WITH"

DB=stcpreview
BUNDLE=/var/tmp/pgtest/catch-up-twice.sql
Q="psql -p 55432 -U postgres -d $DB -tAq"
FAILED=0

say() { printf '  %-6s %s\n' "$1" "$2"; }

# -------------------------------------------------------------
# 1. A database that is behind
#
# Same two passes over schema.sql and 001 to 006 as build-test-db.sh,
# and 009 in between for the policy that calls `is_list_member_safe`.
# Nothing from `order.txt`, so the command runtime is simply absent.
# -------------------------------------------------------------
psql -p 55432 -U postgres -q -c "DROP DATABASE IF EXISTS $DB" \
                             -c "CREATE DATABASE $DB" 2>/dev/null
P="psql -p 55432 -U postgres -d $DB -q"
$P -f scripts/sql/test-prelude.sql                          >/dev/null 2>&1
$P -f supabase/schema.sql                                   >/dev/null 2>&1
$P -f supabase/migrations/009_list_visibility_recursion.sql >/dev/null 2>&1
for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"    >/dev/null 2>&1; done
$P -f supabase/schema.sql                                   >/dev/null 2>&1
for m in supabase/migrations/00[1-6]*.sql; do $P -f "$m"    >/dev/null 2>&1; done

if [ -n "$SINCE" ]; then
  # Level up to and including $SINCE, which is where the live database is.
  while read -r name; do
    case "$name" in ''|\#*) continue ;; esac
    $P -v ON_ERROR_STOP=1 -f "supabase/migrations/${name}.sql" >/dev/null 2>&1 || {
      say FAIL "could not build the starting state: $name"; exit 1; }
    [ "$name" = "$SINCE" ] && break
  done < scripts/sql/order.txt

  # The starting database has to be level to $SINCE and no further.
  #
  # `crm_leads` arrives in 040 and is the marker, but whether it SHOULD
  # be there depends on where $SINCE sits in the order. Asserted as
  # absent outright, this line failed every time somebody bundled from a
  # migration later than 040, which is now most of them, and said the
  # starting database was wrong when the assertion was.
  WANT_LEADS=0
  while read -r name; do
    case "$name" in ''|\#*) continue ;; esac
    [ "$name" = "040_leads" ] && WANT_LEADS=1
    [ "$name" = "$SINCE" ] && break
  done < scripts/sql/order.txt

  LEADS=$($Q -c "SELECT count(*) FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'crm_leads'")
  if [ "$LEADS" = "$WANT_LEADS" ]; then
    say ok "behind: level to $SINCE, and no further"
  elif [ "$WANT_LEADS" = "0" ]; then
    say FAIL "the starting database is ahead of $SINCE: crm_leads is already there"; FAILED=1
  else
    say FAIL "the starting database is behind $SINCE: crm_leads should be there and is not"; FAILED=1
  fi

  ./scripts/sql/bundle-migrations.sh $BUNDLE_ARGS > "$BUNDLE" || exit 1
else
  HAS=$($Q -c "SELECT count(*) FROM pg_proc
                WHERE proname = 'command_perform'
                  AND pronamespace = 'public'::REGNAMESPACE")
  if [ "$HAS" = "0" ]; then
    say ok "behind: command_perform is absent, as a stale deployment has it"
  else
    say FAIL "the starting database already has command_perform"; FAILED=1
  fi

  ./scripts/sql/bundle-migrations.sh $BUNDLE_ARGS > "$BUNDLE" || exit 1
fi
say ok "bundle written, $(md5sum < "$BUNDLE" | cut -c1-12)"

# -------------------------------------------------------------
# 2 and 3. Once, then the same file again
# -------------------------------------------------------------
for run in 1 2; do
  OUT=/var/tmp/pgtest/twice-run$run.out
  psql -p 55432 -U postgres -d $DB -v ON_ERROR_STOP=1 -f "$BUNDLE" >"$OUT" 2>&1
  code=$?
  noise=$(grep -c 'ERROR\|FATAL\|WARNING' "$OUT")

  if [ "$code" = "0" ]; then say ok "run $run finished"
  else say FAIL "run $run exited $code"; grep -i error "$OUT" | head -5; FAILED=1; fi

  if [ "$noise" = "0" ]; then say ok "run $run raised nothing"
  else say FAIL "run $run raised $noise"; grep -in 'ERROR\|WARNING' "$OUT" | head -5; FAILED=1; fi

  cols=$($Q -c "SELECT count(*) FROM command_writable_columns")
  caps=$($Q -c "SELECT count(*) FROM command_capability_roles")
  perf=$($Q -c "SELECT count(*) FROM pg_proc
                 WHERE proname = 'command_perform'
                   AND pronamespace = 'public'::REGNAMESPACE")
  say "" "after run $run: $cols writable columns, $caps capability roles, command_perform $perf"

  if [ "$run" = "1" ]; then first="$cols/$caps"; else
    if [ "$cols/$caps" = "$first" ]; then
      say ok "the seeds replaced themselves rather than growing"
    else
      say FAIL "the seeds went from $first to $cols/$caps on the second run"; FAILED=1
    fi
  fi
  if [ "$perf" != "1" ]; then say FAIL "command_perform is not there after run $run"; FAILED=1; fi
done

# -------------------------------------------------------------
# And the database it leaves behind still answers
# -------------------------------------------------------------
psql -p 55432 -U postgres -d $DB -tAq -f scripts/sql/validate-007.sql \
  >/var/tmp/pgtest/twice-validate.out 2>&1
ok=$(grep -c 'NOTICE:  ok' /var/tmp/pgtest/twice-validate.out)
# A failed assertion is a WARNING, not a NOTICE. This counted NOTICEs,
# so it reported no failures whatever the file did, which is the same
# class of quiet pass the column checks were just built to stop.
bad=$(grep -c 'WARNING:  FAIL' /var/tmp/pgtest/twice-validate.out)
if [ "$bad" = "0" ] && [ "$ok" -gt 0 ]; then
  say ok "$ok assertions pass against the twice migrated database"
else
  say FAIL "$bad assertions fail against the twice migrated database"; FAILED=1
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "  The bundle is safe to run twice, which is what the deployment note says."
else
  echo "  It is not. Fix the migration, not the note."
fi
exit $FAILED
