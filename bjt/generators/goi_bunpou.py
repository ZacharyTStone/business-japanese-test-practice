"""語彙・文法問題 generator — vocabulary and grammar.

A single carrier sentence with one blank (＿＿＿) and four options; exactly one
completes the sentence correctly. The tested knowledge is the word or grammatical
form itself, so the trap is built entirely in the option set.
"""
from __future__ import annotations

from .base import Generator


class GoiBunpouGenerator(Generator):
    item_type = "goi_bunpou"
    label = "語彙・文法問題 (vocabulary/grammar)"
    task_spec = (
        "Format: a natural business sentence containing exactly one blank written as "
        "＿＿＿. The four options are candidate fillers for that blank. Exactly one is "
        "correct; the sentence must be genuinely natural business Japanese with the "
        "correct filler and clearly wrong with each distractor. The carrier sentence "
        "must supply enough context that the answer is unambiguous WITH the sentence, "
        "but the option set alone must not give the answer away."
    )
