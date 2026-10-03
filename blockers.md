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

## 4. Sign-in is Cloudflare Access, for listed testers only

**Where it stands.** Cloudflare Access stands in front of the whole Worker (the
web app, its API and its media), with a policy that names the addresses
allowed in. The Worker looks the signed-in address up in D1 and answers only
an address in `testers`, making an account for it on its first visit
(`client/worker/core/caller.ts`). There is no password form, no Google button
and no anonymous path in the app. Access is a browser sign-in, so a native
build signs in through the same Access page in a browser tab, and the Worker
hands the app the token through a one-time code (`client/worker/native.ts`);
the app then sends it as `cf-access-token`, which Access accepts in place of
the cookie. The code exchange, `/auth/native/token`, is the one path the app
reaches before it has a token, so Access must let it through: until a Bypass
policy covers exactly that path, a native sign-in fails at the last step.

**Next step for Android.** In Zero Trust → Access → Applications, add a
self-hosted application for `<the Worker's host>/auth/native/token` alone with
a Bypass policy (Everyone). Nothing else on the host changes, and the Worker
gives that path nothing but a token for a valid code and its secret. Then check
it took: `curl -i -X POST https://<the Worker's host>/auth/native/token -d '{}'`
must answer the Worker's own `400` with `sign_in_failed`, not a redirect to
Access's sign-in page. If Access protects the Worker by name (Workers & Pages →
the Worker → Access) rather than by hostname, a path's bypass may not reach
under it; the documentation does not say. If the check fails, protect the
hostname instead (a self-hosted application on the host, the same policy) and
keep the bypass on the path.

What PKCE does not stop is another app on the same phone starting a sign-in
of its own on the `bizjadrill://` scheme, which any app may claim. For a tester
build that is accepted; before the app is public, an Android App Link (a
verified https link back) closes it.

**Next step, when the app opens.** Drop the tester check from the door in
`core/caller.ts`, and a sign-in that is not an allow-list — an auth library on
the Worker (accounts on the same user ids), since Access's own login page is
for known people, not the public.

After any change to sign-in, on the deployed URL:

- A fresh browser gets Cloudflare's sign-in page, and nothing of the app.
- An address the Access policy does not name cannot reach the app at all.
- A named address that `testers` does not have sees the "not open yet"
  screen, every query is refused, and no account is made for it.
- The account's history is the same after a refresh and on a second device.
- Signing out (account screen) ends the Access session; the next visit asks
  again.
- An expired Access session shows "sign in again", and the button brings the
  learner back signed in.
- On Android: the first launch offers the sign-in, the button opens Access in
  a browser tab and comes back signed in; an address `testers` does not have
  is told "not open yet" in the tab, and no code is made for it; signing out
  opens Access's sign-out in the tab, and the next sign-in asks again.

## 5. No store builds

**Where it stands.** The web build deploys to Cloudflare Workers as static
assets. `app.json` carries bundle identifiers without "BJT" in them (a
registered trademark: it may describe the exam format in prose, never name the
product), and asks Android for nothing but the network and audio settings (no
microphone, no background playback, no storage). `client/eas.json` has two
Android profiles: `preview`, an APK to install directly on a tester's phone,
and `production`, the bundle Google Play takes. No build has been made yet.

**Next step for an Android tester build.** With an Expo account, in `client/`:
`npx eas-cli init` (writes the project id into `app.json`), then
`npx eas-cli env:create --environment preview --name EXPO_PUBLIC_API_BASE
--value https://<the Worker's host> --visibility plaintext`, then
`npx eas-cli build -p android --profile preview`, and install the APK it links
to. The Access bypass in #4 has to be in place first.

**Next step for the stores.** Apple Developer and Google Play accounts, then
the `production` profile per platform. Before either submission, work that is
not blocked and not done: a
privacy policy (the app collects an email address and answers), a store
description that describes the exam format without using the trademark as a
name, and screenshots. The start screen (`client/src/ui/welcome.tsx`) already
tells listeners that the voices are synthesised, which OpenAI's usage policies
ask of an app that plays its speech to people.

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
