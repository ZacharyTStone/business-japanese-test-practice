"""The types whose stimulus is a document.

Four of the nine put a business document in front of the learner: 状況把握,
資料聴読解, 総合聴読解 and 総合読解. Three of them also play audio, and the whole
point of those three is that **neither source answers the question alone**. That
single requirement is what most of the prompt text below is defending, because it
is the one a generator will quietly drop: writing a document that contains the
answer, and a prompt that merely points at it, is much easier than writing a pair
that have to be combined — and the result looks fine until you notice the audio
is decorative.

The document itself is data, never a picture (see ``bjt/render``). The model
emits the structure and the template it was assigned; we render it.
"""
from __future__ import annotations

from .base import Generator
from .. import render

#: The constraint that defines every listening-and-reading type. Repeated in
#: each prompt because it is the one that decays first.
_BOTH_SOURCES = (
    "The answer MUST require both the document and the audio. Write the pair so that a "
    "test-taker who reads only the document can narrow the options but not choose "
    "between them, and one who hears only the audio cannot either. The usual way to "
    "achieve this is for the audio to change, qualify, or select against something the "
    "document states — a revised quantity, a cancelled slot, a condition that turns out "
    "not to apply. If you can answer your own item from one source, it is the wrong item. "
    "Review checks exactly this: a reader is shown the document(s) and the four options "
    "with the audio withheld, and the item is rejected if they can pick the answer; a "
    "second reader with everything must then answer it with confidence."
)


class _DocumentGenerator(Generator):
    """Shared machinery for the four document types."""

    #: Which extra field holds the document(s), for the prompt text.
    document_field = "document"

    def _template_spec(self, cell) -> str:
        if not cell.templates:
            return ""
        if len(cell.templates) == 1:
            chosen = f"Use the template `{cell.templates[0]}`."
        else:
            chosen = (
                "Choose exactly one of these templates and set `template` to it: "
                + "、".join(cell.templates)
            )
        # Spell out every offered template rather than only the chosen one: the
        # model picks, so it needs to know what it is picking between.
        details = "\n\n".join(render.spec(t) for t in cell.templates)
        return f"{chosen}\n\n{details}"

    def cell_spec(self, cell) -> str:
        lines = [
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions:",
            f"- 場面: {cell.setting_ja}",
            f"- 関係: {cell.relation_ja}",
            f"- 設問が問うこと: {cell.function_ja}",
            f"- channel: {cell.channel}",
        ]
        if cell.scenes:
            lines.append(f"- scene_id: choose exactly one of: {'、'.join(cell.scenes)}")
        spec = self._template_spec(cell)
        return "\n".join(lines) + (f"\n\n{spec}" if spec else "")

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        """The template is an assignment, exactly as the scene id is.

        ``schemas.validate_item`` already checked that each document is
        well-formed; what it cannot know is which templates this cell offered.
        """
        errors: list[str] = []
        if cell is None:
            return errors

        if cell.channel and item.get("channel") not in (None, cell.channel):
            errors.append(
                f"channel {item.get('channel')!r} does not match the cell's {cell.channel!r}"
            )
        if cell.scenes and item.get("scene_id") and item["scene_id"] not in cell.scenes:
            errors.append(
                f"scene_id {item['scene_id']!r} is not one of this cell's scenes: "
                f"{list(cell.scenes)}"
            )

        if cell.templates:
            value = item.get(self.document_field)
            docs = value if isinstance(value, list) else [value]
            for doc in docs:
                if not isinstance(doc, dict):
                    continue
                if doc.get("template") not in cell.templates:
                    errors.append(
                        f"template {doc.get('template')!r} is not one of this cell's "
                        f"templates: {list(cell.templates)}"
                    )
        return errors


class JoukyouHaakuGenerator(_DocumentGenerator):
    """状況把握問題 — read what is posted, hear what is asked, choose the action."""

    item_type = "joukyou_haaku"
    label = "状況把握問題 (situation grasp, listening+reading)"
    requires_cell = True
    task_spec = (
        "Format: `document` is what the test-taker reads — a notice, a sign, or a "
        "schedule. `stem` is what the NARRATOR reads aloud: the situation and somebody's "
        "spoken request, ending with a question such as 「このあと、どうすればいいですか。」. "
        "The four options are courses of action.\n"
        f"{_BOTH_SOURCES}\n"
        "Do not describe the document's contents in the stem — it is read, not heard, and "
        "repeating it aloud removes the reading half of the item.\n"
        "Every option must be an action somebody could actually take here, phrased in "
        "parallel. The trap roles for this type are all about using one source and not "
        "the other, so build each distractor to be exactly right on one source and wrong "
        "on the other."
    )


class ShiryouChoudokkaiGenerator(_DocumentGenerator):
    """資料聴読解問題 — a document on the page, a prompt in the ear."""

    item_type = "shiryou_choudokkai"
    label = "資料聴読解問題 (document listening+reading)"
    requires_cell = True
    task_spec = (
        "Format: `document` is what the test-taker reads — an email, a schedule, a "
        "quotation. `stem` is the spoken prompt the narrator reads, ending with the "
        "question. The four options are usually values read out of the document: a date, "
        "a quantity, a person, a room.\n"
        f"{_BOTH_SOURCES}\n"
        "Give the document at least one plausible neighbouring row or entry that a "
        "hurried reader would take instead of the right one — that is the "
        "`reads_wrong_row` trap, and a document with a single row has no room for it.\n"
        "Where the audio revises something the document says, state the original clearly "
        "in the document: the `ignores_the_spoken_change` distractor must be the "
        "document's own value, not an invented one."
    )


class SougouChoudokkaiGenerator(_DocumentGenerator):
    """総合聴読解問題 — a longer exchange plus its documents."""

    item_type = "sougou_choudokkai"
    label = "総合聴読解問題 (integrated listening+reading)"
    requires_cell = True
    document_field = "documents"
    task_spec = (
        "Format: `dialogue` is the exchange the test-taker hears — three to eight turns "
        "across two or three speaker ROLES (never personal names). `documents` holds one "
        "or two documents they read alongside it. `stem` is the narrator's question "
        "afterwards.\n"
        f"{_BOTH_SOURCES}\n"
        "This is the hardest type and its distinctive trap is `combines_wrong_pair`: the "
        "right document read against the wrong turn of the conversation. Build the "
        "exchange so that more than one turn could plausibly attach to the document, and "
        "only one actually does.\n"
        "Keep both documents short. Two documents on a phone screen is already a lot to "
        "hold; the difficulty should come from combining them, never from their length."
    )


class SougouDokkaiGenerator(_DocumentGenerator):
    """総合読解問題 — reading only."""

    item_type = "sougou_dokkai"
    label = "総合読解問題 (integrated reading)"
    requires_cell = True
    task_spec = (
        "Format: `document` is the passage — an email thread, a memo, a report, a notice. "
        "`stem` is the question as the test-taker reads it. Nothing in this type is "
        "heard, so there is no narrator and no audio.\n"
        "The question must require an INFERENCE, not a lookup. 「何が書いてありますか」 is "
        "not this type; 「この後、まず何をすべきですか」 and 「なぜ変更になったのですか」 are. "
        "The answer must be genuinely derivable from the document — a reasonable reader "
        "should agree it is the only defensible reading — while never being a sentence "
        "you can point at. Review shows a reader the question and the four options with "
        "the passage withheld and rejects the item if the answer can be picked; the "
        "distractors must each be a reading somebody could take of SOME passage.\n"
        "The four traps for this type are all near-misses against the passage: something "
        "true of the world but unstated, something stated but answering a different "
        "question, something from the wrong point in time, and something that reuses a "
        "salient word with the wrong referent. Each needs real material in the document "
        "to attach to, so give the passage more than the question strictly needs."
    )
