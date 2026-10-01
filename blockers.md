# Blockers

What stands between this repository and an app open to more than its testers.
Each entry needs something the repository cannot supply for itself — licensed
material, an account, a dashboard setting, or a person — and says where it
stands and what the next step is. Work that needs only code is not listed; the
offline checks are in the [README](README.md#quick-start).

---

## 1. Most of the bank has not been through the gate, or measured

**Where it stands.** Most live questions were written by hand and imported with
`bjt importbatch`, which checks their shape and the batch rules but skips the
proofreader and the answerability gate. None has a regate verdict yet (there is
no `batches/regated.txt`), and almost none carries a difficulty signal, so the
queue's difficulty pitch sorts nothing for them (`bjt plan` prints the count).

**Next step.** With `ANTHROPIC_API_KEY` set:

```bash
bjt regate --all --dry-run   # what would be checked, and how many calls
bjt regate --all             # verdicts into batches/regated.txt; --withdraw proposes failures
bjt probe --all              # or the nightly workflow's manual "probe" input
```

Each stops at the run ceilings and resumes where it stopped, so the whole bank
is a few runs of each. Read the proposed withdrawals before merging them.

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
and no anonymous path in the app. Access is a browser sign-in, so the app is
web-only until a native build has a way in.

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

## 5. No store builds

**Where it stands.** The web build deploys to Cloudflare Workers as static
assets. `app.json` carries bundle identifiers without "BJT" in them (a
registered trademark: it may describe the exam format in prose, never name the
product). iOS and Android builds have never been made; there is no `eas.json`.

**Next step.** Apple Developer and Google Play accounts, then an EAS build per
platform. Before either submission, work that is not blocked and not done: a
privacy policy (the app collects an email address and answers), a store
description that describes the exam format without using the trademark as a
name, screenshots, and a line on the start screen (`client/src/ui/welcome.tsx`)
telling listeners that the voices are synthesised, which OpenAI's usage
policies ask of an app that plays its speech to people.

## 6. Nightly pull requests need a repository setting

**Where it stands.** The nightly job writes its items and pushes them on a
branch (`content/nightly-<date>-<run>`). Opening the pull request needs
Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to
create and approve pull requests"; when it is off, the run summary says so and
links the branch.

**Next step.** Tick the setting if a run summary reports it, and read each
night's pull request item by item before merging it — merging deploys. The
checkout no longer keeps the token; only the pull-request step is given git
credentials (`gh auth setup-git` with `GH_TOKEN`). That cannot be exercised
offline, so watch the first night's push; if it fails, the fallback is a
one-off `http.extraheader` on that push.

---

## Not a blocker: ads

`AdSlot` renders only in development, and its placement type has exactly two
members, so an ad on the practice screen is a type error. The free tier is meant
to be complete, and the ad-free unlock already has a grant path (`bjt grant`,
`grant_entitlement`). Wiring a real ad SDK is a product decision, and needs an
ad network account when it is taken.
