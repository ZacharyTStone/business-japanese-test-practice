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
    requires_cell = True
    task_spec = (
        "Format: the stem states a short business situation that fixes WHO is speaking, "
        "to WHOM, and their relative status (e.g. 部下 to 部長, 社員 to 取引先), then asks "
        "which utterance is appropriate. The four options are candidate utterances. "
        "Exactly one is appropriate; each distractor is grammatical Japanese that is "
        "wrong for this situation on honorific direction, register, or speech act. The "
        "situation must be specific enough that appropriateness is unambiguous, but the "
        "utterances alone (without the situation) must not reveal which is correct.\n"
        "What separates this type from 語彙・文法 is what decides the answer. There, the "
        "language system decides — that suffix does not exist. Here, the RELATIONSHIP "
        "decides: every one of the four options is real, attested, grammatical Japanese "
        "that a native speaker uses, and exactly one of them fits this speaker saying it "
        "to this listener. If a distractor is wrong in a way you could explain without "
        "knowing who is talking to whom, it belongs in 語彙・文法.\n"
        "The exam's own advice to candidates names the axis: work out whether this is "
        "社内 or 社外, and if 社内, whether it is 上司⇄部下 or 同僚⇄同僚. Build the four "
        "options so they differ along that axis — height of politeness, directness, how "
        "much cushioning — rather than along topic."
    )

    def cell_spec(self, cell) -> str:
        channel_note = {
            "written": "The options are written expressions — lines from an email, a "
                       "chat message, or a notice. They must read as text, not as "
                       "transcribed speech, and the 定型表現 conventions of written "
                       "business Japanese apply.",
            "in_person": "The options are spoken face to face.",
            "phone": "The options are spoken on the telephone, where neither party can "
                     "see the other and the fixed call conventions apply.",
            "video": "The options are spoken in an online meeting.",
        }[cell.channel]
        return (
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions — do not substitute a different setting, "
            "relationship, or communicative function:\n"
            f"- 場面: {cell.setting_ja}\n"
            f"- 関係: {cell.relation_ja}（表現を選ぶのはこの矢印の左側の人）\n"
            f"- 機能（この表現でしたいこと）: {cell.function_ja}\n"
            f"- channel: {cell.channel} — {channel_note}\n"
            "The stem states the situation and asks which expression fits. It must name "
            "who is addressing whom and what they are trying to do, because the options "
            "alone must not reveal the answer."
        )
