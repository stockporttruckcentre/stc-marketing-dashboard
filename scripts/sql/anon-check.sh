#!/usr/bin/env bash
# What somebody with no session can read, which has to be nothing.
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building the test database failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/anon-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -A3 "ERROR" | head -20
  exit 1
fi
echo "$out" | grep 'NOTICE:' | sed 's/^.*NOTICE:  /  /'
echo "  anonymous holds nothing: the public key reads no rows in any table"
