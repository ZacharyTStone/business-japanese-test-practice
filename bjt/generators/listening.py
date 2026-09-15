"""The listening types whose stimulus is a scene rather than an utterance.

場面把握 and 総合聴解 share a shape: something is heard once, and the question is
about what was heard rather than about what to say next. That makes their traps
memory traps — a distractor that was true of a different speaker, or true earlier
in the conversation — which is a different job from 発言聴解's 敬語 direction, and
the reason they are separate generators rather than one with a flag.

What they do share is the listening constraint, and it is severe: the learner
hears the stimulus once and cannot go back. Every clue the question turns on has
to be in there, said plainly, in the order somebody would actually say it.
"""
from __future__ import annotations

from .base import Generator

#: Said once, in every prompt for a heard item. The single biggest difference
#: between an item that works and one that merely reads well is whether it
#: survives being heard rather than read.
_HEARD_ONCE = (
    "This is heard, once, with nothing on the page to go back to. So: no written-only "
    "devices (parentheses, bullet points, ＿＿＿ blanks, 「A社」 as a written abbreviation "
    "read aloud); every fact the question turns on must be stated plainly rather than "
    "implied by layout; and nothing that matters may sit in a subordinate clause at the "
    "very end, where a listener has already committed to an interpretation."
)


class BamenHaakuGenerator(Generator):
    """場面把握問題 — where is this, who is talking, what happens next."""

    item_type = "bamen_haaku"
    label = "場面把握問題 (situation grasp, listening)"
    requires_cell = True
    task_spec = (
        "Format: `stem` is what the NARRATOR reads aloud — a short moment at work (one "
        "or two turns of speech, or a brief description of what is happening), ending "
        "with a question about the situation itself, such as 「ここはどこですか。」"
        "「このあと何をしますか。」. The four options are short STATEMENTS about the "
        "situation, read on the page — they are not things anybody says.\n"
        f"{_HEARD_ONCE}\n"
        "The situation must be identifiable from what is heard and from nothing else. "
        "In particular it must not be identifiable from the scene image: the picture is "
        "a shared bank entry used by many items, so an item answerable from the picture "
        "is answerable without listening at all.\n"
        "Keep the four options parallel in form and length. The correct one is the only "
        "one the audio supports; each distractor is defensible until you remember what "
        "was actually said."
    )

    def cell_spec(self, cell) -> str:
        scenes = "、".join(cell.scenes)
        return (
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions:\n"
            f"- 場面: {cell.setting_ja}\n"
            f"- 関係: {cell.relation_ja}\n"
            f"- 設問が問うこと: {cell.function_ja}\n"
            f"- channel: {cell.channel}\n"
            f"- scene_id: choose exactly one of: {scenes}\n"
            "The question must ask exactly the 設問が問うこと above. Set `channel` to the "
            "value given."
        )

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        return _scene_and_channel_errors(item, cell)


class SougouChoukaiGenerator(Generator):
    """総合聴解問題 — a meeting or presentation, then questions about it."""

    item_type = "sougou_choukai"
    label = "総合聴解問題 (integrated listening)"
    requires_cell = True
    task_spec = (
        "Format: `dialogue` is the exchange the test-taker hears — three to eight turns "
        "across two or three speaker ROLES (never personal names; roles cast the "
        "voices). `stem` is what the narrator asks afterwards. The four options answer "
        "that question.\n"
        f"{_HEARD_ONCE}\n"
        "The exchange must be a real one: people interrupt, revise, and settle things "
        "late. Use that — it is where this type's distractors come from. At least one "
        "fact should be stated and then amended before the end, so that "
        "`superseded_by_later_turn` is a genuine trap rather than a decorative label, "
        "and at least two speakers should assert something, so that "
        "`stated_by_wrong_speaker` is too.\n"
        "The question must NOT be answerable from the last turn alone. If it is, the "
        "item is testing whether somebody was still awake, not whether they followed "
        "the conversation."
    )

    def cell_spec(self, cell) -> str:
        scenes = "、".join(cell.scenes)
        return (
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions:\n"
            f"- 場面: {cell.setting_ja}\n"
            f"- 参加者の関係: {cell.relation_ja}\n"
            f"- 設問が問うこと: {cell.function_ja}\n"
            f"- channel: {cell.channel}\n"
            f"- scene_id: choose exactly one of: {scenes}\n"
            "Every turn's `speaker_role` must be consistent with 参加者の関係."
        )

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        return _scene_and_channel_errors(item, cell)


def _scene_and_channel_errors(item: dict, cell) -> list[str]:
    """The cell is an assignment, so check the model honoured it.

    A wrong scene id means the item has no picture; a wrong channel means it
    gets the wrong TTS treatment, which for a phone item means an easier
    question than the one we meant to ask.
    """
    errors: list[str] = []
    if cell is None:
        return errors
    if cell.scenes and item.get("scene_id") not in cell.scenes:
        errors.append(
            f"scene_id {item.get('scene_id')!r} is not one of this cell's scenes: "
            f"{list(cell.scenes)}"
        )
    if item.get("channel") != cell.channel:
        errors.append(
            f"channel {item.get('channel')!r} does not match the cell's {cell.channel!r}"
        )
    return errors
