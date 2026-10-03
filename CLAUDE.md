# Working on this project

## Branching: a pull request into `main`

**Every change reaches `main` through a pull request; nothing is pushed to
`main` directly.** The owner's decision (2026-10-03; until then work went
straight to `main`). Work on the branch the session names, open one pull
request for it, and keep pushing to that branch until it is merged. Merging is
the owner's: a merge to `main` starts the deploys. The checks below are what a
reviewer relies on, so run them before every push, not just when a change
looks risky.

## Before pushing

All of these run offline — no API key, no Cloudflare account, no network:

```bash
npm test                                # the item pipeline (vitest; `npm ci` first, at the root)
npm run typecheck                       # types: a null where a value is needed, a list where a bool is
npm run lint                            # bugs only: a promise nobody awaits, a value never read
cd client && npm run typecheck          # the app, the Worker, its tests
cd client && npm test                   # the pure parts: the practice reducer, the clock, the roles, the Worker's
cd client && npm run test:db            # every Worker query + the schema's promises, on a local D1 with the bank
cd client && npm run lint               # the rules of hooks
node bjt/main.ts checkbatch batches/hatsugen_choukai_J2_001.json   # the reference batch
```

The pipeline is TypeScript run by Node itself (22.18 or later strips the
types; there is no build step): `bjt <command>` in this file means
`node bjt/main.ts <command>`. It was ported from Python on 2026-10-02 and
still writes what the Python wrote, byte for byte — `bjt/py.ts`,
`bjt/pyjson.ts` and `bjt/pyrandom.ts` keep Python's printing, rounding,
JSON and seeded shuffles, because committed bundles, SQL and clip ids depend
on them. Use them rather than JavaScript's own wherever output is written.

`npm test` fails until a generated file is regenerated with the change that
stales it: `node bjt/client_constants.ts` (the app's distractor roles and
tag names, from `bjt/` and `seedtable/`). After anything that touches the
library, run `node bjt/main.ts plan` (not a check) to see whether the bank is
still the shape the queue needs. `npm run test:db` builds a local D1
(Miniflare, the same SQLite D1 runs) the way the deploy builds the real one —
every migration in `d1/migrations`, `d1/triggers.sql`, then every
`batches/*.sql`, twice — and
runs every query the Worker serves the app (`client/worker/queries.ts`) as a
tester (`client/worker/test/queries.db.test.ts`) and the schema's promises
(`schema.db.test.ts`): it fails if a table or column a query names does not
exist, if a write the schema refuses is attempted, if one learner can see
another's rows, if a bundle does not apply twice, or if a query has no case —
the checks that catch a schema change the app has missed.

## Invariants worth not breaking

These are decisions, not accidents. Changing one is fine; changing one by
accident is not.

### Generation and cost

- **Nothing is generated while somebody is practising**, so the running cost is
  zero. Generation is a batch job (`bjt batch`, or `bjt nightly` from the
  **nightly** workflow at 01:17 JST); content ships as reviewable SQL
  (`bjt publish`). A night is very cheap: three items at most, reading first,
  never more than fifty cents (`BJT_RUN_BUDGET_USD` and the `max_usd` default in
  `nightly.yml`, both pinned at or below 0.5 by `tests/ceilings.test.ts`). A
  manual run can ask for the difficulty probe (`bjt probe --all`) instead. The
  nightly job opens a pull request — the night's record, and the one pull
  request nobody merges by hand — then runs the whole `checks` workflow on that branch and, only
  when every job is green and `main` has not moved meanwhile, merges it and
  starts the **deploy database** workflow itself (a merge made with the
  workflow's own token starts no other workflow). The owner stopped reviewing
  nightly content by hand on 2026-10-02: the gate, the proofreader, the batch
  checks and `checks` are the review. A red check leaves the pull request open
  with a comment for a person; nothing from it is live. Otherwise, once
  `checks` is green on `main`, the deploy runs by itself, deploys exactly the
  commit `checks` passed, and publishes the items and their audio together; by
  hand it runs only from `main`.
- **A run's ceilings are checked before the call, not after.** `bjt/llm.ts`
  prices each response from its reported usage (a timed-out request at its
  output ceiling, an unknown model at 15/75 per MTok) and refuses the next
  request once the process — or, with `BJT_SPEND_LEDGER`, the job's bjt steps
  together — has spent `BJT_RUN_BUDGET_USD` (default $2), sent
  `BJT_RUN_MAX_CALLS` requests (retries included; the SDK retries nothing
  itself), or run `BJT_RUN_MAX_MINUTES` (30). No call may ask for
  more than `BJT_MAX_TOKENS_CEILING` output or think above `BJT_EFFORT_CEILING`;
  a night is clamped to `BJT_NIGHT_MAX_BUDGET` / `_PER_SLOT` whatever the
  workflow input says; the job has a clock; the night's files are an artifact
  before any push. Whether a night runs is decided by these and `main` alone,
  never by another branch. They are independent so a bug in one is caught by
  another. Raising a ceiling is fine; removing one, or checking after the call,
  is not.
- **Every run writes reading items.** The first `--reading-min` (1) items go to
  the emptiest reading shelves (no audio or picture needed) before the
  emptiest-first rule sees the rest; their lines come first in the work order,
  so a night its ceiling ends early still has them. A night is three items, two to a shelf at
  most (`plan.DEFAULT_BUDGET` / `_PER_SLOT`, and the nightly workflow's own
  defaults, which must agree), sized to how little the app is used. A type in
  `plan.NIGHT_TYPE_CAPS` (画像把握: one) never exceeds its nightly allowance,
  however empty its shelves.
- **A shelf that writes nothing rests.** A shelf the generator cannot write
  stays furthest behind its share, so every night would go back to it: from
  2026-09-28 three nights spent their budget on the same three shelves and
  wrote nothing. Each night records what each shelf did — `written` or
  `missed` — as an empty marker under `nightly/shelves/` in the media bucket
  (`bjt/shelf_rest.ts`; the Worker serves only `audio/` and `scenes/`). After
  `BJT_SHELF_REST_AFTER` (3) misses in a row the work order passes the shelf
  over for `BJT_SHELF_REST_DAYS` (7) after its last miss, then tries it once
  more; one written night clears it. A night stopped by a ceiling or the
  account records nothing for that shelf. The bucket is the memory, not a
  branch, and it decides only *which* shelves, never *whether* a night runs; a
  ledger that cannot be read rests nothing.

### Writing and checking items

- **Variety comes from `seedtable/`, never from prompt wording.** 発言聴解 refuses
  to generate without a seed cell (`requires_cell`). Seed tables only grow; a
  test holds every committed item's cell to its table.
- **ウチ/ソト is a relation a batch can aim at.** `uchi_to_soto` (speaking to an
  outsider about one's own people) is cast in `staff_to_client`'s voice, so no
  role is recast; a test requires every relation to have a voice.
- **The gate sees the whole stimulus; the cold view withholds the half the type
  tests** (`bjt/fidelity/answerability.ts`). Full view: every document and every
  dialogue turn. Cold view: a document type's document without the audio, a
  dialogue type's question without the conversation, 総合読解's question without the
  passage, a stem-only type's options alone. This enforces "the answer needs
  both the document and the audio" (a narration-only full view selects exactly
  the items the README forbids). Trials stop once the verdict is settled; the
  verdict is by count over the planned trials, so stopping early never changes
  it. A trial the judge did not answer ends the gate as `unchecked`: never
  kept, and nothing passed to the next draft.
- **A rejected draft's reason goes to the next draft on that shelf.** The gate,
  the proofreader and the dedupe check each give one sentence and `runBatch`
  passes it on, so a shelf's second and third drafts are not written blind. A
  draft with a fifth option is trimmed, not regenerated, and the 解説 sentences
  that quote the trimmed option go with it (`dropSentencesAbout`) — left in,
  they cost the draft at the proofreader as `explanation_mismatch`. The prompt
  asks for exactly four options and says at least one role goes unused, since
  every type offers four or more.
- **No optional field in a generation schema** but `scene_id`. Optional fields
  are what grow the API's compiled grammar: the chart's four took the 総合聴読解
  schema past it, and from 2026-09-28 every request was refused "Schema is too
  complex" before a token was written. A document block requires every field
  and sends the unused ones empty; `render.dropUnusedFields` strips them as
  the draft arrives, so nothing downstream sees the padding. A test holds the
  document types to it.
- **A distractor is wrong the way people are wrong.** Over-politeness is wording
  people really use somewhere more formal, or a 二重敬語 people really say — never
  an invented stack (させていただかせていただく is the commonest).
  `bjt/fidelity/naturalness.ts` holds the rules: every generator is told them
  (`PROMPT`); a draft tripping the mechanical half (invented keigo, a 〇〇
  placeholder, brackets in something heard, a 場面把握 narration that says the
  answer) is sent back with the reason; the proofreader has `unnatural_japanese`
  and `situation_incoherent`; `checkBundle` fails any served item with a tell,
  so a committed one is withdrawn or CI fails. 語彙・文法's `nonexistent_form` is the
  one deliberate non-word and is exempt. Widen a pattern only against a line
  from a real item, adding the line that must still pass beside it
  (`tests/naturalness.test.ts`).
- **No tell a learner can pass a type on.** `checkBundle` asserts the key is
  not systematically the longest or shortest option, but a bundle is two to six
  items, so a habit across a whole type (e.g. a fully-specified key among terse
  distractors) needs the per-type library sweep in `tests/batch_checks.test.ts`
  — the library is what a learner meets. Fix it by specifying the distractors,
  never by trimming the answer.
- **The discriminator sees what the learner sees.** `renderForDiscriminator`
  carries the 資料 and the 会話, not just stem and options; otherwise 状況把握, 資料聴読解,
  総合聴読解 and 総合読解 (55 of the exam's 80 questions) are rated on a fragment.
  Conversely, `runDiscriminator` refuses a comparison where our items carry a
  stimulus the official samples lack: `bjt discriminate` folds the judge's tells
  back into the generator prompt, and a tell about `seeds/official/` lacking a
  transcribed 資料 would teach it to stop writing documents.
- **A chart is data, and every reader sees its figures.** Only templates with
  `charts=True` (`figures`, `progress_report`) carry one, one per document.
  `document.textOf` writes each figure beside its label for the gate, the
  proofreader, the probe and the discriminator; the app prints every bar's
  figure, and a line is asked about by its shape; the unit is exempt from the
  numeral rule (else 千円 becomes 1000円); a block type the app does not draw fails
  a test.
- **A printed number is written with digits, and the whole screen agrees.**
  「十時〜十二時」 or 「数量二百個」 is not what comes off an office printer; kanji numerals
  belong to vertical prose and to names (第一会議室, 第三回, 一覧).
  `bjt/render/numerals.ts` holds the rule; `batch.normaliseNumerals` applies it
  wherever an item enters a bundle; the document schema quotes it to the
  generator; an offline check re-runs the converter and fails a bundle it can
  still move. It covers the 資料 *and* a document type's printed options, stem and
  解説: when 資料聴読解 offers 「七十点」 for a figure read off a table, two notations for
  one number make it arithmetic instead of reading. Anything `bjt/tts/plan.ts`
  synthesises is untouched — a clip id hashes its text, and a live clip is never
  re-made — so a narrated stem still reads 「三時から」. The converter only moves a
  number with a counter after it: that spares 一覧 and 第一会議室 but misses 「×十二の」 and
  「三百から二百を引いて」. Widening it would cost 「二、三日」 and 「一覧」, so
  `numerals.mixedNotation` reports a sentence with both notations and the batch
  check warns — not fails, since only a reader can tell 「二案」 (a count) from 「案二」
  (a label).
- **`items.model_p_correct` is a property of the question, never of a person**:
  how often a model answered the item correctly at generation time — the
  difficulty probe (a weaker model, `BJT_DIFFICULTY_MODEL`) when it ran, else
  the answerability gate. With `BJT_DIFFICULTY_MODEL=jev-…` (a prototype,
  opt-in, `bjt/jev.ts`) it is instead the probability Jev puts on the key in one
  call — a different number, so the bank carries one kind, not a mixture; read
  `bjt probe --compare` before switching. It is not an ability estimate, nothing
  about anybody is derived from it, and it is never displayed.

### Pictures and audio

- **画像把握's picture is the question, so its item is not served until the picture
  exists.** The type is rare; its pictures must be clear and not generic. The
  generator writes an English `image_brief` with the four descriptions; the
  scene job draws one picture per item under `pic_<item id>` and refuses it
  unless a reviewer shown the picture and the four descriptions picks the marked
  one every time (`bjt/scene_art.ts`). `item_types.needs_picture` makes
  the queue hold the item back until `scenes.image_path` is set; every
  other type ships without a picture. A picture refused
  `BJT_SCENE_LIFETIME_ATTEMPTS` times over its life (the bucket's `rejected/`
  ledger remembers; a reader that gave no answer is an error, never a refusal,
  and the job checks the run's ceilings before every image) is given up on: a bank scene then shows its stand-in
  (`scenes.STAND_INS`); a per-item picture's item stays unserved.
- **The voice is OpenAI, cast by role, and a live clip is never re-made.**
  `bjt/tts/providers.ts` records the provider as `DEFAULT` and the seven roles
  as `VOICE_IDS`, and neither follows whichever key is set: a different voice
  every question turns listening into speaker identification. Recast a role
  before its clips are live or not at all. `bjt synth --upload` requires
  `--have` and never uploads over a file already in the bucket, except the ids
  `--remake` names; such a file is counted live.
- **Spoken formulas are spelled one way.** `bjt/phrasebook.ts` shows the spoken
  types the stock lines in the wording the library already has a clip for, so
  「少々お待ちください。」 is one file, not five. A nudge, never a quota: a distractor that
  must be wrong in a particular way is still written fresh.
- **第1部 speaks its options.** All three 聴解 types read their four candidates
  aloud instead of printing them, as the exam does (the picture and bare
  numerals; in 総合聴解, nothing). `TYPE_AUDIO` in `bjt/tts/plan.ts` and
  `SPOKEN_OPTION_TYPES` in `client/src/lib/playlist.ts` must agree. An item without its
  option clips yet falls back to printed options, so this ships progressively.
- **A spoken option is introduced by its number.** 「いち」「に」「さん」「よん」 play before
  the four candidates: only the badges are on screen, and four unlabelled
  sentences test memory, not listening. Numbers, not letters (「ビー」/「ディー」 are
  confused, 「デー」 sounds like "day"; いち / に / さん / よん share no sound), and the
  badges say 1–4 everywhere, as the exam's answer sheet does. Four clips serve
  the whole library, not four per item: `OPTION_LABELS` in `bjt/tts/plan.ts`, in
  the narrator's voice and room tone whatever the item's channel, found by the
  app on the same four strings (`OPTION_LABELS` in `client/src/lib/db.ts`, which
  a test holds equal). All four or none: until they are synthesised the run is
  unchanged.

### The practice queue

- **One bank, shared by everybody; fixed SQL does the sorting.** Only the order
  is personal, decided by arithmetic in the queue (`client/worker/core/queue.ts`) that a person can read
  and check. The model's contribution (the seed cell's tags, the distractor
  roles, `model_p_correct`) is attached *before* the item ships, and never
  consulted at practice time or per learner.
- **The database grades answers, not the app.** The client posts `item_id` and
  `chosen_index`; the Worker's INSERT fills in who, whether it was right, and
  which distractor role caught them, from the item, and a trigger refuses any
  other grade. Never add client-side grading that writes.
- **The learner chooses nothing about the questions.** No level, section,
  problem-type, difficulty, mode or mock picker, anywhere in the UI: the
  thinking happens behind the scenes, and the app's job is to raise a score, not
  to offer a study menu. The queue takes a size and reads everything else
  from the record; `nextLevel()` (`core/levels.ts`) moves the level on the evidence of the
  answers; the set slips in one item from the level above. A setting about *how
  you practise* is allowed; anything that would change *which item comes next*
  is not. The two allowed: `profiles.timed_reading` (whether reading questions
  are counted down; the queue has never heard of it) and
  `profiles.daily_goal` on the one account whose `testers.max_daily_goal` says
  the size is theirs (how long a sitting is; the queue takes it only as a
  size). `profiles.exam_date` is a fact about the learner, not a choice, and the
  record reads it: every due date is brought in ahead of it, and in its last two
  weeks the set follows the exam's section mix strictly (a full point per item
  beyond a section's share rather than a quarter) and the reading clock runs
  whatever `timed_reading` says.
- **The level is per exam section: three levels, not one.** `section_levels`
  holds 聴解 / 聴読解 / 読解; `nextLevel()` moves the one an answer belongs to, on a
  window counted inside that section, so a learner can be 読解 J1 and 聴解 J3 at
  once (most people are). `profiles.target_level` is only the one-line summary
  (the middle of the three) and must never decide what is served. The window is
  ten first attempts at the level (twenty once the section has a record), never
  more than the questions the level has left for this learner, never judged on
  fewer than five; nobody moves into a level with fewer than five questions left
  to meet (most shelves hold fewer than ten, and a learner must be able to leave
  one). An answer after a replay or with the spoken options read counts for
  neither direction: the exam plays once. `levelEvidence()` is the one
  definition `nextLevel()` and `myLevels()` share.
- **Good at something means harder questions in it, and vice versa.** Inside a
  level the queue aims at
  `target = 0.85 − (accuracy at this problem type) × 0.35`, held in [0.50,
  0.80], against the bank's measured success rate (a fixed 0.33 could never
  reach its own floor). This is the fine grain the three-way level cannot give;
  it moves on every answer. It runs on `items.model_p_correct`, written at
  generation time or never: an item from `bjt importbatch` has none, and then
  the term is a constant that sorts nothing while looking on. `bjt probe --all`
  is the catch-up pass (same weaker model, same trials, only unrated items, a
  bundle at a time so a run stopped by its ceiling resumes); it writes nothing
  when it cannot measure, because the queue would trust a fabricated prior.
  `bjt plan` prints the coverage so the gap cannot go quiet.
- **The ranking terms have an order of authority.** The 機能 tag dominates; traps
  and the difficulty pitch are comparable second; the type/場面 variety nudges are
  third; the tie-break random is a fiftieth of a point and may only separate
  genuine ties. Noise above the pitch silently disables it on the early sets
  where it is the only signal.
- **The set is shaped like the exam, and so is the bank.** The exam's 80
  questions: 聴解 25 (場面把握 5 / 発言聴解 10 / 総合聴解 10), 聴読解 25 (状況把握 5 / 資料聴読解 10 /
  総合聴読解 10), 読解 30 (語彙・文法 10 / 表現読解 10 / 総合読解 10), held in
  `item_types.exam_questions` (d1/migrations) and `EXAM_QUESTIONS` in `bjt/schemas.ts`, which a
  test holds equal. The nightly planner fills the shelf furthest behind its
  **share**, not the one with fewest items, and the queue carries a section
  term so a set of ten leans 3 / 3 / 4.
- **A due review is a new question, never the same one while a new one exists.**
  The same four sentences test whether the learner remembers "it was 3"; the
  exam asks the trap again in a situation they have not seen. The ladder
  schedules the *lesson* an item taught. A due lesson is re-tested by an unseen
  question of the same type that carries the trap which caught the learner as a
  wrong option (or, for a lesson learnt without being caught, shares its 機能): a
  類題, served by the queue with `stands_for` naming the lesson. The answer
  moves that lesson's rung and starts no lesson of its own; `validStandsFor()` (`core/grade.ts`)
  clears a `stands_for` the queue could not have served. Misses are served
  first, each lesson taking the best question no earlier lesson took. Every
  unseen question, at any level, comes before any repeat.
- **The spacing ladder is fixed and stated:** five rungs, 20 hours, 3 days, 1
  week, 3 weeks, 2 months. Right climbs one; wrong drops to the bottom and
  remembers the trap. A question known at first sight (right, in time, unaided)
  starts on the three-day rung. A right answer holds its rung when slow — timed
  from when it could be answered (`attempts.think_ms`), over the reading clock's
  own maximum for a reading type (`PACE_MAX_SCALE` in `core/grade.ts`, which a test holds equal
  to `MAX_SCALE` in `pace.ts`) or thirty seconds after the audio ended for a
  listening one — or when helped by a replay or the spoken options. With an exam
  date set, a due date on or after the last two days before it is brought into
  them. No fitted forgetting curve: these items lack the calibration, and the
  start screen tells the learner the intervals, so they are a promise.
- **The reading questions are timed, at the exam's pace.** 聴解 and 聴読解 advance
  with the audio; 読解 is 30 questions in a freely-navigable 30-minute block, so
  pacing is a skill to teach. `item_types.seconds_per_item` divides that block —
  30 / 45 / 105 seconds, 1800 for ten of each — and a schema test holds the
  three to summing to the block; that is the part not to break.
  `client/src/lib/pace.ts` scales a type's budget by how much a *particular*
  item has to read (`typical_chars`), clamped so one freak item cannot hand out
  four minutes. A question nobody answers in time is `attempts.chosen_index =
  -1`, graded wrong, role `timed_out`. In the last two weeks before the exam
  date the clock runs even with `timed_reading` off (`examIsNear` in
  `client/src/lib/exam.ts`, fourteen days, as the queue counts them).
- **Ten a day, fifteen at most, and the database counts.** The daily set is
  `profiles.daily_goal` (default 10, never above 15, never chosen in the app);
  one bonus set follows; at fifteen answers in a Japanese calendar day
  the queue returns nothing, a trigger on `attempts` refuses a sixteenth answer
  (hint `daily_limit_reached`; D1 runs one write at a time, so a second device
  cannot slip past), and the app shows the done screen
  (`client/src/ui/done.tsx`); `day()` in `core/record.ts` is what the app reads. A tester row
  with `unlimited = true` (`bjt tester <email> --unlimited`) lifts the ceiling
  for that account alone, for exercising the app, not for studying. **One
  account may size its own day**, with one number rather than a second ceiling:
  `testers.max_daily_goal` (null on every row but the owner's;
  `bjt tester <email> --max-goal 60`) is that account's own fifteen — the
  largest set it may choose *and* where its day stops. `dailyMax()` is the
  number `day()`, the queue and the trigger read, so the door is per account;
  `day().goal_max` (null for everybody else) draws the field on the account
  screen, so no screen copies the fifteen. The `daily_goal` check constraint
  says only that a day is at least one question; the per-account bound is
  `updateProfile()` (`core/profile.ts`), because a constraint cannot see who is
  writing: it refuses a change of `daily_goal` on every account whose tester
  row has no `max_daily_goal`, and one above that number on the account that
  has it. It judges a goal being *written*, never an existing row, so lowering
  the number later does not freeze the rest of the profile. **There is no
  invented ceiling on that number** beyond the 16-bit range the Worker reads it
  in: the queue serves only what the published bank has in the learner's level
  window, so a goal of five hundred fetches everything there is, not five
  hundred rows; the bank is the real limit.
- **Every distractor role has its own feedback, and the app's list of roles is
  generated.** `node bjt/client_constants.ts` writes
  `client/src/lib/generated.ts` from `bjt/fidelity/roles.ts` and the seed tables
  (the Japanese name of every tag, for the progress screen); `roles.ts` is a
  `Record` over the generated roles, so a role with no sentence (falling through
  to 「この場面に合わない」) is a type error, and a stale file fails
  `tests/client_constants.test.ts`. Write every verdict out: a label with でした
  glued on is ungrammatical whenever the label ends in a verb. The comprehension
  roles are `manner: false`, and the 失礼度メーター steps aside for them — a misread
  table offends nobody.

### Data and access

- **An answer given is history.** A trigger on `attempts` refuses every update,
  and no query deletes one: a way to delete would open the door to "delete the
  ones I got wrong". The one removal is `resetProgress()` (`core/profile.ts`),
  shaped so it cannot be that: no arguments, the learner read from the session,
  the whole history or none of it — answers, sessions, the spacing schedule,
  the review notes and the three section levels. Settings, entitlements and
  item reports are not progress and are left alone. An answer carries only
  `item_id`, `chosen_index`, `session_id`, `elapsed_ms`, `think_ms`,
  `replays`, `peeked`, `stands_for` from the app — not `answered_at`, which the
  day's door and the ladder both read and the Worker's clock writes. Of its own
  profile the app may change only `display_name`, `daily_goal`, `exam_date` and
  `timed_reading` (`queries.ts` refuses any other field); `target_level` is the
  database's to write.
- **The grade is the item's.** The INSERT computes `is_correct` and
  `chosen_role` from the item and its options (`core/grade.ts`), and the
  `attempts_need_a_live_question` trigger refuses any row whose grade is not
  that, or whose question is not live. The ladder and the level move in the
  same all-or-nothing batch as the answer, so a refused answer moves nothing.
- **`item_stats` is read only by the queue, and `review_schedule` is written
  only by an answer.** Raw per-item counts over a handful of users are a
  statement about a person: no query returns them, and the queue uses a count
  only over eight people or more. `d1/refresh_item_stats.sql` (nightly) counts
  each person's first answer to each question, timeouts left out, recounting
  from nothing, so the floor of eight is eight people and a reset history
  leaves no count behind.
- **`d1/migrations/` is the schema, `d1/triggers.sql` its triggers; the logic
  is TypeScript.** D1 splits a migration into statements on its own side and
  cuts a trigger body at its first semicolon, so triggers never go in a
  migration: the deploy applies `triggers.sql` as a file (drop and create, so
  it is how a trigger change ships). No SQL comment holds a quote or a
  semicolon (a test sweeps them), for the same splitter. What were SQL
  functions and views are `client/worker/core/`, one file per job, and they
  were checked step by step against the SQL they replaced before the move. A
  new migration is a new numbered file, never an edit to one that has been
  applied.
- **The app reaches the database only through the Worker, as the learner.**
  `client/worker/` serves the web build, `/api/q/<name>` and `/media/*` on one
  origin. The app names a query in `client/worker/queries.ts` and passes its
  arguments; it never sends SQL, a table or a column list, and a new screen's
  query is a new entry there (with its case in `test/queries.db.test.ts`).
  Every query filters on the caller's own id; a query that could read another
  learner's row is a bug the database tests exist to catch. Who the caller is
  comes from the Worker's own sign-in (`client/worker/auth.ts`: Better Auth on
  the same D1, Google only, decided 2026-10-03): a session cookie it signed,
  or from a phone the same signed token as `Authorization: Bearer` (an
  unsigned one is refused), never a header the client could forge; looked up
  by address in D1. A phone gets its token by handing the Worker a Google ID
  token for the Web client, from Credential Manager
  (`client/modules/google-sign-in`, the app's only native code), keeps it in
  SecureStore, and sends no cookies (`client/src/lib/phoneSession.ts`). Answers carry the cookies Better Auth sets, so a session
  in use is renewed. Only the routes the app uses (`OPEN_ROUTES`) answer, all
  rate-limited; the rest are 404. The `auth_*` tables keep sign-in state only
  — no Google tokens, photo, IP address or browser — and the state of a
  sign-in in progress lives in a cookie, so a stranger's tries write nothing.
  While
  Cloudflare Access still stands in front of the site, the token Access signs
  (`Cf-Access-Jwt-Assertion`, checked by `client/worker/access.ts` against the
  team's keys and the app's AUD tag) is accepted after a session
  (`client/worker/who.ts`), so the switch has no flag day. Neither is a 401
  `signed_out`, not a pass (a Worker with neither configured is a 500
  `sign_in_not_configured`, never a learner who is signed out); the clips and
  pictures are checked the same way.
  Better Auth owns the `auth_*` tables and their shape: migration 0002 is what
  its generator compiles, and a database test fails if it would change. Its
  four settings are Worker secrets; without them there is no sign-in. The clips and pictures are R2 objects under the paths the
  database holds (`client/worker/media.ts`); the pipeline writes them there
  (`bjt/r2.ts`).
- **Testers only, for now, and the Worker is the door.** `testers` lists who
  may use the app by sign-in email (the address Google verified at sign-in,
  matched on the same email). A sign-up from an address the list does not name,
  or one Google has not verified, is refused before Better Auth writes a row,
  and an account whose address has left the list gets no new session
  (`auth.ts`); the refusal's code, `not_on_tester_list`, is what the sign-in
  screen reads, and any other failure is "try again". Every query from an address not on the
  list is refused before it runs (`client/worker/index.ts`), and the app's gate
  screens only say so politely. A second lock keeps new users out while the app
  is a work in progress: an address not already on the list cannot get an
  account at all — `resolveLearner()` (`core/caller.ts`) makes the account and
  its profile on a listed address's first visit and on nobody else's. An empty
  list means nobody gets in. Opening the app later is dropping the list from
  that door, with a public sign-in in front of it. Never add a query that
  answers a non-tester while this holds. Reading nothing and not existing are
  different things, and both are wanted.

### Removing questions

- **A report is a report; a veto is the decision.** `item_feedback` takes
  one row per person per item (a fixed reason, an optional sentence) and nothing
  in the queue reads it: a reported item is served until somebody looks, since a
  button press is not a review and an item that vanishes on one press leaves the
  bank one press from empty. The reasons are a closed set because the generator
  loop can act on a count and not on prose. The owner, not a tester in this
  respect, removes a bad question the moment it is met: `vetoItem()` (`core/bank.ts`)
  unpublishes it for everybody at once, from inside the practice screen. Who may
  press it keeps the rule above true: `testers.may_veto` is false on every row
  by default (`bjt tester <email> --veto` sets it), `mayVeto()` decides
  whether the button is drawn, and `vetoItem()` re-checks it rather than
  trusting the client. It is an unpublish, never a delete, so every attempt,
  review rung and report pointing at the item keeps resolving. Vetoing happens
  instead of answering: no `attempts` row, and the day's ten is not spent.
  `item_vetoes` keeps who and when.
- **A question leaves the bank through `batches/withdrawn.txt`, never by
  deletion** — the veto made from the repository. Every reference to an item
  is `on delete restrict`, so the database refuses a delete outright. One line per item (id, a
  reason from the closed set `item_feedback` uses, a sentence); `bjt publish`
  writes `is_published = false` into its bundle's SQL, so the merge is the
  decision. The item stays in its bundle: its row keeps answers resolving, and
  its seed cell stays spent (a new item for that cell would hash to the same id
  and inherit the unpublish). Nothing ever sets `is_published` back to true —
  that keeps an in-app veto alive across deploys — so putting one back is a
  hand-written update. Everything that counts the library as a learner meets it
  (`bjt plan`, the phrasebook, the scene job, `bjt synth`, the library sweeps in
  the tests) reads it through `withdrawn.liveItems` / `liveBundle`. A test
  holds the committed SQL to what `bjt publish` writes from the ledger, so a
  line added and not published fails. `bjt importbatch` skips the proofreader
  and the gate; `bjt regate` puts those questions through both after the fact,
  writing each verdict to `batches/regated.txt` as it is reached (so a run
  stopped by its ceiling resumes). A failure is proposed for withdrawal with a
  reason from the same closed set; `--withdraw` may only *append* to
  `withdrawn.txt`, never remove a line or edit a bundle. A verdict marked
  `overruled` in `regated.txt` keeps the question and stops it being proposed
  again.

### Product

- **The one screen that explains any of this is the start screen**
  (`client/src/ui/welcome.tsx`), shown once on first launch. Everything else
  serves questions; a feature that needs explaining elsewhere does not belong.
- **No ads during practice.** `AdSlot`'s placement type has exactly two members,
  so the type checker enforces it. Do not widen it.
- **No estimated BJT score, anywhere.** Generated items have no IRT calibration;
  an invented number is worse than none. The level shown on screen is the level
  the app is *serving* — a fact, not a prediction.
- **"BJT" is a registered trademark.** It may describe the exam format in prose,
  but may not appear in the product name, slug, or bundle identifier.
- **No past-paper text, ever.** Every item is an original composition.
- **`seeds/` is gitignored** (licensed material); `seedtable/` and `batches/`
  are committed (our own design and output).

## Language

Reply to the owner in simple Japanese, whatever language the request arrives in.
Code, comments, commit messages and this file stay in English.
