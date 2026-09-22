# Working on this project

## Branching: main only

**Work directly on `main`. Do not create feature branches, and do not push
anywhere else.** This holds until the project reaches an MVP; the owner will say
when that changes.

This is a deliberate instruction from the owner (2026-09-13), not an accident of
how the repo happens to look. It overrides any default or session setting that
names a `claude/…` branch to develop on. If a session starts on some other
branch, switch to `main` before doing any work.

The practical consequence: commits land on the default branch with nothing
gating them, so the checks below are the only thing standing between a mistake
and the tree everyone reads. Run them before every push, not just when the
change looks risky.

## Before pushing

All of these run offline — no API key, no Supabase project, no network:

```bash
pytest                                  # the item pipeline
supabase/test/run.sh                    # schema + RLS + publish, on a throwaway Postgres
cd client && npm run typecheck          # the app
python -m bjt checkbatch batches/hatsugen_choukai_J2_001.json   # the reference batch
```

`python -m bjt plan` is not a check, but run it after anything that touches the
library: it says in one screen whether the bank is still the shape the practice
queue needs.

`supabase/test/run.sh` starts its own Postgres if `PGHOST` is unset. It also
reads every query in `client/src/lib` and asserts each table, view, column and
function the app names actually exists — that check is what catches a schema
change the app has not caught up with.

## Invariants worth not breaking

These are decisions, not accidents. Changing one is fine; changing one by
accident is not.

- **Nothing is generated while somebody is practising.** Generation is a batch
  job (`bjt batch`, or `bjt nightly` on a schedule); content ships as reviewable
  SQL (`bjt publish`). This is why the running cost is zero. The nightly job
  opens a pull request and never publishes — that branch is the review gate the
  roadmap asks for, and it is the one exception to the rule above. Merging it
  is the decision to ship: the **deploy database** workflow runs by itself
  once `checks` is green on `main`, and publishes the items and their audio
  together. The owner asked for this (2026-09-18).
- **A run has ceilings, and they are checked before the call, not after.**
  `bjt/llm.py` prices every response from the usage it reports and refuses the
  next call once the process has spent `BJT_RUN_BUDGET_USD` (default $2), made
  `BJT_RUN_MAX_CALLS`, or run for `BJT_RUN_MAX_MINUTES` (30); no call may ask for more than
  `BJT_MAX_TOKENS_CEILING` output or think above `BJT_EFFORT_CEILING`; a night
  is clamped to `BJT_NIGHT_MAX_BUDGET` / `_PER_SLOT` whatever the workflow input
  says; the job has a clock; and the night's files are an artifact before any
  push. Whether a night runs is decided by these and by `main` alone — never by
  the state of any other branch (the owner, 2026-09-19).
  They are independent on purpose, so a bug in one is caught by another. Two
  manual runs on 2026-09-18 spent $26 in three hours and shipped nothing; that
  morning is why. Raising a ceiling is fine; removing one, or moving the check
  after the call, is not.
- **Variety comes from `seedtable/`, never from prompt wording.** 発言聴解 refuses
  to generate without a seed cell (`requires_cell`).
- **The gate sees the whole stimulus, and the cold view withholds the half the
  type is testing.** The full view carries every document and every turn of
  the dialogue; the cold view shows a document type its document without the
  audio, a dialogue type its question without the conversation, 総合読解 its
  question without the passage, and the stem-only types their options alone
  (`bjt/fidelity/answerability.py`). That is how "the answer needs both the
  document and the audio" is enforced rather than asked for. Until 2026-09-19
  the full view was the narration alone and the gate selected for exactly the
  items the README forbids. Trials stop as soon as the verdict is settled;
  the verdict is by count over the planned trials, so stopping early never
  changes it.
- **A rejected draft's reason is told to the next draft on that shelf.** The
  gate, the proofreader and the dedupe check each say why in one sentence
  and `run_batch` passes it on; a shelf's second and third drafts are not
  written blind. A draft with a fifth option is trimmed, not regenerated.
- **Reading items are written every night.** The work order hands the first
  `--reading-min` (3) items to the emptiest reading shelves before the
  emptiest-first rule sees the rest; they need no audio and no picture. The
  owner asked for this (2026-09-19). A type in `plan.NIGHT_TYPE_CAPS` (画像把握:
  one) never takes more than its allowance a night, however empty its shelves.
- **The database grades answers, not the app.** The client posts `item_id` and
  `chosen_index`; a trigger fills in who, whether it was right, and which
  distractor role caught them. Never add client-side grading that writes.
- **The level is per exam section, and it is three levels, not one.**
  `section_levels` holds 聴解 / 聴読解 / 読解 separately and `adjust_level()` moves
  the one an answer belongs to, on a window counted inside that section. A
  learner can be 読解 J1 and 聴解 J3 at once, which is most people.
  `profiles.target_level` is only the one-line summary (the middle of the three)
  and must never be what decides which questions are served.
- **Good at something means harder questions in it, and vice versa.** Inside a
  level the queue aims at `target = 0.85 − (accuracy at this problem type) ×
  0.33`, held in [0.50, 0.80], against the bank's measured success rate. This is
  the fine grain the three-way level cannot give; it moves on every answer.
  It runs on `items.model_p_correct`, which is written at generation time or
  never — so an item that reached the bank through `bjt importbatch` has none,
  and with none the term falls back to a constant and sorts nothing. On
  2026-09-22 that was 142 of 146 items, i.e. the pitch was off across almost
  the whole library while looking like it was on. `bjt probe <bundle>` is the
  catch-up pass (same weaker model, same trials, only the items with no rate,
  and it writes nothing when it cannot measure — a fabricated prior is worse
  than none, because the queue would trust it), and `bjt plan` now prints the
  coverage so the gap cannot go quiet again.
- **The ranking terms have an order of authority, and it matters.** The 機能 tag
  dominates; traps and the difficulty pitch are comparable second; the
  type/場面 variety nudges are third; the tie-break random is a fiftieth of a
  point and may only separate genuine ties. Raising the noise above the pitch
  silently disables the pitch on exactly the early sets where it is the only
  signal there is.
- **One bank, shared by everybody; fixed SQL does the sorting.** Every learner
  draws from the same published library — what is personal is the order, and it
  is decided by arithmetic in `next_items()` that a person can read and check.
  The model's contribution is attached to the item *before* it ships (the seed
  cell's tags, the distractor roles, `model_p_correct`); it is never consulted at
  practice time, and never per learner.
- **The spacing ladder is fixed and stated.** Five rungs — 20 hours, 3 days, 1
  week, 3 weeks, 2 months. Right climbs one; wrong drops to the bottom. A right
  answer that took more than two minutes holds its rung rather than climbing. A
  fitted forgetting curve needs calibration these items do not have, and the app tells
  the learner the intervals on the start screen, so they are a promise rather
  than an implementation detail.
- **`item_stats` is not readable by a client, and `review_schedule` is not
  writable by one.** The first because raw per-item counts over a handful of
  users are a statement about a person (`v_item_difficulty` is the k-anonymous
  surface, floor of eight); the second for the same reason `attempts` has no
  update policy.
- **`items.model_p_correct` is a property of the question, never of a person.**
  It is how often a model answered the item correctly at generation time: the
  difficulty probe (a weaker model, `BJT_DIFFICULTY_MODEL`) when it ran, else
  the answerability gate. It is not an ability estimate, nothing about anybody
  is derived from it, and it is never displayed.
- **`attempts` has no update or delete policy.** An answer already given is
  history. The one statement in the schema that removes one is
  `reset_my_progress()`, and it is shaped so that it cannot be anything else:
  no arguments, the user read from the session, and the whole history or none
  of it — answers, sessions, the spacing schedule, the review notes and the
  three section levels. A policy would open the door to "delete the ones I got
  wrong", which is the thing not to have; a settings button that erases
  everything is not that. Settings, entitlements and item reports are not
  progress and are left alone. The owner asked for a way to start again
  (2026-09-20).
- **A printed number is written with digits, and the whole screen agrees.** A
  booking grid headed 「十時〜十二時」 or a quotation for 「数量二百個」 is
  grammatical and is not what comes off an office printer; kanji numerals
  belong to vertical prose and to the names of things (第一会議室, 第三回, 一覧).
  `bjt/render/numerals.py` holds the rule, `batch.normalise_numerals` applies
  it wherever an item enters a bundle, the document schema quotes it to the
  generator, and an offline check re-runs the converter and fails a bundle it
  can still move. It covers the 資料 *and* the printed options, stem and 解説 of
  a document type, because 資料聴読解 offers 「七十点」 as an answer to a figure
  read off a table and two notations for one number is arithmetic instead of
  reading. Anything `bjt/tts/plan.py` synthesises is untouched — a clip id
  hashes its text, and a live clip is never re-made — which is why a narrated
  stem still reads 「三時から」. All 41 documents in the bank were kanji until
  2026-09-22, because nothing said so and nothing checked. The owner asked for
  this (2026-09-22). The converter only moves a number with a counter after it,
  which is what keeps it off 一覧 and 第一会議室 — so it cannot see 「×十二の」 or
  「三百から二百を引いて」, where nothing follows the number. Widening it would
  cost 「二、三日」 and 「一覧」, so instead `numerals.mixed_notation` reports a
  sentence carrying both notations and the batch check warns. A warning, not a
  failure: only a reader can tell 「二案」 (a count) from 「案二」 (a label).
- **The discriminator sees what the learner sees.** `render_for_discriminator`
  carries the 資料 and the 会話, not just the stem and the options; without them
  the headline fidelity metric was rating 状況把握, 資料聴読解, 総合聴読解 and
  総合読解 — 55 of the exam's 80 questions — on a fragment of their stimulus,
  which is how a library of textbook-looking documents went unnoticed. The
  matching half is that `run_discriminator` refuses a comparison where our
  items carry a stimulus the official samples lack: `bjt discriminate` folds
  the judge's stated tells back into the generator prompt, so a tell about
  `seeds/official/` not having the 資料 transcribed would teach the generator to
  stop writing documents.
- **画像把握 is the one type whose picture is the question, and its item is not
  served until the picture exists.** The generator writes an English
  `image_brief` with the four descriptions; the scene job draws it, one picture
  per item under `pic_<item id>`, and refuses a draft unless a reviewer shown
  the picture and the four descriptions picks the marked one every time
  (`bjt/scene_art.py`). `item_types.needs_picture` makes `next_items()` hold
  the item back until `scenes.image_path` is set. Every other type keeps
  shipping without a picture. A picture refused `BJT_SCENE_LIFETIME_ATTEMPTS`
  times over its life (the bucket's `rejected/` ledger remembers) is given up
  on; a bank scene in that state shows its stand-in (`scenes.STAND_INS`), a
  per-item picture's item stays unserved. The owner asked for the type, rare
  and with pictures that are clear and not generic (2026-09-19).
- **Spoken formulas are spelled one way.** `bjt/phrasebook.py` shows the
  spoken types the stock lines in the wording the library already has a clip
  for, so 「少々お待ちください。」 is one file rather than five. A nudge, never a
  quota: a distractor that must be wrong in a particular way is still written
  fresh.
- **The voice is OpenAI, the cast is by role, and a live clip is never
  re-made.** `bjt/tts/providers.py` records the provider as `DEFAULT` and the
  seven roles as `VOICE_IDS`; a learner who hears a different voice every
  question is doing speaker identification instead of listening to Japanese,
  so neither follows whichever key happens to be set. The owner chose OpenAI
  (2026-09-18). Recast a role before its clips are live or not at all.
- **No ads during practice.** `AdSlot`'s placement type has exactly two members,
  so this is enforced by the type checker. Do not widen it.
- **No estimated BJT score, anywhere.** There is no IRT calibration for generated
  items; an invented number is worse than none. The level shown on screen is
  the level the app is *serving*, which is a fact, not a prediction.
- **The learner chooses nothing about the questions.** No level picker, no
  section or problem-type picker, no difficulty, no mode, no mock — anywhere in
  the UI. `next_items()` takes a size and reads everything else from the record;
  `adjust_level()` moves the level on the evidence of the answers, and the set
  slips in one item from the level above. The owner asked for this (2026-09-16):
  all the thinking happens behind the scenes, and the app's whole job is to
  raise a score rather than to offer a study menu.
  There are two exceptions and they are both on the same side of one line.
  `profiles.timed_reading`, below, decides whether the reading questions are
  counted down; `profiles.daily_goal`, on the one account whose
  `testers.max_daily_goal` says the size is theirs, decides how long a sitting
  is. `next_items()` has never heard of the first and takes the second only as
  a size, deciding *which* items entirely from the record either way. A setting
  about *how you practise* is not a setting about *what you are served*, and
  that is the line — anything that would change which item comes next belongs
  on the wrong side of it.
- **The set is shaped like the exam, and so is the bank.** The exam asks 80
  questions in a fixed proportion — 聴解 25, 聴読解 25, 読解 30, and inside those
  場面把握 5 / 発言聴解 10 / 総合聴解 10, 状況把握 5 / 資料聴読解 10 / 総合聴読解
  10, 語彙・文法 10 / 表現読解 10 / 総合読解 10. That count lives in one place
  twice: `public.item_types.exam_questions` and `bjt.schemas.EXAM_QUESTIONS`,
  which a test holds equal. The nightly planner fills the shelf furthest behind
  its **share** rather than the shelf with fewest items, and `next_items()`
  carries a section term so a set of ten leans 3 / 3 / 4 rather than however the
  weakness arithmetic happens to fall. The owner asked for the app to mirror the
  exam more closely (2026-09-19).
- **The reading questions are timed, at the exam's own pace.** 聴解 and 聴読解
  advance with the audio and the candidate makes no pacing decision; 読解 is 30
  questions in a freely-navigable 30-minute block, so pacing is a skill and the
  app was not teaching it. `item_types.seconds_per_item` divides that block —
  30 / 45 / 105 seconds, which is 1800 for ten of each, exactly the block — and
  `client/src/lib/pace.ts` scales a type's budget by how much a *particular*
  item has to read (`typical_chars`), clamped so one freak item cannot hand out
  four minutes. A question nobody answers in time is recorded as one nobody
  answered: `attempts.chosen_index = -1`, graded wrong, role `timed_out`. The
  owner asked for this (2026-09-19). A schema test holds the three budgets to
  summing to the exam's block, which is the part not to break.
- **第1部 speaks its options.** All three 聴解 types read their four candidates
  aloud rather than printing them — the exam shows the picture and the bare
  numerals, and in 総合聴解 shows nothing at all. `TYPE_AUDIO` in
  `bjt/tts/plan.py` and `SPOKEN_OPTION_TYPES` in the practice screen must agree.
  An item whose option clips do not exist yet falls back to printed options on
  its own, so this ships progressively rather than all at once.
- **A spoken option is introduced by its letter.** 「エー」「ビー」「シー」「デー」
  play before the four candidates, because the screen shows nothing but the
  badges while they run and four unlabelled sentences is a memory test rather
  than a listening one. D is 「デー」 and not 「ディー」: the four differ only in
  their onset, and 「ビー」/「ディー」 are a voiced stop apart — the pair that
  actually gets misheard, as it was (2026-09-20). 「デー」 is the reading
  Japanese uses when a letter has to survive a telephone, and it moves the
  vowel too. They are four clips for the whole library, not four per
  item — `OPTION_LABELS` in `bjt/tts/plan.py`, in the narrator's voice and in
  room tone whatever the item's channel is, found by the app on the same four
  strings (`OPTION_LETTERS` in `client/src/lib/db.ts`, which a test holds
  equal). All four or none: before they are synthesised the run is what it
  always was. The owner asked for this (2026-09-20).
- **A report is a report; a veto is the decision.** `public.item_feedback` takes
  one row per person per item — a fixed reason and an optional sentence — and
  nothing in the queue reads it. A reported item keeps being served until
  somebody looks: "a tester pressed a button" is not a review, and an item that
  vanishes on one press is a bank one press away from empty. The reasons are a
  closed set on purpose, because a count is something the generator loop can
  act on and prose is not.
  The owner is not a tester in this respect. Reviewing the bank means meeting a
  bad question in the app, and the useful moment to remove it is that moment, so
  `veto_item()` unpublishes it there and then — for everybody, at once, from
  inside the practice screen. The owner asked for this (2026-09-22). What keeps
  the paragraph above true is who may press it: `testers.may_veto` is false on
  every row by default (`bjt tester <email> --veto` sets it), `may_i_veto()`
  decides whether the button is drawn, and `veto_item()` re-checks it rather
  than trusting the client that drew it. It is an unpublish and never a delete,
  so every attempt, review rung and report already pointing at the item keeps
  resolving — a learner's history does not develop holes because the owner
  disliked a question afterwards. Nothing is recorded against the learner
  either: vetoing happens instead of answering, so no `attempts` row is written
  and the day's ten is not spent. `public.item_vetoes` keeps who and when.
- **Ten a day, fifteen at most, and the database counts.** The daily set is
  `profiles.daily_goal` (default 10, never above 15, never chosen in the app).
  After it one bonus set is offered; at fifteen answers in a Japanese calendar
  day `next_items()` returns nothing and the app shows the done screen
  (`client/src/ui/done.tsx`). `v_my_day` is the one row both read. A tester
  row with `unlimited = true` lifts the ceiling for that account alone
  (`bjt tester <email> --unlimited`); it is for exercising the app, not for
  studying. The owner asked for this (2026-09-18).
  **One account may size its own day**, and it is one number rather than a
  second ceiling: `testers.max_daily_goal` (null on every row but the owner's,
  `bjt tester <email> --max-goal 60`) is that account's own fifteen — the
  largest set it may choose *and* the point its day stops, which is what the
  fifteen has always been, written once instead of twice. `my_daily_max()` is
  the number `v_my_day` and `next_items()` read, so the door is per account
  rather than a constant, and `v_my_day.goal_max` — null for everybody else —
  is what draws the field on the account screen, so no screen carries a copy of
  the fifteen. The check constraint on `daily_goal` is only a hard hundred: the
  per-account bound is a trigger on `profiles`, because a constraint cannot ask
  who is writing and without the trigger any tester could PATCH their own row
  past the ceiling and it would be advisory. The trigger judges a goal being
  *written*, never a row that already exists, so lowering the number later does
  not freeze the rest of the profile. The owner asked for this (2026-09-22).
- **Testers only, for now, and the database is the door.** `public.testers`
  lists who may use the app by the email they sign in with (email and password
  today; Google later, matched on the same email); `is_tester()` reads the JWT; every row-level policy in `public` requires it and the anon role holds
  nothing. A schema test asserts every policy names it, so a policy added
  without it fails CI. The client's gate screens only say so politely. The
  owner asked for this (2026-09-17); opening the app later is one migration
  that drops the conjunct, and the anonymous-first client path comes back in
  front of the door. Never add a policy, view or RPC that answers a
  non-tester while this holds.
  There is a second lock in front of the first: an address that is not already
  on the list cannot get an account at all. `refuse_unlisted_signup()` is a
  `before insert` trigger on `auth.users` that refuses the auth service's own
  connection (GoTrue is `supabase_auth_admin`, which is the path open to the
  internet) unless `public.testers` already names the address; an anonymous
  sign-in carries no address and is refused by the same sentence. An empty
  list therefore means nobody can sign up, which is where a fresh project
  starts. A migration, a fixture or the owner with the service role is
  unaffected, because a check the owner has to switch off to do ordinary work
  is a check that ends up switched off. The owner asked for this (2026-09-21):
  the app takes no new users while it is a work in progress. Reading nothing
  and not existing are different things, and both are wanted.
- **The one screen that explains any of this is the start screen**
  (`client/src/ui/welcome.tsx`), shown once on first launch. Everything else
  gets on with serving questions. If a feature needs explaining somewhere else
  in the UI, that is evidence the feature does not belong.
- **"BJT" is a registered trademark.** It may describe the exam format in prose.
  It may not appear in the product name, slug, or bundle identifier.
- **No tell a learner can pass the type on.** `check_bundle` asserts the
  correct option is not systematically the longest or the shortest, but per
  bundle — and a bundle is two to six items, so a habit running through a whole
  type is invisible to it. 総合読解 reached 7 of 10 that way (the correct answer
  was the fully-specified one and the distractors were terse), which is a 70%
  pass mark for reading nothing. The sweep that catches it is over the library,
  per type, in `tests/test_batch_checks.py`, because the library is what a
  learner meets. The fix is to specify the distractors, never to trim the
  answer.
- **No past-paper text, ever.** Every item is an original composition.
- **`seeds/` is gitignored** (licensed material). `seedtable/` and `batches/` are
  committed (our own design and output).

## Language

Reply to the owner in simple Japanese, whatever language the request arrives in.
Code, comments, commit messages and this file stay in English.
