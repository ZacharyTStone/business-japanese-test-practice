/**
 * The media jobs' decisions, reachable without the command line.
 *
 * What a scene run draws (`scene_art.select`, `lifetimeLedger`) and the whole
 * synthesis sequence (`synth.run`) used to live inside `cmd_scenes` and
 * `cmd_synth`, where only a full command run could test them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import { RuntimeError, sorted, ValueError } from "../bjt/py.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import * as providers from "../bjt/tts/providers.ts";
import * as synth from "../bjt/tts/synth.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { hatsugenBundle } from "./conftest.ts";
import { patch, tmpPath } from "./helpers.ts";

class _Bucket {
  name = "audio";
  configured = true;
  live: Set<string>;
  broken: Set<string>;
  sent: string[];

  constructor(opts: { live?: Iterable<string>; broken?: Iterable<string> } = {}) {
    this.live = new Set(opts.live ?? []);
    this.broken = new Set(opts.broken ?? []);
    this.sent = [];
  }

  async upload(p: string, data: Uint8Array, contentType: string, opts: { upsert?: boolean } = {}): Promise<void> {
    const upsert = opts.upsert ?? true;
    const clipId = p.slice(p.lastIndexOf("/") + 1).slice(0, -4);
    if (this.broken.has(clipId)) {
      throw new RuntimeError("HTTP 500");
    }
    if (this.live.has(clipId) && !upsert) {
      throw new scene_art.AlreadyExists(p);
    }
    this.sent.push(clipId);
  }
}

describe("media_run", () => {
  test("select puts the bank first and caps the pictures", () => {
    const tmp = tmpPath();
    // With nothing withdrawn the library holds more pictures than the cap.
    patch(withdrawn.seams, "ids", () => new Set<string>());
    const survey = scenes.survey({ mediaDir: tmp });
    const wanted = scene_art.select(survey, { maxPictures: 2 });
    const kinds = wanted.map((s) => s.is_picture);
    expect(kinds, "the shared bank before the pictures").toEqual(sorted(kinds));
    expect(kinds.filter(Boolean).length).toBe(2);
  });

  test("select leaves art alone unless forced", () => {
    const tmp = tmpPath();
    mkdirSync(path.join(tmp, "scenes"));
    const first = scenes.survey({ mediaDir: tmp }).find((s) => !s.is_picture)!;
    writeFileSync(path.join(tmp, "scenes", `${first.scene_id}.webp`), "x");
    const survey = scenes.survey({ mediaDir: tmp });
    expect(new Set(scene_art.select(survey).map((s) => s.scene_id)).has(first.scene_id)).toBe(false);
    expect(new Set(scene_art.select(survey, { force: true }).map((s) => s.scene_id)).has(first.scene_id)).toBe(true);
  });

  test("select by name and kind", () => {
    const tmp = tmpPath();
    const survey = scenes.survey({ mediaDir: tmp });
    const bank = survey.filter((s) => !s.is_picture).slice(0, 2);
    const names = bank.map((s) => s.scene_id);
    expect(scene_art.select(survey, { names }).map((s) => s.scene_id)).toEqual(names);
    expect(scene_art.select(survey, { names, only: "pictures" })).toEqual([]);
    expect(scene_art.select(survey, { only: "pictures", maxPictures: 99 }).every((s) => s.is_picture)).toBe(true);
    expect(() => scene_art.select(survey, { names: ["not_a_scene"] })).toThrow(ValueError);
    expect(() => scene_art.select(survey, { names: ["not_a_scene"] })).toThrow(/no such scene/);
  });

  test("an unconfigured bucket remembers and records nothing", async () => {
    expect(await scene_art.lifetimeLedger(new scene_art.Bucket({ creds: null }), { record: true }))
      .toEqual([{}, null, null]);
  });

  test("an unreadable ledger is a warning", async () => {
    const bucket = new scene_art.Bucket({ creds: new r2.Credentials({ account_id: "acct", access_key_id: "k",
                                                                       secret_access_key: "s" }) });

    const down = async (): Promise<Uint8Array> => {
      throw new RuntimeError("HTTP 503");
    };

    patch(http, "request", down);
    const [prior, onReject, warning] = await scene_art.lifetimeLedger(bucket, { record: true });
    expect(prior).toEqual({});
    expect(onReject).not.toBeNull();
    expect(warning).toContain("HTTP 503");
  });

  test("the run refuses an upload without the live list", async () => {
    const tmp = tmpPath();
    const err = await synth.run(hatsugenBundle("t"), { provider: "silent", bucket: new _Bucket(), mediaDir: tmp })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValueError);
    expect(err.message).toMatch(/already live/);
  });

  test("the run leaves the report describing the bucket", async () => {
    const bundle = hatsugenBundle("t");
    const tmp = tmpPath();

    class Voice extends providers.SilentProvider {
      override name = "fakevoice";
    }

    const ids: string[] = bundle["audio_manifest"].map((c: any) => c["clip_id"]);
    const bucket = new _Bucket({ live: [ids[0]], broken: [ids[1]] });
    const run = await synth.run(bundle, { provider: new Voice(), bucket, mediaDir: tmp, have: new Set() });
    const made = new Set(run.report.clips.map((c) => c.clip_id));
    expect(!made.has(ids[0]) && run.report.live.includes(ids[0])).toBe(true);
    expect(!made.has(ids[1]) && run.report.failed.some(([cid]) => cid === ids[1])).toBe(true);
    expect(made).toEqual(new Set(bucket.sent));
    expect(run.uploaded).not.toBeNull();
    expect(run.uploaded!.existing.length).toBe(1);
  });
});
