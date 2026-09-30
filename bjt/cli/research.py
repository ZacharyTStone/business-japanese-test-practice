"""Everything a person runs by hand to look at the pipeline: `init`, `selftest`,
`seeds`, `seedtable`, `practice`, `quality`, `discriminate` and `calibrate`."""
from __future__ import annotations

import argparse
import pathlib
import sys
import textwrap

from .. import batch as batchmod
from .. import (
    calibration,
    config,
    fixtures,
    levels,
    pipeline,
    render,
    schemas,
    seedtable,
)
from ..db import Store
from ..fidelity import discriminator, roles, vocab
from ..generators import GENERATORS
from ._print import LETTERS, print_answer, print_question


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

    # 4. Round-trip through the DB (a throwaway file).
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        store = Store(pathlib.Path(tmpdir) / "selftest.db")
        iid = store.insert_item("goi_bunpou", "J2", fixtures.FIXTURES["goi_bunpou"],
                                "fixture", gate_verdict="skipped")
        store.record_response(iid, schemas.correct_index(fixtures.FIXTURES["goi_bunpou"]["options"]), True)
        acc = store.accuracy_by_type()
        # Every part a bool: an empty accuracy list here was a list, and
        # `ok &= []` a TypeError on exactly the path that reports a failure.
        db_ok = bool(store.get_item(iid)) and bool(acc) and acc[0]["correct"] == 1
        print(f"  DB insert + response + accuracy round-trip: {'OK' if db_ok else 'FAIL'}")
        ok &= db_ok
        store.close()

    print(f"\nSelf-test {'PASSED' if ok else 'FAILED'}.")
    return 0 if ok else 1


def cmd_seeds(args) -> int:
    """Validate and report what's in seeds/ so seeding is guided, not guesswork."""
    from .. import seeds as seedsmod
    from ..generators.base import load_seed_json

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
            item, iid, kept, detail, _ = pipeline.generate_and_gate(
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
    print_question(item)
    ci = schemas.correct_index(item["options"])
    choice = _read_choice(len(item["options"]))
    if choice is None:
        print("  (skipped)")
        return
    correct = choice == ci
    store.record_response(item_id, choice, correct)
    print(f"\n  {'✓ 正解！' if correct else '✗ 不正解'}  (you chose {LETTERS[choice]})\n")
    print_answer(item)


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

        print("\n[4 · document templates] the shapes a 資料 is set in (bjt/render/templates.py):")
        print(f"  {len(render.TEMPLATES)} templates: {', '.join(render.TEMPLATES)}")
        print("  every document is held to its template's required fields by `bjt checkbatch`")

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

        print("\n[calibrate] `bjt calibrate --type <t> --attempts-csv <file>` sets your score on the")
        print("  official samples beside your first attempts in the app (the export SQL is in its --help).")
        print("=" * 60)
    finally:
        store.close()
    return 0


def cmd_discriminate(args) -> int:
    from ..generators.base import load_seed_json

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
        try:
            result = discriminator.run_discriminator(args.type, generated, official)
        except ValueError as e:
            # A comparison the judge could win on the shape of the seed file
            # rather than on the writing. Reported as a fault to fix, never as
            # a rate — see discriminator._refuse_lopsided.
            print(f"\nCannot score this comparison: {e}", file=sys.stderr)
            return 2
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
    """Sit the official samples here; set the score beside the bank's.

    Right over answered on both sides, with how much was answered said
    separately: a skip is not a wrong answer. The bank's side is your first
    attempts in the app, from `--attempts-csv` (the export SQL is
    `calibration.ATTEMPTS_EXPORT_SQL`, printed by `bjt calibrate --help`), or
    what `bjt practice` recorded here when no file is given. See
    bjt/calibration.py for how both can flatter the bank.
    """
    from ..generators.base import load_seed_json

    official = _normalize_official(load_seed_json("official", args.type), args.type)
    if not official:
        print(f"No official items at seeds/official/{args.type}.json to sit.", file=sys.stderr)
        return 2

    # The file is read before the sitting, so a wrong export is found before
    # anybody has answered ten questions rather than after.
    bank = None
    if args.attempts_csv:
        try:
            bank = calibration.read_attempts_csv(pathlib.Path(args.attempts_csv), args.type)
        except (OSError, ValueError) as e:
            print(f"cannot read {args.attempts_csv}: {e}", file=sys.stderr)
            return 2
        source = f"your first attempts in the app ({pathlib.Path(args.attempts_csv).name})"
    else:
        source = "what `bjt practice` recorded here (--attempts-csv reads the app instead)"

    store = Store()
    try:
        print(f"Sitting {len(official)} official {args.type} sample items.\n")
        sat = calibration.Tally(total=len(official))
        for i, item in enumerate(official):
            if len(item.get("options", [])) > len(LETTERS):
                print(f"\n(skipping official item {i+1}: more than {len(LETTERS)} options)")
                continue
            print(f"\n=== Official item {i+1}/{len(official)} ===")
            print_question(item)
            ci = schemas.correct_index(item["options"])
            choice = _read_choice(len(item["options"]))
            if choice is None:
                continue
            correct = choice == ci
            sat.answered += 1
            sat.right += int(correct)
            print(f"  {'✓' if correct else '✗'}  正解: {LETTERS[ci]}\n")

        if bank is None:
            bank = calibration.from_store(store, args.type)
        # Each rate with the count it is a rate of: the answered items, not
        # the paper or the file.
        store.insert_calibration_run(args.type, sat.accuracy, bank.accuracy,
                                     sat.answered, bank.answered)
        print(calibration.report(args.type, sat, bank, source))
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



def register(sub, types: list[str]) -> None:
    """Add this module's subcommands to the `bjt` parser."""
    sub.add_parser("init", help="create the DB and print seed setup instructions").set_defaults(func=cmd_init)
    sub.add_parser("selftest", help="offline validation + DB test (no API key)").set_defaults(func=cmd_selftest)
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
    prc = sub.add_parser("practice", help="answer a run of items interactively")
    prc.add_argument("--type", choices=types, help="restrict to one item type")
    prc.add_argument("--level", default="J2", choices=levels.LEVELS)
    prc.add_argument("-n", type=int, default=10, help="how many items")
    prc.add_argument("--fast", action="store_true", help="skip the gate for speed")
    prc.add_argument("--demo", action="store_true", help="offline demo with sample items (no API key)")
    prc.set_defaults(func=cmd_practice)
    sub.add_parser("quality", help="print the fidelity report").set_defaults(func=cmd_quality)
    d = sub.add_parser("discriminate", help="run the discriminator loop")
    d.add_argument("--type", required=True, choices=types)
    d.add_argument("-n", type=int, default=6, help="max items per side")
    d.set_defaults(func=cmd_discriminate)
    c = sub.add_parser(
        "calibrate", help="sit official items, compare to your accuracy on the bank",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=("Your side of the bank comes from the app. Export it with this read-only\n"
                "SQL in the Supabase SQL editor (your sign-in address in place of\n"
                "you@example.com), download the result as CSV, and pass the file:\n\n"
                + textwrap.indent(calibration.ATTEMPTS_EXPORT_SQL, "    ")))
    c.add_argument("--type", required=True, choices=types)
    c.add_argument("--attempts-csv", metavar="PATH",
                   help="your first attempts in the app, exported with the SQL below "
                        "(columns item_type and is_correct, and chosen_index so a "
                        "timed-out answer is not counted as one); without it, what "
                        "`bjt practice` recorded in the local database")
    c.set_defaults(func=cmd_calibrate)
