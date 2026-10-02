"""The generation pipeline: one draft through every check, and a shelf of drafts.

`generate_and_gate` is one item's whole life before it ships — written, read by
the offline vocab check and the proofreader, sat by the answerability gate,
measured by the difficulty probe, and stored with every number it earned on the
way. `run_batch` is a shelf of them: the patience, the reason one draft's
rejection hands the next, the dedupe, and the whole-batch checks the bundle
must pass before it is written. `run_night` is a work order of shelves, and
where the run's ceiling ends one: after it has bundled what it kept.

They live here rather than in `bjt/cli/` so the tests can reach the pipeline
without the command-line module, and the commands that drive them (`bjt gen`,
`batch`, `nightly`, `smoke`, `practice`) stay thin.
"""
from __future__ import annotations

import pathlib
import sys
from dataclasses import dataclass, field
from typing import Optional

from . import batch as batchmod
from . import config, publish, seedtable, shelf_rest
from . import llm as llmmod
from .fidelity import answerability, dedupe, difficulty, sanity, vocab
from .generators import get_generator
from .llm import LLMBillingError, LLMError


class ShelfStopped(LLMBillingError):
    """The run's ceiling (or an empty account) ended a shelf part-way.

    Raised by `run_batch` only after it has done with what the shelf already
    kept exactly what a finished shelf does — built, checked and, if the
    checks pass, saved the bundle — so an item paid for is never thrown away
    because the one after it could not be. A billing error, so every caller
    that stops for one stops for this; `path` and `kept` say what was saved.
    """

    def __init__(self, cause: LLMBillingError, path: "pathlib.Path | None", kept: int):
        super().__init__(str(cause))
        self.path = path
        self.kept = kept


# ----- one item ----------------------------------------------------------

def generate_and_gate(store, item_type: str, level: str, *, gate: bool, sanity_check: bool = True,
                      cell=None, feedback: "str | None" = None):
    """Generate one item, run every per-item check, persist with metrics.
    Returns (item, item_id, kept: bool, detail: str, reason: str | None) —
    `reason` is what review said, in a sentence the next draft for the same
    shelf is told (`feedback`), and None for an item that was kept.

    The order is cheapest-first, and that is the point. The offline vocab check
    costs nothing. The proofreader is one small call. The answerability gate is
    six large ones, and it only runs on an item the first two did not already
    condemn — so a generation that came out broken costs one small call instead
    of six large ones, and the gate's budget is spent on items that might survive it.
    The difficulty probe comes last, a few small calls, and only for an item that
    is going to ship: measuring the difficulty of a discarded item buys nothing.
    """
    gen = get_generator(item_type, store)
    if cell is None and gen.requires_cell:
        cell = _next_cell(store, item_type, level)
    item = gen.generate(level, cell=cell, feedback=feedback)

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
        if any(t.chosen is None for t in gres.trials):
            # Whatever the verdict says: a gate with a trial its judge did not
            # answer has not checked the item, and an unchecked item never ships.
            cold = full = None
            gate_verdict = answerability.UNCHECKED
    # A vocab violation (when enforced) is an independent discard reason — it can
    # fail an item the answerability gate passed or skipped.
    if vres.enforced and not vres.ok and not gate_verdict.startswith("discarded"):
        gate_verdict = "discarded:vocab"
    # Only these two ship. An unchecked gate (its judge did not answer every
    # trial) is neither: nothing was found wrong, and nothing was shown right.
    kept = gate_verdict in ("kept", "skipped")

    # The difficulty probe: a weaker model sits the full view a few times, and
    # its pass rate is the difficulty prior. Only for an item that is going to
    # ship — a discarded item's difficulty is nobody's business — and skipped
    # entirely when switched off, which the result says rather than hides.
    if kept:
        try:
            dres = difficulty.measure(item)
        except LLMBillingError as e:
            # The gate has already passed this item and been paid for; the
            # ceiling reached while measuring it leaves it unmeasured (the
            # gate's rate stands in) rather than thrown away. The stop is not
            # lost: the ceiling is still reached, so the next call raises it.
            dres = difficulty.DifficultyResult(measured=False,
                                               notes=f"not probed: {e}")
    else:
        dres = difficulty.DifficultyResult(measured=False, notes="not probed: item discarded")

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
    # ran, and the gate's full-view rate otherwise — a coarser number, but still
    # an honest one. It is a property of the question and is never shown to
    # anybody (items.model_p_correct in d1/migrations/0001_initial.sql).
    if dres.measured:
        item["model_p_correct"] = dres.rate
    elif full is not None:
        item["model_p_correct"] = full

    detail = _gate_detail(cold, full, gate_verdict, vres, sres, dres)
    gres_for_reason = gres if gate and gate_verdict != "discarded:sanity" else None
    return item, item_id, kept, detail, rejection_reason(
        item_type, gate_verdict, sres, vres, gres_for_reason)


def rejection_reason(item_type: str, verdict: str, sres, vres, gres=None) -> "str | None":
    """Why review rejected this draft, as one sentence for the next one.

    None for a draft that was kept, and for one the gate could not check: an
    outage says nothing about the writing, and telling the next draft it
    failed would send it off to fix a fault nobody found."""
    if verdict == "discarded:leaky":
        return answerability.leak_description(item_type, gres)
    if verdict == "discarded:ambiguous":
        return ("a reviewer with the whole stimulus could not pick the marked answer "
                "consistently — another option was just as defensible, or the stimulus "
                "did not settle it")
    if verdict == "discarded:sanity":
        faults = "+".join(sres.faults) if sres is not None else "a proofreading fault"
        note = (sres.notes[:200] if sres is not None and sres.notes else "")
        return f"the proofreader flagged {faults}" + (f": {note}" if note else "")
    if verdict == "discarded:vocab":
        return ("it used kanji above the level's band: "
                + " ".join(vres.violations[:8]))
    return None


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
    # A fault's note, or the reason no check ran. A night of "sanity=skipped"
    # with the reason kept to itself cannot be diagnosed from the log.
    if sres is not None and (not sres.ok or not sres.checked) and sres.notes:
        bits.append(f"({sres.notes[:200]})")
    return "  ".join(bits)


# ----- seed cells ----------------------------------------------------------

def _spent_cells(store, item_type: str) -> set:
    """Every seed cell this item type has already used.

    Two ledgers, unioned. The committed bundles in `batches/` are the
    authoritative one — they are what ships, and they survive a fresh clone. The
    local SQLite database is consulted as well because it holds cells spent on
    items generated but not yet bundled, which exist only on this machine.

    The database alone is not enough: it is gitignored, so on a new checkout
    every cell would look free and the next batch would re-spend cells the
    library has already used.
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


#: Cells a shelf draws beyond the items it is asked for. A near-duplicate
#: spends its cell without keeping an item, and the shelf then needs another;
#: drawn up front they are spread across the axes with the rest.
CELL_SURPLUS = 2


def sample_cells(store, item_type: str, level: str, n: int, *, surplus: int = 0) -> list:
    """N unused cells for a run, spread across the axes, and up to `surplus`
    more when the table has them. Empty list for types that do not use a seed
    table."""
    if not get_generator(item_type).requires_cell:
        return []
    table = seedtable.load(item_type)
    cells = table.sample(n + max(surplus, 0), level=level,
                         exclude_ids=_spent_cells(store, item_type))
    if len(cells) < n:
        raise LLMError(
            f"only {len(cells)} unused {item_type} cell(s) left at {level}; extend "
            f"seedtable/{item_type}.json"
        )
    return cells


# ----- a shelf -------------------------------------------------------------

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

    A function of its own so the nightly run can write several batches in one
    process against one open store — reopening it per shelf would re-read the
    spent-cell ledger each time and, worse, would let two shelves in the same run
    spend the same cell.

    A billing error (the run's ceiling, an empty account) ends the shelf, not
    the items it kept: those are bundled as usual, and then `ShelfStopped` is
    raised so the caller ends the run too.
    """
    kept_items: list[dict] = []
    cells = sample_cells(store, item_type, level, n, surplus=CELL_SURPLUS)
    # Cells this shelf has finished with: kept, or spent on a near-duplicate.
    # A cell is never handed out again once it is in here — a second item on
    # one cell fails "seed cells distinct" and takes the whole shelf with it.
    done_cells: set[str] = set()
    attempts = 0
    budget = n * 3
    # Discards in a row. A shelf whose first three drafts all fail the gate is
    # a shelf the generator cannot write tonight, and every further draft is
    # the same money for the same answer. Reset by a keep.
    strikes = 0
    idx = 0
    # What review said about the last draft for this shelf, told to the next
    # one: a draft written blind fails the same way as the one before it.
    #
    # And told about the SAME cell: a draft the gate refused is usually a fine
    # situation with options that gave it away, so the next draft is that
    # situation again with the reviewer's reason in hand. Moving to a new cell
    # on every discard would throw the reason at a different situation. Only a
    # keep or a near-duplicate (the situation itself collides) moves the shelf
    # on to its next cell.
    feedback: "str | None" = None
    stop: "LLMBillingError | None" = None
    while len(kept_items) < n and attempts < budget:
        if strikes >= config.SLOT_PATIENCE:
            print(f"  [{len(kept_items)}/{n}] giving up on this shelf: "
                  f"{strikes} discards in a row")
            break
        cell = None
        if cells:
            cell = _cell_at(store, item_type, level, cells, idx, done_cells)
            if cell is None:
                print(f"  [{len(kept_items)}/{n}] no unused {item_type} cell left at "
                      f"{level}; the shelf ends here")
                break
        attempts += 1
        try:
            item, iid, kept, detail, reason = generate_and_gate(
                store, item_type, level, gate=gate, sanity_check=sanity_check, cell=cell,
                feedback=feedback,
            )
        except LLMBillingError as e:
            # Nothing after this can succeed. What was kept is still bundled
            # below, and then the caller is told to end the run.
            print(f"  [{len(kept_items)}/{n}] stopping: {e}")
            stop = e
            break
        except LLMError as e:
            print(f"  [{len(kept_items)}/{n}] generation failed: {e}")
            strikes += 1
            feedback = f"it did not validate ({str(e)[:200]})"
            continue
        if not kept:
            print(f"  [{len(kept_items)}/{n}] dropped — {detail}")
            strikes += 1
            feedback = reason
            continue
        close = dedupe.max_similarity(item, kept_items)
        if close >= dedupe.DEFAULT_THRESHOLD:
            print(f"  [{len(kept_items)}/{n}] dropped — near-duplicate "
                  f"of an item already in this batch ({close:.2f})")
            strikes += 1
            if cell is not None:
                done_cells.add(cell.id)
            idx += 1
            feedback = ("it was a near-duplicate of another item in this batch "
                        f"({item.get('topic', '')!r}); write a clearly different situation")
            continue
        strikes = 0
        if cell is not None:
            done_cells.add(cell.id)
        idx += 1
        feedback = None
        kept_items.append(item)
        print(f"  [{len(kept_items)}/{n}] kept  {item.get('topic','')!r}  {detail}")

    path, kept_n = _bundle_shelf(item_type, level, kept_items, force=force, out=out)
    if stop is not None:
        raise ShelfStopped(stop, path, kept_n) from stop
    return path, kept_n


def _cell_at(store, item_type: str, level: str, cells: list, idx: int, done: set):
    """The shelf's `idx`-th cell: from the cells it drew, and past their end a
    fresh one from the table. Never a cell in `done`. None when the table has
    nothing left at this level."""
    while idx >= len(cells):
        picked = seedtable.load(item_type).sample(
            1, level=level, exclude_ids=_spent_cells(store, item_type) | done
            | {c.id for c in cells})
        if not picked:
            return None
        cells.append(picked[0])
    cell = cells[idx]
    return None if cell.id in done else cell


def _bundle_shelf(item_type: str, level: str, kept_items: list[dict], *, force: bool,
                  out: "pathlib.Path | None") -> tuple["pathlib.Path | None", int]:
    """The whole-batch checks over what a shelf kept, and the bundle if they pass."""
    if not kept_items:
        print("\nNothing passed the gates; no bundle written.", file=sys.stderr)
        return None, 0

    bundle = batchmod.build_bundle(item_type, level, kept_items, config.GEN_MODEL)
    report = batchmod.check_bundle(bundle)
    print_bundle_report(bundle, report)
    if not report.ok and not force:
        print("\nBundle NOT written — fix the failures above or pass --force.",
              file=sys.stderr)
        return None, 0
    path = batchmod.save(bundle, out)
    print(f"\nWrote {len(kept_items)} item(s) to {path}")
    return path, len(kept_items)


# ----- a night ---------------------------------------------------------------

@dataclass
class NightResult:
    #: (item type, level, items kept, bundle path) for every shelf written.
    written: list[tuple[str, str, int, pathlib.Path]] = field(default_factory=list)
    #: One line per shelf that wrote nothing, or that the run ended inside.
    failures: list[str] = field(default_factory=list)
    #: Why the run ended before its work order did, when it did.
    stopped: Optional[str] = None
    #: (item type, level, outcome) for every shelf the night finished with:
    #: `written` if it kept anything, `missed` if it tried and kept nothing.
    #: A shelf a ceiling or the account stopped is not here — that was not
    #: the shelf (bjt/shelf_rest.py).
    outcomes: list[tuple[str, str, str]] = field(default_factory=list)


def run_night(store, order, *, gate: bool = True, sanity_check: bool = True) -> NightResult:
    """Every line of a work order (`plan.work_order`), one shelf after another,
    in one process against one store, each written bundle published to SQL.

    One shelf failing is not the night failing: a shelf the generator cannot
    write, or whose cells ran out, is noted and the next one runs. A billing
    error — the run's ceiling, an account that cannot pay — ends the night,
    because every shelf after it would fail the same way; the shelf it
    happened in keeps what it had already kept (`ShelfStopped`).
    """
    night = NightResult()
    for w in order:
        print(f"\n--- {w.n} × {w.item_type} {w.level} " + "-" * 32)
        before = llmmod.spend.usd
        path: "pathlib.Path | None"
        try:
            path, kept = run_batch(
                store, w.item_type, w.level, w.n, gate=gate,
                sanity_check=sanity_check, force=False,
            )
        except ShelfStopped as e:
            print(f"  stopping the run: {e}", file=sys.stderr)
            path, kept = e.path, e.kept
            night.stopped = str(e)
            if path is not None:
                night.outcomes.append((w.item_type, w.level, shelf_rest.WRITTEN))
            night.failures.append(
                f"{w.item_type} {w.level} (stopped at {kept} of {w.n}) and everything after it: {e}")
        except LLMBillingError as e:
            print(f"  stopping the run: {e}", file=sys.stderr)
            night.stopped = str(e)
            night.failures.append(f"{w.item_type} {w.level} and everything after it: {e}")
            break
        except (LLMError, FileNotFoundError) as e:
            # One shelf failing is not the run failing. A key that ran out of
            # quota halfway through should still leave the batches it already
            # wrote, checked and reviewable.
            print(f"  skipped: {e}", file=sys.stderr)
            night.failures.append(f"{w.item_type} {w.level}: {e}")
            # A generator the API refuses is the shelf's fault; missing seed
            # files are the runner's, and say nothing about the shelf.
            if isinstance(e, LLMError):
                night.outcomes.append((w.item_type, w.level, shelf_rest.MISSED))
            continue
        finally:
            # The bill so far, after every shelf, so the log says where the
            # money went while it is going.
            print(f"  this shelf ${llmmod.spend.usd - before:.2f}; "
                  f"run so far ${llmmod.spend.usd:.2f} of "
                  f"${config.RUN_BUDGET_USD:.2f} in {llmmod.spend.calls} call(s)")
        if path is None:
            if night.stopped is None:
                night.failures.append(f"{w.item_type} {w.level}: nothing passed the gates")
                night.outcomes.append((w.item_type, w.level, shelf_rest.MISSED))
        else:
            sql, _ = publish.publish_bundle(path)
            print(f"  SQL → {sql}")
            night.written.append((w.item_type, w.level, kept, path))
            if night.stopped is None:
                night.outcomes.append((w.item_type, w.level, shelf_rest.WRITTEN))
        if night.stopped is not None:
            break
    return night


def print_bundle_report(bundle: dict, report) -> None:
    """The whole-batch checks, one line each, and whether the bundle may ship."""
    marks = {"pass": "OK  ", "note": "NOTE", "warn": "WARN", "fail": "FAIL"}
    print("\n" + "=" * 62)
    print(f"BUNDLE CHECK — {bundle['item_type']} / {bundle['level']} / "
          f"{len(bundle['items'])} item(s)")
    print("=" * 62)
    for c in report.checks:
        print(f"  [{marks[c.status]}] {c.name}: {c.detail}")
    print("-" * 62)
    print(f"  {len(report.failed)} failure(s), {len(report.warned)} warning(s), "
          f"{len(report.noted)} note(s) — "
          f"{'SHIPPABLE' if report.ok else 'NOT SHIPPABLE'}")
    print("  (offline checks only: the answerability gate and the discriminator "
          "need an API key)")
