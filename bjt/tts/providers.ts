/**
 * TTS provider adapters.
 *
 * An adapter rather than a hard-coded vendor, for a reason that is specific rather
 * than architectural good manners: which provider sounds right is settled by a
 * native speaker listening to the same clips from each (`bjt audition`), judging
 * names, business terms, dates, 敬語 and contrastive emphasis. That comparison is
 * only cheap if switching is a flag. It is also the kind of decision that gets
 * revisited — a provider that reads 御社 correctly today may not after its next
 * model update, and the pronunciation dictionary below is where such a fix goes.
 *
 * Three real adapters, all "instructable" speech models rather than
 * concatenative voices that sound like a station announcement:
 *
 *   openai   OpenAI's speech API. One API key — the same one the scene artwork
 *            uses. Takes a free-text direction, so the voice can be told to
 *            sound like a receptionist rather than tuned per clip. **This is
 *            the library's voice**; `DEFAULT` below records that decision.
 *   gemini   Google's Gemini speech model, over the Gemini API. One API key.
 *            Kept as a comparison for `bjt audition`; not what ships.
 *   google   Google Cloud Text-to-Speech with its studio-grade Japanese voices.
 *            Needs a Cloud project and application credentials rather than a
 *            key, so it is the heaviest to set up. Also a comparison only.
 *
 * Every adapter returns 16-bit PCM WAV at whatever rate it likes; `channel.ts`
 * resamples. WAV rather than a compressed format because review happens on the
 * original and a delivery derivative is made afterwards, once.
 *
 * No adapter is called at practice time, ever. This runs on a laptop or in the
 * deploy workflow, over a bundle that has already passed every gate.
 *
 * Every `synthesize` is async (the real ones go over the network through
 * `bjt/http.ts`; the silent one is async so that every provider is called the
 * same way). `seams.post` is the one request to a voice vendor, so a test
 * replaces it (`patch(providers.seams, "post", fake)`) where the Python tests
 * replaced `providers._post`.
 */
import * as http from "../http.ts";
import { get, has, htmlEscape, KeyError, len, PyError, repr, RuntimeError, sorted, strip, toInt, truthy, TypeError_, ValueError } from "../py.ts";
import { dumps, loads } from "../pyjson.ts";
import * as channel from "./channel.ts";

/** What a TTS backend has to do. */
export interface Provider {
  name: string;

  /** Japanese text → 16-bit PCM WAV bytes. */
  synthesize(text: string, voice: string, opts?: { instructions?: string }): Promise<Uint8Array>;
}


/** How every clip should sound, whoever is speaking. Sent, ahead of the role
 *  note below, to providers that take a direction; it is the difference between
 *  a voice that reads and a person who talks, and it is what "not robotic" means
 *  in practice: native pitch accent, an office pace, and phrases that run
 *  together the way speech does instead of a pause after every particle. */
export const HOUSE_STYLE =
  "Natural, native Japanese as spoken in a Tokyo office. Standard pitch accent. "
  + "Ordinary business pace — do not slow down or over-enunciate for a learner; "
  + "phrases flow together the way a person actually talks, with no pause after "
  + "every particle. Keigo comes out fluently, as from someone who says it every "
  + "day, never stiffly or as if reading a list. Plain, unaffected delivery: no "
  + "theatrical acting, no smiling announcer voice, no foreign accent. Read the "
  + "text exactly as written and say nothing else.";

// Two things that sound like improvements here and are not; each makes the
// voice stop sounding like a Japanese person:
//
//   * a rate multiplier on the request (`speed`). It rescales audio that has
//     already been spoken; it does not make the speaker speak differently.
//     Pace is a property of a delivery, and the only honest lever we have on a
//     delivery is the wording above.
//   * asking for connected speech, "the small natural reductions of everyday
//     Japanese", or a rhythm that varies — "a quick run through the routine
//     parts, a beat before the point". A model that takes directions performs a
//     direction like that rather than absorbing it, and the performance is both
//     less natural than the plain reading and a hint: a beat before the phrase
//     the question turns on tells the learner where to listen.
//
// So the house style asks for ordinary business pace and stops. If the clips
// need to be quicker, change that sentence and listen (`bjt audition`) before a
// library is made from it — do not reach for a multiplier.

/** How each cast voice should be delivered, on top of the house style. These are
 *  performance notes, not identities — the identity is the provider's voice id,
 *  chosen once during the listening comparison and recorded in VOICE_IDS. */
export const VOICE_DIRECTION: Record<string, string> = {
  narrator_f: "The narrator, outside the scene: even, neutral, unhurried, setting up "
              + "a situation rather than acting it. No warmth and no drama — the "
              + "narration is not what is being tested.",
  staff_junior_m: "A junior employee in his twenties. Polite and a little careful; "
                  + "slightly quick when nervous.",
  staff_junior_f: "A junior employee in her twenties. Polite, clear, deferential to "
                  + "seniors without sounding meek.",
  staff_mid_m: "A mid-career employee. Businesslike, unhurried, entirely at ease with "
               + "keigo — the voice of somebody who answers the phone all day.",
  staff_mid_f: "A mid-career employee. Businesslike and warm, professional pace.",
  manager_m: "A section manager. Calm and measured, used to being listened to; "
             + "never barks.",
  reception_f: "Front desk. Bright, very clear articulation, welcoming but formal.",
};


/** The full delivery note for a cast voice: house style, then the role. */
export function directionFor(voice: string): string {
  const role: string = get(VOICE_DIRECTION, voice, "");
  return strip(`${HOUSE_STYLE}\n\n${role}`);
}


/** The pronunciation dictionary. Business Japanese is full of readings a TTS
 *  model gets wrong in a way that would teach the wrong thing — a learner who
 *  hears 代替 as だいがえ and repeats it in an interview has been actively
 *  harmed by this app. Entries are applied as a text substitution before
 *  synthesis, so they work with any provider. Kept short on purpose: kana in
 *  place of kanji costs a modern model context it uses for accent, so only the
 *  readings that are commonly got wrong belong here. */
export const PRONUNCIATION: Record<string, string> = {
  "代替": "だいたい",
  "早急": "さっきゅう",
  "重複": "ちょうふく",
  "施行": "しこう",
  "貼付": "ちょうふ",
  "相殺": "そうさい",
  "続柄": "つづきがら",
  "出納": "すいとう",
  "定礎": "ていそ",
  "遵守": "じゅんしゅ",
  "他人事": "ひとごと",
  "一段落": "いちだんらく",
  "何卒": "なにとぞ",
  "御中": "おんちゅう",
};


/** Substitute the readings we have decided on.
 *
 *  Longest first, so 「一段落」 is not caught by a shorter entry midway through. */
export function applyPronunciation(text: string): string {
  for (const term of sorted(Object.keys(PRONUNCIATION), { key: len, reverse: true })) {
    text = text.replaceAll(term, PRONUNCIATION[term]);
  }
  return text;
}


/** Valid, silent clips of a plausible length.
 *
 *  Not a mock hidden in the test directory: it is how the whole media pipeline
 *  — planning, synthesis, channel treatment, duration measurement, the SQL that
 *  fills in audio_path — is exercised end to end with no API key, no vendor
 *  account and no network. What it cannot tell you is whether the Japanese
 *  sounds right, which is exactly the part a native speaker has to judge
 *  anyway.
 *
 *  Files it produces are marked `silent/` in their path so a silent clip can
 *  never be mistaken for a real one, in storage or in a review. */
export class SilentProvider implements Provider {
  name: string = "silent";

  /** Japanese speech runs at roughly this rate in business delivery. Only used
   *  to give the silence a believable length so layout and duration handling
   *  can be tested. */
  static CHARS_PER_SECOND = 6.5;

  async synthesize(text: string, voice: string, opts: { instructions?: string } = {}): Promise<Uint8Array> {
    const cls = this.constructor as typeof SilentProvider;
    const seconds = Math.max(0.6, len(text) / cls.CHARS_PER_SECOND);
    return channel.silence(seconds);
  }
}


/** The provider's id for a cast voice, or a refusal that says why.
 *
 *  A cast assigned by accident is one the whole library inherits: clip ids hash
 *  the cast voice, so a voice that quietly fell back to some default would be
 *  recorded once and shared by every item that uses that role. */
export function _cast(providerLabel: string, voiceIds: Record<string, string>, voice: string): string {
  const providerVoice: string | null = get(voiceIds, voice);
  if (!truthy(providerVoice)) {
    throw new RuntimeError(
      `no ${providerLabel} voice cast for ${repr(voice)}. Add it to VOICE_IDS after `
      + "listening to the candidates (`bjt audition`) — a cast assigned by "
      + "accident is one the whole library inherits.",
    );
  }
  return providerVoice as string;
}


/** OpenAI's speech API.
 *
 *  Takes a free-text delivery direction, which is the mechanism that lets one
 *  house style apply to every clip without hand-tuning SSML. The same key the
 *  scene artwork uses, so a project that draws pictures can speak for free. */
export class OpenAIProvider implements Provider {
  name: string = "openai";
  static MODEL = process.env.BJT_OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  static URL = "https://api.openai.com/v1/audio/speech";

  /** Every voice the model offers, for `bjt audition --voices`: one line in
   *  each, so a role can be recast by ear if one sounds accented in Japanese. */
  static CANDIDATE_VOICES: readonly string[] = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
                                                "onyx", "sage", "shimmer", "verse"];

  /** Cast voice → the provider's voice id. Chosen by the voices' published
   *  character (register, age, warmth) so that `bjt synth` runs the day a key
   *  exists; `bjt audition` is how it gets checked by ear, and any change is
   *  made here, once, before the library is synthesised — a live clip is
   *  never re-made, so a recast after that is a library that sounds different
   *  from one item to the next. */
  static VOICE_IDS: Record<string, string> = {
    narrator_f: "sage",
    staff_junior_m: "verse",
    staff_junior_f: "coral",
    staff_mid_m: "ash",
    staff_mid_f: "nova",
    manager_m: "onyx",
    reception_f: "shimmer",
  };

  api_key: string | null;

  constructor(opts: { apiKey?: string | null } = {}) {
    this.api_key = truthy(opts.apiKey) ? opts.apiKey! : (process.env.OPENAI_API_KEY ?? null);
  }

  /** `providerVoice` bypasses the cast — for the audition only, which
   *  asks every voice the model offers to say the same line. */
  async synthesize(text: string, voice: string,
                   opts: { instructions?: string; providerVoice?: string | null } = {}): Promise<Uint8Array> {
    const cls = this.constructor as typeof OpenAIProvider;
    const instructions = opts.instructions ?? "";
    if (!truthy(this.api_key)) {
      throw new RuntimeError("OPENAI_API_KEY is not set");
    }
    const providerVoice = truthy(opts.providerVoice) ? opts.providerVoice! : _cast("OpenAI", cls.VOICE_IDS, voice);
    const body = {
      model: cls.MODEL,
      voice: providerVoice,
      input: applyPronunciation(text),
      instructions: truthy(instructions) ? instructions : directionFor(voice),
      response_format: "wav",
    };
    return await seams.post(
      cls.URL, body,
      { "Authorization": `Bearer ${this.api_key}`, "Content-Type": "application/json" },
    );
  }
}


/** Google's Gemini speech model, over the Gemini API.
 *
 *  The lightest of the three to set up — one API key from AI Studio. It reads
 *  keigo as language rather than as a string of readings, which matters for
 *  the thing this app tests: 伺います and 参ります come out as a person would
 *  say them, not as a dictionary would. Directions are natural language,
 *  prefixed to the line.
 *
 *  The response is raw 16-bit PCM (24 kHz mono, per its MIME type) rather than
 *  a container, so it is wrapped into WAV here. */
export class GeminiProvider implements Provider {
  name: string = "gemini";
  static MODEL = process.env.BJT_GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
  static URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";

  /** Cast voice → prebuilt voice name. Chosen by the voices' published
   *  character; checked by ear with `bjt audition`. */
  static VOICE_IDS: Record<string, string> = {
    narrator_f: "Erinome",       // clear
    staff_junior_m: "Iapetus",   // clear, younger
    staff_junior_f: "Leda",      // youthful
    staff_mid_m: "Charon",       // informative, even
    staff_mid_f: "Sulafat",      // warm
    manager_m: "Alnilam",        // firm
    reception_f: "Autonoe",      // bright
  };

  api_key: string | null;

  constructor(opts: { apiKey?: string | null } = {}) {
    let key: string | null = truthy(opts.apiKey) ? opts.apiKey! : (process.env.GEMINI_API_KEY ?? null);
    if (!truthy(key)) key = process.env.GOOGLE_API_KEY ?? null;
    this.api_key = key;
  }

  async synthesize(text: string, voice: string, opts: { instructions?: string } = {}): Promise<Uint8Array> {
    const cls = this.constructor as typeof GeminiProvider;
    const instructions = opts.instructions ?? "";
    if (!truthy(this.api_key)) {
      throw new RuntimeError("GEMINI_API_KEY is not set");
    }
    const providerVoice = _cast("Gemini", cls.VOICE_IDS, voice);
    const prompt = cls.promptFor(applyPronunciation(text), truthy(instructions) ? instructions : directionFor(voice));
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: providerVoice } },
        },
      },
    };
    const raw = await seams.post(
      cls.URL.replaceAll("{model}", () => cls.MODEL), body,
      { "x-goog-api-key": this.api_key as string, "Content-Type": "application/json" },
    );
    return cls.wavFromResponse(raw);
  }

  /** The direction, then the line — the model speaks the line only. */
  static promptFor(text: string, direction: string): string {
    return `${direction}\n\nSay only this line, exactly as written:\n${text}`;
  }

  static wavFromResponse(raw: Uint8Array): Uint8Array {
    let data: Uint8Array;
    let mime: string;
    try {
      const payload = loads(_UTF8_STRICT.decode(raw));
      const part = _sub(_sub(_sub(_sub(_sub(_sub(payload, "candidates"), 0), "content"), "parts"), 0), "inlineData");
      data = _b64decode(_sub(part, "data"));
      mime = get(part as Record<string, unknown>, "mimeType", "");
    } catch (exc) {
      // Python's (ValueError, KeyError, IndexError, TypeError): a body that
      // is not JSON (or not UTF-8), a field that is missing or of the wrong
      // shape, base64 that does not decode.
      if (exc instanceof SyntaxError || exc instanceof TypeError || exc instanceof ValueError
          || exc instanceof KeyError || exc instanceof channel.IndexError || exc instanceof TypeError_) {
        throw new RuntimeError("Gemini returned no audio: " + _UTF8_REPLACE.decode(raw.subarray(0, 300)), { cause: exc });
      }
      throw exc;
    }
    let rate = 24000;
    for (let field of mime.split(";")) {
      field = strip(field);
      if (field.startsWith("rate=")) {
        rate = toInt(field.slice("rate=".length));
      }
    }
    if (mime.startsWith("audio/wav") || _startsWithRiff(data)) {
      return data;
    }
    return channel.wrapPcm(data, rate);
  }
}


/** Google Cloud Text-to-Speech.
 *
 *  The candidate with the most explicit control and the most setup: a Cloud
 *  project, the API enabled, and application default credentials. Its newest
 *  Japanese voices are native studio recordings driven by a modern model,
 *  which is why it is worth the comparison. Those voices take plain text; the
 *  older ones take SSML, where `<sub>` handles a reading without editing the
 *  text the learner sees.
 *
 *  The Python pipeline reached it through Google's client library, an optional
 *  extra (`google-cloud-texttospeech`) that was imported only when a clip was
 *  asked for and, absent, made the provider refuse with the message below.
 *  There is no such package here and the pipeline takes no dependency for a
 *  comparison voice, so this adapter is that absent case: it casts the voice
 *  (an uncast role is still refused first, as before) and then refuses. What
 *  the client library sent, for whoever restores it: a Chirp voice took the
 *  pronounced text (`applyPronunciation`) as plain text, any other voice took
 *  `toSsml(text)`; the voice was `ja-JP` and the cast name; the audio LINEAR16
 *  at 24000 Hz, returned as `audio_content`. */
export class GoogleProvider implements Provider {
  name: string = "google";

  /** Cast voice → Cloud voice name. The Chirp 3 HD voices for ja-JP. */
  static VOICE_IDS: Record<string, string> = {
    narrator_f: "ja-JP-Chirp3-HD-Kore",
    staff_junior_m: "ja-JP-Chirp3-HD-Puck",
    staff_junior_f: "ja-JP-Chirp3-HD-Leda",
    staff_mid_m: "ja-JP-Chirp3-HD-Charon",
    staff_mid_f: "ja-JP-Chirp3-HD-Aoede",
    manager_m: "ja-JP-Chirp3-HD-Orus",
    reception_f: "ja-JP-Chirp3-HD-Zephyr",
  };

  async synthesize(text: string, voice: string, opts: { instructions?: string } = {}): Promise<Uint8Array> {
    const cls = this.constructor as typeof GoogleProvider;
    _cast("Google Cloud", cls.VOICE_IDS, voice);
    // The client library is not installed (see the class comment).
    throw new RuntimeError("pip install 'bjt-practice[tts-google]' to use this provider",
                           { cause: new ModuleNotFoundError("No module named 'google'") });
  }

  /** Wrap the text, expressing the pronunciation dictionary as `<sub>`.
   *
   *  Better than a plain substitution: the written form stays in the SSML, so
   *  a reviewer reading the request can see what was meant to be said. */
  static toSsml(text: string): string {
    let body = htmlEscape(text);
    for (const term of sorted(Object.keys(PRONUNCIATION), { key: len, reverse: true })) {
      body = body.replaceAll(
        htmlEscape(term), `<sub alias="${PRONUNCIATION[term]}">${htmlEscape(term)}</sub>`,
      );
    }
    return `<speak>${body}</speak>`;
  }
}


/** Python's ImportError for a package that is not there: the cause of the
 *  Google adapter's refusal. */
export class ModuleNotFoundError extends PyError {}


export const PROVIDERS: Record<string, new () => Provider> = {
  silent: SilentProvider,
  gemini: GeminiProvider,
  openai: OpenAIProvider,
  google: GoogleProvider,
};

/** What each real provider needs in the environment before it can be used.
 *  Any one of the names is enough. */
export const CREDENTIALS: Record<string, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  google: ["GOOGLE_APPLICATION_CREDENTIALS"],
};

/** The library's voice. A decision, recorded in code rather than in anybody's
 *  environment, because the cast is fixed for the life of the library and a
 *  clip once live is never re-made: the provider must not follow whichever key
 *  happens to be set on the machine running the job. */
export const DEFAULT = "openai";

/** An override, for trying another provider on a laptop. Not for the workflow. */
export const PROVIDER_ENV = "BJT_TTS_PROVIDER";


/** The real providers whose credentials are in the environment. */
export function available(): string[] {
  return Object.entries(CREDENTIALS)
    .filter(([, keys]) => keys.some((k) => truthy(process.env[k] ?? null)))
    .map(([name]) => name);
}


/** What `--provider auto` means.
 *
 *  `BJT_TTS_PROVIDER` when set, else the library's voice (`DEFAULT`) when its
 *  key is present, else `silent`, so the pipeline still runs end to end on a
 *  machine with no key. Another provider's key alone does not make it the
 *  voice — a job with only GEMINI_API_KEY set synthesises silence and says so,
 *  rather than quietly giving the library a second cast. */
export function defaultProvider(): string {
  const pinned = strip(process.env[PROVIDER_ENV] ?? "").toLowerCase();
  if (pinned) {
    return pinned;
  }
  return available().includes(DEFAULT) ? DEFAULT : "silent";
}


export function getProvider(name: string): Provider {
  if (name === "auto") {
    name = defaultProvider();
  }
  if (!has(PROVIDERS, name)) {
    throw new KeyError(`unknown TTS provider ${repr(name)}; available: ${repr(sorted(Object.keys(PROVIDERS)))}`);
  }
  return new PROVIDERS[name]();
}


/** One JSON request to a voice vendor, the response body as bytes. A
 *  failure is `http.RequestFailed`, whose message names the status and the
 *  first few hundred characters of what came back. */
export async function _post(url: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<Uint8Array> {
  return await http.request("POST", url, { body: new TextEncoder().encode(dumps(body)), headers });
}

/** The request to a voice vendor, replaceable in tests (the Python tests
 *  replaced `providers._post`). Every adapter above sends through it. */
export const seams = {
  post: _post,
};


// ----- Python's behaviour where JavaScript's differs --------------------------

/** `json.loads(raw)` reads bytes as UTF-8, a leading byte-order mark dropped,
 *  and refuses bytes that are not UTF-8 (a ValueError, caught above).
 *  TextDecoder drops the mark by default. */
const _UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

/** `raw.decode("utf-8", "replace")`: a byte-order mark kept as a character,
 *  each broken sequence one U+FFFD. */
const _UTF8_REPLACE = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** Python's name for the type of a JSON value, for a TypeError's message. */
function _typeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "dict";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return Number.isInteger(v) ? "int" : "float";
}

/** `obj[key]` on a parsed JSON value, as Python subscripts it: a dict by its
 *  key (only a string key is ever in one), a list or a string by an integer
 *  index, anything else a TypeError. */
function _sub(obj: unknown, key: string | number): unknown {
  if (typeof key === "number") {
    if (Array.isArray(obj) || typeof obj === "string") {
      const seq: unknown[] = typeof obj === "string" ? [...obj] : obj;
      const i = key < 0 ? seq.length + key : key;
      if (i < 0 || i >= seq.length) throw new channel.IndexError(`${_typeName(obj)} index out of range`);
      return seq[i];
    }
    if (obj !== null && typeof obj === "object") throw new KeyError(String(key));
    throw new TypeError_(`'${_typeName(obj)}' object is not subscriptable`);
  }
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    if (!has(obj, key)) throw new KeyError(repr(key));
    return (obj as Record<string, unknown>)[key];
  }
  if (Array.isArray(obj) || typeof obj === "string") {
    throw new TypeError_(`${_typeName(obj)} indices must be integers or slices, not str`);
  }
  throw new TypeError_(`'${_typeName(obj)}' object is not subscriptable`);
}

/** The base64 alphabet's values; anything else is not part of the data. */
const _B64_VALUES: ReadonlyMap<string, number> = new Map(
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]),
);

/** `base64.b64decode(s)` (not validating), as binascii decodes it: a
 *  character outside the alphabet is skipped, a pad ends the data once a
 *  quantum has two characters, and data left over that is not a whole number
 *  of bytes is an error (Python's binascii.Error, a ValueError). Node's
 *  decoder accepts what Python refuses, which would hand the next step
 *  noise instead of saying there was no audio. */
export function _b64decode(s: unknown): Uint8Array {
  if (typeof s !== "string") {
    throw new TypeError_(`argument should be a bytes-like object or ASCII string, not '${_typeName(s)}'`);
  }
  if (new RegExp("[^\\x00-\\x7f]").test(s)) {
    throw new ValueError("string argument should contain only ASCII characters");
  }
  const out: number[] = [];
  let quadPos = 0;
  let leftchar = 0;
  let pads = 0;
  for (const ch of s) {
    if (ch === "=") {
      // (A pad counts only once two characters of the quantum are in.)
      if (quadPos >= 2 && quadPos + ++pads >= 4) {
        // A pad sequence means we should not parse more input.
        return Uint8Array.from(out);
      }
      continue;
    }
    const v = _B64_VALUES.get(ch);
    if (v === undefined) continue;
    pads = 0;
    switch (quadPos) {
      case 0:
        quadPos = 1;
        leftchar = v;
        break;
      case 1:
        quadPos = 2;
        out.push(((leftchar << 2) | (v >> 4)) & 0xff);
        leftchar = v & 0x0f;
        break;
      case 2:
        quadPos = 3;
        out.push(((leftchar << 4) | (v >> 2)) & 0xff);
        leftchar = v & 0x03;
        break;
      default:
        quadPos = 0;
        out.push(((leftchar << 6) | v) & 0xff);
        leftchar = 0;
        break;
    }
  }
  if (quadPos === 1) {
    throw new ValueError(
      "Invalid base64-encoded string: number of data characters "
      + `(${Math.floor(out.length / 3) * 4 + 1}) cannot be 1 more than a multiple of 4`,
    );
  }
  if (quadPos !== 0) {
    throw new ValueError("Incorrect padding");
  }
  return Uint8Array.from(out);
}

/** `data[:4] == b"RIFF"`. */
function _startsWithRiff(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
}
