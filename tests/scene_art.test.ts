/**
 * Drawing the scene bank, offline.
 *
 * The placeholder provider is not a mock hidden here — it is how the job runs
 * without a vendor account. The reviewer is faked, because that is the model
 * call; what is tested is that the job obeys the reviewer, keeps what it
 * rejects, and never lets a stand-in be mistaken for artwork.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as config from "../bjt/config.ts";
import * as http from "../bjt/http.ts";
import * as llm from "../bjt/llm.ts";
import { RuntimeError, sorted, splitWs } from "../bjt/py.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { capture, delEnv, patch, setConfig, setEnv, tmpPath } from "./helpers.ts";

type RequestOpts = Parameters<typeof http.request>[2];

const bytes = (s: string) => new TextEncoder().encode(s);

function _pngIsValid(data: Uint8Array): boolean {
  const b = Buffer.from(data);
  return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && b.subarray(b.length - 8).equals(Buffer.from("IEND\xaeB`\x82", "latin1"));
}

/** A provider whose output counts, so the review gate is exercised. */
class _Real implements scene_art.ImageProvider {
  name = "fake";
  suffix = ".png";
  media_type = "image/png";
  real = true;
  calls = 0;

  async generate(prompt: string): Promise<Uint8Array> {
    this.calls += 1;
    expect(prompt).toContain("must not contain");
    return scene_art._flatPng(6, 4, [this.calls, 0, 0]);
  }
}

const verdict = (approved: boolean, ...reasons: string[]) => new scene_art.Verdict({ approved, reasons });

/** Hands out the next of `items` on every call, as Python's `next(iter(...))`. */
function iter<T>(items: T[]): () => T {
  const it = items[Symbol.iterator]();
  return () => {
    const n = it.next();
    if (n.done) throw new Error("StopIteration");
    return n.value;
  };
}

// ----- the bucket -----------------------------------------------------------

const CREDS = new r2.Credentials({ account_id: "acct", access_key_id: "key-id", secret_access_key: "secret" });
const BASE = "https://acct.r2.cloudflarestorage.com/business-japanese-drill-media";

/** An R2 ListObjectsV2 reply holding these keys. */
function _listing(keys: string[], opts: { truncated?: boolean; token?: string } = {}): Uint8Array {
  const body = keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("");
  const more = opts.token ? `<NextContinuationToken>${opts.token}</NextContinuationToken>` : "";
  return bytes('<?xml version="1.0" encoding="UTF-8"?>'
               + '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
               + `<IsTruncated>${opts.truncated ? "true" : "false"}</IsTruncated>${more}${body}`
               + "</ListBucketResult>");
}

function _noR2(): void {
  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    delEnv(name);
  }
}

// ----- per-item pictures (画像把握) --------------------------------------------

function _pictures(tmp: string): scenes.Scene[] {
  return scenes.survey({ mediaDir: tmp }).filter((s) => s.is_picture);
}

function cleanFlags(rules: Record<string, string>, set: (r: string) => boolean = () => false): Record<string, any> {
  return { ...Object.fromEntries(Object.keys(rules).map((r) => [r, set(r)])), notes: "" };
}

describe("scene_art", () => {
  test("the placeholder is a real png of the banks shape", async () => {
    const data = await new scene_art.PlaceholderProvider().generate("anything");
    expect(_pngIsValid(data)).toBe(true);
    const b = Buffer.from(data);
    const [width, height] = [b.readUInt32BE(16), b.readUInt32BE(20)];
    expect(width * 2).toBe(height * 3);
  });

  test("placeholders are never counted as artwork", async () => {
    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp });
    const result = await scene_art.draw(wanted, { provider: new scene_art.PlaceholderProvider(),
                                                  review: scene_art.reviewWithModel, mediaDir: tmp });
    expect(result.approved.length).toBe(wanted.length);
    expect(result.drawn.every((d) => d.path!.startsWith("placeholder/"))).toBe(true);
    // The survey looks only at the top of media/scenes, so nothing changed.
    expect(scenes.survey({ mediaDir: tmp }).some((s) => s.has_art)).toBe(false);
    expect(result.summary()).toContain("nothing here is artwork");
  });

  test("a rejected draft is kept with its reason and the next one tried", async () => {
    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp }).slice(0, 2);
    const verdicts = iter([
      verdict(false, "readable text drawn in"),
      verdict(true),
      verdict(true),
    ]);
    const provider = new _Real();
    const result = await scene_art.draw(wanted, { provider, review: (img, mt, sc) => verdicts(),
                                                  mediaDir: tmp, attempts: 3 });
    const [first, second] = result.drawn;
    expect(first.ok && first.attempts === 2).toBe(true);
    expect(first.rejected).toEqual([["readable text drawn in"]]);
    expect(second.ok && second.attempts === 1).toBe(true);
    expect(provider.calls).toBe(3);

    const rejected = path.join(tmp, "scenes", "rejected");
    expect(existsSync(path.join(rejected, `${first.scene_id}-1.png`))).toBe(true);
    expect(readFileSync(path.join(rejected, `${first.scene_id}-1.txt`), "utf8")).toBe("readable text drawn in\n");
    // And the approved one is where the survey looks, so it now counts as art.
    const art = scenes.survey({ mediaDir: tmp }).filter((s) => s.has_art).map((s) => s.scene_id);
    expect(sorted(art)).toEqual(sorted([first.scene_id, second.scene_id]));
  });

  test("a scene that fails every attempt ships without a picture", async () => {
    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp }).slice(0, 1);
    const result = await scene_art.draw(wanted, { provider: new _Real(),
                                                  review: () => verdict(false, "a likeness"),
                                                  mediaDir: tmp, attempts: 2 });
    expect(result.drawn.length).toBe(1);
    const only = result.drawn[0];
    expect(!only.ok && only.attempts === 2 && only.rejected.length === 2).toBe(true);
    expect(result.failed).toEqual([only]);
    expect(scenes.survey({ mediaDir: tmp }).some((s) => s.has_art)).toBe(false);
    expect(result.summary()).toContain("no draft passed");
  });

  test("a vendor error is a result not a crash", async () => {
    class Broken extends _Real {
      override async generate(prompt: string): Promise<Uint8Array> {
        throw new RuntimeError("HTTP 429");
      }
    }

    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp }).slice(0, 1);
    const result = await scene_art.draw(wanted, { provider: new Broken(), review: () => verdict(true),
                                                  mediaDir: tmp });
    expect(result.drawn[0].error).toBe("HTTP 429");
    expect(result.summary()).toContain("error: HTTP 429");
  });

  test("the model review turns flags into a verdict", async () => {
    const tmp = tmpPath();
    const seen: { brief?: string; rules?: Record<string, string> } = {};

    const fake = async (image: Uint8Array, mediaType: string, brief: string, rules: Record<string, string>,
                        opts: { model?: string | null } = {}) => {
      Object.assign(seen, { brief, rules });
      return { ...Object.fromEntries(Object.keys(rules).map((rule) => [rule, rule === "gives_scenario_away"])), notes: "x" };
    };

    patch(llm, "reviewSceneImage", fake);
    const scene = scenes.survey({ mediaDir: tmp })[0];
    const v = await scene_art.reviewWithModel(bytes("img"), "image/webp", scene);
    expect(v.approved).toBe(false);
    expect(v.reasons).toEqual([scene_art.RULES["gives_scenario_away"]]);
    // The judge is given the same brief a human would get, rule for rule.
    expect(seen.brief).toBe(scenes.promptFor(scene));
    expect(seen.rules).toBe(scene_art.RULES);
    for (const clause of scenes.FORBIDDEN) {
      expect(seen.brief).toContain(clause);
    }
  });

  test("the image prompt carries every prohibition", () => {
    const tmp = tmpPath();
    const prompt = scenes.imagePrompt(scenes.survey({ mediaDir: tmp })[0]);
    for (const clause of scenes.FORBIDDEN) {
      expect(prompt).toContain(clause);
    }
    expect(prompt).toContain(scenes.STYLE);
  });

  /** The seed tables carry only a Japanese label; the image model draws
   *  from the English brief, so every scene the tables can ask for has one. A
   *  generic "office setting" gloss would put the restaurant and the outdoor
   *  phone call indoors. */
  test("every scene has a brief and the prompt names the place", () => {
    const tmp = tmpPath();
    for (const scene of scenes.survey({ mediaDir: tmp })) {
      if (scene.is_picture) {
        continue; // drawn from its item's own brief, below
      }
      expect(scene.scene_id in scenes.SCENE_BRIEFS, scene.scene_id).toBe(true);
      const [place, channel] = scenes.SCENE_BRIEFS[scene.scene_id];
      expect(channel in scenes.COMPOSITION).toBe(true);
      for (const text of [scenes.promptFor(scene), scenes.imagePrompt(scene)]) {
        expect(text).toContain(place);
        expect(text).toContain(scenes.COMPOSITION[channel]);
        expect(text).not.toContain("office setting");
      }
    }
  });

  /** The learner chooses the reply, so the learner is the one spoken to and
   *  is never drawn: one speaker facing the viewer in person, alone on the
   *  phone, on screen for a video call. A reviewer rule fails a listener. */
  test("the speaker addresses the viewer and nobody else is principal", () => {
    const tmp = tmpPath();
    const byId = new Map(scenes.survey({ mediaDir: tmp }).map((s) => [s.scene_id, s]));
    const inPerson = scenes.imagePrompt(byId.get("scene_corridor")!);
    expect(inPerson.includes("one principal figure") && inPerson.includes("NOT drawn")).toBe(true);
    const phone = scenes.imagePrompt(byId.get("scene_phone_mobile_outside")!);
    expect(phone.includes("on the phone") && phone.includes("no listener beside them")).toBe(true);
    expect(phone.includes("outdoors") && phone.includes("no office interior")).toBe(true);
    const video = scenes.imagePrompt(byId.get("scene_video_call_laptop")!);
    expect(video).toContain("video-call window");
    expect("no_focus" in scene_art.RULES).toBe(true);
    expect(scenes.FORBIDDEN.some((clause) => clause.includes("never in the picture"))).toBe(true);
  });

  // ----- the bucket -----------------------------------------------------------

  test("the bucket refuses without its credentials", async () => {
    _noR2();
    const bucket = new scene_art.Bucket();
    expect(bucket.configured).toBe(false);
    const listed = await bucket.list().catch((e) => e);
    expect(listed).toBeInstanceOf(RuntimeError);
    expect(listed.message).toMatch(/R2_ACCOUNT_ID/);
    const uploaded = await bucket.upload("x.webp", bytes(""), "image/webp").catch((e) => e);
    expect(uploaded).toBeInstanceOf(RuntimeError);
    expect(uploaded.message).toMatch(/R2_ACCOUNT_ID/);
  });

  test("the bucket reads its credentials from the environment", () => {
    setEnv("R2_ACCOUNT_ID", "acct");
    setEnv("R2_ACCESS_KEY_ID", "key-id");
    setEnv("R2_SECRET_ACCESS_KEY", "secret");
    delEnv("R2_BUCKET");
    expect(new scene_art.Bucket().creds).toEqual(CREDS);
  });

  test("artwork already in the bucket counts and is not resent", async () => {
    const tmp = tmpPath();
    const requests: unknown[][] = [];

    const fakeRaw = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
      if (method === "GET") {
        requests.push([method, url.split("?")[0], url.split("?")[1]]);
        // The folder's own files only: `rejected/` is a deeper prefix and
        // the delimiter keeps its contents out of the listing.
        return _listing(["scenes/scene_corridor.webp", "scenes/notes.txt"]);
      }
      requests.push([method, url, opts.headers!["content-type"], opts.headers!["if-none-match"] ?? null]);
      return bytes("");
    };

    patch(http, "request", fakeRaw);
    const bucket = new scene_art.Bucket({ creds: CREDS });
    expect(bucket.configured).toBe(true);
    expect(await bucket.list()).toEqual(new Set(["scene_corridor.webp"]));
    const [method, url, query] = requests[0] as string[];
    expect([method, url]).toEqual(["GET", BASE]);
    expect(query.includes("prefix=scenes%2F") && query.includes("delimiter=%2F") && query.includes("list-type=2")).toBe(true);

    mkdirSync(path.join(tmp, "scenes"));
    writeFileSync(path.join(tmp, "scenes", "scene_phone_desk.webp"), "art");
    const survey = scenes.survey({ mediaDir: tmp, remote: await bucket.list() });
    const have = Object.fromEntries(survey.filter((s) => s.has_art).map((s) => [s.scene_id, s.path]));
    expect(have).toEqual({ "scene_corridor": "scene_corridor.webp",
                           "scene_phone_desk": "scene_phone_desk.webp" });

    const up = await scene_art.uploadApproved(survey, bucket, { mediaDir: tmp });
    expect(up.sent).toEqual(["scene_phone_desk.webp"]); // the bucket's own file is not re-sent
    expect(up.failed).toEqual([]);
    // A redrawn picture replaces the old one under its own name.
    expect(requests[requests.length - 1]).toEqual(["PUT", `${BASE}/scenes/scene_phone_desk.webp`, "image/webp", null]);

    // Both reach the SQL, so a scene drawn on an earlier night keeps its picture.
    const sql = scenes.toSql(survey);
    expect(sql.includes("scene_corridor.webp") && sql.includes("scene_phone_desk.webp")).toBe(true);
  });

  /** One file over the bucket's limit must not strand every approved picture
   *  on the runner. An oversized file is refused before a byte is sent, a
   *  refusal from the bucket is recorded against its file, and every other file
   *  still goes. */
  test("one bad upload does not stop the rest", async () => {
    const tmp = tmpPath();
    const uploaded: string[] = [];

    const fakeRaw = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
      if (url.endsWith("scene_corridor.webp")) {
        throw new RuntimeError(`PUT ${url} → HTTP 400: EntityTooLarge`);
      }
      uploaded.push(url.slice(url.lastIndexOf("/") + 1));
      return bytes("");
    };

    patch(http, "request", fakeRaw);
    setConfig({ SCENE_MAX_BYTES: 10 });
    mkdirSync(path.join(tmp, "scenes"));
    writeFileSync(path.join(tmp, "scenes", "scene_phone_desk.webp"), "x".repeat(11)); // too big
    writeFileSync(path.join(tmp, "scenes", "scene_corridor.webp"), "x".repeat(5)); // bucket says no
    writeFileSync(path.join(tmp, "scenes", "scene_elevator_hall.webp"), "x".repeat(5)); // fine
    writeFileSync(path.join(tmp, "scenes", "scene_izakaya_table.webp"), "x".repeat(5)); // fine

    const bucket = new scene_art.Bucket({ creds: CREDS });
    const survey = scenes.survey({ mediaDir: tmp });
    const up = await scene_art.uploadApproved(survey, bucket, { mediaDir: tmp });

    expect(sorted(up.sent)).toEqual(["scene_elevator_hall.webp", "scene_izakaya_table.webp"]);
    expect(sorted(uploaded)).toEqual(["scene_elevator_hall.webp", "scene_izakaya_table.webp"]);
    expect(up.failed_paths).toEqual(new Set(["scene_phone_desk.webp", "scene_corridor.webp"]));
    const why = Object.fromEntries(up.failed);
    expect(why["scene_phone_desk.webp"]).toBe("11 bytes is over the bucket's 10 byte limit");
    expect(why["scene_corridor.webp"]).toContain("EntityTooLarge");
    expect(up.summary().includes("scene_phone_desk.webp") && up.summary().includes("Not uploaded")).toBe(true);

    // The SQL must describe the bucket, not this machine: the two files that
    // did not get there read as "no picture", and the two that did are kept.
    const safe = scene_art.without(survey, up.failed_paths);
    const sql = scenes.toSql(safe);
    expect(sql.includes("scene_elevator_hall.webp") && sql.includes("scene_izakaya_table.webp")).toBe(true);
    expect(!sql.includes("scene_phone_desk.webp") && !sql.includes("scene_corridor.webp")).toBe(true);
    // The corridor, having no picture of its own in the bucket, borrows the
    // elevator hall's until it does; the desk phone's stand-in has none to lend.
    expect(sql).toContain("('scene_corridor', 'オフィスの廊下', 'scene_elevator_hall.webp')");
    expect(sql).not.toContain("'scene_phone_desk'");
    // ...and the survey itself is untouched.
    const withArt = new Set(survey.filter((s) => s.has_art).map((s) => s.scene_id));
    expect(withArt.has("scene_phone_desk") && withArt.has("scene_corridor")).toBe(true);
  });

  test("nothing failed means nothing to say", () => {
    expect(new scene_art.UploadResult().summary()).toBe("");
    expect(scene_art.without([], new Set())).toEqual([]);
  });

  test("a local file wins over the bucket", () => {
    const tmp = tmpPath();
    mkdirSync(path.join(tmp, "scenes"));
    writeFileSync(path.join(tmp, "scenes", "scene_corridor.png"), "new");
    const survey = scenes.survey({ mediaDir: tmp, remote: new Set(["scene_corridor.webp"]) });
    const corridor = survey.filter((s) => s.scene_id === "scene_corridor");
    expect(corridor.length).toBe(1);
    expect(corridor[0].path).toBe("scene_corridor.png");
  });

  test("the openai provider refuses without a key", async () => {
    delEnv("OPENAI_API_KEY");
    const err = await new scene_art.OpenAIImageProvider().generate("x").catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.message).toMatch(/OPENAI_API_KEY/);
  });

  test("the openai provider asks for webp at three by two", async () => {
    const captured: { url?: string; body?: any; auth?: string } = {};

    const fakeJson = async (method: string, url: string, body: unknown,
                            opts: { headers?: Record<string, string> | null } = {}) => {
      Object.assign(captured, { url, body, auth: opts.headers!["Authorization"] });
      return { "data": [{ "b64_json": Buffer.from("webp-bytes").toString("base64") }] };
    };

    patch(http, "jsonRequest", fakeJson);
    const out = await new scene_art.OpenAIImageProvider({ apiKey: "k" }).generate("draw");
    expect(Buffer.from(out).toString("latin1")).toBe("webp-bytes");
    expect(captured.auth).toBe("Bearer k");
    expect(captured.body["output_format"]).toBe("webp");
    expect(captured.body["size"]).toBe("1536x1024");
    expect(captured.body["n"]).toBe(1);
    // Asked for compressed output, because the bucket has a size limit and a
    // 1536×1024 "high" draft with no compression goes over it.
    expect(captured.body["output_compression"]).toBe(config.IMAGE_COMPRESSION);
    expect(0 <= config.IMAGE_COMPRESSION && config.IMAGE_COMPRESSION <= 100).toBe(true);
  });

  /** Once the bank is full every night is this night, and the workflow
   *  appends the summary file whatever happened — so it has to exist. */
  test("the cli writes the summary even when there is nothing to draw", async () => {
    const tmp = tmpPath();
    mkdirSync(path.join(tmp, "scenes"));
    for (const scene of scenes.survey({ mediaDir: tmp })) {
      writeFileSync(path.join(tmp, "scenes", `${scene.scene_id}.webp`), "art");
    }
    const summary = path.join(tmp, "s.md");
    const rc = await cli.main({ argv: ["scenes", "--generate", "--provider", "placeholder",
                                       "--media-dir", tmp, "--summary", summary] });
    expect(rc).toBe(0);
    expect(statSync(summary).isFile()).toBe(true);
    expect(readFileSync(summary, "utf8")).toContain("nothing to draw");
  });

  test("the cli draws offline and writes the summary", async () => {
    const tmp = tmpPath();
    const cap = capture();
    const rc = await cli.main({ argv: ["scenes", "--generate", "--provider", "placeholder",
                                       "--media-dir", tmp, "--summary", path.join(tmp, "s.md")] });
    expect(rc).toBe(0);
    expect(readFileSync(path.join(tmp, "s.md"), "utf8").startsWith("## Scene artwork (placeholder)")).toBe(true);
    expect(statSync(path.join(tmp, "scenes", "placeholder")).isDirectory()).toBe(true);
    expect(cap.readouterr().out).toContain("nothing uploads them");
  });

  test("the cli refuses to upload without the bucket", async () => {
    const tmp = tmpPath();
    _noR2();
    expect(await cli.main({ argv: ["scenes", "--upload", "--media-dir", tmp] })).toBe(2);
  });

  test("the cli names an unknown scene", async () => {
    const tmp = tmpPath();
    _noR2();
    expect(await cli.main({ argv: ["scenes", "--generate", "scene_nowhere", "--provider", "placeholder",
                                   "--media-dir", tmp] })).toBe(2);
  });

  // ----- stand-ins and the refusal ledger ---------------------------------------

  test("a scene without a picture borrows its stand ins", () => {
    const tmp = tmpPath();
    mkdirSync(path.join(tmp, "scenes"));
    writeFileSync(path.join(tmp, "scenes", "scene_phone_desk.webp"), "art");
    const survey = scenes.survey({ mediaDir: tmp });
    const outside = survey.find((s) => s.scene_id === "scene_phone_mobile_outside")!;
    expect(outside.has_art).toBe(false);
    expect(scenes.standInFor(outside, survey)!.scene_id).toBe("scene_phone_desk");
    const sql = scenes.toSql(survey);
    expect(sql).toContain("('scene_phone_mobile_outside', '外出先で携帯電話', 'scene_phone_desk.webp')");
    expect(sql).toContain("borrows the picture of scene_phone_desk");
    // One hop only: the desk pair borrows from the open floor, which has nothing.
    const pair = survey.find((s) => s.scene_id === "scene_office_desk_pair")!;
    expect(scenes.standInFor(pair, survey)).toBeNull();
    // A scene with its own picture lends and never borrows.
    const desk = survey.find((s) => s.scene_id === "scene_phone_desk")!;
    expect(scenes.standInFor(desk, survey)).toBeNull();
  });

  test("every stand in is a bank scene with a brief", () => {
    for (const [a, b] of Object.entries(scenes.STAND_INS)) {
      expect(a in scenes.SCENE_BRIEFS && b in scenes.SCENE_BRIEFS).toBe(true);
      expect(a).not.toBe(b);
    }
  });

  test("the ledger counts refusals and records new ones", async () => {
    const listed: string[] = [];
    const sent: [string, unknown, string][] = [];

    const fakeRaw = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
      if (method === "GET") {
        listed.push(url);
        return _listing(["scenes/rejected/scene_phone_mobile_outside-1.txt",
                         "scenes/rejected/scene_phone_mobile_outside-3.txt",
                         "scenes/rejected/scene_corridor-2.txt",
                         "scenes/rejected/junk"]);
      }
      sent.push([url, opts.body, opts.headers!["content-type"]]);
      return bytes("");
    };

    patch(http, "request", fakeRaw);
    const bucket = new scene_art.Bucket({ creds: CREDS });
    expect(await bucket.refusals()).toEqual({ "scene_phone_mobile_outside": 3, "scene_corridor": 2 });
    expect(listed.length === 1 && listed[0].includes("prefix=scenes%2Frejected%2F")).toBe(true);
    await bucket.recordRefusal("scene_corridor", 3, ["readable text", "wrong setting"]);
    expect(sent[0][0]).toBe(`${BASE}/scenes/rejected/scene_corridor-3.txt`);
    expect(sent[0][1]).toEqual(bytes("readable text\nwrong setting\n"));
  });

  /** The ledger grows by a file per refusal; a listing read only to its first
   *  page would forget the rest and draw given-up pictures again. */
  test("a long ledger is read to its end", async () => {
    const pages = iter([
      _listing(["scenes/rejected/scene_corridor-1.txt"], { truncated: true, token: "next" }),
      _listing(["scenes/rejected/scene_corridor-6.txt"]),
    ]);
    const urls: string[] = [];
    patch(http, "request", async (m: string, url: string, opts: RequestOpts = {}) => {
      urls.push(url);
      return pages();
    });
    expect(await new scene_art.Bucket({ creds: CREDS }).refusals()).toEqual({ "scene_corridor": 6 });
    expect(urls[1]).toContain("continuation-token=next");
  });

  test("a scene at its lifetime allowance is not drawn again", async () => {
    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp }).filter((s) =>
      ["scene_phone_mobile_outside", "scene_corridor"].includes(s.scene_id));
    const provider = new _Real();
    const refused: [string, number][] = [];
    const result = await scene_art.draw(wanted, {
      provider, mediaDir: tmp, attempts: 3, lifetime: 6,
      prior: { "scene_phone_mobile_outside": 6, "scene_corridor": 5 },
      review: (img, mt, sc) => verdict(false, "readable text drawn in"),
      onReject: (sid, n, why) => {
        refused.push([sid, n]);
      },
    });
    const byId = new Map(result.drawn.map((d) => [d.scene_id, d]));
    const [outside, corridor] = [byId.get("scene_phone_mobile_outside")!, byId.get("scene_corridor")!];
    expect(outside.given_up && outside.attempts === 0 && outside.prior === 6).toBe(true);
    // One draft left in the corridor's allowance, so one is drawn — not three.
    expect(!corridor.given_up && corridor.attempts === 1 && provider.calls === 1).toBe(true);
    expect(refused).toEqual([["scene_corridor", 6]]);
    expect(existsSync(path.join(tmp, "scenes", "rejected", "scene_corridor-6.txt"))).toBe(true);
    expect(result.summary().includes("given up") && result.summary().includes("1 (5)")).toBe(true);
    expect(result.failed.length > 0 && result.approved.length === 0).toBe(true);
  });

  // ----- per-item pictures (画像把握) --------------------------------------------

  test("the survey lists every committed picture with its brief and options", () => {
    const tmp = tmpPath();
    const pics = _pictures(tmp);
    expect(pics.length, "the reference batch of 画像把握 ships four pictures").toBeGreaterThan(0);
    for (const s of pics) {
      expect(s.scene_id.startsWith(scenes.PICTURE_PREFIX)).toBe(true);
      expect(s.used_by).toEqual(["gazou_haaku"]);
      expect(s.cell_count).toBe(1);
      expect(splitWs(s.brief!).length >= 25 && s.options.length === 4).toBe(true);
      expect(s.answer !== null && s.question !== "").toBe(true);
      expect(s.has_art).toBe(false);
    }
    // After the bank in the commissioning order: one picture serves one item.
    const order = scenes.survey({ mediaDir: tmp });
    expect(order.slice(0, order.length - pics.length).every((s) => !s.is_picture)).toBe(true);
  });

  test("a picture prompt is the brief and the reviewer sees the four descriptions", () => {
    const tmp = tmpPath();
    const pic = _pictures(tmp)[0];
    const drawn = scenes.imagePrompt(pic);
    expect(drawn.includes(pic.brief!) && drawn.includes("must not contain")).toBe(true);
    expect(drawn).toContain("No words or letters");
    const reviewed = scenes.promptFor(pic);
    for (const opt of pic.options) {
      expect(reviewed).toContain(opt);
    }
    expect(reviewed.includes("✔") && reviewed.includes(pic.question)).toBe(true);
  });

  test("a picture has no stand in", () => {
    const tmp = tmpPath();
    const survey = scenes.survey({ mediaDir: tmp });
    for (const pic of _pictures(tmp)) {
      expect(scenes.standInFor(pic, survey)).toBeNull();
    }
  });

  test("the visual gate refuses a picture a reader describes differently", async () => {
    const tmp = tmpPath();
    const pic = _pictures(tmp)[0];
    patch(llm, "reviewSceneImage", async (image: Uint8Array, mt: string, brief: string, rules: Record<string, string>) =>
      cleanFlags(rules));
    let picks = iter([pic.answer!, pic.answer!, (pic.answer! + 1) % 4]);
    const asked: string[] = [];
    patch(llm, "answerFromImage", async (image: Uint8Array, mt: string, q: string, opts: string[]) => {
      asked.push(q);
      return { "choice": picks(), "reason": "x" };
    });
    const v = await scene_art.reviewWithModel(bytes("img"), "image/png", pic);
    expect(!v.approved && v.reasons[0].includes("rather than the marked description")).toBe(true);
    expect(asked, "three trials, stopped at the first miss").toEqual([pic.question, pic.question, pic.question]);

    picks = iter([pic.answer!, pic.answer!, pic.answer!]);
    expect((await scene_art.reviewWithModel(bytes("img"), "image/png", pic)).approved).toBe(true);
  });

  test("the picture rules are checked before the reader sits it", async () => {
    const tmp = tmpPath();
    const pic = _pictures(tmp)[0];
    patch(llm, "reviewSceneImage", async (image: Uint8Array, mt: string, brief: string, rules: Record<string, string>) =>
      cleanFlags(rules, (r) => r === "unclear"));
    patch(llm, "answerFromImage", async (): Promise<Record<string, any>> => {
      throw new Error("not asked");
    });
    const v = await scene_art.reviewWithModel(bytes("img"), "image/png", pic);
    expect(v.approved).toBe(false);
    expect(v.reasons).toEqual([scene_art.PICTURE_RULES["unclear"]]);
  });

  test("a night draws only so many pictures", async () => {
    const tmp = tmpPath();
    const cap = capture();
    setConfig({ NIGHT_MAX_PICTURES: 2 });
    // About the cap, not the ledger: with nothing withdrawn the library holds
    // more pictures than the cap allows, which is what there has to be to test it.
    patch(withdrawn.seams, "ids", () => new Set<string>());
    expect(await cli.main({ argv: ["scenes", "--generate", "--provider", "placeholder", "--only", "pictures",
                                   "--media-dir", tmp] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out.split("| pic_").length - 1).toBe(2);
  });

  /** Nobody will see it, so nobody pays for it. */
  test("a withdrawn question gets no picture", () => {
    const every = new Set(scenes.pictureItems().map(([, it]) => it["id"] as string));
    const victim = sorted(every)[0];
    patch(withdrawn.seams, "ids", () => new Set([victim]));
    expect(new Set(scenes.pictureItems().map(([, it]) => it["id"])).has(victim)).toBe(false);
  });

  /** A job that cannot list the bucket would see every scene as undrawn and
   *  pay to draw the whole bank again; so would one run before the library was
   *  moved into R2. Neither draws.
   *
   *  The workflow counts the bucket with this module now
   *  (`(await new Bucket().list()).size`, imported from bjt/scene_art.ts), so
   *  that is the line looked for, where the Python test looked for
   *  `scene_art.Bucket().list()`. */
  test("the nightly job never draws into a bucket it cannot see or that is empty", () => {
    const text = readFileSync(path.join(config.ROOT, ".github/workflows/nightly.yml"), "utf8");
    const start = text.indexOf("name: which of tonight's work is unlocked");
    expect(start).toBeGreaterThanOrEqual(0);
    const keys = text.slice(start, text.indexOf("- name:", start + 1));
    expect(keys).toContain('await import("./bjt/scene_art.ts")');
    expect(keys).toContain("new Bucket().list()");
    const guard = keys.indexOf('[ "$HAVE_STORAGE" != "true" ] || [ "$drawn" = "error" ] || [ "$drawn" = "0" ]');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard < keys.indexOf('echo "art=true"'), "the refusal comes before any yes").toBe(true);
  });
});
