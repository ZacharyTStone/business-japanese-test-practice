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
  roadmap asks for, and it is the one exception to the rule above.
- **Variety comes from `seedtable/`, never from prompt wording.** 発言聴解 refuses
  to generate without a seed cell (`requires_cell`).
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
  history.
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
- **Testers only, for now, and the database is the door.** `public.testers`
  lists who may use the app by the email they sign in with (email and password
  today; Google later, matched on the same email); `is_tester()` reads the JWT; every row-level policy in `public` requires it and the anon role holds
  nothing. A schema test asserts every policy names it, so a policy added
  without it fails CI. The client's gate screens only say so politely. The
  owner asked for this (2026-09-17); opening the app later is one migration
  that drops the conjunct, and the anonymous-first client path comes back in
  front of the door. Never add a policy, view or RPC that answers a
  non-tester while this holds.
- **The one screen that explains any of this is the start screen**
  (`client/src/ui/welcome.tsx`), shown once on first launch. Everything else
  gets on with serving questions. If a feature needs explaining somewhere else
  in the UI, that is evidence the feature does not belong.
- **"BJT" is a registered trademark.** It may describe the exam format in prose.
  It may not appear in the product name, slug, or bundle identifier.
- **No past-paper text, ever.** Every item is an original composition.
- **`seeds/` is gitignored** (licensed material). `seedtable/` and `batches/` are
  committed (our own design and output).

## Language

Reply to the owner in simple Japanese, whatever language the request arrives in.
Code, comments, commit messages and this file stay in English.
