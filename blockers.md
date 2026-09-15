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
types and prints it most-wanted first, which makes it a commissioning order: one
reception counter serves 場面把握, 状況把握 and 発言聴解. `--prompt <scene_id>`
prints the brief. `--sql` points the database at approved files.
`next_items` returns `scene_image_path`, the `scenes` storage bucket exists, and
the app renders the picture when there is one.

**What is blocked.** Somebody has to generate or commission the images, and
somebody has to approve each one against the brief.

**What unblocks it.** An image API account or an illustrator, plus a reviewer
willing to say no. Put approved files in `media/scenes/<scene_id>.webp` and run
`bjt scenes --sql`.

**The review gate, which is the part that will be tempting to skip.** An image
must contain no readable text, no logo, no recognisable likeness, and nothing
that fixes the situation more tightly than the setting does. That last one is not
an aesthetic preference: the bank is shared, so a picture specific enough to give
the scenario away would make the listening optional.

---

## 4. Google identity linking has never been tested end to end

**What exists.** The client signs in anonymously before it shows anything, and
`linkGoogle` calls `linkIdentity`. The account screen has a recoverable error
state. The schema keeps the same user id across linking, so nothing merges.

**What is blocked.** All of it is configuration in two dashboards, and none of it
can be verified from here.

**What unblocks it.**

1. Enable anonymous sign-ins and Google as an Auth provider in Supabase.
2. Enable **manual identity linking** — the explicit `linkIdentity` path the
   client uses requires it.
3. Register the Supabase callback URL in Google Cloud Console. The Google client
   secret goes in Supabase and nowhere else.
4. In Supabase Auth URL Configuration, allow the production Cloudflare hostname,
   the local development URLs, and the `bizjadrill` scheme.
5. Set only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
   the Cloudflare build variables. **Never a service-role key.**

Then the acceptance tests, which are the point:

- Fresh browser: anonymous sign-in creates exactly one profile.
- Answer some items anonymously; attempts and weakness metrics change.
- Link Google; the user id, profile, attempts and streak are **unchanged**.
- Refresh, and open on a second device; the linked history is there.
- Sign out; a new anonymous user cannot read the linked user's data.
- Denied consent, cancelled consent, an unapproved redirect URL, and a missing
  build variable each fail in a way the app explains.
- Repeat on the deployed hostname, not only on localhost.

---

## 5. No production Supabase project

**What exists.** Every migration, every RLS policy, the selection RPC, the
storage buckets and the entitlement functions — all of it proved against a
throwaway Postgres by `supabase/test/run.sh`, including the assertion that one
user cannot read another's history and that a client cannot grant itself the
paid unlock.

**What is blocked.** Applying it to a real project, and publishing the 88
committed items into it.

**What unblocks it.** A Supabase project, then:

```bash
supabase db push
for f in batches/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Every statement is an upsert, so re-running is safe.

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

## What is not blocked

Everything else. The four checks run offline with no key, no project and no
network:

```bash
pytest
supabase/test/run.sh
cd client && npm run typecheck
python -m bjt checkbatch batches/hatsugen_choukai_J2_001.json
```

CI runs all four on every push.
