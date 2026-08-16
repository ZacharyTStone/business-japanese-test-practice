"""表現読解問題 generator — expression / keigo appropriateness.

A short business situation fixes the speaker, the listener, and their relative
status; the four options are candidate utterances. Exactly one is appropriate for
that situation. The distractors are grammatical but wrong on register, honorific
direction, or speech act.
"""
from __future__ import annotations

from .base import Generator


class HyougenGenerator(Generator):
    item_type = "hyougen"
    label = "表現読解問題 (expression / keigo)"
    task_spec = (
        "Format: the stem states a short business situation that fixes WHO is speaking, "
        "to WHOM, and their relative status (e.g. 部下 to 部長, 社員 to 取引先), then asks "
        "which utterance is appropriate. The four options are candidate utterances. "
        "Exactly one is appropriate; each distractor is grammatical Japanese that is "
        "wrong for this situation on honorific direction, register, or speech act. The "
        "situation must be specific enough that appropriateness is unambiguous, but the "
        "utterances alone (without the situation) must not reveal which is correct."
    )
