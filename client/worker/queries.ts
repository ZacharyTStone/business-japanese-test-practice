/**
 * Every query the app makes, by name — the whole surface a browser can reach.
 *
 * The app names a query and passes its arguments; it cannot send SQL, a table
 * or a column list. Each entry reads its arguments narrowly and calls the
 * logic in core/, which scopes every row to the caller. The rules of the data
 * layer hold here too: the app never grades an answer (the INSERT does, from
 * the item — core/grade.ts), nothing here chooses what is served next but
 * the queue (core/queue.ts), and a caller who is not on the tester list
 * reaches none of it (index.ts refuses them before any query runs).
 *
 * The shaping that follows a query in the app — joining answers to their
 * questions, tallying words — stays in the app (`src/lib/db/shape.ts`,
 * `src/lib/words.ts`), where its tests are.
 *
 * Every query is run against a real local D1, with the schema and the whole
 * published bank, by worker/test/ — so a column that does not exist, a write
 * the schema refuses, or a learner seeing another's rows, fails CI rather than
 * a screen. A query with no case there fails too.
 */
import * as bank from "./core/bank";
import type { Learner } from "./core/caller";
import { apiError } from "./core/errors";
import { recordAttempt } from "./core/grade";
import { myLevels } from "./core/levels";
import * as profile from "./core/profile";
import { nextItems } from "./core/queue";
import * as record from "./core/record";
import { loadSnapshot } from "./core/snapshot";
import type { Db } from "./core/sql";
import { iso } from "./core/time";
import { normaliseEmail } from "./identity";

export type Args = Record<string, unknown>;
export type Ctx = { db: Db; learner: Learner; now: number; random?: (id: string) => number };
export type Query = (ctx: Ctx, args: Args) => Promise<unknown>;

// ----- arguments --------------------------------------------------------------
//
// Checked for type here, because the alternative is a database error three
// layers down. Checked for range only as far as the column's own type goes:
// what a value may be is the schema's constraints' and triggers' call, and a
// Worker stricter than the database would refuse an answer it would take.

function bad(name: string, what: string): never {
  throw apiError("invalid_argument", `${name} must be ${what}`);
}

function text(args: Args, name: string, max = 200): string {
  const v = args[name];
  if (typeof v !== "string" || v.length === 0 || v.length > max) bad(name, `a string of 1–${max} characters`);
  return v;
}

function textOrEmpty(args: Args, name: string, max: number): string {
  const v = args[name] ?? "";
  if (typeof v !== "string" || v.length > max) bad(name, `a string of at most ${max} characters`);
  return v;
}

function textOrNull(args: Args, name: string, max = 200): string | null {
  return args[name] == null ? null : text(args, name, max);
}

function int(args: Args, name: string, min: number, max: number): number {
  const v = args[name];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) bad(name, `an integer in ${min}–${max}`);
  return v;
}

function intOrNull(args: Args, name: string, min: number, max: number): number | null {
  return args[name] == null ? null : int(args, name, min, max);
}

function bool(args: Args, name: string): boolean {
  const v = args[name];
  if (typeof v !== "boolean") bad(name, "true or false");
  return v;
}

function textList(args: Args, name: string, maxItems: number): string[] {
  const v = args[name];
  if (!Array.isArray(v) || v.length > maxItems || !v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)) {
    bad(name, `a list of at most ${maxItems} ids`);
  }
  return [...new Set(v as string[])];
}

const INT4 = [-2_147_483_648, 2_147_483_647] as const;
const INT2 = [-32_768, 32_767] as const;

/** The profile fields a learner may change. `target_level` is the database's. */
const PROFILE_FIELDS = ["display_name", "daily_goal", "exam_date", "timed_reading"] as const;

/** The closed set `item_feedback.reason` checks; refused here first so a bad
 *  value reads as a bad argument, not a constraint name. */
const FEEDBACK_REASONS = new Set(["unnatural", "wrong_answer", "ambiguous", "unclear", "audio", "other"]);

// ----- the queries ----------------------------------------------------------

export const queries: Record<string, Query> = {
  // --- who is asking ---------------------------------------------------------

  /** Who the database takes this caller to be — asked once when the app
   *  opens (src/lib/auth.tsx). A caller not on the list never gets here. */
  async whoami({ learner }) {
    return { user_id: learner.userId, email: learner.email, is_tester: learner.isTester };
  },

  // --- a set -----------------------------------------------------------------

  /** The practice queue: how many, and nothing else (core/queue.ts). */
  async nextItems({ db, learner, now, random }, args) {
    return nextItems(db, learner, int(args, "limit", ...INT4), now, random);
  },

  async optionLabels({ db }, args) {
    return record.optionLabels(db, text(args, "voice", 64), textList(args, "texts", 8));
  },

  async startSession({ db, learner, now }) {
    return profile.startSession(db, learner, now);
  },

  async finishSession({ db, learner, now }, args) {
    return profile.finishSession(db, learner, text(args, "sessionId", 64), now);
  },

  /** An answer, graded by the database from the item (core/grade.ts). */
  async recordAttempt({ db, learner, now }, args) {
    return recordAttempt(
      db,
      learner,
      {
        itemId: text(args, "itemId"),
        chosenIndex: int(args, "chosenIndex", ...INT2),
        sessionId: textOrNull(args, "sessionId", 64),
        elapsedMs: intOrNull(args, "elapsedMs", ...INT4),
        thinkMs: intOrNull(args, "thinkMs", ...INT4),
        replays: int(args, "replays", ...INT2),
        peeked: bool(args, "peeked"),
        standsFor: textOrNull(args, "standsFor"),
      },
      now
    );
  },

  /** An answer the database may already have: the outbox asks before sending
   *  one again (src/lib/outbox.ts). */
  async findAttempt({ db, learner }, args) {
    return record.findAttempt(db, learner, text(args, "itemId"), int(args, "chosenIndex", ...INT2), int(args, "replays", ...INT2));
  },

  async pace({ db }) {
    return record.pace(db);
  },

  async reportItem({ db, learner, now }, args) {
    const reason = text(args, "reason", 32);
    if (!FEEDBACK_REASONS.has(reason)) bad("reason", "one of " + [...FEEDBACK_REASONS].join(", "));
    return bank.reportItem(db, learner, text(args, "itemId"), reason, textOrEmpty(args, "note", 2000).trim(), now);
  },

  async mayVeto({ learner }) {
    return bank.mayVeto(learner);
  },

  async vetoItem({ db, learner, now }, args) {
    return bank.vetoItem(db, learner, text(args, "itemId"), textOrEmpty(args, "note", 2000).trim(), now);
  },

  // --- the learner's own row --------------------------------------------------

  async profile({ db, learner }) {
    return profile.profile(db, learner);
  },

  async updateProfile({ db, learner, now }, args) {
    const raw = args.patch;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("patch", "an object");
    const given = raw as Args;
    for (const k of Object.keys(given)) {
      if (!(PROFILE_FIELDS as readonly string[]).includes(k)) bad("patch", `limited to ${PROFILE_FIELDS.join(", ")}`);
    }
    const patch: profile.ProfilePatch = {};
    if ("display_name" in given) patch.display_name = textOrNull(given, "display_name", 200);
    if ("daily_goal" in given) patch.daily_goal = int(given, "daily_goal", ...INT2);
    if ("exam_date" in given) {
      const d = textOrNull(given, "exam_date", 10);
      if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad("exam_date", "a date as YYYY-MM-DD, or null");
      patch.exam_date = d;
    }
    if ("timed_reading" in given) patch.timed_reading = bool(given, "timed_reading");
    return profile.updateProfile(db, learner, patch, now);
  },

  async resetProgress({ db, learner, now }) {
    return profile.resetProgress(db, learner, now);
  },

  // The address shown on the screen that asked, as a confirmation that the
  // app is deleting the account it thinks it is: a mismatch deletes nothing.
  async deleteAccount({ db, learner }, args) {
    if (normaliseEmail(text(args, "email", 320)) !== learner.email) bad("email", "the signed-in account's address");
    return profile.deleteAccount(db, learner);
  },

  async hasAdFree({ db, learner }) {
    return profile.hasAdFree(db, learner);
  },

  // --- the record --------------------------------------------------------------

  async sectionLevels({ db, learner, now }) {
    return myLevels(await loadSnapshot(db, learner), iso(now));
  },

  async typeStats({ db, learner, now }) {
    return record.typeStats(db, learner, now);
  },

  async tagStats({ db, learner, now }) {
    return record.tagStats(db, learner, now);
  },

  async roleTraps({ db, learner, now }) {
    return record.roleTraps(db, learner, now);
  },

  async reviewLoad({ db, learner, now }) {
    return record.reviewLoad(db, learner, now);
  },

  async recentPace({ db, learner }, args) {
    return record.recentPace(db, learner, int(args, "limit", 1, 1000));
  },

  async streak({ db, learner, now }) {
    return record.streak(db, learner, now);
  },

  async day({ db, learner, now }) {
    return record.day(db, learner, now);
  },

  async history({ db, learner }, args) {
    return record.history(db, learner, int(args, "limit", 1, 1000), textOrNull(args, "itemId"));
  },

  async itemDetail({ db }, args) {
    return record.itemDetail(db, text(args, "itemId"));
  },

  async vocab({ db, learner }, args) {
    return record.vocab(db, learner, int(args, "limit", 1, 5000));
  },

  async wordList({ db, learner }) {
    return record.wordList(db, learner);
  },

  async notes({ db, learner }, args) {
    return bank.notes(db, learner, textList(args, "itemIds", 1000));
  },

  async saveNote({ db, learner }, args) {
    return bank.saveNote(db, learner, text(args, "itemId"), textOrEmpty(args, "note", 4000).trim());
  },
};
