"""The bank that already shipped: bundles in (`importbatch`), checked
(`checkbatch`), out as SQL (`publish`), and the passes over it for what an
item never got (`probe` in bjt/backfill.py, `regate` in bjt/regate.py).
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

from .. import batch as batchmod
from .. import (
    backfill,
    regate,
    config,
    jev,
    pipeline,
    publish,
    schemas,
    seedtable,
    withdrawn,
)
from .. import llm as llmmod
from ..db import Store
from ..fidelity import difficulty
from ..generators import get_generator
from ._print import print_answer, print_question


def cmd_probe(args) -> int:
    """Measure the difficulty of live items that shipped without a measurement.

    `items.model_p_correct` is the queue's prior on how hard a question is, and
    it is the only term in `next_items()` that tells two items of the same type
    and level apart. It is written at generation time — by the difficulty probe,
    or failing that by the answerability gate — so an item that reached the
    bank any other way has none. `bjt importbatch` is that other way: it stores
    with `gate_verdict="skipped"` and measures nothing, which is right for an
    offline import and leaves a hole: for those items the ranking term falls
    back to a constant, so the pitch does nothing at all across them.

    This is the catch-up pass: the same probe, the same weaker model and the
    same trial count, run over committed bundles (named, or `--all`) rather
    than over a draft. It touches only live items whose rate is missing, so
    re-running it is cheap and safe, and it obeys the run ceilings in
    `bjt/llm.py` like everything else — a bank-wide catch-up is exactly the
    shape of run those ceilings exist for, so it writes each bundle as soon as
    it is done and expects to be run more than once rather than to have them
    raised (bjt/backfill.py).

    Needs an API key. Without one every item reports unmeasured and the bundle
    is left exactly as it was, because a fabricated prior is worse than none:
    the queue would trust it.
    """
    try:
        paths = backfill.select_bundles(args.paths, args.all)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 2
    if args.compare:
        return _probe_compare(args, paths)
    if args.limit is not None:
        print("--limit is for --compare; a probe measures every item without a rate.",
              file=sys.stderr)
        return 2

    shelves = backfill.survey_probe(paths)
    for shelf in shelves:
        if shelf.todo or not args.all:
            print(f"{shelf.path.name}: {shelf.n_items} item(s), {len(shelf.todo)} without a "
                  "difficulty signal"
                  + (f" ({shelf.n_withdrawn} withdrawn, skipped)" if shelf.n_withdrawn else ""))
    work = [s for s in shelves if s.todo]
    items = sum(len(s.todo) for s in work)
    if not items:
        print("Nothing to measure.")
        return 0
    if args.dry_run:
        for shelf in work:
            for it in shelf.todo:
                print(f"  would measure {it['id']} ({it['item_type']} {it['level']})")
        print(f"\n{items} live item(s) in {len(work)} bundle(s) have no difficulty signal.")
        per = difficulty.calls_per_item()
        calls = items * per
        print(f"That is {calls} call(s) to {config.DIFFICULTY_MODEL}, {per} per item.")
        print(backfill.runs_estimate(calls))
        return 0
    if not config.DIFFICULTY_ENABLED:
        print("The difficulty probe is switched off (BJT_DIFFICULTY=0); nothing measured.",
              file=sys.stderr)
        return 1

    run = backfill.probe_bank([s.path for s in work])
    print()
    print(run.summary(llmmod.spend))
    if args.summary:
        pathlib.Path(args.summary).write_text(run.summary(llmmod.spend) + "\n", encoding="utf-8")
    if not run.measured:
        print("\nNothing measured — every bundle is unchanged.", file=sys.stderr)
        return 1
    print("\nThe bundles and their SQL are content — commit them and let the deploy "
          "workflow apply the SQL.")
    return 0


def _probe_compare(args, paths) -> int:
    """`bjt probe --compare MODEL`: the probe's model and MODEL on the same
    sample of live items, side by side. Writes nothing — no bundle, no SQL —
    so it is the evidence for choosing an instrument, never the change."""
    candidate = args.compare
    if candidate == config.DIFFICULTY_MODEL:
        print(f"{candidate} is already the probe's model (BJT_DIFFICULTY_MODEL); "
              "there is nothing to compare it with.", file=sys.stderr)
        return 2
    limit = args.limit if args.limit is not None else backfill.COMPARE_LIMIT
    if limit < 1:
        print("--limit must be at least 1.", file=sys.stderr)
        return 2
    todo = backfill.sample(paths, limit)
    if not todo:
        print("No live items to compare on.")
        return 0
    calls = len(todo) * (difficulty.calls_per_item() + difficulty.calls_per_item(candidate))
    if args.dry_run:
        for it in todo:
            print(f"  would compare on {it['id']} ({it['item_type']} {it['level']})")
        print(f"\n{len(todo)} live item(s): {calls} call(s) in all, "
              f"{difficulty.calls_per_item()} per item to {config.DIFFICULTY_MODEL} and "
              f"{difficulty.calls_per_item(candidate)} to {candidate}. Nothing is written.")
        print(f"A run stops at {config.RUN_MAX_CALLS} calls, ${config.RUN_BUDGET_USD:.2f} or "
              f"{config.RUN_MAX_MINUTES:g} minutes (BJT_RUN_*), and a comparison that stops "
              "keeps what it measured but does not resume.")
        return 0
    if not config.DIFFICULTY_ENABLED:
        print("The difficulty probe is switched off (BJT_DIFFICULTY=0); nothing measured.",
              file=sys.stderr)
        return 1
    # Checked here rather than found out three items in, after the baseline's
    # calls on them are already spent.
    if jev.is_jev(candidate) and not os.environ.get("TYPESAFE_API_KEY"):
        print(f"{candidate} needs TYPESAFE_API_KEY; nothing measured.", file=sys.stderr)
        return 1

    cmp = backfill.compare_bank(paths, candidate, limit=limit)
    text = cmp.summary(llmmod.spend)
    print()
    print(text)
    if args.summary:
        pathlib.Path(args.summary).write_text(text + "\n", encoding="utf-8")
    return 0 if cmp.rows else 1


def cmd_regate(args) -> int:
    """Put committed questions through the proofreader and the gate they skipped.

    Most of the bank came in through `bjt importbatch`, which checks an item's
    shape and nothing else. This asks every live question the two things a
    fresh draft is asked before it ships — does a proofreader find a fault, and
    does the gate find it answerable and not leaky — in the same order and by
    the same rules (bjt/regate.py).

    Every verdict is written to batches/regated.txt as it is reached, so a run
    stopped by the ceilings in bjt/llm.py carries on where it stopped and a
    question is never paid for twice. A failure is reported, and proposed for
    batches/withdrawn.txt in that ledger's format with a reason from its
    closed set; `--withdraw` appends the proposals and rewrites the SQL of the
    bundles they are in through the publish path. Nothing is ever taken out of
    the ledger, no bundle is edited, and nothing is published until the diff is
    merged.
    """
    try:
        paths = backfill.select_bundles(args.paths, args.all)
        shelves = regate.survey_regate(paths)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 2

    for shelf in shelves:
        if shelf.todo or not args.all:
            print(f"{shelf.path.name}: {shelf.n_items} item(s), {len(shelf.todo)} not yet "
                  "regated" + (f" ({shelf.n_withdrawn} withdrawn, skipped)"
                               if shelf.n_withdrawn else ""))
    work = [s for s in shelves if s.todo]
    items = sum(len(s.todo) for s in work)
    per_item = 1 + 2 * config.GATE_TRIALS

    if args.dry_run:
        for shelf in work:
            for it in shelf.todo:
                print(f"  would check {it['id']} ({it['item_type']} {it['level']})")
        if items:
            print(f"\n{items} live question(s) in {len(work)} bundle(s) have no verdict yet.")
            print(f"That is at most {items * per_item} call(s): one to {config.SANITY_MODEL} "
                  f"and up to {2 * config.GATE_TRIALS} to {config.JUDGE_MODEL} per question.")
            print(backfill.runs_estimate(items * per_item))
        else:
            print("Every live question here has a verdict.")
        _print_proposals(regate.proposals(paths), appended=False)
        return 0

    run = None
    if items:
        if not config.SANITY_ENABLED:
            print("The proofreader is switched off (BJT_SANITY=0), and a regate is the "
                  "proofreader and then the gate; nothing checked.", file=sys.stderr)
            return 2
        run = regate.regate_bank([s.path for s in work])
        verdicts: dict[str, int] = {}
        for _, verdict in run.checked:
            verdicts[verdict] = verdicts.get(verdict, 0) + 1
        print(f"\nChecked {len(run.checked)} question(s)"
              + (": " + ", ".join(f"{v} × {n}" for v, n in sorted(verdicts.items()))
                 if verdicts else "")
              + (f"; {run.unchecked} could not be checked" if run.unchecked else "")
              + f"; {run.todo - len(run.checked)} still without a verdict.")
        if run.stopped:
            print(f"Stopped before the end: {run.stopped}. The next run starts where this "
                  "one stopped.")
        print(llmmod.spend.report())
    else:
        print("Every live question here has a verdict.")

    found = regate.proposals(paths)
    if found and args.withdraw:
        try:
            sqls = regate.withdraw(found)
        except ValueError as e:
            print(f"withdrawn.txt not changed: {e}", file=sys.stderr)
            return 2
        _print_proposals(found, appended=True)
        for sql in sqls:
            print(f"  rewrote {sql}")
    else:
        _print_proposals(found, appended=False)
    if run is not None and not run.checked:
        print("\nNothing checked.", file=sys.stderr)
        return 1
    return 0


def _print_proposals(found, *, appended: bool) -> None:
    if not found:
        return
    print(f"\n{len(found)} question(s) failed and nobody has overruled them"
          + (f"; appended to batches/{withdrawn.LEDGER_NAME}:" if appended
             else f"; `--withdraw` appends these to batches/{withdrawn.LEDGER_NAME}:"))
    for _, entry in found:
        print("  " + withdrawn.line(regate.as_withdrawal(entry)))


def cmd_importbatch(args) -> int:
    """Turn a hand-written source file into a checked bundle.

    Not every item has to come out of a model. The first batch of any new type is
    written by hand — that is how you find out what the generator is supposed to
    be aiming at — and the reference batch stays in the repo afterwards as the
    regression set. This path runs exactly the same validation and the same
    whole-batch checks as generated items; the only thing it skips is the model
    call.
    """
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
    pipeline.print_bundle_report(bundle, report)
    if not report.ok and not args.force:
        print("\nBundle NOT written — fix the failures above or pass --force.", file=sys.stderr)
        return 1
    path = batchmod.save(bundle, args.out or pathlib.Path(args.path.replace(".source.json", ".json")))
    print(f"\nWrote {len(items)} item(s) to {path}")
    return 0


def cmd_checkbatch(args) -> int:
    """Re-run every offline check over an existing bundle. No API key needed."""
    bundle = batchmod.load(pathlib.Path(args.path))
    report = batchmod.check_bundle(bundle)
    pipeline.print_bundle_report(bundle, report)
    if args.show:
        for bi in bundle["items"]:
            item = dict(bi)
            item["options"] = list(bi["options"])
            print_question(item)
            print_answer(item)
    return 0 if report.ok else 1


def cmd_publish(args) -> int:
    """Bundle → SQL. Content reaches the database as a reviewable file, never as
    a live call from a laptop holding a service key."""
    path = pathlib.Path(args.path)
    bundle = batchmod.load(path)
    report = batchmod.check_bundle(bundle)
    if not report.ok and not args.force:
        pipeline.print_bundle_report(bundle, report)
        print("\nRefusing to publish a bundle that fails its own checks.", file=sys.stderr)
        return 1

    out, _ = publish.publish_bundle(path, args.out)
    n_clips = len(bundle.get("audio_manifest", []))
    print(f"Wrote {out}")
    print(f"  {len(bundle['items'])} item(s), {n_clips} audio clip(s), "
          f"{len(bundle.get('scenes', []))} scene(s)")
    pulled = len(bundle["items"]) - len(withdrawn.live_items(bundle))
    if pulled:
        print(f"  {pulled} of the items are withdrawn (batches/{withdrawn.LEDGER_NAME}) "
              "and are unpublished by this file")
    print()
    print("Apply it with either:")
    print(f"  (cd client && npx wrangler d1 execute business-japanese-drill --remote --file ../{out})")
    print("  or paste it into the D1 console in the Cloudflare dashboard")
    print()
    print("Re-running it is safe — every statement is an upsert.")
    return 0



def register(sub, types: list[str]) -> None:
    """Add this module's subcommands to the `bjt` parser."""
    ib = sub.add_parser("importbatch", help="validate a hand-written source file into a bundle")
    ib.add_argument("path")
    ib.add_argument("--out", type=pathlib.Path, default=None, help="bundle path")
    ib.add_argument("--shuffle", action="store_true",
                    help="re-shuffle option order (leave off when the author set it deliberately)")
    ib.add_argument("--seed", type=int, default=None, help="make --shuffle reproducible")
    ib.add_argument("--no-store", action="store_true",
                    help="do not record the items (and so the cells they use) in the DB")
    ib.add_argument("--force", action="store_true", help="write the bundle even if checks fail")
    ib.set_defaults(func=cmd_importbatch)
    pb = sub.add_parser("publish", help="turn a bundle into idempotent SQL for the database")
    pb.add_argument("path")
    pb.add_argument("--out", type=pathlib.Path, default=None,
                    help="where to write the SQL (default: alongside the bundle)")
    pb.add_argument("--force", action="store_true",
                    help="publish even if the bundle fails its own checks")
    pb.set_defaults(func=cmd_publish)
    prb = sub.add_parser("probe", help="measure difficulty for live items that shipped without it")
    prb.add_argument("paths", nargs="*", metavar="PATH", help="committed bundles (batches/*.json)")
    prb.add_argument("--all", action="store_true", help="every committed bundle")
    prb.add_argument("--dry-run", action="store_true",
                     help="list what would be measured, count the calls, and spend nothing")
    prb.add_argument("--summary", default=None, help="write a markdown summary here")
    prb.add_argument("--compare", default=None, metavar="MODEL",
                     help="measure a sample of live items with MODEL beside the probe's model "
                          "(e.g. jev-latest) and print both; writes nothing")
    prb.add_argument("--limit", type=int, default=None, metavar="N",
                     help=f"with --compare: how many items (default {backfill.COMPARE_LIMIT}), "
                          "taken a type at a time")
    prb.set_defaults(func=cmd_probe)
    rg = sub.add_parser("regate", help="put committed questions through the proofreader and "
                                       "the gate they skipped")
    rg.add_argument("paths", nargs="*", metavar="PATH", help="committed bundles (batches/*.json)")
    rg.add_argument("--all", action="store_true", help="every committed bundle")
    rg.add_argument("--dry-run", action="store_true",
                    help="list what would be checked, count the calls, show what --withdraw "
                         "would append, and spend nothing")
    rg.add_argument("--withdraw", action="store_true",
                    help="append every failure nobody has overruled to "
                         f"batches/{withdrawn.LEDGER_NAME} and rewrite its bundle's SQL")
    rg.set_defaults(func=cmd_regate)
    cb = sub.add_parser("checkbatch", help="run the offline quality checks over a bundle")
    cb.add_argument("path")
    cb.add_argument("--show", action="store_true", help="also print every item with its 解説")
    cb.set_defaults(func=cmd_checkbatch)
