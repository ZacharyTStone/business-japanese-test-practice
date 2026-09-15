"""Target level (J3/J2/J1) described with CAN-DO style descriptors.

The brief is explicit: describe difficulty with the official CAN-DO descriptors
from the BJT level guide, not invented difficulty language. The authoritative
text is copyrighted, so it belongs in seeds/ — drop the exact wording into
seeds/levels.json and it overrides the neutral built-in defaults below.

The defaults are deliberately plain and non-authoritative: enough to steer the
generator toward the right band, phrased so nothing is claimed as official text.
"""
from __future__ import annotations

import json

from . import config

LEVELS = ["J3", "J2", "J1"]

# Neutral fallbacks. Overridden by seeds/levels.json when present.
_DEFAULT_DESCRIPTORS: dict[str, str] = {
    "J3": (
        "Has a basic command of business Japanese sufficient to handle routine, "
        "predictable workplace communication. Understands straightforward notices, "
        "short instructions, and common set phrases; keigo is simple and formulaic."
    ),
    "J2": (
        "Has a practical command of business Japanese for a wide range of ordinary "
        "workplace situations. Handles less predictable exchanges, longer documents, "
        "and keigo choices that depend on relative status and in-group/out-group."
    ),
    "J1": (
        "Has a broad command of business Japanese close to that expected of a "
        "native professional. Handles nuanced, indirect, and non-standard usage, "
        "subtle register distinctions, and specialised or abstract business content."
    ),
}


def _load_from_seeds() -> dict[str, str]:
    path = config.SEEDS_DIR / "levels.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    # Accept {"J2": "text", ...} or {"J2": {"descriptor": "text"}}.
    out: dict[str, str] = {}
    for lvl, val in data.items():
        if isinstance(val, str):
            out[lvl] = val
        elif isinstance(val, dict) and "descriptor" in val:
            out[lvl] = val["descriptor"]
    return out


def descriptor(level: str) -> str:
    if level not in LEVELS:
        raise ValueError(f"unknown level {level!r}; expected one of {LEVELS}")
    return _load_from_seeds().get(level, _DEFAULT_DESCRIPTORS[level])


def using_official_descriptors() -> bool:
    """True when the authoritative descriptors have been supplied via seeds."""
    return bool(_load_from_seeds())
