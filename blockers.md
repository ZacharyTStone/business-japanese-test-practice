# Blockers

Work that is finished up to the point where it needs something this repository
cannot provide: an API key, a vendor account, a dashboard, or a person to listen
to something and say whether it sounds right.

Each entry says what exists, what the next step is, and exactly what unblocks it.
None of them is waiting on code.

---

## 1. The fidelity mechanisms have never run against a model

**What exists.** The answerability gate, the discriminator loop and `calibrate`
are all implemented and unit-tested with the model call faked. `bjt quality`
prints the report. `bjt selftest` validates all nine item types offline.

**What is blocked.** Every one of them needs `ANTHROPIC_API_KEY`, and the
discriminator and `calibrate` additionally need `seeds/official/<type>.json` —
real official sample items, which are licensed material and deliberately not in
this repository. `bjt quality` currently reports empty sections for mechanisms
2, 3 and 5 and is telling the truth.

**What unblocks it.** An API key in `.env`, and `cp -r seeds.example seeds`
followed by replacing the placeholders with real content. Then:

```bash
bjt batch --type hatsugen_choukai --level J2 -n 10   # exercises the gate
bjt discriminate --type hatsugen_choukai
bjt calibrate --type hatsugen_choukai
bjt quality
```

**Why it matters more than it looks.** These are the only mechanisms that can
tell us the generated items are actually close to the exam. Until they run, the
claim rests on the hand-written reference batches, which were written by the
same judgement that would be grading them.

---

## 2. No TTS provider has been chosen

**What exists.** `bjt synth` runs end to end: it plans clips from a checked
bundle, synthesises the missing ones, applies the channel treatment, measures
durations, writes the files and emits the SQL that points `audio_clips` at them.
Two provider adapters are written (OpenAI, Google Cloud). A pronunciation
dictionary covers the business readings a TTS model gets wrong in ways that would
teach a learner something false.

**What is blocked.** Both adapters refuse to run, on purpose: neither has a cast
voice mapped to a provider voice id. That mapping is the output of a decision
nobody has made.

**What unblocks it.** A vendor account, and then the listening comparison: the
same twenty clips from both providers, judged by a native speaker on names,
business terms, dates, 敬語 and contrastive emphasis — not on a generic
naturalness score. Record the winner in `VOICE_IDS` on the chosen adapter.

Until then `--provider silent` exercises the whole pipeline with valid, silent
clips. They are pathed `silent/` so they can never be mistaken for real ones, and
they prove nothing about how the Japanese sounds.

**Why the decision cannot be deferred by picking one.** The cast is fixed for the
life of the library — a learner who hears a different voice every question is
doing speaker identification instead of listening to Japanese. A voice chosen
carelessly is one every future item inherits.

---

## 3. No scene artwork exists

**What exists.** `bjt scenes` surveys the sixteen-scene bank across all nine
types and prints it most-wanted first. `bjt scenes --generate` draws whichever
scenes have no picture: an image model drafts from the brief, a judge model
looks at each draft and checks it against the brief's rules one by one (readable
text, a logo, a likeness, a picture that gives the scenario away, malformed
anatomy, the wrong setting), and only a draft that breaks none is kept under
the scene's name. Rejected drafts are kept in `media/scenes/rejected/` with the
reason. `--upload` puts approved files in the `scenes` bucket and `--sql`
points the database at them; the nightly job runs all of it and, because it
lists the bucket first, draws each scene once and then finds nothing to do.

**What is blocked.** Two keys. Nothing else: the review that used to need a
person is done by the judge model, on the owner's instruction (2026-09-17).

**What unblocks it.** Set these as repository secrets (Settings → Secrets and
variables → Actions), and the next nightly run draws the bank:

| Secret | What it is |
|---|---|
| `OPENAI_API_KEY` | the image model |
| `ANTHROPIC_API_KEY` | the reviewer (the same key entry 1 needs) |
| `SUPABASE_URL` | the project URL, so approved files reach the `scenes` bucket |
| `SUPABASE_SERVICE_ROLE_KEY` | the key that may write to that bucket. Never in `client/`, never in a commit. |
| `SUPABASE_DB_URL` | already listed under entry 8; with it the job also applies `batches/scenes.sql` |

With only the first two, the job draws and reviews, and leaves the pictures in
the run's `scene-artwork` artifact for somebody to upload. The same command
runs on a laptop with the same names in `.env`. `bjt scenes --generate
<scene_id> --force` redraws one you do not like.

**The review gate, which is the part that will be tempting to skip.** It is now
a model rather than a person, and the rules are the same: no readable text, no
logo, no recognisable likeness, and nothing that fixes the situation more
tightly than the setting does. That last one is not an aesthetic preference:
the bank is shared, so a picture specific enough to give the scenario away
would make the listening optional. Every rejection is kept with its reason so
the gate can be audited afterwards, and a scene that fails every attempt ships
without a picture, which the app allows.

---

## 4. Google sign-in has never been tested end to end

**What exists.** The app opens only to a Google account on the tester list.
The client shows a sign-in screen, calls `signInWithOAuth`, and asks one RPC
(`is_tester()`) whether the account is allowed; the database enforces the same
check in every row-level policy, so the client is not what keeps anybody out.
The anonymous-first path the schema was built for is switched off in the client
until the app opens.

**What is blocked.** All of it is configuration in two dashboards, and none of it
can be verified from here.

**What unblocks it.**

1. In Supabase → Authentication → Providers, enable **Google**. Leave
   anonymous sign-ins **off**; the client no longer uses them.
2. In Google Cloud Console, create an OAuth client and register the Supabase
   callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`). The
   Google client id and secret go in the Supabase provider settings and
   nowhere else.
3. In Supabase → Authentication → URL Configuration, allow the production
   Cloudflare hostname, the local development URLs, and the `bizjadrill`
   scheme.
4. Set only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
   the Cloudflare build variables. **Never a service-role key.**
5. Put yourself on the tester list. `bjt tester you@gmail.com --note owner`
   prints the statement; apply it with
   `psql "$SUPABASE_DB_URL" -c "<statement>"`.

Then the acceptance checks, which are the point:

- Fresh browser: the sign-in screen, and nothing behind it without signing in.
- Sign in with a Google account that is **not** on the list: the "not open
  yet" screen names the account; the network tab shows every query returning
  nothing.
- Sign in with the listed account: one profile is created; answering items
  writes attempts and moves the weakness metrics.
- Refresh, and open on a second device: the same history is there.
- Sign out: the sign-in screen again, and no data readable.
- Denied consent, cancelled consent, an unapproved redirect URL, and a missing
  build variable each fail in a way the app explains.
- Repeat on the deployed hostname, not only on localhost.

---

## 5. No production Supabase project

**What exists.** Every migration, every RLS policy, the selection RPC, the
storage buckets, the entitlement functions and the tester gate — all of it
proved against a throwaway Postgres by `supabase/test/run.sh`, including the
assertion that one user cannot read another's history, that a client cannot
grant itself the paid unlock, and that nobody off the tester list reads a row.

**What is blocked.** Applying it to a real project, and publishing the
committed items into it.

**What unblocks it.** A Supabase project and its `SUPABASE_DB_URL` secret.
Then, from the Actions tab, run **deploy database**: it applies the
migrations with the Supabase CLI, publishes every `batches/*.sql`, and adds
the Google account typed into the form to the tester list. Every step is
idempotent, so running it again after a new migration or a new batch is the
whole deployment story. No laptop needed. The same three commands by hand:

```bash
supabase db push --db-url "$SUPABASE_DB_URL"
for f in batches/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
python -m bjt tester you@gmail.com | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f -
```

---

## 6. Nothing has been submitted to a store

**What exists.** The web build deploys to Cloudflare Workers as a static export.
`app.json` carries the bundle identifiers, which deliberately do not contain
"BJT" — it is a registered trademark, and it may describe the exam format in
prose but not appear in a product name, slug or identifier.

**What is blocked.** iOS and Android builds have never been made, let alone
submitted.

**What unblocks it.** Apple Developer and Google Play accounts, then an EAS build
per platform. Before either submission there is work that is not blocked and has
not been done: a privacy policy (the app collects answers and, optionally, a
Google identity), a store description that describes the exam format without
using the trademark as a name, and screenshots.

---

## 7. No ad SDK, and that is on purpose

`AdSlot` renders only in development. Its placement type has exactly two members,
so putting an ad on the practice screen is a type error rather than a judgement
somebody makes later under deadline.

This is not blocked so much as **not yet wanted**. The free tier is meant to be
genuinely complete, and the ad-free unlock now has a working grant path
(`bjt grant`, `grant_entitlement`) for support grants and testing. Wiring a real
SDK is a decision about the product, not a missing dependency — and it needs an
ad network account when it is taken.

---

## 8. The nightly job runs half of itself

**What exists.** `.github/workflows/nightly.yml`, and the two commands behind it.
`bjt plan` surveys the library shelf by shelf — nine problem types × three levels
— and prints the work order that would fill the emptiest ones first; `bjt nightly`
executes it, running every item through the same per-item gate and the same
whole-batch checks as a hand-run batch, writing bundles and their SQL, and
leaving a pull request for somebody to read. The survey half runs every night
already: it needs no key, no network and no project, and it is the thing that
says out loud that sixteen of the twenty-seven shelves are empty.

**What is blocked.** The writing half needs one secret:

- `ANTHROPIC_API_KEY` — same blocker as entry 1.

A second is optional. `SEEDS_TAR_B64` is the licensed few-shot and vocabulary
material that lives in the gitignored `seeds/`, as `tar czf - seeds | base64
-w0`. Without it the job builds `seeds/` from the reference batches
(`bjt seeds --bootstrap`): the bank's own hand-written, owner-reviewed items
become the few-shot examples, and the run summary and the pull request say so.
That is weaker than official material and stronger than nothing. Only a real
`seeds/` carries official items, kanji tiers and level descriptors; the
bootstrap never invents them.

A third secret is optional and unlocks the other half of the night:

- `SUPABASE_DB_URL` — one statement, `select public.refresh_item_stats()`, which
  recounts how often each item is answered correctly across all learners. That is
  what the practice queue reads to pitch a set at a difficulty that teaches.
  Without it the queue falls back to the answerability gate's own estimate, which
  is what a freshly published item has anyway.

**What unblocks it.** Setting those secrets on the repository. Then check the
first run's pull request item by item before merging it — the whole design
assumes a person does, and the budget is small so that a person can.

---

## What is not blocked

Everything else. The four checks run offline with no key, no project and no
network:

```bash
pytest
supabase/test/run.sh
cd client && npm run typecheck
python -m bjt checkbatch batches/hatsugen_choukai_J2_001.json
```

CI runs all four on every push. A third workflow, **deploy database**, is run by
hand from the Actions tab and is the whole deployment story — see entry 5. A
second workflow, `nightly`, surveys the bank
every night with the same offline tools — see entry 8 for the half of it that is
waiting on a key.
