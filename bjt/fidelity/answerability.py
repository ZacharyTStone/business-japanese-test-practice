"""Fidelity mechanism #2 — the two-sided answerability gate.

Every item faces two checks before it reaches the study user:

  * FULL:  answer with the complete stimulus — every document, every turn of the
           conversation, the narration, the options. A strong model should
           SUCCEED. Failure means the item is ambiguous rather than hard.
  * COLD:  answer from a reduced view that withholds the half of the stimulus
           the type is testing. A strong model should FAIL. Success means the
           withheld half was decorative.

Each side is run up to config.GATE_TRIALS times and the verdict is by count, so
a model that gets it right once out of three cold is noise, not leakage.

What is withheld depends on the type, and the choice is the type's own claim:

  * 発言聴解 — the stimulus is the narrated situation, which the test-taker hears
    and cannot re-read. Withholding it is the brief's literal cold view: four
    candidate utterances with no situation should not be separable, because the
    whole point of the type is that appropriateness is situational.
  * 語彙・文法, 表現読解, 場面把握 — nothing but a stem and four options, so the
    stem is withheld and only the option set is shown. A cold success means the
    distractors are individually implausible.
  * 状況把握, 資料聴読解, 総合聴読解 — the README's one requirement for these is
    that the answer needs BOTH the document and the audio. So the cold view is
    the document (with the options) and the audio withheld: a reader who can
    pick the key from the page alone has an item whose audio is decorative.
    That is also what an options-only cold view would catch, and more, so the
    two are not both run.
  * 総合聴解 — the question and options without the conversation.
  * 総合読解 — the question and options without the passage.
  * 画像把握 — the picture is the stimulus and a text gate cannot see it, so the
    English brief the picture is drawn from stands in for it on the full side.
    The picture itself is judged when it is drawn (bjt/scene_art.py).

Until 2026-09-19 the full view was the stem alone for every type, so for a
document or dialogue type the judge never saw the document or the dialogue:
items answerable from the narration alone were kept, and items that genuinely
needed the page were discarded as ambiguous — the exact opposite of the
requirement, at the price of a night's generations.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Callable, Optional

from .. import config, llm, schemas, textutil
from ..render import document
from ..schemas import correct_index

# Keep an item only if the full view is answered by a clear majority...
FULL_MIN = Fraction(2, 3)
# ...and the cold view is NOT — anything above this is treated as leakage.
COLD_MAX = Fraction(1, 3)


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


#: (correct so far, trials run, trials planned) → True once no remaining trial
#: could change the verdict. The gate's early stop.
Decided = Callable[[int, int, int], bool]


def run_trials(question: str, options: list[str], answer: int, side: str, *,
               model: str, trials: int, decided: Optional[Decided] = None) -> list[Trial]:
    """Ask `model` the same question up to `trials` times and score each answer.

    Shared with the difficulty probe (bjt/fidelity/difficulty.py), which asks
    the gate's full-view question of a weaker model. A call that fails — outage,
    refusal, a reply that is not an index — is a trial with `chosen=None`, and
    it is the caller's business whether that counts as wrong (the gate: yes,
    consistency is the point) or as not measured (the probe: yes, a fake rate is
    worse than none).

    `decided` is the early stop. The gate's verdicts are by count over the
    planned trials, so once the count already settles the verdict — two right
    of three on the cold side, say — the third call cannot change it and is
    not made. The verdict is identical to running every trial; only the bill
    is smaller. The probe passes nothing here: it wants the rate itself.
    """
    out: list[Trial] = []
    for t in range(trials):
        try:
            res = llm.answer_choice(question, options, model=model)
            chosen = int(res.get("choice", -1))
        except (llm.LLMError, ValueError, TypeError):
            chosen = None
        out.append(Trial(side=side, trial=t, chosen=chosen, correct=chosen == answer))
        if decided and decided(sum(x.correct for x in out), len(out), trials):
            break
    return out


def is_leaky(correct: int, planned: int) -> bool:
    return Fraction(correct, planned) > COLD_MAX


def is_ambiguous(correct: int, planned: int) -> bool:
    return Fraction(correct, planned) < FULL_MIN


def cold_decided(correct: int, done: int, planned: int) -> bool:
    """Leaky already, or clean even if every remaining trial were right."""
    return is_leaky(correct, planned) or not is_leaky(correct + (planned - done), planned)


def full_decided(correct: int, done: int, planned: int) -> bool:
    """Answerable already, or ambiguous even if every remaining trial were right."""
    return not is_ambiguous(correct, planned) or is_ambiguous(correct + (planned - done), planned)


def _run_side(question: str, options: list[str], answer: int, side: str,
              decided: Decided) -> list[Trial]:
    return run_trials(question, options, answer, side,
                      model=config.JUDGE_MODEL, trials=config.GATE_TRIALS, decided=decided)


# ----- the two views ------------------------------------------------------

def _documents_text(item: dict) -> str:
    docs = schemas.documents_of(item)
    if not docs:
        return ""
    return "\n\n".join(f"=== 資料 {i + 1} ===\n{document.text_of(d)}" for i, d in enumerate(docs))


def _dialogue_text(item: dict) -> str:
    turns = item.get("dialogue") or []
    if not turns:
        return ""
    return "=== 会話 ===\n" + "\n".join(
        f"{t.get('speaker_role', '')}：{t.get('text', '')}" for t in turns)


def _join(*parts: str) -> str:
    return "\n\n".join(p for p in parts if p)


#: Which half is withheld on the cold side, in the words the judge is shown.
_WITHHELD: dict[str, str] = {
    "joukyou_haaku": "the spoken request",
    "shiryou_choudokkai": "the spoken prompt",
    "sougou_choudokkai": "the conversation and the spoken question",
    "sougou_choukai": "the conversation",
    "sougou_dokkai": "the passage",
}


def questions(item: dict) -> tuple[str, str]:
    """The full-view and cold-view prompts, worded for the item type."""
    item_type = item.get("item_type", "")
    stem = item.get("stem", "")
    docs = _documents_text(item)
    dialogue = _dialogue_text(item)

    if item_type == "hatsugen_choukai":
        full = _join(stem, "Which of these utterances is the appropriate thing to say "
                           "in that situation?")
        cold = (
            "A BJT 発言聴解 item asks which utterance fits a described situation. The "
            "situation has been withheld. Based ONLY on the four candidate utterances "
            "below, which one is the intended correct answer?"
        )
        return full, cold

    if item_type == "gazou_haaku":
        brief = item.get("image_brief", "")
        full = _join(
            "The test-taker is shown a picture. This is what the picture shows:\n" + brief,
            stem, "Which option correctly describes the picture?")
        cold = (
            "A BJT 画像把握 item shows a picture and asks which spoken description fits "
            "it. The picture and the question have been withheld. Based ONLY on the "
            "four candidate descriptions below, which one is the intended correct answer?"
        )
        return full, cold

    if item_type in ("joukyou_haaku", "shiryou_choudokkai", "sougou_choudokkai"):
        full = _join(docs, dialogue, stem,
                     "Using the document(s) and what was said, which option is correct?")
        cold = _join(
            docs,
            f"A BJT {item_type} item pairs the document(s) above with audio: "
            f"{_WITHHELD[item_type]}. The audio has been withheld. Based ONLY on the "
            "document(s) and the four options below, which one is the intended "
            "correct answer?")
        return full, cold

    if item_type == "sougou_choukai":
        full = _join(dialogue, stem, "Which option correctly answers the question?")
        cold = _join(
            stem,
            "This question is about a conversation that has been withheld. Based ONLY "
            "on the question and the four options below, which one is the intended "
            "correct answer?")
        return full, cold

    if item_type == "sougou_dokkai":
        full = _join(docs, stem, "Which option correctly answers the question?")
        cold = _join(
            stem,
            "This question is about a passage that has been withheld. Based ONLY on "
            "the question and the four options below, which one is the intended "
            "correct answer?")
        return full, cold

    full = _join(docs, dialogue, stem, "Which option correctly completes/answers this item?")
    cold = (
        "The stem of a BJT item has been withheld. Based ONLY on the four candidate "
        "options below, which one is the intended correct answer for the hidden stem?"
    )
    return full, cold


def leak_description(item_type: str) -> str:
    """What a leaky verdict means for this type, in one sentence for the
    generator's next attempt (bjt/cli.py feeds it back)."""
    if item_type in _WITHHELD:
        return (f"a reviewer picked the correct option without {_WITHHELD[item_type]}, "
                "so the withheld half was decorative — the answer must depend on it")
    if item_type == "hatsugen_choukai":
        return ("a reviewer picked the correct utterance without hearing the situation, "
                "so the distractors gave the answer away on their own")
    return ("a reviewer picked the correct option from the four options alone, with "
            "the stem hidden, so the distractors gave the answer away on their own")


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
    planned = config.GATE_TRIALS

    full_q, cold_q = questions(item)

    cold_trials = _run_side(cold_q, options, answer, "cold", cold_decided)
    cold_correct = sum(t.correct for t in cold_trials)
    cold_rate = cold_correct / len(cold_trials)
    if is_leaky(cold_correct, planned):
        return GateResult(
            cold_success_rate=cold_rate,
            full_success_rate=None,
            verdict="discarded:leaky",
            trials=cold_trials,
        )

    full_trials = _run_side(full_q, options, answer, "full", full_decided)
    full_correct = sum(t.correct for t in full_trials)
    full_rate = full_correct / len(full_trials)
    verdict = "discarded:ambiguous" if is_ambiguous(full_correct, planned) else "kept"

    return GateResult(
        cold_success_rate=cold_rate,
        full_success_rate=full_rate,
        verdict=verdict,
        trials=[*full_trials, *cold_trials],
    )
