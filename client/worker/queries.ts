/**
 * Every query the app makes, by name — what `client/src/lib/db/` used to send
 * to PostgREST, now run here as the signed-in learner (see db.ts).
 *
 * Each entry is fixed SQL. The app names a query and passes its arguments; it
 * cannot send SQL, a table name or a column list, so the surface a client can
 * reach is exactly this file, and every row it touches is still filtered by
 * row-level security as before. The two rules of the data layer hold here too:
 * the app never grades an answer (the insert trigger does, and `recordAttempt`
 * returns its verdict), and nothing here chooses what is served next
 * (`nextItems` is `next_items()` and nothing else).
 *
 * The shaping that used to follow a query in the app — joining answers to
 * their questions, tallying words — stays in the app (`src/lib/db/shape.ts`,
 * `src/lib/words.ts`), where its tests are. Queries the app ran several of in
 * a row now come back together, one round trip instead of three or four.
 *
 * Every query is executed against run.sh's throwaway Postgres as a tester by
 * worker/queries.db.test.ts, so a column that does not exist, a write the
 * signed-in role may not make, or a policy that hides a row it should not,
 * fails CI rather than a screen.
 */
import { apiError, maybeOne, one, rows, type Tx } from "./db";

export type Args = Record<string, unknown>;
export type Query = (tx: Tx, args: Args) => Promise<unknown>;

// ----- arguments --------------------------------------------------------------
//
// Checked for type here, because the alternative is a Postgres cast error
// three layers down. Checked for range only as far as the column's own type
// goes: what a value may be is the table's constraints' and triggers' call,
// as it was under PostgREST, and a Worker stricter than the database would
// refuse an answer the database would have taken.

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

/** The profile fields a learner may change — the same four the column grant on
 *  `profiles` allows. `target_level` is the database's to move. */
const INT4 = [-2_147_483_648, 2_147_483_647] as const;
const INT2 = [-32_768, 32_767] as const;

const PROFILE_FIELDS = ["display_name", "daily_goal", "exam_date", "timed_reading"] as const;

/** The closed set `item_feedback.reason` checks; refused here first so a bad
 *  value reads as a bad argument, not a constraint name. */
const FEEDBACK_REASONS = new Set(["unnatural", "wrong_answer", "ambiguous", "unclear", "audio", "other"]);

// ----- the queries ----------------------------------------------------------

export const queries: Record<string, Query> = {
  // --- who is asking ---------------------------------------------------------

  /** Who the database takes this caller to be, and whether the tester list
   *  has them — asked once when the app opens (src/lib/auth.tsx). */
  async whoami(tx) {
    return one(tx, tx`select auth.uid() as user_id, auth.jwt() ->> 'email' as email, public.is_tester() as is_tester`);
  },

  // --- a set -----------------------------------------------------------------

  /** The practice queue: how many, and nothing else (see next_items()). */
  async nextItems(tx, args) {
    const limit = int(args, "limit", ...INT4);
    return rows(tx, tx`select * from public.next_items(${limit})`);
  },

  /** The four spoken option numbers, by what they say. */
  async optionLabels(tx, args) {
    const voice = text(args, "voice", 64);
    const texts = textList(args, "texts", 8);
    if (texts.length === 0) return [];
    return rows(
      tx,
      tx`select text, audio_path from public.audio_clips where voice = ${voice} and text in ${tx(texts)}`
    );
  },

  async startSession(tx) {
    return one(tx, tx`insert into public.practice_sessions (user_id) values (auth.uid()) returning id`);
  },

  async finishSession(tx, args) {
    const id = text(args, "sessionId", 64);
    await tx`update public.practice_sessions set finished_at = now() where id = ${id}`;
    return null;
  },

  /** An answer, graded by the database: the insert trigger fills in who,
   *  whether it was right and which role caught them, and this returns that. */
  async recordAttempt(tx, args) {
    const row = {
      item_id: text(args, "itemId"),
      chosen_index: int(args, "chosenIndex", ...INT2),
      session_id: textOrNull(args, "sessionId", 64),
      elapsed_ms: intOrNull(args, "elapsedMs", ...INT4),
      think_ms: intOrNull(args, "thinkMs", ...INT4),
      replays: int(args, "replays", ...INT2),
      peeked: bool(args, "peeked"),
      stands_for: textOrNull(args, "standsFor"),
    };
    return one(
      tx,
      tx`insert into public.attempts ${tx(row)} returning is_correct, chosen_role`
    );
  },

  /** An answer the database may already have: the outbox asks before sending
   *  one again (src/lib/outbox.ts). */
  async findAttempt(tx, args) {
    const itemId = text(args, "itemId");
    const chosenIndex = int(args, "chosenIndex", ...INT2);
    const replays = int(args, "replays", ...INT2);
    return rows(
      tx,
      tx`select is_correct, chosen_role, elapsed_ms, think_ms
         from public.attempts
         where item_id = ${itemId} and chosen_index = ${chosenIndex} and replays = ${replays}
         order by answered_at desc
         limit 20`
    );
  },

  async pace(tx) {
    return rows(
      tx,
      tx`select id, seconds_per_item, typical_chars from public.item_types where seconds_per_item is not null`
    );
  },

  /** One report per person per item: a second press replaces the first. The
   *  insert is tried first and, on the unique violation, the row is updated —
   *  `user_id` is the trigger's to fill, so it is not a conflict target here
   *  any more than it was in the app. */
  async reportItem(tx, args) {
    const itemId = text(args, "itemId");
    const reason = text(args, "reason", 32);
    if (!FEEDBACK_REASONS.has(reason)) bad("reason", "one of " + [...FEEDBACK_REASONS].join(", "));
    const note = textOrEmpty(args, "note", 2000).trim();
    try {
      await tx.savepoint((sp) => sp`insert into public.item_feedback (item_id, reason, note) values (${itemId}, ${reason}, ${note})`);
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") throw e;
      await tx`update public.item_feedback set reason = ${reason}, note = ${note} where item_id = ${itemId}`;
    }
    return null;
  },

  async mayVeto(tx) {
    const [r] = await tx`select public.may_i_veto() as v`;
    return r?.v === true;
  },

  /** Unpublish a question for everybody. `veto_item()` re-checks who may. */
  async vetoItem(tx, args) {
    const itemId = text(args, "itemId");
    const note = textOrEmpty(args, "note", 2000).trim();
    await tx`select public.veto_item(${itemId}, ${note})`;
    return null;
  },

  // --- the learner's own row --------------------------------------------------

  async profile(tx) {
    return maybeOne(
      tx,
      tx`select id, display_name, target_level, daily_goal, exam_date, timed_reading from public.profiles`
    );
  },

  async updateProfile(tx, args) {
    const raw = args.patch;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("patch", "an object");
    const given = raw as Args;
    const patch: Record<string, string | number | boolean | null> = {};
    for (const k of Object.keys(given)) {
      if (!(PROFILE_FIELDS as readonly string[]).includes(k)) bad("patch", `limited to ${PROFILE_FIELDS.join(", ")}`);
    }
    // The values are checked for type here and for range by the table's own
    // constraints and the daily-goal trigger, which say no in their own words.
    if ("display_name" in given) patch.display_name = textOrNull(given, "display_name", 200);
    if ("daily_goal" in given) patch.daily_goal = int(given, "daily_goal", ...INT2);
    if ("exam_date" in given) {
      const d = textOrNull(given, "exam_date", 10);
      if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad("exam_date", "a date as YYYY-MM-DD, or null");
      patch.exam_date = d;
    }
    if ("timed_reading" in given) patch.timed_reading = bool(given, "timed_reading");
    const keys = Object.keys(patch);
    if (keys.length === 0) return null;
    await tx`update public.profiles set ${tx(patch, keys)} where id = auth.uid()`;
    return null;
  },

  /** All of this learner's history or none of it (reset_my_progress()). */
  async resetProgress(tx) {
    const [r] = await tx`select public.reset_my_progress() as v`;
    return r?.v ?? null;
  },

  async hasAdFree(tx) {
    const found = await rows(
      tx,
      tx`select product from public.entitlements where product = 'ads_free' and revoked_at is null`
    );
    return found.length > 0;
  },

  // --- the record --------------------------------------------------------------

  async sectionLevels(tx) {
    return rows(tx, tx`select section, level, changed_at, placed from public.v_my_levels`);
  },

  async typeStats(tx) {
    return rows(tx, tx`select * from public.v_my_type_stats order by sort_order`);
  },

  async tagStats(tx) {
    return rows(tx, tx`select * from public.v_my_tag_stats order by accuracy`);
  },

  async roleTraps(tx) {
    return rows(tx, tx`select * from public.v_my_role_traps order by times_chosen desc`);
  },

  async reviewLoad(tx) {
    return one(tx, tx`select due_now, tracked, next_due_at from public.v_my_review_load`);
  },

  async recentPace(tx, args) {
    const limit = int(args, "limit", 1, 1000);
    return rows(
      tx,
      tx`select elapsed_ms from public.attempts
         where elapsed_ms is not null
         order by answered_at desc
         limit ${limit}`
    );
  },

  async streak(tx) {
    const [r] = await tx`select public.my_streak() as v`;
    return r?.v ?? 0;
  },

  async day(tx) {
    return one(
      tx,
      tx`select goal, answered_today, unlimited, max_today, left_today, goal_max from public.v_my_day`
    );
  },

  /** The review list: the latest answers (or one question's), with their
   *  questions, options and the type labels, for `joinHistory`. */
  async history(tx, args) {
    const limit = int(args, "limit", 1, 1000);
    const itemId = textOrNull(args, "itemId");
    const attempts = await rows<{ item_id: string }>(
      tx,
      tx`select id, item_id, answered_at, is_correct, chosen_index, chosen_role
         from public.attempts
         ${itemId ? tx`where item_id = ${itemId}` : tx``}
         order by answered_at desc
         limit ${limit}`
    );
    if (attempts.length === 0) return { attempts, items: [], options: [], types: [] };
    const ids = [...new Set(attempts.map((a) => a.item_id))];
    const [items, options, types] = await Promise.all([
      rows(
        tx,
        tx`select id, item_type, level, topic, stem, correct_index, explanation_ja, explanation_en
           from public.items where id in ${tx(ids)}`
      ),
      rows(tx, tx`select item_id, position, text, role, why from public.item_options where item_id in ${tx(ids)}`),
      rows(tx, tx`select id, label_ja from public.item_types`),
    ]);
    return { attempts, items, options, types };
  },

  /** One past question opened on the review screen, or a word's sentence:
   *  the question's lines and every clip they point at. */
  async itemDetail(tx, args) {
    const itemId = text(args, "itemId");
    const item = await one<{ dialogue: { clip_id?: string | null }[] | null; narration_clip_id: string | null }>(
      tx,
      tx`select stem, documents, dialogue, vocab_notes, narration_clip_id from public.items where id = ${itemId}`
    );
    const options = await rows<{ clip_id: string | null }>(
      tx,
      tx`select position, text, clip_id from public.item_options where item_id = ${itemId} order by position`
    );
    const clipIds = [
      ...new Set(
        [...(item.dialogue ?? []).map((t) => t.clip_id), item.narration_clip_id, ...options.map((o) => o.clip_id)].filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      ),
    ];
    const clips = clipIds.length
      ? await rows(tx, tx`select id, audio_path from public.audio_clips where id in ${tx(clipIds)}`)
      : [];
    return { item, options, clips };
  },

  /** The questions that caught this learner, newest first, with their notes. */
  async vocab(tx, args) {
    const limit = int(args, "limit", 1, 5000);
    const attempts = await rows<{ item_id: string }>(
      tx,
      tx`select item_id, answered_at from public.attempts
         where is_correct = false
         order by answered_at desc
         limit ${limit}`
    );
    if (attempts.length === 0) return { attempts, items: [] };
    const ids = [...new Set(attempts.map((a) => a.item_id))];
    const items = await rows(tx, tx`select id, vocab_notes from public.items where id in ${tx(ids)}`);
    return { attempts, items };
  },

  /** Every question this learner has answered — timeouts included, the
   *  question was on screen — with its correct option and its type's section,
   *  for `buildWordList`. Row-level security narrows attempts to this learner
   *  and hides unpublished questions, so a withdrawn one's words go with it. */
  async wordList(tx) {
    const [items, correct, types] = await Promise.all([
      rows(
        tx,
        tx`select id, item_type, level, stem, dialogue, documents, vocab_notes
           from public.items
           where id in (select item_id from public.attempts)`
      ),
      rows(
        tx,
        tx`select item_id, text from public.item_options
           where role = 'correct' and item_id in (select item_id from public.attempts)`
      ),
      rows(tx, tx`select id, section from public.item_types`),
    ]);
    return { items, correct, types };
  },

  async notes(tx, args) {
    const ids = textList(args, "itemIds", 1000);
    if (ids.length === 0) return [];
    return rows(tx, tx`select item_id, note from public.review_notes where item_id in ${tx(ids)}`);
  },

  /** Keep a note, or remove it when it has been emptied. */
  async saveNote(tx, args) {
    const itemId = text(args, "itemId");
    const note = textOrEmpty(args, "note", 4000).trim();
    if (!note) {
      await tx`delete from public.review_notes where item_id = ${itemId}`;
      return null;
    }
    await tx`insert into public.review_notes (user_id, item_id, note)
             values (auth.uid(), ${itemId}, ${note})
             on conflict (user_id, item_id) do update set note = excluded.note`;
    return null;
  },
};
