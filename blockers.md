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

**Where it stands.** The Worker signs everybody in itself, with Google:
Better Auth on the same D1 (`client/worker/auth.ts`), decided 2026-10-03. A
session it signed is the only thing that speaks for anybody
(`client/worker/who.ts`); the fallback that accepted Cloudflare Access's
token was removed on 2026-10-04, so a header or cookie Access sets is nobody.
The tester list is the door twice over: a sign-up from an address it does not
name, or one Google has not verified, is refused before Better Auth writes a
row, and every query meets the list again in `core/caller.ts`; an account
whose address later leaves the list gets no new session. An account joins
the existing `users` row by its verified address, so nobody's history moves.
Better Auth's tables keep sign-in state only: no Google tokens, no photo, no
IP address or browser. Only the routes the app uses answer, and they are
rate-limited. Clips and pictures are checked the same way.

Set up on 2026-10-04: a Google Cloud project with its consent screen
(External, left in **Testing**, scopes `openid`, `email`, `profile`), a **Web**
OAuth client whose redirect URIs are `https://<the Worker's
host>/api/auth/callback/google` and the same on `http://localhost:8787`, and
the four Worker **secrets** (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; secrets, not vars, because a
deploy keeps secrets and replaces vars with `wrangler.jsonc`'s).

Android signs in through the same Worker (`client/README.md`, Android, says
how): Credential Manager's `GetSignInWithGoogleOption`, in a small Expo module
of our own (`client/modules/google-sign-in`), asks for an ID token for the
**Web** client with a fresh nonce; the Worker checks it and the tester list,
and answers with a signed session token the app keeps in secure storage and
sends as `Authorization: Bearer`. The Kotlin module was written where the
Android SDK and Google's Maven repository could not be reached; the first EAS
build was its first compile (it lacked one import, #75), and on 2026-10-04 a
`preview` build signed the owner in on a phone.

**Done 2026-10-04: Access is off the deployed site.** The Worker's Access
setting now covers its preview URLs only, as an extra lock (Google sign-in
cannot finish there: the redirect URI and `BETTER_AUTH_URL` name the
deployed host). The Web client's secret was replaced the same day, since part
of the first was shown in a browser assistant's log; only the new one should
be listed on the client. On the deployed URL the owner signed in with Google,
landed on home with the same history, signed out, and read `/privacy` without
signing in.

**Adding a tester** takes both lists: a **test user** on the consent screen
(Google Auth Platform → Audience), or Google refuses them while it is in
Testing, and a row in `testers` (`bjt tester <email>` prints the SQL; read it,
then apply it with `wrangler d1 execute`).

Still to see on the deployed URL (the owner's account covered the third and fourth):

- A fresh browser gets the app's sign-in screen and nothing of the bank: every
  query and every clip answers 401 `signed_out`.
- A Google account whose address `testers` does not have comes back to "not on
  the tester list", and no `auth_users` or `users` row is made for it.
- A listed address signs in with Google and lands on home, with the same
  history as before the switch, and the same on a second device.
- Signing out (account screen) ends the session and lands on the sign-in
  screen, and so does the next visit. A session lasts 30 days from its last
  use: the Worker renews it on the answers to queries, not only on sign-in.

**Done 2026-10-04: Android signs in.** The EAS keystore (build credentials
`Vz3f5A8i2e`, generated by the first `eas build`; SHA-1
`0F:E3:4E:7B:20:A7:21:07:84:86:6A:10:AA:CC:1D:05:28:8C:E0:6F`) has its own
**Android** OAuth client, "Android (EAS)", package `app.businessjapanesedrill`.
It has no secret and nothing uses its id: it only lets Google hand tokens to
an app signed with that key; without it, Google's sheet fails and the app
says "try again". `EXPO_PUBLIC_API_BASE` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
are set in EAS for `preview` and `production`. On the owner's phone the
`preview` build signed in with Google and landed on home with the same
history, played a listening question, stayed signed in across a restart, and
signed out. It showed no scene pictures: Android's Image dropped the bearer
from a single-object source, and the Worker refused the pictures. The source
is now an array (`pictureSourceFor` in `client/src/lib/phoneSession.ts`); the
next `preview` build is the check that pictures show.

Still to come: once the app is on Play, a second Android client with the SHA-1
of Play App Signing's key (Play Console → Test and release → App integrity),
since Play re-signs what it serves. A Samsung phone blocks an APK from
outside a store while Auto Blocker (自動ブロッカー) is on: switch it off to
install, then on again; Play's testing tracks avoid that.

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
environment of the same name. The EAS project is
`@tacocat42/business-japanese-drill` (2026-10-04; its id and owner are in
`app.json`). The first `preview` APK that runs was built on 2026-10-04 and
signs in with Google (#4). A new tester build is `npx eas-cli build -p android
--profile preview` in `client/`, signed in with `npx eas-cli login`; it reuses
the keystore, so its SHA-1, and the Android OAuth client, stay valid. A tester
also needs both lists (#4, "Adding a tester").

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
- `/privacy` public: it is once Access is switched off (#4). The page's text
  is in its static HTML, so it reads without its scripts.
- Read the policy and the listing draft, and change what is not right: they
  are drafts written from the code, not legal advice.
- Screenshots from the `preview` build on a phone (two to eight, portrait).
- A developer account opened as a personal one (not an organisation) must
  run a closed test with at least twelve testers, opted in for fourteen days in
  a row, before Play lets it apply for production; the console states the
  current numbers. The icon and the feature graphic are in `client/store/`
  (`client/scripts/icons.mjs` draws them, and the launcher icons).

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

## 7. The name has no domain yet

**Where it stands.** The product is **Horenso** (2026-10-04): the app's name,
its start screen, the privacy policy and the store listing say so. The bundle
identifier, package (`app.businessjapanesedrill`), slug, Worker, database and
bucket keep their old names: none is seen by a learner, and changing the
package means a new Android OAuth client. If it is to change, it must change
before the first upload to Google Play, after which it is permanent. The
landing page is written (`landing/`) and not deployed: its links to the app go
through `landing/public/_redirects`, which names the placeholder
`app.horenso.example`.

**Next step.** Buy the domain, then follow
[landing/README.md](landing/README.md#putting-it-on-the-domain): one pull
request names it, both Workers take their hostnames, and the sign-in's redirect
URI, `BETTER_AUTH_URL` and the phone build's `EXPO_PUBLIC_API_BASE` move to
`app.<domain>` together.

---

## Not a blocker: ads

`AdSlot` renders only in development, and its placement type has exactly two
members, so an ad on the practice screen is a type error. The free tier is meant
to be complete, and the ad-free unlock already has a grant path (`bjt grant`,
`grant_entitlement`). Wiring a real ad SDK is a product decision, and needs an
ad network account when it is taken.
