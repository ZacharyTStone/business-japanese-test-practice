# Blockers

What stands between this repository and an app open to more than its testers.
Each entry needs something the repository cannot supply for itself — licensed
material, an account, a dashboard setting, or a person — and says where it
stands and what the next step is. Work that needs only code is not listed; the
offline checks are in the [README](README.md#quick-start).

---

## 1. Most of the bank has not been through the gate

**Where it stands.** Most live questions were written by hand and imported with
`bjt importbatch`, which checks their shape and the batch rules but skips the
proofreader and the answerability gate. None has a regate verdict yet (there is
no `batches/regated.txt`): on 2026-10-03, `bjt regate --all --dry-run` counted
127 live questions in 46 bundles, at most 889 calls. The difficulty half is
done: the probe of 2026-10-02 measured every live question, so the queue's
difficulty pitch sorts the whole bank (`bjt plan` prints the count).

**Next step.** With `ANTHROPIC_API_KEY` set:

```bash
bjt regate --all --dry-run   # what would be checked, and how many calls
bjt regate --all             # verdicts into batches/regated.txt; --withdraw proposes failures
```

It stops at the run ceilings and resumes where it stopped, so the whole bank is
at least two runs. Read the proposed withdrawals before merging them.

## 2. Comparing with the official samples needs licensed material

**Where it stands.** The discriminator loop and `bjt calibrate` are implemented
and unit-tested with the model faked, but both need `seeds/official/<type>.json`
— real official sample items, which are licensed and deliberately not in this
repository. Without a licensed `seeds/` the nightly job takes its few-shot
examples from the reference batches, and with no kanji tiers the vocabulary gate
is permissive. These are the only mechanisms that can say the generated items
are close to the exam, rather than close to the judgement that wrote the
reference batches.

**Next step.** `cp -r seeds.example seeds`, replace the placeholders with the
real material (and give the nightly job the same as the `SEEDS_TAR_B64` secret),
then:

```bash
bjt discriminate --type hatsugen_choukai
bjt calibrate --type hatsugen_choukai --attempts-csv attempts.csv   # the export SQL is in --help
bjt quality
```

## 3. Twenty-four clips have the wrong delivery

**Where it stands.** `batches/remake-20260919-pace.txt` names 24 live clips
recorded with a delivery that has since been reverted. A live clip is never
re-made unless it is named, so they do not sound like the rest of the library.
The file goes once they are re-made; while it is in the tree, the job is
outstanding.

**Next step.** Run **deploy database** by hand with `remake_list` set to that
file, check the run summary, then delete the file.

## 4. Sign-in moves from Cloudflare Access to the Worker's own

**Where it stands.** Cloudflare Access stands in front of the whole Worker (the
web app, its API and its media), with a policy that names the addresses
allowed in. The Worker looks the signed-in address up in D1 and answers only
an address in `testers`, making an account for it on its first visit
(`client/worker/core/caller.ts`). Access is a gate for known people in a
browser: it has no native path, nothing that refreshes a session, and a login
page that is not one for the public.

**Decided (2026-10-03): the Worker gets a sign-in of its own, Google only to
start.** Better Auth, in the Worker, on the same D1 (`client/worker/auth.ts`).
Steps 1 and 3 are in code (one pull request, by the owner's choice); what is
left of each is the owner's setup below. In order:

1. **In code: the Worker's own sign-in, and Google on the web.** The Worker
   asks who is calling in this order: a session it signed in itself, else the
   token Access signed (`client/worker/who.ts`), so it works the same before
   and after Access comes off. The tester list is the door twice over: a
   sign-up from an address it does not name, or one Google has not verified,
   is refused before Better Auth writes a row, and every query meets the list
   again in `core/caller.ts`; an account whose address later leaves the list
   gets no new session. An account joins the existing `users` row by its
   verified address, so nobody's history moves. Better Auth's tables keep
   sign-in state only: no Google tokens, no photo, no IP address or browser.
   Only the routes the app uses answer, and they are rate-limited. Clips and
   pictures are checked by the Worker now too; they were only behind Access.
   Until the four secrets below are set there is no sign-in, and nothing
   changes.
2. **Access comes off the app**, once a Google sign-in has been seen to work.
   A small pull request then drops the Access fallback and Access's sign-out
   hop.
3. **In code: Android signs in with Google** (`client/README.md`, Android,
   says how). Credential Manager's `GetSignInWithGoogleOption`, in a small
   Expo module of our own (`client/modules/google-sign-in`), asks for an ID
   token for the **Web** client — the one the Worker already checks — with a
   fresh nonce. No browser on the way, so no custom scheme to claim. The app
   posts it to `/api/auth/sign-in/social`; the Worker checks it and the
   tester list as for the web, and answers with a signed session token, which
   the app keeps in secure storage (excluded from backups) and sends as
   `Authorization: Bearer` with every query, clip and picture, with no
   cookies. Sign-out ends the session on the Worker, forgets the token and
   the chosen account. The Worker's half and the app's TypeScript are tested;
   the Kotlin module has not been compiled or run, because the Android SDK
   and Google's Maven repository could not be reached where it was written:
   the first EAS build is its first compile, and a phone its first test. On a
   phone, scene pictures are not fetched ahead (React Native cannot prefetch
   with a header); each loads when first shown and is cached from then on.

**Next step: switch step 1 on.**

- Google Cloud Console → APIs & Services: an OAuth consent screen, External,
  left in **Testing** with each tester added as a test user (a second list in
  front of `testers`). Then Credentials → Create OAuth client → **Web
  application**, with the authorised JavaScript origin `https://<the Worker's
  host>` and the redirect URI `https://<the Worker's host>/api/auth/callback/google`.
- Four Worker **secrets** (Workers & Pages → the Worker → Settings → Variables
  and Secrets, type Secret; or `npx wrangler secret put <NAME>` in `client/`):
  `BETTER_AUTH_URL` (`https://<the Worker's host>`), `BETTER_AUTH_SECRET`
  (`openssl rand -base64 32`), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
  Secrets rather than vars: a deploy keeps secrets and replaces vars with
  `wrangler.jsonc`'s.
- Access still answers first on the deployed site, so to see Google sign-in
  before Access comes off, run it locally (`client/README.md`, "Signing in
  locally"), with `http://localhost:8787/api/auth/callback/google` added to
  the same client's redirect URIs. Then take Access off the app and run the
  checks below.

**Next step: switch step 3 on** (after step 1, which it signs in to).

- Google Cloud Console → Credentials → Create OAuth client → **Android**,
  package `app.businessjapanesedrill`, with the SHA-1 of the key EAS signs
  the APK with (`npx eas-cli credentials -p android`, after the first
  build). Later, once on Play, a second Android client with the SHA-1 of Play
  App Signing's key (Play Console → Test and release → App integrity). It has
  no secret, and nothing uses its id: it only lets Google hand tokens to this
  app. Without it, Google's sheet fails and the app says "try again".
- In EAS, for `preview` and `production`: `EXPO_PUBLIC_API_BASE` and
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the Web client's id, the same value as
  the Worker's `GOOGLE_CLIENT_ID`), as `client/README.md` shows.
- A `preview` build on a phone, then the checks below, on the phone.

After any change to sign-in, on the deployed URL:

- A fresh browser gets the app's sign-in screen and nothing of the bank: every
  query and every clip answers 401 `signed_out`.
- A Google account whose address `testers` does not have comes back to "not on
  the tester list", and no `auth_users` or `users` row is made for it.
- A listed address signs in with Google and lands on home, with the same
  history as before the switch, and the same on a second device.
- Signing out (account screen) ends the session and lands on the sign-in
  screen, and so does the next visit. A session lasts 30 days from its last
  use: the Worker renews it on the answers to queries, not only on sign-in.
- While Access is still in front, all of this happens behind Access's own
  sign-in, and an expired Access session shows "sign in again".
- On an Android phone: "Continue with Google" opens Google's account sheet;
  closing it leaves the screen as it was; a listed account lands on home; an
  unlisted one is told it is not on the list. Listening questions play, and
  scene pictures show. Closing and reopening the app stays signed in.
  Signing out lands on the sign-in screen, and the next sign-in asks which
  account again.

**Next step, when the app opens.** Drop the tester check from the door in
`core/caller.ts`, and take the consent screen out of Testing.

## 5. No store builds

**Where it stands.** The web build deploys to Cloudflare Workers as static
assets. `app.json` carries bundle identifiers without "BJT" in them (a
registered trademark: it may describe the exam format in prose, never name the
product), and asks Android for nothing but the network, the audio settings and
vibration (the buzz after an answer) — no microphone, no background playback,
no storage. `client/eas.json` has two
Android profiles: `preview`, an APK to install directly on a tester's phone,
and `production`, the bundle Google Play takes; each builds from the EAS
environment of the same name. No build has been made yet. Android signs in
with Google (#4, step 3), once the Worker's sign-in is on.

**Next step for an Android tester build.** With an Expo account, in
`client/`: `npx eas-cli init` (writes the project id into `app.json`), then
the two EAS environment variables `client/README.md` (Android) lists, for
`preview` and `production` alike (a build without the Worker's address opens
on the "not configured" notice), then `npx eas-cli build -p android
--profile preview`, and install the APK it links to. The Android OAuth client
in #4 needs this build's keystore SHA-1.

**Next step for Google Play.** What the store asks of the app is in code:
the privacy policy at `/privacy` (`client/src/lib/privacy.ts`), "Delete
account" on the account screen and on the web, and a draft listing with the
Data safety answers (`client/store-listing.md`). The start screen
(`client/src/ui/welcome.tsx`) already tells listeners that the voices are
synthesised, which OpenAI's usage policies ask of an app that plays its speech
to people. What is left is the owner's:

- A Google Play developer account, then the `production` profile.
- The operator's name and a contact address for the privacy policy
  (`PRIVACY_OPERATOR` and `PRIVACY_CONTACT` in `client/src/lib/privacy.ts`):
  the page says "to be added" until then, and Play wants both.
- `/privacy` public: it is once Access comes off (#4, step 2); before that, an
  Access application for `<the Worker's host>/privacy` with a Bypass policy.
  The page's text is in its static HTML, so it reads without its scripts.
- Read the policy and the listing draft, and change what is not right: they
  are drafts written from the code, not legal advice.
- Screenshots from the `preview` build on a phone (two to eight, portrait).

iOS is not in scope for now: the owner chose Android and the web (2026-10-03).

## 6. Nightly pull requests need a repository setting

**Where it stands.** The nightly job writes its items and pushes them on a
branch (`content/nightly-<date>-<run>`). Opening the pull request needs
Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to
create and approve pull requests"; when it is off, the run summary says so and
links the branch.

**Next step.** Tick the setting if a run summary reports it. Nobody needs to
read a night's pull request any more (2026-10-02): the workflow runs the
`checks` on its branch and merges it on green, then starts the deploy. A pull
request left open carries a comment saying why — a red check, or `main` having
moved during the night — and is the one to look at. The merge uses the
workflow's own token, so it needs no new secret; a branch protection rule that
requires a review would stop it, and the comment would say so. The checkout no
longer keeps the token; only the pull-request step is given git credentials
(`gh auth setup-git` with `GH_TOKEN`). The first night to use it (2026-10-02,
#67) merged itself and started the deploy; if a merge ever fails, the fallback
is merging by hand.

Each nightly pull request also shows a red `checks` run with no jobs. GitHub
records a `pull_request` run for a pull request a workflow opened with its own
token, holds it for approval, never runs it, and fails it when the pull request
closes. The verdict is the nightly run's own `the checks, on tonight's branch`
jobs. Opening the pull request with a GitHub App token or a personal access
token instead would let that run go ahead, at the cost of a new secret.

---

## Not a blocker: ads

`AdSlot` renders only in development, and its placement type has exactly two
members, so an ad on the practice screen is a type error. The free tier is meant
to be complete, and the ad-free unlock already has a grant path (`bjt grant`,
`grant_entitlement`). Wiring a real ad SDK is a product decision, and needs an
ad network account when it is taken.
