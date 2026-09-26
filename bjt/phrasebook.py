"""The stock lines of office Japanese, in the one wording the library records.

Audio clips are content-addressed — `bjt/tts/plan.py` hashes (voice, channel,
text) — so an utterance that occurs in twenty items is synthesised once, *if*
its text is byte-identical every time. A model writing 「少々お待ちください」
one night and 「少々お待ち下さい」 the next produces two clips of one phrase,
and a bank in which the same formula is heard in slightly different words,
which is not how an office sounds either.

So the generator is shown this list for the types whose options or dialogue
are spoken, and asked to use these exact wordings whenever a line *is* one of
these formulas. Two sources, both small:

  * ``STOCK_LINES`` — the fixed formulas of business Japanese, spelled the way
    the reference batches spell them.
  * ``library_lines()`` — every spoken line the committed bank already uses
    more than once. A line that has recurred is a line the library has a
    voice for.

This is a nudge toward reuse where reuse is right, not a quota: a distractor
that has to be wrong in a particular way is still written fresh. Nothing here
is licensed material — these are the phrases on every business-manners poster.
"""
from __future__ import annotations

import json
from collections import Counter

from . import batch as batchmod
from . import withdrawn

#: Spelled once, here, and nowhere else. Keep the punctuation: it is part of
#: the hash.
STOCK_LINES: tuple[str, ...] = (
    "いつもお世話になっております。",
    "お世話になっております。",
    "かしこまりました。",
    "承知いたしました。",
    "承知しました。",
    "少々お待ちください。",
    "少々お待ちいただけますでしょうか。",
    "お待たせいたしました。",
    "恐れ入りますが、",
    "お手数をおかけしますが、",
    "申し訳ございません。",
    "失礼いたします。",
    "お疲れさまです。",
    "お先に失礼いたします。",
    "ただいま席を外しております。",
    "折り返しご連絡いたします。",
    "よろしくお願いいたします。",
    "ありがとうございます。",
)

#: Types whose options or dialogue turns are spoken, and so have clips to share.
SPOKEN_TYPES: frozenset[str] = frozenset({
    "hatsugen_choukai", "sougou_choukai", "sougou_choudokkai", "gazou_haaku",
})


def library_lines(min_count: int = 2, limit: int = 20) -> list[str]:
    """Spoken lines the committed bank already uses more than once, most
    common first. Read from the bundles' audio manifests, so what counts is
    exactly what has a clip. A withdrawn item's lines are not the library's:
    its wording is the reason it was withdrawn often enough."""
    counts: Counter[str] = Counter()
    gone = withdrawn.ids()
    for path in batchmod.bundles():
        try:
            bundle = batchmod.load(path)
        except (OSError, json.JSONDecodeError):
            continue
        for clip in withdrawn.live_bundle(bundle, gone).get("audio_manifest", []):
            if clip.get("kind") in ("option", "dialogue"):
                counts[clip["text"]] += 1
    return [text for text, n in counts.most_common(limit)
            if n >= min_count and text not in STOCK_LINES]


def prompt_block(item_type: str) -> str:
    """The lines, as a paragraph of the system prompt, or nothing for a type
    whose options are read rather than heard."""
    if item_type not in SPOKEN_TYPES:
        return ""
    lines = [*STOCK_LINES, *library_lines()]
    return (
        "Stock phrases. The library's audio is shared between items, so when a "
        "spoken line (an option, or a turn of a conversation) IS one of the standard "
        "formulas below, write it in exactly this wording — same kanji, same "
        "punctuation — rather than a variant. Do not force one in where the "
        "situation does not call for it:\n"
        + "\n".join(f"- {line}" for line in lines)
    )
