/**
 * The media pipeline: channel treatment, the synthesis job, and the scene bank.
 *
 * All of it runs offline. The `silent` provider is not a mock hidden in a test
 * directory — it is how the whole pipeline is exercised without a vendor account,
 * and it is exercised here the same way it is in production.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as batch from "../bjt/batch.ts";
import * as config from "../bjt/config.ts";
import * as fixtures from "../bjt/fixtures.ts";
import { get, or, RuntimeError, sorted } from "../bjt/py.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import * as schemas from "../bjt/schemas.ts";
import * as audition from "../bjt/tts/audition.ts";
import * as channel from "../bjt/tts/channel.ts";
import * as plan from "../bjt/tts/plan.ts";
import * as providers from "../bjt/tts/providers.ts";
import * as synth from "../bjt/tts/synth.ts";
import { hatsugenBundle } from "./conftest.ts";
import { bytes, capture, delEnv, patch, setEnv, tmpPath } from "./helpers.ts";

/** A signal with content at both ends of the band, so a filter that does
 *  nothing is distinguishable from one that works. */
function _tone(opts: { seconds?: number; rate?: number; amplitude?: number } = {}): Uint8Array {
  const seconds = opts.seconds ?? 0.5;
  const rate = opts.rate ?? 24000;
  const amplitude = opts.amplitude ?? 12000;
  const n = Math.trunc(seconds * rate);
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(Math.trunc(amplitude * (Math.sin(2 * Math.PI * 120 * i / rate)
                                         + Math.sin(2 * Math.PI * 6000 * i / rate)) / 2));
  }
  return channel._encode(samples, rate);
}

/** `wave.open(io.BytesIO(data), "rb").getframerate()`. */
function _framerate(data: Uint8Array): number {
  return channel._decode(data)[1];
}

function _samples(hz: number, opts: { rate?: number; seconds?: number; amplitude?: number } = {}): number[] {
  const rate = opts.rate ?? 24000;
  const seconds = opts.seconds ?? 0.3;
  const amplitude = opts.amplitude ?? 12000;
  const n = Math.trunc(seconds * rate);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.trunc(amplitude * Math.sin(2 * Math.PI * hz * i / rate)));
  return out;
}

function _rms(samples: number[]): number {
  let s = 0;
  for (const x of samples) s += x * x;
  return (s / Math.max(1, samples.length)) ** 0.5;
}


const CAST = new Set([plan.NARRATOR_VOICE, ...Object.values(plan.RELATION_VOICES), ...plan.DIALOGUE_VOICES]);

function _difference<T>(a: Iterable<T>, b: Iterable<T>): Set<T> {
  const bb = new Set(b);
  return new Set([...a].filter((x) => !bb.has(x)));
}

describe("media", () => {
  // ----- channel treatment --------------------------------------------------

  test("phone treatment resamples to the telephone rate", () => {
    const out = channel.applyChannel(_tone(), "phone");
    expect(_framerate(out)).toBe(plan.CHANNEL_PROFILES["phone"]["sample_rate"]);
  });

  /** The point of the phone profile is that business phone Japanese is harder
   *  to hear. A profile that resamples and leaves the band alone is decoration.
   *
   *  The filters are measured directly rather than through `applyChannel`,
   *  because that normalises afterwards — it deliberately brings every clip back
   *  to one level, which would hide exactly the attenuation being asserted. */
  test("the band limit removes what a telephone removes", () => {
    const [low, high] = plan.CHANNEL_PROFILES["phone"]["band"] as [number, number];

    // Above the band: the sibilance that separates いたします from いただきます.
    const above = _samples(6000, { rate: 24000 });
    expect(_rms(channel._onePoleLowPass(above, 24000, high))).toBeLessThan(_rms(above) * 0.6);

    // Below it: rumble a telephone line never carries.
    const below = _samples(80, { rate: 24000 });
    expect(_rms(channel._onePoleHighPass(below, 24000, low))).toBeLessThan(_rms(below) * 0.6);

    // Inside it: speech must survive.
    const inside = _samples(1000, { rate: 24000 });
    const kept = channel._onePoleHighPass(
      channel._onePoleLowPass(inside, 24000, high), 24000, low,
    );
    expect(_rms(kept)).toBeGreaterThan(_rms(inside) * 0.7);
  });

  test("in person keeps the full band", () => {
    const out = channel.applyChannel(_tone(), "in_person");
    expect(_framerate(out)).toBe(24000);
  });

  /** `written` reaching here means something upstream planned a clip for a
   *  reading item. The right response is a clean recording plus a failing test
   *  elsewhere, not a crash in the middle of two hundred files. */
  test("an unknown channel passes through rather than raising", () => {
    const raw = _tone();
    expect(channel.applyChannel(raw, "written")).toEqual(raw);
  });

  /** A learner must not be able to hear which option was recorded differently. */
  test("clips come out at a consistent level", () => {
    const quiet = channel.applyChannel(_tone({ amplitude: 800 }), "in_person");
    const loud = channel.applyChannel(_tone({ amplitude: 20000 }), "in_person");
    const [a] = channel._decode(quiet);
    const [b] = channel._decode(loud);
    const peak = (xs: number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(Math.abs(peak(a) - peak(b))).toBeLessThan(500);
  });

  test("duration is measured not guessed", () => {
    const ms = channel.durationMs(_tone({ seconds: 0.5 }));
    expect(450 <= ms && ms <= 550).toBe(true);
  });

  // ----- the synthesis job --------------------------------------------------

  /** On a fresh runner media/ is empty; the database says what exists, and a
   *  clip on that list is left exactly as the learner first heard it. */
  test("clips already live are neither made nor pointed at again", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const haveFile = path.join(tmp, "have.txt");
    const ids: string[] = bundle["audio_manifest"].map((c: any) => c["clip_id"]);
    writeFileSync(haveFile, `# from psql\n${ids[0]}\n\n${ids[1]}\n`, "utf8");
    const have = synth.readHave(haveFile);
    expect(have).toEqual(new Set([ids[0], ids[1]]));

    const report = await synth.synthesiseBundle(bundle, { outDir: tmp, have });
    expect(sorted(report.live)).toEqual(sorted(have));
    expect(report.written.length).toBe(ids.length - 2);
    expect(existsSync(path.join(tmp, "audio", synth.storagePath(ids[0], "silent")))).toBe(false);
    const sql = synth.toSql(report);
    expect(sql.includes(ids[0])).toBe(false);
    expect(sql).toContain(ids[2]);
    expect(report.summary()).toContain("already live");
  });

  test("a bundle that is entirely live has nothing to apply", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const have = new Set<string>(bundle["audio_manifest"].map((c: any) => c["clip_id"]));
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp, have });
    expect(report.clips.length).toBe(0);
    expect(synth.toSql(report)).toContain("Nothing to apply");
  });

  test("uploading sends every clip and a failure keeps it out of the sql", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp });
    const bad = report.written[0].path;
    const sent: string[] = [];

    class FakeBucket {
      name = "audio";
      configured = true;

      async upload(p: string, data: Uint8Array, contentType: string, opts: { upsert?: boolean } = {}): Promise<void> {
        expect(contentType).toBe("audio/wav");
        if (p === bad) {
          throw new RuntimeError("413 too large");
        }
        sent.push(p);
      }
    }

    const up = await synth.uploadClips(report, new FakeBucket(), { mediaDir: tmp });
    expect(sent.length).toBe(report.clips.length - 1);
    expect(up.failed).toEqual([[bad, "413 too large"]]);
    expect(up).toBeInstanceOf(scene_art.UploadResult);

    report.drop(new Set(report.clips.filter((c) => c.path === bad).map((c) => c.clip_id)));
    expect(synth.toSql(report)).not.toContain(bad);
    expect(report.clips.every((c) => synth.toSql(report).includes(c.path))).toBe(true);
  });

  test("synthesis produces a clip per manifest entry", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp });
    expect(report.written.length).toBe(bundle["audio_manifest"].length);
    expect(report.failed).toEqual([]);
    for (const clip of report.written) {
      expect(existsSync(path.join(tmp, "audio", clip.path))).toBe(true);
      expect(clip.duration_ms).toBeGreaterThan(0);
    }
  });

  /** Clip ids are content hashes, so re-running a batch after fixing one item
   *  must re-synthesise that item and nothing else. */
  test("a second run reuses every clip", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    await synth.synthesiseBundle(bundle, { outDir: tmp });
    const second = await synth.synthesiseBundle(bundle, { outDir: tmp });
    expect(second.written).toEqual([]);
    expect(second.reused.length).toBe(bundle["audio_manifest"].length);
  });

  /** The first time this points at a paid provider it must not be able to
   *  spend the afternoon's money in one command. */
  test("the limit is a budget", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp, limit: 2 });
    expect(report.written.length).toBe(2);
  });

  test("one failing clip does not lose the others", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();

    class Flaky implements providers.Provider {
      name = "flaky";
      static seen = 0;

      async synthesize(text: string, voice: string, opts: { instructions?: string } = {}): Promise<Uint8Array> {
        Flaky.seen += 1;
        if (Flaky.seen === 2) {
          throw new RuntimeError("provider said no");
        }
        return channel.silence(0.5);
      }
    }

    const report = await synth.synthesiseBundle(bundle, { provider: new Flaky(), outDir: tmp });
    expect(report.failed.length).toBe(1);
    expect(report.written.length).toBe(bundle["audio_manifest"].length - 1);
  });

  /** 総合読解 is silent by design. Zero clips is an outcome, not a failure. */
  test("a reading type has no audio and says so", async () => {
    const tmp = tmpPath();
    const reading = batch.buildBundle(
      "sougou_dokkai", "J1", [fixtures.FIXTURES["sougou_dokkai"]], "test",
    );
    const report = await synth.synthesiseBundle(reading, { outDir: tmp });
    expect(report.clips.length).toBe(0);
    expect(report.summary()).toContain("read, not heard");
    expect(synth.toSql(report)).toContain("Nothing to apply");
  });

  /** A placeholder must never be mistakable for a real recording, in storage
   *  or in a review. */
  test("silent clips are marked as such in their path", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp });
    expect(report.written.every((c) => c.path.startsWith("silent/"))).toBe(true);
  });

  /** The clip rows come from `bjt publish`, off the same manifest. A missing
   *  row means the bundle was never published, and inventing one hides that. */
  test("the sql updates rather than inserts", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const sql = synth.toSql(await synth.synthesiseBundle(bundle, { outDir: tmp }));
    expect(sql).toContain("update audio_clips");
    expect(sql).not.toContain("insert into audio_clips");
  });

  test("the run leaves a record", async () => {
    const bundle = hatsugenBundle();
    const tmp = tmpPath();
    const report = await synth.synthesiseBundle(bundle, { outDir: tmp });
    const out = synth.writeReport(report, path.join(tmp, "reports", "r.json"));
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written["written"].length).toBe(bundle["audio_manifest"].length);
  });

  // ----- pronunciation ------------------------------------------------------

  /** A learner who hears 代替 as だいがえ and repeats it in an interview has
   *  been actively harmed by this app. */
  test("the pronunciation dictionary is applied", () => {
    expect(providers.applyPronunciation("代替案をご検討ください")).toBe("だいたい案をご検討ください");
  });

  test("ssml keeps the written form visible", () => {
    const ssml = providers.GoogleProvider.toSsml("代替案");
    expect(ssml.includes("<sub") && ssml.includes("代替") && ssml.includes("だいたい")).toBe(true);
  });

  /** A cast assigned by accident is one the whole library inherits. */
  test("a provider with no cast refuses rather than guessing", async () => {
    const err = await new providers.GoogleProvider().synthesize("こんにちは", "someone_new").catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.message).toMatch(/no Google Cloud voice cast/);
  });

  test("every cast voice has a direction", () => {
    const missing = _difference(CAST, Object.keys(providers.VOICE_DIRECTION));
    expect(missing.size, `no delivery direction for ${[...missing]}`).toBe(0);
  });

  /** `bjt synth` must run the day a key exists, for every role the plan can
   *  hand it — a refusal in the middle of a batch is a bill for the clips
   *  before it and nothing after. */
  test.each([
    ["GeminiProvider", providers.GeminiProvider],
    ["OpenAIProvider", providers.OpenAIProvider],
    ["GoogleProvider", providers.GoogleProvider],
  ] as const)("every real provider casts every voice [%s]", (_label, cls) => {
    const missing = _difference(CAST, Object.keys(cls.VOICE_IDS));
    expect(missing.size, `${new cls().name} has no voice for ${[...missing]}`).toBe(0);
    // Distinct voices, or the learner is back to speaker identification for
    // whichever two roles share one.
    expect(new Set(Object.values(cls.VOICE_IDS)).size).toBe(Object.keys(cls.VOICE_IDS).length);
  });

  /** The house style is the one lever on "robotic" a provider gives us. */
  test("the direction says native office japanese and nothing else", () => {
    const note = providers.directionFor("reception_f");
    for (const phrase of ["pitch accent", "business pace", "exactly as written"]) {
      expect(note).toContain(phrase);
    }
    expect(note).toContain(providers.VOICE_DIRECTION["reception_f"]);
  });

  test("the openai request carries the direction and asks for wav", async () => {
    const sent: { url?: string; body?: any; headers?: Record<string, string> } = {};

    const fakePost = async (url: string, body: Record<string, unknown>, headers: Record<string, string>) => {
      Object.assign(sent, { url, body, headers });
      return channel.silence(0.2);
    };

    patch(providers.seams, "post", fakePost);
    const out = await new providers.OpenAIProvider({ apiKey: "k" }).synthesize("代替案です", "manager_m");
    expect(Buffer.from(out.subarray(0, 4)).toString("latin1")).toBe("RIFF");
    expect(sent.body["response_format"]).toBe("wav");
    expect(sent.body["voice"]).toBe(providers.OpenAIProvider.VOICE_IDS["manager_m"]);
    expect(sent.body["input"]).toBe("だいたい案です");
    expect(sent.body["instructions"]).toContain(providers.HOUSE_STYLE);
    expect(sent.headers!["Authorization"]).toBe("Bearer k");
    // No rate multiplier: `speed` is a time-stretch of finished audio rather
    // than a person speaking faster, and it can be heard. Pace is asked for in
    // the house style, in words, or not at all.
    expect("speed" in sent.body).toBe(false);
  });

  /** Asking an instructable model for reductions and a rhythm that varies gets
   *  a performance: swallowed syllables, and a theatrical beat before the phrase
   *  the question turns on — which is a hint as well as a distraction. The
   *  direction asks for ordinary business pace and stops. */
  test("the direction asks for a plain delivery not a performance", () => {
    const note = providers.directionFor("staff_mid_m");
    for (const phrase of ["Ordinary business pace", "no theatrical acting", "exactly as written"]) {
      expect(note).toContain(phrase);
    }
    for (const wish of ["connected speech", "reductions", "brisk", "beat before the point"]) {
      expect(note).not.toContain(wish);
    }
  });

  /** Gemini returns headerless PCM; the rest of the pipeline reads WAV. */
  test("the gemini response is wrapped into wav", async () => {
    const pcm = Buffer.from(new Array(2400).fill([0x00, 0x10]).flat()); // a tenth of a second at 24 kHz
    const reply = { "candidates": [{ "content": { "parts": [{ "inlineData": {
      "mimeType": "audio/L16;codec=pcm;rate=24000",
      "data": pcm.toString("base64"),
    } }] } }] };
    const sent: { url?: string; body?: any; headers?: Record<string, string> } = {};

    const fakePost = async (url: string, body: Record<string, unknown>, headers: Record<string, string>) => {
      Object.assign(sent, { url, body, headers });
      return bytes(JSON.stringify(reply));
    };

    patch(providers.seams, "post", fakePost);
    const out = await new providers.GeminiProvider({ apiKey: "k" }).synthesize("承知いたしました。", "staff_mid_f");
    expect(channel.durationMs(out)).toBe(100);
    expect(sent.headers!["x-goog-api-key"]).toBe("k");
    const cfg = sent.body["generationConfig"];
    expect(cfg["responseModalities"]).toEqual(["AUDIO"]);
    expect(cfg["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]).toBe(
      providers.GeminiProvider.VOICE_IDS["staff_mid_f"]);
    const prompt: string = sent.body["contents"][0]["parts"][0]["text"];
    expect(prompt.endsWith("承知いたしました。")).toBe(true);
    expect(prompt).toContain(providers.HOUSE_STYLE);
  });

  test("gemini says so when there is no audio in the reply", () => {
    expect(() => providers.GeminiProvider.wavFromResponse(bytes('{"error": {"message": "quota"}}')))
      .toThrow(RuntimeError);
    expect(() => providers.GeminiProvider.wavFromResponse(bytes('{"error": {"message": "quota"}}')))
      .toThrow(/no audio/);
  });

  /** No key: silent, so the pipeline still runs. A key: that provider. A
   *  pinned choice wins over any key, because the cast is fixed for the life of
   *  the library and must not follow whichever secret was set last. */
  test("the provider is picked from the environment", () => {
    for (const keys of Object.values(providers.CREDENTIALS)) {
      for (const key of keys) {
        delEnv(key);
      }
    }
    delEnv(providers.PROVIDER_ENV);
    expect(providers.defaultProvider()).toBe("silent");

    // Another provider's key alone does not make it the voice: the library's
    // provider is a decision in code, not the last secret somebody set.
    setEnv("GEMINI_API_KEY", "k");
    expect(providers.defaultProvider()).toBe("silent");
    setEnv("OPENAI_API_KEY", "k");
    expect(providers.defaultProvider()).toBe(providers.DEFAULT);
    expect(providers.DEFAULT).toBe("openai");
    expect(providers.available()).toEqual(["openai", "gemini"]);

    setEnv(providers.PROVIDER_ENV, "gemini");
    expect(providers.getProvider("auto").name).toBe("gemini");
  });

  test("the voices audition says one line in every openai voice", async () => {
    const tmp = tmpPath();
    const asked: string[] = [];

    const fakePost = async (url: string, body: Record<string, unknown>, headers: Record<string, string>) => {
      asked.push(body["voice"] as string);
      return channel.silence(0.2);
    };

    patch(providers.seams, "post", fakePost);
    setEnv("OPENAI_API_KEY", "k");
    const report = await audition.run({ providers: [], mediaDir: tmp, voices: true });
    expect(report.failed).toEqual([]);
    expect(asked).toEqual([...providers.OpenAIProvider.CANDIDATE_VOICES]);
    const page = readFileSync(path.join(tmp, "audition", "index.html"), "utf8");
    expect(page).toContain('src="openai-voices/nova.wav"');
  });

  // ----- the audition ---------------------------------------------------------

  test("the audition writes every voice and a page to compare them", async () => {
    const tmp = tmpPath();
    const report = await audition.run({ providers: ["silent"], mediaDir: tmp });
    expect(report.failed).toEqual([]);
    const names = new Set(report.written.map((p) => path.basename(p)));
    expect(names.has("narrator_f.wav") && names.has("staff_mid_m.phone.wav")).toBe(true);
    expect(new Set(audition.LINES.map(([v]) => v))).toEqual(CAST);
    const page = readFileSync(path.join(tmp, "audition", "index.html"), "utf8");
    expect(page).toContain('src="silent/manager_m.wav"');
    expect(page).toContain("代替"); // the dictionary reading is on the page to be judged
  });

  // ----- the scene bank -----------------------------------------------------

  test("the survey covers every scene the tables ask for", () => {
    const tmp = tmpPath();
    const survey = scenes.survey({ mediaDir: tmp });
    expect(survey.length).toBeGreaterThan(0);
    expect(survey.every((s) => s.cell_count > 0)).toBe(true);
    expect(survey.some((s) => s.has_art)).toBe(false);
  });

  /** Most-wanted first. The bank is shared, so a scene three types use earns
   *  its drawing before one a single cell wants. */
  test("the survey is a commissioning order", () => {
    const tmp = tmpPath();
    const survey = scenes.survey({ mediaDir: tmp });
    const wanted = survey.filter((s) => !s.has_art).map((s) => s.cell_count);
    expect(wanted).toEqual(sorted(wanted, { reverse: true }));
  });

  test("artwork on disk is found and published", () => {
    const tmp = tmpPath();
    mkdirSync(path.join(tmp, "scenes"));
    writeFileSync(path.join(tmp, "scenes", "scene_phone_desk.webp"), "not really an image");
    const survey = scenes.survey({ mediaDir: tmp });
    const found = survey.filter((s) => s.has_art);
    expect(found.map((s) => s.scene_id)).toEqual(["scene_phone_desk"]);

    const sql = scenes.toSql(survey);
    expect(sql).toContain("scene_phone_desk.webp");
    // A scene with no art is left exactly as it is: image_path stays null and
    // the app draws the item without a picture.
    expect(sql).not.toContain("scene_corridor");
  });

  test("no artwork produces no statements", () => {
    const tmp = tmpPath();
    expect(scenes.toSql(scenes.survey({ mediaDir: tmp }))).toContain("Nothing to apply");
  });

  test("the brief forbids what makes a picture unusable", () => {
    const tmp = tmpPath();
    const brief = scenes.promptFor(scenes.survey({ mediaDir: tmp })[0]);
    for (const clause of ["readable text", "likeness", "makes the listening optional"]) {
      expect(brief).toContain(clause);
    }
  });

  // ----- the command line -------------------------------------------------------

  /** Silent clips in the real bucket would make the app play nothing where it
   *  now shows the text — worse than no audio at all. */
  test("the cli refuses to upload silence", async () => {
    const tmp = tmpPath();
    const cap = capture();
    delEnv("BJT_TTS_PROVIDER");
    const rc = await cli.main({ argv: ["synth", path.join(config.ROOT, "batches", "hatsugen_choukai_J2_001.json"),
                                       "--provider", "silent", "--upload", "--media-dir", tmp] });
    expect(rc).toBe(2);
    expect(cap.readouterr().err).toContain("ship silence");
  });

  test("the cli names the provider it used", async () => {
    const tmp = tmpPath();
    const cap = capture();
    for (const keys of Object.values(providers.CREDENTIALS)) {
      for (const key of keys) {
        delEnv(key);
      }
    }
    delEnv("BJT_TTS_PROVIDER");

    const rc = await cli.main({ argv: ["synth", path.join(config.ROOT, "batches", "hatsugen_choukai_J2_001.json"),
                                       "--media-dir", tmp, "--out", path.join(tmp, "a.sql")] });
    expect(rc).toBe(0);
    const out = cap.readouterr().out;
    expect(out.includes("(silent)") && out.includes("SILENT placeholder")).toBe(true);
    expect(existsSync(path.join(tmp, "a.sql"))).toBe(true);
  });

  /** The four descriptions of a 画像把握 picture are heard in the narrator's
   *  voice, as on the exam — nobody drawn is saying them — and in room tone. */
  test("a pictures descriptions are read by the narrator", () => {
    const item = { ...fixtures.FIXTURES["gazou_haaku"], seed_cell: { "relation": "staff_to_visitor" } };
    const clips = plan.planItem(item, "x");
    const options = clips.filter((c) => c.kind === "option");
    expect(options.length).toBe(4);
    expect(new Set(options.map((c) => c.voice))).toEqual(new Set([plan.NARRATOR_VOICE]));
    expect(new Set(options.map((c) => c.channel))).toEqual(new Set(["in_person"]));
    expect(clips.filter((c) => c.kind === "narration").length).toBeGreaterThan(0);
  });

  /** A listening item shows nothing but 1 / 2 / 3 / 4 while its options play.
   *
   *  The number is what ties the sentence being heard to the button that answers
   *  it; without it the learner is holding four unlabelled sentences in their
   *  head, which is a memory test rather than a listening one. */
  test("every spoken option is introduced by its number", () => {
    const item = { ...fixtures.FIXTURES["hatsugen_choukai"],
                   seed_cell: { "relation": "subordinate_to_superior" } };
    const clips = plan.planItem(item, "x");
    const spoken = clips.filter((c) => ["option_label", "option"].includes(c.kind));
    expect(spoken.map((c) => c.kind)).toEqual(new Array(4).fill(["option_label", "option"]).flat());
    const labels = spoken.filter((c) => c.kind === "option_label");
    expect(labels.map((c) => c.text)).toEqual([...plan.OPTION_LABELS]);
    // The exam's own voice and room tone, whoever is speaking in the item and
    // down whatever line: a number is not said by anybody in the scene.
    expect(new Set(labels.map((c) => c.voice))).toEqual(new Set([plan.NARRATOR_VOICE]));
    expect(new Set(labels.map((c) => c.channel))).toEqual(new Set(["in_person"]));
  });

  /** Hashed from (voice, channel, text) like every other clip, so 「いち」 is
   *  synthesised once and shared by every item of every type that speaks its
   *  options — four files, not four per item. */
  test("the numbers are four clips for the whole library", () => {
    const a = { ...fixtures.FIXTURES["hatsugen_choukai"],
                seed_cell: { "relation": "subordinate_to_superior" } };
    const b = { ...fixtures.FIXTURES["gazou_haaku"], seed_cell: { "relation": "staff_to_visitor" } };
    const ids = new Set(plan.planItem(a, "a").filter((c) => c.kind === "option_label").map((c) => c.clip_id));
    expect(ids.size).toBe(4);
    expect(ids).toEqual(new Set(plan.planItem(b, "b").filter((c) => c.kind === "option_label").map((c) => c.clip_id)));
  });

  /** They follow the options, not the item: 総合読解 shows its four on the
   *  page, where a voice reading the numbers out would be noise. */
  test("a type that prints its options is given no numbers", () => {
    const clips = plan.planItem(fixtures.FIXTURES["sougou_dokkai"], "x");
    expect(clips.filter((c) => c.kind === "option_label")).toEqual([]);
  });

  /** The app finds the number clips by what is said and who says it — they
   *  are global rather than attached to an item — so the two files have to say
   *  the same thing. Read out of client/src/lib/db.ts, the same source the app
   *  imports, so a value that drifts drifts here too. */
  test("the app looks for the numbers this module plans", () => {
    const db = readFileSync(path.join(config.ROOT, "client", "src", "lib", "db.ts"), "utf8");
    const labels = /const OPTION_LABELS = \[([\s\S]*?)\];/.exec(db);
    expect(labels, "db.ts no longer declares OPTION_LABELS as expected").not.toBeNull();
    expect([...labels![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...plan.OPTION_LABELS]);
    const voice = /const NARRATOR_VOICE = "([^"]+)";/.exec(db);
    expect(voice !== null && voice[1] === plan.NARRATOR_VOICE).toBe(true);
  });

  /** SPOKEN_OPTION_TYPES in the practice screen decides whether a learner sees
   *  four numbers or four printed options; TYPE_AUDIO in this module decides
   *  whether the clips those numbers point at ever get synthesised. A type in
   *  one set and not the other is either options nobody hears introduced, or a
   *  number with nothing behind it — so the two lists have to name the same
   *  types. Read out of client/src/lib/playlist.ts, the same source the app
   *  imports, so a drift here is caught here rather than in the app. */
  test("the app shows numbers for exactly the types that speak their options", () => {
    const practice = readFileSync(path.join(config.ROOT, "client", "src", "lib", "playlist.ts"), "utf8");
    const block = /const SPOKEN_OPTION_TYPES = new Set\(\[([\s\S]*?)\]\);/.exec(practice);
    expect(block, "playlist.ts no longer declares SPOKEN_OPTION_TYPES as expected").not.toBeNull();
    const appTypes = new Set([...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const planTypes = new Set(Object.entries(plan.TYPE_AUDIO).filter(([, policy]) => policy["options"]).map(([t]) => t));
    expect(appTypes).toEqual(planTypes);
  });

  test("a picture item carries its brief and a scene of its own", () => {
    const item: Record<string, any> = { ...fixtures.FIXTURES["gazou_haaku"],
                                        seed_cell: { "id": "reception+staff_to_visitor+guiding_visitor@J2" } };
    const out = batch.toBundleItem(item);
    expect(out["scene_id"]).toBe(scenes.pictureSceneId(out["id"]));
    expect(out["image_brief"]).toBe(item["image_brief"]);
    // ...and re-validates as the model emitted it, without the derived scene id.
    expect(schemas.validateItem("gazou_haaku", batch.asGeneratorShape(out))).toEqual([]);
  });

  /** `have` is absolute except for the ids the caller writes down.
   *
   *  The two halves of the rule in one test: a clip the database already has is
   *  not paid for again, and a clip named in `remake` is, because the recording
   *  itself was wrong. A re-make is reported as one so a run that replaces part
   *  of the library cannot read like a run that extended it. */
  test("a live clip is left alone unless it is named for re making", async () => {
    const tmp = tmpPath();
    const bundle = {
      "item_type": "hatsugen_choukai",
      "audio_manifest": [
        { "clip_id": "keep0", "voice": "narrator_f", "channel": "in_person",
          "text": "お先に失礼します。" },
        { "clip_id": "redo0", "voice": "staff_mid_m", "channel": "in_person",
          "text": "承知いたしました。" },
      ],
    };
    const report = await synth.synthesiseBundle(
      bundle, { provider: "silent", outDir: tmp,
                have: new Set(["keep0", "redo0"]), remake: new Set(["redo0"]) },
    );

    expect(report.live).toEqual(["keep0"]);
    expect(report.remade).toEqual(["redo0"]);
    expect(report.written.map((c) => c.clip_id)).toEqual(["redo0"]);
    // The SQL points the row at the new recording, and says that it is one.
    const sql = synth.toSql(report);
    expect(sql.includes("redo0") && !sql.includes("keep0")).toBe(true);
    expect(sql).toContain("replace a clip that was already live");
  });

  /** Not just the database's list: a stale file in `media/` would otherwise be
   *  reused and the wrong recording uploaded again. */
  test("naming a clip for re making overrides a copy on this machine", async () => {
    const tmp = tmpPath();
    const first = await synth.synthesiseBundle(
      { "item_type": "x", "audio_manifest": [
        { "clip_id": "redo1", "voice": "narrator_f", "channel": "in_person",
          "text": "少々お待ちください。" }] },
      { provider: "silent", outDir: tmp },
    );
    expect(first.written.map((c) => c.clip_id)).toEqual(["redo1"]);

    const again = await synth.synthesiseBundle(
      { "item_type": "x", "audio_manifest": [
        { "clip_id": "redo1", "voice": "narrator_f", "channel": "in_person",
          "text": "少々お待ちください。" }] },
      { provider: "silent", outDir: tmp, remake: new Set(["redo1"]) },
    );
    expect(again.written.map((c) => c.clip_id)).toEqual(["redo1"]);
    expect(again.reused).toEqual([]);
    // Not live, so not a re-make — just a clip made again on this machine.
    expect(again.remade).toEqual([]);
  });

  /** A list of ids is only reviewable if something checks it still refers to
   *  clips the library actually asks for. Every id in the committed list must
   *  appear in a committed bundle's manifest — otherwise the file is naming
   *  nothing and the re-make would silently do nothing. */
  test("the clips named for re making are the ones the bad settings made", () => {
    const named = synth.readHave(path.join(config.ROOT, "batches", "remake-20260919-pace.txt"));
    expect(named.size).toBe(24);

    const inLibrary = new Set<string>();
    const dir = path.join(config.ROOT, "batches");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("."))) {
      if (f.endsWith(".source.json")) {
        continue;
      }
      const data = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      for (const clip of or(get(data, "audio_manifest"), []) as Record<string, any>[]) {
        inLibrary.add(clip["clip_id"]);
      }
    }
    const missing = sorted(_difference(named, inLibrary));
    expect(missing).toEqual([]);
  });

  /** A merge extends the library; only the run form may re-record part of it.
   *
   *  Read as text, in the style of the nightly workflow's guards: the check
   *  needs no YAML library, and the point is one an edit could silently drop.
   *  The automatic trigger is `workflow_run`, which carries no inputs, so the
   *  variable is empty on every deploy that happens by itself. */
  test("the deploy workflow only re records when a hand run asks it to", () => {
    const text = readFileSync(path.join(config.ROOT, ".github/workflows/deploy-db.yml"), "utf8");

    expect(text, "the run form offers it").toContain("remake_list:");
    expect(/^\s+REMAKE_LIST: \$\{\{ github\.event\.inputs\.remake_list \}\}$/m.test(text),
           "and it is the only source of the value").toBe(true);
    expect(text, "what is live is still read from the database").toContain('--have "$RUNNER_TEMP/have.txt"');
    // A database with no live clip is a library not moved in yet, never one to
    // record again from the top — unless a hand run says it is starting from
    // nothing.
    const [from, to] = [text.indexOf("name: which voice, if any"), text.indexOf("name: give the bank its voice")];
    expect(from >= 0 && to >= 0).toBe(true);
    const voice = text.slice(from, to);
    expect(voice).toContain("select id from audio_clips where audio_path is not null");
    expect(voice).toContain('[ "$live" -eq 0 ] && [ "$FIRST_VOICE" != "true" ]');
    expect(voice).toContain("FIRST_VOICE: ${{ github.event.inputs.first_voice == 'true' }}");

    const step = text.indexOf("name: give the bank its voice");
    const block = text.slice(step, text.indexOf("- name:", step + 1));
    expect(block, "blank means re-record nothing").toContain('if [ -n "$REMAKE_LIST" ]');
    expect(block.includes("--remake") && block.includes('remake=(--remake "$REMAKE_LIST")')).toBe(true);
    expect(block, "a typo fails the run, not silently nothing").toContain("no such file in this checkout");

    // The file the list refers to is committed, or a hand-run would name
    // nothing: the whole point is that the ids were written down and reviewed.
    const named = /e\.g\. (batches\/remake-[\w-]+\.txt)/u.exec(text);
    expect(named).not.toBeNull();
    expect(existsSync(path.join(config.ROOT, named![1]))).toBe(true);
  });
});
