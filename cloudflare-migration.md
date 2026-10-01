# Moving the app to Cloudflare

**Status (October 2026): all of it is code now; turning it on is the checklist
below.** Everything the app touches is on Cloudflare, and nothing is on
Supabase:

| Piece | Before | Now |
|---|---|---|
| Web app | Worker, static assets | same Worker |
| Sign-in | Supabase Auth, then Cloudflare Access + `ACCESS_USERS` | Cloudflare Access; the address is looked up in D1 (`users`, `testers`) |
| Queries | Worker → Hyperdrive → Supabase Postgres, row-level security | Worker → D1 (`client/worker/core/`), every query scoped to the caller |
| The thinking (`next_items`, grading, ladder, levels) | Postgres functions and triggers | TypeScript in `client/worker/core/`; the grade, a live question, an unchangeable answer and the day's ceiling are still enforced by triggers in D1 |
| Audio and pictures | Supabase Storage (R2 read-through) | R2 only |
| Pipeline uploads (`bjt synth`, `bjt scenes`) | Supabase Storage | R2, over its S3 API (`bjt/r2.py`) |
| SQL the pipeline writes (`bjt publish`, …) | Postgres | SQLite, applied with `wrangler d1 execute` |
| Workflows | `supabase db push`, `psql` | `wrangler d1 migrations apply`, `wrangler d1 execute` |

How it was checked: the TypeScript queue, grading, spacing ladder and levels
were replayed against the old Postgres functions over thousands of simulated
answers (every served set, every grade, every ladder rung and level, step by
step) with no difference; and the move itself was rehearsed from a copy of the
old schema into a local D1, after which every moved learner's next set was the
same on both. `npm run test:db` keeps the D1 side honest in CI.

---

## Turning it on

All in dashboards; no code on your side. The app is down between steps 6 and
8; nothing is lost if it stays down longer.

1. **Create the database.** Cloudflare dashboard → **Storage & databases → D1
   SQL database → Create**. Name: `business-japanese-drill`. Location: Asia-Pacific.
   Copy its **Database ID** and send it to Claude, who puts it in
   `client/wrangler.jsonc` on the pull request.
2. **A token for the workflows.** **My Profile → API Tokens → Create Token →
   Custom token**. Permission: *Account → D1 → Edit*. Account resources: your
   account. Copy the token.
3. **Keys for the media bucket.** **R2 → Manage API tokens → Create API token**.
   Permission: *Object Read & Write*, applied to the bucket
   `business-japanese-drill-media` only. Copy the **Access Key ID** and the
   **Secret Access Key** (shown once).
4. **Your account id.** On the dashboard's account home (or Workers & Pages
   overview), **Account ID**.
5. **GitHub secrets.** Repository → **Settings → Secrets and variables →
   Actions → New repository secret**, four times:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`. Keep `SUPABASE_DB_URL`, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` until step 8.
6. **Merge the pull request** once its checks are green. Cloudflare rebuilds
   the Worker with D1 bound; **deploy database** applies the schema and the
   committed bank to D1. It records no audio yet: no clip is live in D1 until
   the move, and it says so.
7. **Move your records and media.** Actions → **move off supabase** → Run
   workflow → type `move`. It reads Supabase (read only), writes your
   accounts, answers, levels, ladder, notes and settings into D1 in one
   all-or-nothing step, and copies every clip and picture into R2. Safe to run
   again.
8. **Check the app.** Open it, look at 記録 and the review list, answer a
   question. Then tidy up:
   - Cloudflare → Workers & Pages → the Worker → **Settings → Variables and
     Secrets**: delete `ACCESS_USERS` and `SUPABASE_URL`; under **Build**,
     delete `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   - Cloudflare → **Hyperdrive**: delete `business-japanese-drill-db`.
   - GitHub → delete the three `SUPABASE_*` secrets.
   - Ask Claude to remove the move workflow and script (one small pull
     request).
   - After a few days of it working: pause, then delete, the Supabase project.

If step 6's deploy fails, the old Worker keeps serving and nothing has
changed; the run's summary says why. If step 7 fails, D1 is left exactly as it
was before the run (a failed import is rolled back), and it can be run again.

---

## What stays the same

Every rule in `CLAUDE.md` — the database grades, an answer is history, fifteen
a day, the tester list is the door, the learner chooses nothing about the
questions — holds as before. What enforced them moved:

- **The grade** is computed inside the INSERT from the item, and a trigger
  refuses any other (`attempts_need_a_live_question`).
- **An answer is history**: a trigger refuses every update
  (`attempts_are_history`); the one removal is starting again.
- **The day's ceiling** is a trigger on the answer itself
  (`attempts_daily_ceiling`), as it was.
- **The door**: the Worker makes an account only for an address on the tester
  list, and refuses every query from one that is not (`core/caller.ts`).
- **One learner's rows**: every query filters on the caller's id, and
  `queries.db.test.ts` checks that another tester sees none of them.
