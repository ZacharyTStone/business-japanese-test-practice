"""Near-duplicate detection across a batch.

The seed table stops two items sharing a *cell*, but it cannot stop two different
cells producing the same item: 「取引先の課長に資料の確認を頼む」 and 「上司に
報告書に目を通してもらう」 are different cells and very nearly the same question.
A learner notices this long before any metric does, so it is checked before a
batch ships.

The measure is deliberately dumb and offline: character-bigram Jaccard over the
normalised stem and the correct utterance. No embeddings, no API call, nothing to
pay for — this runs on every batch and in the tests. It is tuned to flag rather
than to judge: pairs above the threshold are reported for the five-second human
look that the pipeline ends with anyway.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from ..schemas import correct_index

#: Above this Jaccard similarity, two items are treated as the same question.
#: Chosen so that paraphrases of one situation collide but two genuinely
#: different 敬語 problems in the same setting do not.
DEFAULT_THRESHOLD = 0.62

_STRIP = re.compile(r"[\s。、，．,.\-—―…「」『』（）()！？!?・:：;；　]+")


def normalize(text: str) -> str:
    """Fold width/case and drop punctuation, so wording differences that a
    listener would not hear as different do not hide a duplicate."""
    return _STRIP.sub("", unicodedata.normalize("NFKC", text))


def bigrams(text: str) -> set:
    t = normalize(text)
    if len(t) < 2:
        return {t} if t else set()
    return {t[i : i + 2] for i in range(len(t) - 1)}


def similarity(a: str, b: str) -> float:
    """Jaccard over character bigrams. 1.0 == identical after normalisation."""
    ga, gb = bigrams(a), bigrams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


def item_signature(item: dict) -> str:
    """What we compare: the situation plus the answer. Two items with the same
    situation but different answers are legitimately different items, and two
    items with the same answer in different situations are fine too — it takes
    both matching to be a duplicate."""
    try:
        answer = item["options"][correct_index(item["options"])]["text"]
    except (KeyError, ValueError, IndexError):
        answer = ""
    return f"{item.get('stem', '')}\n{answer}"


@dataclass
class DuplicatePair:
    i: int
    j: int
    score: float
    topic_i: str
    topic_j: str


def find_duplicates(items: list[dict], threshold: float = DEFAULT_THRESHOLD) -> list[DuplicatePair]:
    """Every pair at or above the threshold, worst first."""
    sigs = [item_signature(it) for it in items]
    pairs: list[DuplicatePair] = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            score = similarity(sigs[i], sigs[j])
            if score >= threshold:
                pairs.append(
                    DuplicatePair(
                        i=i,
                        j=j,
                        score=score,
                        topic_i=items[i].get("topic", ""),
                        topic_j=items[j].get("topic", ""),
                    )
                )
    pairs.sort(key=lambda p: -p.score)
    return pairs


def max_similarity(item: dict, others: list[dict]) -> float:
    """How close this item comes to anything already in the pool. Used when
    adding items one at a time rather than checking a finished batch."""
    sig = item_signature(item)
    return max((similarity(sig, item_signature(o)) for o in others), default=0.0)
