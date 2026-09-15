"""発言聴解問題 generator — "what do you say here?".

The test-taker sees a picture, hears a narrated situation, then hears four
utterances and picks the one that fits. Nothing is on the page: the stem is
spoken once, so it has to carry the whole situation — who is speaking, to whom,
and what they are trying to do — in two or three sentences.

This is the type the whole pipeline is being proved on first, because it
exercises every hard part at once: 敬語 direction, ウチ/ソト, phone protocol, a
reused scene image, and TTS. Everything downstream (images, audio, the app's
review notes) is shaped by what this type needs.

Its variety comes from the seed table, never from the prompt — see
``bjt/seedtable.py`` and ``requires_cell``.
"""
from __future__ import annotations

from .base import Generator


class HatsugenChoukaiGenerator(Generator):
    item_type = "hatsugen_choukai"
    label = "発言聴解問題 (situational utterance choice)"
    requires_cell = True
    task_spec = (
        "Format: `stem` is what the NARRATOR reads aloud — two or three sentences "
        "setting up the situation, ending with a question such as 「こんなとき、何と"
        "言いますか。」. The four options are what the SPEAKER says, verbatim, as "
        "spoken Japanese. Exactly one is appropriate.\n"
        "Constraints that follow from this being a listening item:\n"
        "- The stem is heard once and cannot be re-read. Keep it short, concrete, and "
        "front-load who is speaking to whom. No written-only devices (parentheses, "
        "bullet points, ＿＿＿ blanks).\n"
        "- Every option must be something a real employee could plausibly say out loud, "
        "of similar length, and similar enough in surface wording that the choice turns "
        "on 敬意の方向 or 場面 fit — not on one option being obviously absurd.\n"
        "- Do not let the correct option be the longest or the most polite one as a "
        "rule; over-politeness is itself one of the traps.\n"
        "- Use roles, not personal names, for the speaker and the listener. Where a "
        "company or person must be named inside an utterance, use plain placeholder-"
        "style names (山田, A社) so voices and scenes stay reusable."
    )

    def cell_spec(self, cell) -> str:
        scenes = "、".join(cell.scenes)
        channel_note = {
            "phone": (
                "This is a telephone item: the speaker and listener cannot see each "
                "other, so the utterance must carry the phone conventions (naming "
                "oneself and one's company, 「いつもお世話になっております」, relaying "
                "absence with 謙譲語 and no 敬称 on one's own colleagues)."
            ),
            "video": (
                "This is an online-meeting item: the two can see each other but the "
                "connection shapes the wording (interrupting, asking someone to repeat, "
                "confirming that a screen is visible)."
            ),
            "in_person": "This is a face-to-face item.",
        }[cell.channel]
        return (
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions — do not substitute a different setting, "
            "relationship, or communicative function:\n"
            f"- 場面: {cell.setting_ja}\n"
            f"- 関係: {cell.relation_ja}（発話するのはこの矢印の左側の人）\n"
            f"- 機能（この発話でしたいこと）: {cell.function_ja}\n"
            f"- channel: {cell.channel} — {channel_note}\n"
            f"- scene_id: choose exactly one of: {scenes}\n"
            "Set `channel` to exactly the value above. Set `speaker_role` and "
            "`listener_role` to short role labels consistent with 関係."
        )

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        """The cell is an assignment, so check the model actually honoured it —
        a wrong scene_id means the item has no picture, and a wrong channel means
        it gets the wrong TTS treatment."""
        errors: list[str] = []
        if cell is None:
            return errors
        if item.get("scene_id") not in cell.scenes:
            errors.append(
                f"scene_id {item.get('scene_id')!r} is not one of this cell's scenes: "
                f"{list(cell.scenes)}"
            )
        if item.get("channel") != cell.channel:
            errors.append(
                f"channel {item.get('channel')!r} does not match the cell's {cell.channel!r}"
            )
        return errors
