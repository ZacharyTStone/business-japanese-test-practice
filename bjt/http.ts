/**
 * HTTPS for the vendors that have no SDK here, done one way.
 *
 * Jev (bjt/jev.ts), the voices (bjt/tts/providers.ts), the image model and the
 * storage buckets (bjt/scene_art.ts) are each a JSON request over `fetch`, and
 * each used to carry its own copy of the same dozen lines with its own timeout
 * and its own wording of a failure. They share this one instead: the timeout
 * is said at the call, a failure is a `RequestFailed` that keeps the status
 * and the part of the body that says what went wrong (the caller decides what
 * that means — an empty account, a file already there), and a request that is
 * safe to send twice may say how many times to try.
 *
 * Retrying is opt-in and meant for what is idempotent: reading a bucket's
 * listing, which an overloaded server can drop and the next attempt answers.
 * Never an upload, a generation or a paid call — a response lost after the
 * server acted would be the same money or the same file twice.
 *
 * `seams.open` is the one place a connection is made, which is the seam the
 * tests refuse (tests/setup.ts) and the fakes stand in front of.
 */
import { dumps, loads } from "./pyjson.ts";
import { PyError, RuntimeError } from "./py.ts";

/** Seconds a request may take unless the caller says otherwise. A picture or
 *  a clip takes a while to make; three minutes is well over it. */
export const DEFAULT_TIMEOUT = 180.0;

/** The statuses worth a second try: a timeout, a rate limit, a server that
 *  was overloaded or briefly down. Anything else would fail the same way
 *  again. */
export const RETRY_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

/** A request that did not succeed. `status` is the HTTP status, or null when
 *  there was no response at all; `detail` is the first few hundred characters
 *  of the body (or the network's reason), the part of a vendor's error that
 *  actually says what was wrong. */
export class RequestFailed extends RuntimeError {
  readonly status: number | null;
  readonly detail: string;
  constructor(message: string, opts: { status: number | null; detail: string; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

/** A response with a status that is not a success (urllib's HTTPError). */
export class HTTPError extends PyError {
  readonly code: number;
  readonly body: Uint8Array;
  constructor(code: number, body: Uint8Array | string = new Uint8Array(), message: string = `HTTP ${code}`) {
    super(message);
    this.code = code;
    this.body = typeof body === "string" ? new TextEncoder().encode(body) : body;
  }
}

/** No response at all: a refused connection, a reset, a timeout (urllib's
 *  URLError and OSError). */
export class URLError extends PyError {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** One request, as `seams.open` receives it. Header names are as the caller
 *  wrote them. */
export type Request = {
  method: string;
  url: string;
  body: Uint8Array | null;
  headers: Record<string, string>;
};

/** Read a header from a request regardless of its case, as urllib's
 *  `get_header` does. */
export function header(req: Request, name: string): string | null {
  const key = Object.keys(req.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : req.headers[key];
}

/** Send one request and read the whole body. A status outside 2xx is an
 *  `HTTPError`; no response is a `URLError`. */
async function open(req: Request, timeout: number): Promise<Uint8Array> {
  let resp: Response;
  try {
    resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ?? undefined,
      signal: AbortSignal.timeout(timeout * 1000),
    });
  } catch (e) {
    const reason = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    throw new URLError(reason);
  }
  const body = new Uint8Array(await resp.arrayBuffer());
  if (!resp.ok) throw new HTTPError(resp.status, body, `HTTP Error ${resp.status}: ${resp.statusText}`);
  return body;
}

/** The two places this module touches the world, replaceable in tests. */
export const seams = {
  open,
  sleep: (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000)),
};

const decoder = new TextDecoder("utf-8", { fatal: false });

/** One request; the response body. Throws `RequestFailed`.
 *
 *  `retries` extra attempts on a transient failure (no response, or one of
 *  RETRY_STATUSES), with a short doubling wait — for idempotent requests
 *  only. */
export async function request(
  method: string,
  url: string,
  opts: { body?: Uint8Array | string | null; headers?: Record<string, string> | null; timeout?: number; retries?: number } = {},
): Promise<Uint8Array> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? 0;
  const body = typeof opts.body === "string" ? new TextEncoder().encode(opts.body) : opts.body ?? null;
  let attempt = 0;
  for (;;) {
    const req: Request = { method, url, body, headers: { ...(opts.headers ?? {}) } };
    let failure: RequestFailed;
    let transient: boolean;
    try {
      return await seams.open(req, timeout);
    } catch (exc) {
      if (exc instanceof HTTPError) {
        const detail = [...decoder.decode(exc.body)].slice(0, 500).join("");
        failure = new RequestFailed(`${method} ${url} → HTTP ${exc.code}: ${detail}`, { status: exc.code, detail, cause: exc });
        transient = RETRY_STATUSES.includes(exc.code);
      } else if (exc instanceof URLError || isNetworkError(exc)) {
        const reason = exc instanceof URLError ? exc.reason : (exc as Error).message;
        failure = new RequestFailed(`${method} ${url} failed: ${reason}`, { status: null, detail: reason, cause: exc });
        transient = true;
      } else {
        throw exc;
      }
    }
    if (!transient || attempt >= retries) throw failure;
    await seams.sleep(Math.min(8.0, 0.5 * 2 ** attempt));
    attempt += 1;
  }
}

/** An operating-system level failure (Python's OSError): what a fake raises
 *  to say "the network is down". */
export class OSError extends PyError {}

function isNetworkError(e: unknown): boolean {
  return e instanceof OSError;
}

/** `request` with a JSON body and a JSON reply. A reply that is not JSON is
 *  an error naming the URL. */
export async function jsonRequest(
  method: string,
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string> | null; timeout?: number; retries?: number } = {},
): Promise<any> {
  const raw = await request(method, url, {
    // Python's `json.dumps(body)`: its separators and ASCII escapes, so the
    // bytes on the wire are the ones the Python pipeline sent.
    body: new TextEncoder().encode(dumps(body)),
    headers: { ...(opts.headers ?? {}), "Content-Type": "application/json" },
    timeout: opts.timeout,
    retries: opts.retries,
  });
  try {
    return loads(decoder.decode(raw));
  } catch (exc) {
    throw new RuntimeError(`${url} returned something that is not JSON`, { cause: exc });
  }
}
