"""Fidelity mechanism #6 — the cheap sanity check, run the moment an item exists.

The answerability gate (mechanism #2) is the expensive one: two sides, three
trials each, six calls to a strong model per item. It measures the two things
only a strong reader can measure — whether the item is answerable from the
stimulus, and whether the distractors leak the answer. What it does *not* do is
notice that the 解説 explains option 2 while option 1 is marked correct, or that
two options are the same sentence, or that a particle is missing. Those are not
hard judgements. They are proofreading, and paying Opus six times to trip over
one is the wrong shape of spend.

So this runs first, once, on a small model, and the expensive gate only ever
sees items that got past it. A broken item now costs one Haiku call instead of
six Opus ones, and the ones that would have wasted the gate's budget are gone
before it starts.

**What it is allowed to fail an item for.** Only faults that are faults at any
difficulty. An item is *supposed* to be hard: a cheap model disagreeing about
which 敬語 form a senior manager would use is the item working, not the item
broken, and a check that discarded on that would quietly delete exactly the
items worth keeping. So the flags below are worded for defects a proofreader
sees — the marked answer being impossible rather than merely debatable, a second
option being just as right, the explanation naming a different option, Japanese
no writer would produce, options that do not answer the question asked. Anything
that needs expertise to adjudicate is the gate's job, and stays there.

**Unnatural is a fault even in a distractor.** A distractor is wrong on
purpose, and for a long time that exempted it from being read at all. But it
has to be wrong the way people are wrong: a stack of keigo nobody says tells
the learner which option is the silly one and teaches nothing else. The rules
`unnatural_japanese` and `situation_incoherent` are that lesson, from a review
that withdrew 39 of 146 questions on 2026-09-26 (batches/withdrawn.txt). Their
mechanical half — the patterns no reader is needed for — runs offline and for
free in `naturalness.faults`.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .. import config, llm, schemas
from ..render import document

#: flag → what a `true` on it means, in the words the model is shown. Keys are
#: the schema's required properties, so adding a rule here adds it to the call.
RULES: dict[str, str] = {
    "answer_impossible": (
        "the option marked correct cannot be the answer — it is ungrammatical, "
        "contradicts the situation, or answers a different question. NOT merely "
        "that you would have argued for another option"
    ),
    "second_answer_defensible": (
        "another option is just as correct as the one marked correct, so the item "
        "has two answers — including a distractor that is standard, natural Japanese "
        "in this exact sentence and situation, which a native editor would not "
        "correct, marked wrong only on preference (ご確認くださいますよう beside "
        "ご確認いただきますよう). A register the situation really rules out, such as "
        "外しています to a client on the phone, is a wrong answer, not a second one"
    ),
    "explanation_mismatch": (
        "the 解説 justifies a different option than the one marked correct, or "
        "states something the item contradicts"
    ),
    "broken_japanese": (
        "Japanese no writer would produce: a typo, a dropped or wrong particle, a "
        "mangled 敬語 form, a truncated sentence. NOT unusual-but-correct wording, "
        "and NOT a distractor that is deliberately impolite or wrongly pitched — "
        "those are the point of the item"
    ),
    # The two below are what a review of the whole bank found on 2026-09-26 and
    # the four above did not ask about: 39 of 146 questions were withdrawn
    # (batches/withdrawn.txt), almost all answerable and correctly keyed, and
    # almost all unnatural. The exemption in `broken_japanese` for deliberately
    # wrong distractors is where most of them had been hiding.
    "unnatural_japanese": (
        "a line — in the stimulus, the correct option OR a distractor — that no native "
        "speaker would actually say or write, even though each word is real: an "
        "invented keigo stack (させていただかせていただく, 申させていただく), an "
        "honorific given to a thing (宅配便がお見えになる), a parody chain of set phrases, "
        "a placeholder read as a name (〇〇商事), a sentence whose halves do not connect. "
        "NOT a distractor wrong the way real people are wrong — one common 二重敬語, "
        "casual speech to a superior — and NOT a 語彙・文法 option whose role is "
        "nonexistent_form, which is meant not to be a word"
    ),
    "situation_incoherent": (
        "the item does not hang together: the narration states the answer, an option "
        "is about a different person from the one the question asks about, the 解説 "
        "or a why describes a different situation from the stem, cause and effect in "
        "the story run backwards, or the setup is not something that happens in a "
        "Japanese office (asking a peer for permission to leave, asking another "
        "department's permission on a posted notice)"
    ),
    "options_not_parallel": (
        "the options do not answer the question the stem asks, or two of them say "
        "the same thing in different words"
    ),
}


@dataclass
class SanityResult:
    #: Every rule that came back true. Empty means the item reads clean.
    faults: list[str] = field(default_factory=list)
    notes: str = ""
    #: False when no check ran — switched off, or the call failed. An item that
    #: was never checked is not an item that passed, and the caller says which.
    checked: bool = True

    @property
    def ok(self) -> bool:
        return not self.faults

    def detail(self) -> str:
        if not self.checked:
            return "sanity=skipped"
        if self.ok:
            return "sanity=clean"
        return f"sanity={'+'.join(self.faults)}"


def render_for_sanity(item: dict) -> str:
    """Everything the item is made of, answer included.

    The discriminator's renderer deliberately hides our metadata and shows the
    item as a test-taker meets it. This one is the opposite: the checker is
    proofreading, so it is shown the stimulus AND the answer key AND the
    explanation, because half of what it is looking for is a disagreement
    between them.
    """
    lines = [f"[{item.get('item_type', '')} / {item.get('level', '')}]"]

    who = " → ".join(x for x in (item.get("speaker_role"), item.get("listener_role")) if x)
    if who or item.get("channel"):
        lines.append(f"場面: {who}（{item.get('channel', '')}）")

    for doc in schemas.documents_of(item):
        lines.append("--- 資料 ---")
        lines.append(document.text_of(doc))

    turns = item.get("dialogue") or []
    if turns:
        lines.append("--- 会話 ---")
        lines.extend(f"{t.get('speaker_role', '')}：{t.get('text', '')}" for t in turns)

    lines.append("--- 問題 ---")
    lines.append(item.get("stem", ""))
    # Each option with its role: `unnatural_japanese` must not fire on a
    # 語彙・文法 distractor built not to be a word, and without the role the
    # checker cannot tell that one from a mistake.
    for i, o in enumerate(item.get("options", [])):
        lines.append(f"{i}. {o.get('text', '')}　［{o.get('role', '')}］")

    ci = schemas.correct_index(item["options"])
    lines.append(f"正解として印がついているのは: {ci}. {item['options'][ci].get('text', '')}")
    lines.append(f"解説: {item.get('explanation_ja', '')}")
    if item.get("explanation_en"):
        lines.append(f"English gloss: {item['explanation_en']}")
    return "\n".join(lines)


def run_check(item: dict, *, model: str | None = None) -> SanityResult:
    """One call. A failure to reach the model is not a failure of the item.

    An item that could not be checked is reported as unchecked rather than as
    clean: the expensive gate still runs on it, and the batch's own offline
    checks still see it. Treating an outage as a pass would be the one way this
    mechanism could make the library worse than not having it.
    """
    if not config.SANITY_ENABLED:
        return SanityResult(checked=False, notes="sanity check disabled")
    try:
        verdict = llm.sanity_check(render_for_sanity(item), RULES, model=model)
    except llm.LLMError as e:
        return SanityResult(checked=False, notes=f"sanity check did not run: {e}")

    faults = [rule for rule in RULES if verdict.get(rule) is True]
    return SanityResult(faults=faults, notes=str(verdict.get("notes", "")))
