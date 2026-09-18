"""Fidelity mechanism #2 — the two-sided answerability gate.

Every item faces two checks before it reaches the study user:

  * FULL:  answer with the complete stimulus (stem + options). A strong model
           should SUCCEED. Failure means the item is ambiguous rather than hard.
  * COLD:  answer from a reduced view that withholds the stimulus. A strong model
           should FAIL. Success means the distractors leak the answer.

Each side is run several times (config.GATE_TRIALS) and we require consistency —
a model that gets it right once out of three cold is noise, not leakage.

What "the stimulus" means depends on the type:

  * 発言聴解 — the stimulus is the narrated situation, which the test-taker hears
    and cannot re-read. Withholding it is the brief's literal cold view: four
    candidate utterances with no situation should not be separable, because the
    whole point of the type is that appropriateness is situational. If a model
    picks the key from the utterances alone, the item is really a politeness
    ranking with a dressed-up preamble.
  * 語彙・文法 and 表現読解 — these have no separate passage or audio, so the
    literal reading would make cold identical to full. For them the equivalent
    probe is to withhold the *stem* and show only the option set. Same mechanic,
    same interpretation: a cold success means the distractors are individually
    implausible.
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
    #: None for a leaky item: the full side is not run on what is already out.
    full_success_rate: float | None
    verdict: str  # "kept" | "discarded:ambiguous" | "discarded:leaky"
    trials: list[Trial] = field(default_factory=list)

    @property
    def kept(self) -> bool:
        return self.verdict == "kept"


def run_trials(question: str, options: list[str], answer: int, side: str, *,
               model: str, trials: int) -> list[Trial]:
    """Ask `model` the same question `trials` times and score each answer.

    Shared with the difficulty probe (bjt/fidelity/difficulty.py), which asks
    the gate's full-view question of a weaker model. A call that fails — outage,
    refusal, a reply that is not an index — is a trial with `chosen=None`, and
    it is the caller's business whether that counts as wrong (the gate: yes,
    consistency is the point) or as not measured (the probe: yes, a fake rate is
    worse than none).
    """
    out: list[Trial] = []
    for t in range(trials):
        try:
            res = llm.answer_choice(question, options, model=model)
            chosen = int(res.get("choice", -1))
        except (llm.LLMError, ValueError, TypeError):
            chosen = None
        out.append(Trial(side=side, trial=t, chosen=chosen, correct=chosen == answer))
    return out


def _run_side(question: str, options: list[str], answer: int, side: str) -> list[Trial]:
    return run_trials(question, options, answer, side,
                      model=config.JUDGE_MODEL, trials=config.GATE_TRIALS)


def questions(item: dict) -> tuple[str, str]:
    """The full-view and cold-view prompts, worded for the item type."""
    if item.get("item_type") == "hatsugen_choukai":
        full = (
            f"{item['stem']}\n\n"
            "Which of these utterances is the appropriate thing to say in that situation?"
        )
        cold = (
            "A BJT 発言聴解 item asks which utterance fits a described situation. The "
            "situation has been withheld. Based ONLY on the four candidate utterances "
            "below, which one is the intended correct answer?"
        )
        return full, cold

    full = f"{item['stem']}\n\nWhich option correctly completes/answers this item?"
    cold = (
        "The stem of a BJT item has been withheld. Based ONLY on the four candidate "
        "options below, which one is the intended correct answer for the hidden stem?"
    )
    return full, cold


def run_gate(item: dict) -> GateResult:
    """Run the cold side, then the full side only if the cold side passed.

    Cold first because it is the side that discards. A leaky item is out
    whatever the full view says, so asking the full question of it is three
    strong-model calls that cannot change the verdict — and on the first real
    night the gate discarded eighteen items in a row as leaky, every one of
    them after paying for the full view too. Cold-first halves the cost of a
    discard and leaves a kept item exactly as it was: both sides run, both
    rates recorded. A leaky item carries no full rate, not a fake one.
    """
    options = textutil.option_texts(item)
    answer = correct_index(item["options"])

    full_q, cold_q = questions(item)

    cold_trials = _run_side(cold_q, options, answer, "cold")
    cold_rate = sum(t.correct for t in cold_trials) / len(cold_trials)
    if cold_rate > COLD_MAX:
        return GateResult(
            cold_success_rate=cold_rate,
            full_success_rate=None,
            verdict="discarded:leaky",
            trials=cold_trials,
        )

    full_trials = _run_side(full_q, options, answer, "full")
    full_rate = sum(t.correct for t in full_trials) / len(full_trials)
    verdict = "discarded:ambiguous" if full_rate < FULL_MIN else "kept"

    return GateResult(
        cold_success_rate=cold_rate,
        full_success_rate=full_rate,
        verdict=verdict,
        trials=[*full_trials, *cold_trials],
    )
