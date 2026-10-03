/**
 * What went wrong, in words a learner can act on.
 *
 * Kept free of react-native and of the network so it can be tested in
 * Node and imported anywhere without creating a client as a side effect.
 */
import type { Key } from "./i18n";

/**
 * The technical account: message, details and hint joined, with the Postgres
 * `code` kept because it is the part worth searching for.
 *
 * A failed query is not an `Error` — it is a plain object carrying
 * `message`, `details`, `hint` and a Postgres `code` — so `String(e)` would
 * show "[object Object]" and hide what actually went wrong. `42703` is
 * "undefined column", which says "this client is newer than this database"
 * far more precisely than any wording of ours would.
 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const { message, details, hint, code } = e as Record<string, unknown>;
    const said = [message, details, hint].filter(
      (part): part is string => typeof part === "string" && part.trim() !== ""
    );
    if (said.length > 0) {
      const text = said.join(" — ");
      return typeof code === "string" && code !== "" ? `${text} (${code})` : text;
    }
  }
  return String(e);
}

/** The few failures a learner can do something about, and everything else. */
export type ErrorKind = "offline" | "session_expired" | "wrong_password" | "other";

const OFFLINE = /failed to fetch|network ?request failed|networkerror|fetch failed|load failed|internet connection appears to be offline/i;
const EXPIRED = /jwt expired|refresh token|session (?:missing|not found|expired)|invalid jwt/i;
const WRONG_PASSWORD = /invalid login credentials/i;

export function errorKind(e: unknown): ErrorKind {
  const text = errorText(e);
  const fields = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const code = typeof fields.code === "string" ? fields.code : "";
  const name = typeof fields.name === "string" ? fields.name : "";
  const status = typeof fields.status === "number" ? fields.status : undefined;

  if (code === "invalid_credentials" || WRONG_PASSWORD.test(text)) return "wrong_password";
  if (
    code === "session_expired" ||
    code === "PGRST301" ||
    code === "PGRST303" ||
    name === "AuthSessionMissingError" ||
    EXPIRED.test(text)
  ) {
    return "session_expired";
  }
  if (OFFLINE.test(text) || name === "AuthRetryableFetchError" || status === 0) return "offline";
  return "other";
}

const KIND_KEY: Record<ErrorKind, Key> = {
  offline: "err_offline",
  session_expired: "err_session_expired",
  wrong_password: "err_wrong_password",
  other: "err_other",
};

/**
 * A sentence for the learner, and the technical text for small print.
 *
 * `detail` is empty when the sentence already says everything; for an
 * unrecognised failure it carries `errorText` so the code is still findable.
 */
export function friendlyError(
  e: unknown,
  t: (key: Key, vars?: Record<string, string | number>) => string
): { message: string; detail: string } {
  const kind = errorKind(e);
  return { message: t(KIND_KEY[kind]), detail: kind === "other" ? errorText(e) : "" };
}
