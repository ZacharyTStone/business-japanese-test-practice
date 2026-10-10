/**
 * Runtime configuration, read from the environment with sensible defaults.
 *
 * Everything is overridable so the single user can tune models and paths without
 * touching code. Nothing here is secret; the API key is read by the Anthropic SDK
 * itself from ANTHROPIC_API_KEY.
 *
 * Each setting is read once, when the module loads. A test that needs a
 * different value replaces it for the one test (tests/helpers.ts `setConfig`).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { toFloat, toInt } from "./py.ts";

export const ROOT = path.resolve(import.meta.dirname, "..");


/** Load a .env file, the repository's and then the working directory's.
 *  Real exported environment variables always win: a key already set is
 *  never overwritten. */
function loadDotenv(): void {
  for (const file of [path.join(ROOT, ".env"), path.resolve(".env")]) {
    if (!existsSync(file)) continue;
    const values = parseEnv(readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotenv();


function env(name: string, dflt: string): string {
  return process.env[name] ?? dflt;
}

function flag(name: string): boolean {
  return !["0", "false", "no", "off"].includes(env(name, "1").trim().toLowerCase());
}


// The generator model. Sonnet writes the drafts at two and a half times less
// than Opus per token; what holds the bar is that every draft must still pass
// the proofreader and the answerability gate below. BJT_MODEL=claude-opus-5
// switches the writer to Opus.
export const GEN_MODEL = env("BJT_MODEL", "claude-sonnet-5");

// How hard the generator thinks. Output tokens are the expensive half of every
// generation and thinking is most of the output, so this is the single biggest
// dial on the nightly bill after the model itself. Medium keeps the honorific
// judgement.
export const GEN_EFFORT = env("BJT_GEN_EFFORT", "medium");

// How many discards in a row a shelf tolerates before the night gives up on it.
// A generator that is wrong about a type is wrong about it all night, and every
// further draft costs as much as the first. Three is enough to be sure it is
// the shelf and not bad luck.
export const SLOT_PATIENCE = toInt(env("BJT_SLOT_PATIENCE", "3"));

// The model used for the answerability gate, the discriminator judge and the
// scene reviewer. It must be genuinely capable — the cold/full test only means
// something if the model taking it could pass it ("a strong model should fail
// cold, succeed full") — and Sonnet is. The gate makes six calls per draft, so
// at Opus rates it would be the largest cost of a kept item.
// BJT_JUDGE_MODEL=claude-opus-5 switches it to Opus.
export const JUDGE_MODEL = env("BJT_JUDGE_MODEL", "claude-sonnet-5");

// The proofreader. It runs once per item the moment the item exists, before the
// expensive gate, and it is deliberately the cheapest model in the family: what
// it looks for — an explanation that names the wrong option, two options that say
// the same thing, a dropped particle — needs care, not expertise. Anything that
// needs expertise is the answerability gate's job and stays there. One small call
// per item, against six large ones, is why this saves money rather than costing
// it: a broken item never reaches the gate.
export const SANITY_MODEL = env("BJT_SANITY_MODEL", "claude-haiku-4-5");

// Set BJT_SANITY=0 to skip it. An item that is not checked is recorded as not
// checked rather than as clean — see bjt/fidelity/sanity.ts.
export const SANITY_ENABLED = flag("BJT_SANITY");

// ----- the ceilings ------------------------------------------------------
//
// A patient loop and a cheap model are what keep a normal night cheap; these
// are what keep a broken night from being expensive. They are deliberately
// independent of each other, so that a bug in one of them is caught by the
// others.

// The most one process may spend — or one job, when BJT_SPEND_LEDGER names
// the file its steps share (bjt/llm.ts `Spend`); the call and minute ceilings
// below are shared the same way — measured from the usage every response
// reports and priced with the table in bjt/llm.ts. Checked before each call;
// reached, the run stops with what it has (LLMSpendLimitError, which the
// nightly loop treats like an empty account). Two dollars is a normal night
// on Sonnet with room to spare, and below anything worth being angry about.
export const RUN_BUDGET_USD = toFloat(env("BJT_RUN_BUDGET_USD", "2"));

// The most calls one process may make, whatever they cost. The dollar ceiling
// depends on the price table being right; this one does not. Twelve items at
// three attempts, each a generation, a proofread, six gate trials and five
// difficulty probes, is a little over four hundred; a loop that is still
// calling after that is a loop that is wrong.
export const RUN_MAX_CALLS = toInt(env("BJT_RUN_MAX_CALLS", "500"));

// The most minutes one process may run, counted from when it started and
// checked before every call like the two above. A night is minutes, and a run
// still generating after hours is a broken one. The workflow has its own clock
// (timeout-minutes) a little above this one; this one stops with what it
// wrote, that one just stops.
export const RUN_MAX_MINUTES = toFloat(env("BJT_RUN_MAX_MINUTES", "30"));

// How long one API call may take before the SDK gives up on it, and how many
// times it may retry a transient failure. A call that hangs is paid for in
// minutes; a call retried many times is paid for in money. The retries are
// made by bjt/llm.ts, not the SDK, so each one is counted and checked against
// the ceilings above before it is sent.
export const API_TIMEOUT_SECONDS = toFloat(env("BJT_API_TIMEOUT_SECONDS", "300"));
export const API_MAX_RETRIES = toInt(env("BJT_API_MAX_RETRIES", "2"));

// No single call may ask for more output than this, and no generation may
// think harder than this, whatever the caller or an environment variable
// says. Output is the expensive half of every call and thinking is most of
// the output.
export const MAX_TOKENS_CEILING = toInt(env("BJT_MAX_TOKENS_CEILING", "8000"));
export const EFFORT_CEILING = env("BJT_EFFORT_CEILING", "high");

// The most a night may be asked to write, whatever the workflow input says.
// A manual run may ask for more than the plan's defaults (plan.DEFAULT_BUDGET
// and DEFAULT_PER_SLOT) up to here and no further, so a number typed into a
// box cannot buy an expensive night.
export const NIGHT_MAX_BUDGET = toInt(env("BJT_NIGHT_MAX_BUDGET", "24"));
export const NIGHT_MAX_PER_SLOT = toInt(env("BJT_NIGHT_MAX_PER_SLOT", "6"));

export const DB_PATH = env("BJT_DB_PATH", path.join(ROOT, "bjt.db"));

// Licensed few-shot examples, official sample items, vocab lists, and level
// descriptors live here. Gitignored — see README.
export const SEEDS_DIR = env("BJT_SEEDS_DIR", path.join(ROOT, "seeds"));

// The seed tables (場面×関係×機能×レベル). Our own design, not licensed — these
// ARE committed, unlike seeds/. See bjt/seedtable.ts.
export const SEEDTABLE_DIR = env("BJT_SEEDTABLE_DIR", path.join(ROOT, "seedtable"));

// Where batch runs write their bundles (the JSON the app ships with).
export const BATCH_DIR = env("BJT_BATCH_DIR", path.join(ROOT, "batches"));

// Where the media jobs put files before they are uploaded: `media/audio/...`
// and `media/scenes/...`, mirroring the storage buckets. Gitignored — audio and
// artwork are large, regenerable, and belong in object storage, not in git.
export const MEDIA_DIR = env("BJT_MEDIA_DIR", path.join(ROOT, "media"));

// How many recent topics to feed back into a generation prompt as a
// "do not repeat these" list.
export const RECENT_TOPICS_WINDOW = toInt(env("BJT_RECENT_TOPICS_WINDOW", "25"));

// Answerability gate: run each side this many times and require consistency.
export const GATE_TRIALS = toInt(env("BJT_GATE_TRIALS", "3"));

// The difficulty probe. The gate's full-view rate is a poor difficulty prior
// for an item nobody has answered yet: a strong model with the whole stimulus
// answers nearly everything, so the number is 0.67 or 1.0 and almost always
// 1.0. That is the gate doing its job — "is this answerable at all?" is a
// question a strong reader should say yes to — but a rate that never moves
// carries no information about how hard the item is. A weaker model is the
// better instrument precisely because it fails sometimes: its pass rate spreads
// across items in roughly the order a learner would find them hard, which is
// all a prior needs to do. The proofreader's model is the natural pick — the
// cheapest in the family, already in use. The probe runs after the gate and
// only on items the gate kept, so it costs DIFFICULTY_TRIALS small calls per
// shipped item and nothing per discarded one. Set but empty means unset: the
// nightly workflow passes a repository variable that may not exist.
export const DIFFICULTY_MODEL = env("BJT_DIFFICULTY_MODEL", "").trim() || SANITY_MODEL;
export const DIFFICULTY_TRIALS = toInt(env("BJT_DIFFICULTY_TRIALS", "5"));

// How the probe turns the model's answers into a rate. "confidence" (from
// 2026-10-10) asks for a probability on every option, once per rotation of
// the options, and the rate is the mean probability on the key: a pass rate
// over five trials was 1.0 for about half the bank, which orders nothing.
// "trials" is the pass rate, kept for `bjt probe --compare` and the tests.
// A bundle records the method its rates came from (`difficulty_method`), and
// `bjt probe` re-measures every bundle that does not carry the current one,
// so the bank holds one kind of number.
export const DIFFICULTY_METHOD = env("BJT_DIFFICULTY_METHOD", "confidence");

// A prototype, off unless asked for: BJT_DIFFICULTY_MODEL=jev-latest makes the
// probe one call to TypeSafe AI's Jev, which returns a probability for every
// option instead of an answer, and the probability it gives the key is the rate
// (bjt/jev.ts). DIFFICULTY_TRIALS does not apply to it. The key is read from
// TYPESAFE_API_KEY when the call is made, as the Anthropic SDK reads its own.
// `bjt probe --compare jev-latest` sets the two instruments side by side and
// writes nothing, which is the evidence to read before letting it write a rate.
export const JEV_URL = env("BJT_JEV_URL", "https://api.typesafe.ai/v1/systemone");

// Set BJT_DIFFICULTY=0 to skip it. An item that was not probed carries the
// gate's full-view rate, which is the honest fallback rather than a made-up
// number — see bjt/fidelity/difficulty.ts.
export const DIFFICULTY_ENABLED = flag("BJT_DIFFICULTY");

// The image model that draws the scene bank, and how hard it tries. Medium is a
// quarter of the price of "high" and a flat illustration cannot tell the
// difference. Attempts is how many drafts the review gate may reject before a
// scene ships without a picture; the nightly job only draws once a week.
export const IMAGE_MODEL = env("BJT_IMAGE_MODEL", "gpt-image-1");
export const IMAGE_QUALITY = env("BJT_IMAGE_QUALITY", "medium");
export const SCENE_ATTEMPTS = toInt(env("BJT_SCENE_ATTEMPTS", "3"));

// How many drafts a scene may be refused over its whole life before the job
// stops drawing it. Counted in the bucket (`rejected/<scene>-<n>.txt`, one
// marker per refused draft), because the runner forgets everything each
// night and the bucket is the only record it has. Without it, a scene the
// reviewer always refuses would be redrawn every week for ever; with it, six
// refusals (two weeks) and the scene ships on its stand-in (bjt/scenes.ts
// STAND_INS) until somebody draws it by hand. A per-item picture (画像把握) has
// no stand-in: after this many its item stays unserved, and the summary says so.
export const SCENE_LIFETIME_ATTEMPTS = toInt(env("BJT_SCENE_LIFETIME_ATTEMPTS", "6"));

// A shelf that has written nothing on this many nights in a row rests: the
// work order passes it over for SHELF_REST_DAYS after its last miss, then tries
// it once more (bjt/shelf_rest.ts). Counted in the bucket, like the picture
// refusals above. Without it, a shelf the generator cannot write stays furthest
// behind and takes every night's budget: from 2026-09-28 three nights in a row
// spent theirs on the same three shelves and wrote nothing. 0 turns it off.
export const SHELF_REST_AFTER = toInt(env("BJT_SHELF_REST_AFTER", "3"));
export const SHELF_REST_DAYS = toFloat(env("BJT_SHELF_REST_DAYS", "7"));

// The most per-item pictures one run may draft. A picture costs an image call
// and a handful of vision calls per draft, so a night that found forty new
// 画像把握 items in the tree must not draw forty pictures. Four is a night.
export const NIGHT_MAX_PICTURES = toInt(env("BJT_NIGHT_MAX_PICTURES", "4"));

// How hard the image API compresses the WebP it returns (0–100, higher is
// larger). The upload refuses anything over SCENE_MAX_BYTES, the limit the
// pipeline keeps for pictures in the R2 media bucket, and a 1536×1024 "high"
// draft can exceed it. 80 keeps a flat illustration far under the limit with
// no visible cost, and the limit is checked before a byte is sent.
export const IMAGE_COMPRESSION = toInt(env("BJT_IMAGE_COMPRESSION", "80"));
export const SCENE_MAX_BYTES = 2 * 1024 * 1024;

// The most one clip may be, checked before it is uploaded (bjt/tts/synth.ts),
// as SCENE_MAX_BYTES is for a picture. A clean 24 kHz clip runs to about 48 KB
// a second, so this is over a minute and a half of narration; a clip near it
// is a planning bug, not a long question.
export const AUDIO_MAX_BYTES = 5 * 1024 * 1024;
