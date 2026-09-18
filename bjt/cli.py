"""Command-line interface.

Commands
    init          create the database and print seed-setup instructions
    selftest      offline check of validation + DB (no API key needed)
    seedtable     inspect the 場面×関係×機能×レベル table and how much of it is spent
    batch         generate a batch offline into a shippable JSON bundle
    plan          which shelf of the bank is emptiest, and tonight's work order
    nightly       run that work order: generate, gate, check, write the SQL
    checkbatch    run every offline quality check over an existing bundle
    publish       turn a checked bundle into idempotent SQL for the database
    gen           generate one item, gate it, store it, print it
    practice      answer a run of items interactively (--demo needs no key)
    quality       print the fidelity report (mechanisms 1-5)
    discriminate  run the discriminator loop and report the discrimination rate
    calibrate     sit the official sample items and compare accuracy to generated
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import textwrap

from . import batch as batchmod
from . import (
    config,
    fixtures,
    levels,
    plan,
    publish,
    render,
    schemas,
    scenes as scenemod,
    seedtable,
)
from . import llm as llmmod
from .llm import LLMBillingError, LLMError
from .db import Store
from .fidelity import answerability, dedupe, difficulty, discriminator, roles, sanity, vocab
from .generators import GENERATORS, get_generator


# ----- pretty printing ---------------------------------------------------

LETTERS = ["A", "B", "C", "D"]


def _print_item_question(item: dict) -> None:
    print()
    print(f"  [{item.get('item_type','')} · {item.get('level','')}]  {item.get('topic','')}")
    if item.get("speaker_role"):
        chan = {"phone": "電話", "video": "オンライン", "in_person": "対面"}.get(
            item.get("channel", ""), item.get("channel", "")
        )
        print(f"  {item['speaker_role']} → {item.get('listener_role','')}"
              f"（{chan} / {item.get('scene_id','')}）")
    print()
    for line in textwrap.wrap(item["stem"], width=64):
        print(f"  {line}")
    print()
    for i, o in enumerate(item["options"]):
        print(f"    {LETTERS[i]}. {o['text']}")
    print()


def _print_item_answer(item: dict) -> None:
    ci = schemas.correct_index(item["options"])
    print(f"  正解: {LETTERS[ci]}. {item['options'][ci]['text']}")
    print()
    for line in textwrap.wrap(item["explanation_ja"], width=60):
        print(f"  解説  {line}")
    print(f"  EN    {item['explanation_en']}")
    print()
    print("  なぜ各選択肢が罠なのか (distractor roles):")
    for i, o in enumerate(item["options"]):
        if o["role"] == roles.CORRECT:
            continue
        print(f"    {LETTERS[i]}. {o['role']} — {roles.ROLE_DESCRIPTIONS.get(o['role'], '')}")
        for line in textwrap.wrap(o.get("why", ""), width=56):
            print(f"        {line}")
    notes = item.get("vocab_notes") or []
    if notes:
        print("\n  語彙:")
        for n in notes:
            print(f"    {n['term']}（{n['reading']}） — {n['meaning']}")
    print()


# ----- generation + gating -----------------------------------------------

def _generate_and_gate(store, item_type: str, level: str, *, gate: bool, sanity_check: bool = True,
                       cell=None):
    """Generate one item, run every per-item check, persist with metrics.
    Returns (item, item_id, kept: bool, detail: str).

    The order is cheapest-first, and that is the point. The offline vocab check
    costs nothing. The proofreader is one small call. The answerability gate is
    six large ones, and it only runs on an item the first two did not already
    condemn — so a generation that came out broken costs a Haiku call instead of
    six Opus calls, and the gate's budget is spent on items that might survive it.
    The difficulty probe comes last, a few small calls, and only for an item that
    is going to ship: measuring the difficulty of a discarded item buys nothing.
    """
    gen = get_generator(item_type, store)
    if cell is None and gen.requires_cell:
        cell = _next_cell(store, item_type, level)
    item = gen.generate(level, cell=cell)

    vres = vocab.check_item(item, level)
    sres = sanity.run_check(item) if sanity_check else sanity.SanityResult(checked=False)
    gate_verdict = "skipped"
    cold = full = None
    if not sres.ok:
        # No gate for an item with a fault a proofreader can see. Six calls to a
        # strong model cannot repair an explanation that names the wrong option,
        # and this is the whole saving.
        gate_verdict = "discarded:sanity"
    elif gate:
        gres = answerability.run_gate(item)
        cold, full, gate_verdict = gres.cold_success_rate, gres.full_success_rate, gres.verdict
    # A vocab violation (when enforced) is an independent discard reason — it can
    # fail an item the answerability gate passed or skipped.
    if vres.enforced and not vres.ok and not gate_verdict.startswith("discarded"):
        gate_verdict = "discarded:vocab"
    kept = gate_verdict in ("kept", "skipped")

    # The difficulty probe: a weaker model sits the full view a few times, and
    # its pass rate is the difficulty prior. Only for an item that is going to
    # ship — a discarded item's difficulty is nobody's business — and skipped
    # entirely when switched off, which the result says rather than hides.
    dres = difficulty.measure(item) if kept else difficulty.DifficultyResult(
        measured=False, notes="not probed: item discarded")

    item_id = store.insert_item(
        item_type, level, item, config.GEN_MODEL,
        cold_success_rate=cold, full_success_rate=full,
        gate_verdict=gate_verdict, vocab_violations=vres.violations,
    )
    if gate and gate_verdict != "discarded:sanity":
        for t in gres.trials:
            store.record_gate_trial(item_id, t.side, t.trial, t.chosen, t.correct)
    if dres.measured:
        # Only a measurement is worth keeping: the trials of a probe that could
        # not reach its model would read, later, as an item nobody could answer.
        for t in dres.trials:
            store.record_gate_trial(item_id, t.side, t.trial, t.chosen, t.correct)

    # The difficulty prior travels with the item from here: the bundle carries
    # it, `bjt publish` writes it, and the practice queue uses it as the prior
    # for an item nobody has answered yet. It is the probe's rate when the probe
    # ran, and the gate's full-view rate otherwise — the older, coarser number,
    # which is still an honest one. See supabase/migrations/20260916000500 — it
    # is a property of the question and is never shown to anybody.
    if dres.measured:
        item["model_p_correct"] = dres.rate
    elif full is not None:
        item["model_p_correct"] = full

    detail = _gate_detail(cold, full, gate_verdict, vres, sres, dres)
    return item, item_id, kept, detail


def _spent_cells(store, item_type: str) -> set:
    """Every seed cell this item type has already used.

    Two ledgers, unioned. The committed bundles in `batches/` are the
    authoritative one — they are what ships, and they survive a fresh clone. The
    local SQLite database is consulted as well because it holds cells spent on
    items generated but not yet bundled, which exist only on this machine.

    Reading only the database was the bug: it is gitignored, so on a new
    checkout every cell looked free and the next batch re-spent cells the
    library had already used.
    """
    return store.used_cell_ids(item_type) | batchmod.spent_cell_ids(item_type)


def _next_cell(store, item_type: str, level: str):
    """One unused seed-table cell. Raises if the table for this type is exhausted
    — better a clear stop than silently writing the same cell twice."""
    table = seedtable.load(item_type)
    picked = table.sample(1, level=level, exclude_ids=_spent_cells(store, item_type))
    if not picked:
        raise LLMError(
            f"every {item_type} seed cell at {level} has been used; extend "
            f"seedtable/{item_type}.json before generating more"
        )
    return picked[0]


def _sample_cells(store, item_type: str, level: str, n: int) -> list:
    """N unused cells for a run, spread across the axes. Empty list for types
    that do not use a seed table."""
    if not get_generator(item_type).requires_cell:
        return []
    table = seedtable.load(item_type)
    cells = table.sample(n, level=level, exclude_ids=_spent_cells(store, item_type))
    if len(cells) < n:
        raise LLMError(
            f"only {len(cells)} unused {item_type} cell(s) left at {level}; extend "
            f"seedtable/{item_type}.json"
        )
    return cells


def _gate_detail(cold, full, verdict, vres, sres=None, dres=None) -> str:
    bits = []
    if sres is not None and (not sres.ok or not sres.checked):
        bits.append(sres.detail())
    if cold is not None:
        # No full rate for a leaky item: the gate stops at the cold side.
        bits.append(f"cold={cold:.0%} full=" + ("n/a" if full is None else f"{full:.0%}"))
    if dres is not None and (dres.measured or dres.trials):
        # Say which model measured it: a rate from the gate's strong model and a
        # rate from the probe's weak one are not comparable numbers.
        bits.append(dres.detail())
    bits.append(f"verdict={verdict}")
    if vres.enforced and vres.violations:
        bits.append(f"above-band kanji: {' '.join(vres.violations)}")
    # A fault's note, or the reason no check ran. A whole night of
    # "sanity=skipped" with the reason kept to itself is a night nobody can
    # diagnose from the log, which is where the log was read.
    if sres is not None and (not sres.ok or not sres.checked) and sres.notes:
        bits.append(f"({sres.notes[:200]})")
    return "  ".join(bits)


# ----- commands ----------------------------------------------------------

def cmd_init(args) -> int:
    Store().close()  # creates the schema
    print(f"Initialised database at {config.DB_PATH}")
    print(f"Seeds directory: {config.SEEDS_DIR}  (gitignored)")
    print()
    print("To enable full fidelity, populate seeds/ — see seeds.example/ for the format:")
    print("  seeds/fewshot/<type>.json    3-5 official-style examples WITH their 解説")
    print("  seeds/official/<type>.json   official sample items (for discriminate/calibrate)")
    print("  seeds/vocab/*.txt            JLPT kanji tiers + business term list")
    print("  seeds/levels.json            official CAN-DO descriptors per level")
    return 0


def cmd_selftest(args) -> int:
    """Exercise validation, role enforcement, and the DB with no API calls."""
    print("Running offline self-test (no API)...\n")
    ok = True

    # 1. Fixtures validate cleanly.
    for it, item in fixtures.FIXTURES.items():
        errs = schemas.validate_item(it, item)
        print(f"  validate {it}: {'OK' if not errs else 'FAIL ' + str(errs)}")
        ok &= not errs

    # 2. Role validation catches a duplicate role and a bad role.
    bad = [
        {"text": "a", "role": "correct"},
        {"text": "b", "role": "opposite_valence"},
        {"text": "c", "role": "opposite_valence"},   # duplicate
        {"text": "d", "role": "not_a_real_role"},     # outside enum
    ]
    errs = roles.validate_roles("goi_bunpou", bad)
    caught = any("duplicate" in e for e in errs) and any("not in" in e for e in errs)
    print(f"  role validator rejects duplicate + bad role: {'OK' if caught else 'FAIL'}")
    ok &= caught

    # 3. Missing-correct is caught.
    no_correct = [{"text": t, "role": "opposite_valence"} for t in "abcd"]
    errs = roles.validate_roles("goi_bunpou", no_correct)
    caught = any("exactly 1 correct" in e for e in errs)
    print(f"  role validator rejects missing correct option: {'OK' if caught else 'FAIL'}")
    ok &= caught

    # 4. Round-trip through the DB (in-memory).
    import tempfile, os
    tmp = tempfile.mktemp(suffix=".db")
    try:
        store = Store(__import__("pathlib").Path(tmp))
        iid = store.insert_item("goi_bunpou", "J2", fixtures.FIXTURES["goi_bunpou"],
                                "fixture", gate_verdict="skipped")
        store.record_response(iid, schemas.correct_index(fixtures.FIXTURES["goi_bunpou"]["options"]), True)
        acc = store.accuracy_by_type()
        db_ok = bool(store.get_item(iid)) and acc and acc[0]["correct"] == 1
        print(f"  DB insert + response + accuracy round-trip: {'OK' if db_ok else 'FAIL'}")
        ok &= db_ok
        store.close()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    print(f"\nSelf-test {'PASSED' if ok else 'FAILED'}.")
    return 0 if ok else 1


def cmd_gen(args) -> int:
    store = Store()
    try:
        item, iid, kept, detail = _generate_and_gate(
            store, args.type, args.level, gate=not args.no_gate,
            sanity_check=not args.no_sanity,
        )
        if args.json:
            print(json.dumps(item, ensure_ascii=False, indent=2))
        else:
            _print_item_question(item)
            _print_item_answer(item)
        print(f"  #{iid}  {detail}  {'KEPT' if kept else 'DISCARDED'}", file=sys.stderr)
    finally:
        store.close()
    return 0


def cmd_smoke(args) -> int:
    """Headless acceptance harness — the automated 'answer N in a row without a
    crash or a repeated scenario' check. No interaction; asserts every item is
    valid, records the gate verdict spread, and reports scenario repeats."""
    store = Store()
    failures = 0
    topics: list[str] = []
    kept_n = 0
    verdicts: dict[str, int] = {}
    try:
        cells = _sample_cells(store, args.type, args.level, args.n)
        for i in range(args.n):
            try:
                item, iid, kept, detail = _generate_and_gate(
                    store, args.type, args.level, gate=not args.no_gate,
                    cell=cells[i] if cells else None,
                )
                errs = schemas.validate_item(args.type, item)
                if errs:
                    failures += 1
                    print(f"  [{i+1}/{args.n}] INVALID: {errs}")
                    continue
                topics.append(item.get("topic", ""))
                kept_n += int(kept)
                verdict = detail.split("verdict=")[-1].split()[0] if "verdict=" in detail else "?"
                verdicts[verdict] = verdicts.get(verdict, 0) + 1
                print(f"  [{i+1}/{args.n}] ok  topic={item.get('topic','')!r}  {detail}")
            except Exception as e:  # a crash is a hard failure of the DoD check
                failures += 1
                print(f"  [{i+1}/{args.n}] CRASH: {e}")

        distinct = len({t for t in topics if t})
        print("\n  " + "=" * 40)
        print(f"  generated: {len(topics) + failures}   invalid/crashes: {failures}")
        print(f"  distinct scenarios: {distinct}/{len(topics)}")
        print(f"  kept (served-able): {kept_n}")
        print(f"  gate verdicts: {verdicts or 'n/a (gate skipped)'}")
        ok = failures == 0
        print(f"  SMOKE {'PASSED' if ok else 'FAILED'}")
    finally:
        store.close()
    return 0 if failures == 0 else 1


def cmd_seeds(args) -> int:
    """Validate and report what's in seeds/ so seeding is guided, not guesswork."""
    from . import seeds as seedsmod
    from .generators.base import load_seed_json

    if getattr(args, "bootstrap", False):
        result = seedsmod.bootstrap(force=getattr(args, "force", False))
        print(result.summary())
        print()

    print(f"Seeds directory: {config.SEEDS_DIR}"
          + ("  (bootstrapped from batches/, not licensed material)"
             if (config.SEEDS_DIR / seedsmod.MARKER).exists() else "")
          + "\n")
    problems = 0
    for t in sorted(GENERATORS):
        fs = load_seed_json("fewshot", t)
        off = load_seed_json("official", t)
        # A good few-shot example carries its 解説 and a valid option/role set.
        fs_good = 0
        for ex in fs:
            has_expl = bool(ex.get("explanation_ja"))
            role_ok = not schemas.validate_item(t, ex) if isinstance(ex.get("options"), list) \
                and ex.get("options") and isinstance(ex["options"][0], dict) else False
            fs_good += int(has_expl and role_ok)
        flag = "" if fs else "  ← add 3-5 examples WITH their 解説"
        print(f"  {t}:")
        print(f"    fewshot:  {len(fs)} example(s), {fs_good} well-formed{flag}")
        print(f"    official: {len(off)} item(s)"
              + ("" if off else "  ← needed for discriminate/calibrate"))
        if not fs:
            problems += 1

    vs = vocab.status_summary()
    print("\n  vocab:")
    print(f"    JLPT kanji tiers loaded: {vs['tiers_loaded'] or 'none'}"
          + ("" if vs["tiers_loaded"] else "  ← add seeds/vocab/jlpt_*.txt to enable the kanji gate"))
    print(f"    business terms: {vs['business_terms']}")
    print(f"  levels: official CAN-DO descriptors "
          f"{'loaded' if levels.using_official_descriptors() else 'NOT loaded (using neutral defaults)'}")
    if problems:
        print(f"\n  {problems} item type(s) have no few-shot examples — generation quality "
              "will suffer until you add them. See seeds.example/README.md.")
    return 0


def cmd_practice(args) -> int:
    if args.demo:
        return _practice_demo(args)

    store = Store()
    try:
        served = 0
        target = args.n
        attempts_budget = target * 4  # cap regen attempts so a bad streak can't loop forever
        while served < target and attempts_budget > 0:
            attempts_budget -= 1
            item, iid, kept, detail = _generate_and_gate(
                store, args.type, args.level, gate=not args.fast
            )
            if not kept:
                print(f"  (regenerating — {detail})")
                continue
            served += 1
            print(f"\n=== Item {served}/{target} ===")
            _ask_and_score(store, item, iid)
        print(f"\nDone. Answered {served} item(s).")
        _print_run_accuracy(store)
    finally:
        store.close()
    return 0


def _practice_demo(args) -> int:
    """Offline demo using the author-composed fixtures (no API key)."""
    print("DEMO MODE — author-composed sample items, not official BJT material.\n")
    store = Store()
    try:
        types = [args.type] if args.type else list(fixtures.FIXTURES)
        served = 0
        for i in range(args.n):
            item = fixtures.FIXTURES[types[i % len(types)]]
            iid = store.insert_item(item["item_type"], item["level"], item,
                                    "demo-fixture", gate_verdict="skipped")
            served += 1
            print(f"\n=== Item {served}/{args.n} (demo) ===")
            _ask_and_score(store, item, iid)
        print(f"\nDone. Answered {served} item(s).")
        _print_run_accuracy(store)
    finally:
        store.close()
    return 0


def _ask_and_score(store, item: dict, item_id: int) -> None:
    _print_item_question(item)
    ci = schemas.correct_index(item["options"])
    choice = _read_choice(len(item["options"]))
    if choice is None:
        print("  (skipped)")
        return
    correct = choice == ci
    store.record_response(item_id, choice, correct)
    print(f"\n  {'✓ 正解！' if correct else '✗ 不正解'}  (you chose {LETTERS[choice]})\n")
    _print_item_answer(item)


def _read_choice(n: int):
    while True:
        try:
            raw = input(f"  Your answer [{'/'.join(LETTERS[:n])}, or 's' to skip]: ").strip().upper()
        except EOFError:
            return None
        if raw == "S":
            return None
        if raw in LETTERS[:n]:
            return LETTERS.index(raw)
        print("  Please enter one of:", ", ".join(LETTERS[:n]))


def _print_run_accuracy(store) -> None:
    print("\n  Per-item-type accuracy so far (raw — never a BJT score):")
    for row in store.accuracy_by_type():
        acc = f"{row['accuracy']:.0%}" if row["accuracy"] is not None else "n/a"
        print(f"    {row['item_type']}: {row['correct']}/{row['answered']} ({acc})")


def cmd_quality(args) -> int:
    store = Store()
    try:
        print("=" * 60)
        print("FIDELITY REPORT")
        print("=" * 60)

        print("\n[accuracy] raw per-item-type accuracy (no estimated BJT score):")
        acc = store.accuracy_by_type()
        if not acc:
            print("  (no answers recorded yet)")
        for row in acc:
            a = f"{row['accuracy']:.0%}" if row["accuracy"] is not None else "n/a"
            print(f"  {row['item_type']}: {row['correct']}/{row['answered']} ({a})")

        print("\n[1 · distractor roles] item verdicts (role/gate/vocab enforcement):")
        vc = store.verdict_counts()
        if not vc:
            print("  (no items generated yet)")
        for row in vc:
            print(f"  {row['item_type']}: {row['gate_verdict']} × {row['n']}")

        print("\n[2 · answerability gate] average cold/full success (lower cold = less leakage):")
        gs = store.gate_summary()
        if not gs:
            print("  (gate not run on any items yet)")
        for row in gs:
            print(f"  {row['item_type']}: cold={row['avg_cold']:.0%}  full={row['avg_full']:.0%}  (n={row['n']})")

        print("\n[2b · difficulty probe] average pass rate of the difficulty model on kept items:")
        ds = store.difficulty_summary()
        if not ds:
            print("  (probe not run on any items yet)")
        for row in ds:
            print(f"  {row['item_type']}: p_correct={row['avg_rate']:.0%}  (n={row['n']})")
        print(f"  model: {config.DIFFICULTY_MODEL}  trials: {config.DIFFICULTY_TRIALS}"
              + ("" if config.DIFFICULTY_ENABLED else "  — DISABLED (BJT_DIFFICULTY=0)"))

        print("\n[3 · discriminator] latest discrimination rate (→ 50% is the goal):")
        dr = store.latest_discriminator_runs()
        if not dr:
            print("  (run `bjt discriminate` — needs seeds/official/<type>.json)")
        for row in dr:
            print(f"  {row['item_type']}: {row['discrimination_rate']:.0%} "
                  f"(gen={row['n_generated']}, official={row['n_official']})")
            for reason in row["reasons"][:3]:
                print(f"      tell: {reason}")

        print("\n[4 · genre templates] phase 2 (総合読解) — not built yet.")

        print("\n[5 · sanity check] items the proofreader stopped before the gate:")
        stopped = sum(row["n"] for row in vc if row["gate_verdict"] == "discarded:sanity")
        print(f"  discarded:sanity × {stopped}"
              + ("" if stopped else "  (nothing has been flagged yet)"))
        print(f"  model: {config.SANITY_MODEL}"
              + ("" if config.SANITY_ENABLED else "  — DISABLED (BJT_SANITY=0)"))

        print("\n[6 · vocabulary gating] loaded seed data:")
        vs = vocab.status_summary()
        print(f"  JLPT kanji tiers loaded: {vs['tiers_loaded'] or 'none'}")
        print(f"  business terms loaded: {vs['business_terms']}")
        print(f"  official CAN-DO level descriptors: "
              f"{'yes' if levels.using_official_descriptors() else 'no (using neutral defaults)'}")

        print("\n[calibrate] run `bjt calibrate --type <t>` after answering official + generated items.")
        print("=" * 60)
    finally:
        store.close()
    return 0


def cmd_discriminate(args) -> int:
    from .generators.base import load_seed_json

    official = load_seed_json("official", args.type)
    if not official:
        print(f"No official items found at seeds/official/{args.type}.json — "
              "the discriminator needs real items to compare against.", file=sys.stderr)
        return 2

    store = Store()
    try:
        generated = store.kept_items(args.type, args.n)
        if len(generated) < 1:
            print(f"No generated {args.type} items in the DB yet — run `bjt gen` first.",
                  file=sys.stderr)
            return 2
        official = _normalize_official(official, args.type)[: args.n]
        print(f"Discriminating {len(generated)} generated vs {len(official)} official {args.type} items...")
        result = discriminator.run_discriminator(args.type, generated, official)
        store.insert_discriminator_run(
            args.type, result.n_generated, result.n_official,
            result.discrimination_rate, result.reasons,
        )
        print(f"\n  discrimination rate: {result.discrimination_rate:.0%} "
              f"(50% = judge cannot tell them apart)")
        print("  judge's stated tells:")
        for r in result.reasons:
            print(f"    - {r}")
        print("\n  These tells are now auto-folded into the generator prompt for "
              f"{args.type}; the next items will be written to avoid them.")
    finally:
        store.close()
    return 0


def cmd_calibrate(args) -> int:
    from .generators.base import load_seed_json

    official = _normalize_official(load_seed_json("official", args.type), args.type)
    if not official:
        print(f"No official items at seeds/official/{args.type}.json to sit.", file=sys.stderr)
        return 2

    store = Store()
    try:
        print(f"Sitting {len(official)} official {args.type} sample items.\n")
        n_correct = 0
        for i, item in enumerate(official):
            if len(item.get("options", [])) > len(LETTERS):
                print(f"\n(skipping official item {i+1}: more than {len(LETTERS)} options)")
                continue
            print(f"\n=== Official item {i+1}/{len(official)} ===")
            _print_item_question(item)
            ci = schemas.correct_index(item["options"])
            choice = _read_choice(len(item["options"]))
            if choice is None:
                continue
            correct = choice == ci
            n_correct += int(correct)
            print(f"  {'✓' if correct else '✗'}  正解: {LETTERS[ci]}\n")

        official_acc = n_correct / len(official) if official else None

        gen_rows = [r for r in store.accuracy_by_type() if r["item_type"] == args.type]
        gen_acc = gen_rows[0]["accuracy"] if gen_rows else None
        n_gen = gen_rows[0]["answered"] if gen_rows else 0

        store.insert_calibration_run(args.type, official_acc, gen_acc, len(official), n_gen)

        print("\n" + "=" * 50)
        print("CALIBRATION")
        oa = f"{official_acc:.0%}" if official_acc is not None else "n/a"
        ga = f"{gen_acc:.0%}" if gen_acc is not None else "n/a"
        print(f"  official items:  {oa}  (n={len(official)})")
        print(f"  generated items: {ga}  (n={n_gen})")
        if official_acc is not None and gen_acc is not None:
            gap = gen_acc - official_acc
            if gap > 0.1:
                print("  → Generated items look consistently EASIER than official ones.")
                print("    The prompts may have drifted soft — tighten them.")
            elif gap < -0.1:
                print("  → Generated items look harder than official ones.")
            else:
                print("  → Generated and official difficulty look comparable.")
        print("=" * 50)
    finally:
        store.close()
    return 0


def _normalize_official(items: list[dict], item_type: str) -> list[dict]:
    """Accept official seed items in either our item shape (options carry roles)
    or a lighter {stem, options:[str], answer: idx} shape, and normalise to our
    shape so the rest of the code can treat them uniformly."""
    out = []
    for raw in items:
        opts = raw.get("options", [])
        if opts and isinstance(opts[0], dict) and "role" in opts[0]:
            item = dict(raw)
        else:
            answer = raw.get("answer", 0)
            item = dict(raw)
            item["options"] = [
                {"text": (o if isinstance(o, str) else o.get("text", "")),
                 "role": roles.CORRECT if i == answer else "unknown"}
                for i, o in enumerate(opts)
            ]
        item.setdefault("item_type", item_type)
        item.setdefault("level", raw.get("level", ""))
        item.setdefault("explanation_ja", raw.get("explanation_ja", ""))
        out.append(item)
    return out


def cmd_seedtable(args) -> int:
    """Inspect the axes and how much of the table has been spent. This is the
    answer to 'will we run out of questions?' — it is a counting question, not a
    prompting one."""
    types = seedtable.available()
    if not types:
        print(f"No seed tables in {config.SEEDTABLE_DIR}.", file=sys.stderr)
        return 2

    store = Store()
    try:
        for t in types if not args.type else [args.type]:
            table = seedtable.load(t)
            shipped = batchmod.spent_cell_ids(t)
            local = store.used_cell_ids(t) - shipped
            used = shipped | local
            cov = table.coverage(used)
            print(f"\n{t}  ({config.SEEDTABLE_DIR / (t + '.json')})")
            print(f"  valid cells: {cov['total_cells']}   used: {cov['used_cells']}   "
                  f"remaining: {cov['total_cells'] - cov['used_cells']}")
            # Split out, because the two ledgers mean different things: one
            # travels with the repository, the other only exists here.
            print(f"    of which shipped in batches/: {len(shipped)}"
                  + (f"   local only: {len(local)}" if local else ""))
            for level in table.levels:
                print(f"    {level}: {len(table.cells(level))} cell(s)")
            print(f"  scene bank: {cov['scene_bank']} reusable image(s)")
            if args.sample:
                print(f"\n  sample of {args.sample} unused cell(s) at {args.level}:")
                for c in table.sample(args.sample, level=args.level,
                                      exclude_ids=used, seed=args.seed):
                    print(f"    {c.id}")
                    print(f"      {c.describe_ja()}  ·  {c.channel}  ·  {'、'.join(c.scenes)}")
    finally:
        store.close()
    return 0


def run_batch(
    store,
    item_type: str,
    level: str,
    n: int,
    *,
    gate: bool = True,
    sanity_check: bool = True,
    force: bool = False,
    out: "pathlib.Path | None" = None,
) -> tuple["pathlib.Path | None", int]:
    """Generate, gate and bundle one batch. Returns (bundle path, items kept).

    Split out of `cmd_batch` so the nightly run can write several batches in one
    process against one open store — reopening it per shelf would re-read the
    spent-cell ledger each time and, worse, would let two shelves in the same run
    spend the same cell.
    """
    kept_items: list[dict] = []
    cells = _sample_cells(store, item_type, level, n)
    attempts = 0
    budget = n * 3
    # Discards in a row. A shelf whose first three drafts all fail the gate is
    # a shelf the generator cannot write tonight, and every further draft is
    # the same money for the same answer. Reset by a keep.
    strikes = 0
    idx = 0
    while len(kept_items) < n and attempts < budget:
        if strikes >= config.SLOT_PATIENCE:
            print(f"  [{len(kept_items)}/{n}] giving up on this shelf: "
                  f"{strikes} discards in a row")
            break
        attempts += 1
        cell = cells[idx % len(cells)] if cells else None
        idx += 1
        try:
            item, iid, kept, detail = _generate_and_gate(
                store, item_type, level, gate=gate, sanity_check=sanity_check, cell=cell
            )
        except LLMBillingError:
            raise  # nothing after this can succeed; the caller ends the run
        except LLMError as e:
            print(f"  [{len(kept_items)}/{n}] generation failed: {e}")
            strikes += 1
            continue
        if not kept:
            print(f"  [{len(kept_items)}/{n}] dropped — {detail}")
            strikes += 1
            continue
        close = dedupe.max_similarity(item, kept_items)
        if close >= dedupe.DEFAULT_THRESHOLD:
            print(f"  [{len(kept_items)}/{n}] dropped — near-duplicate "
                  f"of an item already in this batch ({close:.2f})")
            strikes += 1
            continue
        strikes = 0
        kept_items.append(item)
        print(f"  [{len(kept_items)}/{n}] kept  {item.get('topic','')!r}  {detail}")

    if not kept_items:
        print("\nNothing passed the gates; no bundle written.", file=sys.stderr)
        return None, 0

    bundle = batchmod.build_bundle(item_type, level, kept_items, config.GEN_MODEL)
    report = batchmod.check_bundle(bundle)
    _print_bundle_report(bundle, report)
    if not report.ok and not force:
        print("\nBundle NOT written — fix the failures above or pass --force.",
              file=sys.stderr)
        return None, 0
    path = batchmod.save(bundle, out)
    print(f"\nWrote {len(kept_items)} item(s) to {path}")
    return path, len(kept_items)


def cmd_batch(args) -> int:
    """Generate a batch offline and write a shippable bundle.

    Nothing is generated at practice time, so this is where the money and the
    waiting happen: gate each item, drop the ones that fail, then run the
    whole-batch checks that a per-item gate cannot see."""
    store = Store()
    try:
        path, kept = run_batch(
            store, args.type, args.level, args.n,
            gate=not args.no_gate, sanity_check=not args.no_sanity,
            force=args.force, out=args.out,
        )
        if path is None:
            return 1
        bundle = batchmod.load(path)
        print(f"Next: synthesise the {len(bundle['audio_manifest'])} clip(s) in "
              "audio_manifest, then eyeball the items once.")
        print(llmmod.spend.report())
    finally:
        store.close()
    return 0


def cmd_plan(args) -> int:
    """What the bank needs next, counted rather than guessed.

    Needs no API key and no network: it reads the committed bundles and the seed
    tables, and prints the work order the nightly run would execute. Run it
    before approving a night's spend, or just to see whether the library is the
    shape the practice queue needs it to be."""
    state = plan.survey()
    order = plan.work_order(state, budget=args.budget, per_slot=args.per_slot)
    if args.json:
        print(json.dumps(plan.to_json(state, order), ensure_ascii=False, indent=2))
    else:
        print(plan.render(state, order))
    return 0


def cmd_nightly(args) -> int:
    """The nightly run: fill the emptiest shelves, check everything, stop.

    This is `bjt plan` followed by one `bjt batch` per line of the work order,
    inside one process so that the cells spent by the first shelf are already
    spent by the time the second one samples. Every item still goes through the
    same per-item gate and the same whole-batch checks as a hand-run batch —
    there is no fast path for being a robot.

    Nothing here publishes to a database. It writes bundles and their SQL into
    the tree, and a person reads the diff. That is the roadmap's rule, and it is
    the only reason a job that writes exam content unattended is a safe thing to
    have."""
    budget, per_slot = clamp_night(args.budget, args.per_slot)
    state = plan.survey()
    order = plan.work_order(state, budget=budget, per_slot=per_slot)
    print(plan.render(state, order))
    print(f"\nCeilings this run: ${config.RUN_BUDGET_USD:.2f}, "
          f"{config.RUN_MAX_CALLS} calls, {config.MAX_TOKENS_CEILING} output "
          f"tokens per call, effort at most {config.EFFORT_CEILING!r}.")
    if args.dry_run or not order:
        return 0

    store = Store()
    written: list[tuple[str, str, int, pathlib.Path]] = []
    failures: list[str] = []
    try:
        for w in order:
            print(f"\n--- {w.n} × {w.item_type} {w.level} " + "-" * 32)
            before = llmmod.spend.usd
            try:
                path, kept = run_batch(
                    store, w.item_type, w.level, w.n, gate=not args.no_gate,
                    sanity_check=not args.no_sanity, force=False,
                )
            except LLMBillingError as e:
                # The account is empty, or this run has spent its ceiling.
                # Every remaining shelf would fail the same way, so say it
                # once and keep what was written.
                print(f"  stopping the run: {e}", file=sys.stderr)
                failures.append(f"{w.item_type} {w.level} and everything after it: {e}")
                break
            except (LLMError, FileNotFoundError) as e:
                # One shelf failing is not the run failing. A key that ran out of
                # quota halfway through should still leave the batches it already
                # wrote, checked and reviewable.
                print(f"  skipped: {e}", file=sys.stderr)
                failures.append(f"{w.item_type} {w.level}: {e}")
                continue
            finally:
                # The bill so far, after every shelf, so the log says where
                # the money went while it is going.
                print(f"  this shelf ${llmmod.spend.usd - before:.2f}; "
                      f"run so far ${llmmod.spend.usd:.2f} of "
                      f"${config.RUN_BUDGET_USD:.2f} in {llmmod.spend.calls} call(s)")
            if path is None:
                failures.append(f"{w.item_type} {w.level}: nothing passed the gates")
                continue
            sql, _ = publish.publish_bundle(path)
            print(f"  SQL → {sql}")
            written.append((w.item_type, w.level, kept, path))
    finally:
        store.close()

    summary = _nightly_summary(written, failures, spend=llmmod.spend)
    print()
    print(summary)
    if args.summary:
        pathlib.Path(args.summary).write_text(summary + "\n", encoding="utf-8")
    # Nothing written at all is worth a red run; a partial night is not.
    return 0 if written else 1


def clamp_night(budget: int, per_slot: int) -> tuple[int, int]:
    """The night's size, no larger than config allows, whatever was asked.

    The workflow's inputs are typed into a box, and "24" typed into that box
    is how the expensive morning of 2026-09-18 began. A request above the
    ceiling is honoured up to the ceiling and said so, not refused: the run
    still happens, at a size somebody decided in code."""
    b = max(0, min(budget, config.NIGHT_MAX_BUDGET))
    p = max(0, min(per_slot, config.NIGHT_MAX_PER_SLOT))
    if (b, p) != (budget, per_slot):
        print(f"night clamped to {b} item(s), {p} per shelf (asked: {budget}, "
              f"{per_slot}; ceilings BJT_NIGHT_MAX_BUDGET={config.NIGHT_MAX_BUDGET}, "
              f"BJT_NIGHT_MAX_PER_SLOT={config.NIGHT_MAX_PER_SLOT})", file=sys.stderr)
    return b, p


def _nightly_summary(
    written: list[tuple[str, str, int, "pathlib.Path"]], failures: list[str],
    spend: "llmmod.Spend | None" = None,
) -> str:
    """The run, as something that can be pasted into a pull request."""
    total = sum(kept for _, _, kept, _ in written)
    lines = [f"Wrote {total} item(s) across {len(written)} shelf/shelves.", ""]
    for item_type, level, kept, path in written:
        lines.append(f"- **{kept} × {item_type} {level}** — `{path.name}`")
    if failures:
        lines += ["", "Not written:"]
        lines += [f"- {f}" for f in failures]
    if spend is not None:
        # The bill is part of the record: a reader of the pull request sees
        # what the night cost next to what it wrote, every night, so a bad
        # one is noticed the morning after and not on the invoice.
        lines += ["", "### What tonight cost", "", spend.report()]
    lines += [
        "",
        "Every item passed the per-item answerability gate and the whole-batch "
        "checks. Nothing is published until somebody merges this and applies the "
        "SQL — read a few of the items before you do.",
    ]
    return "\n".join(lines)


def cmd_importbatch(args) -> int:
    """Turn a hand-written source file into a checked bundle.

    Not every item has to come out of a model. The first batch of any new type is
    written by hand — that is how you find out what the generator is supposed to
    be aiming at — and the reference batch stays in the repo afterwards as the
    regression set. This path runs exactly the same validation and the same
    whole-batch checks as generated items; the only thing it skips is the model
    call.
    """
    import pathlib

    src = json.loads(pathlib.Path(args.path).read_text(encoding="utf-8"))
    item_type, level = src["item_type"], src["level"]
    table = seedtable.load(item_type)
    gen = get_generator(item_type)

    items: list[dict] = []
    problems = 0
    for i, raw in enumerate(src["items"]):
        cell = table.get(raw.get("seed_cell_id", ""))
        if cell is None:
            print(f"  item {i}: seed_cell_id {raw.get('seed_cell_id')!r} is not a valid "
                  f"cell in seedtable/{item_type}.json")
            problems += 1
            continue
        if cell.level != level:
            print(f"  item {i}: cell is {cell.level}, bundle is {level}")
            problems += 1
            continue
        item = {k: v for k, v in raw.items() if not k.startswith("_") and k != "seed_cell_id"}
        item["item_type"] = item_type
        item["level"] = level
        item["seed_cell"] = cell.to_dict()
        errs = schemas.validate_item(item_type, item) + gen.validate_extra(item, cell)
        if errs:
            print(f"  item {i} ({item.get('topic','')}): {errs}")
            problems += 1
            continue
        items.append(item)

    if problems:
        print(f"\n{problems} item(s) rejected; nothing written.", file=sys.stderr)
        return 1

    if args.shuffle:
        import random
        rng = random.Random(args.seed)
        for item in items:
            rng.shuffle(item["options"])

    model = src.get("source", "author-composed")
    if not args.no_store:
        store = Store()
        try:
            for item in items:
                store.insert_item(item_type, level, item, model, gate_verdict="skipped")
        finally:
            store.close()

    bundle = batchmod.build_bundle(item_type, level, items, model)
    report = batchmod.check_bundle(bundle)
    _print_bundle_report(bundle, report)
    if not report.ok and not args.force:
        print("\nBundle NOT written — fix the failures above or pass --force.", file=sys.stderr)
        return 1
    path = batchmod.save(bundle, args.out or pathlib.Path(args.path.replace(".source.json", ".json")))
    print(f"\nWrote {len(items)} item(s) to {path}")
    return 0


def cmd_checkbatch(args) -> int:
    """Re-run every offline check over an existing bundle. No API key needed."""
    import pathlib

    bundle = batchmod.load(pathlib.Path(args.path))
    report = batchmod.check_bundle(bundle)
    _print_bundle_report(bundle, report)
    if args.show:
        for bi in bundle["items"]:
            item = dict(bi)
            item["options"] = list(bi["options"])
            _print_item_question(item)
            _print_item_answer(item)
    return 0 if report.ok else 1


def cmd_publish(args) -> int:
    """Bundle → SQL. Content reaches the database as a reviewable file, never as
    a live call from a laptop holding a service key."""
    import pathlib

    path = pathlib.Path(args.path)
    bundle = batchmod.load(path)
    report = batchmod.check_bundle(bundle)
    if not report.ok and not args.force:
        _print_bundle_report(bundle, report)
        print("\nRefusing to publish a bundle that fails its own checks.", file=sys.stderr)
        return 1

    out, _ = publish.publish_bundle(path, args.out)
    n_clips = len(bundle.get("audio_manifest", []))
    print(f"Wrote {out}")
    print(f"  {len(bundle['items'])} item(s), {n_clips} audio clip(s), "
          f"{len(bundle.get('scenes', []))} scene(s)")
    print()
    print("Apply it with either:")
    print(f"  psql \"$SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f {out}")
    print("  or paste it into the Supabase SQL editor")
    print()
    print("Re-running it is safe — every statement is an upsert.")
    return 0


def cmd_synth(args) -> int:
    """Bundle → audio files + the SQL that points the database at them.

    Producing files and producing SQL are the job. Uploading is opt-in
    (`--upload`) and applying the SQL stays a separate act, so on a laptop no
    key that can write media has to exist, and in the deploy workflow — the
    one place all three happen together — each step is still its own line.
    """
    import pathlib

    from . import scene_art
    from .tts import providers, synth

    path = pathlib.Path(args.path)
    bundle = batchmod.load(path)
    report = batchmod.check_bundle(bundle)
    if not report.ok and not args.force:
        _print_bundle_report(bundle, report)
        print("\nRefusing to synthesise audio for a bundle that fails its own checks.",
              file=sys.stderr)
        print("A clip is expensive and permanent; an item that has not cleared its "
              "gates has no business having a voice recorded for it.", file=sys.stderr)
        return 1

    try:
        provider = providers.get_provider(args.provider)
    except KeyError as exc:
        print(exc.args[0], file=sys.stderr)
        return 2

    bucket = None
    if args.upload:
        if provider.name == "silent":
            print("--upload with the silent provider would ship silence: a learner would "
                  "hear nothing where the app now shows the text. Refusing.", file=sys.stderr)
            return 2
        bucket = scene_art.Bucket(name="audio")
        if not bucket.configured:
            print("--upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment",
                  file=sys.stderr)
            return 2

    have = synth.read_have(pathlib.Path(args.have)) if args.have else None

    result = synth.synthesise_bundle(
        bundle,
        provider=provider,
        out_dir=args.media_dir,
        force=args.force_clips,
        limit=args.limit,
        have=have,
    )

    print(result.summary())
    for clip_id, error in result.failed:
        print(f"  FAILED {clip_id}: {error}", file=sys.stderr)

    if provider.name == "silent":
        print()
        print("  These are SILENT placeholder clips. They exercise the pipeline — "
              "planning,\n  channel treatment, durations, the SQL — and prove nothing "
              "about how the\n  Japanese sounds. Their storage path says `silent/` so "
              "they can never be\n  mistaken for real recordings. Set GEMINI_API_KEY or "
              "OPENAI_API_KEY for\n  real voices; `bjt audition` compares them.")

    if bucket is not None and result.clips:
        up = synth.upload_clips(result, bucket, args.media_dir)
        print(f"uploaded {len(up.sent)} clip(s) to the `{bucket.name}` bucket")
        for clip_path, why in up.failed:
            print(f"not uploaded: {clip_path}: {why}", file=sys.stderr)
        if up.failed:
            # The SQL below must describe the bucket, not this machine.
            result.drop({pathlib.Path(p).stem for p in up.failed_paths})
            result.failed.extend((pathlib.Path(p).stem, why) for p, why in up.failed)

    if not result.clips and not result.live:
        return 0

    out = pathlib.Path(args.out) if args.out else path.with_name(
        path.stem + ".audio.sql"
    )
    out.write_text(synth.to_sql(result), encoding="utf-8")
    print(f"\nWrote {out}")

    record = (args.media_dir or config.MEDIA_DIR) / "reports" / f"{path.stem}.json"
    synth.write_report(result, pathlib.Path(record))
    print(f"Wrote {record}")

    if result.clips:
        print()
        if bucket is None:
            print("Next: upload media/audio/** to the `audio` bucket (or re-run with "
                  "--upload), then apply the SQL:")
        else:
            print("Next: apply the SQL:")
        print(f"  psql \"$SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f {out}")
    return 1 if result.failed else 0


def cmd_audition(args) -> int:
    """The same lines, every cast voice, every configured provider — for a
    person to listen to before the library is synthesised."""
    from .tts import audition, providers

    names = args.provider if args.provider else providers.available()
    if not names and not args.voices:
        print("No TTS provider is configured. Set one of:", file=sys.stderr)
        for name, keys in providers.CREDENTIALS.items():
            print(f"  {name:8} {' or '.join(keys)}", file=sys.stderr)
        print("(`--provider silent` exercises the page with silent clips.)", file=sys.stderr)
        return 2
    unknown = sorted(set(names) - set(providers.PROVIDERS))
    if unknown:
        print(f"unknown provider(s): {', '.join(unknown)}; "
              f"available: {sorted(providers.PROVIDERS)}", file=sys.stderr)
        return 2

    report = audition.run(names, media_dir=args.media_dir, force=args.force,
                          voices=args.voices)
    print(report.summary())
    for name, voice, why in report.failed:
        print(f"  FAILED {name} {voice}: {why}", file=sys.stderr)
    print(f"\nOpen {report.root / 'index.html'} and listen.")
    if args.voices:
        print(f"Every {providers.DEFAULT} voice saying one line is under "
              f"{report.root / 'openai-voices'}; a recast goes in OpenAIProvider.VOICE_IDS.")
    return 1 if report.failed else 0


def cmd_scenes(args) -> int:
    """What the scene bank needs, what exists, the drawing of what is missing,
    and the SQL for what is approved."""
    import pathlib

    from . import scene_art

    # The bucket is consulted whenever it is configured: on the nightly runner
    # media/ is empty every night, and the only record of what has already
    # been drawn is the bucket itself.
    bucket = scene_art.Bucket()
    remote: set[str] = set()
    if bucket.configured and (args.generate is not None or args.upload or args.sql):
        try:
            remote = bucket.list()
        except RuntimeError as exc:
            print(f"could not list the scenes bucket: {exc}", file=sys.stderr)
            return 1
    elif args.upload:
        print("--upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment",
              file=sys.stderr)
        return 2

    survey = scenemod.survey(args.media_dir, remote)

    if args.prompt:
        wanted = [s for s in survey if s.scene_id == args.prompt]
        if not wanted:
            print(f"no scene {args.prompt!r} in any committed seed table", file=sys.stderr)
            return 2
        print(scenemod.prompt_for(wanted[0]))
        return 0

    failed = False
    if args.generate is not None:
        try:
            provider = scene_art.get_provider(args.provider)
        except KeyError as exc:
            print(exc.args[0], file=sys.stderr)
            return 2
        if args.generate:
            unknown = sorted(set(args.generate) - {s.scene_id for s in survey})
            if unknown:
                print(f"no such scene(s): {', '.join(unknown)}", file=sys.stderr)
                return 2
            wanted = [s for s in survey if s.scene_id in args.generate]
        else:
            wanted = list(survey)
        if not args.force:
            wanted = [s for s in wanted if not s.has_art]
        if not wanted:
            note = "every scene already has artwork; nothing to draw (--force redraws)"
            print(note)
            # The summary file is a promise to the workflow, which appends it to
            # the run page whatever happened. A night with nothing to draw is
            # the ordinary night once the bank is full, and it must not be the
            # night the job fails on a missing file.
            if args.summary:
                pathlib.Path(args.summary).write_text(
                    f"## Scene artwork ({provider.name})\n\n{note}\n", encoding="utf-8")
        else:
            result = scene_art.draw(
                wanted, provider=provider, review=scene_art.review_with_model,
                media_dir=args.media_dir, attempts=args.attempts,
            )
            print(result.summary())
            if args.summary:
                pathlib.Path(args.summary).write_text(result.summary() + "\n", encoding="utf-8")
            failed = bool(result.failed)
            if not provider.real:
                print("\n  placeholder provider: files are under media/scenes/placeholder/,")
                print("  the survey does not count them, and nothing uploads them.")
            survey = scenemod.survey(args.media_dir, remote)

    if args.upload:
        up = scene_art.upload_approved(survey, bucket, args.media_dir)
        print(f"uploaded {len(up.sent)} file(s) to the `{bucket.name}` bucket"
              + (": " + ", ".join(up.sent) if up.sent else ""))
        for path, why in up.failed:
            print(f"not uploaded: {path}: {why}", file=sys.stderr)
        if up.failed:
            failed = True
            if args.summary:
                with pathlib.Path(args.summary).open("a", encoding="utf-8") as fh:
                    fh.write("\n" + up.summary() + "\n")
            # The SQL below must describe the bucket, not this machine.
            survey = scene_art.without(survey, up.failed_paths)

    have = [s for s in survey if s.has_art]

    if args.sql:
        out = pathlib.Path(args.out) if args.out else config.ROOT / "batches" / "scenes.sql"
        out.write_text(scenemod.to_sql(survey), encoding="utf-8")
        print(f"Wrote {out}  ({len(have)} scene(s) with artwork)")
        return 1 if failed else 0

    if args.generate is not None or args.upload:
        return 1 if failed else 0

    print(f"scene bank: {len(survey)} scene(s), {len(have)} with artwork\n")
    print(f"  {'scene_id':32} {'art':4} {'cells':>6}  used by")
    for scene in survey:
        mark = "yes" if scene.has_art else "—"
        print(f"  {scene.scene_id:32} {mark:4} {scene.cell_count:6}  "
              f"{'、'.join(scene.used_by)}")
    if not have:
        print("\n  No artwork yet. Items ship and are practised without pictures.")
        print("  `bjt scenes --generate` draws the missing ones and reviews each draft;")
        print("  `bjt scenes --prompt <scene_id>` prints the brief for one.")
    return 0


def cmd_render(args) -> int:
    """Render a document stimulus to HTML, to look at while writing one."""
    import pathlib

    item = None
    if args.item_type:
        item = fixtures.FIXTURES.get(args.item_type)
        if item is None:
            print(f"no fixture for {args.item_type!r}", file=sys.stderr)
            return 2
    else:
        bundle = batchmod.load(pathlib.Path(args.path))
        items = [i for i in bundle["items"] if i.get("documents")]
        if not items:
            print("no document items in that bundle", file=sys.stderr)
            return 2
        item = items[min(args.index, len(items) - 1)]

    field = schemas.DOCUMENT_FIELDS.get(item.get("item_type", ""))
    raw = item.get("documents") or ([item.get(field)] if field else [])
    docs = [d for d in (raw if isinstance(raw, list) else [raw]) if isinstance(d, dict)]
    if not docs:
        print("that item has no document", file=sys.stderr)
        return 2

    html = "\n".join(render.render_page(d) if args.page else render.render(d) for d in docs)
    if args.out:
        pathlib.Path(args.out).write_text(html, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(html)
    return 0


def cmd_grant(args) -> int:
    """SQL granting (or withdrawing) the ad-free unlock for one user.

    SQL rather than a live call, for the same reason content is: the thing that
    reaches the database is a file somebody can read first. It also means no key
    that can write entitlements has to live anywhere near this process.
    """
    fn = "revoke_entitlement" if args.revoke else "grant_entitlement"
    call = (
        f"select * from public.{fn}({publish.lit(args.user)}, {publish.lit(args.product)}"
        + (f", {publish.lit(args.note)}" if args.revoke and args.note else "")
        + (
            f", {publish.lit(args.source)}, {publish.lit(args.external_id)}, "
            f"{publish.lit(args.note)}"
            if not args.revoke
            else ""
        )
        + ");"
    )
    print(f"-- {'Revoke' if args.revoke else 'Grant'} {args.product} for {args.user}.")
    print("-- Runs as the service role; a client cannot call either function.")
    if not args.revoke:
        print("-- Idempotent: a replayed purchase updates the row it already wrote.")
    print()
    print(call)
    return 0


def cmd_tester(args) -> int:
    """SQL adding (or removing) somebody on the tester list.

    While the app is in testing, `public.testers` is the only door: every
    row-level policy requires the signed-in user's email to be in it.
    SQL rather than a live call, for the same reason `bjt grant` is: what
    reaches the database is a statement somebody can read first, and no key
    that can write it has to live near this process.
    """
    email = args.email.strip().lower()
    if "@" not in email:
        print(f"not an email address: {args.email!r}", file=sys.stderr)
        return 2
    if args.remove:
        print(f"-- Remove {email} from the tester list. Their history stays; they cannot read it.")
        print("-- Runs as the service role; a client cannot touch this table.")
        print()
        print(f"delete from public.testers where email = {publish.lit(email)};")
    else:
        unlimited = "true" if args.unlimited else "false"
        print(f"-- Let {email} use the app while it is in testing"
              + (", with no daily ceiling." if args.unlimited else "."))
        print("-- Runs as the service role; a client cannot touch this table.")
        print("-- Idempotent: re-running updates the note and the ceiling flag, nothing else.")
        print()
        print("insert into public.testers (email, note, unlimited)")
        print(f"values ({publish.lit(email)}, {publish.lit(args.note or '')}, {unlimited})")
        print("on conflict (email) do update set note = excluded.note,")
        print("                                  unlimited = excluded.unlimited;")
    return 0


def _print_bundle_report(bundle: dict, report) -> None:
    marks = {"pass": "OK  ", "warn": "WARN", "fail": "FAIL"}
    print("\n" + "=" * 62)
    print(f"BUNDLE CHECK — {bundle['item_type']} / {bundle['level']} / "
          f"{len(bundle['items'])} item(s)")
    print("=" * 62)
    for c in report.checks:
        print(f"  [{marks[c.status]}] {c.name}: {c.detail}")
    print("-" * 62)
    print(f"  {len(report.failed)} failure(s), {len(report.warned)} warning(s) — "
          f"{'SHIPPABLE' if report.ok else 'NOT SHIPPABLE'}")
    print("  (offline checks only: the answerability gate and the discriminator "
          "need an API key)")


# ----- argument parsing --------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="bjt", description="BJT practice item generator (phase 1)")
    sub = p.add_subparsers(dest="command", required=True)

    types = sorted(GENERATORS)

    sub.add_parser("init", help="create the DB and print seed setup instructions").set_defaults(func=cmd_init)
    sub.add_parser("selftest", help="offline validation + DB test (no API key)").set_defaults(func=cmd_selftest)

    g = sub.add_parser("gen", help="generate, proofread, gate, store, and print one item")
    g.add_argument("--type", required=True, choices=types)
    g.add_argument("--level", default="J2", choices=levels.LEVELS)
    g.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    g.add_argument("--no-sanity", action="store_true",
                   help="skip the cheap proofreading pass before the gate")
    g.add_argument("--json", action="store_true", help="print the item as JSON (verdict on stderr)")
    g.set_defaults(func=cmd_gen)

    sm = sub.add_parser("smoke", help="headless acceptance run: generate N items, assert no crash/invalid")
    sm.add_argument("--type", required=True, choices=types)
    sm.add_argument("--level", default="J2", choices=levels.LEVELS)
    sm.add_argument("-n", type=int, default=10, help="how many items")
    sm.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    sm.set_defaults(func=cmd_smoke)

    se = sub.add_parser("seeds", help="validate and report what's in seeds/")
    se.add_argument("--bootstrap", action="store_true",
                    help="build seeds/ from the reference batches when there is no licensed material")
    se.add_argument("--force", action="store_true",
                    help="with --bootstrap: overwrite a seeds/ that holds real material")
    se.set_defaults(func=cmd_seeds)

    st = sub.add_parser("seedtable", help="inspect the 場面×関係×機能×レベル table")
    st.add_argument("--type", choices=seedtable.available() or None)
    st.add_argument("--level", default="J2", choices=levels.LEVELS)
    st.add_argument("--sample", type=int, default=0, help="also print N unused cells")
    st.add_argument("--seed", type=int, default=None, help="make the sample reproducible")
    st.set_defaults(func=cmd_seedtable)

    b = sub.add_parser("batch", help="generate a batch offline into a shippable JSON bundle")
    b.add_argument("--type", required=True, choices=types)
    b.add_argument("--level", default="J2", choices=levels.LEVELS)
    b.add_argument("-n", type=int, default=10, help="how many items to keep")
    b.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    b.add_argument("--no-sanity", action="store_true", help="skip the cheap proofreading pass before the gate")
    b.add_argument("--out", type=__import__("pathlib").Path, default=None, help="bundle path")
    b.add_argument("--force", action="store_true", help="write the bundle even if checks fail")
    b.set_defaults(func=cmd_batch)

    pl = sub.add_parser("plan", help="what the bank needs next, emptiest shelf first")
    pl.add_argument("--budget", type=int, default=plan.DEFAULT_BUDGET,
                    help="most items one run may write")
    pl.add_argument("--per-slot", type=int, default=plan.DEFAULT_PER_SLOT,
                    help="most items one run may write into one (type, level)")
    pl.add_argument("--json", action="store_true", help="machine-readable work order")
    pl.set_defaults(func=cmd_plan)

    ni = sub.add_parser("nightly", help="run the work order: generate, gate, check, publish SQL")
    ni.add_argument("--budget", type=int, default=plan.DEFAULT_BUDGET,
                    help="most items this run may write")
    ni.add_argument("--per-slot", type=int, default=plan.DEFAULT_PER_SLOT,
                    help="most items this run may write into one (type, level)")
    ni.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    ni.add_argument("--no-sanity", action="store_true", help="skip the cheap proofreading pass before the gate")
    ni.add_argument("--dry-run", action="store_true", help="print the work order and stop")
    ni.add_argument("--summary", default=None, help="write a markdown summary here")
    ni.set_defaults(func=cmd_nightly)

    ib = sub.add_parser("importbatch", help="validate a hand-written source file into a bundle")
    ib.add_argument("path")
    ib.add_argument("--out", type=__import__("pathlib").Path, default=None, help="bundle path")
    ib.add_argument("--shuffle", action="store_true",
                    help="re-shuffle option order (leave off when the author set it deliberately)")
    ib.add_argument("--seed", type=int, default=None, help="make --shuffle reproducible")
    ib.add_argument("--no-store", action="store_true",
                    help="do not record the items (and so the cells they use) in the DB")
    ib.add_argument("--force", action="store_true", help="write the bundle even if checks fail")
    ib.set_defaults(func=cmd_importbatch)

    pb = sub.add_parser("publish", help="turn a bundle into idempotent SQL for the database")
    pb.add_argument("path")
    pb.add_argument("--out", type=__import__("pathlib").Path, default=None,
                    help="where to write the SQL (default: alongside the bundle)")
    pb.add_argument("--force", action="store_true",
                    help="publish even if the bundle fails its own checks")
    pb.set_defaults(func=cmd_publish)

    sy = sub.add_parser("synth", help="synthesise a bundle's audio and write the SQL for it")
    sy.add_argument("path", help="path to a checked bundle .json")
    sy.add_argument("--provider", default="auto",
                    help="TTS backend: auto (BJT_TTS_PROVIDER, else whichever of gemini, "
                         "openai, google has credentials, else silent), or one of those "
                         "by name; silent is an offline placeholder")
    sy.add_argument("--have", metavar="FILE",
                    help="clip ids already live (one per line): skipped entirely. "
                         "The deploy workflow reads them out of the database")
    sy.add_argument("--upload", action="store_true",
                    help="put the clips in the `audio` bucket "
                         "(needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)")
    sy.add_argument("--out", help="where to write the SQL (default: alongside the bundle)")
    sy.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where audio files go (default: {config.MEDIA_DIR})")
    sy.add_argument("--limit", type=int,
                    help="cap how many NEW clips this run may make — a budget, not a "
                         "debugging convenience")
    sy.add_argument("--force-clips", action="store_true",
                    help="re-synthesise clips that already exist on disk")
    sy.add_argument("--force", action="store_true",
                    help="synthesise even if the bundle fails its checks")
    sy.set_defaults(func=cmd_synth)

    au = sub.add_parser("audition", help="the same lines in every cast voice from each "
                                         "configured TTS provider, for a person to compare")
    au.add_argument("--provider", nargs="*", metavar="NAME",
                    help="which providers (default: every one with credentials)")
    au.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where the clips go (default: {config.MEDIA_DIR}/audition)")
    au.add_argument("--voices", action="store_true",
                    help="also one line in every voice the library's provider offers, "
                         "to recast a role by ear")
    au.add_argument("--force", action="store_true", help="re-synthesise clips that exist")
    au.set_defaults(func=cmd_audition)

    sc = sub.add_parser("scenes", help="what the scene bank needs, draw what is missing")
    sc.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where scene art lives (default: {config.MEDIA_DIR}/scenes)")
    sc.add_argument("--prompt", metavar="SCENE_ID",
                    help="print the illustration brief for one scene")
    sc.add_argument("--generate", nargs="*", metavar="SCENE_ID",
                    help="draw the scenes that have no artwork (or only the named ones), "
                         "reviewing every draft against the brief")
    sc.add_argument("--provider", default="openai",
                    help="image backend: openai (needs OPENAI_API_KEY), or placeholder "
                         "(offline, grey rectangles that are never counted as art)")
    sc.add_argument("--attempts", type=int, default=None,
                    help=f"drafts the review may reject per scene (default: {config.SCENE_ATTEMPTS})")
    sc.add_argument("--force", action="store_true",
                    help="redraw even scenes that already have artwork")
    sc.add_argument("--upload", action="store_true",
                    help="put approved files in the `scenes` bucket "
                         "(needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)")
    sc.add_argument("--sql", action="store_true",
                    help="write the SQL pointing the database at approved artwork")
    sc.add_argument("--out", help="where to write that SQL")
    sc.add_argument("--summary", default=None, help="write a markdown summary here")
    sc.set_defaults(func=cmd_scenes)

    rn = sub.add_parser("render", help="render a document stimulus to HTML")
    rn.add_argument("path", nargs="?", help="a bundle .json containing document items")
    rn.add_argument("--item-type", choices=sorted(GENERATORS),
                    help="render this type's fixture instead of a bundle item")
    rn.add_argument("--index", type=int, default=0, help="which document item in the bundle")
    rn.add_argument("--page", action="store_true",
                    help="a standalone HTML page rather than a fragment")
    rn.add_argument("--out", help="write to a file instead of stdout")
    rn.set_defaults(func=cmd_render)

    gr = sub.add_parser("grant", help="SQL granting or revoking the ad-free unlock")
    gr.add_argument("user", help="the Supabase user id (uuid)")
    gr.add_argument("--product", default="ads_free")
    gr.add_argument("--source", default="grant",
                    choices=["app_store", "play_store", "stripe", "grant"])
    gr.add_argument("--external-id", help="the store or processor transaction id")
    gr.add_argument("--note", help="why — shows up in the row, and in a dispute")
    gr.add_argument("--revoke", action="store_true",
                    help="withdraw it instead, keeping the record that it existed")
    gr.set_defaults(func=cmd_grant)

    te = sub.add_parser("tester", help="SQL adding or removing somebody on the tester list")
    te.add_argument("email", help="the email address they sign in with")
    te.add_argument("--note", help="who this is — shows up in the row")
    te.add_argument("--unlimited", action="store_true",
                    help="lift the daily ceiling for this account (a tester exercising the app)")
    te.add_argument("--remove", action="store_true", help="take them off the list instead")
    te.set_defaults(func=cmd_tester)

    cb = sub.add_parser("checkbatch", help="run the offline quality checks over a bundle")
    cb.add_argument("path")
    cb.add_argument("--show", action="store_true", help="also print every item with its 解説")
    cb.set_defaults(func=cmd_checkbatch)

    pr = sub.add_parser("practice", help="answer a run of items interactively")
    pr.add_argument("--type", choices=types, help="restrict to one item type")
    pr.add_argument("--level", default="J2", choices=levels.LEVELS)
    pr.add_argument("-n", type=int, default=10, help="how many items")
    pr.add_argument("--fast", action="store_true", help="skip the gate for speed")
    pr.add_argument("--demo", action="store_true", help="offline demo with sample items (no API key)")
    pr.set_defaults(func=cmd_practice)

    sub.add_parser("quality", help="print the fidelity report").set_defaults(func=cmd_quality)

    d = sub.add_parser("discriminate", help="run the discriminator loop")
    d.add_argument("--type", required=True, choices=types)
    d.add_argument("-n", type=int, default=6, help="max items per side")
    d.set_defaults(func=cmd_discriminate)

    c = sub.add_parser("calibrate", help="sit official items, compare to generated accuracy")
    c.add_argument("--type", required=True, choices=types)
    c.set_defaults(func=cmd_calibrate)

    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # practice --demo/--type: type is optional; every other command validates via choices.
    if args.command == "practice" and not args.demo and not args.type:
        parser.error("practice requires --type unless --demo is used")
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted.")
        return 130
    except LLMError as e:
        print(f"\nGeneration failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
