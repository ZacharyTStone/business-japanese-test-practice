# Moving the app to Cloudflare

**Status (October 2026): the code for steps 1–3 is written; turning it on is
the checklist below.** The app has one user, so this is a single cutover. Nobody
needs a freeze notice, there is no period of running the old and new paths
side by side, and the sign-in is Cloudflare Access rather than an auth service.
The database stays Postgres. Today that is still the Supabase project, which
the Worker reaches through Hyperdrive; moving it is a later, optional step (4)
that needs no code change.

| Piece | Before | Now |
|---|---|---|
| Web app | Worker, static assets | same Worker |
| Queries | supabase-js → PostgREST | `/api/q/<name>` on the Worker → Hyperdrive → Postgres, as `authenticated` with the caller's claims (`client/worker/`) |
| Sign-in | Supabase Auth, email + password | Cloudflare Access on the Worker; `ACCESS_USERS` maps the email to the existing user id |
| Audio and pictures | Supabase Storage, public buckets | R2 behind `/media/…`, read through from Supabase Storage on a miss |
| Database | Supabase Postgres | unchanged (step 4 moves it) |
| Pipeline uploads (`bjt synth`, `bjt scenes`) | Supabase Storage | unchanged (step 5 moves them) |

Row-level security, the column grants, the grading trigger, the daily ceiling
and every other rule in `CLAUDE.md` are enforced exactly where they were, by the
database: the Worker connects as `bjt_worker`, a role that can do nothing until
it becomes `authenticated` for one transaction with the caller's claims
(`supabase/worker_role.sql`, `client/worker/db.ts`). `supabase/test/run.sh`
runs every Worker query as a tester against the schema, and CI runs it too.

---

## Turning it on

Do these in order. Nothing changes for the live app until the merge in step 8.
Steps 1–7 can be done any time before it, and none of them touches the app's
data.

1. **The Worker's database role.** In the Supabase SQL editor, paste and run
   `supabase/worker_role.sql`. Then give the role a password, generated on
   your machine (`openssl rand -base64 32`), never written to a file:

   ```sql
   alter role bjt_worker password '<the generated password>';
   ```

   If the `grant authenticated to bjt_worker` line is refused, Supabase has not
   given the owner that right. In that case stop here and say so rather than
   granting anything wider.

2. **Your user id**, for step 5. In the same SQL editor, run:

   ```sql
   select id from auth.users where email = '<your address>';
   ```

3. **Hyperdrive**, with caching **off**. Use Supabase's *direct* connection
   string (Project → Connect), with the user and password from step 1:

   ```bash
   cd client
   npx wrangler hyperdrive create business-japanese-drill-db \
     --connection-string="postgres://bjt_worker:<password>@db.<ref>.supabase.co:5432/postgres" \
     --caching-disabled
   ```

   If the direct host does not resolve from Cloudflare (it is IPv6-only on
   some plans), use the *session pooler* string on port 5432 instead. Its user
   is `bjt_worker.<ref>`. Put the id it prints into `client/wrangler.jsonc` in
   place of the zeros. The id is not a secret, so pasting it to Claude is fine.

4. **The media bucket:**

   ```bash
   npx wrangler r2 bucket create business-japanese-drill-media
   ```

   It stays private. The Worker is the only way in.

5. **The Worker's two secrets:**

   ```bash
   npx wrangler secret put ACCESS_USERS   # {"<your address>": "<the id from step 2>"}
   npx wrangler secret put SUPABASE_URL   # https://<ref>.supabase.co
   ```

6. **Cloudflare Access.** Turn on Zero Trust for the account if it is not on
   already. Then go to **Workers & Pages → business-japanese-test-practice →
   Access → Protect this Worker behind Access → All traffic**, with a policy
   that allows your email address and nothing else.

7. **Keep the old build variables for now.** `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` are no longer read by the app, but leaving
   them in the build settings keeps a revert working. Delete them once the new
   path has run for a week.

8. **Merge the pull request.** The Cloudflare build deploys it.

9. **Check it on the deployed URL:**
   - A fresh private window gets Cloudflare's sign-in page and nothing of the
     app.
   - After signing in, home shows your levels and today's count as before, and
     a set plays its audio and shows its pictures.
   - An answer is graded, and is still there after a refresh.
   - Signing out from the account screen ends the session.

**To roll back**, revert the merge commit. The old app comes back as it was.
Nothing about the database changed except that a new role exists.

---

## After that

**5. The pipeline writes to R2.** `bjt synth --upload` and `bjt scenes
--upload` still upload to Supabase Storage, and the Worker copies each object
into R2 the first time it is asked for. To finish the move:
- give the pipeline an R2 backend (R2's S3 API, with an access key held as a
  GitHub secret), keeping "never upload over a live clip" (`--have`,
  `--remake`);
- copy what R2 has not seen yet, including `scenes/rejected/`;
- then unset `SUPABASE_URL` on the Worker, and media misses become plain 404s.

**4. The database to PlanetScale Postgres (optional, and it costs money).**
You can create it from the Cloudflare dashboard (Hyperdrive → Create a
PlanetScale database), and it is billed on the Cloudflare invoice. Then:
1. Apply `supabase/test/00_stub.sql`'s `auth` shim (the schema, functions and
   roles, not its fixtures), then the migrations, minus the `storage.*`
   statements. Then run `supabase/worker_role.sql`.
2. Replace `supabase db push` in `deploy-db.yml` with a small `psql` runner that
   records the files it has applied, and point `SUPABASE_DB_URL` (the
   workflows' secret) at the new database.
3. `pg_dump` / restore the data, including `auth.users` (the ids are what every
   answer hangs on). Then repoint Hyperdrive with
   `wrangler hyperdrive update`. The Worker does not change.

**D1 instead of Postgres** only if it ever becomes a hard requirement. It
means porting `next_items()`, grading, the ladder, the levels, the views and
the RPCs to TypeScript and SQLite, with no row-level security behind the
Worker. Traps found so far:
- SQLite's `random()` is an integer, which would swamp the tie-break.
- `::numeric` division becomes integer division.
- There are no row locks, so the daily ceiling must be counted inside one
  `batch()`.
- Store timestamps as epoch milliseconds. A JST day is exactly
  `date(ts, '+9 hours')`, because Japan has no daylight saving time.

---

## Checked against Cloudflare's documentation (1 October 2026)

- Hyperdrive pools in transaction mode, and `SET` inside `BEGIN … COMMIT`
  holds for that transaction only (the connection is `RESET` when it returns
  to the pool).
- Caching can be turned off per configuration (`--caching-disabled`). Queries
  containing `STABLE` or `VOLATILE` functions are never cached anyway.
- `assets.run_worker_first` takes route patterns (`["/api/*", "/media/*"]`).
- Worker-level Access protects every hostname of the Worker.
  `ctx.access.getIdentity()` gives the email with no manual JWT check, and
  `wrangler dev` can fake an identity with an `access.dev` block.
- PlanetScale Postgres can be created from Cloudflare and billed there.

Not yet tried for real: whether Supabase lets its owner role grant
`authenticated` to a new role (step 1), and which Supabase connection string
Hyperdrive reaches on this project's plan (step 3).

## Invariants the move keeps

Each is in `CLAUDE.md` and is enforced by the database, behind the Worker:

- testers only, and no new accounts for unlisted addresses;
- the database grades answers, and a client inserts only the eight attempt
  columns;
- `attempts` is never updated or deleted, except by `reset_my_progress()`;
- `item_stats` is not readable by a client;
- `next_items()` is fixed SQL sorting one shared bank;
- the daily ceiling, `my_daily_max()`, and the JST day;
- `veto_item()` re-checks `may_i_veto()`;
- nothing ever sets `is_published` back to true.
