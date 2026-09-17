"""The difficulty probe — a second, cheaper measurement, run on the items the gate kept.

`items.model_p_correct` is the practice queue's prior on how hard an item is,
used until enough learners have answered it for the bank to count. Until now it
was the answerability gate's own full-view success rate, and that number was
nearly useless as a prior: the gate asks a strong model, with the whole
stimulus in front of it, whether the item can be answered at all, and a strong
model says yes to almost everything. With three trials the rate could only be
0.67 or 1.0, and it was 1.0 for nearly every item that shipped — a prior that
does not vary cannot order anything.

The gate is right as it is. "Answerable?" and "leaky?" are questions for a
strong reader, and they are pass/fail. Difficulty is a different question with
a different instrument: a *weaker* model, asked the same full-view question
several times, fails on some items and not others, and the items it fails on
are, roughly, the ones a learner would find hard. That spread is the whole
value. So this runs the gate's full view again on `config.DIFFICULTY_MODEL`
(the proofreader's cheap model by default) for `config.DIFFICULTY_TRIALS`
trials, and the pass rate is what ships as `model_p_correct`.

Two rules the caller relies on:

  * It runs after the gate and only on items the gate kept (or when the gate
    was skipped). Cheapest-first is the pipeline's shape: nothing is spent
    measuring the difficulty of an item that is not going to ship.
  * A probe that could not run — switched off, model unreachable, refusals —
    reports `measured=False` and no rate. The caller then falls back to the
    gate's rate exactly as before. A fabricated number would be worse than the
    old bad one, because the queue would trust it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .. import config, textutil
from ..schemas import correct_index
from . import answerability
from .answerability import Trial

#: The `side` the probe's trials are recorded under in `gate_trials`, next to
#: the gate's 'cold' and 'full'.
SIDE = "difficulty"


@dataclass
class DifficultyResult:
    #: Fraction of trials the probe answered correctly. None when not measured.
    rate: float | None = None
    #: Which model produced the rate, so a batch's provenance is readable later.
    model: str = ""
    #: False when no rate was produced — switched off, or the model could not
    #: be reached for every trial. Never confuse that with a rate of 0.0.
    measured: bool = False
    notes: str = ""
    trials: list[Trial] = field(default_factory=list)

    def detail(self) -> str:
        if not self.measured:
            return "difficulty=skipped" if not self.trials else "difficulty=unmeasured"
        return f"difficulty={self.rate:.0%} ({self.model})"


def measure(item: dict, *, model: str | None = None) -> DifficultyResult:
    """Ask the difficulty model the gate's full-view question, several times.

    Every trial has to come back with an answer for the rate to count. A trial
    the model did not answer is not a wrong answer — the gate scores it that
    way because it is testing consistency, but here it would drag the rate down
    and call the item harder than it is — so one failed trial leaves the item
    unmeasured and the caller on the gate's rate.
    """
    if not config.DIFFICULTY_ENABLED:
        return DifficultyResult(measured=False, notes="difficulty probe disabled")

    model = model or config.DIFFICULTY_MODEL
    options = textutil.option_texts(item)
    answer = correct_index(item["options"])
    full_q, _cold_q = answerability.questions(item)

    trials = answerability.run_trials(full_q, options, answer, SIDE,
                                      model=model, trials=config.DIFFICULTY_TRIALS)
    unanswered = [t for t in trials if t.chosen is None]
    if not trials or unanswered:
        return DifficultyResult(
            model=model, measured=False, trials=trials,
            notes=f"difficulty probe did not run: {len(unanswered)} of {len(trials)} "
                  "trial(s) got no answer",
        )
    rate = sum(t.correct for t in trials) / len(trials)
    return DifficultyResult(rate=rate, model=model, measured=True, trials=trials)
