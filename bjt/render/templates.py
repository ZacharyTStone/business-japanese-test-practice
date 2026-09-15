"""The document templates — the visual grammar a reading item borrows.

A generic paragraph card would make every reading item look the same and feel
like a textbook. Real business reading is done against a shape you already
recognise: you know where a subject line lives, you know the action items are at
the bottom of the minutes. Recognising the shape *is* part of the skill, so the
templates supply it and the generated content supplies only the original
business writing that goes inside.

Each template declares the header fields it cannot do without and the item types
it suits. `required_meta` is enforced by ``document.validate_document``: an email
with no 件名 is not an email, and an item built on one would be testing something
other than what it claims.

Every template is our own design and the content is always fictional — invented
companies, people, dates and amounts. No real brand, and no transcription of any
existing document, ever goes in here.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Template:
    id: str
    ja: str
    #: What the reader is looking at, one line, used in prompts.
    description: str
    #: Header labels the document must carry. Japanese, because they render as
    #: written.
    required_meta: tuple[str, ...]
    #: Item types this template is a sensible stimulus for.
    suits: tuple[str, ...]
    #: Ways this template is allowed to vary, so a library of them does not
    #: become visually predictable. Handed to the generator as a menu.
    variations: tuple[str, ...] = field(default_factory=tuple)


_ALL_DOC_TYPES = ("shiryou_choudokkai", "sougou_choudokkai", "sougou_dokkai")

TEMPLATES: dict[str, Template] = {
    "email_external": Template(
        id="email_external",
        ja="社外メール",
        description="A single email to or from someone outside the company.",
        required_meta=("差出人", "宛先", "件名", "日時"),
        suits=("hyougen", *_ALL_DOC_TYPES),
        variations=(
            "one recipient, or one recipient plus a CC",
            "a request, a reply to a request, or an unprompted notification",
            "with or without an attachment line",
        ),
    ),
    "email_thread": Template(
        id="email_thread",
        ja="メールのやりとり",
        description="A reply chain: the newest message on top, earlier ones quoted below.",
        required_meta=("差出人", "宛先", "件名", "日時"),
        suits=_ALL_DOC_TYPES,
        variations=(
            "two, three, or four messages",
            "the decision in the newest message, or buried in the middle one",
            "one participant added partway down the chain",
        ),
    ),
    "memo_notice": Template(
        id="memo_notice",
        ja="社内通知・回覧",
        description="An internal notice: a change of procedure, and what staff must do.",
        required_meta=("発信者", "発信日", "対象"),
        suits=("joukyou_haaku", *_ALL_DOC_TYPES),
        variations=(
            "effective immediately, or from a stated date",
            "one action for everyone, or different actions per department",
        ),
    ),
    "meeting_minutes": Template(
        id="meeting_minutes",
        ja="議事録",
        description="Minutes: attendees, numbered agenda, decisions, and who owns each action.",
        required_meta=("日時", "場所", "出席者"),
        suits=("sougou_choukai", "sougou_choudokkai", "sougou_dokkai"),
        variations=(
            "decisions settled, or one item carried over",
            "action owners named, or one action left unassigned on purpose",
        ),
    ),
    "schedule": Template(
        id="schedule",
        ja="予定表",
        description="A schedule or room-booking grid with times, people and places.",
        required_meta=("期間", "作成者"),
        suits=("joukyou_haaku", "shiryou_choudokkai", "sougou_choudokkai"),
        variations=(
            "one open slot, a double booking, or a provisional reservation",
            "a changed location on one row",
        ),
    ),
    "progress_report": Template(
        id="progress_report",
        ja="進捗報告書",
        description="A project update: status, milestones, risks, next steps.",
        required_meta=("報告者", "報告日", "案件"),
        suits=("sougou_dokkai", "sougou_choudokkai"),
        variations=(
            "a summary paragraph, a milestone table, or a risks-and-actions list",
            "on schedule, slipping, or recovered after a slip",
        ),
    ),
    "quote_order": Template(
        id="quote_order",
        ja="見積書・注文書",
        description="A quotation or order: sender and recipient blocks, line items, totals, delivery date.",
        required_meta=("宛先", "発行者", "発行日"),
        suits=("shiryou_choudokkai", "sougou_dokkai"),
        variations=(
            "two to five line items",
            "one revised quantity or unit price against an earlier version",
            "a note about delivery separate from the table",
        ),
    ),
    "office_sign": Template(
        id="office_sign",
        ja="掲示・案内",
        description="A sign or short form: a heading, the rules, and where or by when.",
        required_meta=("掲示者",),
        suits=("bamen_haaku", "joukyou_haaku", "sougou_dokkai"),
        variations=(
            "rules as a list, or as a short procedure",
            "a deadline, a location, or a contact as the tested detail",
        ),
    ),
}


def for_item_type(item_type: str) -> list[Template]:
    """The templates a given item type is allowed to be set in."""
    return [t for t in TEMPLATES.values() if item_type in t.suits]


def spec(template_id: str) -> str:
    """The template rendered as prompt text: what it is, what it must carry, and
    the ways it is allowed to vary."""
    t = TEMPLATES[template_id]
    lines = [
        f"Document template: {t.id}（{t.ja}） — {t.description}",
        "Required header fields (`meta`), with these exact labels: "
        + "、".join(t.required_meta),
    ]
    if t.variations:
        lines.append(
            "Pick one option from each axis below, so a library of these documents "
            "does not become visually predictable:\n"
            + "\n".join(f"  - {v}" for v in t.variations)
        )
    lines.append(
        "All names, companies, dates, amounts and phone numbers are fictional and "
        "original. Never use a real brand, and never reproduce an existing document."
    )
    return "\n".join(lines)
