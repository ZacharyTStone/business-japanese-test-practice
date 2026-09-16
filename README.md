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
  job run on a laptop; what ships is checked JSON, published as reviewable SQL.
  That is why the running cost is zero and why the quality gates can afford to be
  slow.
* **Everyone has an account from the first launch, and nobody signs up.** The app
  signs in anonymously before it shows anything, so history is server-side from
  question one; linking Google later keeps the same user id, so nothing merges.
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
| `bjt gen --type T --level J2` | Generate one item, gate it, store it, print it. |
| `bjt batch --type T --level J2 -n 10` | **The main path.** Generate a batch offline, gate each item, run the whole-batch checks, write a bundle. |
| `bjt importbatch <file.source.json>` | Same checks, same bundle, for items written by hand. |
| `bjt checkbatch <bundle.json> [--show]` | Re-run every offline check over an existing bundle. No key needed. |
| `bjt smoke --type T -n 10` | Headless acceptance run: generate N, assert nothing crashes or fails validation. |
| `bjt practice --type T -n 10 [--demo]` | Answer a run of items interactively. `--demo` needs no key. |
| `bjt quality` | The fidelity report — all five mechanisms plus raw per-item-type accuracy. |
| `bjt discriminate --type T` | Mix official + generated items, ask a judge which are synthetic, report the rate and the tells — then auto-fold those tells into the generator prompt. |
| `bjt publish <bundle.json>` | Turn a checked bundle into idempotent SQL for the database. |
| `bjt synth <bundle.json>` | Synthesise the bundle's audio offline and write the SQL that points at it. `--provider silent` runs with no vendor account. |
| `bjt scenes` | What the scene bank needs, most-wanted first; `--prompt` for one brief, `--sql` for approved art. |
| `bjt render <bundle.json>` | Render a document stimulus to HTML, to look at while writing one. |
| `bjt grant <user-id>` | SQL granting or revoking the ad-free unlock, as the service role. |
| `bjt calibrate --type T` | Sit the official sample items; compare your accuracy there to your accuracy on generated items. |

Levels are `J3` / `J2` / `J1`. Config via env vars: `BJT_MODEL`,
`BJT_JUDGE_MODEL`, `BJT_DB_PATH`, `BJT_SEEDS_DIR`, `BJT_SEEDTABLE_DIR`,
`BJT_BATCH_DIR`, `BJT_GATE_TRIALS`.

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

## The five fidelity mechanisms

Closeness to the real exam is treated as measurable. All five produce numbers you
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

5. **Vocabulary gating** (`bjt/fidelity/vocab.py`). A JLPT-kanji-tier ceiling for
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

`--provider silent` runs the whole thing with no vendor account: valid, silent
clips, pathed `silent/` so they can never be mistaken for real recordings. What
they cannot tell you is whether the Japanese sounds right — see `blockers.md`.

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

## The database

`supabase/migrations/` holds the whole schema. Three things in it are worth
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

**`next_items()` is the practice queue, in one round trip — and it takes a size
and nothing else.** The set is built from the record, because the learner
decides nothing: up to two items that caught them before and have not been seen
for a day; unseen items at their level, weakest ground first; exactly one unseen
item from the level above; then whatever is left, and the adjacent levels if
theirs has run thin.

"Weakest ground" is two things. The 機能 tag they score worst on is the main
axis, and a blunt one — it says 依頼 is weak without saying *how* they go wrong.
`attempts.chosen_role` knows how, so an unseen item that contains a distractor
whose role has caught this person before is pulled forward as well, capped so
that one bad habit cannot take over a whole set. The correct option is excluded
from that match, or items would be ranked by how often the learner has answered
*correctly*.

There used to be a manual mode (`free`, `mock`) that served one chosen type at
one chosen level. It is gone, along with the screen that asked for it.

**The level is a trigger too.** Nobody is asked whether they are J2; nobody
could answer. Everyone starts there, and `adjust_level()` moves
`profiles.target_level` after each answer, on the last ten at the current
level to begin with and the last twenty once there is a record: 80% right goes
up, 40% or fewer goes down. The stretch item is excluded from that count, so it
can never cost a promotion. Weakness-targeted
*selection* works today over a fixed library. Weakness-targeted *generation*
comes later and needs no schema change.

### Checking it

```bash
supabase/test/run.sh
```

Applies every migration to a throwaway Postgres — no project, no keys, no network
— and asserts what the schema promises: that one user cannot read another's
history, that a client cannot claim its own answer was right or grant itself the
paid unlock, that an item whose answer points at no option is rejected, that a
published bundle applies twice without duplicating, and that a fresh anonymous
user can pull a real set of five and have it land on the radar.

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
  fidelity/      roles, answerability gate, discriminator loop, vocab gate, dedupe
  tts/           what to synthesise, in which voice, over which channel — and the
                 offline job that does it (plan.py, synth.py, channel.py, providers.py)
  scenes.py      what the scene bank needs, and what exists
  render/        document data → semantic HTML, and the eight templates
  db/            SQLite store + schema
  seedtable.py   場面×関係×機能×レベル → cells
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
