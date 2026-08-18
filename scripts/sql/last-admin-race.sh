#!/usr/bin/env bash
# =============================================================
# Two administrators demoting themselves at the same moment.
#
# The check that used to live only inside `command_set_role` counted the
# administrators and then wrote. Two transactions doing that at once
# both count two, both see one left over, and both commit: nobody can
# administer the database afterwards and nothing in this application can
# put it back. A single connection cannot show that. Two can.
#
# Both sessions open a transaction, both demote themselves, and neither
# commits until the other has started. Under migration 019 the second
# one queues on the advisory lock, recounts once the first has
# committed, and raises.
#
#   ./scripts/sql/last-admin-race.sh
#
# Exits non zero if both succeed, if both fail, or if the number of
# administrators left is not exactly one.
# =============================================================
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=/var/tmp/pgtest
P="psql -p 55432 -U postgres -d stctest -q -t -A"

A='eeeeeeee-0000-0000-0000-00000000000a'
B='eeeeeeee-0000-0000-0000-00000000000b'

$P >/dev/null 2>&1 <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('$A', 'racea@test.local'), ('$B', 'raceb@test.local')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin' WHERE id IN ('$A', '$B');
UPDATE profiles SET role = 'sales'
 WHERE role = 'admin' AND id NOT IN ('$A', '$B');
SQL

left=$($P -c "SELECT COUNT(*) FROM profiles WHERE role = 'admin'")
if [ "$left" != "2" ]; then
  echo "  FAIL  the fixture did not leave exactly two administrators (got $left)"
  exit 1
fi

# Two overlapping transactions. Each holds its write open long enough
# for the other to have started, so they genuinely race.
race() {
  $P >/tmp/race.$1.out 2>&1 <<SQL
BEGIN;
SELECT pg_sleep(0.3);
UPDATE profiles SET role = 'viewer' WHERE id = '$2';
SELECT pg_sleep(0.5);
COMMIT;
SQL
  echo $? > /tmp/race.$1.code
}

race a "$A" &
race b "$B" &
wait

a_code=$(cat /tmp/race.a.code)
b_code=$(cat /tmp/race.b.code)
left=$($P -c "SELECT COUNT(*) FROM profiles WHERE role = 'admin'")

failed_a=$(grep -c 'only administrator' /tmp/race.a.out || true)
failed_b=$(grep -c 'only administrator' /tmp/race.b.out || true)
refused=$((failed_a + failed_b))

echo "  session A exit $a_code, session B exit $b_code, refusals $refused, administrators left $left"

status=0
if [ "$refused" != "1" ]; then
  echo "  FAIL  exactly one of them should have been refused"
  cat /tmp/race.a.out /tmp/race.b.out
  status=1
else
  echo "  ok    exactly one of two simultaneous demotions was refused"
fi
if [ "$left" != "1" ]; then
  echo "  FAIL  expected one administrator left, found $left"
  status=1
else
  echo "  ok    exactly one administrator remains"
fi

$P >/dev/null 2>&1 <<SQL
UPDATE profiles SET role = 'admin' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM profiles WHERE id IN ('$A', '$B');
DELETE FROM auth.users WHERE id IN ('$A', '$B');
SQL

exit $status
