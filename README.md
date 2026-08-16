# BJT Practice — phase 1

A personal study tool that generates practice items for the **BJT ビジネス日本語能力テスト**
(Business Japanese Proficiency Test). Single user, local, no auth, no deployment.

**Phase 1 scope:** two pure-text item types —
**語彙・文法問題** (`goi_bunpou`) and **表現読解問題** (`hyougen`).
Audio, images, and the seven other item types are out of scope for now.

The tool generates an item, runs it through five fidelity checks, lets you answer
it, and shows you the 解説 plus *why each wrong option is a trap*. Items, your
answers, and every fidelity metric persist to SQLite.

---

## Quick start

From a clean checkout:

```bash
pip install -e .          # installs the `bjt` command + the anthropic SDK
export ANTHROPIC_API_KEY=sk-ant-...   # your key; the SDK reads it
bjt init                  # create the DB, print seed-setup instructions
bjt practice --type goi_bunpou --level J2 -n 10
```

No key yet? Everything except live generation runs offline:

```bash
python -m bjt selftest          # validation + DB round-trip, no API
python -m bjt practice --demo -n 4   # answer author-composed sample items
```

(`python -m bjt <cmd>` and `bjt <cmd>` are equivalent.)

---

## Commands

| Command | What it does |
|---|---|
| `bjt init` | Create the SQLite DB and print how to populate `seeds/`. |
| `bjt selftest` | Offline check of schema/role validation and the DB (no key). |
| `bjt gen --type T --level J2 [--no-gate]` | Generate one item, gate it, store it, print it with its 解説 and roles. |
| `bjt practice --type T --level J2 -n 10 [--fast] [--demo]` | Answer a run of items interactively. `--fast` skips the gate; `--demo` uses offline sample items. |
| `bjt quality` | The fidelity report — all five mechanisms plus raw per-item-type accuracy. |
| `bjt discriminate --type T [-n 6]` | Mix official + generated items, ask a judge which are synthetic, report the rate and the tells. |
| `bjt calibrate --type T` | Sit the official sample items; compare your accuracy there to your accuracy on generated items. |

`T` is `goi_bunpou` or `hyougen`. Levels are `J3` / `J2` / `J1`.

Config via env vars: `BJT_MODEL` (generator, default `claude-opus-5`),
`BJT_JUDGE_MODEL` (gate + discriminator judge), `BJT_DB_PATH`, `BJT_SEEDS_DIR`,
`BJT_GATE_TRIALS`.

---

## The five fidelity mechanisms

Closeness to the real exam is treated as measurable. All five produce numbers you
can see in `bjt quality`.

1. **Distractor roles** (`bjt/fidelity/roles.py`). Every option carries a role
   from a fixed per-item-type enum — the *specific reason* it's wrong, the way the
   official 解説 spell it out (e.g. `opposite_valence`, `nonexistent_form`,
   `wrong_honorific_direction`). Items with a duplicate role, a missing role, a
   role outside the enum, or ≠1 correct option are **rejected** before storage.

2. **Two-sided answerability gate** (`bjt/fidelity/answerability.py`). Each item
   is answered by a strong model under two views, three times each:
   - **full** (stem + options) — should *succeed*; failing means the item is
     ambiguous, not hard → discard.
   - **cold** (options only, stem withheld) — should *fail*; succeeding means the
     distractors leak the answer → discard.

   Both success rates are logged per item type.

   *Adaptation:* the brief defines cold as "stem + options, no passage". The
   phase-1 item types have no separate passage, so that would make cold identical
   to full. For these text-only types the meaningful leakage probe is to withhold
   the **stem** and show only the option set — if a strong model can still pick
   the key from the four options alone, the distractors are individually
   implausible and the item leaks. When we add the passage/audio types, cold will
   withhold those instead.

3. **Discriminator loop** (`bjt/fidelity/discriminator.py`). On demand, mix
   official sample items (from `seeds/`) with generated ones and ask a judge model
   to label each. Above-chance discrimination means there's a tell; the judge is
   asked *why*, and its reasons are recorded so you can fold them into the
   generator prompt. The discrimination rate is the headline metric and should
   trend toward 50%.

4. **Genre templates** (phase 2). For 総合読解 — not built yet; `seeds/genre_templates/`
   is where the real business-document templates will go.

5. **Vocabulary gating** (`bjt/fidelity/vocab.py`). A JLPT-kanji-tier ceiling for
   level control, plus a business-term list. The ceiling is enforced for a level
   **only when the tier data up to that ceiling is loaded** (J3→N3, J2→N2, J1→N1);
   with partial data the gate is permissive and says so. This makes it strict at
   lower levels (small, well-defined allowed sets) and permissive at J1 (which
   allows almost all kanji anyway). Tier lists and the business list live in
   `seeds/` because they're authoritative/licensed data.

**No estimated BJT score is ever shown** — we have no IRT calibration for
generated items. `quality` reports raw per-item-type accuracy only. `calibrate`
is the honesty check: if you score much higher on generated items than on the
official samples, the prompts have drifted soft.

---

## Seeds (`seeds/` — gitignored)

Licensed and authoritative material never gets committed. It loads at runtime
from `seeds/`. Copy the templates and fill them in:

```bash
cp -r seeds.example seeds
```

| Path | Contents |
|---|---|
| `seeds/fewshot/<type>.json` | 3-5 official-style examples **with their 解説** (this reasoning is what teaches the model the item shape). |
| `seeds/official/<type>.json` | Official sample items (with the answer marked) for `discriminate` / `calibrate`. |
| `seeds/vocab/business_terms.txt` | The 重要ビジネス用語表現集 list, one term per line. |
| `seeds/vocab/jlpt_n5_kanji.txt` … `n1` | Kanji per tier (any whitespace-separated). |
| `seeds/levels.json` | The official CAN-DO descriptors per level (overrides neutral built-in defaults). |

See `seeds.example/README.md` for the exact item shape and the two accepted
`official` formats. Everything degrades gracefully when a seed is missing — the
tool tells you what's absent in `bjt quality` rather than failing.

---

## Layout

```
bjt/
  generators/    one module per item type (goi_bunpou, hyougen) + shared base
  fidelity/      roles, answerability gate, discriminator loop, vocab gate
  render/        phase 2 (document → HTML/SVG) — stub
  tts/           phase 3 — stub
  db/            SQLite store + schema
  schemas.py     item JSON schema + validation
  levels.py      CAN-DO descriptors (loadable from seeds)
  llm.py         Anthropic client wrapper (structured output only)
  cli.py         entry point
seeds.example/   committed templates; real content goes in gitignored seeds/
```

## Design notes

- **Structured output only.** Every model call uses `output_config.format` with an
  explicit JSON schema; free text is never parsed.
- **One generator per item type.** No generic "generate a BJT question" function
  with a type parameter — item shapes differ too much for a shared prompt.
- **Documents will be data, not images** (phase 2). The model will emit structured
  JSON and we render it; no image model (they mangle kanji).
- **Recent scenarios** are fed back into each generation prompt as a
  do-not-repeat list, so a run of 10 items doesn't loop on three scenarios.
- **Option order is shuffled** at generation time so the correct answer is never
  positionally predictable.
