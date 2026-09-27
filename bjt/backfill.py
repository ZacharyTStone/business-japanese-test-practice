"""Passes over the bank that already shipped, for what an item never got.

`bjt importbatch` checks the shape of a hand-written item and stops there: no
proofreader, no answerability gate, no difficulty probe. That is right for
the reference batch it was built for, and it is how 142 of the first 146
committed items arrived, so most of the bank a learner meets has passed the
offline checks and nothing else. This module catches up on what that path
skipped, over the committed bundles rather than over a draft.

`probe_bank` is the difficulty prior. `items.model_p_correct` is the only term
in `next_items()` that tells two items of one type and level apart, and it is
written at generation time or never; on 2026-09-27, 105 of the 107 live items
had none, so the difficulty pitch sorted nothing across almost the whole bank.
The same probe, the same weaker model and the same trials as a fresh draft
gets (bjt/fidelity/difficulty.py), on every live item without a rate.

**Built to be stopped.** A bank is bigger than one run's ceilings
(`BJT_RUN_BUDGET_USD`, `_MAX_CALLS`, `_MAX_MINUTES` in bjt/llm.py), and the
answer to that is more runs, never a raised ceiling. So each bundle's JSON and
SQL are written the moment that bundle is done — or the moment the run stops
inside it, for whatever reason — and the next run skips every item that
already has a rate. Nothing here raises, lowers or reads around a ceiling: the
check before every call is llm.py's, and this adds one more before every
item, so a run that has spent its allowance stops cleanly between items rather
than failing its way through the rest of the bank.

Only live items: a withdrawn question is never served, so what it would cost
to measure is money for nobody (bjt/withdrawn.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import batch as batchmod
from . import config, publish, withdrawn
from . import llm as llmmod
from .fidelity import difficulty

#: Items in a row whose every call failed before the pass gives up. An outage
#: or an empty account fails every item the same way — the probe records that
#: as "unmeasured", not as an error — and asking a hundred items says nothing
#: the third did not.
UNREACHABLE_PATIENCE = 3


def select_bundles(paths: list[str], every: bool) -> list[Path]:
    """The bundles a pass runs over: every committed one, or the ones named.

    Raises ValueError for a request that cannot mean anything: neither, both,
    a file that does not exist, or a `.source.json` (the hand-written input to
    `importbatch`, not a bundle — its items have no ids to write a rate to).
    """
    if every and paths:
        raise ValueError("name bundles or pass --all, not both")
    if every:
        return batchmod.bundles()
    if not paths:
        raise ValueError("name a bundle (batches/*.json) or pass --all")
    out = []
    for p in paths:
        path = Path(p)
        if path.name.endswith(".source.json"):
            raise ValueError(f"{path} is a source file, not a bundle; name the .json beside it")
        if not path.exists():
            raise ValueError(f"no such bundle: {path}")
        out.append(path)
    return out


def unprobed(bundle: dict, gone: Optional[frozenset] = None) -> list[dict]:
    """The bundle's live items that have no difficulty prior yet."""
    return [it for it in withdrawn.live_items(bundle, gone)
            if it.get("model_p_correct") is None]


def _publish(bundle: dict, path: Path) -> Path:
    """The bundle and its SQL, together: the SQL is what the deploy applies,
    and a bundle rewritten without it fails the committed-SQL test."""
    batchmod.save(bundle, path)
    sql, _ = publish.publish_bundle(path)
    return sql


@dataclass
class ProbeRun:
    #: Items that needed a rate when the run started, across the bundles asked.
    todo: int = 0
    measured: int = 0
    unmeasured: int = 0
    #: (bundle path, items measured in it) for every bundle rewritten.
    written: list[tuple[Path, int]] = field(default_factory=list)
    #: Why the run ended before the work did, when it did.
    stopped: Optional[str] = None

    @property
    def remaining(self) -> int:
        return self.todo - self.measured

    def summary(self, spend: "llmmod.Spend | None" = None) -> str:
        """The run, as something that can be pasted into a pull request."""
        lines = [f"Measured the difficulty of {self.measured} item(s) in "
                 f"{len(self.written)} bundle(s); {self.remaining} live item(s) "
                 "still have none.", ""]
        lines += [f"- `{path.name}`: {n} measured" for path, n in self.written]
        if self.unmeasured:
            lines += ["", f"{self.unmeasured} probe(s) could not run and wrote nothing: "
                          "an item with no rate is better than one with an invented rate."]
        if self.stopped:
            lines += ["", f"Stopped before the end: {self.stopped}. The next run "
                          "starts where this one stopped."]
        if spend is not None:
            lines += ["", "### What it cost", "", spend.report()]
        lines += ["", "The SQL sets `model_p_correct` on questions already in the bank. "
                      "Nothing reaches the database until this is merged."]
        return "\n".join(lines)


@dataclass
class Shelf:
    """One bundle as a pass sees it before spending anything."""
    path: Path
    n_items: int
    n_withdrawn: int
    todo: list[dict]


def survey_probe(paths: list[Path]) -> list[Shelf]:
    """What a probe would do, at no cost: each bundle's live items without a rate."""
    gone = withdrawn.ids()
    out = []
    for path in paths:
        bundle = batchmod.load(path)
        items = bundle.get("items", [])
        out.append(Shelf(path, len(items), sum(1 for it in items if it.get("id") in gone),
                         unprobed(bundle, gone)))
    return out


def runs_estimate(calls: int) -> str:
    """How many runs the ceilings make `calls` — at least, because the dollar
    and minute ceilings may bind before the call ceiling does."""
    runs = max(1, -(-calls // config.RUN_MAX_CALLS)) if config.RUN_MAX_CALLS > 0 else 1
    return (f"A run stops at {config.RUN_MAX_CALLS} calls, ${config.RUN_BUDGET_USD:.2f} or "
            f"{config.RUN_MAX_MINUTES:g} minutes (BJT_RUN_*), whichever comes first, and\n"
            f"the next run resumes where it stopped: at least {runs} run(s) for all of it.")


def probe_bank(paths: list[Path], *, log=print) -> ProbeRun:
    """Measure every live item without a rate, bundle by bundle.

    Each bundle is written (JSON and SQL) as soon as it is done, and also when
    the run stops inside it — the spend ceiling, an outage, Ctrl-C — so what
    was paid for is never lost; the next run skips what already has a rate.
    """
    run = ProbeRun()
    gone = withdrawn.ids()
    bundles = [(path, batchmod.load(path)) for path in paths]
    run.todo = sum(len(unprobed(b, gone)) for _, b in bundles)
    strikes = 0

    for path, bundle in bundles:
        todo = unprobed(bundle, gone)
        if not todo:
            continue
        log(f"{path.name}: {len(todo)} item(s) to measure")
        here = 0
        try:
            for it in todo:
                # Before the item, not only before each call: a run with no
                # allowance left stops here, between items, instead of sending
                # every remaining item to a probe that can only refuse it.
                llmmod.spend.check_ceilings()
                result = difficulty.measure(batchmod.as_generator_shape(it))
                log(f"  {it['id']}  {result.detail()}")
                if result.measured and result.rate is not None:
                    it["model_p_correct"] = result.rate
                    here += 1
                    strikes = 0
                    continue
                run.unmeasured += 1
                # Every trial unanswered is a model that cannot be reached, not
                # an item that is hard to measure; one answer says it can be.
                if result.trials and all(t.chosen is None for t in result.trials):
                    strikes += 1
                else:
                    strikes = 0
                if strikes >= UNREACHABLE_PATIENCE:
                    run.stopped = (f"the model could not be reached for {strikes} "
                                   "items in a row")
                    break
        except llmmod.LLMBillingError as e:
            # The run's ceiling, or an account that cannot pay. Everything after
            # this would be refused the same way.
            run.stopped = str(e)
        finally:
            if here:
                sql = _publish(bundle, path)
                run.measured += here
                run.written.append((path, here))
                log(f"  wrote {path.name} and {sql.name} ({here} measured)")
        if run.stopped:
            break
    return run
