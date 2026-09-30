"""The generation pipeline: one draft through every check, and a shelf of drafts.

`generate_and_gate` is one item's whole life before it ships — written, read by
the offline vocab check and the proofreader, sat by the answerability gate,
measured by the difficulty probe, and stored with every number it earned on the
way. `run_batch` is a shelf of them: the patience, the reason one draft's
rejection hands the next, the dedupe, and the whole-batch checks the bundle
must pass before it is written.

They live here rather than in `bjt/cli.py` so the tests can reach the pipeline
without the command-line module, and the commands that drive them (`bjt gen`,
`batch`, `nightly`, `smoke`, `practice`) stay thin.
"""
from __future__ import annotations

import pathlib
import sys

from . import batch as batchmod
from . import config, seedtable
from .fidelity import answerability, dedupe, difficulty, sanity, vocab
from .generators import get_generator
from .llm import LLMBillingError, LLMError


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
    # ran, and the gate's full-view rate otherwise — a coarser number, but still
    # an honest one. It is a property of the question and is never shown to
    # anybody (supabase/migrations/20260916000500).
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


def sample_cells(store, item_type: str, level: str, n: int) -> list:
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
    """
    kept_items: list[dict] = []
    cells = sample_cells(store, item_type, level, n)
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
    while len(kept_items) < n and attempts < budget:
        if strikes >= config.SLOT_PATIENCE:
            print(f"  [{len(kept_items)}/{n}] giving up on this shelf: "
                  f"{strikes} discards in a row")
            break
        attempts += 1
        cell = cells[idx % len(cells)] if cells else None
        try:
            item, iid, kept, detail, reason = generate_and_gate(
                store, item_type, level, gate=gate, sanity_check=sanity_check, cell=cell,
                feedback=feedback,
            )
        except LLMBillingError:
            raise  # nothing after this can succeed; the caller ends the run
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
            idx += 1
            feedback = ("it was a near-duplicate of another item in this batch "
                        f"({item.get('topic', '')!r}); write a clearly different situation")
            continue
        strikes = 0
        idx += 1
        feedback = None
        kept_items.append(item)
        print(f"  [{len(kept_items)}/{n}] kept  {item.get('topic','')!r}  {detail}")

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
