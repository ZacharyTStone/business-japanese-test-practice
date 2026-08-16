"""Fidelity mechanism #2 — the two-sided answerability gate.

Every item faces two checks before it reaches the study user:

  * FULL:  answer with the complete stimulus (stem + options). A strong model
           should SUCCEED. Failure means the item is ambiguous rather than hard.
  * COLD:  answer from a reduced view that withholds the stimulus. A strong model
           should FAIL. Success means the distractors leak the answer.

Each side is run several times (config.GATE_TRIALS) and we require consistency —
a model that gets it right once out of three cold is noise, not leakage.

Adaptation for phase-1 item types: 語彙・文法 and 表現読解 have no separate
passage or audio, so the brief's literal "cold = stem+options, no passage" would
make cold identical to full. For these text-only types the meaningful leakage
probe is to withhold the *stem* and show only the option set: if a strong model
can still pick the key from the four options alone, the distractors are
individually implausible and the item leaks. This is documented in the README.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .. import config, llm, textutil
from ..schemas import correct_index

# Keep an item only if the full view is answered by a clear majority...
FULL_MIN = 2 / 3
# ...and the cold view is NOT — anything above this is treated as leakage.
COLD_MAX = 1 / 3


@dataclass
class Trial:
    side: str
    trial: int
    chosen: int | None
    correct: bool


@dataclass
class GateResult:
    cold_success_rate: float
    full_success_rate: float
    verdict: str  # "kept" | "discarded:ambiguous" | "discarded:leaky"
    trials: list[Trial] = field(default_factory=list)

    @property
    def kept(self) -> bool:
        return self.verdict == "kept"


def _run_side(question: str, options: list[str], answer: int, side: str) -> list[Trial]:
    trials: list[Trial] = []
    for t in range(config.GATE_TRIALS):
        try:
            res = llm.answer_choice(question, options, model=config.JUDGE_MODEL)
            chosen = int(res.get("choice", -1))
        except (llm.LLMError, ValueError, TypeError):
            chosen = None
        trials.append(Trial(side=side, trial=t, chosen=chosen, correct=chosen == answer))
    return trials


def run_gate(item: dict) -> GateResult:
    """Run both sides and decide the verdict."""
    options = textutil.option_texts(item)
    answer = correct_index(item["options"])

    full_q = f"{item['stem']}\n\nWhich option correctly completes/answers this item?"
    cold_q = (
        "The stem of a BJT item has been withheld. Based ONLY on the four candidate "
        "options below, which one is the intended correct answer for the hidden stem?"
    )

    full_trials = _run_side(full_q, options, answer, "full")
    cold_trials = _run_side(cold_q, options, answer, "cold")

    full_rate = sum(t.correct for t in full_trials) / len(full_trials)
    cold_rate = sum(t.correct for t in cold_trials) / len(cold_trials)

    if full_rate < FULL_MIN:
        verdict = "discarded:ambiguous"
    elif cold_rate > COLD_MAX:
        verdict = "discarded:leaky"
    else:
        verdict = "kept"

    return GateResult(
        cold_success_rate=cold_rate,
        full_success_rate=full_rate,
        verdict=verdict,
        trials=[*full_trials, *cold_trials],
    )
