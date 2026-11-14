#!/usr/bin/env bash
# Прогон тестов прав на локальном Postgres без Supabase CLI.
# Использование: PGHOST=/tmp PGPORT=5433 PGUSER=postgres ./scripts/local-test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-rassvet_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/local-test/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
for t in supabase/tests/*.sql; do
  echo "== $t"
  psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$t" | tee /tmp/rassvet_tap.out
  if grep -q '^not ok' /tmp/rassvet_tap.out || grep -q 'Looks like' /tmp/rassvet_tap.out; then exit 1; fi
done
echo "ALL TESTS PASSED"
