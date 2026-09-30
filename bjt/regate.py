"""The review the bank never had: the proofreader and the gate, after the fact.

`bjt importbatch` checks the shape of a hand-written item and stops there, and
most of the bank arrived that way. `regate_bank` is the review: the
proofreader (bjt/fidelity/sanity.py) and then, if it found nothing, the
answerability gate (bjt/fidelity/answerability.py) — the order and the rules a
fresh draft meets in `pipeline.generate_and_gate`, asked of questions that
shipped without meeting them. Every verdict goes into `batches/regated.txt`
the moment it is reached, and a question that fails is *proposed* for
`batches/withdrawn.txt` — written there only with `--withdraw`, in that
ledger's own format and closed set of reasons, and even then only as a diff
somebody reads before the merge that ships it.

Built to be stopped, like the probe (bjt/backfill.py): a verdict is written
down the moment it is reached, so a run the ceilings end carries on where it
stopped and no question is paid for twice. Only live questions: a withdrawn
one is never served.
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import batch as batchmod
from . import config, publish, withdrawn
from . import llm as llmmod
from .backfill import UNREACHABLE_PATIENCE, Shelf
from .fidelity import answerability, sanity

REGATE_LEDGER_NAME = "regated.txt"

#: The pipeline's own words for what the checks said (`gate_verdict` in the
#: local store), and one more that only a person writes: `overruled`, for a
#: failure the owner read and decided to keep.
VERDICTS = ("kept", "discarded:sanity", "discarded:leaky", "discarded:ambiguous", "overruled")

#: Which reason a proofreader's flag withdraws a question for, in
#: `withdrawn.REASONS` — the closed set a tester's report uses. Most serious
#: first: when several flags are raised, the first of them in this order names
#: the line, and the sentence lists them all. A flag with no entry here fails a
#: test, so the proofreader cannot grow a rule the ledger has no word for.
SANITY_REASONS: dict[str, str] = {
    "answer_impossible": "wrong_answer",       # the marked answer cannot be right
    "second_answer_defensible": "ambiguous",   # another option is as right
    # The 解説 or the story does not hang together, or the options do not answer
    # the question: a question that cannot be understood as it stands. A person
    # reviewing the bank files the same faults under `unclear`.
    "explanation_mismatch": "unclear",
    "situation_incoherent": "unclear",
    "options_not_parallel": "unclear",
    "unnatural_japanese": "unnatural",
    "broken_japanese": "unnatural",
}

_HEADER = """\
# Committed questions put through the proofreader and the answerability gate
# after they shipped (`bjt regate`), and what each said.
#
# One line per item:  <item id>  <verdict>  <date>  <reason>  <what was found>
# The verdict is the pipeline's own: kept, discarded:sanity, discarded:leaky or
# discarded:ambiguous. The reason is what `bjt regate --withdraw` writes into
# batches/withdrawn.txt for a question that failed (the closed set a tester's
# report uses), and - for one that did not.
#
# A line here means the question has been checked, and `bjt regate` skips it:
# that is what lets a run stopped by its ceiling carry on where it stopped.
# Delete a line to have the question checked again. To keep a question that
# failed, change its verdict to `overruled`; --withdraw never proposes one.
"""


@dataclass(frozen=True)
class Regated:
    item_id: str
    verdict: str
    date: str
    #: A `withdrawn.REASONS` member for a failure; "-" when there is nothing
    #: to withdraw.
    reason: str
    note: str

    @property
    def failed(self) -> bool:
        return self.verdict.startswith("discarded")


def regate_ledger_path() -> Path:
    """Read at call time, so a test that points BATCH_DIR elsewhere is obeyed."""
    return config.BATCH_DIR / REGATE_LEDGER_NAME


def load_regated(path: Optional[Path] = None) -> dict[str, Regated]:
    """The regate ledger, by item id. A missing file is an empty ledger; a
    malformed line is an error, as it is in withdrawn.txt, because a line read
    wrongly is a question checked again or a failure never proposed."""
    path = Path(path) if path is not None else regate_ledger_path()
    if not path.exists():
        return {}
    out: dict[str, Regated] = {}
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        parts = text.split(None, 4)
        if len(parts) < 5:
            raise ValueError(f"{path.name}:{n}: expected "
                             "'<item id> <verdict> <date> <reason> <what was found>'")
        item_id, verdict, date, reason, note = parts
        if verdict not in VERDICTS:
            raise ValueError(f"{path.name}:{n}: verdict {verdict!r} is not one of "
                             f"{', '.join(VERDICTS)}")
        if reason != "-" and reason not in withdrawn.REASONS:
            raise ValueError(f"{path.name}:{n}: reason {reason!r} is not one of "
                             f"{', '.join(withdrawn.REASONS)} or -")
        if verdict.startswith("discarded") and reason == "-":
            raise ValueError(f"{path.name}:{n}: a {verdict} question needs a reason")
        if item_id in out:
            raise ValueError(f"{path.name}:{n}: {item_id} is recorded twice")
        out[item_id] = Regated(item_id, verdict, date, reason, note.strip())
    return out


def record_regated(entry: Regated, path: Optional[Path] = None) -> None:
    """Append one verdict, at once: the ledger is the run's progress, and a
    run can be stopped by its ceiling between any two items."""
    path = Path(path) if path is not None else regate_ledger_path()
    before = path.read_text(encoding="utf-8") if path.exists() else None
    with path.open("a", encoding="utf-8") as fh:
        if before is None:
            fh.write(_HEADER + "\n")
        elif before and not before.endswith("\n"):
            fh.write("\n")  # a hand edit that left no newline must not swallow this line
        fh.write(f"{entry.item_id}  {entry.verdict:<19}  {entry.date}  {entry.reason:<12}  "
                 f"{' '.join(entry.note.split())}\n")


def _said(trials, *, correct: bool) -> str:
    """The judge's own words from the first trial that went this way."""
    said = next((t.reason.strip() for t in trials if t.correct == correct and t.reason.strip()), "")
    return f"; the reviewer: “{' '.join(said.split())[:200]}”" if said else ""


@dataclass
class Review:
    """What the proofreader and the gate said about one committed question."""
    #: One of VERDICTS but `overruled`, or None when a check could not run —
    #: an outage decides nothing, and is not written down as though it had.
    verdict: Optional[str]
    reason: str = "-"
    note: str = ""


def regate_item(item: dict) -> Review:
    """The proofreader, then the gate if it found nothing. `item` is in
    generator shape (`batch.as_generator_shape`)."""
    sres = sanity.run_check(item)
    if not sres.checked:
        return Review(None, note=f"the proofreader did not run: {sres.notes[:200]}")
    if not sres.ok:
        reason = next((SANITY_REASONS[f] for f in SANITY_REASONS if f in sres.faults), "other")
        return Review("discarded:sanity", reason,
                      f"The proofreader flagged {'+'.join(sres.faults)}"
                      + (f": {' '.join(sres.notes.split())[:240]}" if sres.notes else ""))

    gres = answerability.run_gate(item)
    if gres.verdict == answerability.UNCHECKED or answerability.unanswered(gres.trials):
        # A trial that got no answer would look like a pass on the cold side
        # and like a failure on the full side. It is neither.
        return Review(None, note="the gate could not reach its model for every trial")
    cold = [t for t in gres.trials if t.side == "cold"]
    full = [t for t in gres.trials if t.side == "full"]
    if gres.verdict == "kept":
        return Review("kept", "-", f"sanity=clean cold={sum(t.correct for t in cold)}/{len(cold)} "
                                   f"full={sum(t.correct for t in full)}/{len(full)}")
    if gres.verdict == "discarded:leaky":
        # The options give the answer away. No reason in the closed set says
        # that, so it is `other`, and the sentence is the part worth reading.
        what = answerability.leak_description(item.get("item_type", ""))
        return Review("discarded:leaky", "other",
                      f"The gate's cold view: {what} ({sum(t.correct for t in cold)} of "
                      f"{len(cold)} trials){_said(cold, correct=True)}")
    right = sum(t.correct for t in full)
    chosen = {t.chosen for t in full if not t.correct and t.chosen is not None}
    options = item.get("options") or []
    if not right and len(chosen) == 1 and 0 <= min(chosen) < len(options):
        # Every reading with the whole stimulus settled on the same other
        # option: that is a key the judge disagrees with, not a coin toss.
        k = chosen.pop()
        text = options[k].get("text", "")
        times = {1: "in its one trial", 2: "in both trials"}.get(len(full),
                                                                  f"in all {len(full)} trials")
        return Review("discarded:ambiguous", "wrong_answer",
                      f"The gate's full view: a reviewer with the whole stimulus chose option "
                      f"{k + 1} 「{text[:60]}」 over the key {times}"
                      f"{_said(full, correct=False)}")
    return Review("discarded:ambiguous", "ambiguous",
                  f"The gate's full view: a reviewer with the whole stimulus picked the key in "
                  f"only {right} of {len(full)} trials{_said(full, correct=False)}")


def unregated(bundle: dict, done: dict, gone: Optional[frozenset] = None) -> list[dict]:
    """The bundle's live items with no verdict yet."""
    return [it for it in withdrawn.live_items(bundle, gone) if it.get("id") not in done]


def survey_regate(paths: list[Path]) -> list[Shelf]:
    """What a regate would check, at no cost."""
    gone, done = withdrawn.ids(), load_regated()
    out = []
    for path in paths:
        bundle = batchmod.load(path)
        items = bundle.get("items", [])
        out.append(Shelf(path, len(items), sum(1 for it in items if it.get("id") in gone),
                         unregated(bundle, done, gone)))
    return out


@dataclass
class RegateRun:
    todo: int = 0
    #: (item id, verdict) for every question given a verdict this run.
    checked: list[tuple[str, str]] = field(default_factory=list)
    unchecked: int = 0
    stopped: Optional[str] = None


def regate_bank(paths: list[Path], *, log=print) -> RegateRun:
    """Put every live question with no verdict through the proofreader and
    the gate, writing each verdict down the moment it is reached."""
    run = RegateRun()
    gone, done = withdrawn.ids(), load_regated()
    bundles = [(path, batchmod.load(path)) for path in paths]
    run.todo = sum(len(unregated(b, done, gone)) for _, b in bundles)
    today = _dt.datetime.now(_dt.timezone.utc).date().isoformat()
    strikes = 0
    try:
        for path, bundle in bundles:
            todo = unregated(bundle, done, gone)
            if todo:
                log(f"{path.name}: {len(todo)} question(s) to check")
            for it in todo:
                llmmod.spend.check_ceilings()  # before the item, as in probe_bank
                review = regate_item(batchmod.as_generator_shape(it))
                if review.verdict is None:
                    run.unchecked += 1
                    strikes += 1
                    log(f"  {it['id']}  unchecked: {review.note}")
                    if strikes >= UNREACHABLE_PATIENCE:
                        run.stopped = (f"the checks could not reach their model for {strikes} "
                                       "questions in a row")
                        return run
                    continue
                strikes = 0
                record_regated(Regated(it["id"], review.verdict, today, review.reason, review.note))
                run.checked.append((it["id"], review.verdict))
                log(f"  {it['id']}  {review.verdict}"
                    + (f" → {review.reason}: {review.note}" if review.reason != "-" else
                       f"  {review.note}"))
    except llmmod.LLMBillingError as e:
        run.stopped = str(e)
    return run


def proposals(paths: list[Path]) -> list[tuple[Path, Regated]]:
    """Every live question in these bundles whose recorded verdict is a
    failure nobody has overruled: what `--withdraw` would add to the ledger."""
    gone, done = withdrawn.ids(), load_regated()
    out = []
    for path in paths:
        for it in withdrawn.live_items(batchmod.load(path), gone):
            entry = done.get(str(it.get("id")))
            if entry is not None and entry.failed:
                out.append((path, entry))
    return out


def as_withdrawal(entry: Regated) -> withdrawn.Withdrawal:
    return withdrawn.Withdrawal(entry.item_id, entry.reason, " ".join(entry.note.split()))


def withdraw(found: list[tuple[Path, Regated]]) -> list[Path]:
    """Append the proposals to batches/withdrawn.txt and write the SQL of every
    bundle they touch, through the same path `bjt publish` takes, so the
    committed SQL is what the ledger says. The bundles themselves are not
    touched, and nothing is ever taken out of the ledger. Returns the SQL
    files written."""
    if not found:
        return []
    today = _dt.datetime.now(_dt.timezone.utc).date().isoformat()
    withdrawn.append(
        [as_withdrawal(entry) for _, entry in found],
        heading=(f"{today}: proposed by `bjt regate` — the proofreader and the answerability\n"
                 "gate, run over questions that had skipped both (batches/regated.txt).\n"
                 "Read each before merging: delete a line to keep its question, and mark\n"
                 "it `overruled` in regated.txt so it is not proposed again."))
    out = []
    for path in dict.fromkeys(path for path, _ in found):
        sql, _ = publish.publish_bundle(path)
        out.append(sql)
    return out
