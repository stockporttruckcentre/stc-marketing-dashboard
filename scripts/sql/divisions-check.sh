#!/usr/bin/env bash
# Three divisions side by side: the same year, the same cut, and no figure
# quietly meaning something different in one column from another.
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building the test database failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/divisions-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -B2 -A2 "ERROR" | head -40
  exit 1
fi
echo "$out" | grep 'NOTICE:' | sed 's/^.*NOTICE:  /  /'
echo "  the three columns hold: one year, one cut, and none of them borrows another's money"
