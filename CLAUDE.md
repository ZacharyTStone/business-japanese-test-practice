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

`supabase/test/run.sh` starts its own Postgres if `PGHOST` is unset. It also
reads every query in `client/src/lib` and asserts each table, view, column and
function the app names actually exists — that check is what catches a schema
change the app has not caught up with.

## Invariants worth not breaking

These are decisions, not accidents. Changing one is fine; changing one by
accident is not.

- **Nothing is generated while somebody is practising.** Generation is a batch
  job (`bjt batch`); content ships as reviewable SQL (`bjt publish`). This is why
  the running cost is zero.
- **Variety comes from `seedtable/`, never from prompt wording.** 発言聴解 refuses
  to generate without a seed cell (`requires_cell`).
- **The database grades answers, not the app.** The client posts `item_id` and
  `chosen_index`; a trigger fills in who, whether it was right, and which
  distractor role caught them. Never add client-side grading that writes.
- **`attempts` has no update or delete policy.** An answer already given is
  history.
- **No ads during practice.** `AdSlot`'s placement type has exactly two members,
  so this is enforced by the type checker. Do not widen it.
- **No estimated BJT score, anywhere.** There is no IRT calibration for generated
  items; an invented number is worse than none.
- **"BJT" is a registered trademark.** It may describe the exam format in prose.
  It may not appear in the product name, slug, or bundle identifier.
- **No past-paper text, ever.** Every item is an original composition.
- **`seeds/` is gitignored** (licensed material). `seedtable/` and `batches/` are
  committed (our own design and output).

## Language

Reply to the owner in simple Japanese, whatever language the request arrives in.
Code, comments, commit messages and this file stay in English.
