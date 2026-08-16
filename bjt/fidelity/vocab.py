"""Fidelity mechanism #5 — vocabulary gating.

Constrain generation to a target vocabulary band using JLPT kanji tiers for level
control, plus a business-vocabulary list (the 重要ビジネス用語表現集 booklet the
user supplies in seeds/).

Kanji tier lists and the business list are authoritative/licensed data, so they
live in seeds/vocab/ — the gate only enforces what the user has actually loaded:

  * A kanji ceiling is enforced for a level ONLY when every tier up to that
    level's ceiling is present. Then any kanji outside the allowed band is a
    violation. If the ceiling tier is missing we cannot prove a violation, so the
    gate is permissive and says so in the quality report. (This makes the gate
    strict at lower levels — where the allowed set is small and well defined —
    and permissive at J1, which allows almost all kanji anyway.)
  * Business-term coverage is reported as an informational metric, not a hard
    gate: without a morphological tokenizer we can't reliably segment words, so
    we report simple membership rather than reject on it.

File format for seeds/vocab/jlpt_n5_kanji.txt (and n4/n3/n2/n1): kanji separated
by whitespace or newlines; anything non-kanji is ignored. Business terms:
seeds/vocab/business_terms.txt, one term per line.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .. import config, textutil

TIER_ORDER = ["N5", "N4", "N3", "N2", "N1"]
LEVEL_CEILING = {"J3": "N3", "J2": "N2", "J1": "N1"}


def _load_tier(tier: str) -> set[str]:
    path = config.SEEDS_DIR / "vocab" / f"jlpt_{tier.lower()}_kanji.txt"
    if not path.exists():
        return set()
    text = path.read_text(encoding="utf-8")
    return textutil.kanji_in(text)


def _load_business_terms() -> list[str]:
    path = config.SEEDS_DIR / "vocab" / "business_terms.txt"
    if not path.exists():
        return []
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


@dataclass
class VocabResult:
    enforced: bool
    violations: list[str] = field(default_factory=list)   # above-band kanji
    business_terms_used: list[str] = field(default_factory=list)
    note: str = ""

    @property
    def ok(self) -> bool:
        return not self.violations


def check_item(item: dict, level: str) -> VocabResult:
    ceiling = LEVEL_CEILING.get(level)
    if ceiling is None:
        return VocabResult(enforced=False, note=f"unknown level {level!r}")

    ceiling_idx = TIER_ORDER.index(ceiling)
    tiers = {t: _load_tier(t) for t in TIER_ORDER[: ceiling_idx + 1]}
    # Enforce only if every tier up to the ceiling is actually loaded.
    missing = [t for t, s in tiers.items() if not s]
    business = _load_business_terms()

    text_for_business = item.get("stem", "") + " ".join(o["text"] for o in item.get("options", []))
    terms_used = [t for t in business if t and t in text_for_business]

    if missing:
        return VocabResult(
            enforced=False,
            business_terms_used=terms_used,
            note=(
                f"kanji ceiling not enforced for {level}: missing tier data "
                f"({', '.join(missing)}). Add seeds/vocab/jlpt_*.txt to enable."
            ),
        )

    allowed: set[str] = set().union(*tiers.values())
    violations = sorted(textutil.item_kanji(item) - allowed)
    return VocabResult(
        enforced=True,
        violations=violations,
        business_terms_used=terms_used,
        note=f"kanji ceiling {ceiling} enforced",
    )


def status_summary() -> dict:
    """For the quality report: which vocab data is loaded."""
    return {
        "tiers_loaded": [t for t in TIER_ORDER if _load_tier(t)],
        "business_terms": len(_load_business_terms()),
    }
