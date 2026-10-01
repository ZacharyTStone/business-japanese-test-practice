/**
 * One request, one transaction, as the signed-in learner.
 *
 * The Worker connects as `bjt_worker`, a role that owns nothing and can do
 * nothing on its own (`noinherit`; see supabase/worker_role.sql). Each request
 * becomes `authenticated` for one transaction and carries the caller's claims
 * the way PostgREST did, so row-level security, the column grants, the
 * triggers that grade an answer and the daily ceiling all decide exactly what
 * they decided before. A query that forgot the role would be refused, not
 * served with more than it should see.
 *
 * Everything is `set local`: Hyperdrive pools connections per transaction and
 * resets them when one ends, so nothing set here outlives the request.
 *
 * Results are made into JSON by Postgres, not by the driver, so a number, a
 * date and a timestamp arrive in the shape PostgREST gave them and the app's
 * types keep meaning what they said (a `date` stays "2026-11-10"; a driver
 * would make it a JavaScript Date at local midnight).
 *
 * Runtime-agnostic: it takes a postgres.js client, so the tests run the same
 * code against run.sh's throwaway Postgres in Node.
 */
import type { PendingQuery, Row, Sql, TransactionSql } from "postgres";

export type Tx = TransactionSql;

export async function asCaller<T>(sql: Sql, claims: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  const out = await sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated; set local time zone 'UTC'");
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    return run(tx);
  });
  return out as T;
}

/** Every row of a query, as a JSON array — `[]` when there are none. A CTE
 *  rather than a subquery, as PostgREST does it, so an `insert … returning`
 *  can be read back the same way as a `select`. */
export async function rows<T = Record<string, unknown>>(tx: Tx, query: PendingQuery<Row[]>): Promise<T[]> {
  const [r] = await tx`with q as (${query}) select coalesce(json_agg(q), '[]'::json) as v from q`;
  return (r?.v ?? []) as T[];
}

/** At most one row, or null. More than one is an error, as PostgREST's
 *  `maybeSingle()` made it: a query meant to find one row that found two is a
 *  bug worth hearing about. */
export async function maybeOne<T = Record<string, unknown>>(tx: Tx, query: PendingQuery<Row[]>): Promise<T | null> {
  const found = await rows<T>(tx, query);
  if (found.length > 1) throw apiError("PGRST116", "JSON object requested, multiple rows returned");
  return found[0] ?? null;
}

/** Exactly one row, as PostgREST's `single()`. */
export async function one<T = Record<string, unknown>>(tx: Tx, query: PendingQuery<Row[]>): Promise<T> {
  const found = await maybeOne<T>(tx, query);
  if (found === null) throw apiError("PGRST116", "JSON object requested, no rows returned");
  return found;
}

/** The error the app reads: the shape supabase-js gave it — `code`, `message`,
 *  `details`, `hint` — so `errorText` and `errorKind` in the app keep working
 *  unchanged, and a Postgres code such as `daily_limit_reached`'s hint still
 *  arrives where the screens look for it. */
export type ApiError = { code: string; message: string; details: string | null; hint: string | null };

export class ApiFailure extends Error {
  constructor(readonly error: ApiError, readonly status = 400) {
    super(error.message);
  }
}

export function apiError(code: string, message: string, status = 400): ApiFailure {
  return new ApiFailure({ code, message, details: null, hint: null }, status);
}

/** A thrown error, as the app should see it. A Postgres error keeps its code,
 *  detail and hint; anything else is a 500 with its message and nothing more. */
export function toApiError(e: unknown): { status: number; error: ApiError } {
  if (e instanceof ApiFailure) return { status: e.status, error: e.error };
  if (e && typeof e === "object" && (e as { name?: unknown }).name === "PostgresError") {
    const pg = e as { code?: string; message?: string; detail?: string; hint?: string };
    return {
      status: 400,
      error: {
        code: pg.code ?? "",
        message: pg.message ?? "database error",
        details: pg.detail ?? null,
        hint: pg.hint ?? null,
      },
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: 500, error: { code: "worker_error", message, details: null, hint: null } };
}
