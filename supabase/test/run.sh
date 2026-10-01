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

# The app's database types are generated from this schema, read here before any
# test has added anything to it, and must match the committed file. Set
# BJT_TYPEGEN_WRITE=1 to rewrite client/src/lib/database.types.ts instead.
if [[ -n "${BJT_TYPEGEN_WRITE:-}" ]]; then
    python3 "$ROOT/supabase/typegen.py" --db "$DB"
else
    echo "checking client/src/lib/database.types.ts against the schema"
    python3 "$ROOT/supabase/typegen.py" --db "$DB" --check
fi

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

# The role the Worker logs in as, and proof it can become a signed-in client
# and nothing else.
psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$ROOT/supabase/worker_role.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$HERE/30_worker_role_test.sql"

# Finally, check the app and the schema still agree: every query the Worker
# serves the app is run, as a tester, against this database. TypeScript cannot
# catch a column name that is merely asserted; this can, and it also catches a
# write the signed-in role may not make and a policy that hides the wrong rows.
if [[ -d "$ROOT/client/worker" ]]; then
    if [[ ! -d "$ROOT/client/node_modules" ]]; then
        echo "client/node_modules is missing: run 'npm ci' in client/ first (the Worker's queries are run from there)" >&2
        exit 1
    fi
    echo "running every Worker query against the schema"
    (cd "$ROOT/client" && BJT_WORKER_DB_TEST=1 BJT_TEST_DB="$DB" npx vitest run --config worker/vitest.db.config.ts)
fi
