#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres and assert the schema does what
# it claims. No Supabase project, no network, no keys.
#
#   supabase/test/run.sh
#
# Needs a Postgres 15+ server reachable with psql. Point it at one with the usual
# PG* variables, or let the script start its own:
#
#   PGHOST=... PGUSER=... supabase/test/run.sh     # use an existing server
#   supabase/test/run.sh                           # start a temporary cluster
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DB="${BJT_TEST_DB:-bjt_schema_test}"

if [[ -z "${PGHOST:-}" ]]; then
    # A socket directory has a ~107 byte limit, so keep this path short.
    PGDIR="${BJT_TEST_PGDIR:-/tmp/bjtpg}"
    BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
    [[ -n "$BIN" ]] || { echo "no postgres server binaries found; set PGHOST to use an existing server" >&2; exit 1; }

    rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run"
    RUNAS=""
    if [[ "$(id -u)" == "0" ]]; then
        id pg >/dev/null 2>&1 || useradd -m pg
        chown -R pg "$PGDIR"
        RUNAS="pg"
    fi
    run() { if [[ -n "$RUNAS" ]]; then su "$RUNAS" -c "$*"; else eval "$*"; fi; }

    run "$BIN/initdb -D $PGDIR/data -U postgres -A trust" >/dev/null
    run "$BIN/pg_ctl -D $PGDIR/data -o \"-k $PGDIR/run -h ''\" -l $PGDIR/pg.log start" >/dev/null
    trap 'run "$BIN/pg_ctl -D $PGDIR/data -m immediate stop" >/dev/null 2>&1 || true' EXIT

    export PGHOST="$PGDIR/run" PGUSER=postgres
fi

psql -q -d postgres -c "drop database if exists $DB;" >/dev/null
psql -q -d postgres -c "create database $DB;" >/dev/null

psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "create schema test; grant usage on schema test to public;" >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$HERE/00_stub.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "applying $(basename "$f")"
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null
done

psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$HERE/10_schema_test.sql"

# Then prove the publisher: apply every generated bundle SQL twice (idempotency
# is the whole claim) and check the content the way the app will read it.
shopt -s nullglob
for f in "$ROOT"/batches/*.sql; do
    echo "publishing $(basename "$f") (twice)"
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null
done

psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$HERE/20_published_test.sql"
