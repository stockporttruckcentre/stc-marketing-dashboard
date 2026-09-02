#!/usr/bin/env bash
# The seven figures somebody has to be able to defend in front of an MD:
# which deals, who is selling, what is coming, who is growing and who is
# going, how exposed we are, how old the open work is, and why the
# customers do not add up to the total.
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building the test database failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/finance-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -B2 -A2 "ERROR" | head -40
  exit 1
fi
echo "$out" | grep 'NOTICE:' | sed 's/^.*NOTICE:  /  /'
echo "  every figure adds up to the one above it, and none of it answers a stranger"
