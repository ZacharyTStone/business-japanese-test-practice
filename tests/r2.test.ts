/**
 * The media bucket's S3 calls: signed the way AWS documents, and a live clip
 * never overwritten. Offline: `http.request` is faked, as everywhere.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import * as r2 from "../bjt/r2.ts";
import { bytes, delEnv, patch, setEnv } from "./helpers.ts";

const WHEN = new Date(Date.UTC(2013, 4, 24));
const [KEY, SECRET] = ["AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"];
const HOST = "examplebucket.s3.amazonaws.com";
const CREDS = new r2.Credentials({ account_id: "acct", access_key_id: "key-id", secret_access_key: "secret" });

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function _signature(headers: Record<string, string>): string {
  const auth = headers["Authorization"];
  return auth.slice(auth.lastIndexOf("Signature=") + "Signature=".length);
}

type RequestOpts = Parameters<typeof http.request>[2];

describe("r2", () => {
  // The three worked examples of the Signature Version 4 documentation for S3:
  // a hand-rolled signer that matches them signs the way R2 checks.

  test("signs the documented get object", () => {
    const h = r2.sign("GET", HOST, "/test.txt", {}, { Range: "bytes=0-9" }, r2._EMPTY_SHA256,
                      KEY, SECRET, { when: WHEN, region: "us-east-1" });
    expect(_signature(h)).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(h["Authorization"]).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  test("signs the documented listing", () => {
    const h = r2.sign("GET", HOST, "/", { "max-keys": "2", prefix: "J" }, {}, r2._EMPTY_SHA256,
                      KEY, SECRET, { when: WHEN, region: "us-east-1" });
    expect(_signature(h)).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  test("signs the documented put object", () => {
    const body = bytes("Welcome to Amazon S3.");
    const h = r2.sign("PUT", HOST, "/test$file.text", {},
                      { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
                      sha256(body), KEY, SECRET, { when: WHEN, region: "us-east-1" });
    expect(_signature(h)).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  test("credentials need all three parts", () => {
    setEnv("R2_ACCOUNT_ID", "acct");
    setEnv("R2_ACCESS_KEY_ID", "key-id");
    delEnv("R2_SECRET_ACCESS_KEY");
    expect(r2.Credentials.fromEnv()).toBeNull();
    setEnv("R2_SECRET_ACCESS_KEY", "secret");
    setEnv("R2_BUCKET", "other");
    expect(r2.Credentials.fromEnv()).toEqual(
      new r2.Credentials({ account_id: "acct", access_key_id: "key-id", secret_access_key: "secret", bucket: "other" }));
  });

  test("a put is signed and names the object", async () => {
    const seen: { method?: string; url?: string; body?: unknown; headers?: Record<string, string> } = {};

    const fake = async (method: string, url: string, opts: RequestOpts = {}) => {
      Object.assign(seen, { method, url, body: opts.body, headers: opts.headers });
      return new Uint8Array(0);
    };

    patch(http, "request", fake);
    await r2.put(CREDS, "audio/openai/ab/ab12.wav", bytes("RIFF"), "audio/wav");
    expect(seen.method).toBe("PUT");
    expect(seen.url).toBe("https://acct.r2.cloudflarestorage.com/business-japanese-drill-media/audio/openai/ab/ab12.wav");
    expect(seen.body).toEqual(bytes("RIFF"));
    expect(seen.headers!["Authorization"].startsWith("AWS4-HMAC-SHA256 Credential=key-id/")).toBe(true);
    expect(seen.headers!["Authorization"]).toContain("/auto/s3/aws4_request");
    expect(seen.headers!["x-amz-content-sha256"]).toBe(sha256(bytes("RIFF")));
    expect("if-none-match" in seen.headers!).toBe(false);
  });

  test("a put that must not overwrite says so and hears 412 as taken", async () => {
    const taken = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
      expect(opts.headers!["if-none-match"]).toBe("*");
      throw new http.RequestFailed("PUT → HTTP 412", { status: 412, detail: "PreconditionFailed" });
    };

    patch(http, "request", taken);
    await expect(r2.put(CREDS, "audio/x.wav", bytes("x"), "audio/wav", { overwrite: false }))
      .rejects.toBeInstanceOf(r2.AlreadyExists);
  });

  test("any other refusal is a failure", async () => {
    const refused = async (): Promise<Uint8Array> => {
      throw new http.RequestFailed("PUT → HTTP 403", { status: 403, detail: "AccessDenied" });
    };

    patch(http, "request", refused);
    const err = await r2.put(CREDS, "audio/x.wav", bytes("x"), "audio/wav", { overwrite: false }).catch((e) => e);
    expect(err).toBeInstanceOf(http.RequestFailed);
    expect(err).not.toBeInstanceOf(r2.AlreadyExists);
  });

  test("a listing is read page by page and may be retried", async () => {
    const ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';
    const pages = [
      bytes(`<ListBucketResult ${ns}><IsTruncated>true</IsTruncated><NextContinuationToken>t/1+</NextContinuationToken>`
            + "<Contents><Key>audio/a.wav</Key></Contents></ListBucketResult>"),
      bytes(`<ListBucketResult ${ns}><IsTruncated>false</IsTruncated>`
            + "<Contents><Key>audio/b.wav</Key></Contents></ListBucketResult>"),
    ];
    const calls: [string, string, number | undefined][] = [];

    const fake = async (method: string, url: string, opts: RequestOpts = {}) => {
      calls.push([method, url, opts.retries]);
      return pages.shift()!;
    };

    patch(http, "request", fake);
    expect(await r2.listKeys(CREDS, "audio/")).toEqual(["audio/a.wav", "audio/b.wav"]);
    expect(calls.map((c) => c[0])).toEqual(["GET", "GET"]);
    expect(calls.every((c) => c[2] === 2)).toBe(true);
    expect(calls[1][1]).toContain("continuation-token=t%2F1%2B");
  });
});
