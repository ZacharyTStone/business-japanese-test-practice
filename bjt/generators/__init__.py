"""Item-type generators. One module, prompt, and schema per type."""
from __future__ import annotations

from .goi_bunpou import GoiBunpouGenerator
from .hyougen import HyougenGenerator

# Registry of the generators built so far (phase 1: two text-only types).
GENERATORS = {
    GoiBunpouGenerator.item_type: GoiBunpouGenerator,
    HyougenGenerator.item_type: HyougenGenerator,
}


def get_generator(item_type: str, store=None):
    if item_type not in GENERATORS:
        raise KeyError(
            f"no generator for {item_type!r}; available: {sorted(GENERATORS)}"
        )
    return GENERATORS[item_type](store=store)
