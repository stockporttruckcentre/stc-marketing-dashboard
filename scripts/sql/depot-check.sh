#!/usr/bin/env bash
# Which depots a deal is for, and reading the pipeline by depot. See depot-check.sql.
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building stctest failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/depot-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -B2 -A4 "ERROR" | head -20
  exit 1
fi
echo "  a deal names its depots, an id not on the register is refused whole, and a deal at two depots counts under both"
