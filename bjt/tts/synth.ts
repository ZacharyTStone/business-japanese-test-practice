/**
 * The offline synthesis job: a checked bundle's manifest → audio files → SQL.
 *
 * Five properties, each of which is the reason for a decision below.
 *
 * **It only ever runs over a bundle that already passed.** A clip is expensive and
 * permanent; an item that has not cleared its gates has no business having a voice
 * recorded for it.
 *
 * **It is resumable and idempotent.** Clip ids are content hashes of (voice,
 * channel, text), so a clip that already exists on disk is skipped. Re-running a
 * batch after fixing one item re-synthesises that item and nothing else, and
 * 「かしこまりました。」 is paid for once across the whole library.
 *
 * **Nothing uploads itself.** The job writes files and SQL. Uploading is opt-in
 * (`uploadClips`) and applying the SQL is a separate, deliberate act, exactly as
 * publishing content is — which is why no key that can write media has to exist on
 * a laptop.
 *
 * **Silence is a first-class outcome.** 総合読解 has no audio by design, and the
 * job says so rather than reporting zero clips as though something went wrong.
 *
 * **The database is the record of what is live.** On a laptop the `media/`
 * directory says which clips exist; on a fresh runner it is empty every time, and
 * the only record of what has already been synthesised and pointed at is
 * `audio_clips.audio_path` itself. `have` is that list, read out of the database
 * by the deploy workflow, and a clip on it is neither made, uploaded nor updated
 * again — which is what keeps every voice in the library the recording the
 * learner first heard.
 *
 * `synthesiseBundle`, `run` and `uploadClips` are async (a provider
 * synthesises, the bucket uploads); reading `have`, the SQL and the report are
 * not.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as config from "../config.ts";
import { writeAtomic } from "../files.ts";
import * as publish from "../publish.ts";
import { errText, floorDiv, get, RuntimeError, slice, sorted, splitlines, str, strip, SystemExit, thousands, ValueError } from "../py.ts";
import { dumps } from "../pyjson.ts";
import * as scene_art from "../scene_art.ts";
import * as withdrawn from "../withdrawn.ts";
import * as channel_mod from "./channel.ts";
import { directionFor, getProvider, type Provider } from "./providers.ts";

export class ClipResult {
  clip_id: string;
  path: string;
  duration_ms: number;
  reused: boolean;

  constructor(init: { clip_id: string; path: string; duration_ms: number; reused?: boolean }) {
    this.clip_id = init.clip_id;
    this.path = init.path;
    this.duration_ms = init.duration_ms;
    this.reused = init.reused ?? false;
  }
}

export class SynthReport {
  bundle: string;
  written: ClipResult[];
  reused: ClipResult[];
  /** Clip ids the caller said are already live (see `have`). Nothing to make,
   *  upload or update for these; counted so the summary adds up. */
  live: string[];
  /** Clip ids that were re-synthesised over a recording that was already
   *  live, because the caller named them (see `remake`). Counted separately
   *  from `written` — which also holds them — so a run that replaces part of
   *  the library says so instead of reading like a run that extended it. */
  remade: string[];
  failed: [string, string][];
  provider: string;

  constructor(init: {
    bundle: string;
    written?: ClipResult[];
    reused?: ClipResult[];
    live?: string[];
    remade?: string[];
    failed?: [string, string][];
    provider?: string;
  }) {
    this.bundle = init.bundle;
    this.written = init.written ?? [];
    this.reused = init.reused ?? [];
    this.live = init.live ?? [];
    this.remade = init.remade ?? [];
    this.failed = init.failed ?? [];
    this.provider = init.provider ?? "silent";
  }

  /** Every clip this run has a file for: the SQL and the upload cover these. */
  get clips(): ClipResult[] {
    return [...this.reused, ...this.written];
  }

  summary(): string {
    if (this.clips.length === 0 && this.failed.length === 0 && this.live.length === 0) {
      return `${str(this.bundle)}: no audio — this item type is read, not heard`;
    }
    const parts = [`${this.written.length} synthesised`, `${this.reused.length} reused`];
    if (this.remade.length > 0) {
      parts.push(`${this.remade.length} RE-MADE over a live clip`);
    }
    if (this.live.length > 0) {
      parts.push(`${this.live.length} already live`);
    }
    if (this.failed.length > 0) {
      parts.push(`${this.failed.length} FAILED`);
    }
    return `${str(this.bundle)} (${str(this.provider)}): ` + parts.join(", ");
  }

  /** Forget clips that did not reach the bucket, so the SQL never points
   *  the database at a file that is not there. */
  drop(clipIds: ReadonlySet<string>): void {
    this.written = this.written.filter((c) => !clipIds.has(c.clip_id));
    this.reused = this.reused.filter((c) => !clipIds.has(c.clip_id));
  }
}

/**
 * Where a clip lives, inside the `audio` bucket.
 *
 * Sharded by the first two characters of the id, because a flat directory of
 * several thousand files is unpleasant to look at in any storage browser. The
 * provider name is in the path so a clip's origin is visible without a
 * database lookup — and so a silent placeholder can never be mistaken for a
 * real recording.
 */
export function storagePath(clipId: string, providerName: string): string {
  return `${providerName}/${slice(clipId, 0, 2)}/${clipId}.wav`;
}

/** Python's `except Exception`: every error but the one that ends the
 *  process. */
function _isException(exc: unknown): boolean {
  return exc instanceof Error && !(exc instanceof SystemExit);
}

/**
 * Synthesise every clip a bundle's manifest asks for that does not exist.
 *
 * `limit` caps how many NEW clips one run may make. A budget rather than a
 * debugging convenience: a run pointed at a paid provider must not be able to
 * spend the afternoon's money in one command.
 *
 * `have` is the set of clip ids that are already live — synthesised, uploaded
 * and pointed at by the database. They are skipped before anything else is
 * looked at, so a run on a machine with an empty `media/` still makes only
 * what the library lacks.
 *
 * `remake` is the one exception to that, and it is deliberately a list of
 * named clips rather than a flag. A live clip is not re-made, because a
 * learner who hears one item in a different voice from the next is doing
 * speaker identification instead of listening to Japanese — but that reason
 * cuts both ways. When a handful of clips are made with the wrong delivery,
 * leaving them is what makes the library sound like two libraries; replacing
 * exactly those is what makes it one again. So the ids are written down,
 * reviewed and passed in, a re-make is reported as a re-make, and nothing is
 * replaced that was not named.
 */
export async function synthesiseBundle(
  bundle: Record<string, any>,
  opts: {
    provider?: Provider | string;
    outDir?: string | null;
    force?: boolean;
    limit?: number | null;
    have?: ReadonlySet<string> | null;
    remake?: ReadonlySet<string> | null;
  } = {},
): Promise<SynthReport> {
  let provider = opts.provider ?? "silent";
  if (typeof provider === "string") {
    provider = getProvider(provider);
  }
  const outDir = path.join(opts.outDir ? opts.outDir : config.MEDIA_DIR, "audio");
  const force = opts.force ?? false;
  const limit = opts.limit ?? null;
  const have = opts.have ?? null;
  const remake = opts.remake ?? null;

  const report = new SynthReport({ bundle: get(bundle, "item_type", "bundle"), provider: provider.name });
  const manifest: Record<string, any>[] = get(bundle, "audio_manifest", []);

  let made = 0;
  for (const clip of manifest) {
    // Named for replacement: neither the database's list of live clips nor
    // a copy sitting on this machine stands in the way.
    const named = remake !== null && remake.has(clip["clip_id"]);
    if (have !== null && have.size > 0 && have.has(clip["clip_id"]) && !named) {
      report.live.push(clip["clip_id"]);
      continue;
    }
    const rel = storagePath(clip["clip_id"], provider.name);
    const dest = path.join(outDir, rel);

    if (_exists(dest) && !force && !named) {
      let ms: number;
      try {
        ms = _durationOf(dest);
      } catch (exc) {
        if (!(exc instanceof ValueError)) throw exc;
        // Not a clip: a write cut short, most likely. Pointing the
        // database at it would ship a broken or zero-length file.
        report.failed.push([clip["clip_id"], `${errText(exc)}; delete ${dest} to have it made again`]);
        continue;
      }
      report.reused.push(new ClipResult({ clip_id: clip["clip_id"], path: rel, duration_ms: ms, reused: true }));
      continue;
    }

    if (limit !== null && made >= limit) {
      break;
    }

    let processed: Uint8Array;
    try {
      const raw = await provider.synthesize(
        clip["text"],
        clip["voice"],
        { instructions: directionFor(clip["voice"]) },
      );
      processed = channel_mod.applyChannel(raw, clip["channel"]);
    } catch (exc) { // one bad clip must not stop the run
      if (!_isException(exc)) throw exc;
      // A whole batch failing because one clip did would mean paying for
      // the successful ones again on the retry.
      report.failed.push([clip["clip_id"], errText(exc)]);
      continue;
    }

    writeAtomic(dest, processed);
    made += 1;
    if (named && have !== null && have.size > 0 && have.has(clip["clip_id"])) {
      report.remade.push(clip["clip_id"]);
    }
    report.written.push(
      new ClipResult({ clip_id: clip["clip_id"], path: rel, duration_ms: channel_mod.durationMs(processed) }),
    );
  }

  return report;
}

/** One `bjt synth`: what was made, and what the upload did with it. */
export class SynthRun {
  report: SynthReport;
  /** null when nothing was uploaded (no bucket, or no clips). */
  uploaded: scene_art.UploadResult | null;
  /** Clips in the bundle's manifest that only withdrawn items use. */
  skipped: number;

  constructor(init: { report: SynthReport; uploaded?: scene_art.UploadResult | null; skipped?: number }) {
    this.report = init.report;
    this.uploaded = init.uploaded ?? null;
    this.skipped = init.skipped ?? 0;
  }
}

/** What an upload needs of a bucket: `scene_art.Bucket`, or a test's fake. */
export type ClipBucket = Pick<scene_art.Bucket, "upload">;

/**
 * A bundle's audio, start to finish: the live items' clips made (none that
 * `have` says are live but the ones `remake` names), uploaded when a bucket
 * is given, and the report left describing the bucket rather than this
 * machine — a clip the bucket already held is live, a clip that did not
 * arrive is a failure, and neither is in the SQL.
 *
 * An upload needs `have` (the database's list of live clips, empty on a
 * fresh project) and a real voice: without the one every clip on an empty
 * machine looks new, and the other would put silence where the app shows
 * the text. Both are refused here, whoever the caller is.
 */
export async function run(
  bundle: Record<string, any>,
  opts: {
    provider?: Provider | string;
    bucket?: ClipBucket | null;
    mediaDir?: string | null;
    force?: boolean;
    limit?: number | null;
    have?: ReadonlySet<string> | null;
    remake?: ReadonlySet<string> | null;
  } = {},
): Promise<SynthRun> {
  let provider = opts.provider ?? "silent";
  if (typeof provider === "string") {
    provider = getProvider(provider);
  }
  const bucket = opts.bucket ?? null;
  const have = opts.have ?? null;
  const remake = opts.remake ?? null;
  if (bucket !== null && have === null) {
    throw new ValueError("an upload needs the list of clips already live (`have`); " +
                         "a live clip is never re-made");
  }
  if (bucket !== null && provider.name === "silent") {
    throw new ValueError("an upload of the silent provider would ship silence");
  }

  // Only what is still served: a withdrawn question's lines would be paid
  // for and never heard. A clip it shares with a live item is still made.
  const live = withdrawn.liveBundle(bundle);
  const skipped = (get(bundle, "audio_manifest", []) as unknown[]).length - (live["audio_manifest"] as unknown[]).length;
  const report = await synthesiseBundle(live, { provider, outDir: opts.mediaDir, force: opts.force,
                                               limit: opts.limit, have, remake });
  const out = new SynthRun({ report, skipped });
  if (bucket === null || report.clips.length === 0) {
    return out;
  }

  const up = await uploadClips(report, bucket, { mediaDir: opts.mediaDir, remake });
  out.uploaded = up;
  if (up.existing.length > 0) {
    // Live all along, whatever `have` said: left as they are, and out of
    // the SQL, which would otherwise describe tonight's recording.
    const found = new Set(up.existing.map((p) => scene_art._stem(p)));
    report.drop(found);
    report.live.push(...sorted(found));
  }
  if (up.failed.length > 0) {
    // The SQL must describe the bucket, not this machine.
    report.drop(new Set([...up.failed_paths].map((p) => scene_art._stem(p))));
    report.failed.push(...up.failed.map(([p, why]): [string, string] => [scene_art._stem(p), why]));
  }
  return out;
}

/** `Path(p).exists()`. */
function _exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** How long a clip on disk is. Throws ValueError for a file that is not a
 *  whole WAV — unreadable, cut short of the frames its header promises, or
 *  empty — rather than calling it zero milliseconds long: a zero here went
 *  into the SQL and shipped. */
export function _durationOf(p: string): number {
  const data = readFileSync(p);
  let declared: number;
  let frames: number;
  try {
    const w = new _WaveRead(data);
    declared = w.getnframes();
    frames = floorDiv(w.readframes(declared).length, Math.max(1, w.getsampwidth() * w.getnchannels()));
  } catch (exc) {
    if (exc instanceof channel_mod.WaveError || exc instanceof channel_mod.EOFError) {
      throw new ValueError(`${path.basename(p)} is not a readable WAV (${errText(exc)})`, { cause: exc });
    }
    throw exc;
  }
  if (frames < declared) {
    throw new ValueError(`${path.basename(p)} is cut short: ${frames} of ${declared} frames`);
  }
  const ms = channel_mod.durationMs(data);
  if (ms <= 0) {
    throw new ValueError(`${path.basename(p)} has no audio in it`);
  }
  return ms;
}

/** The clip ids already live, one per line. Blank lines and `#` comments
 *  are ignored, so the file can be a query's output with one id a line. */
export function readHave(p: string): Set<string> {
  const ids = new Set<string>();
  for (let line of splitlines(readFileSync(p, "utf8").replace(/\r\n?/g, "\n"))) {
    line = strip(line);
    if (line && !line.startsWith("#")) {
      ids.add(line);
    }
  }
  return ids;
}

/**
 * Put every clip this run has a file for into the `audio` bucket.
 *
 * Never over a file that is already there, except a clip named in `remake`:
 * a clip's path is its content hash, so a file at that path is a live clip,
 * and a live clip is never re-made — whether or not the caller's `have`
 * list knew about it. Such a file is left alone and reported in `existing`,
 * and the caller counts it as live, so the SQL does not rewrite its
 * duration from a recording nobody will hear. One failure does not stop the
 * rest, for the reason the scene uploader gives: paying for the successful
 * ones again on a retry. The caller drops the failed ids from the report so
 * the SQL describes the bucket, not this machine.
 */
export async function uploadClips(
  report: SynthReport,
  bucket: ClipBucket,
  opts: { mediaDir?: string | null; remake?: ReadonlySet<string> | null } = {},
): Promise<scene_art.UploadResult> {
  const root = path.join(opts.mediaDir ? opts.mediaDir : config.MEDIA_DIR, "audio");
  const result = new scene_art.UploadResult();
  const remake: ReadonlySet<string> = opts.remake ?? new Set();
  for (const clip of report.clips) {
    const local = path.join(root, clip.path);
    if (!_isFile(local)) {
      result.failed.push([clip.path, "file missing on this machine"]);
      continue;
    }
    const size = statSync(local).size;
    if (size > config.AUDIO_MAX_BYTES) {
      result.failed.push([
        clip.path,
        `${thousands(size)} bytes is over the bucket's ${thousands(config.AUDIO_MAX_BYTES)} byte limit`,
      ]);
      continue;
    }
    try {
      await bucket.upload(clip.path, readFileSync(local), "audio/wav",
                          { upsert: remake.has(clip.clip_id) });
    } catch (exc) {
      if (exc instanceof scene_art.AlreadyExists) {
        result.existing.push(clip.path);
        continue;
      }
      if (exc instanceof RuntimeError) {
        result.failed.push([clip.path, errText(exc)]);
        continue;
      }
      throw exc;
    }
    result.sent.push(clip.path);
  }
  return result;
}

/** `Path(p).is_file()`. */
function _isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The SQL that tells the database where the audio went.
 *
 * An update rather than an upsert: the clip rows were created by `bjt publish`
 * from the same manifest, so a row that is missing here means the bundle was
 * never published, and inventing one would paper over that.
 */
export function toSql(report: SynthReport): string {
  if (report.clips.length === 0) {
    if (report.live.length > 0) {
      return (
        `-- Every clip of ${publish.comment(report.bundle)} is already live ` +
        `(${report.live.length} clip(s)).\n-- Nothing to apply.\n`
      );
    }
    return (
      "-- No audio for this bundle: its item type is read, not heard.\n" +
      "-- Nothing to apply.\n"
    );
  }

  const lines = [
    `-- Audio paths for ${publish.comment(report.bundle)}, ` +
    `synthesised by ${publish.comment(report.provider)}.`,
    `-- ${report.written.length} synthesised, ${report.reused.length} reused, ` +
    `${report.live.length} already live and left alone.`,
    ...(report.remade.length > 0
      ? [`-- ${report.remade.length} of them replace a clip that was already live, ` +
         "by name: the file in the bucket and the duration below are the new " +
         "recording."]
      : []),
    "-- Produced by bjt synth. Idempotent: re-running sets the same values.",
    "-- For D1: wrangler d1 execute applies the file all or nothing.",
    "",
  ];
  lines.push(...sorted(report.clips, { key: (c) => c.clip_id }).map((c) =>
    `update audio_clips set audio_path = ${publish.lit(c.path)}, ` +
    `duration_ms = ${Math.trunc(c.duration_ms)} where id = ${publish.lit(c.clip_id)};`,
  ));
  lines.push("");
  return lines.join("\n");
}

/**
 * A machine-readable record of what this run did.
 *
 * Kept next to the audio rather than in the database: it is an operations
 * record — which provider, which clips, how long each came out — and the thing
 * to read when a clip sounds wrong six months from now.
 */
export function writeReport(report: SynthReport, p: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  const asDict = (c: ClipResult) => ({ clip_id: c.clip_id, path: c.path, duration_ms: c.duration_ms, reused: c.reused });
  writeFileSync(
    p,
    dumps(
      {
        "bundle": report.bundle,
        "provider": report.provider,
        "written": report.written.map(asDict),
        "reused": report.reused.map(asDict),
        "live": [...report.live],
        "failed": report.failed.map(([cid, err]) => ({ "clip_id": cid, "error": err })),
      },
      { ensureAscii: false, indent: 2 },
    )
    + "\n",
    "utf8",
  );
  return p;
}

// ----- the WAV container, as Python's `wave` module reads it ------------------
//
// `_durationOf` asks of a file what `wave.open(...)` tells: how many frames
// the header declares and how many are really there. bjt/tts/channel.ts reads
// the container the same way but keeps its reader to itself, so this is the
// same walk (Python 3.11's `wave.Wave_read` over `chunk.Chunk`), only as far
// as those two numbers: the same chunk bounds, the same failures.

const WAVE_FORMAT_PCM = 0x0001;

/** `io.BytesIO` over bytes, read-only. */
class _BytesIO {
  private readonly buf: Uint8Array;
  private pos = 0;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  read(size: number = -1): Uint8Array {
    const end = size < 0 ? this.buf.length : Math.min(this.buf.length, this.pos + size);
    if (this.pos >= end) return new Uint8Array(0);
    const out = this.buf.subarray(this.pos, end);
    this.pos = end;
    return out;
  }
  seek(pos: number, whence: number = 0): void {
    if (whence === 0 && pos < 0) throw new ValueError(`negative seek value ${pos}`);
    if (whence === 1) pos = this.pos + pos;
    else if (whence === 2) pos = this.buf.length + pos;
    this.pos = Math.max(0, pos);
  }
  tell(): number {
    return this.pos;
  }
}

/** `chunk.Chunk`, little-endian, aligned. */
class _Chunk {
  private readonly file: _BytesIO | _Chunk;
  readonly chunkname: string;
  readonly chunksize: number;
  sizeRead = 0;
  private readonly offset: number;

  constructor(file: _BytesIO | _Chunk) {
    this.file = file;
    const name = file.read(4);
    if (name.length < 4) throw new channel_mod.EOFError();
    this.chunkname = String.fromCharCode(...name);
    const size = file.read(4);
    if (size.length < 4) throw new channel_mod.EOFError();
    this.chunksize = Buffer.from(size).readUInt32LE(0);
    this.offset = file.tell();
  }

  seek(pos: number, whence: number = 0): void {
    if (whence === 1) pos = pos + this.sizeRead;
    else if (whence === 2) pos = pos + this.chunksize;
    if (pos < 0 || pos > this.chunksize) throw new RuntimeError();
    this.file.seek(this.offset + pos);
    this.sizeRead = pos;
  }

  tell(): number {
    return this.sizeRead;
  }

  read(size: number = -1): Uint8Array {
    if (this.sizeRead >= this.chunksize) return new Uint8Array(0);
    if (size < 0) size = this.chunksize - this.sizeRead;
    if (size > this.chunksize - this.sizeRead) size = this.chunksize - this.sizeRead;
    const data = this.file.read(size);
    this.sizeRead = this.sizeRead + data.length;
    if (this.sizeRead === this.chunksize && this.chunksize & 1) {
      const dummy = this.file.read(1);
      this.sizeRead = this.sizeRead + dummy.length;
    }
    return data;
  }

  skip(): void {
    let n = this.chunksize - this.sizeRead;
    // maybe fix alignment
    if (this.chunksize & 1) n = n + 1;
    this.file.seek(n, 1);
    this.sizeRead = this.sizeRead + n;
  }
}

/** `wave.open(io.BytesIO(data), "rb")`, as far as `_durationOf` reads it. */
class _WaveRead {
  private nchannels = 0;
  private sampwidth = 0;
  private nframes = 0;
  private framesize = 0;
  private readonly dataChunk: _Chunk;

  constructor(data: Uint8Array) {
    const file = new _Chunk(new _BytesIO(data));
    if (file.chunkname !== "RIFF") throw new channel_mod.WaveError("file does not start with RIFF id");
    if (String.fromCharCode(...file.read(4)) !== "WAVE") throw new channel_mod.WaveError("not a WAVE file");
    let fmtChunkRead = false;
    let dataChunk: _Chunk | null = null;
    for (;;) {
      let chunk: _Chunk;
      try {
        chunk = new _Chunk(file);
      } catch (e) {
        if (e instanceof channel_mod.EOFError) break;
        throw e;
      }
      if (chunk.chunkname === "fmt ") {
        // _read_fmt_chunk
        const head = chunk.read(14);
        if (head.length < 14) throw new channel_mod.EOFError();
        const h = Buffer.from(head);
        const wFormatTag = h.readUInt16LE(0);
        this.nchannels = h.readUInt16LE(2);
        if (wFormatTag === WAVE_FORMAT_PCM) {
          const width = chunk.read(2);
          if (width.length < 2) throw new channel_mod.EOFError();
          this.sampwidth = floorDiv(Buffer.from(width).readUInt16LE(0) + 7, 8);
          if (!this.sampwidth) throw new channel_mod.WaveError("bad sample width");
        } else {
          throw new channel_mod.WaveError(`unknown format: ${wFormatTag}`);
        }
        if (!this.nchannels) throw new channel_mod.WaveError("bad # of channels");
        this.framesize = this.nchannels * this.sampwidth;
        fmtChunkRead = true;
      } else if (chunk.chunkname === "data") {
        if (!fmtChunkRead) throw new channel_mod.WaveError("data chunk before fmt chunk");
        dataChunk = chunk;
        this.nframes = floorDiv(chunk.chunksize, this.framesize);
        break;
      }
      chunk.skip();
    }
    if (!fmtChunkRead || dataChunk === null) throw new channel_mod.WaveError("fmt chunk and/or data chunk missing");
    this.dataChunk = dataChunk;
  }

  getnchannels(): number {
    return this.nchannels;
  }
  getnframes(): number {
    return this.nframes;
  }
  getsampwidth(): number {
    return this.sampwidth;
  }

  readframes(nframes: number): Uint8Array {
    if (nframes === 0) return new Uint8Array(0);
    return this.dataChunk.read(nframes * this.framesize);
  }
}
