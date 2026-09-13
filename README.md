# BJT Practice — the item pipeline

Generates practice items in the format of the **BJT ビジネス日本語能力テスト**
(Business Japanese Proficiency Test), checks them hard, and writes them to a JSON
bundle. This repository is the *content pipeline*; the study app is a separate
thing that ships the bundles it produces.

**Nothing is generated while somebody is practising.** Generation is a batch job
run here, on a laptop, and what ships is plain JSON plus an audio manifest. That
is what keeps the running cost of the app at zero, and it is also why the quality
gates can afford to be slow and expensive — they run once per item, before
anything is published.

Item types built so far:

| Type | What it is | State |
|---|---|---|
| `hatsugen_choukai` | **発言聴解** — a narrated situation, four spoken utterances, pick the one that fits | the type the whole pipeline is being proved on |
| `goi_bunpou` | 語彙・文法 — one blank, four fillers | built (text only) |
| `hyougen` | 表現読解 — a situation, four expressions | built (text only) |

発言聴解 goes first on purpose: it exercises every hard part at once — 敬語
direction, ウチ/ソト, telephone protocol, a reused scene image, and TTS. Whatever
it needs is what the images, the audio, and the app's review screen have to
provide, so getting it right settles the shape of everything after it.

---

## Quick start

Everything except live generation runs offline, with no API key:

```bash
pip install -e ".[dev]"
python -m bjt checkbatch batches/hatsugen_choukai_J2_001.json --show   # read the reference batch
python -m bjt seedtable --sample 5                                     # what would be written next
python -m bjt selftest                                                 # validation + DB round-trip
pytest
```

For live generation:

```bash
pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...      # or put it in .env — see .env.example
bjt init
bjt batch --type hatsugen_choukai --level J2 -n 10
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

4. **Genre templates** (phase 2). For 総合読解 — not built yet;
   `seeds/genre_templates/` is where the real business-document templates go.

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

### Audio (`bjt/tts/plan.py`)

No audio is synthesised here — this module only decides *what* to synthesise. Two
decisions are encoded:

- **Voices are cast by role, not per item.** A learner who hears a different voice
  every question is doing speaker identification instead of 敬語, so the voice
  follows from the seed cell's 関係 and stays fixed across the whole library.
- **Clip ids are content hashes** of (voice, channel, text). 「かしこまりました。」
  appears in dozens of items and is synthesised once; re-running a batch re-uses
  every clip whose text didn't change.

The narrator stays clean even on a telephone item — the narrator is outside the
scene. Only the utterances get the band-limited phone treatment, because business
phone Japanese really is harder to hear than studio audio, and an item about a
phone call that sounds like a studio recording is easier than the real thing.

### Images

Items name a `scene_id` from a small shared bank (16 scenes so far), never a
per-item picture. The seed table decides which bank entries a setting may use, so
a batch's scene list is known before any image exists. Text, names, and numbers
are deliberately **not** part of the artwork — they are overlaid, so one drawing
serves many items and nothing is at the mercy of a model's handwriting.

---

## The reference batch

`batches/hatsugen_choukai_J2_001.source.json` is ten 発言聴解 items written by
hand. Not every item has to come out of a model: the first batch of a new type is
written by hand because that is how you find out what the generator is supposed
to be aiming at. It runs through exactly the same validation and the same
whole-batch checks as generated items — the only thing it skips is the model
call:

```bash
bjt importbatch batches/hatsugen_choukai_J2_001.source.json
```

It stays in the repo afterwards as the regression set (`tests/test_batch_checks.py`):
if a check starts failing these ten items, the check changed, not the items.

They are original compositions, **not** official BJT material — no past-paper text
is ever copied into this repository.

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
  fidelity/      roles, answerability gate, discriminator loop, vocab gate, dedupe
  tts/           what to synthesise, in which voice, over which channel (no audio calls)
  render/        phase 2 (document → HTML/SVG) — stub
  db/            SQLite store + schema
  seedtable.py   場面×関係×機能×レベル → cells
  batch.py       batch runs, the bundle format, the whole-batch checks
  schemas.py     item JSON schema + validation
  levels.py      CAN-DO descriptors (loadable from seeds)
  llm.py         Anthropic client wrapper (structured output only)
  cli.py         entry point
seedtable/       the axes — committed
batches/         generated bundles + the hand-written reference batch — committed
seeds.example/   committed templates; real content goes in gitignored seeds/
```

## Design notes

- **Structured output only.** Every model call uses `output_config.format` with an
  explicit JSON schema; free text is never parsed.
- **One generator per item type.** No generic "generate a BJT question" function
  with a type parameter — item shapes differ too much.
- **Variety comes from the seed table, not the prompt.** 発言聴解 refuses to
  generate without a cell (`requires_cell`) so nobody can accidentally fall back
  to asking a prompt to be interesting.
- **The cell is an assignment, not a hint.** If the model substitutes a different
  scene or channel, the item is rejected and regenerated.
- **Documents will be data, not images** (phase 2). The model emits structured
  JSON and we render it; no image model for anything with text in it.
- **Option order is shuffled** at generation time so the correct answer is never
  positionally predictable — and `checkbatch` verifies it across the batch.

## Naming

"BJT" is a registered trademark. It is used here to describe the exam format this
tool targets; it is not part of any product name.
