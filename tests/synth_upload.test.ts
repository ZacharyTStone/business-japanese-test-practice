/**
 * A live clip is never re-made, whether or not the caller said which are live.
 *
 * `bjt synth --upload` without `--have` on an empty media/ re-synthesised every
 * clip, uploaded each over the live file, and rewrote every duration. Now the upload needs `--have`, and the bucket itself is asked not to
 * replace anything but the clips `--remake` names: a file already at a clip's
 * path is a live clip, left alone and counted as live.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as config from "../bjt/config.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as http from "../bjt/http.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as providers from "../bjt/tts/providers.ts";
import * as synth from "../bjt/tts/synth.ts";
import { capture, patch, tmpPath } from "./helpers.ts";

/** Where the command line will be once it is ported. */
const CLI_MODULE = "../bjt/cli/index.ts";

const REFERENCE = path.join(config.ROOT, "batches", "hatsugen_choukai_J2_001.json");

type RequestOpts = Parameters<typeof http.request>[2];

const bytes = (s: string) => new TextEncoder().encode(s);

/** The `bundle` fixture. */
function bundleFixture(): Record<string, any> {
  return batch.buildBundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "test");
}

/** A configured bucket whose server answers each upload with `answer`. */
function _bucketSeeing(answer: (url: string, headers: Record<string, string>) => Uint8Array):
    [scene_art.Bucket, Record<string, string>[]] {
  const seen: Record<string, string>[] = [];

  const request = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
    seen.push(opts.headers!);
    return answer(url, opts.headers!);
  };

  patch(http, "request", request);
  return [new scene_art.Bucket({ name: "audio", creds: new r2.Credentials({ account_id: "acct", access_key_id: "k",
                                                                             secret_access_key: "s" }) }), seen];
}

class _Bucket {
  name = "audio";
  configured = true;
  live: Set<string>;
  sent: [string, boolean][];

  constructor(live: Set<string>) {
    this.live = live;
    this.sent = [];
  }

  async upload(p: string, data: Uint8Array, contentType: string, opts: { upsert?: boolean } = {}): Promise<void> {
    const upsert = opts.upsert ?? true;
    const clipId = p.slice(p.lastIndexOf("/") + 1).slice(0, -4);
    if (this.live.has(clipId) && !upsert) {
      throw new scene_art.AlreadyExists(p);
    }
    this.sent.push([clipId, upsert]);
  }
}

describe("synth_upload", () => {
  // needs bjt/cli (ported later)
  test.skip("the upload needs the list of live clips", async () => {
    const cli: any = await import(CLI_MODULE);
    const tmp = tmpPath();
    const cap = capture();
    const rc = await cli.main({ argv: ["synth", REFERENCE, "--provider", "openai", "--upload",
                                       "--media-dir", tmp] });
    expect(rc).toBe(2);
    expect(cap.readouterr().err).toContain("--upload needs --have");
    expect(existsSync(path.join(tmp, "audio")), "nothing synthesised").toBe(false);
  });

  test("the bucket is asked not to replace", async () => {
    const [bucket, seen] = _bucketSeeing(() => bytes("{}"));
    await bucket.upload("openai/ab/abc.wav", bytes("RIFF"), "audio/wav", { upsert: false });
    await bucket.upload("openai/ab/abd.wav", bytes("RIFF"), "audio/wav", { upsert: true });
    // R2 refuses a put onto a taken key only when asked to (If-None-Match).
    expect(seen.map((h) => h["if-none-match"] ?? null)).toEqual(["*", null]);
  });

  test.each([
    [412, "<Error><Code>PreconditionFailed</Code></Error>"],
  ])("a file already there is said so [%i]", async (status, body) => {
    const refuse = async (req: http.Request, timeout: number): Promise<Uint8Array> => {
      throw new http.HTTPError(status, bytes(body));
    };

    patch(http.seams, "open", refuse);
    const bucket = new scene_art.Bucket({ name: "audio", creds: new r2.Credentials({ account_id: "acct",
                                                                                     access_key_id: "k",
                                                                                     secret_access_key: "s" }) });
    await expect(bucket.upload("openai/ab/abc.wav", bytes("RIFF"), "audio/wav", { upsert: false }))
      .rejects.toBeInstanceOf(scene_art.AlreadyExists);
    // With upsert the same answer is an ordinary failure, never "already live".
    const err = await bucket.upload("openai/ab/abc.wav", bytes("RIFF"), "audio/wav", { upsert: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(scene_art.RequestFailed);
    expect(err).not.toBeInstanceOf(scene_art.AlreadyExists);
  });

  test("a clip already in the bucket is live and only a named one replaced", async () => {
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundleFixture(), { outDir: tmp });
    const ids = report.clips.map((c) => c.clip_id);
    const bucket = new _Bucket(new Set([ids[0], ids[1]]));
    const up = await synth.uploadClips(report, bucket, { mediaDir: tmp, remake: new Set([ids[1]]) });

    expect(up.existing.map((p) => p.slice(p.lastIndexOf("/") + 1).slice(0, -4))).toEqual([ids[0]]);
    const sent = new Map(bucket.sent);
    expect(sent.get(ids[1]), "the named clip replaces the live one").toBe(true);
    expect(bucket.sent.filter(([cid]) => cid !== ids[1]).every(([, upsert]) => upsert === false)).toBe(true);
    expect(sent.has(ids[0])).toBe(false);
  });

  // needs bjt/cli (ported later)
  test.skip("the command leaves a clip the bucket has out of the sql", async () => {
    const cli: any = await import(CLI_MODULE);
    const tmp = tmpPath();
    const cap = capture();

    class Voice extends providers.SilentProvider {
      override name = "fakevoice";
    }

    patch(providers.PROVIDERS, "fakevoice", Voice);
    const live = new Set<string>();
    const manifest = batch.load(REFERENCE)["audio_manifest"];
    const first: string = manifest[0]["clip_id"];
    live.add(first);
    const fake = new _Bucket(live);
    // `new scene_art.Bucket({ name: "audio" })` hands back the fake.
    patch(scene_art, "Bucket", function FakeBucket() {
      return fake;
    } as unknown as typeof scene_art.Bucket);
    const have = path.join(tmp, "have.txt");
    writeFileSync(have, "", "utf8"); // the database knew of nothing
    const out = path.join(tmp, "audio.sql");

    const rc = await cli.main({ argv: ["synth", REFERENCE, "--provider", "fakevoice", "--upload", "--have", have,
                                       "--media-dir", tmp, "--out", out] });
    const printed = cap.readouterr();
    expect(rc, printed.err).toBe(0);
    expect(printed.out).toContain("already in the bucket");
    const sql = readFileSync(out, "utf8");
    expect(sql, "no duration rewritten for a clip the learner already hears").not.toContain(first);
    expect(new Set(fake.sent.map(([cid]) => cid)).has(first)).toBe(false);
  });
});
