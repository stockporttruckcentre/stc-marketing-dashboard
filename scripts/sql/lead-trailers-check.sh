#!/usr/bin/env bash
# A lead can quote more than one trailer.
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building the test database failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/lead-trailers-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -B2 -A2 "ERROR" | head -20
  exit 1
fi
echo "$out" | grep 'NOTICE:' | sed 's/^.*NOTICE:  /  /'
echo "  a quote holds its units, and the old column still names the first of them"
