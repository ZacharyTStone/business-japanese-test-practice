# The study app

Expo (React Native) — one codebase for iOS, Android and web. Web ships first, so
the thing can be put in front of people before anyone waits on a store review.

```bash
cd client
npm install
cp .env.example .env        # fill in your Supabase URL and anon key
npm run web                 # or: npm run ios / npm run android
npm run typecheck
```

Without a `.env` the app still starts and tells you what is missing rather than
crashing, so a fresh clone is never a puzzle.

## Anonymous first

The app signs in anonymously before it shows anything. There is no sign-up
screen, no "continue as guest", no local-storage-then-migrate dance — from the
first question there is a real row in the database, and history, streak and
weakness profile are server-side.

Linking Google later attaches an identity to the **same user id**, so nothing is
copied or merged. That is the whole reason for doing it in this order: the
alternative — keep progress locally, reconcile on sign-in — means writing and
testing a merge path that is hard to get right and impossible to verify after the
fact when it goes wrong.

The honest cost is stated on the account screen: until it is linked, the session
token in this app's storage is the only key to that person's history. Delete the
app and it is gone. The app says so plainly rather than discovering it for them.

## The app does not grade answers

`recordAttempt` sends which option was touched. That is all. The database's
insert trigger fills in who it was, whether it was right, and **which distractor
role** caught them, and returns the graded row.

The item already carries `correct_index`, so grading locally would save a round
trip and feel snappier. It is not worth it: two sources of truth for "was that
right" eventually disagree, and the one that matters is the one the weakness
profile is computed from. (There is a local fallback in `practice.tsx` purely so
a failed request still shows the answer — it displays, it never writes.)

## Where an ad may go

`AdSlot`'s placement type has exactly two members: `session_result` and
`list_screen`. Putting an ad on the practice screen is a type error, not a
judgement call somebody makes later under deadline.

An ad between the narration and the options would not merely annoy — it would
make the question harder in a way the real exam never does. Nothing renders yet;
no ad SDK is wired up, and the free tier is meant to be genuinely complete.

## No score

The result screen shows a count and the trap that caught them most. It does not
estimate an exam score, because there is no IRT calibration for generated items
and an invented number is worse than none — people plan around it. The account
screen says why, in the app, rather than only here.

## Audio

Items are published before their audio exists, so every audio control has a
shape for `path === null`: it shows the text and says the recording is not ready.
A listening item with no audio is still a usable reading item. When clips arrive,
`audio_path` fills in and the same components start playing them — no screen
changes.

Paths ride along with the practice queue (`next_items` returns them inline), so
a set of five is one request rather than twenty-six.

## Layout

```
app/                expo-router screens
  _layout.tsx       providers + stack
  index.tsx         home — today's set, streak, the weakness nudge
  practice.tsx      the session: question, answer, why, 解説
  result.tsx        count + the trap that caught you most
  progress.tsx      the nine-type radar, traps, weak tags
  account.tsx       link Google, target level, the honest notes
src/lib/
  supabase.ts       the client (anon key is public by design — RLS is the guard)
  auth.tsx          anonymous bootstrap, Google linking, token refresh on resume
  db.ts             every query the app makes, in one file
  roles.ts          distractor role → Japanese label + 失礼度メーター values
  types.ts          the shapes the database returns
  session.ts        the practice → result handoff
src/ui/             theme, shared components, the meter, the radar
```

## Checks

`npm run typecheck` proves the code compiles against the types we *claim* the
database has. It cannot prove that claim is true — for that,
`supabase/test/run.sh` at the repo root reads every query in `src/lib` and
asserts each table, view, column and function it names actually exists.

## Deploying the web build to Cloudflare

The app is a static export: `expo export -p web` renders one HTML file per
route into `dist/`, and everything else is Supabase's job. Nothing runs at the
edge, which is why `wrangler.jsonc` has an `assets` block and no `main`.

Cloudflare's current flow is **Workers**, not the legacy Pages one. Dashboard →
**Workers & Pages → Create → Import a repository**, pick this repo, then:

| Setting | Value |
|---|---|
| Worker name | `business-japanese-drill` — must match `name` in `wrangler.jsonc`, or the build fails |
| Root directory | `client` *(under Advanced settings)* |
| Build command | `npm run build:web` |
| Deploy command | `npx wrangler deploy` *(the default)* |

Build-time environment variables: `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `NODE_VERSION=22`. The first two are baked
into the bundle — that is what `EXPO_PUBLIC_` means, and it is safe, because the
anon key only reaches what an anonymous visitor is allowed to reach. **The
service_role key must never be set here.**

`build:web` is `expo export` plus one copy: Expo writes the not-found page as
`+not-found.html`, and `not_found_handling: "404-page"` looks for `404.html`.
Without the copy a bad URL falls through to Cloudflare's own error page.

No rewrite rules are needed — `html_handling` serves `/practice` from
`practice.html`. `public/_redirects` and `public/_headers` are copied to the
output root by Expo; the headers cache the content-hashed bundle forever while
keeping the HTML revalidating, so a deploy is never stuck behind a stale page.

To check the config without deploying: `cd client && npx wrangler deploy --dry-run`.
