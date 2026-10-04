# The study app

Expo (React Native) — one codebase for iOS, Android and web. Web ships first:
the app talks to the database through the Cloudflare Worker it is served from
(`worker/`), and signs in with Google through the Worker's own sign-in
(`worker/auth.ts`, Better Auth on the same D1). Cloudflare Access still stands
in front of the site until it is switched off (blockers.md #4). Android builds
with EAS (`eas.json`) and signs in with Google's own account sheet
(Credential Manager, `modules/google-sign-in`), into the same Worker.

```bash
cd client
npm install
npm run typecheck           # the app and the Worker
npm test                    # the pure parts: the practice reducer, the clock, the roles, the Worker's
npm run test:db             # every Worker query and the schema's promises, on a local D1 with the bank
npm run lint                # the rules of hooks
npm run build:web && npx wrangler dev   # the app and its Worker on one origin, http://localhost:8787
```

`wrangler dev` runs against a local D1: fill it once with `npx wrangler d1
migrations apply business-japanese-drill --local` and each `../batches/*.sql`
(scenes.sql first) with `npx wrangler d1 execute business-japanese-drill
--local --file`, and add yourself with `node bjt/main.ts tester`. Without a
Worker to talk to (`npm run ios`, say) the app still starts and says what is
missing rather than crashing.

### Signing in locally

The sign-in needs four settings, kept out of the repository in
`client/.dev.vars` (gitignored; `wrangler dev` reads it):

```
BETTER_AUTH_URL=http://localhost:8787
BETTER_AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=<the Web OAuth client's id>
GOOGLE_CLIENT_SECRET=<its secret>
```

and `http://localhost:8787/api/auth/callback/google` among that client's
redirect URIs (Google Cloud Console → Credentials). Then "Continue with
Google" on the sign-in screen goes to Google and comes back signed in, as it
will on the deployed site once Access is off; "Sign out" ends the session and
comes back to the same screen. Open the app at exactly the address
`BETTER_AUTH_URL` names (`localhost`, not `127.0.0.1`): the sign-in's cookies
belong to one host. Without the file there is no sign-in at all, and every
query answers `sign_in_not_configured`.

## Android

`eas.json` has two profiles: `preview` builds an APK to install straight onto
a tester's phone, `production` the bundle Google Play takes. Each builds from
the EAS environment of the same name, and each needs two values there, as EAS
environment variables rather than files in the repository: the Worker's
address, and the Google **Web** client's id (public: it is in every Google
sign-in address; the same value as the Worker's `GOOGLE_CLIENT_ID`):

```bash
npx eas-cli init                                    # once: the project id goes into app.json
for env in preview production; do
  npx eas-cli env:create --environment $env --name EXPO_PUBLIC_API_BASE \
    --value https://<the Worker's host> --visibility plaintext
  npx eas-cli env:create --environment $env --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID \
    --value <the Web client's id> --visibility plaintext
done
npx eas-cli build -p android --profile preview      # an APK, linked when it is done
```

How a phone signs in, with no browser on the way:

1. "Continue with Google" opens Google's account sheet through Credential
   Manager (`modules/google-sign-in`, a small Expo module of our own: the free
   React Native libraries wrap Google's deprecated SDK). It answers with an ID
   token issued for the Web client, with a fresh nonce in it.
2. `src/lib/phoneSignIn.ts` posts both to the Worker's
   `/api/auth/sign-in/social`, which checks the token's signature, issuer,
   audience and nonce, and the tester list, exactly as for the web.
3. The Worker answers with a signed session token (`set-auth-token`), kept
   in the system's encrypted storage (`src/lib/phoneSession.ts`,
   expo-secure-store, excluded from backups) and sent as `Authorization:
   Bearer` with every query, clip and picture. A phone sends no cookies.
4. Signing out ends that session on the Worker, forgets the token, and
   forgets the chosen account, so the next sign-in asks which one.

For Google to hand the token to this app at all, Google Cloud needs an
**Android** OAuth client for the package `app.businessjapanesedrill` and the
SHA-1 of the key the APK is signed with (`npx eas-cli credentials -p
android`), and later a second for Play App Signing's key (Play Console → Test
and release → App integrity). It has no secret, and neither the app nor the
Worker uses its id: it only vouches for the app. blockers.md #4, step 3 has
the checklist. `modules/` is the app's only native code; `expo prebuild`
writes `android/`, which is not committed (EAS makes its own).

## Nothing to choose

There is no level picker, no section picker, no problem-type picker, no
difficulty and no mode. There is one button, and it starts the set the database
built out of this person's answers.

That is the product, not a stage of it. A picker beside a claim like "we work
out what you need next" is an invitation to overrule the one thing the app is
for, and what people overrule it with is whatever feels comfortable — which is
the opposite of what raises a score.

The cost of hiding all of it is that the app's intelligence becomes invisible.
That is what `src/ui/welcome.tsx` is for: shown once, on first launch, it says
the three true things (your answers set the level; the questions aim at how you
go wrong; your part is to answer) and then never appears again. It is also the
only introduction; the sign-in screen comes right after it.

## Testers only, for now

The app opens only to a signed-in user whose email is on the tester list
(`testers` in D1), and it is the Worker that decides: every query from an
address not on the list is refused before it runs, and no account is made for
it (`worker/core/caller.ts`). `src/ui/gate.tsx` is the screens that say so —
"Continue with Google", or "not open yet" with the account named — and
`src/lib/auth.tsx` asks `whoami`, the one query that answers. A Google
account the list does not name never becomes an account at all
(`worker/auth.ts`). Neither is what keeps anybody out; a client that skipped both would
be refused all the same.

## Privacy, and leaving

`/privacy` is the privacy policy, readable without signing in (the store
listing and Google's consent screen link to it), in both languages
(`src/lib/privacy.ts`). It says only what the code keeps, so a change to what
is kept changes it too. The operator's name and contact address are blank
until the owner fills them in (`PRIVACY_OPERATOR`, `PRIVACY_CONTACT`); the
page says "to be added" meanwhile.

"Delete account", at the bottom of the account screen, deletes the account
and everything about it in one all-or-nothing batch on the Worker
(`worker/core/profile.ts`), the Google sign-in with it, and signs out. The web
version has the same screen, which is the "web link" Google Play asks for.

## Anonymous first, when the app opens

The schema is shaped for a public app that signs everybody in before it shows
anything: no "continue as guest", no local-storage-then-migrate dance — from
the first question a real row in the database. While the app is in testing
the Worker makes an account only for a listed address. Opening the app means
deciding how a stranger signs in, and dropping the list from the door in
`worker/core/caller.ts`.

Linking Google then attaches an identity to the **same user id**, so nothing is
copied or merged. That is the whole reason for doing it in this order: the
alternative — keep progress locally, reconcile on sign-in — means writing and
testing a merge path that is hard to get right and impossible to verify after the
fact when it goes wrong. The cost is that until an identity is linked, the
session token in the app's storage is the only key to that person's history.

## The app does not grade answers

`recordAttempt` sends which option was touched, with the timing and replay
counts the spacing ladder reads — never whether it was right. The database's
insert trigger fills in who it was, whether it was right, and **which distractor
role** caught them, and returns the graded row.

The item already carries `correct_index`, so grading locally would save a round
trip and feel snappier. It is not worth it: two sources of truth for "was that
right" eventually disagree, and the one that matters is the one the weakness
profile is computed from. (When the request fails the card shows the phone's
own reading of the key, marked unsent, and the insert itself — never a grade —
waits in an outbox, `src/lib/outbox.ts`, until the database takes it.)

## Where an ad may go

`AdSlot`'s placement type has exactly two members: `session_result` and
`list_screen`. Putting an ad on the practice screen is a type error, not a
judgement call somebody makes later under deadline.

An ad between the narration and the options would not merely annoy — it would
make the question harder in a way the real exam never does. No ad SDK is wired
up (outside development the slot renders nothing), and the free tier is meant
to be genuinely complete.

## No score

The result screen shows a count and the trap that caught them most. It does not
estimate an exam score, because there is no IRT calibration for generated items
and an invented number is worse than none — people plan around it. The account
screen says why, in the app, rather than only here.

## Audio

Items are published before their audio exists, so every audio control has a
shape for `path === null`: it shows the text instead of a dead play button. A
listening item with no audio is still a usable reading item. When clips arrive,
`audio_path` fills in and the same components start playing them — no screen
changes.

Paths ride along with the practice queue (`next_items` returns them inline), so
a set is one request rather than one per clip.

## Layout

```
app/                expo-router screens
  _layout.tsx       providers, the welcome gate, the tester door, and the stack
  +html.tsx         the web page the app lives in
  (tabs)/           the three places the app lives, under a bottom bar
    _layout.tsx     the bar itself
    index.tsx       home — one button, today's ring, and the app's one sentence
    progress.tsx    three sections like the real score report, each with the level
                    being served in it; every type on a radar; recent traps and
                    weak tags
    account.tsx     the three levels (shown, not chosen), the exam date, the
                    reading clock, the language, starting again
  practice.tsx      the session, one moment at a time: scene, listen, answer, reveal
                    (its hooks and cards are in src/ui/practice/)
  result.tsx        count, the trap that caught you most, the level if it moved
  history.tsx       the latest answers, wrong ones by default, each with a note
  vocab.tsx         the words of the questions that caught you
  words.tsx         every word of every question answered, with an example
  privacy.tsx       the privacy policy: public, past the welcome screen and the door
src/lib/
  i18n.tsx          the words on the furniture, ja/en; questions stay Japanese
  api.ts            the one way to the database: a named query, sent to the Worker
  auth.tsx          who this is (asked of the Worker) and the tester check
  authClient.ts     signing in with Google, and out, from the web (worker/auth.ts)
  phoneSignIn.ts    signing in with Google, and out, on a phone (modules/google-sign-in)
  phoneSession.ts   a phone's session token: kept, and sent with queries, clips and pictures
  signin.ts         the plain half of both: refusals read, the bearer header
  privacy.ts        the privacy policy's text, ja/en, held to what the code keeps
  db.ts             every query the app makes, through one module (db/: practice,
                    record, profile, media; db/shape.ts the tested joins)
  outbox.ts         answers that could not be sent, kept until the database takes them
  answers.ts        the outbox wired to the database
  playlist.ts       what a question plays, in order (SPOKEN_OPTION_TYPES lives here)
  clock.ts          the reading clock's arithmetic
  day.ts            the day as Japan counts it, and the size of the next set
  labels.ts         names the screens share (option numbers, channels)
  errors.ts         what went wrong, in words a learner can act on
  practice.ts       the practice screen's state, as one pure reducer
  pace.ts           how long a reading question gets, and why
  levels.ts         the three section levels: order, names, and what moved
  roles.ts          distractor role → Japanese label + 失礼度メーター values
  generated.ts      the role and tag lists, written by `node bjt/client_constants.ts`
  types.ts          the shapes the database returns
  session.ts        the practice → result handoff
src/ui/             theme, shared components, icons, the meter, the radar, the face
  welcome.tsx       the first-launch explanation
  gate.tsx          "Continue with Google", and "not open yet"
  privacyLink.tsx   the link to /privacy, on the sign-in and account screens
  keys.ts           answering with 1–4 and Enter, on the one platform with a keyboard
modules/
  google-sign-in/   Credential Manager's Google sign-in, as an Expo module (Android)
scripts/icons.mjs   the icon, drawn once: every launcher, web and Play size from it
store/              Play's 512 px icon and feature graphic (the listing: store-listing.md)
```

On the web this is a drill somebody does at a desk between two other tabs, so
`keys.ts` lets the whole set be answered from the keyboard: `1`–`4` or `a`–`d`
to choose, Enter or space to go on. Any key it does not use keeps its normal
behaviour, so Tab still moves focus. On a phone it compiles to nothing, and the
hints that advertise it only render where there is a keyboard to press.

Practice, its result, and the review screens are pushed *over* the tab bar
rather than living in it. A set is a thing you finish, and a tab bar under a
listening item is an invitation to leave halfway — which loses the set.

Three screens show a level and none of them lets anybody set one. Home prints a
single number while the three sections agree, and all three the moment they do
not — by then the split is the news. 記録 puts each section's level beside the
accuracy that earned it. 結果 names the section that just moved, because
「聴解のレベルが上がりました」 is something a person can act on and
「レベルが上がりました」 leaves them guessing which third of the exam it meant.

## Checks

`npm run typecheck` proves the code compiles against the types we *claim* the
database has. It cannot prove that claim is true — for that, `npm run test:db`
builds a local D1 the way the deploy builds the real one (every migration in
`../d1/migrations`, every `../batches/*.sql`, twice) and runs every query in
`worker/queries.ts` as a tester (`worker/test/queries.db.test.ts`) plus the
schema's promises (`worker/test/schema.db.test.ts`), so a missing column, a
write the schema refuses, or one learner seeing another's rows fails CI.

## The Worker

`worker/` is the server half: one Worker serves the static build, the API
(`/api/q/<name>`) and the media (`/media/audio/…`, `/media/scenes/…`) on one
origin, so there is no CORS and the session cookie rides along. It also runs
the sign-in (`/api/auth/…`).

```
worker/
  index.ts      routing; the static build is everything except /api and /media
  auth.ts       the sign-in: Better Auth on D1, Google, the tester list at sign-up
  who.ts        who is asking: a session it signed in, else Access's token
  access.ts     the token Cloudflare Access signed: whose, for which app, in date
  identity.ts   the address it names, or why there is none
  queries.ts    every query the app may ask for, by name — its arguments, checked
  media.ts      the clips and pictures, from R2
  core/         the logic, on D1:
    caller.ts     the address → the account and its tester row (the door)
    snapshot.ts   one learner's record and the bank, read in one batch
    queue.ts      the practice queue (what comes next, and in what order)
    grade.ts      an answer: graded, filed, the ladder and the level moved
    levels.ts     the three section levels
    record.ts     the record screens
    profile.ts    the learner's own row, and starting again
    bank.ts       reports, notes and the veto
  test/         the database tests (`npm run test:db`), on a local D1
```

The rules it keeps are in the repository's CLAUDE.md ("The app reaches the
database only through the Worker, as the learner").

## Deploying the web build to Cloudflare

`expo export -p web` renders one HTML file per route into `dist/`, which the
Worker serves as static assets; `/api/*` and `/media/*` run `worker/index.ts`
first (`run_worker_first`). The database is D1 and the media are in R2, both
bound in `wrangler.jsonc`.

It deploys as a **Worker** with static assets. Dashboard → **Workers & Pages →
Create → Import a repository**, pick this repo, then:

| Setting | Value |
|---|---|
| Worker name | `business-japanese-test-practice` — must match `name` in `wrangler.jsonc`, or the build fails |
| Root directory | `client` *(under Advanced settings)* |
| Build command | `npm run build:web` |
| Deploy command | `npx wrangler deploy` *(the default)* |

Build-time environment variable: `NODE_VERSION=22`. Nothing about the database
is baked into the bundle: the app asks its own origin. Its bindings (D1, R2)
are in `wrangler.jsonc`. The sign-in's four settings (`BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are Worker
**secrets**, never `vars`: a deploy keeps secrets and replaces vars with the
file's. While Access is still in front, its token is checked against the two
plain `vars` there (the team domain and the Access application's AUD tag).
**No key is ever set as a plain variable.**

`build:web` is `expo export` plus one copy: Expo writes the not-found page as
`+not-found.html`, and `not_found_handling: "404-page"` looks for `404.html`.
Without the copy a bad URL falls through to Cloudflare's own error page.

No rewrite rules are needed — `html_handling` serves `/practice` from
`practice.html`, and `not_found_handling` serves `404.html` for missing routes.
`public/_headers` is copied to the output root by Expo; it caches the
content-hashed bundle forever while keeping the HTML revalidating, so a deploy
is never stuck behind a stale page.

To check the config without deploying: `cd client && npx wrangler deploy --dry-run`.
