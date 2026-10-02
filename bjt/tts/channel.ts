/**
 * Channel treatment: making a studio recording sound like a telephone.
 *
 * This is post-processing, never a second voice. The cast is fixed by relation
 * (see `plan.ts`) and a "phone voice" would break that — a learner would start
 * telling phone items from in-person ones by timbre instead of by listening to the
 * Japanese. So one recording of 「かしこまりました。」 is made once and the channel
 * is applied on top.
 *
 * The treatment is not decoration. Business telephone Japanese genuinely is harder
 * to hear than studio audio: the band is narrow, the consonants that distinguish
 * いたします from いただきます sit near the top of it, and an item about a phone call
 * that sounds like a studio recording is an easier question than the exam asks.
 *
 * Everything here is plain TypeScript over 16-bit PCM WAV. No ffmpeg and no audio
 * library — a dependency a laptop job does not need. The WAV container is read
 * and written here the way Python's `wave` module (which the pipeline used to
 * use) reads and writes it, so the same input gives the same bytes.
 */
import { floorDiv, get, PyError, round, truthy, ValueError } from "../py.ts";
import { CHANNEL_PROFILES } from "./plan.ts";

/** WAV bytes → (samples, sample_rate, channels). Mono-mixed. */
export function _decode(data: Uint8Array): [number[], number, number] {
  const w = new _WaveRead(data);
  if (w.getsampwidth() !== 2) {
    throw new ValueError(`expected 16-bit PCM, got ${w.getsampwidth() * 8}-bit`);
  }
  const [rate, channels, n] = [w.getframerate(), w.getnchannels(), w.getnframes()];
  const raw = w.readframes(n);

  let samples = _unpackInt16(raw);
  if (channels > 1) {
    // Speech is mono. A stereo file from a provider is the same signal
    // twice, so averaging costs nothing and halves everything downstream.
    const mixed: number[] = [];
    for (let i = 0; i < samples.length - channels + 1; i += channels) {
      let s = 0;
      for (let j = i; j < i + channels; j++) s += samples[j];
      mixed.push(floorDiv(s, channels));
    }
    samples = mixed;
  }
  return [samples, rate, 1];
}

export function _encode(samples: number[], rate: number): Uint8Array {
  return _waveWrite(rate, _packInt16(samples));
}

/** Linear interpolation.
 *
 *  Good enough on purpose: the next thing that happens to this signal is being
 *  band-limited to a telephone line, and a sinc kernel's advantage lives in
 *  exactly the frequencies that are about to be thrown away. */
export function _resample(samples: number[], srcRate: number, dstRate: number): number[] {
  if (srcRate === dstRate || samples.length === 0) {
    return samples;
  }
  if (srcRate === 0) throw new ZeroDivisionError("division by zero");
  const ratio = dstRate / srcRate;
  const outLen = Math.max(1, Math.trunc(samples.length * ratio));
  const out: number[] = [];
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const left = Math.trunc(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    if (left >= samples.length) throw new IndexError("list index out of range");
    out.push(Math.trunc(samples[left] * (1 - frac) + samples[right] * frac));
  }
  return out;
}

export function _onePoleLowPass(samples: number[], rate: number, cutoff: number): number[] {
  const alpha = _alpha(rate, cutoff);
  const out: number[] = [];
  let prev = 0.0;
  for (const s of samples) {
    prev += alpha * (s - prev);
    out.push(Math.trunc(prev));
  }
  return out;
}

/** A low-pass subtracted from the signal — the standard one-pole trick. */
export function _onePoleHighPass(samples: number[], rate: number, cutoff: number): number[] {
  const alpha = _alpha(rate, cutoff);
  const out: number[] = [];
  let prev = 0.0;
  for (const s of samples) {
    prev += alpha * (s - prev);
    out.push(Math.trunc(s - prev));
  }
  return out;
}

export function _alpha(rate: number, cutoff: number): number {
  const dt = 1.0 / rate;
  const rc = 1.0 / (2 * Math.PI * cutoff);
  return dt / (rc + dt);
}

export function _clip(samples: number[]): number[] {
  return samples.map((s) => Math.max(-32768, Math.min(32767, s)));
}

/** Bring the loudest sample to a fixed level.
 *
 *  Peak rather than loudness: these clips are one or two sentences each and a
 *  proper LUFS measurement over that is mostly measuring the silence at the
 *  ends. What actually matters is that the option clips within one item are the
 *  same loudness as each other — a learner should not be able to hear which one
 *  was recorded differently. */
export function normalise(samples: number[], opts: { targetPeak?: number } = {}): number[] {
  const targetPeak = opts.targetPeak ?? 0.89;
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) {
    return samples;
  }
  const gain = (targetPeak * 32767) / peak;
  return _clip(samples.map((s) => Math.trunc(s * gain)));
}

/** Apply a channel profile to a WAV clip.
 *
 *  An unknown channel is a pass-through rather than an error. `written` reaches
 *  here only if something upstream planned a clip for a reading item, and the
 *  right response to that is a clean recording plus a failing test somewhere
 *  else, not a crash in the middle of a batch of two hundred files. */
export function applyChannel(wavBytes: Uint8Array, channel: string): Uint8Array {
  const profile = get(CHANNEL_PROFILES, channel, null);
  if (profile === null) {
    return wavBytes;
  }

  let [samples, rate] = _decode(wavBytes);
  const targetRate: number = profile.sample_rate;
  samples = _resample(samples, rate, targetRate);

  const band = get(profile, "band");
  if (truthy(band)) {
    const [low, high] = band as [number, number];
    // High-pass first: removing the rumble before the low-pass keeps the
    // filters from fighting over headroom in the part of the band that
    // actually carries the consonants.
    samples = _onePoleHighPass(samples, targetRate, low);
    samples = _onePoleLowPass(samples, targetRate, Math.min(high, targetRate / 2 - 1));
    samples = _clip(samples);
  }

  return _encode(normalise(samples), targetRate);
}

/** How long a clip is. Stored alongside the file so the app can lay out a
 *  play button without downloading the audio to find out. */
export function durationMs(wavBytes: Uint8Array): number {
  const w = new _WaveRead(wavBytes);
  if (w.getframerate() === 0) throw new ZeroDivisionError("division by zero");
  return round((1000 * w.getnframes()) / w.getframerate());
}

/** Raw 16-bit mono PCM → a WAV container. For providers that return the
 *  samples without a header. */
export function wrapPcm(pcm: Uint8Array, rate: number): Uint8Array {
  return _waveWrite(rate, pcm.subarray(0, pcm.length - (pcm.length % 2)));
}

/** A valid, silent WAV. Used by the offline provider. */
export function silence(seconds: number, opts: { rate?: number } = {}): Uint8Array {
  const rate = opts.rate ?? 24000;
  return _encode(new Array<number>(Math.max(1, Math.trunc(seconds * rate))).fill(0), rate);
}

// ----- the WAV container, as Python's `wave` module reads and writes it -------
//
// What follows is `wave.Wave_read` / `wave.Wave_write` (Python 3.11) for the one
// format this module handles, 16-bit PCM, little-endian: the same chunk walk, the
// same bounds, the same failures, so that a file Python accepted is accepted here
// with the same samples, and a file it refused is refused.

/** `wave.Error`. */
export class WaveError extends PyError {}
/** Python's EOFError: the container ended inside a header. */
export class EOFError extends PyError {}
/** Python's RuntimeError, raised by `chunk.Chunk.seek` past a chunk's end. */
export class RuntimeError extends PyError {}
/** `struct.error`: a sample outside 16 bits, or a byte string of odd length. */
export class StructError extends PyError {}
export class IndexError extends PyError {}
export class ZeroDivisionError extends PyError {}

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

/** `chunk.Chunk` (the copy `wave` carries as `_Chunk`), little-endian, aligned. */
class _Chunk {
  private readonly file: _BytesIO | _Chunk;
  readonly chunkname: string;
  readonly chunksize: number;
  sizeRead = 0;
  private readonly offset: number;

  constructor(file: _BytesIO | _Chunk) {
    this.file = file;
    const name = file.read(4);
    if (name.length < 4) throw new EOFError();
    this.chunkname = String.fromCharCode(...name);
    const size = file.read(4);
    if (size.length < 4) throw new EOFError();
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

/** `wave.open(io.BytesIO(data), "rb")`. */
class _WaveRead {
  private readonly nchannels: number = 0;
  private readonly framerate: number = 0;
  private readonly sampwidth: number = 0;
  private readonly nframes: number = 0;
  private readonly framesize: number = 0;
  private readonly dataChunk: _Chunk;

  constructor(data: Uint8Array) {
    const file = new _Chunk(new _BytesIO(data));
    if (file.chunkname !== "RIFF") throw new WaveError("file does not start with RIFF id");
    if (String.fromCharCode(...file.read(4)) !== "WAVE") throw new WaveError("not a WAVE file");
    let fmtChunkRead = false;
    let dataChunk: _Chunk | null = null;
    for (;;) {
      let chunk: _Chunk;
      try {
        chunk = new _Chunk(file);
      } catch (e) {
        if (e instanceof EOFError) break;
        throw e;
      }
      if (chunk.chunkname === "fmt ") {
        // _read_fmt_chunk
        const head = chunk.read(14);
        if (head.length < 14) throw new EOFError();
        const h = Buffer.from(head);
        const wFormatTag = h.readUInt16LE(0);
        this.nchannels = h.readUInt16LE(2);
        this.framerate = h.readUInt32LE(4);
        if (wFormatTag === WAVE_FORMAT_PCM) {
          const width = chunk.read(2);
          if (width.length < 2) throw new EOFError();
          this.sampwidth = floorDiv(Buffer.from(width).readUInt16LE(0) + 7, 8);
          if (!this.sampwidth) throw new WaveError("bad sample width");
        } else {
          throw new WaveError(`unknown format: ${wFormatTag}`);
        }
        if (!this.nchannels) throw new WaveError("bad # of channels");
        this.framesize = this.nchannels * this.sampwidth;
        fmtChunkRead = true;
      } else if (chunk.chunkname === "data") {
        if (!fmtChunkRead) throw new WaveError("data chunk before fmt chunk");
        dataChunk = chunk;
        this.nframes = floorDiv(chunk.chunksize, this.framesize);
        break;
      }
      chunk.skip();
    }
    if (!fmtChunkRead || dataChunk === null) throw new WaveError("fmt chunk and/or data chunk missing");
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
  getframerate(): number {
    return this.framerate;
  }

  readframes(nframes: number): Uint8Array {
    if (nframes === 0) return new Uint8Array(0);
    return this.dataChunk.read(nframes * this.framesize);
  }
}

/** `wave.open(buf, "wb")`, mono, 16-bit, `setframerate(rate)`,
 *  `writeframes(data)`: the 44-byte header Python writes, then the data. */
function _waveWrite(rate: number, data: Uint8Array): Uint8Array {
  // `setframerate` refuses a rate at or below zero, and rounds the rest; the
  // `with` block's close then fails on the rate never having been set, and
  // that is the error Python reports.
  const framerate = rate <= 0 ? 0 : round(rate);
  if (!framerate) throw new WaveError("sampling rate not specified");
  const nchannels = 1;
  const sampwidth = 2;
  // Python writes the header with the length of the first frames and patches
  // it to the bytes actually written; after the one write, that is the data.
  const datawritten = data.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + datawritten, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  header.writeUInt16LE(nchannels, 22);
  header.writeUInt32LE(framerate, 24);
  header.writeUInt32LE(nchannels * framerate * sampwidth, 28);
  header.writeUInt16LE(nchannels * sampwidth, 32);
  header.writeUInt16LE(sampwidth * 8, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(datawritten, 40);
  return Buffer.concat([header, data]);
}

/** `struct.unpack(f"<{len(raw) // 2}h", raw)`. */
function _unpackInt16(raw: Uint8Array): number[] {
  if (raw.length % 2) {
    throw new StructError(`unpack requires a buffer of ${raw.length - 1} bytes`);
  }
  const view = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Array<number>(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.readInt16LE(2 * i);
  return out;
}

/** `struct.pack(f"<{len(samples)}h", *samples)`. */
function _packInt16(samples: number[]): Uint8Array {
  const out = Buffer.alloc(2 * samples.length);
  samples.forEach((s, i) => {
    if (!Number.isInteger(s)) throw new StructError("required argument is not an integer");
    if (s < -32768 || s > 32767) throw new StructError("short format requires -32768 <= number <= 32767");
    out.writeInt16LE(s, 2 * i);
  });
  return out;
}
