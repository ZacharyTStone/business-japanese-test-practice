/**
 * Whole files or none, and readers that do not take a broken file for an empty one.
 *
 * A bundle, its SQL, a clip and a picture are each written by one step and
 * trusted by the next. Written in place, a process stopped part-way left a
 * truncated file behind; read tolerantly, a corrupt clip became zero
 * milliseconds in the SQL. These hold the writers to `files.writeAtomic` and
 * the readers to raising.
 */
import fs, { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import { writeAtomic } from "../bjt/files.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as http from "../bjt/http.ts";
import * as publish from "../bjt/publish.ts";
import { ValueError } from "../bjt/py.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import * as channel from "../bjt/tts/channel.ts";
import * as synth from "../bjt/tts/synth.ts";
import { bytes, patch, tmpPath } from "./helpers.ts";

type RequestOpts = Parameters<typeof http.request>[2];

/** `os.replace` refusing, as a full disk would: `fs.renameSync` replaced on
 *  the module object and pushed to every `import { renameSync }` binding
 *  (`syncBuiltinESMExports`), and pushed back once the test's patches are
 *  undone. */
function _failingReplace(): void {
  const refuse = (src: fs.PathLike, dst: fs.PathLike): void => {
    throw new http.OSError("disk full");
  };
  patch(fs, "renameSync", refuse);
  syncBuiltinESMExports();
  onTestFinished(() => syncBuiltinESMExports());
}

function _wav(frames: number): Uint8Array {
  return channel.wrapPcm(new Uint8Array(2 * frames), 24000);
}


describe("files", () => {
  test("a failed write leaves the old file and no litter", () => {
    const tmp = tmpPath();
    const p = path.join(tmp, "b.json");
    writeFileSync(p, "the old bundle", "utf8");
    _failingReplace();
    expect(() => writeAtomic(p, "the new bu")).toThrow(http.OSError);
    expect(readFileSync(p, "utf8")).toBe("the old bundle");
    expect(readdirSync(tmp)).toEqual(["b.json"]);
  });

  test("a bundle and its sql are written whole", () => {
    const tmp = tmpPath();
    const bundle = batch.buildBundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "t");
    const p = batch.save(bundle, { path: path.join(tmp, "hatsugen_choukai_J2_001.json") });
    const [sql] = publish.publishBundle(p);
    const before = [readFileSync(p), readFileSync(sql)];

    _failingReplace();
    bundle["items"] = [];
    expect(() => batch.save(bundle, { path: p })).toThrow(http.OSError);
    expect(() => publish.publishBundle(p)).toThrow(http.OSError);
    expect([readFileSync(p), readFileSync(sql)]).toEqual(before);
  });

  test.each([
    ["not a wav at all", bytes("not a wav at all")],
    ["cut short of the frames its header promises", _wav(24000).slice(0, -1000)],
    ["a header and nothing", _wav(0)],
  ])("a clip that is not whole has no duration [%s]", (_label, data) => {
    const tmp = tmpPath();
    const p = path.join(tmp, "x.wav");
    writeFileSync(p, data);
    expect(() => synth._durationOf(p)).toThrow(ValueError);
  });

  test("a whole clip has its duration", () => {
    const tmp = tmpPath();
    const p = path.join(tmp, "x.wav");
    writeFileSync(p, _wav(24000));
    expect(synth._durationOf(p)).toBe(1000);
    expect(channel.durationMs(_wav(24000))).toBe(1000);
  });

  test("a corrupt clip on disk is a failure not zero milliseconds", async () => {
    const tmp = tmpPath();
    const bundle = batch.buildBundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "t");
    const first = await synth.synthesiseBundle(bundle, { outDir: tmp });
    const broken = first.written[0];
    writeFileSync(path.join(tmp, "audio", broken.path), "RIFF....truncated");

    const again = await synth.synthesiseBundle(bundle, { outDir: tmp });
    expect(again.failed.map(([cid]) => cid)).toContain(broken.clip_id);
    expect(again.clips.map((c) => c.clip_id)).not.toContain(broken.clip_id);
    expect(synth.toSql(again)).not.toContain(`'${broken.clip_id}'`);
    expect(again.clips.every((c) => c.duration_ms > 0)).toBe(true);
  });

  test("the bucket listing reads every page", async () => {
    const ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';

    const page = (keys: number[], token: string | null = null): Uint8Array => {
      const more = token
        ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${token}</NextContinuationToken>`
        : "<IsTruncated>false</IsTruncated>";
      return bytes(`<ListBucketResult ${ns}>${more}`
                   + keys.map((k) => `<Contents><Key>scenes/rejected/${k}.txt</Key></Contents>`).join("")
                   + "</ListBucketResult>");
    };

    const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
    const pages = [page(range(0, 1000), "p2"), page(range(1000, 1005))];
    const asked: boolean[] = [];

    const listing = async (method: string, url: string, opts: RequestOpts = {}): Promise<Uint8Array> => {
      asked.push(url.includes("continuation-token=p2"));
      return pages[asked.length - 1];
    };

    patch(http, "request", listing);
    const bucket = new scene_art.Bucket({ creds: new r2.Credentials({ account_id: "acct", access_key_id: "k",
                                                                       secret_access_key: "s" }) });
    expect((await bucket.list({ prefix: "rejected/" })).size).toBe(1005);
    expect(asked).toEqual([false, true]);
  });

  test("an approved picture is written whole", async () => {
    const tmp = tmpPath();

    class Real implements scene_art.ImageProvider {
      name = "fake";
      suffix = ".png";
      media_type = "image/png";
      real = true;

      async generate(prompt: string): Promise<Uint8Array> {
        return scene_art._flatPng(6, 4, [1, 2, 3]);
      }
    }

    _failingReplace();
    const wanted = scenes.survey({ mediaDir: tmp }).slice(0, 1);
    await expect(scene_art.draw(wanted, { provider: new Real(), review: () => new scene_art.Verdict({ approved: true }),
                                          mediaDir: tmp })).rejects.toThrow(http.OSError);
    expect(scenes.survey({ mediaDir: tmp }).some((s) => s.has_art), "no half picture counts as art").toBe(false);
    const left = readdirSync(path.join(tmp, "scenes"));
    expect(left.some((n) => n.endsWith(".tmp")) || left.some((n) => n.startsWith("."))).toBe(false);
  });
});
