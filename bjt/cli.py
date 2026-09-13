"""Command-line interface.

Commands
    init          create the database and print seed-setup instructions
    selftest      offline check of validation + DB (no API key needed)
    seedtable     inspect the 場面×関係×機能×レベル table and how much of it is spent
    batch         generate a batch offline into a shippable JSON bundle
    checkbatch    run every offline quality check over an existing bundle
    gen           generate one item, gate it, store it, print it
    practice      answer a run of items interactively (--demo needs no key)
    quality       print the fidelity report (mechanisms 1-5)
    discriminate  run the discriminator loop and report the discrimination rate
    calibrate     sit the official sample items and compare accuracy to generated
"""
from __future__ import annotations

import argparse
import json
import sys
import textwrap

from . import batch as batchmod
from . import config, fixtures, levels, schemas, seedtable
from .llm import LLMError
from .db import Store
from .fidelity import answerability, dedupe, discriminator, roles, vocab
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

def _generate_and_gate(store, item_type: str, level: str, *, gate: bool, cell=None):
    """Generate one item, run vocab + answerability checks, persist with metrics.
    Returns (item, item_id, kept: bool, detail: str)."""
    gen = get_generator(item_type, store)
    if cell is None and gen.requires_cell:
        cell = _next_cell(store, item_type, level)
    item = gen.generate(level, cell=cell)

    vres = vocab.check_item(item, level)
    gate_verdict = "skipped"
    cold = full = None
    if gate:
        gres = answerability.run_gate(item)
        cold, full, gate_verdict = gres.cold_success_rate, gres.full_success_rate, gres.verdict
    # A vocab violation (when enforced) is an independent discard reason — it can
    # fail an item the answerability gate passed or skipped.
    if vres.enforced and not vres.ok and not gate_verdict.startswith("discarded"):
        gate_verdict = "discarded:vocab"

    item_id = store.insert_item(
        item_type, level, item, config.GEN_MODEL,
        cold_success_rate=cold, full_success_rate=full,
        gate_verdict=gate_verdict, vocab_violations=vres.violations,
    )
    if gate:
        for t in gres.trials:
            store.record_gate_trial(item_id, t.side, t.trial, t.chosen, t.correct)

    kept = gate_verdict in ("kept", "skipped")
    detail = _gate_detail(cold, full, gate_verdict, vres)
    return item, item_id, kept, detail


def _next_cell(store, item_type: str, level: str):
    """One unused seed-table cell. Raises if the table for this type is exhausted
    — better a clear stop than silently writing the same cell twice."""
    table = seedtable.load(item_type)
    picked = table.sample(1, level=level, exclude_ids=store.used_cell_ids(item_type))
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
    cells = table.sample(n, level=level, exclude_ids=store.used_cell_ids(item_type))
    if len(cells) < n:
        raise LLMError(
            f"only {len(cells)} unused {item_type} cell(s) left at {level}; extend "
            f"seedtable/{item_type}.json"
        )
    return cells


def _gate_detail(cold, full, verdict, vres) -> str:
    bits = []
    if cold is not None:
        bits.append(f"cold={cold:.0%} full={full:.0%}")
    bits.append(f"verdict={verdict}")
    if vres.enforced and vres.violations:
        bits.append(f"above-band kanji: {' '.join(vres.violations)}")
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
            store, args.type, args.level, gate=not args.no_gate
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
    from .generators.base import load_seed_json

    print(f"Seeds directory: {config.SEEDS_DIR}\n")
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

        print("\n[5 · vocabulary gating] loaded seed data:")
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
            used = store.used_cell_ids(t)
            cov = table.coverage(used)
            print(f"\n{t}  ({config.SEEDTABLE_DIR / (t + '.json')})")
            print(f"  valid cells: {cov['total_cells']}   used: {cov['used_cells']}   "
                  f"remaining: {cov['total_cells'] - cov['used_cells']}")
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


def cmd_batch(args) -> int:
    """Generate a batch offline and write a shippable bundle.

    Nothing is generated at practice time, so this is where the money and the
    waiting happen: gate each item, drop the ones that fail, then run the
    whole-batch checks that a per-item gate cannot see."""
    store = Store()
    kept_items: list[dict] = []
    try:
        cells = _sample_cells(store, args.type, args.level, args.n)
        attempts = 0
        budget = args.n * 3
        idx = 0
        while len(kept_items) < args.n and attempts < budget:
            attempts += 1
            cell = cells[idx % len(cells)] if cells else None
            idx += 1
            try:
                item, iid, kept, detail = _generate_and_gate(
                    store, args.type, args.level, gate=not args.no_gate, cell=cell
                )
            except LLMError as e:
                print(f"  [{len(kept_items)}/{args.n}] generation failed: {e}")
                continue
            if not kept:
                print(f"  [{len(kept_items)}/{args.n}] dropped — {detail}")
                continue
            close = dedupe.max_similarity(item, kept_items)
            if close >= dedupe.DEFAULT_THRESHOLD:
                print(f"  [{len(kept_items)}/{args.n}] dropped — near-duplicate "
                      f"of an item already in this batch ({close:.2f})")
                continue
            kept_items.append(item)
            print(f"  [{len(kept_items)}/{args.n}] kept  {item.get('topic','')!r}  {detail}")

        if not kept_items:
            print("\nNothing passed the gates; no bundle written.", file=sys.stderr)
            return 1

        bundle = batchmod.build_bundle(args.type, args.level, kept_items, config.GEN_MODEL)
        report = batchmod.check_bundle(bundle)
        _print_bundle_report(bundle, report)
        if not report.ok and not args.force:
            print("\nBundle NOT written — fix the failures above or pass --force.",
                  file=sys.stderr)
            return 1
        path = batchmod.save(bundle, args.out)
        print(f"\nWrote {len(kept_items)} item(s) to {path}")
        print(f"Next: synthesise the {len(bundle['audio_manifest'])} clip(s) in "
              "audio_manifest, then eyeball the items once.")
    finally:
        store.close()
    return 0


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

    g = sub.add_parser("gen", help="generate, gate, store, and print one item")
    g.add_argument("--type", required=True, choices=types)
    g.add_argument("--level", default="J2", choices=levels.LEVELS)
    g.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    g.add_argument("--json", action="store_true", help="print the item as JSON (verdict on stderr)")
    g.set_defaults(func=cmd_gen)

    sm = sub.add_parser("smoke", help="headless acceptance run: generate N items, assert no crash/invalid")
    sm.add_argument("--type", required=True, choices=types)
    sm.add_argument("--level", default="J2", choices=levels.LEVELS)
    sm.add_argument("-n", type=int, default=10, help="how many items")
    sm.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    sm.set_defaults(func=cmd_smoke)

    sub.add_parser("seeds", help="validate and report what's in seeds/").set_defaults(func=cmd_seeds)

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
    b.add_argument("--out", type=__import__("pathlib").Path, default=None, help="bundle path")
    b.add_argument("--force", action="store_true", help="write the bundle even if checks fail")
    b.set_defaults(func=cmd_batch)

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
