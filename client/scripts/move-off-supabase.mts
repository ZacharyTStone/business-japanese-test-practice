/**
 * The one-off move from Supabase to Cloudflare: the learners' records into
 * D1, the clips and pictures into R2. Run by the "move off supabase" workflow
 * (.github/workflows/move-off-supabase.yml), by hand, once; delete this file,
 * the workflow and the `postgres` dev dependency after it has run.
 *
 *   node --experimental-strip-types scripts/move-off-supabase.ts sql <out.sql> <known-items.json>
 *       Reads the old database (SUPABASE_DB_URL) inside a READ ONLY
 *       transaction and writes one SQL file for `wrangler d1 execute --remote
 *       --file`, which D1 runs all or nothing. <known-items.json> is the D1
 *       side's `select id from items`, so a row about a question the new bank
 *       does not have is reported rather than failing the whole file.
 *
 *   node --experimental-strip-types scripts/move-off-supabase.ts media
 *       Copies every object of the `audio` and `scenes` storage buckets
 *       (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) to R2 under `audio/…` and
 *       `scenes/…` (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *       R2_BUCKET). Never over an object R2 already has.
 *
 * Both are safe to run again: every row is an upsert or an insert that skips
 * what is there, and an object already in R2 is left alone.
 *
 * What moves, and what does not:
 *   - accounts with an email address, and everything of theirs: profile,
 *     sessions, answers (with their ids, so ties still break the same way),
 *     the spacing ladder, notes, section levels, entitlements, reports,
 *     vetoes. An anonymous account has no address for Access to sign in with,
 *     so it cannot be anybody's any more and stays behind.
 *   - the tester list, the bank's own difficulty counts, which questions were
 *     vetoed in the app (unpublished here too; nothing is ever re-published),
 *     and where every clip and picture is.
 *   - the bank itself does not move: it is the committed batches/*.sql, which
 *     the deploy has already applied.
 *
 * Timestamps are written as D1 keeps them: UTC, ISO 8601, to the millisecond.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ----- the SQL -------------------------------------------------------------

export type Row = Record<string, unknown>;

/** What is read from the old database, table by table. */
export type Export = {
  users: Row[];
  testers: Row[];
  profiles: Row[];
  practice_sessions: Row[];
  attempts: Row[];
  review_schedule: Row[];
  review_notes: Row[];
  section_levels: Row[];
  entitlements: Row[];
  item_feedback: Row[];
  item_vetoes: Row[];
  item_stats: Row[];
  audio_clips: Row[];
  scenes: Row[];
  unpublished: Row[];
};

/** A SQL literal for D1: text quoted, booleans 1/0, null, finite numbers. */
export function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`not a number SQL can store: ${v}`);
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s.includes("\0")) throw new Error("a NUL cannot be stored in a text value");
  return `'${s.replace(/'/g, "''")}'`;
}

/** A timestamp as D1 keeps them, or null. */
export function ts(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${String(v)}`);
  return d.toISOString();
}

/** A calendar date (exam_date), as YYYY-MM-DD. */
function day(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`not a date: ${s}`);
  return s.slice(0, 10);
}

const lower = (v: unknown) => (v === null || v === undefined ? null : String(v).toLowerCase());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function insert(table: string, row: Record<string, unknown>, conflict: string): string {
  const cols = Object.keys(row);
  return `insert into ${table} (${cols.join(", ")}) values (${cols.map((c) => lit(row[c])).join(", ")}) ${conflict};`;
}

const upsert = (keys: string[], cols: string[]) =>
  `on conflict (${keys.join(", ")}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`;

/** The triggers on `attempts` that judge a NEW answer: whether the question
 *  is live, whether the grade is the item's, whether the day is full. An
 *  answer from the old database is history — some to questions vetoed since,
 *  some graded against a question corrected since, some given today — so they
 *  are lifted for the import and put back, word for word, from the
 *  migration, in the same all-or-nothing file. */
export function attemptTriggers(migrationsSql: string): { name: string; sql: string }[] {
  const out: { name: string; sql: string }[] = [];
  const re = /^create trigger (?:if not exists )?(attempts_\w+)\s*\nbefore insert on attempts[\s\S]*?^end;/gm;
  for (const m of migrationsSql.matchAll(re)) out.push({ name: m[1], sql: m[0] });
  return out;
}

export type Built = { sql: string; counts: Record<string, number>; skipped: Record<string, number> };

export function buildMoveSql(x: Export, knownItems: Set<string>, migrationsSql: string): Built {
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const emit = (table: string, sql: string) => {
    lines.push(sql);
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const skip = (table: string) => {
    skipped[table] = (skipped[table] ?? 0) + 1;
  };

  const users = new Map<string, string>();
  for (const u of x.users) {
    const email = lower(u.email);
    if (!email) continue;
    users.set(String(u.id).toLowerCase(), email);
  }
  const hasUser = (r: Row) => users.has(String(r.user_id).toLowerCase());
  const hasItem = (id: unknown) => id === null || id === undefined || knownItems.has(String(id));
  const sessions = new Set(x.practice_sessions.filter(hasUser).map((s) => String(s.id).toLowerCase()));

  lines.push(
    "-- Moved from Supabase by client/scripts/move-off-supabase.ts. One file, all or nothing.",
    "-- Safe to apply again: every statement is an upsert or skips what is there.",
    ""
  );

  const triggers = attemptTriggers(migrationsSql);
  if (triggers.length < 2) throw new Error("the migration's attempts triggers were not found");
  for (const t of triggers) lines.push(`drop trigger if exists ${t.name};`);

  // An account made by signing in to the new app before the move has a new
  // id for an old address; the old id, which every answer points at, wins.
  for (const [id, email] of users) {
    lines.push(`delete from users where email = ${lit(email)} and id <> ${lit(id)};`);
    const u = x.users.find((r) => String(r.id).toLowerCase() === id)!;
    emit("users", insert("users", { id, email, created_at: ts(u.created_at) }, "on conflict (id) do update set email = excluded.email"));
  }

  for (const t of x.testers) {
    emit(
      "testers",
      insert(
        "testers",
        {
          email: lower(t.email),
          note: t.note ?? "",
          added_at: ts(t.added_at),
          unlimited: Boolean(t.unlimited),
          may_veto: Boolean(t.may_veto),
          max_daily_goal: num(t.max_daily_goal),
        },
        upsert(["email"], ["note", "unlimited", "may_veto", "max_daily_goal"])
      )
    );
  }

  for (const p of x.profiles) {
    if (!users.has(String(p.id).toLowerCase())) {
      skip("profiles");
      continue;
    }
    const row = {
      id: String(p.id).toLowerCase(),
      display_name: p.display_name ?? null,
      target_level: p.target_level,
      daily_goal: num(p.daily_goal),
      exam_date: day(p.exam_date),
      timed_reading: Boolean(p.timed_reading),
      level_changed_at: ts(p.level_changed_at),
      created_at: ts(p.created_at),
      updated_at: ts(p.updated_at),
    };
    emit("profiles", insert("profiles", row, upsert(["id"], Object.keys(row).filter((c) => c !== "id"))));
  }

  for (const s of x.practice_sessions) {
    if (!hasUser(s)) {
      skip("practice_sessions");
      continue;
    }
    emit(
      "practice_sessions",
      insert(
        "practice_sessions",
        { id: String(s.id).toLowerCase(), user_id: String(s.user_id).toLowerCase(), started_at: ts(s.started_at), finished_at: ts(s.finished_at) },
        upsert(["id"], ["finished_at"])
      )
    );
  }

  for (const a of x.attempts) {
    if (!hasUser(a) || !hasItem(a.item_id) || !hasItem(a.stands_for)) {
      skip("attempts");
      continue;
    }
    const session = a.session_id === null || a.session_id === undefined ? null : String(a.session_id).toLowerCase();
    emit(
      "attempts",
      insert(
        "attempts",
        {
          id: num(a.id),
          user_id: String(a.user_id).toLowerCase(),
          session_id: session !== null && sessions.has(session) ? session : null,
          item_id: a.item_id,
          chosen_index: num(a.chosen_index),
          is_correct: Boolean(a.is_correct),
          chosen_role: a.chosen_role ?? (num(a.chosen_index) === -1 ? "timed_out" : ""),
          elapsed_ms: num(a.elapsed_ms),
          answered_at: ts(a.answered_at),
          think_ms: num(a.think_ms),
          replays: num(a.replays) ?? 0,
          peeked: Boolean(a.peeked),
          stands_for: a.stands_for ?? null,
        },
        "on conflict (id) do nothing"
      )
    );
  }

  for (const r of x.review_schedule) {
    if (!hasUser(r) || !hasItem(r.item_id)) {
      skip("review_schedule");
      continue;
    }
    const row = {
      user_id: String(r.user_id).toLowerCase(),
      item_id: r.item_id,
      due_at: ts(r.due_at),
      step: num(r.step),
      last_at: ts(r.last_at),
      trap: r.trap ?? null,
      missed: Boolean(r.missed),
    };
    emit("review_schedule", insert("review_schedule", row, upsert(["user_id", "item_id"], ["due_at", "step", "last_at", "trap", "missed"])));
  }

  for (const n of x.review_notes) {
    if (!hasUser(n) || !hasItem(n.item_id)) {
      skip("review_notes");
      continue;
    }
    emit(
      "review_notes",
      insert(
        "review_notes",
        { user_id: String(n.user_id).toLowerCase(), item_id: n.item_id, note: n.note, added_at: ts(n.added_at) },
        upsert(["user_id", "item_id"], ["note"])
      )
    );
  }

  for (const l of x.section_levels) {
    if (!hasUser(l)) {
      skip("section_levels");
      continue;
    }
    emit(
      "section_levels",
      insert(
        "section_levels",
        { user_id: String(l.user_id).toLowerCase(), section: l.section, level: l.level, changed_at: ts(l.changed_at), moves: num(l.moves) ?? 0 },
        upsert(["user_id", "section"], ["level", "changed_at", "moves"])
      )
    );
  }

  for (const e of x.entitlements) {
    if (!hasUser(e)) {
      skip("entitlements");
      continue;
    }
    const row = {
      user_id: String(e.user_id).toLowerCase(),
      product: e.product,
      source: e.source,
      granted_at: ts(e.granted_at),
      external_id: e.external_id ?? null,
      revoked_at: ts(e.revoked_at),
      note: e.note ?? null,
    };
    emit("entitlements", insert("entitlements", row, upsert(["user_id", "product"], ["source", "granted_at", "external_id", "revoked_at", "note"])));
  }

  for (const f of x.item_feedback) {
    if (!hasUser(f) || !hasItem(f.item_id)) {
      skip("item_feedback");
      continue;
    }
    const row = {
      user_id: String(f.user_id).toLowerCase(),
      item_id: f.item_id,
      reason: f.reason,
      note: f.note ?? "",
      created_at: ts(f.created_at),
      updated_at: ts(f.updated_at),
    };
    emit("item_feedback", insert("item_feedback", row, upsert(["user_id", "item_id"], ["reason", "note", "updated_at"])));
  }

  for (const v of x.item_vetoes) {
    if (!hasUser(v) || !hasItem(v.item_id)) {
      skip("item_vetoes");
      continue;
    }
    emit(
      "item_vetoes",
      insert(
        "item_vetoes",
        { item_id: v.item_id, user_id: String(v.user_id).toLowerCase(), note: v.note ?? "", created_at: ts(v.created_at) },
        "on conflict (item_id) do nothing"
      )
    );
  }

  for (const s of x.item_stats) {
    if (!hasItem(s.item_id)) {
      skip("item_stats");
      continue;
    }
    const row = { item_id: s.item_id, answered: num(s.answered), correct: num(s.correct), p_correct: num(s.p_correct), updated_at: ts(s.updated_at) };
    emit("item_stats", insert("item_stats", row, upsert(["item_id"], ["answered", "correct", "p_correct", "updated_at"])));
  }

  // Where every clip is. Only a clip D1 has no file for yet: a live clip is
  // never pointed somewhere else.
  for (const c of x.audio_clips) {
    if (c.audio_path === null || c.audio_path === undefined) continue;
    emit(
      "audio_clips",
      `update audio_clips set audio_path = ${lit(c.audio_path)}, duration_ms = ${lit(num(c.duration_ms))} where id = ${lit(c.id)} and audio_path is null;`
    );
  }

  // Where every picture is. The old database can be ahead of the committed
  // scenes.sql — the nightly job points it at a picture before its pull
  // request is merged — so its path wins when it has one.
  for (const s of x.scenes) {
    emit(
      "scenes",
      insert(
        "scenes",
        { id: s.id, label_ja: s.label_ja, image_path: s.image_path ?? null, updated_at: ts(s.updated_at) },
        "on conflict (id) do update set image_path = coalesce(excluded.image_path, scenes.image_path), updated_at = excluded.updated_at"
      )
    );
  }

  // Questions vetoed in the app stay vetoed. Nothing is ever re-published.
  const gone = x.unpublished.map((r) => String(r.id)).filter((id) => knownItems.has(id));
  if (gone.length) {
    for (let i = 0; i < gone.length; i += 50) {
      emit("unpublished", `update items set is_published = 0 where id in (${gone.slice(i, i + 50).map(lit).join(", ")});`);
    }
  }

  lines.push("");
  for (const t of triggers) lines.push(t.sql);
  lines.push("");
  return { sql: lines.join("\n"), counts, skipped };
}

// ----- reading the old database --------------------------------------------

/** One select per table. Run inside a READ ONLY transaction: nothing here can
 *  change the old database, whatever a query says. */
export const EXPORT_QUERIES: Record<keyof Export, string> = {
  users: "select u.id, u.email, u.created_at from auth.users u where u.email is not null and u.email <> ''",
  testers: "select email, note, added_at, unlimited, may_veto, max_daily_goal from public.testers",
  profiles:
    "select id, display_name, target_level, daily_goal, exam_date::text as exam_date, timed_reading, level_changed_at, created_at, updated_at from public.profiles",
  practice_sessions: "select id, user_id, started_at, finished_at from public.practice_sessions",
  attempts:
    "select id, user_id, session_id, item_id, chosen_index, is_correct, chosen_role, elapsed_ms, answered_at, think_ms, replays, peeked, stands_for from public.attempts order by id",
  review_schedule: "select user_id, item_id, due_at, step, last_at, trap, missed from public.review_schedule",
  review_notes: "select user_id, item_id, note, added_at from public.review_notes",
  section_levels: "select user_id, section, level, changed_at, moves from public.section_levels",
  entitlements: "select user_id, product, source, granted_at, external_id, revoked_at, note from public.entitlements",
  item_feedback: "select user_id, item_id, reason, note, created_at, updated_at from public.item_feedback",
  item_vetoes: "select item_id, user_id, note, created_at from public.item_vetoes",
  item_stats: "select item_id, answered, correct, p_correct::float8 as p_correct, updated_at from public.item_stats",
  audio_clips: "select id, audio_path, duration_ms from public.audio_clips where audio_path is not null",
  scenes: "select id, label_ja, image_path, updated_at from public.scenes",
  unpublished: "select id from public.items where not is_published",
};

async function readOldDatabase(url: string): Promise<Export> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return (await sql.begin("read only", async (tx) => {
      const out: Partial<Export> = {};
      for (const [name, query] of Object.entries(EXPORT_QUERIES) as [keyof Export, string][]) {
        out[name] = [...(await tx.unsafe(query))] as Row[];
      }
      return out;
    })) as Export;
  } finally {
    await sql.end();
  }
}

// ----- the media -----------------------------------------------------------

const BUCKETS = ["audio", "scenes"];

async function listStorage(base: string, key: string, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`listing ${bucket}/${prefix}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { name: string; id: string | null }[];
    for (const e of page) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await listStorage(base, key, bucket, path)));
      else out.push(path);
    }
    if (page.length < 1000) return out;
  }
}

async function copyMedia(): Promise<void> {
  const { AwsClient } = await import("aws4fetch");
  const env = (name: string) => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  const base = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r2 = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
  const endpoint = `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${process.env.R2_BUCKET || "business-japanese-drill-media"}`;

  let copied = 0;
  let already = 0;
  const failed: string[] = [];
  for (const bucket of BUCKETS) {
    const paths = await listStorage(base, key, bucket);
    console.log(`${bucket}: ${paths.length} object(s) in Supabase Storage`);
    const queue = [...paths];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        try {
          const got = await fetch(`${base}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
            headers: { authorization: `Bearer ${key}`, apikey: key },
          });
          if (!got.ok) throw new Error(`download: HTTP ${got.status}`);
          const body = await got.arrayBuffer();
          const put = await r2.fetch(`${endpoint}/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
            method: "PUT",
            body,
            headers: { "content-type": got.headers.get("content-type") || "application/octet-stream", "if-none-match": "*" },
          });
          if (put.status === 412) already++;
          else if (!put.ok) throw new Error(`upload: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
          else copied++;
        } catch (e) {
          failed.push(`${bucket}/${path}: ${(e as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }
  console.log(`copied ${copied}, already in R2 ${already}, failed ${failed.length}`);
  for (const f of failed) console.error(`  FAILED ${f}`);
  if (failed.length) process.exitCode = 1;
}

// ----- the command ---------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const [mode, out, known] = argv;
  if (mode === "sql" && out && known) {
    const url = process.env.SUPABASE_DB_URL;
    if (!url) throw new Error("SUPABASE_DB_URL is not set");
    const here = dirname(fileURLToPath(import.meta.url));
    const migrations = readFileSync(resolve(here, "../../d1/migrations/0001_initial.sql"), "utf8");
    const knownItems = new Set((JSON.parse(readFileSync(known, "utf8")) as { id: string }[]).map((r) => r.id));
    const built = buildMoveSql(await readOldDatabase(url), knownItems, migrations);
    writeFileSync(out, built.sql);
    console.log(JSON.stringify({ rows: built.counts, skipped: built.skipped }, null, 2));
    return;
  }
  if (mode === "media") return copyMedia();
  throw new Error("usage: move-off-supabase.ts sql <out.sql> <known-items.json> | media");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
