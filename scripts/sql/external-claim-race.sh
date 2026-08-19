#!/usr/bin/env bash
# =============================================================
# Twenty simultaneous confirmations of the same paid lookup.
#
# Migration 027 said an external attempt is spent at most once per
# confirmation and did not establish it. The read and the insert were
# two statements, so two callers could both see nothing, both insert
# (one of them writing nothing), and both be told `pending`, which meant
# "go and call the provider". Two credits for one answer.
#
# A single connection cannot show that. Twenty can.
#
# Every session claims the SAME key at the same moment. Exactly one must
# be told `claimed`. Every other must be told `in_progress`, and
# `in_progress` never permits a provider call.
#
#   ./scripts/sql/external-claim-race.sh
#
# Exits non zero unless exactly one claim is granted, and unless every
# other session is told something that forbids calling the provider.
#
# The equivalent test against the runtime rather than the SQL, with a
# fake provider whose call count is asserted, is section 40 of
# `scripts/command-acceptance-check.ts`.
# =============================================================
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=/var/tmp/pgtest
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

P="psql -p 55432 -U postgres -d stctest -q -t -A"

ACTOR='aaaaaaaa-0000-0000-0000-000000000001'
KEY="race-$(date +%s)-$$"
RUNNERS=20

$P >/dev/null 2>&1 <<SQL
INSERT INTO auth.users (id, email) VALUES ('$ACTOR', 'racer@test.local')
ON CONFLICT DO NOTHING;
DELETE FROM command_external_attempts WHERE key LIKE 'race-%';
SQL

# Every session waits on the same advisory lock before claiming, so they
# are released together rather than arriving in a queue. Without this
# they simply run in sequence and the check proves nothing.
$P -c "SELECT pg_advisory_lock(918273645)" >/dev/null 2>&1 &
GATE=$!
wait $GATE 2>/dev/null || true

for i in $(seq 1 $RUNNERS); do
  (
    $P -o "$WORK/out.$i" <<SQL 2>"$WORK/err.$i"
SELECT pg_advisory_lock_shared(918273645);
SELECT command_external_claim('$KEY', 'contact.enrich', NULL, 'email', '$ACTOR') ->> 'state';
SQL
  ) &
done

# Release them all at once.
$P -c "SELECT pg_advisory_unlock(918273645)" >/dev/null 2>&1
wait

claimed=0
forbidden=0
other=0
for i in $(seq 1 $RUNNERS); do
  state=$(tr -d '[:space:]' < "$WORK/out.$i" 2>/dev/null | tail -c 32)
  case "$state" in
    *claimed*)                     claimed=$((claimed + 1)) ;;
    *in_progress*|*done*|*failed*|*uncertain*) forbidden=$((forbidden + 1)) ;;
    *)                             other=$((other + 1)); echo "  session $i said: '$state'" ;;
  esac
done

echo "  $RUNNERS simultaneous claims: granted $claimed, told to stand off $forbidden, unreadable $other"

rc=0
if [ "$claimed" != "1" ]; then
  echo "  FAIL  exactly one session must be allowed to call the provider (got $claimed)"
  rc=1
else
  echo "  ok    exactly one session was allowed to call the provider"
fi

if [ "$forbidden" != "$((RUNNERS - 1))" ]; then
  echo "  FAIL  every other session must be forbidden (got $forbidden of $((RUNNERS - 1)))"
  rc=1
else
  echo "  ok    every other session was forbidden"
fi

rows=$($P -c "SELECT COUNT(*) FROM command_external_attempts WHERE key = '$KEY'")
if [ "$rows" != "1" ]; then
  echo "  FAIL  the ledger must hold exactly one attempt for that key (got $rows)"
  rc=1
else
  echo "  ok    the ledger holds exactly one attempt for that key"
fi

# And the loser count is on the row, so a caller coming back repeatedly
# is visible rather than silent.
seen=$($P -c "SELECT seen FROM command_external_attempts WHERE key = '$KEY'")
if [ "$seen" != "$((RUNNERS - 1))" ]; then
  echo "  FAIL  the attempt should record $((RUNNERS - 1)) other callers (got $seen)"
  rc=1
else
  echo "  ok    the attempt records every other caller that looked"
fi

$P >/dev/null 2>&1 -c "DELETE FROM command_external_attempts WHERE key = '$KEY'"
exit $rc
