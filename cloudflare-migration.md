# Moving the backend from Supabase to Cloudflare

**Status: deferred.** Nothing here has been started. This is the plan for when
it is picked up, written from a read of the whole repository in September 2026
and from Cloudflare's documentation as it stood then. Re-check the Cloudflare
facts in [What to verify first](#what-to-verify-first) before relying on them.

The short version: move the media first, then put a Worker in front of the
existing database, then move sign-in, and only then move the database itself.
Every step ships on its own and can be rolled back. Keeping Postgres (option B
below) is roughly half the work of rewriting for D1 (option A) and keeps the
database as the second layer of defence that CLAUDE.md relies on.

---

## What Supabase does today

Cloudflare already serves the web app: `client/wrangler.jsonc` publishes
`client/dist` as static assets with no Worker script. Everything dynamic is
Supabase.

| Supabase piece | What it carries here | Where |
|---|---|---|
| Postgres | 17 tables, 8 views, 25 functions (13 plpgsql, 16 `security definer`), 8 triggers — including `next_items()` (~390 lines, 25 CTEs), `grade_attempt`, `schedule_review`, `adjust_level`, `level_evidence`, `refresh_item_stats`, `reset_my_progress`, `veto_item` | `supabase/migrations/`, readable in `supabase/current.sql` |
| Row-level security | 24 policies in `public`, every one requiring `is_tester()`; the column grant on `attempts`; the testers-only door | same |
| Auth (GoTrue) | email + password; three triggers on `auth.users` (`refuse_unlisted_signup`, `handle_new_user`, `sync_profile_identity`); `auth.uid()` / `auth.jwt()` in 17 lines of SQL; 9 foreign keys to `auth.users(id)` | `supabase/migrations/20260913000200_users.sql`, `20260921000100_no_new_accounts.sql` |
| PostgREST | the client's `.from()` / `.rpc()` calls — 35 table/view calls, 6 RPCs, 9 auth calls, 2 storage URL builders (52 in all) | `client/src/lib/db.ts`, `client/src/lib/auth.tsx` |
| Storage | two public buckets, `audio` (5 MiB, audio types) and `scenes` (2 MiB, images, plus the `rejected/` ledger of refused picture drafts) | `20260915000300_media_storage.sql`, `bjt/scene_art.py` (`Bucket`), `bjt/tts/synth.py` |
| Service role | `bjt synth --upload` / `bjt scenes --upload`, `deploy-db.yml` (`supabase db push`, `psql` of every bundle and audio SQL), `nightly.yml` (`refresh_item_stats()`, scene SQL) | `.github/workflows/`, `bjt/cli.py` |

Two things make the database easy to move and one makes it hard:

- **Media paths are relative.** The database stores `"{provider}/{id[:2]}/{id}.wav"`
  and `"{scene_id}{suffix}"`; URLs are built in exactly two client functions
  (`clipUrl`, `sceneUrl`). No Supabase URL is stored in any data.
- **The SQL test suite is a specification.** `supabase/test/run.sh` runs 298
  assertions plus the client contract check against a throwaway Postgres, and
  its `00_stub.sql` already defines `auth.uid()` / `auth.jwt()` from
  `request.jwt.claims` — the same shim a non-Supabase Postgres needs.
- **Thirteen client calls rely on RLS alone to see only the caller's rows.**
  Ported to anything without RLS, they would read or change other people's
  data. Reads: `fetchProfile`, `fetchTypeStats`, `fetchTagStats`,
  `fetchRoleTraps`, `fetchReviewLoad`, `hasAdFree`, `fetchHistory`,
  `fetchVocab`, `fetchWordList`, `fetchNotes`. Writes: `finishSession` (update
  by id), `reportItem` (the update after a duplicate), `saveNote` (the delete).
  RLS also hides unpublished items, so `next_items()`'s accuracy terms and the
  `v_my_type_stats` / `v_my_tag_stats` views silently ignore withdrawn and
  vetoed questions — a port must write that filter out explicitly.

---

## The two targets

| | **A. Cloudflare only** | **B. Cloudflare in front, Postgres kept** |
|---|---|---|
| Stack | Worker API (e.g. Hono) + **D1** (SQLite) + R2 + auth on Workers | Worker API + **Hyperdrive** + **PlanetScale Postgres created from the Cloudflare dashboard** (billed on the Cloudflare invoice since June 2026) + R2 + auth on Workers |
| Queue logic | Rewritten in TypeScript + SQLite: no plpgsql, no RLS, no `security definer`, no `distinct on`, no LATERAL, no arrays | The 28 migrations and 25 functions run as they are |
| Security model | One data-access layer where every query binds `user_id = ?`; one middleware that refuses non-testers; the database no longer backs it up | RLS unchanged: each request is one transaction that sets the caller's claims (below), so the database still refuses what it refuses today |
| Tests | The 298 SQL assertions re-homed as Worker + D1 tests | `run.sh` unchanged; add route tests |
| Estimate | **34–50 engineer-days** | **19–27 engineer-days** |

**Recommendation: B.** Everything is still paid through Cloudflare, the
invariants in CLAUDE.md keep being enforced where they are enforced today, and
the first three phases below are the same for both options, so the choice can
wait until phase 4.

How B keeps RLS without Supabase: the Worker connects as a role that is a
member of `authenticated` but does not bypass RLS, and wraps each request in

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', $1, true);  -- {"sub": "<uuid>", "email": "…", "is_anonymous": false}
select * from public.next_items($2);                  -- or the insert, view or RPC the route serves
commit;
```

Hyperdrive pools connections in transaction mode and supports `SET` for the
duration of a transaction, so the claims never leak to the next request.

---

## Phase 0 — before any move

1. **Land the schema security fixes first** (the review of September 2026:
   writable `v_item_difficulty`, column grants on `profiles`, the daily ceiling
   in `grade_attempt`, `is_published` in grading). They would otherwise be
   carried into the new home.
2. **Export the state that exists only in the live database.** Rebuilding from
   `batches/*.sql` would lose it:
   - **In-app vetoes.** `veto_item()` sets `is_published = false`; `bjt publish`
     only writes that for items in `batches/withdrawn.txt`. Add every row of
     `item_vetoes` to `withdrawn.txt` (reason from the closed set) and publish,
     so the repository carries them.
   - **Audio pointers.** `audio_clips.audio_path` / `duration_ms` come from
     `*.audio.sql` generated on the runner and never committed.
   - **Testers** (with `unlimited`, `may_veto`, `max_daily_goal`) and **all user
     history** (`attempts` with their ids — the code tie-breaks on them —
     `review_schedule`, `section_levels`, `profiles`, `review_notes`,
     `item_feedback`, `practice_sessions`, `entitlements`).
   - **Auth users**, keeping their UUIDs (9 foreign keys) and bcrypt hashes.
3. **Rehearse a restore.** Take a `pg_dump` of the live project, restore it
   into a scratch Postgres, and run `supabase/test/run.sh`-style checks against
   it. Do not run anything against the live database while doing this.

## Phase 1 — media to R2 (2–3 days, reversible by one variable)

1. Create two R2 buckets (or one with `audio/` and `scenes/` prefixes) and
   expose them as a **public bucket on a custom domain**. `r2.dev` URLs are
   rate-limited and for development only; caching, WAF and Access only work on
   a custom domain. Presigned URLs do not work with custom domains — not needed
   here, the buckets are public by design.
2. Copy both Supabase buckets including `scenes/rejected/`, keeping every path.
3. Client: add `EXPO_PUBLIC_MEDIA_BASE`; `clipUrl` / `sceneUrl` build
   `${MEDIA_BASE}/audio/${path}` when it is set and fall back to
   `supabase.storage…getPublicUrl` when it is not. Rolling back is unsetting it.
4. Pipeline: give `bjt/scene_art.Bucket` an R2 backend (S3 API, or a Worker
   endpoint) and upload to **both** stores for a while. Keep the "a live clip
   is never re-made" rule: upload without overwrite unless named in `--remake`.
5. Move the `rejected/` ledger reads to R2 once both stores agree.

## Phase 2 — a Worker API over the existing Postgres (3–4 days)

1. Add `main` to `client/wrangler.jsonc` beside `assets`, so one Worker serves
   the app and `/api/*` on the same origin (no CORS). Check the config key that
   makes the Worker see `/api/*` before the static assets.
2. One endpoint per call site above (about 25). Each is a thin transaction:
   set the claims, run the same SQL the client runs today, return the same JSON
   shape (`QueuedItem` etc. in `client/src/lib/types.ts`).
3. Point Hyperdrive at the **current** Supabase Postgres. The Worker verifies
   the Supabase access token and passes its claims through — auth does not
   move yet.
4. **Turn Hyperdrive query caching off** for this configuration (or use a
   second, uncached configuration for every per-user read). The cache keys on
   query text; per-user results depend on the claims set in the transaction,
   which are not in the text, so a cached result could be served to another
   user.
5. Client: `db.ts` moves from supabase-js to `fetch`; `auth.tsx` stays on
   supabase-js. `errorText` / `friendlyError` (`client/src/lib/errors.ts`) must
   learn the Worker's error shape; keep Postgres error codes and hints
   (`daily_limit_reached`, `item_unavailable`) in the JSON so the client's
   handling is unchanged.
6. Local development: Hyperdrive is not available under `wrangler dev`; connect
   the Worker straight to the throwaway Postgres that `run.sh` starts.

## Phase 3 — sign-in on Cloudflare (4–6 days)

- **While the app is testers-only**, Cloudflare Access on the Worker (one-click
  for `workers.dev` and custom domains; policy by email list) fits the door:
  the Worker reads the email with `ctx.access.getIdentity()`, maps it to the
  existing user UUID, and mints the same claims (`sub`, `email`,
  `is_anonymous = false`). `is_tester()` and every policy stay as they are, so
  the database remains the door. Validate the Access JWT
  (`Cf-Access-Jwt-Assertion`) rather than trusting a header.
- **Access is a stopgap, not the final auth**: it gives an email only, suits a
  browser rather than the future native apps, and cannot do the anonymous-first
  launch `blockers.md` describes. For that, run an auth library on Workers
  (e.g. Better Auth on the same database) — import the users with their UUIDs
  and bcrypt hashes (or force a reset, which needs an email path), and move the
  three `auth.users` triggers onto the new users table. `refuse_unlisted_signup`
  must apply to every sign-up path, not only one connection.
- Force a re-login when switching.

## Phase 4 — the database

**B (recommended, 3–5 days):** create PlanetScale Postgres from the Cloudflare
dashboard (Hyperdrive → Create a PlanetScale database), then:

1. Apply `supabase/test/00_stub.sql`'s `auth` shim (the functions and roles —
   not its fixtures) and the migrations, minus the `storage.buckets` statements.
2. Replace `supabase db push` in `deploy-db.yml` with a small `psql` migration
   runner that records applied files (today `supabase_migrations.schema_migrations`).
3. Freeze writes (the testers can be told), `pg_dump` / restore data including
   users and hashes, repoint Hyperdrive, unfreeze.
4. Keep `run.sh`, `snapshot.py`, `current.sql` and the contract check as they
   are.

**A (only if D1 is a hard requirement, 22–32 days):** write the D1 schema;
port `next_items`, grading, the ladder, levels, the 8 views and the RPCs to
TypeScript + SQLite; re-home the SQL assertions as Worker tests; run the old
and new `next_items` side by side on real data until they pick the same
questions; then freeze, transform (timestamps to epoch ms, vetoes,
`audio_path`, testers, attempts with their ids), import and switch.
Traps found so far:

- SQLite's `random()` is a 64-bit integer. `random() / 50` in the tie-break
  would swamp the ranking and break "the tie-break is a fiftieth of a point".
  Pass a seeded float from the Worker instead (which also makes it testable).
- `::numeric` division becomes integer division.
- No row locks: grading, the ladder and the level move must be one atomic
  `batch()`; the daily ceiling must be counted inside it.
- Japan has no daylight saving time, so a JST day is `date(ts, '+9 hours')`
  exactly; store timestamps as integer epoch milliseconds.
- On the Workers Free plan, D1 queries fail once the account passes the daily
  row read/write limits (enforced since 1 September 2026).
- The D1 binding reaches every row: one Worker bug is a data leak, with no RLS
  behind it.

---

## What to verify first

These were read from Cloudflare's documentation in September 2026 or inferred,
not tested:

- Hyperdrive: transaction-mode pooling with `SET LOCAL` inside `BEGIN`/`COMMIT`
  as documented; that caching can be disabled per configuration; latency from
  the Worker's placement to the database region (set `placement` near it).
- PlanetScale Postgres: the Postgres version and whether every extension and
  feature the migrations use is available (no extensions are used today).
- Workers Access: `ctx.access.getIdentity()` fields, and local testing with the
  `access.dev` block in `wrangler.jsonc`.
- D1 (option A only): `batch()` atomicity, whether explicit `BEGIN`/`COMMIT` is
  rejected, math functions, deferred foreign keys, statement limits, and the
  SQLite version (`FILTER`, `RETURNING`, `MATERIALIZED`).
- Workers CPU limits for bcrypt if auth runs on Workers.

## Invariants the move must keep

Every one of these is in CLAUDE.md and is enforced in the database today; each
phase above must leave it enforced somewhere a client cannot reach:

- testers only, and no new accounts for unlisted addresses;
- the database grades answers; a client inserts only the eight attempt columns;
- `attempts` is never updated or deleted, except by `reset_my_progress()`;
- `item_stats` is not readable by a client (`v_item_difficulty`, floor of
  eight, is the only surface);
- `next_items()` is fixed SQL sorting one shared bank;
- the daily ceiling, `my_daily_max()`, and the JST day;
- `veto_item()` re-checks `may_i_veto()`;
- nothing ever sets `is_published` back to true.
