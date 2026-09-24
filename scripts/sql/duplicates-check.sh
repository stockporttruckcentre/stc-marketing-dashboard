#!/usr/bin/env bash
# One record per company. See duplicates-check.sql.
set -u
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/var/tmp/pgtest}

if ! psql -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "  no test server on port 55432."
  echo "  start one:  see scripts/sql/README.md"
  exit 1
fi

bash scripts/sql/build-test-db.sh >/dev/null 2>&1 || { echo "  building stctest failed"; exit 1; }

out=$(psql -p 55432 -U postgres -d stctest -q -f scripts/sql/duplicates-check.sql 2>&1)
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -B2 -A6 "ERROR" | head -40
  exit 1
fi
echo "$out" | grep -E '^ *[a-z].*\|' || true
echo "  one record per company: the folds, the pairs, the ladder, the refusal, the gate, the import and the allocation"
