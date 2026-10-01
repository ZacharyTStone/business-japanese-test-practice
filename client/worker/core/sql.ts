/**
 * The few things every query here does with D1, written once.
 *
 * D1 returns SQLite's values: booleans as 0/1 and JSON as text. The app was
 * built against Postgres's JSON, where those were true/false and nested
 * values, so each reader below says which columns to turn back, and the
 * screens keep the types they have.
 */

export type Db = D1Database;
export type Param = string | number | boolean | null;

export function stmt(db: Db, sql: string, ...params: (Param | undefined)[]): D1PreparedStatement {
  const s = db.prepare(sql);
  return params.length ? s.bind(...params.map((p) => (p === undefined ? null : p))) : s;
}

export async function all<T = Record<string, unknown>>(db: Db, sql: string, ...params: (Param | undefined)[]): Promise<T[]> {
  return (await stmt(db, sql, ...params).all<T>()).results ?? [];
}

export async function first<T = Record<string, unknown>>(db: Db, sql: string, ...params: (Param | undefined)[]): Promise<T | null> {
  return (await stmt(db, sql, ...params).first<T>()) ?? null;
}

export async function run(db: Db, sql: string, ...params: (Param | undefined)[]): Promise<D1Result> {
  return stmt(db, sql, ...params).run();
}

/** `?, ?, ?` for an IN list of n values. SQLite allows a few hundred bound
 *  parameters to a statement; callers keep lists under a hundred. */
export function marks(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

/** A 0/1 column as a boolean, and null as null. */
export function bool(v: unknown): boolean | null {
  return v === null || v === undefined ? null : v === 1 || v === true || v === "1";
}

/** A JSON text column, parsed; `fallback` when it is null. */
export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v as T;
  return JSON.parse(v) as T;
}

/** The rows with the named columns turned from 0/1 into booleans. */
export function withBools<T extends Record<string, unknown>>(rows: T[], ...columns: (keyof T)[]): T[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const c of columns) out[c as string] = bool(r[c]);
    return out as T;
  });
}

/** Lists cut to D1-friendly sizes for IN (...) queries. */
export function chunks<T>(list: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
