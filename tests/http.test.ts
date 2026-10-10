/**
 * The one HTTP helper Jev, the voices, the image model and the buckets share.
 *
 * Faked at `http.seams.open`, the single place a connection is made, so what
 * is tested is the helper itself: how a failure reads, and which requests are
 * tried again.
 */
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import { bytes, patch } from "./helpers.ts";

const CREDS = new r2.Credentials({ account_id: "acct", access_key_id: "k", secret_access_key: "s" });

type Reply = Uint8Array | Error;

/** Answers each request with the next of `replies`: bytes, or an error to
 *  throw. `sent` keeps the requests; `slept` the waits. */
function wire() {
  const w = { replies: [] as Reply[], sent: [] as [http.Request, number][], slept: [] as number[] };
  patch(http.seams, "open", async (req: http.Request, timeout: number) => {
    w.sent.push([req, timeout]);
    const reply = w.replies.shift()!;
    if (reply instanceof Error) throw reply;
    return reply;
  });
  patch(http.seams, "sleep", async (s: number) => {
    w.slept.push(s);
  });
  return w;
}

const status = (code: number, body: string = "") => new http.HTTPError(code, bytes(body));

describe("http", () => {
  test("a status keeps its code and what the body said", async () => {
    const w = wire();
    w.replies = [status(402, '{"error": "insufficient_quota"}')];
    const err = await http.request("POST", "https://x.example/p", { body: bytes("{}"), headers: { A: "b" } }).catch((e) => e);
    expect(err).toBeInstanceOf(http.RequestFailed);
    expect(err.status).toBe(402);
    expect(err.detail).toContain("insufficient_quota");
    expect(err.message.startsWith("POST https://x.example/p → HTTP 402:")).toBe(true);
  });

  test("no response at all has no status", async () => {
    const w = wire();
    w.replies = [new http.URLError("egress blocked")];
    const err = await http.request("GET", "https://x.example/p").catch((e) => e);
    expect(err).toBeInstanceOf(http.RequestFailed);
    expect(err.status).toBeNull();
    expect(err.message).toContain("egress blocked");
  });

  test("nothing is retried unless asked", async () => {
    const w = wire();
    w.replies = [status(503)];
    await expect(http.request("POST", "https://x.example/p", { body: bytes("x") })).rejects.toBeInstanceOf(http.RequestFailed);
    expect(w.sent.length).toBe(1);
    expect(w.slept).toEqual([]);
  });

  test("an idempotent request is tried again on a transient failure", async () => {
    const w = wire();
    w.replies = [status(503), new http.URLError("reset"), bytes("ok")];
    const got = await http.request("POST", "https://x.example/list", { body: bytes("{}"), retries: 2 });
    expect(new TextDecoder().decode(got)).toBe("ok");
    expect(w.sent.length).toBe(3);
    expect(w.slept.length).toBe(2);
  });

  test("a failure that would repeat is not retried", async () => {
    const w = wire();
    w.replies = [status(400, "bad request")];
    await expect(http.request("POST", "https://x.example/list", { body: bytes("{}"), retries: 5 })).rejects.toBeInstanceOf(http.RequestFailed);
    expect(w.sent.length).toBe(1);
  });

  test("the timeout is the caller's", async () => {
    const w = wire();
    w.replies = [bytes("ok"), bytes("ok")];
    await http.request("GET", "https://x.example/p");
    await http.request("GET", "https://x.example/p", { timeout: 12 });
    expect(w.sent.map(([, t]) => t)).toEqual([http.DEFAULT_TIMEOUT, 12]);
  });

  test("a JSON request says so and reads the reply", async () => {
    const w = wire();
    w.replies = [bytes(JSON.stringify({ ok: true }))];
    expect(await http.jsonRequest("POST", "https://x.example/p", { a: 1 }, { headers: { "X-Key": "k" } })).toEqual({ ok: true });
    const [req] = w.sent[0];
    expect(http.header(req, "Content-type")).toBe("application/json");
    expect(http.header(req, "X-key")).toBe("k");
    expect(JSON.parse(new TextDecoder().decode(req.body))).toEqual({ a: 1 });
  });

  test("a reply that is not JSON names the URL", async () => {
    const w = wire();
    w.replies = [bytes("<html>gateway</html>")];
    await expect(http.jsonRequest("POST", "https://x.example/p", {})).rejects.toThrow(/x\.example/);
  });

  test("an unfaked request is refused by the test setup", async () => {
    await expect(http.request("GET", "https://x.example/p")).rejects.toThrow(/fake it in the test/);
  });

  test("the bucket listing survives a dropped request", async () => {
    const w = wire();
    const listing = bytes('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                          + "<IsTruncated>false</IsTruncated><Contents><Key>scenes/a.webp</Key></Contents>"
                          + "</ListBucketResult>");
    w.replies = [status(502), listing];
    const bucket = new scene_art.Bucket({ creds: CREDS });
    expect(await bucket.list()).toEqual(new Set(["a.webp"]));
  });

  /** A retried upload that had in fact arrived would come back as "already
   *  there" — and be counted as live when it is tonight's file. */
  test("an upload is never sent twice", async () => {
    const w = wire();
    w.replies = [status(503)];
    const bucket = new scene_art.Bucket({ creds: CREDS });
    await expect(bucket.upload("a.webp", bytes("x"), "image/webp")).rejects.toBeInstanceOf(http.RequestFailed);
    expect(w.sent.length).toBe(1);
  });
});
