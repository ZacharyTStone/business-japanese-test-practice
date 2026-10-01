/**
 * The error the app reads, in the shape it has always read — `code`,
 * `message`, `details`, `hint` — so `errorText`, `errorKind` and the answer
 * outbox in the app keep working unchanged. The outbox reads two hints:
 * `daily_limit_reached` (the day is over) and `item_unavailable` (the
 * question was withdrawn), which the schema's triggers raise by those names.
 */

export type ApiError = { code: string; message: string; details: string | null; hint: string | null };

export class ApiFailure extends Error {
  constructor(readonly error: ApiError, readonly status = 400) {
    super(error.message);
  }
}

export function apiError(code: string, message: string, status = 400, hint: string | null = null): ApiFailure {
  return new ApiFailure({ code, message, details: null, hint }, status);
}

/** The refusals the schema raises (d1/migrations), by the word it raises. */
const RAISED: Record<string, { message: string; hint: string | null }> = {
  daily_limit_reached: { message: "daily limit reached", hint: "daily_limit_reached" },
  item_unavailable: { message: "this question is no longer in the bank", hint: "item_unavailable" },
  no_such_option: { message: "no such option for this question", hint: null },
};

/** A thrown error, as the app should see it. */
export function toApiError(e: unknown): { status: number; error: ApiError } {
  if (e instanceof ApiFailure) return { status: e.status, error: e.error };
  const message = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
  const text = `${message} ${cause}`;
  for (const [word, said] of Object.entries(RAISED)) {
    if (text.includes(word)) {
      return { status: 400, error: { code: "P0001", message: said.message, details: null, hint: said.hint } };
    }
  }
  if (/SQLITE_CONSTRAINT|D1_ERROR/.test(text)) {
    return { status: 400, error: { code: "D1_ERROR", message, details: null, hint: null } };
  }
  return { status: 500, error: { code: "worker_error", message, details: null, hint: null } };
}
