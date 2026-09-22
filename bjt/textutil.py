"""Small text helpers shared by the fidelity checks: rendering an item to plain
text for a prompt, and pulling the kanji out of a string for the vocab gate."""
from __future__ import annotations

from . import schemas
from .render import document


def option_texts(item: dict) -> list[str]:
    return [o["text"] for o in item["options"]]


def render_for_discriminator(item: dict) -> str:
    """Item as a real test question would appear, including its explanation, for
    the judge to inspect. Roles are omitted (they are our metadata, not a tell).

    The 資料 and the 会話 are part of "as it would appear" and were missing here
    until 2026-09-22. For 状況把握, 資料聴読解, 総合聴読解 and 総合読解 — 55 of the
    exam's 80 questions — that left the judge rating items on the stem, the four
    options and the 解説 while most of what the learner meets went unseen. The
    discrimination rate is the headline fidelity metric and the tells the judge
    states are folded back into the generator prompt, so a document that reads
    nothing like a real document could neither lower the score nor be named as
    a tell. It was invisible, and it stayed wrong: every 資料 in the library
    spelled its numbers out in kanji, which no office document does.

    `run_discriminator` is the other half of this. A stimulus the generated side
    has and the official side lacks is a tell about our seed files rather than
    about our items, so it refuses the comparison instead of scoring it.
    """
    lines = [f"[{item.get('item_type', '')} / {item.get('level', '')}]"]

    for doc in schemas.documents_of(item):
        lines.append("--- 資料 ---")
        lines.append(document.text_of(doc))

    turns = item.get("dialogue") or []
    if turns:
        lines.append("--- 会話 ---")
        lines.extend(f"{t.get('speaker_role', '')}：{t.get('text', '')}" for t in turns)

    if turns or schemas.documents_of(item):
        lines.append("--- 問題 ---")
    lines.append(item["stem"])
    lines.extend(f"{i}. {o['text']}" for i, o in enumerate(item["options"]))
    lines.append(f"解説: {item.get('explanation_ja', '')}")
    return "\n".join(lines)


def kanji_in(text: str) -> set[str]:
    """Every CJK unified ideograph in the string."""
    return {ch for ch in text if "一" <= ch <= "鿿"}


def item_kanji(item: dict) -> set[str]:
    """All kanji across the stem, options, and explanation of an item."""
    chars: set[str] = set()
    chars |= kanji_in(item.get("stem", ""))
    for o in item.get("options", []):
        chars |= kanji_in(o.get("text", ""))
    chars |= kanji_in(item.get("explanation_ja", ""))
    return chars
