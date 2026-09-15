"""Small text helpers shared by the fidelity checks: rendering an item to plain
text for a prompt, and pulling the kanji out of a string for the vocab gate."""
from __future__ import annotations


def option_texts(item: dict) -> list[str]:
    return [o["text"] for o in item["options"]]


def render_full(item: dict) -> str:
    """Stem + numbered options — the complete stimulus a test-taker sees."""
    opts = "\n".join(f"{i}. {o['text']}" for i, o in enumerate(item["options"]))
    return f"{item['stem']}\n\nOptions:\n{opts}"


def render_for_discriminator(item: dict) -> str:
    """Item as a real test question would appear, including its explanation, for
    the judge to inspect. Roles are omitted (they are our metadata, not a tell)."""
    opts = "\n".join(f"{i}. {o['text']}" for i, o in enumerate(item["options"]))
    return (
        f"[{item.get('item_type', '')} / {item.get('level', '')}]\n"
        f"{item['stem']}\n{opts}\n解説: {item.get('explanation_ja', '')}"
    )


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
