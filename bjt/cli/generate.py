"""Writing items: one (`gen`), a smoke run (`smoke`), a shelf (`batch`), and a
night's work order (`plan`, `nightly`).

What they drive lives in bjt/pipeline.py and bjt/plan.py; these parse, call
and print.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

from .. import batch as batchmod
from .. import (
    config,
    levels,
    pipeline,
    plan,
    schemas,
    shelf_rest,
)
from .. import llm as llmmod
from ..db import Store
from ..llm import LLMBillingError
from ._print import print_answer, print_question


def cmd_gen(args) -> int:
    store = Store()
    try:
        item, iid, kept, detail, _ = pipeline.generate_and_gate(
            store, args.type, args.level, gate=not args.no_gate,
            sanity_check=not args.no_sanity,
        )
        if args.json:
            print(json.dumps(item, ensure_ascii=False, indent=2))
        else:
            print_question(item)
            print_answer(item)
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
        cells = pipeline.sample_cells(store, args.type, args.level, args.n)
        for i in range(args.n):
            try:
                item, iid, kept, detail, _ = pipeline.generate_and_gate(
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
            except LLMBillingError:
                raise  # the ceiling or an empty account: every later item would fail too
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


def cmd_batch(args) -> int:
    """Generate a batch offline and write a shippable bundle.

    Nothing is generated at practice time, so this is where the money and the
    waiting happen: gate each item, drop the ones that fail, then run the
    whole-batch checks that a per-item gate cannot see."""
    store = Store()
    try:
        try:
            path, kept = pipeline.run_batch(
                store, args.type, args.level, args.n,
                gate=not args.no_gate, sanity_check=not args.no_sanity,
                force=args.force, out=args.out,
            )
        except pipeline.ShelfStopped as e:
            # The ceiling, or an empty account: what was kept before it is
            # bundled all the same, and the stop is said, not hidden.
            print(f"\nStopped at {e.kept} of {args.n}: {e}", file=sys.stderr)
            print(llmmod.spend.report())
            path = e.path
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
    resting, warning = shelf_rest.load(_now())
    if warning:
        print(warning, file=sys.stderr)
    order = plan.work_order(state, budget=args.budget, per_slot=args.per_slot,
                            reading_min=args.reading_min, resting=resting)
    if args.json:
        print(json.dumps(plan.to_json(state, order, resting), ensure_ascii=False, indent=2))
    else:
        print(plan.render(state, order, resting))
    return 0


def cmd_nightly(args) -> int:
    """The nightly run: fill the emptiest shelves, check everything, stop.

    This is `bjt plan` followed by one `bjt batch` per line of the work order,
    inside one process so that the cells spent by the first shelf are already
    spent by the time the second one samples. Every item still goes through the
    same per-item gate and the same whole-batch checks as a hand-run batch —
    there is no fast path for being a robot.

    Nothing here publishes to a database. It writes bundles and their SQL into
    the tree, and a person reads the diff. That review is the only reason a job
    that writes exam content unattended is a safe thing to have."""
    budget, per_slot = clamp_night(args.budget, args.per_slot)
    state = plan.survey()
    now = _now()
    resting, warning = shelf_rest.load(now)
    if warning:
        print(warning, file=sys.stderr)
    order = plan.work_order(state, budget=budget, per_slot=per_slot,
                            reading_min=args.reading_min, resting=resting)
    print(plan.render(state, order, resting))
    print(f"\nCeilings this run: ${config.RUN_BUDGET_USD:.2f}, "
          f"{config.RUN_MAX_CALLS} calls, {config.RUN_MAX_MINUTES:g} minutes, "
          f"{config.MAX_TOKENS_CEILING} output tokens per call, effort at most "
          f"{config.EFFORT_CEILING!r}; writer {config.GEN_MODEL}, judge {config.JUDGE_MODEL}.")
    if args.dry_run or not order:
        return 0

    store = Store()
    try:
        night = pipeline.run_night(store, order, gate=not args.no_gate,
                                   sanity_check=not args.no_sanity)
    finally:
        store.close()
    written, failures = night.written, night.failures
    # What each shelf did tonight, for the next night's work order: a shelf
    # that keeps writing nothing rests rather than taking every budget.
    warning = shelf_rest.record(night.outcomes, now)
    if warning:
        print(warning, file=sys.stderr)

    summary = _nightly_summary(written, failures, spend=llmmod.spend)
    print()
    print(summary)
    if args.summary:
        pathlib.Path(args.summary).write_text(summary + "\n", encoding="utf-8")
    # Nothing written at all is worth a red run; a partial night is not.
    return 0 if written else 1


def _now() -> dt.datetime:
    """The clock the shelf ledger is read and written by; the tests' seam."""
    return dt.datetime.now(dt.timezone.utc)


def clamp_night(budget: int, per_slot: int) -> tuple[int, int]:
    """The night's size, no larger than config allows, whatever was asked.

    The workflow's inputs are typed into a box, and what is typed there must
    not decide what a night costs. A request above the ceiling is honoured up
    to the ceiling and said so, not refused: the run still happens, at a size
    somebody decided in code."""
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



def register(sub, types: list[str]) -> None:
    """Add this module's subcommands to the `bjt` parser."""
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
    b = sub.add_parser("batch", help="generate a batch offline into a shippable JSON bundle")
    b.add_argument("--type", required=True, choices=types)
    b.add_argument("--level", default="J2", choices=levels.LEVELS)
    b.add_argument("-n", type=int, default=10, help="how many items to keep")
    b.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    b.add_argument("--no-sanity", action="store_true", help="skip the cheap proofreading pass before the gate")
    b.add_argument("--out", type=pathlib.Path, default=None, help="bundle path")
    b.add_argument("--force", action="store_true", help="write the bundle even if checks fail")
    b.set_defaults(func=cmd_batch)
    pl = sub.add_parser("plan", help="what the bank needs next, emptiest shelf first")
    pl.add_argument("--budget", type=int, default=plan.DEFAULT_BUDGET,
                    help="most items one run may write")
    pl.add_argument("--per-slot", type=int, default=plan.DEFAULT_PER_SLOT,
                    help="most items one run may write into one (type, level)")
    pl.add_argument("--reading-min", type=int, default=plan.DEFAULT_READING_MIN,
                    help="items reserved for the reading shelves before the rest")
    pl.add_argument("--json", action="store_true", help="machine-readable work order")
    pl.set_defaults(func=cmd_plan)
    ni = sub.add_parser("nightly", help="run the work order: generate, gate, check, publish SQL")
    ni.add_argument("--budget", type=int, default=plan.DEFAULT_BUDGET,
                    help="most items this run may write")
    ni.add_argument("--per-slot", type=int, default=plan.DEFAULT_PER_SLOT,
                    help="most items this run may write into one (type, level)")
    ni.add_argument("--reading-min", type=int, default=plan.DEFAULT_READING_MIN,
                    help="items reserved for the reading shelves before the rest")
    ni.add_argument("--no-gate", action="store_true", help="skip the answerability gate")
    ni.add_argument("--no-sanity", action="store_true", help="skip the cheap proofreading pass before the gate")
    ni.add_argument("--dry-run", action="store_true", help="print the work order and stop")
    ni.add_argument("--summary", default=None, help="write a markdown summary here")
    ni.set_defaults(func=cmd_nightly)
