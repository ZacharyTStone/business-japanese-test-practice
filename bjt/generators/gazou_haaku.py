"""画像把握問題 generator — "what is happening in this picture?".

The test-taker sees a picture, hears a short question about it, then hears four
descriptions and picks the one that is true of the picture. Nothing is on the
page but the drawing, and the drawing is the whole stimulus — the opposite of
every other type here, whose pictures come from a shared bank and must give
nothing away.

So this generator writes two things that have to agree: the four spoken
descriptions, and an English brief from which the picture is drawn afterwards
(`bjt scenes --generate`, bjt/scene_art.py). The brief is judged twice: a
reviewer checks the draft against it, and then sits the item — the draft is
refused unless the reviewer, shown the picture and the four descriptions,
picks the marked one every time. That is why the brief must be concrete: a
generic office picture passes no such test. The owner asked for exactly this
(2026-09-19): pictures that are clear and not generic, in a type that need not
be common.

Its variety comes from the seed table — the `function` axis is the action
being depicted — never from the prompt.
"""
from __future__ import annotations

from .base import Generator


class GazouHaakuGenerator(Generator):
    item_type = "gazou_haaku"
    label = "画像把握問題 (picture situation grasp, listening)"
    requires_cell = True
    task_spec = (
        "Format: `image_brief` describes, in English, the ONE picture the test-taker "
        "sees. `stem` is the narrator's question about it, heard once. The four options "
        "are spoken descriptions of the picture in plain polite Japanese (〜ています "
        "form), of similar length and shape; exactly one is true of the picture.\n"
        "The picture is the whole stimulus, so:\n"
        "- Every distractor must be VISIBLY false — contradicted by something that is "
        "drawn — not merely unmentioned. A description that could be true of the "
        "picture is a second right answer.\n"
        "- The brief must make the correct description unmistakable at a glance: the "
        "action, who is doing it to whom, and where. Name the objects (a tray with two "
        "cups, a stack of papers, a handset) and the postures (standing, holding out "
        "with both hands, bowing). Say how many people there are and which one the "
        "question is about, and say what is deliberately not shown.\n"
        "- Nothing written may appear in the picture: no signs, screens with text, "
        "name tags, or documents with readable words. Do not rely on text to make a "
        "description true.\n"
        "- The question names who it is about when more than one person is drawn "
        "（「立っている人は」「受付の人は」）, so that the descriptions do not have to. "
        "Every option is then a sentence about THAT person, the wrong_participants "
        "distractor included: it reverses who does what to whom and keeps the subject "
        "（「立っている人は書類を受け取っています」）. An option about somebody else "
        "（「座っている人が…」） is not an answer to the question heard.\n"
        "- Use roles, not personal names, for everyone. Nobody real, no brands."
    )

    def cell_spec(self, cell) -> str:
        return (
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions — the picture must show exactly this:\n"
            f"- 場面（絵の場所）: {cell.setting_ja}\n"
            f"- 関係（絵の中の人物）: {cell.relation_ja}（矢印の左側の人が、設問で問われる人）\n"
            f"- 描かれている行動（正解の内容）: {cell.function_ja}\n"
            "Set `channel` to \"in_person\"."
        )

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        errors: list[str] = []
        brief = str(item.get("image_brief", "")).strip()
        words = len(brief.split())
        if words < 25:
            errors.append(f"image_brief has {words} words; an illustrator needs at least 25")
        if any(ch > "\u3000" for ch in brief):
            errors.append("image_brief must be in English (the image model and the "
                          "reviewer read it in English)")
        if cell is not None and item.get("channel") != "in_person":
            errors.append(f"channel {item.get('channel')!r} must be 'in_person'")
        return errors
