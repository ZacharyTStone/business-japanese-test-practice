# ビジネス日本語ドリル

A study app for the format of the **BJT ビジネス日本語能力テスト** (Business
Japanese Proficiency Test), and the pipeline that writes its questions.

```
bjt/         the item pipeline — generate, check, publish        (Python)
seedtable/   the axes that produce variety                       (committed data)
batches/     checked bundles + the hand-written reference sets   (committed data)
supabase/    schema, row-level security, and its tests           (SQL)
client/      the app: iOS, Android and web from one codebase     (Expo)
blockers.md  what is finished up to the point it needs a key
```

Three things are true of the whole system and explain most of its shape:

* **Nothing is generated while somebody is practising.** Generation is a batch
  job — on a laptop, or nightly on a schedule that opens a pull request — and
  what ships is checked JSON, published as reviewable SQL. That is why the
  running cost is zero and why the quality gates can afford to be slow.
* **One bank, shared by everybody, sorted per person.** Every learner draws from
  the same published library; what is personal is the order. Fixed, readable SQL
  does the sorting, over labels the pipeline attached before the item shipped and
  counts the bank took from everyone's answers.
* **Good at something means harder questions in it.** The level is held per exam
  section, so 読解 can be J1 while 聴解 is J3; and inside a level the queue aims
  at a difficulty that follows how the learner does at that particular problem
  type. Both directions, automatically, with nothing to set.
* **Testers only, for now.** The app opens only to a signed-in user whose email
  is in `public.testers`, and it is the database that says so: every row-level
  policy requires it, the anon role can read nothing, and `bjt tester <email>`
  prints the one statement that lets somebody in. The anonymous-first sign-in
  the schema was built for is switched off, not removed, until the app opens.
* **The learner chooses nothing.** No level, no section, no problem type, no
  difficulty, no mode — one button, and the database decides what is behind it
  from what they have answered. The app says so once, on a start screen, and
  then never asks again.
* **The database grades answers, not the app.** The client posts which option was
  touched; a trigger decides correctness and records which trap caught them.

All nine BJT problem types are built. Each has a seed table, an item schema, a
generator, a worked fixture, and a hand-written reference batch:

| Section | Type | What it is | Stimulus |
|---|---|---|---|
| 聴解 | `bamen_haaku` | 場面把握 — hear a moment, answer about the situation | narration |
| 聴解 | `hatsugen_choukai` | 発言聴解 — a narrated situation, four spoken utterances | narration + spoken options |
| 聴解 | `sougou_choukai` | 総合聴解 — a conversation, then a question about it | narration + dialogue |
| 聴読解 | `joukyou_haaku` | 状況把握 — read a notice, hear a request, choose an action | narration + document |
| 聴読解 | `shiryou_choudokkai` | 資料聴読解 — a document on the page, a prompt in the ear | narration + document |
| 聴読解 | `sougou_choudokkai` | 総合聴読解 — a longer exchange and its documents | narration + dialogue + documents |
| 読解 | `goi_bunpou` | 語彙・文法 — one blank, four fillers | text |
| 読解 | `hyougen` | 表現読解 — a situation, four expressions | text |
| 読解 | `sougou_dokkai` | 総合読解 — read a document, infer intent or action | document |

発言聴解 was built first on purpose: it exercises every hard part at once — 敬語
direction, ウチ/ソト, telephone protocol, a reused scene image, and TTS. Whatever
it needed is what the images, the audio, and the app's review screen had to
provide, and that settled the shape of the eight that followed.

The three listening-and-reading types all turn on one requirement: **the answer
must need both the document and the audio.** It is the requirement a generator
will quietly drop, because writing a document that contains the answer is much
easier than writing a pair that have to be combined — and the result looks fine
until you notice the audio is decorative.

`gazou_haaku` is deliberately rare (one a night at most) and expensive in a way
no other type is: each item gets a picture drawn for it, reviewed against its
own four descriptions, and the item is not served until that picture exists.

`blockers.md` lists the work that is finished up to the point where it needs an
API key, a vendor account, or a person to listen to something.

---

## Quick start

Everything except live generation runs offline, with no API key and no Supabase
project:

```bash
pip install -e ".[dev]"
python -m bjt checkbatch batches/hatsugen_choukai_J2_001.json --show   # read the reference batch
python -m bjt seedtable --sample 5                                     # what would be written next
python -m bjt plan                                                     # which shelves of the bank are empty
pytest                                                                 # the pipeline
supabase/test/run.sh                                                   # the schema, on a throwaway Postgres
cd client && npm install && npm run typecheck                          # the app
```

Running the app needs a Supabase project:

```bash
supabase db push                                  # apply supabase/migrations/
psql "$SUPABASE_DB_URL" -f batches/hatsugen_choukai_J2_001.sql   # publish the content
cd client && cp .env.example .env && npm run web
```

For live generation:

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # or put it in .env — see .env.example
bjt init
bjt batch --type hatsugen_choukai --level J2 -n 10
bjt publish batches/hatsugen_choukai_J2_002.json
```

(`python -m bjt <cmd>` and `bjt <cmd>` are equivalent.)

---

## Commands

| Command | What it does |
|---|---|
| `bjt init` | Create the SQLite DB and print how to populate `seeds/`. |
| `bjt seeds` | Validate and report what's in `seeds/` (few-shot, official, vocab, levels). |
| `bjt seedtable [--sample N]` | Inspect the 場面×関係×機能×レベル table: how many cells exist, how many are spent, and what would be written next. |
| `bjt selftest` | Offline check of schema/role validation and the DB (no key). |
| `bjt gen --type T --level J2` | Generate one item, proofread and gate it, store it, print it. |
| `bjt batch --type T --level J2 -n 10` | **The main path.** Generate a batch offline, proofread and gate each item, run the whole-batch checks, write a bundle. |
| `bjt plan` | What the bank needs next: ten types × three levels, reading shelves first, then emptiest shelf first. No key. |
| `bjt nightly [--budget N]` | Run that work order — generate, gate, check, and write the SQL. What the nightly job calls. |
| `bjt importbatch <file.source.json>` | Same checks, same bundle, for items written by hand. |
| `bjt checkbatch <bundle.json> [--show]` | Re-run every offline check over an existing bundle. No key needed. |
| `bjt smoke --type T -n 10` | Headless acceptance run: generate N, assert nothing crashes or fails validation. |
| `bjt practice --type T -n 10 [--demo]` | Answer a run of items interactively. `--demo` needs no key. |
| `bjt quality` | The fidelity report — all six mechanisms plus raw per-item-type accuracy. |
| `bjt discriminate --type T` | Mix official + generated items, ask a judge which are synthetic, report the rate and the tells — then auto-fold those tells into the generator prompt. |
| `bjt publish <bundle.json>` | Turn a checked bundle into idempotent SQL for the database. |
| `bjt synth <bundle.json>` | Synthesise the bundle's audio offline and write the SQL that points at it. `--provider auto` picks the pinned or configured provider; `--have` skips clips the database already has; `--upload` puts the files in the `audio` bucket. `--provider silent` runs with no vendor account. |
| `bjt audition` | The cast saying the same eight lines, on a page to listen to; `--voices` adds every voice the model offers, to recast a role by ear. |
| `bjt scenes` | What the scene bank needs, most-wanted first, and every 画像把握 picture the bank owes. `--generate` draws the missing ones and has a judge model review each draft against the brief (and, for a picture, sit the item); `--only bank`/`--only pictures` narrows it; `--upload` puts approved art in the bucket and records refusals there; `--sql` points the database at it, stand-ins included. |
| `bjt render <bundle.json>` | Render a document stimulus to HTML, to look at while writing one. |
| `bjt grant <user-id>` | SQL granting or revoking the ad-free unlock, as the service role. |
| `bjt tester <email>` | SQL letting one email address use the app while it is in testing; `--remove` takes them off. |
| `bjt calibrate --type T` | Sit the official sample items; compare your accuracy there to your accuracy on generated items. |

Levels are `J3` / `J2` / `J1`. Config via env vars: `BJT_MODEL`,
`BJT_JUDGE_MODEL`, `BJT_DB_PATH`, `BJT_SEEDS_DIR`, `BJT_SEEDTABLE_DIR`,
`BJT_BATCH_DIR`, `BJT_GEN_EFFORT`, `BJT_SLOT_PATIENCE`, `BJT_GATE_TRIALS`,
`BJT_IMAGE_MODEL`, `BJT_IMAGE_QUALITY`, `BJT_IMAGE_COMPRESSION`,
`BJT_SCENE_ATTEMPTS`, `BJT_SCENE_LIFETIME_ATTEMPTS` (6, over a picture's whole
life), `BJT_NIGHT_MAX_PICTURES` (4).

Every process that calls the API runs under ceilings it cannot lift from the
prompt: `BJT_RUN_BUDGET_USD` (default 2, priced from the usage each response
reports), `BJT_RUN_MAX_CALLS` (500) and `BJT_RUN_MAX_MINUTES` (30) stop a run
before the call that would cross them, keeping what it wrote; each call has a
`BJT_API_TIMEOUT_SECONDS` (300) timeout and at most `BJT_API_MAX_RETRIES` (2); `BJT_MAX_TOKENS_CEILING` (8000) and
`BJT_EFFORT_CEILING` (`high`) cap one call; `BJT_NIGHT_MAX_BUDGET` (24) and
`BJT_NIGHT_MAX_PER_SLOT` (6) cap what a night may be asked to write. `bjt
nightly` prints the running bill after every shelf and puts the total in its
summary. Secrets, each read only by the step that needs it:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (scene art and the voice), `SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` (uploading either). `bjt seeds --bootstrap` builds a
`seeds/` from the reference batches when there is no licensed material, which is
what the nightly job does without a `SEEDS_TAR_B64` secret.

---

## The seed table — where variety actually comes from

The obvious way to get varied items is to ask the prompt for variety. It does not
work: you get the same three scenarios forever, in slightly different words.

So variety is a property of the *input* instead. `seedtable/<type>.json` declares
four axes — **場面 × 関係 × 機能 × レベル** — plus the constraints that say which
combinations are real. Enumerating those gives concrete cells, each cell is
consumed at most once, and the generator is handed exactly one per item. A run of
ten items is ten different situations by construction.

```
$ bjt seedtable
hatsugen_choukai
  valid cells: 1230   used: 10   remaining: 1220
    J3: 410 cell(s)   J2: 410 cell(s)   J1: 410 cell(s)
  scene bank: 16 reusable image(s)
```

A cell is valid only when the relation fits the setting, the function can be
performed on that relation, **and** the setting's channel can carry the function.
That last constraint is what stops 「来客を迎えて案内する」 from being generated
over the telephone.

Unlike `seeds/`, the seed table is our own design rather than licensed material,
so it **is** committed. Extending the library is a matter of adding rows to it,
and "will we run out of questions?" becomes a counting question rather than a
prompting one.

---

## The six fidelity mechanisms

Closeness to the real exam is treated as measurable. All six produce numbers you
can see in `bjt quality`.

1. **Distractor roles** (`bjt/fidelity/roles.py`). Every option carries a role
   from a fixed per-item-type enum — the *specific reason* it's wrong, the way the
   official 解説 spell it out. For 発言聴解 the enum is almost entirely about
   direction of respect and 場面 fit rather than grammar: `wrong_uchi_soto`,
   `over_polite_misfit`, `set_phrase_wrong_situation`,
   `phone_protocol_violation`, and so on. Items with a duplicate role, a missing
   role, a role outside the enum, or ≠1 correct option are **rejected** before
   storage.

   Every option also carries a **`why`**: one Japanese sentence naming the
   concrete thing wrong with *that exact wording in that exact situation*, not a
   restatement of the role label. The role is for the machine; the `why` is what
   the app shows the learner after a wrong answer, and it is required.

2. **Two-sided answerability gate** (`bjt/fidelity/answerability.py`). Each item
   is answered by a strong model under two views, three times each:
   - **full** (stimulus + options) — should *succeed*; failing means the item is
     ambiguous, not hard → discard.
   - **cold** (options only, stimulus withheld) — should *fail*; succeeding means
     the distractors leak the answer → discard.

   For 発言聴解 the withheld stimulus is the narrated situation, which is the
   brief's literal cold view: four utterances with no situation should not be
   separable, because appropriateness is the entire point of the type. If a model
   can pick the key from the utterances alone, the item is really a politeness
   ranking with a preamble attached. For the two text-only types there is no
   separate passage, so cold withholds the *stem* instead — same mechanic, same
   reading of a cold success.

   **Difficulty is measured separately** (`bjt/fidelity/difficulty.py`), after
   the gate and only on the items it kept. The gate's full-view rate used to
   double as the difficulty prior and was almost always 1.0 — a strong model
   with the whole stimulus answers nearly everything, which is the gate working
   and a prior failing. So a weaker model (the proofreader's, `BJT_DIFFICULTY_MODEL`)
   sits the same full view `BJT_DIFFICULTY_TRIALS` times, and its pass rate is
   what ships as `model_p_correct`. A probe that could not run leaves the item on
   the gate's rate rather than on a made-up one. `BJT_DIFFICULTY=0` turns it off.

3. **Discriminator loop** (`bjt/fidelity/discriminator.py`). Mix official sample
   items with generated ones and ask a judge to label each. Above-chance
   discrimination means there's a tell; the judge is asked *why*, and its reasons
   are recorded. **The loop is closed:** the most recent tells for an item type
   are auto-injected into that type's generator prompt, so the next items are
   written to avoid them. The rate should trend toward 50%.

4. **Document templates** (`bjt/render/templates.py`). Eight templates — external
   email, email thread, internal notice, minutes, schedule, progress report,
   quotation, office sign — each declaring the header fields it cannot do without
   and the axes it is allowed to vary along, so a library of them does not become
   visually predictable. A document is **data**, rendered by us: a screenshot of
   an email cannot be selected, scaled, or read aloud, and an image model cannot
   spell 御中. The template is assigned by the seed cell exactly as a scene id is,
   and an item that substitutes a different one is rejected.

5. **Sanity check** (`bjt/fidelity/sanity.py`). One small call (Haiku by default,
   `BJT_SANITY_MODEL`) the moment an item exists, before anything expensive
   touches it. It proofreads: is the marked answer impossible, is a second option
   just as right, does the 解説 justify a different option, is the Japanese broken,
   do the options answer the question the stem asks. Any flag discards the item as
   `discarded:sanity`.

   **It runs first because it is cheap.** The answerability gate is six calls to a
   strong model; a generation that came out with its explanation pointing at the
   wrong option now costs one small call instead of six large ones, and the gate's
   budget is spent only on items that might survive it. It is deliberately *not*
   asked to re-answer the question — an item is meant to be hard, and a cheap
   model disagreeing about which 敬語 form fits is the item working, not a defect.
   Judging that is the gate's job and stays there. An item the checker could not
   reach (outage, no key) is recorded as unchecked, never as clean, and goes on to
   the gate anyway. `BJT_SANITY=0`, or `--no-sanity`, turns it off.

6. **Vocabulary gating** (`bjt/fidelity/vocab.py`). A JLPT-kanji-tier ceiling for
   level control, plus a business-term list. The ceiling is enforced for a level
   **only when the tier data up to that ceiling is loaded** (J3→N3, J2→N2,
   J1→N1); with partial data the gate is permissive and says so.

**No estimated BJT score is ever shown** — we have no IRT calibration for
generated items. `quality` reports raw per-item-type accuracy only. `calibrate`
is the honesty check: if you score much higher on generated items than on the
official samples, the prompts have drifted soft.

---

## Batch checks — the failures a per-item gate cannot see

A gate looks at one item. Some of the worst problems only exist *across* a batch,
and they are exactly the ones that let a test-taker score without understanding
anything. `bjt checkbatch` runs these offline, with no key:

| Check | Why it matters |
|---|---|
| item validity | every item still passes its own schema and role rules |
| seed cells distinct | one item per cell, so the batch isn't secretly narrower than it looks |
| no near-duplicates | two different cells can still produce the same question (character-bigram Jaccard, `bjt/fidelity/dedupe.py`) |
| answer position spread | a learner who notices C is right half the time can score without listening |
| length does not leak | "pick the longest, most elaborate option" must not work — over-politeness is one of the traps |
| distractor role coverage | an enum of eight used as three is a prompt that has settled into a rut |
| per-option `why` | if this is thin, the app has nothing to show after a wrong answer |
| stem length | a listening stem is heard once: too short sets up nothing, too long tests memory |
| scenes come from the bank | images are a shared bank, not one per item |

Failures block a bundle from being written. Warnings are for the five-second
human look the pipeline ends with anyway.

---

## Bundles — what actually ships

`batches/<type>_<level>_<nnn>.json` is self-contained and app-facing: items with
their answer index, 解説, per-option `why`, the scene id each item is set in, and
the clip ids its audio files will be named after.

```jsonc
{
  "bundle_version": 1,
  "item_type": "hatsugen_choukai", "level": "J2",
  "items": [ { "id": "...", "stem": "...", "scene_id": "...", "channel": "phone",
               "options": [{ "text": "...", "role": "...", "why": "..." }],
               "correct_index": 0,
               "model_p_correct": 0.67,
               "audio": { "narration": "<clip id>", "options": ["<clip id>", ...] } } ],
  "audio_manifest": [ { "clip_id": "...", "text": "...", "voice": "...", "channel": "phone" } ],
  "scenes": ["scene_phone_desk", ...]
}
```

### Audio (`bjt/tts/`)

`plan.py` decides *what* to synthesise; `synth.py` is the offline job that does
it; `channel.py` applies the treatment; `providers.py` holds the vendor adapters.
Nothing is ever synthesised at practice time — the job runs on a laptop, over a
bundle that has already passed every gate, and emits files plus the SQL that
points the database at them. Uploading and applying are separate deliberate acts,
which is why no key that can write media needs to exist on a build machine.

**The voice is OpenAI.** The owner chose it (2026-09-18), `providers.py` records
it as the default, and the same `OPENAI_API_KEY` that draws the scene artwork
is all `bjt synth` needs. It is an instructable speech model rather than the
concatenative kind that made TTS sound like a station announcement, and every
clip is given one house direction (`HOUSE_STYLE`): native Tokyo office Japanese
at a working pace, keigo said fluently rather than read off a list, no acting,
no announcer voice. Seven roles are cast to seven of its voices. `bjt audition`
writes the cast side by side — and with `--voices`, every voice the model offers
saying one line — into `media/audition/index.html`, for a native speaker to
check by ear before the library is synthesised. Gemini and Google Cloud
adapters remain for comparison (`--provider gemini`), not for shipping: the
cast is fixed for the life of the library.

The **deploy database** workflow runs the same job over the whole published
bank: the database says which clips are live (`--have`), only the missing ones
are made, `--upload` puts them in the `audio` bucket and the SQL points the rows
at them. A clip already live is never touched again.

`--provider silent` runs the whole thing with no vendor account: valid, silent
clips, pathed `silent/` so they can never be mistaken for real recordings (and
`--upload` refuses them). What they cannot tell you is whether the Japanese
sounds right — see `blockers.md`.

Two decisions are encoded in the plan:

- **Voices are cast by role, not per item.** A learner who hears a different voice
  every question is doing speaker identification instead of 敬語, so the voice
  follows from the seed cell's 関係 and stays fixed across the whole library.
- **Clip ids are content hashes** of (voice, channel, text). 「かしこまりました。」
  appears in dozens of items and is synthesised once; re-running a batch re-uses
  every clip whose text didn't change.

- **What is spoken differs by type, and that is a table rather than a guess.**
  発言聴解 speaks its options, because there the options *are* the utterances
  under test; everywhere else they are statements on the page, and speaking them
  would turn a reading choice into a memory test. 総合読解 speaks nothing at all,
  and the pipeline says so rather than reporting zero clips as a failure.

The narrator stays clean even on a telephone item — the narrator is outside the
scene. Only what happens inside the scene gets the band-limited phone treatment,
because business phone Japanese really is harder to hear than studio audio, and
an item about a phone call that sounds like a studio recording is easier than the
real thing.

### Images

Items name a `scene_id` from a small shared bank (16 scenes so far), never a
per-item picture. The seed table decides which bank entries a setting may use, so
a batch's scene list is known before any image exists. Text, names, and numbers
are deliberately **not** part of the artwork — they are overlaid, so one drawing
serves many items and nothing is at the mercy of a model's handwriting.

---

## The reference batches

Every type has one, and `batches/hatsugen_choukai_J2_001.source.json` was the
first: ten 発言聴解 items written by hand. Not every item has to come out of a
model, and the first batch of a new type deliberately does not — that is how you
find out what the generator is supposed to be aiming at. Each of the other eight
types has six, written the same way, exercising every distractor role in its
enum, which is the thing a generator most needs an example of. 88 items in total.

They run through exactly the same validation and the same whole-batch checks as
generated items; the only thing they skip is the model call:

```bash
bjt importbatch batches/hatsugen_choukai_J2_001.source.json
```

It stays in the repo afterwards as the regression set (`tests/test_batch_checks.py`):
if a check starts failing these ten items, the check changed, not the items.

Every committed bundle is held to that regression set, not just the first one —
`batches/*.json` is swept rather than named, so a new batch is covered the moment
it lands.

Three invariants only exist *across* bundles, and all three became breakable the
moment there was a second batch, so they are tested over the whole library:

* **No seed cell is spent twice.** Reusing a cell is worse than a repeated
  question — `item_id` is a hash of (item type, cell), so the second item
  silently replaces the first on publish and the library shrinks without saying
  so.
* **Item ids are unique.** `bjt publish` upserts on id; a collision is data loss.
* **The dedupe threshold holds across bundle boundaries.** Two batches can each
  be internally varied and still ask the same question. A learner meets the
  library, not a bundle.

They are original compositions, **not** official BJT material — no past-paper text
is ever copied into this repository.

---

## The nightly job

The practice queue promises to spread a set across problem types, to serve three
levels, and to slip in one item from the level above. Every one of those promises
is empty when the library is 40 items of one type at one level and six of
everything else: **a queue cannot interleave what is not there.** So the bank has
27 shelves — nine problem types × three levels — and the nightly job's whole
objective is to fill the emptiest one first.

```
$ bjt plan
The bank, shelf by shelf (items published / seed cells left)

  bamen_haaku         J3   0 / 335     J2   6 / 329     J1   0 / 335    ←thin
  goi_bunpou          J3   0 / 451     J2   6 / 445     J1   0 / 451    ←thin
  hatsugen_choukai    J3  20 / 390     J2  10 / 400     J1  10 / 400    ←thin
  ...

  88 item(s) published; 16 empty shelf/shelves, 26 below 12; 7439 seed cell(s) left.

Work order — 24 item(s), emptiest shelf first

   2 × bamen_haaku J1   (has 0, 335 cell(s) left)
   2 × bamen_haaku J3   (has 0, 335 cell(s) left)
   ...
```

The algorithm is one sentence — *give the next item to the shelf with the fewest
items, skipping any shelf that is out of seed cells or has had its share of this
run* — and it is plain on purpose. It is **deterministic**, so a night's work can
be reviewed before it is made; it **converges**, levelling the shelves instead of
deepening whichever type is easiest to generate; and it **stops**, because a
shelf whose seed table is exhausted drops out. "Will we run out of questions?"
becomes a number this command prints.

Two caps keep a night reviewable by a person: `--budget` for the whole run, and
`--per-slot` for any one shelf. Without the second, a single run can write thirty
items of one type — one big risk instead of four small ones, and a diff nobody
finishes.

What the planner deliberately does **not** do is look at individual learners.
Targeting one person with a generation run costs money per person, puts a profile
into a prompt, and cannot be reviewed before it is served. Weakness targeting
happens in the *queue*, over a bank that is already published, where it is free
and reversible. The nightly job only makes sure the queue has something to choose
from.

### What runs, and when

`.github/workflows/nightly.yml` has two halves, and the first needs nothing:

* **the survey** — `bjt plan` into the run summary, every night, offline. This is
  the half that tells you sixteen shelves are empty.
* **the writing** — `bjt nightly`, then the whole-bundle sweep, then a pull
  request. It runs only when `ANTHROPIC_API_KEY` and `SEEDS_TAR_B64` are both
  set. Generation without the licensed few-shot material would fill the bank with
  the wrong thing, quietly, so the absence of seeds stops it rather than
  degrading it.

It also runs one statement against the production database when
`SUPABASE_DB_URL` is set: `refresh_item_stats()`, which recounts how often each
item is answered correctly across all learners. That is the other half of the
night — measure the bank, then grow it where it is thin.

**Nothing here publishes.** The job writes bundles and the SQL for them and opens
a pull request. A branch that exists to be read before it lands is the review
gate the roadmap asks for, not a way around the repository's work-on-`main`
rule — and the merge is the decision to ship: once `checks` is green on `main`,
the **deploy database** workflow runs by itself and publishes the items and
their audio together.

---

## The database

`supabase/migrations/` holds the whole schema. A few things in it are worth
knowing before reading the SQL.

**Content is world-readable; everything personal is owner-only.** The item
library has a `select` policy for `anon` and `authenticated` and no write policy
at all — publishing runs as the service role, from a laptop, which is why no key
that can write content ships in the app. Every per-user table is restricted to
`auth.uid()`, and the stats views are `security_invoker` so they inherit that
rather than needing their own.

**Grading is a trigger.** `attempts` takes `item_id` and `chosen_index` from the
client and fills in the rest: who it was, whether it was right, and
`chosen_role` — *which* trap caught them. That last column is the point. "You get
発言聴解 wrong 40% of the time" is a grade; "eleven times this month you pointed
尊敬語 at yourself" is a plan for the evening, and it is what weakness-targeted
generation will eventually select on. There is no `update` or `delete` policy on
`attempts`: an answer already given is history, and rewriting it would quietly
corrupt the profile built from it.

**The level is per section, and that is the single biggest thing the app does
for a score.** The exam reports three numbers — 聴解, 聴読解, 読解 — and the total
is their sum. Almost nobody is the same at all three: reading is studied,
listening is not, and the gap between somebody's 読解 and their 聴解 is usually
the largest single fact about them. One level for the whole learner was therefore
wrong twice for nearly everybody — too easy where they were strong, too hard
where they were not — and being bored and being drowned are the two ways a drill
stops raising a score.

`section_levels` holds three levels and `adjust_level()` moves each on the same
rule, counted inside that section: ten answers to begin with and twenty once
there is a record, 80% right moves it up, 40% or fewer moves it down. A learner
can sit at 読解 J1 and 聴解 J3 at once, which describes a great many people
studying for this exam. Nobody is asked anything; there is still nothing to
choose. `profiles.target_level` survives as the one-line summary — the middle of
the three — and no longer decides anything.

Three and not nine, because a nine-way level is unusable: at five items a day a
single problem type sees about one answer every two days, so it would need a
month to move once. Three is what the score report uses, and it moves on about a
week. The finer grain is the pitch, below, which needs no threshold at all.

**`next_items()` is the practice queue, in one round trip — and it takes a size
and nothing else.** The set is built from the record, because the learner decides
nothing. Four buckets, in this order:

| | | |
|---|---|---|
| 0 | **due** | items the spacing ladder says are due today, most overdue first, at any level. Capped at two fifths of the set, so a backlog after a week away cannot crowd out everything new. |
| 1 | **fresh** | unseen items at their section's level, weakest ground first, spread across problem types and settings. |
| 2 | **stretch** | exactly one unseen item from the level above, taken from the section they are **strongest** in — a probe is worth most where a promotion is closest. `adjust_level()` ignores it, so it can never cost one. |
| 3 | **the rest** | everything else at their level, then the adjacent levels, so a thin level still fills a set instead of ending it early. |

"Weakest ground" is four things, and every one of them is arithmetic you can
check by hand.

* **The 機能 tag they score worst on**, smoothed and aged. Smoothed because a
  single miss on a tag used to read as 0% and drag the whole set onto it: the
  rate is `(right + 1) / (answered + 2)`, which starts a new tag at 50% and needs
  real evidence to move. Aged because a habit broken in March is not today's
  weakness — every answer carries a 30-day half-life, so last week counts about
  five times what last quarter does.
* **The traps that keep catching them.** `attempts.chosen_role` knows *how* they
  go wrong, not just that they do, so an unseen item containing a distractor
  whose role has caught this person before is pulled forward — capped, so one bad
  habit cannot take over a whole set. The correct option is excluded from that
  match, or items would be ranked by how often the learner answered *correctly*.
* **Which section is weakest.** A 機能 tag is orthogonal to the score report —
  依頼 appears in listening and in reading alike — so a weak section was invisible
  to it. The set now leans toward the weak one by up to a tenth of a point:
  enough to tilt it, not enough to abandon the other two thirds of the exam.
* **The pitch — how hard the item should be for *this* learner, at *this* problem
  type.** The bank knows how often each item is answered correctly by everybody
  (below); the queue prefers items near a target, and the target slides:

  ```
  target = 0.85 − (your accuracy at this problem type) × 0.33,  held in [0.50, 0.80]
  ```

  Someone at 90% on 発言聴解 is handed items the bank answers right 55% of the
  time. Someone at 30% is handed ones it answers right 75% of the time. **Good at
  something means harder questions in it; bad at something means gentler ones** —
  and unlike the level, this needs no threshold and no waiting. It moves on every
  single answer.

And two nudges for variety, which are the reason a set of five drawn from a
library that is 40% one problem type is not five of that type: the second item of
a type in one set is pushed back, the third further, and the same for 場面 at a
third of the weight. Enough to lose to any other type that is close; not enough
to serve nothing when only one type is published.

The terms sit in a deliberate order of authority — the 機能 tag dominates, traps
and the pitch are comparable second, the variety nudges third, and the tie-break
random is a fiftieth of a point, so it can only ever separate two items that were
genuinely level. Getting that order wrong is not a style question: with the noise
at a twelfth of a point, as it briefly was, it outvoted the pitch on exactly the
early sets where the pitch is the only signal there is.

There used to be a manual mode (`free`, `mock`) that served one chosen type at
one chosen level. It is gone, along with the screen that asked for it.

**The spacing ladder is a trigger.** `review_schedule` holds one row per
(learner, item): when it is next worth meeting, and which rung of a five-rung
ladder it is on — 20 hours, 3 days, 1 week, 3 weeks, 2 months. A right answer
climbs a rung; a wrong one drops all the way to the bottom, because a trap you
still fall for after three weeks is a trap you have not learned. It is a fixed
table of intervals rather than a fitted forgetting curve on purpose: a curve
needs calibration these items do not have, and "tomorrow, then in three days,
then in a week" is a promise a learner can hold the app to. The client cannot
write it — same rule as `attempts`, for the same reason.

**The bank is shared, and it gets better as people use it.** `item_stats` counts
how often each item is answered correctly across *every* learner;
`refresh_item_stats()` recomputes it out of hours, as the service role, never on
the path of somebody waiting for five questions. The queue prefers items near a
target success rate, because too easy teaches nothing and so does too hard.

Two things guard that, and both matter:

* **It is a property of the question, not of a person.** There is no IRT model
  behind it, nothing is derived from it about anybody's ability, and it is never
  displayed. The rule stands: no estimated BJT score, anywhere.
* **The raw counts are not readable by a client.** With a handful of users,
  "answered 1, correct 0" is a statement about a person. `item_stats` has RLS on
  and no policy; what clients can read is `v_item_difficulty`, which only exists
  above eight answers.

An item nobody has answered yet has no measured rate, and that is the common case
the day a batch ships. So a rate measured at generation time travels with the
item — `items.model_p_correct`, written by `bjt publish` — and serves as the
prior until the bank has counted. It is the difficulty probe's pass rate (a
weak model sitting the full view several times; `bjt/fidelity/difficulty.py`)
when the probe ran, and the answerability gate's own full-view rate otherwise.
It is null for the hand-written reference batches, which are the one path that
skips both, and the queue reads null as "no opinion" rather than as "average".

**Every one of those levels is a trigger.** Nobody is asked whether they are J2;
nobody could answer. All three sections start there, and `adjust_level()` moves
the one this answer belongs to, on the last ten answers in that section at that
section's level to begin with and the last twenty once there is a record. The
window is counted per section too, so forty answers of listening do not make the
app more cautious about a learner's reading. The stretch item is at the level
above, so it is excluded from the count and can never cost a promotion.

Weakness-targeted *selection* works today over a fixed library. Weakness-targeted
*generation* is the nightly job's business, and it aims at the bank's empty
shelves rather than at any individual.

### Checking it

```bash
supabase/test/run.sh
```

Applies every migration to a throwaway Postgres — no project, no keys, no network
— and asserts what the schema promises: that one user cannot read another's
history, that a client cannot claim its own answer was right or grant itself the
paid unlock, that an item whose answer points at no option is rejected, that a
published bundle applies twice without duplicating, that a client cannot move its
own review dates, set its own level, or read the bank's raw per-item counts, that
a wrong answer drops an item to the bottom rung of the ladder and a right one
climbs it, that being good at listening moves the 聴解 level and leaves 読解 where
it was, that two learners with opposite records on the same problem type are
handed opposite items out of the same pair, and that a fresh anonymous user can
pull a real set of five — spread across problem types — and have it land on the
radar.

It finishes by reading every query in `client/src/lib` and asserting each table,
view, column and function the app names actually exists. TypeScript can only
check the app against the types we *claim* the database has; this checks the
claim.

---

## Seeds (`seeds/` — gitignored)

Licensed and authoritative material never gets committed. It loads at runtime
from `seeds/`:

```bash
cp -r seeds.example seeds
```

| Path | Contents |
|---|---|
| `seeds/fewshot/<type>.json` | 3-5 official-style examples **with their 解説** and per-option `why`. |
| `seeds/official/<type>.json` | Official sample items (with the answer marked) for `discriminate` / `calibrate`. |
| `seeds/vocab/business_terms.txt` | The 重要ビジネス用語表現集 list, one term per line. |
| `seeds/vocab/jlpt_n5_kanji.txt` … `n1` | Kanji per tier (any whitespace-separated). |
| `seeds/levels.json` | The official CAN-DO descriptors per level. |

Everything degrades gracefully when a seed is missing — the tool tells you what's
absent in `bjt quality` rather than failing.

**`seedtable/` is different and is committed**: it is our own design, contains no
licensed text, and is the thing you edit to grow the library.

---

## Layout

```
bjt/
  generators/    one module, prompt, and schema per item type
  publish.py     bundle → idempotent SQL
  fidelity/      roles, sanity check, answerability gate, difficulty probe, discriminator loop, vocab gate, dedupe
  tts/           what to synthesise, in which voice, over which channel — and the
                 offline job that does it (plan.py, synth.py, channel.py, providers.py)
  scenes.py      what the scene bank needs, and what exists
  render/        document data → semantic HTML, and the eight templates
  db/            SQLite store + schema
  seedtable.py   場面×関係×機能×レベル → cells
  plan.py        which shelf of the bank is emptiest, and tonight's work order
                 (not tts/plan.py, which decides what to synthesise)
  batch.py       batch runs, the bundle format, the whole-batch checks
  schemas.py     item JSON schema + validation
  levels.py      CAN-DO descriptors (loadable from seeds)
  llm.py         Anthropic client wrapper (structured output only)
  cli.py         entry point
seedtable/       the axes — committed
batches/         bundles, their published SQL, and the reference batch — committed
seeds.example/   committed templates; real content goes in gitignored seeds/
supabase/
  migrations/    schema, RLS, stats views, the selection RPC
  test/          run.sh — the whole schema, proved against a throwaway Postgres
client/          the Expo app (see client/README.md)
```

## Design notes

- **Structured output only.** Every model call uses `output_config.format` with an
  explicit JSON schema; free text is never parsed.
- **One generator per item type.** No generic "generate a BJT question" function
  with a type parameter — item shapes differ too much.
- **Variety comes from the seed table, not the prompt.** Every one of the nine
  types refuses to generate without a cell (`requires_cell`), so nobody can
  accidentally fall back to asking a prompt to be interesting.
- **The cell is an assignment, not a hint.** If the model substitutes a different
  scene or channel, the item is rejected and regenerated.
- **Documents are data, not images.** The model emits structured
  JSON and we render it; no image model for anything with text in it.
- **Option order is shuffled** at generation time so the correct answer is never
  positionally predictable — and `checkbatch` verifies it across the batch.

## Naming

"BJT" is a registered trademark. It is used here to describe the exam format this
tool targets; it is not part of any product name, slug, or bundle identifier — the
app is 「ビジネス日本語ドリル」. A store description may say it follows the BJT
format; the name may not.

No past-paper text is copied anywhere in this repository. Every item is an
original composition, which is why generation was a requirement from the start
rather than a convenience.
